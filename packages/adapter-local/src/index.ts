import { ConfigurationError, ConnectionError, RequestAbortedError, SystemOne, SystemOneError, TimeoutError, createSystemOne } from '@system-one-ai/core';
import type {
  AdapterContext, ApiKey, EvaluateRequest, EvaluationClient, JsonObject, PreparedRequest,
  ProviderResponse, QuestionType, Questions, SystemOneAdapter, SystemOneOptions, Transport,
  TransportOptions,
} from '@system-one-ai/core';

export interface LocalRunnerOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

/** A model-specific weight loader and scorer. Keep Python, MLX, CUDA, or WASM code behind this boundary. */
export interface LocalModelRunner {
  readonly id: string;
  readonly defaultModel?: string;
  readonly supportedQuestionTypes?: readonly QuestionType[];
  evaluate(request: LocalEvaluationRequest, options: LocalRunnerOptions): Promise<ProviderResponse>;
}

export interface NativeModelRunner extends LocalModelRunner {
  dispose?(): Promise<void>;
}

/** Runtime-specific factory for a native in-process model runner. */
export interface NativeModelDriver {
  readonly id: string;
  readonly defaultTimeoutMs?: number;
  createRunner(): Promise<NativeModelRunner> | NativeModelRunner;
}

export interface NativeRunnerOptions {
  readonly driver: NativeModelDriver;
}

export interface NativeClientOptions extends NativeRunnerOptions {
  readonly timeoutMs?: number;
}

export type NativeClient = SystemOne & { dispose(): Promise<void> };

/** The normalized request every local backend receives, regardless of its weight format. */
export interface LocalEvaluationRequest extends EvaluateRequest {
  readonly model: string;
}

export interface LocalAdapterOptions {
  readonly runner: LocalModelRunner;
  readonly defaultBaseURL?: string;
}

export interface LocalClientOptions extends Omit<SystemOneOptions, 'adapter' | 'transport' | 'apiKey' | 'baseURL' | 'model'> {
  readonly apiKey?: ApiKey;
  readonly baseURL?: string;
  readonly model?: string;
}

const allQuestionTypes = Object.freeze(['choice', 'score', 'boolean'] as const);
const localBaseURL = 'http://local.system-one';

function assertRunner(runner: LocalModelRunner): void {
  if (!runner || typeof runner !== 'object' || typeof runner.id !== 'string' || runner.id.trim() === '' || typeof runner.evaluate !== 'function') {
    throw new ConfigurationError('runner must provide a nonempty id and an evaluate function.');
  }
  if (runner.defaultModel !== undefined && (typeof runner.defaultModel !== 'string' || runner.defaultModel.trim() === '')) {
    throw new ConfigurationError('runner.defaultModel must be a nonempty string.');
  }
  if (runner.supportedQuestionTypes !== undefined && (!Array.isArray(runner.supportedQuestionTypes) || runner.supportedQuestionTypes.some(type => !allQuestionTypes.includes(type)))) {
    throw new ConfigurationError('runner.supportedQuestionTypes contains an unsupported question type.');
  }
}

function assertDriver(driver: NativeModelDriver): void {
  if (!driver || typeof driver !== 'object' || typeof driver.id !== 'string' || driver.id.trim() === '' || typeof driver.createRunner !== 'function') {
    throw new ConfigurationError('driver must provide a nonempty id and createRunner().');
  }
  if (driver.defaultTimeoutMs !== undefined && (!Number.isSafeInteger(driver.defaultTimeoutMs) || driver.defaultTimeoutMs <= 0)) {
    throw new ConfigurationError('driver.defaultTimeoutMs must be a positive integer.');
  }
}

function runnerRequest(body: unknown): LocalEvaluationRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ConnectionError();
  const value = body as Record<string, unknown>;
  if (typeof value.model !== 'string' || value.model.trim() === '' || !('state' in value) || !value.questions || typeof value.questions !== 'object' || Array.isArray(value.questions)) {
    throw new ConnectionError();
  }
  return value as unknown as LocalEvaluationRequest;
}

