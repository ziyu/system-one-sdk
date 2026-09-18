import { decodeCloudflareResponse } from './adapters/cloudflare-codec.js';
import { nativeQuestions } from './adapters/system-one.js';
import { APIError, BindingError, ConfigurationError, ConnectionError, ResponseValidationError, TimeoutError, UnsupportedFeatureError } from './errors.js';
import { cancelBody, readJsonResponse, RequestScope, snapshotHeaders } from './transport.js';
import type { AdapterContext, EvaluateRequest, EvaluationClient, EvaluationResult, Questions, RequestOptions } from './types.js';
import { configInteger, isRecord, snapshotRequest, validateResponse } from './validation.js';

/** Structural subset of Workers AI. No Cloudflare package is required at runtime. */
export interface CloudflareAiBinding {
  run(model: string, inputs: Record<string, unknown>, options: {
    returnRawResponse: true;
    signal: AbortSignal;
    extraHeaders?: Record<string, string>;
  }): Promise<unknown>;
}

export interface CloudflareWorkersOptions {
  readonly binding: CloudflareAiBinding;
  readonly model?: string;
  readonly headers?: HeadersInit;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly maxResponseBytes?: number;
}

function checkOptions(value: unknown, allowed: readonly string[], name: string): void {
  if (!isRecord(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) {
    throw new ConfigurationError(`${name} must contain only supported options.`);
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor) || !descriptor.enumerable) throw new ConfigurationError(`${name} must contain enumerable data properties.`);
  }
}

function bindingHeaders(...sources: (HeadersInit | undefined)[]): Headers {
  const result = new Headers();
  for (const source of sources) {
    snapshotHeaders(source).forEach((value, key) => {
      if (['authorization', 'host', 'content-type', 'content-length', 'accept', 'connection', 'transfer-encoding', 'upgrade'].includes(key)
        || key.startsWith('cf-consn-')) {
        throw new ConfigurationError(`Header ${key} is managed by the SDK or Workers AI binding.`);
      }
      result.set(key, value);
    });
  }
  return result;
}

/** Native env.AI.run() client. Model calls never use a public REST endpoint or API token. */
export class CloudflareWorkers implements EvaluationClient {
  readonly model: string;
  readonly adapterId = 'cloudflare-workers';
  #run: CloudflareAiBinding['run'];
  #headers: Headers;
  #timeoutMs: number;
  #maxRetries: number;
  #retryDelayMs: number;
  #maxRetryDelayMs: number;
  #maxResponseBytes: number;

  constructor(options: CloudflareWorkersOptions) {
    checkOptions(options, ['binding', 'model', 'headers', 'timeoutMs', 'maxRetries', 'retryDelayMs', 'maxRetryDelayMs', 'maxResponseBytes'], 'CloudflareWorkers');
    const binding = options.binding;
    if (!binding || typeof binding.run !== 'function') throw new ConfigurationError('Provide a Workers AI binding with a run method.');
    // Preserve native receiver identity and the configured method across asynchronous calls.
    this.#run = binding.run.bind(binding);
    this.model = options.model ?? 'typesafe/jev';
    if (typeof this.model !== 'string' || !this.model.trim()) throw new ConfigurationError('model must be a nonempty model ID.');
    this.#headers = bindingHeaders(options.headers);
    this.#timeoutMs = configInteger(options.timeoutMs ?? 10_000, 'timeoutMs', 1);
    this.#maxRetries = configInteger(options.maxRetries ?? 2, 'maxRetries', 0, 100);
    this.#retryDelayMs = configInteger(options.retryDelayMs ?? 200, 'retryDelayMs', 0);
    this.#maxRetryDelayMs = configInteger(options.maxRetryDelayMs ?? 2_000, 'maxRetryDelayMs', 0);
    this.#maxResponseBytes = configInteger(options.maxResponseBytes ?? 8 * 1024 * 1024, 'maxResponseBytes', 1);
  }

  async evaluate<const Q extends Questions>(request: EvaluateRequest<Q>, options: RequestOptions = {}): Promise<EvaluationResult<Q>> {
    const start = Date.now();
    const snapshot = snapshotRequest(request);
    checkOptions(options, ['signal', 'timeoutMs', 'maxRetries', 'headers'], 'request options');
    if (snapshot.providerOptions !== undefined && Object.keys(snapshot.providerOptions).length > 0) {
      throw new UnsupportedFeatureError('The Cloudflare Jev binding client does not define providerOptions.');
    }
    const timeoutMs = configInteger(options.timeoutMs ?? this.#timeoutMs, 'timeoutMs', 1);
    const maxRetries = configInteger(options.maxRetries ?? this.#maxRetries, 'maxRetries', 0, 100);
    const headers = bindingHeaders(this.#headers, options.headers);
    const signal = options.signal;
    if (signal !== undefined && (signal === null || typeof signal.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw new ConfigurationError('signal must be an AbortSignal.');
    }
    const model = snapshot.model ?? this.model;
    // Codec context only; this client does not construct or dispatch an HTTP request URL.
    const context: AdapterContext = { baseURL: '', model, request: snapshot };
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) throw new TimeoutError();
    const scope = new RequestScope(remaining, signal);
    try {
      for (let attempt = 0; ; attempt++) {
        scope.throwIfAborted();
        try {
          // The binding cannot mutate the pristine validation snapshot or a later attempt.
          const current = snapshotRequest(snapshot);
          let raw: unknown;
          try {
            raw = await scope.run(() => Promise.resolve(this.#run(model, {
              state: current.state, questions: nativeQuestions(current.questions),
            }, { returnRawResponse: true, signal: scope.signal, extraHeaders: Object.fromEntries(headers) })).then(value => {
              if (scope.signal.aborted && value instanceof Response) cancelBody(value);
              return value;
            }));
          } catch {
            scope.throwIfAborted();
            // A thrown binding error supplies no trustworthy HTTP status. Do not expose its
            // message (which may contain input/secrets) or assume that retrying is safe.
            throw new BindingError();
          }
          if (!(raw instanceof Response)) {
            throw new ResponseValidationError('binding.response', 'expected a Response from returnRawResponse: true');
          }
          const response = await readJsonResponse(raw, this.#maxResponseBytes, scope);
          const validated = validateResponse(decodeCloudflareResponse(response.payload, context), snapshot.questions, model);
          scope.throwIfAborted();
          return {
            ...validated,
            response: {
              ...(response.requestId === undefined ? {} : { requestId: response.requestId }),
              status: response.status, attempts: attempt + 1, durationMs: Date.now() - start, adapter: this.adapterId,
            },
          };
        } catch (error) {
          scope.throwIfAborted();
          if (attempt >= maxRetries || !(error instanceof ConnectionError || error instanceof APIError && error.retryable)) throw error;
          const reportedDelay = error instanceof APIError ? error.retryAfterMs : undefined;
          const backoff = Math.min(this.#maxRetryDelayMs, this.#retryDelayMs * 2 ** Math.min(attempt, 30));
          const delay = reportedDelay ?? Math.floor(backoff * (0.5 + Math.random() * 0.5));
          if (delay >= timeoutMs - (Date.now() - start)) throw new TimeoutError();
          await scope.delay(delay);
        }
      }
    } finally { scope.dispose(); }
  }
}

export function createCloudflareWorkers(options: CloudflareWorkersOptions): CloudflareWorkers {
  return new CloudflareWorkers(options);
}
