import { ConfigurationError, RequestAbortedError, ResponseValidationError, TimeoutError, UnsupportedFeatureError } from '@system-one-ai/core';
import type { Answer, Fetch, JsonValue, ProviderResponse } from '@system-one-ai/core';
import { createBrowserClient, createBrowserRunner, type BrowserClient, type BrowserInferenceDevice, type BrowserModelDriver, type BrowserModelRunner } from '@system-one-ai/adapter-webgpu';
import { layaAnswer, layaSoftmax, parseLayaManifest, prepareLayaRow, type LayaManifest, type LayaRow, type LayaTokenizer } from './index.js';

export type { LayaManifest, LayaTokenizer } from './index.js';

export interface LayaProgress {
  readonly status: 'manifest' | 'tokenizer' | 'model' | 'ready';
  readonly file: string;
}

export interface LayaWebGPUOptions {
  /** URL of laya.json produced by scripts/laya/export.py, not a safetensors/GGUF URL. */
  readonly manifestUrl: string;
  /** Questions per forward pass. Defaults to 4 to bound browser activation memory. */
  readonly batchSize?: number;
  readonly timeoutMs?: number;
  /** Cancel initialization; a session completing after cancellation is released. */
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LayaProgress) => void;
  /** Optional bundled onnxruntime-web/webgpu namespace, validated at runtime. */
  readonly ort?: unknown;
  /** Optional bundled tokenizer. Must use the tokenizer shipped with this export. */
  readonly tokenizer?: LayaTokenizer;
  /** Fetch for manifest/tokenizer assets. ONNX Runtime owns model asset downloads. */
  readonly fetch?: Fetch;
}

export type LayaInferenceDevice = BrowserInferenceDevice;

export interface LayaBrowserOptions extends LayaWebGPUOptions {
  /** Prefer WebGPU when available, or force WebGPU/WASM explicitly. Defaults to auto. */
  readonly device?: LayaInferenceDevice;
}

interface Tensor {
  readonly type: string;
  readonly dims: readonly number[];
  readonly data: ArrayLike<number | bigint | string>;
  dispose?(): void;
}
interface Session {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  release(): Promise<void>;
}
interface Ort {
  readonly Tensor: new (type: 'int64' | 'bool', data: BigInt64Array | Uint8Array, dims: readonly number[]) => Tensor;
  readonly InferenceSession: { create(model: string, options: Record<string, unknown>): Promise<Session> };
}

// Remote modules load only when this constructor is called. Inject ort/tokenizer
// for an offline build or a CSP that forbids third-party modules.
const ortUrl = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs';
const tokenizerUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
const inputs = ['input_ids', 'attention_mask', 'marker_pos', 'marker_mask', 'qtype'];

async function loadModule(url: string): Promise<unknown> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ url);
}

function aborted(signal: AbortSignal | undefined): void { if (signal?.aborted) throw new RequestAbortedError(); }

function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined, error: () => Error = () => new RequestAbortedError()): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(error());
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function absoluteUrl(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ConfigurationError('manifestUrl must be a nonempty URL.');
  try {
    const url = new URL(value, typeof location === 'undefined' ? undefined : location.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    return url.href;
  } catch { throw new ConfigurationError('manifestUrl must be an HTTP(S) URL, or a relative URL in a browser.'); }
}

async function assertGPU(signal?: AbortSignal): Promise<void> {
  aborted(signal);
  const gpu = (globalThis.navigator as Navigator & { readonly gpu?: { requestAdapter(): Promise<unknown> } } | undefined)?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') throw new ConfigurationError('Laya requires WebGPU in a secure browser context (HTTPS or localhost).');
  if (!await abortable(gpu.requestAdapter(), signal)) throw new ConfigurationError('No WebGPU adapter is available.');
}

async function hasGPU(signal?: AbortSignal): Promise<boolean> {
  aborted(signal);
  const gpu = (globalThis.navigator as Navigator & { readonly gpu?: { requestAdapter(): Promise<unknown> } } | undefined)?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return false;
  try { return Boolean(await abortable(gpu.requestAdapter(), signal)); }
  catch (error) {
    if (signal?.aborted) throw new RequestAbortedError();
    return false;
  }
}

async function loadJSON(url: string, fetcher: Fetch, signal?: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, signal === undefined ? {} : { signal });
  if (!response.ok) throw new ConfigurationError(`Laya asset request failed with HTTP ${response.status}. Check the exported model directory and CORS settings.`);
  return response.json();
}

