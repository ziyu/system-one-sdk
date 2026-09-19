import { ConfigurationError, RequestAbortedError, ResponseValidationError, SystemOneError, TimeoutError, UnsupportedFeatureError } from './errors.js';
import { checkRequestURL, snapshotHeaders } from './http.js';
import type { AdapterContext, EvaluateRequest, EvaluationResult, Questions, RequestOptions, SystemOneAdapter, SystemOneOptions } from './types.js';
import { assertJson, configInteger, parseBaseURL, snapshotRequest, validateResponse } from './validation.js';

export class SystemOne {
  readonly baseURL: string;
  readonly model: string;
  readonly adapterId: string;
  #adapter: SystemOneAdapter;
  #options: SystemOneOptions;
  #headers: Headers;
  #timeoutMs: number;
  #maxRetries: number;
  #retryDelayMs: number;
  #maxRetryDelayMs: number;
  #maxResponseBytes: number;

  constructor(options: SystemOneOptions) {
    if (!options || !('apiKey' in options)) throw new ConfigurationError('Provide apiKey explicitly; use null only for an unauthenticated endpoint.');
    this.#adapter = options.adapter;
    if (!this.#adapter) throw new ConfigurationError('Provide an adapter explicitly. Install a protocol adapter package and pass its adapter option.');
    if (!this.#adapter.id || !Array.isArray(this.#adapter.supportedQuestionTypes) || typeof this.#adapter.prepare !== 'function' || typeof this.#adapter.decode !== 'function') {
      throw new ConfigurationError('adapter must implement the SystemOneAdapter interface.');
    }
    const baseURL = options.baseURL ?? this.#adapter.defaultBaseURL;
    if (baseURL === undefined) throw new ConfigurationError('This adapter requires baseURL.');
    this.baseURL = parseBaseURL(baseURL).toString().replace(/\/+$/, '');
    this.model = options.model ?? this.#adapter.defaultModel ?? '';
    if (typeof this.model !== 'string' || this.model.trim().length === 0) throw new ConfigurationError('This adapter requires a nonempty model ID.');
    this.adapterId = this.#adapter.id;
    this.#options = { ...options };
    this.#headers = snapshotHeaders(options.headers);
    this.#timeoutMs = configInteger(options.timeoutMs ?? 10_000, 'timeoutMs', 1);
    this.#maxRetries = configInteger(options.maxRetries ?? 2, 'maxRetries', 0, 100);
    this.#retryDelayMs = configInteger(options.retryDelayMs ?? 200, 'retryDelayMs', 0);
    this.#maxRetryDelayMs = configInteger(options.maxRetryDelayMs ?? 2_000, 'maxRetryDelayMs', 0);
    this.#maxResponseBytes = configInteger(options.maxResponseBytes ?? 8 * 1024 * 1024, 'maxResponseBytes', 1);
    if (!options.transport || typeof options.transport.send !== 'function') throw new ConfigurationError('Provide a transport implementing send.');
  }

  async evaluate<const Q extends Questions>(request: EvaluateRequest<Q>, options: RequestOptions = {}): Promise<EvaluationResult<Q>> {
    const start = Date.now();
    const snapshot = snapshotRequest(request);
    for (const question of Object.values(snapshot.questions)) {
      if (!this.#adapter.supportedQuestionTypes.includes(question.type)) throw new UnsupportedFeatureError(`Adapter ${this.adapterId} does not support ${question.type} questions.`);
    }
    const timeoutMs = configInteger(options.timeoutMs ?? this.#timeoutMs, 'timeoutMs', 1);
    const maxRetries = configInteger(options.maxRetries ?? this.#maxRetries, 'maxRetries', 0, 100);
    const requestHeaders = snapshotHeaders(options.headers);
    const context: AdapterContext = { baseURL: this.baseURL, model: snapshot.model ?? this.model, request: snapshot };
    const prepared = this.#adapter.prepare(context);
    const url = checkRequestURL(prepared.url, this.baseURL);
    assertJson(prepared.body, 'adapter.request.body');
    const body = JSON.stringify(prepared.body);
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) throw new TimeoutError();
    if (options.signal?.aborted) throw new RequestAbortedError();
    const response = await this.#options.transport.send({
      baseURL: this.baseURL, url, body, apiKey: this.#options.apiKey,
      ...(prepared.headers === undefined ? {} : { headers: prepared.headers }),
      ...(this.#adapter.authenticate === undefined ? {} : { authenticate: this.#adapter.authenticate.bind(this.#adapter) }),
    }, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeoutMs: remaining, maxRetries, retryDelayMs: this.#retryDelayMs,
      maxRetryDelayMs: this.#maxRetryDelayMs, maxResponseBytes: this.#maxResponseBytes,
      headers: [this.#headers, requestHeaders],
    });
    const checkDeadline = () => {
      if (options.signal?.aborted) throw new RequestAbortedError();
      if (Date.now() - start >= timeoutMs) throw new TimeoutError();
    };
    checkDeadline();
    let decoded: unknown;
    try { decoded = this.#adapter.decode(response.payload, context); }
    catch (error) {
      checkDeadline();
      if (error instanceof SystemOneError) throw error;
      throw new ResponseValidationError('response', 'adapter could not decode the response');
    }
    const validated = validateResponse(decoded, snapshot.questions, context.model);
    checkDeadline();
    return {
      ...validated,
      response: {
        ...(response.requestId === undefined ? {} : { requestId: response.requestId }),
        status: response.status, attempts: response.attempts, durationMs: Date.now() - start, adapter: this.adapterId,
      },
    };
  }
}

export function createSystemOne(options: SystemOneOptions): SystemOne { return new SystemOne(options); }
