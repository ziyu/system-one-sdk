import { createFetchTransport } from '@system-one-ai/transport-fetch';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ResponseValidationError, SystemOne, UnsupportedFeatureError, ValidationError,
  booleanQuestion, choice, score,
} from '@system-one-ai/core';
import { openAiDecisionsAdapter } from '@system-one-ai/adapter-openai-decisions';
import {
  OPENAI_DECISIONS_MAX_SCORE_LEVELS,
  encodeOpenAiDecisionsRequest,
} from '@system-one-ai/protocol-openai-decisions';
import { jsonResponse } from './fixtures.mjs';

const state = { ticket: 'The same order was charged twice.', order: { charges: [49, 49] } };
const questions = {
  billing: { type: 'boolean', instructions: 'Is this about billing?', criteria: { true: 'Charges or refunds.', false: 'Other topics.' } },
  department: {
    type: 'choice', instructions: 'Which team should handle it?',
    criteria: { billing: 'Payments and refunds', technical: 'Product issues' },
  },
  severity: { type: 'score', instructions: 'How severe is it?', criteria: ['Cosmetic', 'Fully blocked'] },
};
const payload = () => ({
  model: 'gpt-6-luna',
  answers: [
    { type: 'predicate', name: 'billing', probability: 0.93 },
    {
      type: 'choice', name: 'department', choice: 'billing', confidence: 0.88,
      probabilities: [{ value: 'billing', probability: 0.88 }, { value: 'technical', probability: 0.12 }],
    },
    {
      type: 'score', name: 'severity', score: 0.7, confidence: 0.7,
      probabilities: [
        { value: 0, label: 'Cosmetic', probability: 0.3 },
        { value: 1, label: 'Fully blocked', probability: 0.7 },
      ],
    },
  ],
  usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100 },
});

test('OpenAI Decisions sends the direct /v1/decisions contract and decodes answers', async () => {
  let calls = 0;
  const client = new SystemOne({ adapter: openAiDecisionsAdapter, apiKey: 'fixture-key', transport: createFetchTransport(async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/decisions');
    assert.equal(init.headers.get('authorization'), 'Bearer fixture-key');
    assert.deepEqual(JSON.parse(init.body), {
      model: 'gpt-6-luna',
      input: [{
        role: 'user',
        type: 'message',
        content: [{ type: 'input_json', data: state }],
      }],
      questions: [
        {
          name: 'billing', type: 'predicate',
          instructions: 'Is this about billing?\nTrue criteria: Charges or refunds.\nFalse criteria: Other topics.',
        },
        {
          name: 'department', type: 'choice', instructions: 'Which team should handle it?',
          choices: [{ value: 'billing', description: 'Payments and refunds' }, { value: 'technical', description: 'Product issues' }],
        },
        {
          name: 'severity', type: 'score', instructions: 'How severe is it?',
          levels: [{ label: 'Cosmetic' }, { label: 'Fully blocked' }],
        },
      ],
    });
    return jsonResponse(payload());
  }) });
  const result = await client.evaluate({ state, questions });
  assert.equal(calls, 1);
  assert.equal(result.model, 'gpt-6-luna');
  assert.deepEqual(result.answers.billing, { type: 'boolean', probability: 0.93 });
  assert.equal(result.answers.department.choice, 'billing');
  assert.deepEqual(result.answers.severity.probabilities, { 0: 0.3, 1: 0.7 });
  assert.deepEqual(result.answers.severity.legend, { 0: 'Cosmetic', 1: 'Fully blocked' });
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 0, totalTokens: 100 });
  assert.equal(result.rounding, undefined);
});

test('OpenAI Decisions can target another compatible provider with baseURL and model', async () => {
  const sent = [];
  const client = new SystemOne({
    adapter: openAiDecisionsAdapter,
    baseURL: 'https://provider.example/openai/v1/',
    model: 'provider/decisions-model',
    apiKey: 'provider-key',
    transport: createFetchTransport(async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return jsonResponse({ model: 'provider/decisions-model', answers: [{ type: 'predicate', name: 'on', probability: 0.8 }], usage: {} });
    }),
  });
  await client.evaluate({ state: 'The light is on.', questions: { on: booleanQuestion('Is the light on?') } });
  assert.deepEqual(sent, [{
    url: 'https://provider.example/openai/v1/decisions',
    body: {
      model: 'provider/decisions-model',
      input: 'The light is on.',
      questions: [{ name: 'on', type: 'predicate', instructions: 'Is the light on?' }],
    },
  }]);
});

test('OpenAI Decisions endpoint accepts roots, version roots and existing decisions paths', async () => {
  for (const [baseURL, expected] of [
    ['https://provider.example', 'https://provider.example/v1/decisions'],
    ['https://provider.example/v1', 'https://provider.example/v1/decisions'],
    ['https://provider.example/api/v1/', 'https://provider.example/api/v1/decisions'],
    ['https://provider.example/decisions', 'https://provider.example/decisions'],
    ['https://provider.example/decisions/', 'https://provider.example/decisions'],
  ]) {
    const client = new SystemOne({ adapter: openAiDecisionsAdapter, baseURL, apiKey: null, transport: createFetchTransport(async url => {
      assert.equal(url, expected);
      return jsonResponse({ model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'on', probability: 0.8 }], usage: {} });
    }) });
    await client.evaluate({ state: 'on', questions: { on: booleanQuestion('On?') } });
  }
});