function runtime(value: unknown): Ort {
  const module = value as Partial<Ort> | null;
  if (!module || typeof module.Tensor !== 'function' || typeof module.InferenceSession?.create !== 'function') throw new ConfigurationError('ort must be the onnxruntime-web/webgpu module.');
  return module as Ort;
}

async function loadTokenizer(options: LayaWebGPUOptions, manifest: LayaManifest, base: string, fetcher: Fetch): Promise<LayaTokenizer> {
  if (options.tokenizer) return options.tokenizer;
  const directory = new URL(`${manifest.tokenizer.replace(/\/$/, '')}/`, base).href;
  options.onProgress?.({ status: 'tokenizer', file: directory });
  const [data, config, module] = await Promise.all([
    loadJSON(new URL('tokenizer.json', directory).href, fetcher, options.signal),
    loadJSON(new URL('tokenizer_config.json', directory).href, fetcher, options.signal),
    loadModule(tokenizerUrl),
  ]);
  const constructor = (module as { PreTrainedTokenizer?: new (data: unknown, config: unknown) => LayaTokenizer }).PreTrainedTokenizer;
  if (typeof constructor !== 'function') throw new ConfigurationError('Tokenizer module did not export PreTrainedTokenizer.');
  return new constructor(data, config);
}

function feedsFor(rows: readonly LayaRow[], manifest: LayaManifest, ort: Ort): Record<string, Tensor> {
  const batch = rows.length;
  const length = Math.max(...rows.map(row => row.ids.length));
  // The upstream act head uses topk(2), including for a singleton choice.
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
  const result: Record<string, Tensor> = {};
  try {
    result.input_ids = new ort.Tensor('int64', ids, [batch, length]);
    result.attention_mask = new ort.Tensor('int64', attention, [batch, length]);
    result.marker_pos = new ort.Tensor('int64', positions, [batch, count]);
    result.marker_mask = new ort.Tensor('bool', mask, [batch, count]);
    result.qtype = new ort.Tensor('int64', types, [batch]);
    return result;
  } catch (error) { disposeTensors(result); throw error; }
}

function disposeTensors(tensors: Record<string, Tensor>): void {
  for (const tensor of new Set(Object.values(tensors))) tensor.dispose?.();
}

function matrix(tensor: Tensor | undefined, rows: number, columns: number, name: string): number[] {
  if (!tensor || tensor.type !== 'float32' || tensor.dims.length !== 2 || tensor.dims[0] !== rows || tensor.dims[1] !== columns || tensor.data.length !== rows * columns) throw new ResponseValidationError(name, 'Laya ONNX returned an unexpected tensor type or shape.');
  const values = Array.from(tensor.data);
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new ResponseValidationError(name, 'Laya ONNX returned non-finite values.');
  return values as number[];
}

export interface LayaBrowserRunner extends BrowserModelRunner { dispose(): Promise<void> }
export type LayaBrowserClient = BrowserClient;
export type LayaWebGPURunner = LayaBrowserRunner;
export type LayaWebGPUClient = LayaBrowserClient;

