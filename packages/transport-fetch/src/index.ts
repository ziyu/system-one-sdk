import { APIError, ConfigurationError, ConnectionError, RequestAbortedError, ResponseValidationError, SystemOneError, TimeoutError } from '@system-one-ai/core';
import type { ApiKey, Fetch, PreparedRequest, Transport, TransportRequest } from '@system-one-ai/core';
import { configInteger } from '@system-one-ai/core/validation';
import { checkRequestURL, snapshotHeaders } from '@system-one-ai/core/http';
export { checkRequestURL, snapshotHeaders } from '@system-one-ai/core/http';

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

export function buildHeaders(adapter: Pick<TransportRequest, 'authenticate'>, prepared: PreparedRequest, key: string | null, custom: readonly HeadersInit[]): Headers {
  const headers = snapshotHeaders(prepared.headers);
  headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json');
  const auth = adapter.authenticate
    ? snapshotHeaders(adapter.authenticate(key))
    : snapshotHeaders(key === null ? undefined : { authorization: `Bearer ${key}` });
  auth.forEach((value, name) => headers.set(name, value));
  const reserved = new Set(['authorization', 'host', 'content-length', ...headers.keys(), ...auth.keys()]);
  for (const extra of custom) {
    snapshotHeaders(extra).forEach((value, name) => {
      if (reserved.has(name)) throw new ConfigurationError(`Header ${name} is managed by the SDK or adapter and cannot be overridden.`);
      headers.set(name, value);
    });
  }
  return headers;
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
  return headers.get('x-request-id') ?? headers.get('request-id') ?? headers.get('cf-ai-req-id') ?? undefined;
}
export function cancelBody(response: Response): void {
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

/** Shared bounded Response handling for HTTP clients and native bindings. */
export async function readJsonResponse(response: Response, maxBytes: number, scope: RequestScope): Promise<{ payload: unknown; status: number; requestId: string | undefined }> {
  const requestId = requestIdOf(response.headers);
  if (!response.ok) {
    cancelBody(response);
    throw new APIError(response.status, requestId, parseRetryAfter(response.headers));
  }
  return { payload: await readJson(response, maxBytes, scope), status: response.status, requestId };
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
  return readJsonResponse(response, maxBytes, scope);
}

/** The Fetch implementation is optional; globalThis.fetch is resolved at call time. */
export function createFetchTransport(fetch?: Fetch): Transport {
  if (fetch !== undefined && typeof fetch !== 'function') throw new ConfigurationError('fetch must be a function.');
  return {
    async send(request, options) {
      const start = Date.now();
      const timeoutMs = configInteger(options.timeoutMs, 'timeoutMs', 1);
      const maxRetries = configInteger(options.maxRetries, 'maxRetries', 0, 100);
      const retryDelayMs = configInteger(options.retryDelayMs, 'retryDelayMs', 0);
      const maxRetryDelayMs = configInteger(options.maxRetryDelayMs, 'maxRetryDelayMs', 0);
      const maxResponseBytes = configInteger(options.maxResponseBytes, 'maxResponseBytes', 1);
      const url = checkRequestURL(request.url, request.baseURL);
      if (typeof request.body !== 'string') throw new ConfigurationError('Transport body must be serialized JSON.');
      const body = request.body;
      const prepared = { url, body, headers: snapshotHeaders(request.headers) };
      const customHeaders = options.headers.map(snapshotHeaders);
      const fetcher = fetch ?? globalThis.fetch?.bind(globalThis);
      if (!fetcher) throw new ConfigurationError('This runtime needs a Fetch implementation; provide the fetch option.');
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) throw new TimeoutError();
      const scope = new RequestScope(remaining, options.signal);
      try {
        for (let attempt = 0; ; attempt++) {
          scope.throwIfAborted();
          try {
            const key = await resolveApiKey(request.apiKey, scope);
            const headers = buildHeaders(request, prepared, key, customHeaders);
            const response = await postJson(fetcher, url, headers, body, maxResponseBytes, scope);
            scope.throwIfAborted();
            return {
              payload: response.payload, status: response.status, attempts: attempt + 1,
              ...(response.requestId === undefined ? {} : { requestId: response.requestId }),
            };
          } catch (error) {
            scope.throwIfAborted();
            if (attempt >= maxRetries || !(error instanceof ConnectionError || error instanceof APIError && error.retryable)) throw error;
            const reportedDelay = error instanceof APIError ? error.retryAfterMs : undefined;
            const backoff = Math.min(maxRetryDelayMs, retryDelayMs * 2 ** Math.min(attempt, 30));
            const delay = reportedDelay ?? Math.floor(backoff * (0.5 + Math.random() * 0.5));
            // Never retry earlier than Retry-After, including values too large for JS timers.
            if (delay >= timeoutMs - (Date.now() - start)) throw new TimeoutError();
            await scope.delay(delay);
          }
        }
      } finally { scope.dispose(); }
    },
  };
}
