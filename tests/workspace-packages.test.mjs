import assert from 'node:assert/strict';
import test from 'node:test';
import { booleanQuestion, createSystemOne } from '@system-one-ai/core';
import { systemOneAdapter } from '@system-one-ai/adapter-system-one';
import { openRouterAdapter } from '@system-one-ai/adapter-openrouter';
import { vercelAdapter } from '@system-one-ai/adapter-vercel';
import { cloudflareAdapter } from '@system-one-ai/adapter-cloudflare';
import { llmAdapter } from '@system-one-ai/adapter-llm';

const request = { state: 'on', questions: { on: booleanQuestion('Is the light on?') } };

async function evaluate(adapter, payload, expectedURL, options = {}) {
  const client = createSystemOne({ adapter, apiKey: 'fixture', ...options, fetch: async (url) => {
    assert.equal(url, expectedURL);
    return new Response(JSON.stringify(payload));
  }});
  const result = await client.evaluate(request);
  assert.equal(result.answers.on.probability, 0.9);
}

test('workspace core and adapter packages compose without the root package', async () => {
  await evaluate(systemOneAdapter, { answers: { on: { type: 'noul', noul: 0.9 } } }, 'https://api.typesafe.ai/v1/systemone', { apiKey: null });
  await evaluate(openRouterAdapter, { model: 'typesafe/jev-1', answers: { on: { type: 'noul', noul: 0.9 } }, usage: {} }, 'https://openrouter.ai/api/alpha/decisions');
  await evaluate(vercelAdapter, { answers: { on: { type: 'boolean', probability: 0.9 } } }, 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model');
  await evaluate(cloudflareAdapter({ accountId: 'account' }), { success: true, errors: [], result: { answers: { on: { type: 'noul', noul: 0.9 } } } }, 'https://api.cloudflare.com/client/v4/accounts/account/ai/run');
  await evaluate(llmAdapter({ provider: 'openai', api: 'chat_completions', structuredOutputs: false }), { choices: [{ message: { content: JSON.stringify({ answers: { on: 0.9 } }) } }] }, 'https://api.openai.com/v1/chat/completions', { model: 'test-model' });
});
