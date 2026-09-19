import assert from 'node:assert/strict';
import test from 'node:test';
import { booleanQuestion, ConfigurationError, createSystemOne, RequestAbortedError, ResponseValidationError, TimeoutError } from '@system-one-ai/core';

const request = { state: 'on', questions: { on: booleanQuestion('On?') } };
const adapter = {
  id: 'fixture', defaultModel: 'fixture', defaultBaseURL: 'https://fixture.example', supportedQuestionTypes: ['boolean'],
  prepare: ({ request, baseURL }) => ({ url: `${baseURL}/evaluate`, body: request }),
  decode: value => value,
};
const response = { payload: { answers: { on: { type: 'boolean', probability: 1 } } }, status: 200, attempts: 1 };

test('core runs with an injected transport and validates its decoded result', async () => {
  let calls = 0;
  const transport = { async send(prepared) { calls++; assert.equal(JSON.parse(prepared.body).questions.on.type, 'boolean'); return response; } };
  const client = createSystemOne({ adapter, transport, apiKey: null });
  assert.equal((await client.evaluate(request)).answers.on.probability, 1);
  const malformed = createSystemOne({ adapter, apiKey: null, transport: { async send() { return { ...response, payload: { answers: {} } }; } } });
  await assert.rejects(malformed.evaluate(request), ResponseValidationError);
  const controller = new AbortController(); controller.abort('private reason');
  await assert.rejects(client.evaluate(request, { signal: controller.signal }), RequestAbortedError);
  assert.equal(calls, 1);
  assert.throws(() => createSystemOne({ apiKey: null, adapter }), ConfigurationError);
  assert.throws(() => createSystemOne({ apiKey: null, transport }), ConfigurationError);
});

test('deadline covers synchronous decoding and malformed input never reaches transport', async () => {
  const client = createSystemOne({ apiKey: null, adapter: { ...adapter, decode(value) {
    const until = performance.now() + 35;
    while (performance.now() < until) { /* simulate a slow synchronous custom decoder */ }
    return value;
  } }, transport: { async send() { return response; } }, timeoutMs: 20 });
  await assert.rejects(client.evaluate(request), TimeoutError);
  const invalid = createSystemOne({ apiKey: null, adapter, transport: { send() { assert.fail('must not send invalid input'); } } });
  await assert.rejects(invalid.evaluate({ state: null, questions: request.questions }));
});
