import { APIError, ConfigurationError, ConnectionError, RequestAbortedError, ResponseValidationError, SystemOneError, TimeoutError } from './errors.js';
import type { ApiKey, Fetch, PreparedRequest, SystemOneAdapter } from './types.js';
import { parseBaseURL } from './validation.js';

export class RequestScope {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #external: AbortSignal | undefined;
  #deadline: number;
  #onAbort = () => this.controller.abort(new RequestAbortedError());

  constructor(timeoutMs: number, external?: AbortSignal) {
    this.#deadline = Date.now() + timeoutMs;
    this.#external = external;
    if (external?.aborted) this.#onAbort();
    else {
      external?.addEventListener('abort', this.#onAbort, { once: true });
      this.#timer = setTimeout(() => this.controller.abort(new TimeoutError()), timeoutMs);
    }
  }
  throwIfAborted(): void {
    if (!this.signal.aborted && Date.now() >= this.#deadline) this.controller.abort(new TimeoutError());
    if (this.signal.aborted) throw this.signal.reason as SystemOneError;
  }
  /** Racing also bounds a custom fetch/key resolver that does not cooperate with AbortSignal. */
  run<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      try { this.throwIfAborted(); } catch (error) { reject(error); return; }
      if (this.signal.aborted) { reject(this.signal.reason); return; }
      const onAbort = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', onAbort, { once: true });
      try {
        Promise.resolve(operation()).then(resolve, reject).finally(() => this.signal.removeEventListener('abort', onAbort));
      } catch (error) {
        this.signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    });
  }
  async delay(ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await this.run(() => new Promise<void>(resolve => { timer = setTimeout(resolve, ms); })); }
    finally { clearTimeout(timer); }
  }
  dispose(): void {
    clearTimeout(this.#timer);
    this.#external?.removeEventListener('abort', this.#onAbort);
  }
}

function headersFrom(value?: HeadersInit): Headers {
  try { return new Headers(value); }
  catch { throw new ConfigurationError('headers contains an invalid HTTP header.'); }
}
export function snapshotHeaders(value?: HeadersInit): Headers { return headersFrom(value); }

export function buildHeaders(adapter: SystemOneAdapter, prepared: PreparedRequest, key: string | null, custom: readonly HeadersInit[]): Headers {
  const headers = headersFrom(prepared.headers);
  headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json');
  const auth = adapter.authenticate
    ? headersFrom(adapter.authenticate(key))
    : headersFrom(key === null ? undefined : { authorization: `Bearer ${key}` });
  auth.forEach((value, name) => headers.set(name, value));
  const reserved = new Set(['authorization', 'host', 'content-length', ...headers.keys()]);
  for (const extra of custom) {
    headersFrom(extra).forEach((value, name) => {
      if (reserved.has(name)) throw new ConfigurationError(`Header ${name} is managed by the SDK or adapter and cannot be overridden.`);
      headers.set(name, value);
    });
  }
  return headers;
}

export function checkRequestURL(url: string, baseURL: string): string {
  const target = parseBaseURL(url);
  if (target.origin !== parseBaseURL(baseURL).origin) throw new ConfigurationError('An adapter request must use the configured baseURL origin.');
  return target.toString();
}
export async function resolveApiKey(apiKey: ApiKey, scope: RequestScope): Promise<string | null> {
  let key: unknown;
  try { key = await scope.run(() => typeof apiKey === 'function' ? apiKey() : apiKey); }
  catch (error) {
    if (error instanceof SystemOneError) throw error;
    throw new ConfigurationError('The API key resolver failed.');
  }
  if (key !== null && (typeof key !== 'string' || key.length === 0 || key.trim() !== key || /[\r\n]/.test(key))) {
    throw new ConfigurationError('apiKey must be a nonempty token, a token resolver, or explicit null for an unauthenticated endpoint.');
  }
  return key as string | null;
}

export function parseRetryAfter(headers: Headers, now = Date.now()): number | undefined {
  const milliseconds = headers.get('retry-after-ms');
  if (milliseconds !== null && /^\d+(?:\.\d+)?$/.test(milliseconds.trim())) {
    const value = Number(milliseconds);
    if (Number.isFinite(value)) return Math.ceil(value);
  }
  const header = headers.get('retry-after');
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return Number.isFinite(ms) ? Math.ceil(ms) : undefined;
  }
  // Do not let Date.parse reinterpret malformed numeric delays as calendar dates.
  if (!/[a-zA-Z]/.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
export function requestIdOf(headers: Headers): string | undefined {
  return headers.get('x-request-id') ?? headers.get('request-id') ?? undefined;
}
function cancelBody(response: Response): void {
  try { void response.body?.cancel().catch(() => {}); } catch { /* Cleanup must not replace the original failure. */ }
}

async function readJson(response: Response, maxBytes: number, scope: RequestScope): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    cancelBody(response);
    throw new ResponseValidationError('response', 'body exceeds maxResponseBytes');
  }
  if (!response.body) throw new ResponseValidationError('response', 'expected a JSON body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  let completed = false;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await scope.run(() => reader.read()); }
      catch (error) {
        if (error instanceof SystemOneError) throw error;
        throw new ConnectionError();
      }
      if (chunk.done) { completed = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new ResponseValidationError('response', 'body exceeds maxResponseBytes');
      try { parts.push(decoder.decode(chunk.value, { stream: true })); }
      catch { throw new ResponseValidationError('response', 'body is not valid UTF-8'); }
    }
    try { parts.push(decoder.decode()); }
    catch { throw new ResponseValidationError('response', 'body is not valid UTF-8'); }
    scope.throwIfAborted();
    try { return JSON.parse(parts.join('')) as unknown; }
    catch { throw new ResponseValidationError('response', 'body is not valid JSON'); }
  } finally {
    if (!completed) {
      try { void reader.cancel().catch(() => {}); } catch { /* Best effort. */ }
    }
    try { reader.releaseLock(); } catch { /* Pending non-cooperative readers may still hold the lock. */ }
  }
}

export async function postJson(fetcher: Fetch, url: string, headers: Headers, body: string, maxBytes: number, scope: RequestScope): Promise<{ payload: unknown; status: number; requestId: string | undefined }> {
  let response: Response;
  try {
    response = await scope.run(() => fetcher(url, {
      method: 'POST', headers, body, signal: scope.signal, redirect: 'manual',
    }).then(value => {
      if (scope.signal.aborted) cancelBody(value);
      return value;
    }));
  } catch (error) {
    if (error instanceof SystemOneError) throw error;
    throw new ConnectionError();
  }
  const requestId = requestIdOf(response.headers);
  if (!response.ok) {
    cancelBody(response);
    throw new APIError(response.status, requestId, parseRetryAfter(response.headers));
  }
  return { payload: await readJson(response, maxBytes, scope), status: response.status, requestId };
}
