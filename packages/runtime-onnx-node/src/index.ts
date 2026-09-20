import { ConfigurationError, RequestAbortedError, TimeoutError } from '@system-one-ai/core';
import type { ProviderResponse, QuestionType } from '@system-one-ai/core';
import type { LocalEvaluationRequest, LocalRunnerOptions, NativeModelDriver, NativeModelRunner } from '@system-one-ai/adapter-local';

export type OnnxNodeDevice = 'auto' | 'cpu' | 'coreml';
export type ResolvedOnnxNodeDevice = 'cpu' | 'coreml' | 'custom';

export interface OnnxTensor {
  readonly type: string;
  readonly dims: readonly number[];
  readonly data: ArrayLike<number | bigint | string>;
}

export interface OnnxSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, OnnxTensor>): Promise<Record<string, OnnxTensor>>;
  release?(): void | Promise<void>;
}

export interface OnnxRuntime {
  readonly Tensor: new (type: string, data: BigInt64Array | Uint8Array | Float32Array | readonly number[], dims: readonly number[]) => OnnxTensor;
  readonly InferenceSession: {
    create(modelPath: string, options?: Record<string, unknown>): Promise<OnnxSession>;
  };
}

export interface OnnxModelLoadContext {
  readonly runtime: OnnxRuntime;
  readonly device: ResolvedOnnxNodeDevice;
  readonly executionProviders: readonly unknown[];
}

export interface LoadedOnnxModel {
  readonly id?: string;
  readonly defaultModel: string;
  readonly supportedQuestionTypes?: readonly QuestionType[];
  readonly modelPath: string;
  readonly sessionOptions?: Readonly<Record<string, unknown>>;
  validateSession?(session: OnnxSession): void;
  evaluate(session: OnnxSession, request: LocalEvaluationRequest, options: LocalRunnerOptions): Promise<ProviderResponse>;
  dispose?(): void | Promise<void>;
}

/** A model-family plugin that maps System One requests to an ONNX graph. */
export interface OnnxModelPlugin {
  readonly id: string;
  load(context: OnnxModelLoadContext): Promise<LoadedOnnxModel>;
}

export interface OnnxDriverOptions {
  readonly model: OnnxModelPlugin;
  /** Portable default is CPU. CoreML is opt-in because provider availability is build/platform dependent. */
  readonly device?: OnnxNodeDevice;
  /** Advanced override passed directly to ONNX Runtime. Mutually exclusive with a non-auto device. */
  readonly executionProviders?: readonly unknown[];
  readonly sessionOptions?: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
  /** Runtime injection for custom builds and tests. Defaults to the onnxruntime-node peer package. */
  readonly runtime?: OnnxRuntime;
}

async function defaultRuntime(): Promise<OnnxRuntime> {
  try {
    const load = Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
    return assertRuntime(await load('onnxruntime-node'));
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError('Install onnxruntime-node to use @system-one-ai/runtime-onnx-node, or inject a compatible runtime.');
  }
}

function assertRuntime(value: unknown): OnnxRuntime {
  const runtime = value as Partial<OnnxRuntime> | null;
  if (!runtime || typeof runtime.Tensor !== 'function' || typeof runtime.InferenceSession?.create !== 'function') {
    throw new ConfigurationError('runtime must provide ONNX Runtime Tensor and InferenceSession.create().');
  }
  return runtime as OnnxRuntime;
}

function providers(options: OnnxDriverOptions): { device: ResolvedOnnxNodeDevice; executionProviders: readonly unknown[] } {
  const device = options.device ?? 'auto';
  if (device !== 'auto' && device !== 'cpu' && device !== 'coreml') throw new ConfigurationError('device must be auto, cpu, or coreml.');
  if (options.executionProviders !== undefined) {
    if (!Array.isArray(options.executionProviders) || options.executionProviders.length === 0) throw new ConfigurationError('executionProviders must be a nonempty array.');
    if (device !== 'auto') throw new ConfigurationError('executionProviders cannot be combined with an explicit device.');
    return { device: 'custom', executionProviders: options.executionProviders };
  }
  if (device === 'coreml') {
    if (process.platform !== 'darwin') throw new ConfigurationError('CoreML is only available on macOS.');
    return { device, executionProviders: [{ name: 'coreml' }, 'cpu'] };
  }
  return { device: 'cpu', executionProviders: ['cpu'] };
}

