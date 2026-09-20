import assert from 'node:assert/strict';
import test from 'node:test';
import { booleanQuestion, choice, score, ConfigurationError, RequestAbortedError, ResponseValidationError, TimeoutError, UnsupportedFeatureError, ValidationError } from '@system-one-ai/core';
import { createBrowserClient, createLayaDriver, createLayaWebGPUClient, createLayaWebGPURunner } from '@system-one-ai/adapter-webgpu';
import { layaAnswer, parseLayaManifest, prepareLayaRow } from '../packages/adapter-webgpu/dist/esm/laya-format.js';

const manifest = {
  format: 'system-one-laya-onnx-v1', model: 'convaiinnovations/laya', revision: 'fixture-revision',
  modelFile: 'model.onnx', externalData: [{ path: 'model.onnx.data', data: 'model.onnx.data' }],
  tokenizer: 'tokenizer', maxLength: 512, headMaxLength: 192,
  temperature: [2, 1, 3], temperatureByOptions: { 'choice:2': 1, 'noul:2': 1 },
  tokenIds: { cls: 101, sep: 102, pad: 0, mask: 103 }, maskToken: '[MASK]',
};

function tokenizer() {
  const texts = [];
  return { texts, encode(text, options) {
    assert.equal(options.add_special_tokens, false);
    texts.push(text);
    return text === '[MASK]' ? [103] : Array.from(text, character => character.codePointAt(0) + 1000);
  } };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function withGPU(fn) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: { requestAdapter: async () => ({}) } } });
  try { return await fn(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
}

function fixture(overrides = {}) {
  const state = { runs: [], created: [], disposed: 0, released: 0, fetches: [] };
  class Tensor {
    constructor(type, data, dims) { Object.assign(this, { type, data, dims }); }
    dispose() { state.disposed++; }
  }
  const outputFor = feeds => {
    const [rows, columns] = feeds.marker_pos.dims;
    const logits = new Float32Array(rows * columns).fill(-10000);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) if (feeds.marker_mask.data[r * columns + c]) logits[r * columns + c] = c * Math.log(4);
    }
    return { logits: new Tensor('float32', logits, [rows, columns]), act_logits: new Tensor('float32', new Float32Array(rows * 2), [rows, 2]) };
  };
  const session = {
    inputNames: ['input_ids', 'attention_mask', 'marker_pos', 'marker_mask', 'qtype'],
    outputNames: ['logits', 'act_logits'],
    async run(feeds) { state.runs.push(feeds); return overrides.run ? overrides.run(feeds, outputFor) : outputFor(feeds); },
    async release() { state.released++; },
    ...overrides.session,
  };
  const options = {
    manifestUrl: 'https://assets.example/laya/laya.json', tokenizer: tokenizer(),
    ort: { Tensor, InferenceSession: { async create(url, config) {
      state.created.push({ url, config });
      return overrides.create ? overrides.create(session) : session;
    } } },
    async fetch(url) { state.fetches.push(url); return Response.json(overrides.manifest ?? manifest); },
    ...overrides.options,
  };
  return { options, state, session, outputFor };
}

