import assert from 'node:assert/strict';
import test from 'node:test';
import { SystemOne, ValidationError, ConfigurationError, ResponseValidationError } from '../dist/esm/index.js';
import { vercelAdapter } from '../dist/esm/adapters/vercel.js';
import { request, nativePayload, gatewayPayload, jsonResponse, booleanRequest } from './fixtures.mjs';

for (const [label, mutate] of [
  ['null state', input => { input.state = null; }],
  ['boolean state', input => { input.state = true; }],
  ['non-finite nested number', input => { input.state.thirst = NaN; }],
  ['undefined nested property', input => { input.state.extra = undefined; }],
  ['bigint', input => { input.state.extra = 1n; }],
  ['class instance', input => { input.state.extra = new Date(); }],
  ['cycle', input => { input.state.extra = input.state; }],
  ['sparse array', input => { input.state = new Array(2); }],
  ['empty questions', input => { input.questions = {}; }],
  ['unknown primitive', input => { input.questions.action.type = 'text'; }],
  ['missing instructions', input => { delete input.questions.action.instructions; }],
  ['numeric instructions', input => { input.questions.action.instructions = 123; }],
  ['empty choices', input => { input.questions.action.criteria = {}; }],
  ['too few score levels', input => { input.questions.urgency.criteria = ['Only']; }],
  ['invalid boolean criteria', input => { input.questions.interrupt.criteria = { yes: 'yes' }; }],
  ['unknown question field', input => { input.questions.action.temperature = 1; }],
  ['empty model', input => { input.model = ''; }],
  ['invalid provider options', input => { input.providerOptions = 'raw'; }],
]) {
  test(`invalid input is rejected before I/O: ${label}`, async () => {
    const input = structuredClone(request);
    mutate(input);
    const client = new SystemOne({ apiKey: () => assert.fail('key resolution must not run'), fetch: async () => assert.fail('fetch must not run') });
    await assert.rejects(client.evaluate(input), ValidationError);
  });
}

test('getters are rejected without executing them', async () => {
  let calls = 0;
  const state = Object.defineProperty({}, 'secret', { enumerable: true, get() { calls++; return 'hidden'; } });
  const client = new SystemOne({ apiKey: 'fixture', fetch: async () => assert.fail('must not run') });
  await assert.rejects(client.evaluate({ ...booleanRequest, state }), ValidationError);
  assert.equal(calls, 0);
});

test('root request getters and hidden array serializers are rejected without execution', async () => {
  let calls = 0;
  const getter = Object.defineProperty({ questions: booleanRequest.questions }, 'state', { enumerable: true, get() { calls++; return ''; } });
  const array = Object.defineProperty([], 'toJSON', { value() { calls++; return 'silently changed'; } });
  class ArraySubclass extends Array {}
  const client = new SystemOne({ apiKey: 'fixture', fetch: async () => assert.fail('must not run') });
  for (const input of [getter, { ...booleanRequest, state: array }, { ...booleanRequest, state: new ArraySubclass() }]) {
    await assert.rejects(client.evaluate(input), ValidationError);
  }
  assert.equal(calls, 0);
});

for (const [label, mutate] of [
  ['missing answer', payload => { delete payload.answers.action; }],
  ['extra answer', payload => { payload.answers.unrequested = { type: 'noul', noul: 0 }; }],
  ['type mismatch', payload => { payload.answers.action.type = 'score'; }],
  ['undeclared choice', payload => { payload.answers.action.choice = 'fly'; }],
  ['non-maximal choice', payload => { payload.answers.action.choice = 'rest'; }],
  ['negative probability', payload => { payload.answers.action.probabilities.drink = -0.1; }],
  ['probability over one', payload => { payload.answers.interrupt.noul = 1.1; }],
  ['missing probability entry', payload => { delete payload.answers.action.probabilities.rest; }],
  ['extra probability entry', payload => { payload.answers.action.probabilities.extra = 0; }],
  ['unnormalized distribution', payload => { payload.answers.action.probabilities = { drink: 0.2, rest: 0.1 }; }],
  ['score outside rubric', payload => { payload.answers.urgency.score = 3; }],
  ['score inconsistent with probabilities', payload => { payload.answers.urgency.score = 0.2; }],
  ['incorrect legend', payload => { delete payload.answers.urgency.legend['0']; }],
  ['invalid confidence', payload => { payload.answers.action.confidence = 2; }],
  ['negative token usage', payload => { payload.usage.input_tokens = -1; }],
  ['fractional token usage', payload => { payload.usage.input_tokens = 1.5; }],
  ['unsafe total token count', payload => { payload.usage.input_tokens = Number.MAX_SAFE_INTEGER; payload.usage.output_tokens = 1; }],
  ['invalid model ID', payload => { payload.model = 5; }],
  ['null model ID', payload => { payload.model = null; }],
  ['invalid rounding declaration', payload => { payload.rounding = { probabilityDecimals: 20 }; }],
]) {
  test(`invalid provider response fails without a fallback: ${label}`, async () => {
    const payload = nativePayload();
    mutate(payload);
    let calls = 0;
    const client = new SystemOne({ apiKey: 'fixture', fetch: async () => { calls++; return jsonResponse(payload); } });
    await assert.rejects(client.evaluate(request), ResponseValidationError);
    assert.equal(calls, 1);
  });
}