function positiveInteger(value: number | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new ConfigurationError(`${name} must be a positive integer.`);
  return value;
}

function cancellation(signal: AbortSignal | undefined, timeoutMs: number): {
  readonly signal: AbortSignal;
  readonly done: () => void;
  readonly error: () => Error;
} {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  return {
    signal: controller.signal,
    error: () => timedOut ? new TimeoutError() : new RequestAbortedError(),
    done: () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); },
  };
}

function abortable<T>(work: Promise<T>, signal: AbortSignal, error: () => Error): Promise<T> {
  if (signal.aborted) return Promise.reject(error());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(error());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Create a NativeModelDriver backed by one in-process ONNX Runtime session. */
export function createOnnxDriver(options: OnnxDriverOptions): NativeModelDriver {
  if (!options?.model || typeof options.model.id !== 'string' || options.model.id.trim() === '' || typeof options.model.load !== 'function') {
    throw new ConfigurationError('model must provide a nonempty id and load().');
  }
  const timeoutMs = positiveInteger(options.timeoutMs, 'timeoutMs', 120_000);
  return Object.freeze({
    id: `onnx-${options.model.id}`,
    defaultTimeoutMs: timeoutMs,
    async createRunner(): Promise<NativeModelRunner> {
      const runtime = options.runtime === undefined ? await defaultRuntime() : assertRuntime(options.runtime);
      const selected = providers(options);
      const loaded = await options.model.load({ runtime, ...selected });
      if (!loaded || typeof loaded.defaultModel !== 'string' || !loaded.defaultModel.trim() || typeof loaded.modelPath !== 'string' || !loaded.modelPath.trim() || typeof loaded.evaluate !== 'function') {
        await loaded?.dispose?.();
        throw new ConfigurationError('ONNX model plugin returned an invalid loaded model.');
      }
      let session: OnnxSession | undefined;
      try {
        session = await runtime.InferenceSession.create(loaded.modelPath, {
          ...loaded.sessionOptions,
          ...options.sessionOptions,
          executionProviders: selected.executionProviders,
        });
        loaded.validateSession?.(session);
      } catch (error) {
        try { await session?.release?.(); }
        finally { await loaded.dispose?.(); }
        throw error;
      }
      const activeSession = session;
      let disposed = false;
      let tail: Promise<void> = Promise.resolve();
      let disposal: Promise<void> | undefined;
      const runner: NativeModelRunner = {
        id: `onnx-${loaded.id ?? options.model.id}`,
        defaultModel: loaded.defaultModel,
        ...(loaded.supportedQuestionTypes === undefined ? {} : { supportedQuestionTypes: loaded.supportedQuestionTypes }),
        evaluate(request, runnerOptions): Promise<ProviderResponse> {
          const control = cancellation(runnerOptions.signal, runnerOptions.timeoutMs);
          const work = tail.then(async () => {
            if (control.signal.aborted) throw control.error();
            if (disposed) throw new ConfigurationError('This ONNX runner has been disposed.');
            return loaded.evaluate(activeSession, request, { signal: control.signal, timeoutMs: runnerOptions.timeoutMs });
          });
          tail = work.then(() => {}, () => {});
          return abortable(work, control.signal, control.error).finally(control.done);
        },
        dispose(): Promise<void> {
          disposed = true;
          disposal ??= tail.then(async () => {
            try { await loaded.dispose?.(); }
            finally { await activeSession.release?.(); }
          });
          return disposal;
        },
      };
      return runner;
    },
  });
}
