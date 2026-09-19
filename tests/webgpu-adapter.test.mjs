import assert from 'node:assert/strict';
import test from 'node:test';
import { booleanQuestion, choice, score } from '@system-one-ai/core';
import { createOpenJevWebGPUClient } from '@system-one-ai/adapter-webgpu';

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