test('provider-reported rounding is preserved rather than probabilities being silently normalized', async () => {
  const input = { state: 'unclear', questions: { x: { type: 'choice', instructions: 'Pick', criteria: { a: null, b: null, c: null } } } };
  const payload = { answers: { x: { type: 'choice', choice: 'a', probabilities: { a: 0.33, b: 0.33, c: 0.33 } } } };
  const native = new SystemOne({ apiKey: 'fixture', fetch: async () => jsonResponse(payload) });
  assert.equal((await native.evaluate(input)).answers.x.probabilities.a, 0.33);
  const gateway = new SystemOne({ adapter: vercelAdapter, apiKey: 'fixture', fetch: async () => jsonResponse(payload) });
  await assert.rejects(gateway.evaluate(input), ResponseValidationError);
  payload.rounding = { probabilityDecimals: 2 };
  assert.equal((await gateway.evaluate(input)).answers.x.probabilities.a, 0.33);
});

test('missing distributions, confidence, and token counts stay absent for future providers', async () => {
  const payload = gatewayPayload();
  delete payload.providerMetadata;
  delete payload.usage;
  for (const answer of Object.values(payload.answers)) delete answer.probabilities;
  const client = new SystemOne({ adapter: vercelAdapter, apiKey: 'fixture', fetch: async () => jsonResponse(payload) });
  const result = await client.evaluate(request);
  assert.equal(result.answers.action.confidence, undefined);
  assert.equal(result.answers.action.probabilities, undefined);
  assert.deepEqual(result.usage, {});
  assert.equal(result.answers.interrupt.probability, 0.94);
});

test('unknown response fields are tolerated, while known fields are validated', async () => {
  const payload = nativePayload();
  payload.future = { serverVersion: 2 };
  payload.answers.action.futureScore = 0.1;
  const client = new SystemOne({ apiKey: 'fixture', fetch: async () => jsonResponse(payload) });
  assert.equal((await client.evaluate(request)).answers.action.choice, 'drink');
});

test('only known token counts are reported; absent counts are not zero', async () => {
  const payload = nativePayload();
  payload.usage = { input_tokens: 15 };
  const client = new SystemOne({ apiKey: 'fixture', fetch: async () => jsonResponse(payload) });
  assert.deepEqual((await client.evaluate(request)).usage, { inputTokens: 15 });
});

test('future compatible models may support more options and levels than current Jev versions', async () => {
  const questions = {
    level: { type: 'score', instructions: '', criteria: Array(11).fill('level') },
    label: { type: 'choice', instructions: '', criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`option${i}`, null])) },
  };
  const client = new SystemOne({ baseURL: 'https://future.example/v1', model: 'future-1', apiKey: 'fixture', fetch: async (_, init) => {
    assert.deepEqual(JSON.parse(init.body).questions, questions);
    return jsonResponse({ answers: { level: { type: 'score', score: 10 }, label: { type: 'choice', choice: 'option255' } } });
  } });
  const result = await client.evaluate({ state: '', questions });
  assert.equal(result.answers.level.score, 10);
  assert.equal(result.answers.label.choice, 'option255');
});

for (const baseURL of ['not a url', 'ftp://example.test', 'https://user:password@example.test', 'https://example.test?key=hidden', 'https://example.test#fragment']) {
  test('invalid or credential-bearing baseURL is rejected without echoing it', () => {
    assert.throws(() => new SystemOne({ apiKey: 'fixture', baseURL }), error => error instanceof ConfigurationError && !error.message.includes('hidden') && !error.message.includes('password'));
  });
}

test('invalid client options and authentication fail as typed configuration errors', async () => {
  for (const options of [{ timeoutMs: 0 }, { maxRetries: -1 }, { retryDelayMs: Infinity }, { maxResponseBytes: 0 }, { model: 5 }, { protocol: 'openai' }]) {
    assert.throws(() => new SystemOne({ apiKey: 'fixture', ...options }), ConfigurationError);
  }
  for (const apiKey of ['', undefined, ' leading', 'invalid\nkey', () => Promise.reject(new Error('hidden-key'))]) {
    const client = new SystemOne({ apiKey, fetch: async () => assert.fail('must not run') });
    await assert.rejects(client.evaluate(booleanRequest), error => error instanceof ConfigurationError && !error.message.includes('hidden-key'));
  }
});