test('OpenAI Decisions maps images to user message parts for compatible providers', async () => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
  let body;
  const client = new SystemOne({ adapter: openAiDecisionsAdapter, apiKey: null, transport: createFetchTransport(async (_, init) => {
    body = JSON.parse(init.body);
    return jsonResponse({ model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'visible', probability: 0.8 }], usage: {} });
  }) });
  await client.evaluate({
    state: 'Inspect the image.',
    images: [{ mediaType: 'image/png', base64 }],
    questions: { visible: booleanQuestion('Is damage visible?') },
  });
  assert.deepEqual(body.input, [{
    role: 'user', type: 'message',
    content: [
      { type: 'input_text', text: 'Inspect the image.' },
      { type: 'input_image', image_url: `data:image/png;base64,${base64}` },
    ],
  }]);
});

test('OpenAI Decisions sends object state with images as JSON evidence before images', async () => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
  const evidence = { ticket: 'A damaged item arrived.', tags: ['damage', 'refund'] };
  let body;
  const client = new SystemOne({ adapter: openAiDecisionsAdapter, apiKey: null, transport: createFetchTransport(async (_, init) => {
    body = JSON.parse(init.body);
    return jsonResponse({ model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'visible', probability: 0.8 }], usage: {} });
  }) });
  await client.evaluate({
    state: evidence,
    images: [{ mediaType: 'image/png', base64 }],
    questions: { visible: booleanQuestion('Is damage visible?') },
  });
  assert.deepEqual(body.input, [{
    role: 'user', type: 'message',
    content: [
      { type: 'input_json', data: evidence },
      { type: 'input_image', image_url: `data:image/png;base64,${base64}` },
    ],
  }]);
});

test('OpenAI Decisions falls back to text for state arrays that input_json cannot represent', async () => {
  const state = [1, 'two', null];
  let body;
  const client = new SystemOne({ adapter: openAiDecisionsAdapter, apiKey: null, transport: createFetchTransport(async (_, init) => {
    body = JSON.parse(init.body);
    return jsonResponse({ model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'on', probability: 0.8 }], usage: {} });
  }) });
  await client.evaluate({ state, questions: { on: booleanQuestion('On?') } });
  assert.equal(body.input, JSON.stringify(state));
});

test('the protocol codec enforces score levels and can opt into text state for narrower schemas', () => {
  const encode = criteria => encodeOpenAiDecisionsRequest({
    state: { ticket: 'charged twice' },
    questions: { severity: { type: 'score', instructions: 'Severity?', criteria } },
  });
  assert.throws(() => encode(['only one']), ValidationError);
  assert.throws(() => encode(Array.from({ length: OPENAI_DECISIONS_MAX_SCORE_LEVELS + 1 }, (_, index) => `level ${index}`)), ValidationError);
  const tenLevels = encode(Array.from({ length: OPENAI_DECISIONS_MAX_SCORE_LEVELS }, (_, index) => `level ${index}`));
  assert.equal(tenLevels.questions[0].levels.length, OPENAI_DECISIONS_MAX_SCORE_LEVELS);
  assert.equal(encodeOpenAiDecisionsRequest({
    state: { ticket: 'charged twice' },
    questions: { on: booleanQuestion('On?') },
  }, { structuredState: 'text' }).input, JSON.stringify({ ticket: 'charged twice' }));
});

test('OpenAI Decisions rejects refusals, unsupported options and oversized question sets before I/O', async () => {
  for (const [request, error] of [
    [{ state: 'x', questions: { on: booleanQuestion('On?') }, providerOptions: { openai: {} } }, UnsupportedFeatureError],
    [{ state: 'x', questions: Object.fromEntries(Array.from({ length: 401 }, (_, index) => [`q${index}`, booleanQuestion('On?')])) }, ValidationError],
    [{ state: 'x', questions: { severity: { type: 'score', instructions: 'Severity?', criteria: Array.from({ length: 11 }, (_, index) => `level ${index}`) } } }, ValidationError],
  ]) {
    const client = new SystemOne({ adapter: openAiDecisionsAdapter, apiKey: () => assert.fail('must fail before credentials'),
      transport: createFetchTransport(() => assert.fail('must fail before I/O')) });
    await assert.rejects(client.evaluate(request), error);
  }
  let calls = 0;
  const refused = new SystemOne({ adapter: openAiDecisionsAdapter, apiKey: null, transport: createFetchTransport(async () => {
    calls++;
    return jsonResponse({ model: 'gpt-6-luna', answers: [{ type: 'refusal', name: 'on' }], usage: {} });
  }) });
  await assert.rejects(refused.evaluate({ state: 'x', questions: { on: booleanQuestion('On?') } }), ResponseValidationError);
  assert.equal(calls, 1);
});

test('OpenAI Decisions choice questions use the declared score and choice identities', async () => {
  const client = new SystemOne({ adapter: openAiDecisionsAdapter, apiKey: null, transport: createFetchTransport(async () => jsonResponse({
    model: 'gpt-6-luna',
    answers: [
      { type: 'choice', name: 'team', choice: 'a', probabilities: [{ value: 'a', probability: 1 }, { value: 'b', probability: 0 }] },
      { type: 'score', name: 'quality', score: 1, probabilities: [{ value: 0, label: 'low', probability: 0 }, { value: 1, label: 'high', probability: 1 }] },
    ],
    usage: {},
  })) });
  const result = await client.evaluate({
    state: 'x',
    questions: {
      team: choice('Team?', { a: 'A', b: 'B' }),
      quality: score('Quality?', ['low', 'high']),
    },
  });
  assert.equal(result.answers.team.choice, 'a');
  assert.equal(result.answers.quality.score, 1);
  assert.deepEqual(result.answers.quality.legend, { 0: 'low', 1: 'high' });
});
