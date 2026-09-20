import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { ConfigurationError, RequestAbortedError, ResponseValidationError, UnsupportedFeatureError } from '@system-one-ai/core';
import type { Answer, JsonValue, ProviderResponse } from '@system-one-ai/core';
import type { LoadedOnnxModel, OnnxModelLoadContext, OnnxModelPlugin, OnnxRuntime, OnnxTensor } from '@system-one-ai/runtime-onnx-node';
import { layaAnswer, layaSoftmax, parseLayaManifest, prepareLayaRow } from './index.js';
import type { LayaManifest, LayaRow, LayaTokenizer } from './index.js';

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

function positiveInteger(value: number | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new ConfigurationError(`${name} must be a positive integer.`);
  return value;
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

export type { LayaManifest, LayaRow, LayaTokenizer } from './index.js';
