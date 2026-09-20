import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { ConfigurationError, RequestAbortedError, ResponseValidationError, TimeoutError, UnsupportedFeatureError } from '@system-one-ai/core';
import type { Answer, JsonValue, ProviderResponse, QuestionType } from '@system-one-ai/core';
import type { LocalEvaluationRequest, LocalRunnerOptions, NativeModelDriver, NativeModelRunner } from '@system-one-ai/adapter-local';
import { layaAnswer, layaSoftmax, parseLayaManifest, prepareLayaRow } from '@system-one-ai/model-laya';
import type { LayaManifest, LayaRow, LayaTokenizer } from '@system-one-ai/model-laya';

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

export interface LayaOnnxProgress {
  readonly status: 'manifest' | 'tokenizer' | 'model' | 'ready';
  readonly file: string;
}

export interface LayaOnnxModelOptions {
  readonly manifestPath: string;
  readonly batchSize?: number;
  readonly tokenizer?: LayaTokenizer;
  readonly onProgress?: (progress: LayaOnnxProgress) => void;
  /** Inject the Transformers.js module for bundlers/tests. */
  readonly transformers?: unknown;
}

interface TransformersModule {
  readonly PreTrainedTokenizer?: new (data: unknown, config: unknown) => LayaTokenizer;
}

async function loadJSON(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, 'utf8')) as unknown; }
  catch { throw new ConfigurationError(`Unable to read Laya asset: ${path.basename(file)}.`); }
}

async function transformers(value: unknown): Promise<TransformersModule> {
  if (value !== undefined) return value as TransformersModule;
  try {
    const load = Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
    return await load('@huggingface/transformers') as TransformersModule;
  } catch {
    throw new ConfigurationError('Install @huggingface/transformers to load a Laya tokenizer, or inject tokenizer.');
  }
}

async function layaTokenizer(options: LayaOnnxModelOptions, manifest: LayaManifest, base: string): Promise<LayaTokenizer> {
  if (options.tokenizer) return options.tokenizer;
  const directory = path.resolve(base, manifest.tokenizer);
  options.onProgress?.({ status: 'tokenizer', file: directory });
  const [data, config, module] = await Promise.all([
    loadJSON(path.join(directory, 'tokenizer.json')),
    loadJSON(path.join(directory, 'tokenizer_config.json')),
    transformers(options.transformers),
  ]);
  if (typeof module.PreTrainedTokenizer !== 'function') throw new ConfigurationError('Transformers.js does not export PreTrainedTokenizer.');
  return new module.PreTrainedTokenizer(data, config);
}

function feedsFor(rows: readonly LayaRow[], manifest: LayaManifest, runtime: OnnxRuntime): Record<string, OnnxTensor> {
  const batch = rows.length;
  const length = Math.max(...rows.map(row => row.ids.length));
  const count = Math.max(2, ...rows.map(row => row.markers.length));
  const ids = new BigInt64Array(batch * length).fill(BigInt(manifest.tokenIds.pad));
  const attention = new BigInt64Array(batch * length);
  const positions = new BigInt64Array(batch * count);
  const mask = new Uint8Array(batch * count);
  const types = new BigInt64Array(batch);
  rows.forEach((row, index) => {
    row.ids.forEach((id, column) => { ids[index * length + column] = BigInt(id); attention[index * length + column] = 1n; });
    row.markers.forEach((position, column) => { positions[index * count + column] = BigInt(position); mask[index * count + column] = 1; });
    types[index] = BigInt(row.qtype);
  });
  return {
    input_ids: new runtime.Tensor('int64', ids, [batch, length]),
    attention_mask: new runtime.Tensor('int64', attention, [batch, length]),
    marker_pos: new runtime.Tensor('int64', positions, [batch, count]),
    marker_mask: new runtime.Tensor('bool', mask, [batch, count]),
    qtype: new runtime.Tensor('int64', types, [batch]),
  };
}

function matrix(tensor: OnnxTensor | undefined, rows: number, columns: number, name: string): number[] {
  if (!tensor || tensor.type !== 'float32' || tensor.dims.length !== 2 || tensor.dims[0] !== rows || tensor.dims[1] !== columns || tensor.data.length !== rows * columns) {
    throw new ResponseValidationError(name, 'Laya ONNX returned an unexpected tensor type or shape.');
  }
  const values = Array.from(tensor.data);
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new ResponseValidationError(name, 'Laya ONNX returned non-finite values.');
  return values as number[];
}

const layaInputs = ['input_ids', 'attention_mask', 'marker_pos', 'marker_mask', 'qtype'];