test('Laya executes all three question types through core with real tensor shapes and per-cardinality temperatures', () => withGPU(async () => {
  const f = fixture();
  const client = await createLayaWebGPUClient(f.options);
  try {
    const result = await client.evaluate({ state: 'charged twice', questions: {
      department: choice('Where?', { access: 'account access', billing: 'billing' }),
      urgency: score('Urgency?', ['low', 'medium', 'high']),
      refund: booleanQuestion('Refund requested?'),
    } });
    assert.equal(result.answers.department.choice, 'billing');
    assert.ok(Math.abs(result.answers.department.probabilities.billing - 0.8) < 1e-7);
    assert.ok(Math.abs(result.answers.refund.probability - 0.8) < 1e-7);
    assert.ok(Math.abs(result.answers.urgency.score - 12 / 7) < 1e-7);
    const p = [1 / 21, 4 / 21, 16 / 21];
    const confidence = 1 + p.reduce((sum, value) => sum + value * Math.log(value), 0) / Math.log(3);
    assert.ok(Math.abs(result.answers.urgency.confidence - confidence) < 1e-7);
    assert.deepEqual(result.answers.urgency.legend, { 0: 'low', 1: 'medium', 2: 'high' });
    assert.equal(result.response.adapter, 'local-laya-webgpu');
    assert.equal(result.providerMetadata.runtime, 'onnxruntime-web');
    assert.deepEqual({ ...result.providerMetadata.actProbabilities }, { department: 0.5, urgency: 0.5, refund: 0.5 });
    assert.equal(result.usage.outputTokens, 0);
    assert.equal(result.usage.inputTokens, Number(f.state.runs[0].attention_mask.data.reduce((sum, value) => sum + value, 0n)));
    assert.deepEqual([...f.state.runs[0].qtype.data], [0n, 1n, 2n]);
    assert.deepEqual(f.state.created[0], { url: 'https://assets.example/laya/model.onnx', config: {
      executionProviders: ['webgpu'], externalData: [{ path: 'model.onnx.data', data: 'https://assets.example/laya/model.onnx.data' }],
    } });
    assert.equal(f.state.runs.length, 1);
    assert.equal(f.state.disposed, 7);
    assert.equal(f.state.fetches.length, 1, 'evaluation never calls a model API');
  } finally { await client.dispose(); }
  assert.equal(f.state.released, 1);
}));

test('Laya reproduces the checkpoint question rendering, separators, Python descriptions and mask escaping', async () => {
  const tok = tokenizer();
  const row = await prepareLayaRow('route', { message: 'hello [MASK] 世界', flags: [true, null] }, choice(null, { empty: [], nested: { a: true, b: null } }), tok, manifest);
  assert.deepEqual(tok.texts, [
    'choice question: null', ' empty', " nested: {'a': True, 'b': None}", '{"message": "hello   世界", "flags": [true, null]}',
  ]);
  assert.equal(row.ids[0], 101);
  assert.equal(row.ids.at(-1), 102);
  assert.deepEqual(row.markers.map(index => row.ids[index]), [103, 103]);
  assert.equal(row.ids.filter(id => id === 103).length, 2);
  const instructionTok = tokenizer();
  await prepareLayaRow('score', 'state', score({ note: '世界' }, [null, 'fine']), instructionTok, manifest);
  assert.equal(instructionTok.texts[0], 'score question: {"note": "\\u4e16\\u754c"}');
  assert.equal(instructionTok.texts[1], ' level 0: None');
});

test('Laya uses false/true option order and rejects unsupported structured boolean criteria', async () => {
  const tok = tokenizer();
  await prepareLayaRow('q', '', booleanQuestion('Exists?'), tok, manifest);
  assert.equal(tok.texts[0], 'noul question: Exists?');
  assert.equal(tok.texts[1], ' false: no, the statement does not hold');
  assert.equal(tok.texts[2], ' true: yes, the statement holds');
  await assert.rejects(prepareLayaRow('q', '', { type: 'boolean', instructions: '', criteria: { true: { text: 'yes' } } }, tok, manifest), UnsupportedFeatureError);
});

test('Laya structured descriptions preserve Python repr for nonprintable Unicode', async () => {
  const tok = tokenizer();
  await prepareLayaRow('q', '', choice('?', {
    a: { note: 'zero\u200bwidth\u00a0\u0085\u2028\ue000\u{e0001} café' },
    b: null,
  }), tok, manifest);
  assert.equal(tok.texts[1], " a: {'note': 'zero\\u200bwidth\\xa0\\x85\\u2028\\ue000\\U000e0001 café'}");
});

test('Laya reports token truncation and fails when option markers cannot fit', async () => {
  const small = { ...manifest, maxLength: 64, headMaxLength: 32 };
  const row = await prepareLayaRow('q', 's'.repeat(200), choice('i'.repeat(100), { a: 'a'.repeat(100), b: 'b'.repeat(100) }), tokenizer(), small);
  assert.equal(row.ids.length, 64);
  assert.equal(row.markers.length, 2);
  assert.deepEqual(row.warnings.map(warning => warning.code), ['laya_instructions_truncated', 'laya_options_truncated', 'laya_state_truncated']);
  await assert.rejects(prepareLayaRow('q', '', choice('?', Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`option${i}`, 'test']))), tokenizer(), small), ValidationError);
});

