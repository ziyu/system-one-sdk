import assert from 'node:assert/strict';
import test from 'node:test';
import { ResponseValidationError, SystemOne, booleanQuestion, choice, score } from '../dist/esm/index.js';
import { llmAdapter } from '../dist/esm/adapters/llm.js';

const request = {
  state: 'The light is on.',
  questions: {
    on: booleanQuestion('Is the light on?'),
    action: choice('What should happen?', { keep: 'Keep it on', turn_off: 'Turn it off' }),
    urgency: score('How urgent is this?', ['low', 'medium', 'high']),
  },
};

const output = {
  answers: {
    on: 0.9,
    action: { keep: 0.8, turn_off: 0.2 },
    urgency: { 0: 0.1, 1: 0.2, 2: 0.7 },
  },
};

test('LLM adapter sends OpenAI Responses schema and converts probabilities', async () => {
  let call;
  const client = new SystemOne({
    adapter: llmAdapter({ provider: 'openai', structuredOutputs: true }),
    apiKey: 'llm-fixture', model: 'gpt-fixture',
    fetch: async (url, init) => {
      call = { url, body: JSON.parse(init.body), headers: new Headers(init.headers) };
      return new Response(JSON.stringify({ model: 'gpt-fixture-real', output_text: JSON.stringify(output), usage: { input_tokens: 12, output_tokens: 7 }, status: 'completed' }), { status: 200 });
    },
  });
  const result = await client.evaluate(request);
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.equal(call.body.model, 'gpt-fixture');
  assert.equal(call.body.store, false);
  assert.equal(call.body.text.format.type, 'json_schema');
  assert.equal(call.body.input[0].role, 'user');
  assert.equal(call.body.instructions.includes('untrusted data'), true);
  assert.equal(call.headers.get('authorization'), 'Bearer llm-fixture');
  assert.equal(result.model, 'gpt-fixture-real');
  assert.equal(result.answers.action.choice, 'keep');
  assert.ok(Math.abs(result.answers.urgency.score - 1.6) < 1e-9);
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 7, totalTokens: 19 });
});

test('LLM adapter supports OpenAI-compatible chat endpoints and optional normalization', async () => {
  const client = new SystemOne({
    adapter: llmAdapter({ provider: 'openai', normalizeProbabilities: true }),
    baseURL: 'https://proxy.example/v1', apiKey: 'fixture', model: 'local-model',
    fetch: async (url, init) => {
      assert.equal(url, 'https://proxy.example/v1/chat/completions');
      assert.equal(JSON.parse(init.body).response_format.type, 'json_schema');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answers: { on: 1, action: { keep: 0.6, turn_off: 0.6 }, urgency: { 0: 0, 1: 1, 2: 0 } } }) }, finish_reason: 'stop' }] }), { status: 200 });
    },
  });
  const result = await client.evaluate({ ...request, questions: { on: request.questions.on, action: request.questions.action, urgency: request.questions.urgency } });
  assert.equal(result.answers.on.probability, 1);
  assert.equal(result.answers.action.probabilities.keep, 0.5);
  assert.equal(result.answers.urgency.score, 1);
});

test('LLM adapter sends Anthropic native schema and API-key authentication', async () => {
  const client = new SystemOne({
    adapter: llmAdapter({ provider: 'anthropic', structuredOutputs: true }),
    apiKey: 'anthropic-fixture', model: 'claude-fixture',
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(init.headers.get('x-api-key'), 'anthropic-fixture');
      assert.equal(init.headers.get('anthropic-version'), '2023-06-01');
      const body = JSON.parse(init.body);
      assert.equal(body.output_config.format.type, 'json_schema');
      return new Response(JSON.stringify({ model: 'claude-fixture', content: [{ type: 'text', text: JSON.stringify({ answers: { on: 0, action: { keep: 0, turn_off: 1 }, urgency: { 0: 0, 1: 0, 2: 1 } } }) }], usage: { input_tokens: 3, output_tokens: 2 }, stop_reason: 'end_turn' }), { status: 200 });
    },
  });
  const result = await client.evaluate(request);
  assert.equal(result.answers.on.probability, 0);
  assert.equal(result.answers.action.choice, 'turn_off');
  assert.equal(result.answers.urgency.score, 2);
});

test('LLM output errors stay response validation errors', async () => {
  const client = new SystemOne({ adapter: llmAdapter(), apiKey: null, model: 'fixture', maxRetries: 4, fetch: async () => new Response(JSON.stringify({ output_text: 'not json', status: 'completed' }), { status: 200 }) });
  await assert.rejects(client.evaluate({ state: 'x', questions: { on: booleanQuestion('on?') } }), ResponseValidationError);
});
