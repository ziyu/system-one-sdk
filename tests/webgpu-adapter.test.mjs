import assert from 'node:assert/strict';
import test from 'node:test';
import { booleanQuestion, choice, score } from '@system-one-ai/core';
import { createBrowserClient, createGGUFDriver, createOpenJevWebGPUClient } from '@system-one-ai/adapter-webgpu';

test('WebGPU adapter loads a GGUF runner and normalizes model JSON', async () => {
  const previousNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: {} } });
  const calls = [];
  const engine = {
    isSupportWebGPU: () => true,
    async loadModelFromUrl(url, options) { calls.push({ type: 'load', url, options }); },
    async createChatCompletion({ messages }) {
      const prompt = messages.at(-1).content;
      calls.push({ type: 'chat', prompt });
      if (prompt.includes('Question id: queue')) return { choices: [{ message: { content: '{"probabilities":{"access":0.6,"billing":0.3}}' } }], usage: { prompt_tokens: 10, completion_tokens: 4 } };
      if (prompt.includes('Question id: fraud')) return { choices: [{ message: { content: '{"probability":0.8}' } }], usage: { prompt_tokens: 8, completion_tokens: 2 } };
      return { choices: [{ message: { content: '{"probabilities":{"0":0.25,"1":0.75}}' } }], usage: { prompt_tokens: 9, completion_tokens: 3 } };
    },
    async exit() { calls.push({ type: 'exit' }); },
  };
  try {
    const client = await createOpenJevWebGPUClient({
      model: 'fixture-model', modelUrl: 'https://models.example/fixture.gguf',
      engineFactory: () => engine,
    });
    const result = await client.evaluate({
      state: 'customer message',
      questions: {
        queue: choice('Queue?', { access: 'Account access', billing: 'Billing' }),
        fraud: booleanQuestion('Is this fraud?'),
        severity: score('Severity?', ['low', 'high']),
      },
    });
    assert.equal(calls[0].url, 'https://models.example/fixture.gguf');
    assert.equal(result.answers.queue.choice, 'access');
    assert.ok(Math.abs(result.answers.queue.probabilities.access - 2 / 3) < 1e-12);
    assert.ok(Math.abs(result.answers.queue.probabilities.billing - 1 / 3) < 1e-12);
    assert.equal(result.answers.fraud.probability, 0.8);
    assert.equal(result.answers.severity.score, 0.75);
    assert.equal(result.usage.inputTokens, 27);
    assert.equal(result.response.adapter, 'local-webgpu-fixture-model');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator });
  }
});

test('browser adapter falls back to WASM CPU when WebGPU is unavailable', async () => {
  const previousNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  const calls = [];
  const engine = {
    isSupportWebGPU: () => false,
    async loadModelFromUrl(url, options) { calls.push({ type: 'load', url, options }); },
    async createChatCompletion() {
      return { choices: [{ message: { content: '{"probability":0.7}' } }] };
    },
  };
  try {
    const client = await createBrowserClient({
      driver: createGGUFDriver({ model: 'fixture-model', modelUrl: 'https://models.example/fixture.gguf', engineFactory: () => engine }),
    });
    const result = await client.evaluate({
      state: 'offline browser',
      questions: { ready: booleanQuestion('Can the local model answer?') },
    });
    assert.equal(calls[0].options.n_gpu_layers, 0);
    assert.equal(result.answers.ready.probability, 0.7);
    assert.equal(result.providerMetadata.device, 'wasm');
    assert.equal(result.response.adapter, 'local-wasm-fixture-model');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator });
  }
});

test('browser adapter can force WASM even when WebGPU exists', async () => {
  const previousNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: { requestAdapter: async () => ({}) } } });
  let loadOptions;
  const engine = {
    isSupportWebGPU: () => true,
    async loadModelFromUrl(_url, options) { loadOptions = options; },
    async createChatCompletion() {
      return { choices: [{ message: { content: '{"probability":0.4}' } }] };
    },
  };
  try {
    const client = await createBrowserClient({
      device: 'wasm',
      driver: createGGUFDriver({ model: 'fixture-model', modelUrl: 'https://models.example/fixture.gguf', engineFactory: () => engine }),
    });
    const result = await client.evaluate({ state: 'local cpu', questions: { ready: booleanQuestion('Ready?') } });
    assert.equal(loadOptions.n_gpu_layers, 0);
    assert.equal(result.providerMetadata.device, 'wasm');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator });
  }
});

test('generic browser client accepts a custom model driver', async () => {
  let disposed = false;
  const client = await createBrowserClient({
    driver: {
      id: 'future-model',
      async createRunner({ device }) {
        assert.equal(device, 'auto');
        return {
          id: 'future-model', defaultModel: 'future-v1', supportedQuestionTypes: ['boolean'],
          async evaluate(request) {
            return { model: request.model, answers: { ready: { type: 'boolean', probability: 1 } }, usage: {}, providerMetadata: { runtime: 'fixture' } };
          },
          async dispose() { disposed = true; },
        };
      },
    },
  });
  assert.equal((await client.evaluate({ state: 'local', questions: { ready: booleanQuestion('Ready?') } })).answers.ready.probability, 1);
  await client.dispose();
  assert.equal(disposed, true);
});