test('Laya validates manifest limits, temperatures, asset paths and token IDs', () => {
  for (const patch of [{ format: 'encoder-only' }, { maxLength: 0 }, { headMaxLength: 513 }, { temperature: [1, 0, 1] }, { temperatureByOptions: { 'choice:2': NaN } }, { modelFile: '../model.onnx' }, { modelFile: 'model.safetensors' }, { tokenizer: 'https://elsewhere.example/tokenizer' }, { tokenIds: { ...manifest.tokenIds, mask: -1 } }, { externalData: [{ path: '../weights', data: 'weights' }] }]) {
    assert.throws(() => parseLayaManifest({ ...manifest, ...patch }), ConfigurationError);
  }
});

test('Laya confidence is entropy-based and singleton choices have probability one', async () => {
  const uniform = await prepareLayaRow('q', '', choice('', { a: '', b: '', c: '' }), tokenizer(), manifest);
  assert.equal(layaAnswer(uniform, [0, 0, 0], manifest).confidence, 0);
  const single = await prepareLayaRow('q', '', choice('', { only: null }), tokenizer(), manifest);
  assert.deepEqual(layaAnswer(single, [10], manifest), { type: 'choice', choice: 'only', probabilities: { only: 1 }, confidence: 1 });
});

test('Laya bounds batches and supports singleton choice act-head padding', () => withGPU(async () => {
  const f = fixture({ options: { batchSize: 1 } });
  const client = await createLayaWebGPUClient(f.options);
  try {
    const result = await client.evaluate({ state: 'state', questions: { single: choice('?', { only: null }), other: booleanQuestion('?') } });
    assert.equal(f.state.runs.length, 2);
    assert.deepEqual(f.state.runs[0].marker_pos.dims, [1, 2]);
    assert.deepEqual([...f.state.runs[0].marker_mask.data], [1, 0]);
    assert.equal(result.answers.single.probabilities.only, 1);
  } finally { await client.dispose(); }
}));

test('Laya rejects model overrides and provider options before inference', () => withGPU(async () => {
  const f = fixture();
  const client = await createLayaWebGPUClient(f.options);
  const request = { state: '', questions: { q: booleanQuestion('?') } };
  try {
    await assert.rejects(client.evaluate({ ...request, model: 'another-checkpoint' }), ConfigurationError);
    await assert.rejects(client.evaluate({ ...request, providerOptions: { temperature: 2 } }), UnsupportedFeatureError);
    assert.equal(f.state.runs.length, 0);
  } finally { await client.dispose(); }
}));

test('Laya releases tensors on malformed output and allows the next evaluation', () => withGPU(async () => {
  let fail = true;
  const f = fixture({ run(feeds, outputFor) {
    const output = outputFor(feeds);
    if (fail) output.logits.data[0] = NaN;
    return output;
  } });
  const client = await createLayaWebGPUClient(f.options);
  const request = { state: '', questions: { q: booleanQuestion('?') } };
  try {
    await assert.rejects(client.evaluate(request), ResponseValidationError);
    assert.equal(f.state.disposed, 7);
    fail = false;
    assert.ok((await client.evaluate(request)).answers.q.probability > 0.5);
    assert.equal(f.state.disposed, 14);
  } finally { await client.dispose(); }
}));

test('Laya cancellation rejects promptly while keeping native inference serialized and disposal safe', () => withGPU(async () => {
  const started = deferred(), finish = deferred();
  let count = 0;
  const f = fixture({ async run(feeds, outputFor) {
    if (++count === 1) { started.resolve(); await finish.promise; }
    return outputFor(feeds);
  } });
  const client = await createLayaWebGPUClient(f.options);
  const request = { state: '', questions: { q: booleanQuestion('?') } };
  const controller = new AbortController();
  const first = client.evaluate(request, { signal: controller.signal });
  const rejected = assert.rejects(first, RequestAbortedError);
  await started.promise;
  controller.abort();
  await rejected;
  const second = client.evaluate(request);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.runs.length, 1, 'cancel must not permit overlapping native runs');
  finish.resolve();
  assert.ok((await second).answers.q.probability > 0.5);
  await Promise.all([client.dispose(), client.dispose()]);
  assert.equal(f.state.released, 1);
  assert.equal(f.state.disposed, 14);
  await assert.rejects(client.evaluate(request), ConfigurationError);
}));