/** Model plugin for a complete Laya export produced by scripts/laya/export.py. */
export function createLayaOnnxModel(options: LayaOnnxModelOptions): OnnxModelPlugin {
  if (!options?.manifestPath || typeof options.manifestPath !== 'string') throw new ConfigurationError('manifestPath must be a nonempty file path.');
  const batchSize = positiveInteger(options.batchSize, 'batchSize', 4);
  if (batchSize > 64) throw new ConfigurationError('batchSize must be at most 64.');
  return Object.freeze({
    id: 'laya',
    async load(context: OnnxModelLoadContext): Promise<LoadedOnnxModel> {
      const manifestPath = path.resolve(options.manifestPath);
      options.onProgress?.({ status: 'manifest', file: manifestPath });
      const manifest = parseLayaManifest(await loadJSON(manifestPath));
      const base = path.dirname(manifestPath);
      const tokenizer = await layaTokenizer(options, manifest, base);
      if (typeof tokenizer?.encode !== 'function') throw new ConfigurationError('tokenizer must provide encode().');
      const marker = await Promise.resolve(tokenizer.encode(manifest.maskToken, { add_special_tokens: false }));
      if (marker.length !== 1 || marker[0] !== manifest.tokenIds.mask) throw new ConfigurationError('Tokenizer mask token does not match the exported Laya model.');
      if (manifest.externalData?.some(item => item.path !== item.data)) {
        throw new ConfigurationError('Native Laya ONNX requires external data at the relative paths embedded in the graph.');
      }
      const modelPath = path.resolve(base, manifest.modelFile);
      options.onProgress?.({ status: 'model', file: modelPath });
      return {
        id: 'laya',
        defaultModel: manifest.model,
        supportedQuestionTypes: ['choice', 'score', 'boolean'],
        modelPath,
        validateSession(session): void {
          if (session.inputNames.length !== layaInputs.length || layaInputs.some(name => !session.inputNames.includes(name)) || !session.outputNames.includes('logits') || !session.outputNames.includes('act_logits')) {
            throw new ConfigurationError('The ONNX graph must contain the complete Laya decision model, including qtype and both heads.');
          }
          options.onProgress?.({ status: 'ready', file: modelPath });
        },
        async evaluate(session, request, runnerOptions): Promise<ProviderResponse> {
          if (request.model !== manifest.model) throw new ConfigurationError('The requested model differs from the loaded Laya checkpoint. Create another client to load a different model.');
          if (request.providerOptions && Object.keys(request.providerOptions).length) throw new UnsupportedFeatureError('Laya ONNX does not accept providerOptions. Export model settings into laya.json.');
          const answers: Record<string, Answer> = Object.create(null) as Record<string, Answer>;
          const actProbabilities: Record<string, number> = Object.create(null) as Record<string, number>;
          const warnings: JsonValue[] = [];
          let inputTokens = 0;
          const entries = Object.entries(request.questions);
          for (let start = 0; start < entries.length; start += batchSize) {
            if (runnerOptions.signal?.aborted) throw new RequestAbortedError();
            const rows: LayaRow[] = [];
            for (const [id, question] of entries.slice(start, start + batchSize)) rows.push(await prepareLayaRow(id, request.state, question, tokenizer, manifest));
            if (runnerOptions.signal?.aborted) throw new RequestAbortedError();
            const feeds = feedsFor(rows, manifest, context.runtime);
            const output = await session.run(feeds);
            if (runnerOptions.signal?.aborted) throw new RequestAbortedError();
            const count = feeds.marker_pos!.dims[1]!;
            const logits = matrix(output.logits, rows.length, count, 'logits');
            const acts = matrix(output.act_logits, rows.length, 2, 'act_logits');
            rows.forEach((row, index) => {
              answers[row.id] = layaAnswer(row, logits.slice(index * count, index * count + row.markers.length), manifest);
              actProbabilities[row.id] = layaSoftmax(acts.slice(index * 2, index * 2 + 2))[0]!;
              warnings.push(...row.warnings);
              inputTokens += row.ids.length;
            });
          }
          return {
            model: manifest.model,
            answers,
            warnings,
            usage: { inputTokens, outputTokens: 0 },
            providerMetadata: {
              runtime: 'onnxruntime-node',
              device: context.device,
              revision: manifest.revision,
              actProbabilities,
            },
          };
        },
      };
    },
  });
}

export type { LayaManifest, LayaRow, LayaTokenizer } from '@system-one-ai/model-laya';