function withDeadline<T>(work: Promise<T>, options: LocalRunnerOptions): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(new RequestAbortedError());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), options.timeoutMs);
  });
  const cancelled = options.signal === undefined ? undefined : new Promise<T>((_, reject) => {
    onAbort = () => reject(new RequestAbortedError());
    options.signal!.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race(cancelled === undefined ? [work, deadline] : [work, deadline, cancelled]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) options.signal?.removeEventListener('abort', onAbort);
  });
}

/**
 * Adapt any local weight runner to the normal SystemOneAdapter contract.
 * The URL is a placeholder; pair this adapter with createLocalTransport or createLocalClient.
 */
export function createLocalAdapter(options: LocalAdapterOptions): SystemOneAdapter {
  assertRunner(options.runner);
  const runner = options.runner;
  return Object.freeze({
    id: `local-${runner.id}`,
    defaultBaseURL: options.defaultBaseURL ?? localBaseURL,
    defaultModel: runner.defaultModel ?? runner.id,
    supportedQuestionTypes: runner.supportedQuestionTypes ?? allQuestionTypes,
    prepare({ baseURL, model, request }: AdapterContext): PreparedRequest {
      const url = new URL('/evaluate', baseURL);
      return {
        url: url.toString(),
        body: { model, state: request.state, questions: request.questions, ...(request.providerOptions === undefined ? {} : { providerOptions: request.providerOptions }) },
      };
    },
    decode(payload: unknown): ProviderResponse {
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new ConnectionError();
      return payload as ProviderResponse;
    },
  });
}

/** Execute a local runner through the core Transport boundary. */
export function createLocalTransport(runner: LocalModelRunner): Transport {
  assertRunner(runner);
  return {
    async send(request, options: TransportOptions) {
      const parsed = runnerRequest(JSON.parse(request.body) as unknown);
      const runnerOptions: LocalRunnerOptions = options.signal === undefined
        ? { timeoutMs: options.timeoutMs }
        : { signal: options.signal, timeoutMs: options.timeoutMs };
      // ponytail: one local attempt; retrying in-process inference only duplicates expensive work.
      let result: ProviderResponse;
      try {
        result = await withDeadline(runner.evaluate(parsed, runnerOptions), options);
      } catch (error) {
        if (error instanceof SystemOneError) throw error;
        throw new ConnectionError();
      }
      return { payload: result, status: 200, attempts: 1 };
    },
  };
}

/** Convenience constructor for the common local-weight case. */
export function createLocalClient(runner: LocalModelRunner, options: LocalClientOptions = {}): SystemOne {
  assertRunner(runner);
  const adapter = createLocalAdapter({ runner, ...(options.baseURL === undefined ? {} : { defaultBaseURL: options.baseURL }) });
  return createSystemOne({
    ...options,
    adapter,
    transport: createLocalTransport(runner),
    apiKey: options.apiKey ?? null,
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options.model === undefined ? {} : { model: options.model }),
  });
}

/** Create a native in-process runner from a runtime driver. */
export async function createNativeRunner(options: NativeRunnerOptions): Promise<NativeModelRunner> {
  assertDriver(options?.driver);
  const runner = await options.driver.createRunner();
  assertRunner(runner);
  return runner;
}

/** Create a disposable System One client backed by a native in-process runtime. */
export async function createNativeClient(options: NativeClientOptions): Promise<NativeClient> {
  const runner = await createNativeRunner(options);
  const timeoutMs = options.timeoutMs ?? options.driver.defaultTimeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    await runner.dispose?.();
    throw new ConfigurationError('timeoutMs must be a positive integer.');
  }
  try {
    const client = createLocalClient(runner, { timeoutMs });
    let disposal: Promise<void> | undefined;
    return Object.assign(client, { dispose: () => disposal ??= Promise.resolve(runner.dispose?.()).then(() => {}) });
  } catch (error) {
    await runner.dispose?.();
    throw error;
  }
}

export type { EvaluationClient, JsonObject, Questions };