function createRunner(session: Session, ort: Ort, tokenizer: LayaTokenizer, manifest: LayaManifest, batchSize: number, device: Exclude<LayaInferenceDevice, 'auto'>): LayaBrowserRunner {
  let tail: Promise<void> = Promise.resolve();
  let disposed = false;
  let disposal: Promise<void> | undefined;
  return {
    id: `laya-${device}`, defaultModel: manifest.model, supportedQuestionTypes: ['choice', 'score', 'boolean'],
    evaluate(request, options): Promise<ProviderResponse> {
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = (): void => controller.abort();
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs);
      const cancellation = (): Error => timedOut ? new TimeoutError() : new RequestAbortedError();
      const check = (): void => {
        if (controller.signal.aborted) throw cancellation();
        if (disposed) throw new ConfigurationError('This Laya runner has been disposed.');
      };
      const work = tail.then(async (): Promise<ProviderResponse> => {
        check();
        if (request.model !== manifest.model) throw new ConfigurationError('The requested model differs from the loaded Laya checkpoint. Create another client to load a different model.');
        if (request.providerOptions && Object.keys(request.providerOptions).length) throw new UnsupportedFeatureError('Laya browser inference does not accept providerOptions. Export model settings into laya.json.');
        const answers: Record<string, Answer> = Object.create(null) as Record<string, Answer>;
        const actProbabilities: Record<string, number> = Object.create(null) as Record<string, number>;
        const warnings: JsonValue[] = [];
        let inputTokens = 0;
        const entries = Object.entries(request.questions);
        for (let start = 0; start < entries.length; start += batchSize) {
          check();
          const rows: LayaRow[] = [];
          for (const [id, question] of entries.slice(start, start + batchSize)) {
            check();
            rows.push(await prepareLayaRow(id, request.state, question, tokenizer, manifest));
          }
          check();
          const feeds = feedsFor(rows, manifest, ort);
          let output: Record<string, Tensor> = {};
          try {
            // ORT cannot interrupt an already submitted inference run. Keep the serial
            // queue locked until it settles, even if the caller cancels earlier.
            output = await session.run(feeds);
            check();
            const count = feeds.marker_pos!.dims[1]!;
            const logits = matrix(output.logits, rows.length, count, 'logits');
            const acts = matrix(output.act_logits, rows.length, 2, 'act_logits');
            rows.forEach((row, index) => {
              answers[row.id] = layaAnswer(row, logits.slice(index * count, index * count + row.markers.length), manifest);
              actProbabilities[row.id] = layaSoftmax(acts.slice(index * 2, index * 2 + 2))[0]!;
              warnings.push(...row.warnings);
              inputTokens += row.ids.length;
            });
          } finally { disposeTensors(output); disposeTensors(feeds); }
        }
        return { model: manifest.model, answers, warnings, usage: { inputTokens, outputTokens: 0 }, providerMetadata: { runtime: 'onnxruntime-web', device, revision: manifest.revision, actProbabilities } };
      });
      tail = work.then(() => {}, () => {});
      return abortable(work, controller.signal, cancellation).finally(() => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      });
    },
    dispose(): Promise<void> {
      disposed = true;
      disposal ??= tail.then(() => session.release());
      return disposal;
    },
  };
}