test('Laya deadline prevents an expired queued evaluation from starting', () => withGPU(async () => {
  const started = deferred(), finish = deferred();
  const f = fixture({ async run(feeds, outputFor) { started.resolve(); await finish.promise; return outputFor(feeds); } });
  const runner = await createLayaWebGPURunner(f.options);
  const request = { model: manifest.model, state: '', questions: { q: booleanQuestion('?') } };
  const first = runner.evaluate(request, { timeoutMs: 2000 });
  await started.promise;
  await assert.rejects(runner.evaluate(request, { timeoutMs: 10 }), TimeoutError);
  finish.resolve();
  await first;
  await runner.dispose();
  assert.equal(f.state.runs.length, 1);
  assert.equal(f.state.released, 1);
}));

test('Laya disposal waits for in-flight inference and rejects queued work', () => withGPU(async () => {
  const started = deferred(), finish = deferred();
  const f = fixture({ async run(feeds, outputFor) { started.resolve(); await finish.promise; return outputFor(feeds); } });
  const client = await createLayaWebGPUClient(f.options);
  const work = client.evaluate({ state: '', questions: { q: booleanQuestion('?') } });
  const rejected = assert.rejects(work, ConfigurationError);
  await started.promise;
  const disposal = client.dispose();
  assert.equal(f.state.released, 0);
  finish.resolve();
  await Promise.all([rejected, disposal]);
  assert.equal(f.state.released, 1);
  assert.equal(f.state.disposed, 7);
}));

test('Laya releases sessions completing after initialization cancellation', () => withGPU(async () => {
  const started = deferred(), finish = deferred();
  const controller = new AbortController();
  const f = fixture({ options: { signal: controller.signal }, async create(session) { started.resolve(); await finish.promise; return session; } });
  const work = createLayaWebGPUClient(f.options);
  const rejected = assert.rejects(work, RequestAbortedError);
  await started.promise;
  controller.abort();
  await rejected;
  finish.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.released, 1);
}));

test('Laya rejects encoder-only graphs and cleans up failed initialization', () => withGPU(async () => {
  const f = fixture({ session: { outputNames: ['last_hidden_state'] } });
  await assert.rejects(createLayaWebGPUClient(f.options), ConfigurationError);
  assert.equal(f.state.released, 1);
  const g = fixture({ options: { onProgress(event) { if (event.status === 'ready') throw new Error('UI callback failed'); } } });
  await assert.rejects(createLayaWebGPUClient(g.options), /UI callback failed/);
  assert.equal(g.state.released, 1);
}));

test('Laya rejects a mismatched tokenizer before loading weights', () => withGPU(async () => {
  const f = fixture({ options: { tokenizer: { encode: () => [999] } } });
  await assert.rejects(createLayaWebGPUClient(f.options), /mask token/);
  assert.equal(f.state.created.length, 0);
}));

test('Laya fails explicitly without WebGPU rather than selecting a WASM provider', () => withGPU(async () => {
  globalThis.navigator.gpu.requestAdapter = async () => null;
  const f = fixture();
  await assert.rejects(createLayaWebGPUClient(f.options), ConfigurationError);
  assert.equal(f.state.fetches.length, 0);
}));

test('Laya browser client falls back to WASM CPU when WebGPU is unavailable', () => withGPU(async () => {
  globalThis.navigator.gpu.requestAdapter = async () => null;
  const f = fixture();
  const client = await createBrowserClient({ driver: createLayaDriver(f.options) });
  try {
    const result = await client.evaluate({ state: '', questions: { ready: booleanQuestion('Ready?') } });
    assert.deepEqual(f.state.created[0].config.executionProviders, ['wasm']);
    assert.equal(result.providerMetadata.device, 'wasm');
    assert.equal(result.response.adapter, 'local-laya-wasm');
  } finally { await client.dispose(); }
}));