async function createLayaBrowserRunnerForDevice(options: LayaBrowserOptions, requestedDevice: LayaInferenceDevice): Promise<LayaBrowserRunner> {
  const manifestUrl = absoluteUrl(options?.manifestUrl);
  const batchSize = options.batchSize ?? 4;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 64) throw new ConfigurationError('batchSize must be an integer from 1 to 64.');
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)) throw new ConfigurationError('timeoutMs must be a positive integer.');
  let device: Exclude<LayaInferenceDevice, 'auto'>;
  if (requestedDevice === 'webgpu') {
    await assertGPU(options.signal);
    device = 'webgpu';
  } else if (requestedDevice === 'wasm') device = 'wasm';
  else device = await hasGPU(options.signal) ? 'webgpu' : 'wasm';
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new ConfigurationError('Fetch is required to load Laya assets.');
  options.onProgress?.({ status: 'manifest', file: manifestUrl });
  const manifest = parseLayaManifest(await abortable(loadJSON(manifestUrl, fetcher, options.signal), options.signal));
  const [tokenizer, ort] = await abortable(Promise.all([
    loadTokenizer(options, manifest, manifestUrl, fetcher),
    options.ort === undefined ? loadModule(ortUrl).then(runtime) : Promise.resolve(runtime(options.ort)),
  ]), options.signal);
  if (typeof tokenizer?.encode !== 'function') throw new ConfigurationError('tokenizer must provide encode().');
  const marker = await abortable(Promise.resolve(tokenizer.encode(manifest.maskToken, { add_special_tokens: false })), options.signal);
  if (marker.length !== 1 || marker[0] !== manifest.tokenIds.mask) throw new ConfigurationError('Tokenizer mask token does not match the exported Laya model.');
  const modelUrl = new URL(manifest.modelFile, manifestUrl).href;
  options.onProgress?.({ status: 'model', file: modelUrl });
  aborted(options.signal);
  const pending = ort.InferenceSession.create(modelUrl, {
    executionProviders: requestedDevice === 'auto' && device === 'webgpu' ? ['webgpu', 'wasm'] : [device],
    ...(manifest.externalData === undefined ? {} : { externalData: manifest.externalData.map(item => ({ path: item.path, data: new URL(item.data, manifestUrl).href })) }),
  });
  // Initialization cancellation cannot stop ORT's fetch/compiler. Attach cleanup
  // to the original promise, including the race between resolution and abort.
  let session: Session;
  try {
    session = await abortable(pending, options.signal);
    aborted(options.signal);
  } catch (error) {
    void pending.then(lateSession => lateSession.release()).catch(() => {});
    throw error;
  }
  try {
    aborted(options.signal);
    if (session.inputNames.length !== inputs.length || inputs.some(name => !session.inputNames.includes(name)) || !session.outputNames.includes('logits') || !session.outputNames.includes('act_logits')) throw new ConfigurationError('The ONNX graph must contain the complete Laya decision model, including qtype and both heads.');
    const runner = createRunner(session, ort, tokenizer, manifest, batchSize, device);
    options.onProgress?.({ status: 'ready', file: modelUrl });
    aborted(options.signal);
    return runner;
  } catch (error) { await session.release(); throw error; }
}

/** Optional Laya driver for the model-agnostic browser runtime. */
export function createLayaDriver(options: LayaWebGPUOptions): BrowserModelDriver {
  return Object.freeze({
    id: 'laya-onnx',
    defaultTimeoutMs: options.timeoutMs ?? 120_000,
    createRunner: ({ device }: { readonly device: BrowserInferenceDevice }) => createLayaBrowserRunnerForDevice(options, device),
  });
}

/** @deprecated Prefer createBrowserRunner({ driver: createLayaDriver(...) }). */
export async function createLayaBrowserRunner(options: LayaBrowserOptions): Promise<LayaBrowserRunner> {
  const device = options?.device ?? 'auto';
  return createBrowserRunner({ driver: createLayaDriver(options), device }) as Promise<LayaBrowserRunner>;
}

/** @deprecated Prefer createBrowserRunner({ driver: createLayaDriver(...), device: 'webgpu' }). */
export async function createLayaWebGPURunner(options: LayaWebGPUOptions): Promise<LayaWebGPURunner> {
  return createBrowserRunner({ driver: createLayaDriver(options), device: 'webgpu' }) as Promise<LayaWebGPURunner>;
}

/** @deprecated Prefer createBrowserClient({ driver: createLayaDriver(...) }). */
export async function createLayaBrowserClient(options: LayaBrowserOptions): Promise<LayaBrowserClient> {
  return createBrowserClient({ driver: createLayaDriver(options), device: options.device ?? 'auto', ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
}

/** @deprecated Prefer createBrowserClient({ driver: createLayaDriver(...), device: 'webgpu' }). */
export async function createLayaWebGPUClient(options: LayaWebGPUOptions): Promise<LayaWebGPUClient> {
  return createBrowserClient({ driver: createLayaDriver(options), device: 'webgpu', ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
}
