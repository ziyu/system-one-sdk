import assert from 'node:assert/strict';
import test from 'node:test';
import { SystemOne, ConfigurationError, UnsupportedFeatureError, defineQuestions, choice, score, booleanQuestion } from '../dist/esm/index.js';
import { vercelAdapter } from '../dist/esm/adapters/vercel.js';
import { request, nativePayload, gatewayPayload, jsonResponse, booleanRequest, booleanPayload } from './fixtures.mjs';

test('TypeSafe sends the native HTTP contract and normalizes all three answers', async () => {
  let calls = 0;
  const client = new SystemOne({
    apiKey: 'fixture-key',
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.get('authorization'), 'Bearer fixture-key');
      assert.equal(init.headers.get('content-type'), 'application/json');
      assert.equal(init.headers.get('accept'), 'application/json');
      const body = JSON.parse(init.body);
      assert.deepEqual(body, {
        model: 'jev-latest', state: request.state,
        questions: { ...request.questions, interrupt: { ...request.questions.interrupt, type: 'noul' } },
      });
      return jsonResponse(nativePayload(), { headers: { 'x-request-id': 'fixture-request' } });
    },
  });
  const result = await client.evaluate(request);
  assert.equal(calls, 1);
  assert.equal(result.model, 'jev-1.13.0');
  assert.deepEqual(result.answers.interrupt, { type: 'boolean', probability: 0.94 });
  assert.equal(result.answers.action.choice, 'drink');
  assert.equal(result.answers.action.confidence, 0.73);
  assert.equal(result.answers.action.probabilities.drink, 0.86);
  assert.equal(result.answers.urgency.legend['2'], 'High');
  assert.deepEqual(result.usage, { inputTokens: 215, outputTokens: 31, totalTokens: 246 });
  assert.equal(result.response.requestId, 'fixture-request');
  assert.equal(result.response.attempts, 1);
  assert.equal(result.response.adapter, 'system-one');
  assert.ok(result.response.durationMs >= 0);
});

test('explicit optional Vercel adapter uses the Evaluation v4 contract', async () => {
  const client = new SystemOne({
    adapter: vercelAdapter,
    baseURL: 'https://ai-gateway.vercel.sh/v1', apiKey: 'gateway-fixture-key',
    fetch: async (url, init) => {
      assert.equal(url, 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model');
      assert.equal(init.headers.get('ai-model-id'), 'typesafe-ai/jev');
      assert.equal(init.headers.get('ai-evaluation-model-specification-version'), '4');
      assert.equal(init.headers.get('ai-gateway-protocol-version'), '0.0.1');
      assert.equal(init.headers.get('ai-gateway-auth-method'), 'api-key');
      assert.equal(init.headers.get('authorization'), 'Bearer gateway-fixture-key');
      assert.deepEqual(JSON.parse(init.body), request);
      return jsonResponse(gatewayPayload());
    },
  });
  const result = await client.evaluate(request);
  assert.equal(result.model, 'typesafe-ai/jev');
  assert.equal(result.answers.action.confidence, 0.73);
  assert.deepEqual(result.answers.interrupt, { type: 'boolean', probability: 0.94 });
  assert.equal(result.providerMetadata.typesafe.confidence.urgency, 0.78);
});

for (const [baseURL, adapter, expected] of [
  ['https://api.typesafe.ai', undefined, 'https://api.typesafe.ai/v1/systemone'],
  ['https://api.typesafe.ai/v1/', undefined, 'https://api.typesafe.ai/v1/systemone'],
  ['https://api.typesafe.ai/v1/systemone/', undefined, 'https://api.typesafe.ai/v1/systemone'],
  ['https://local.example/tenant/v2/', undefined, 'https://local.example/tenant/v2/systemone'],
  ['https://ai-gateway.vercel.sh', vercelAdapter, 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model'],
  ['https://ai-gateway.vercel.sh/v4/ai/', vercelAdapter, 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model'],
  ['https://ai-gateway.vercel.sh/v4/ai/evaluation-model', vercelAdapter, 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model'],
  ['https://proxy.example/team/v4/ai/', vercelAdapter, 'https://proxy.example/team/v4/ai/evaluation-model'],
  ['https://ai-gateway.vercel.sh.attacker.example/v1', undefined, 'https://ai-gateway.vercel.sh.attacker.example/v1/systemone'],
]) {
  test(`URL handling preserves the API prefix: ${baseURL}`, async () => {
    const client = new SystemOne({ baseURL, apiKey: 'fixture', ...(adapter ? { adapter } : {}), fetch: async (url) => {
      assert.equal(url, expected);
      return jsonResponse(expected.endsWith('/evaluation-model') ? gatewayPayload() : nativePayload());
    } });
    await client.evaluate(request);
  });
}

test('model IDs and provider options are explicit, without silently changing the requested model', async () => {
  const providerOptions = { gateway: { order: ['typesafe'] } };
  const client = new SystemOne({ adapter: vercelAdapter, baseURL: 'https://ai-gateway.vercel.sh', apiKey: 'fixture', model: 'vendor/default', fetch: async (_, init) => {
    assert.equal(init.headers.get('ai-model-id'), 'vendor/future-system-one');
    assert.deepEqual(JSON.parse(init.body).providerOptions, providerOptions);
    return jsonResponse(gatewayPayload());
  } });
  assert.equal((await client.evaluate({ ...request, model: 'vendor/future-system-one', providerOptions })).model, 'vendor/future-system-one');
  const native = new SystemOne({ apiKey: 'fixture', fetch: async () => assert.fail('must fail before I/O') });
  await assert.rejects(native.evaluate({ ...request, providerOptions }), UnsupportedFeatureError);
});

test('the native client never selects a protocol or model based on the hostname', async () => {
  const client = new SystemOne({ baseURL: 'https://ai-gateway.vercel.sh', apiKey: 'fixture', fetch: async (url, init) => {
    assert.equal(url, 'https://ai-gateway.vercel.sh/v1/systemone');
    assert.equal(JSON.parse(init.body).model, 'jev-latest');
    assert.equal(JSON.parse(init.body).questions.on.type, 'noul');
    assert.equal(init.headers.get('ai-model-id'), null);
    assert.equal(init.headers.get('ai-gateway-protocol-version'), null);
    return jsonResponse(booleanPayload);
  } });
  assert.equal(client.adapterId, 'system-one');
  await client.evaluate(booleanRequest);
});

test('removed protocol option produces a migration error before any request', () => {
  for (const protocol of ['auto', 'system-one', 'vercel']) {
    assert.throws(() => new SystemOne({ apiKey: 'fixture', protocol }), error => error instanceof ConfigurationError && error.message.includes('adapter'));
  }
});

test('future models on the compatible protocol need only configuration changes', async () => {
  async function app(client) { return (await client.evaluate(request)).answers.action.choice; }
  for (const [baseURL, model, apiKey] of [
    ['https://one.example/v1', 'vendor-one', 'key-one'],
    ['https://two.example/api', 'vendor-two', 'key-two'],
  ]) {
    const client = new SystemOne({ baseURL, model, apiKey, fetch: async (url, init) => {
      assert.equal(url, `${baseURL}/systemone`);
      assert.equal(JSON.parse(init.body).model, model);
      assert.equal(init.headers.get('authorization'), `Bearer ${apiKey}`);
      return jsonResponse({ ...nativePayload(), model });
    } });
    assert.equal(await app(client), 'drink');
  }
});

test('custom adapters can change request shape, response shape, and authentication', async () => {
  const adapter = {
    id: 'future-vendor', defaultModel: 'reflex-1', supportedQuestionTypes: ['choice', 'score', 'boolean'],
    prepare: ({ baseURL, model, request }) => ({ url: `${baseURL}/decisions`, body: { engine: model, context: request.state, queries: request.questions } }),
    authenticate: key => ({ 'x-api-key': key }),
    decode: payload => payload.evaluation,
  };
  const client = new SystemOne({ baseURL: 'https://future.example/api', apiKey: 'future-fixture', adapter, fetch: async (url, init) => {
    assert.equal(url, 'https://future.example/api/decisions');
    assert.equal(init.headers.get('x-api-key'), 'future-fixture');
    assert.equal(init.headers.get('authorization'), null);
    assert.deepEqual(JSON.parse(init.body), { engine: 'reflex-1', context: request.state, queries: request.questions });
    return jsonResponse({ evaluation: gatewayPayload() });
  } });
  assert.equal((await client.evaluate(request)).answers.action.choice, 'drink');
  const unsupported = new SystemOne({ baseURL: 'https://future.example', apiKey: 'fixture', adapter: { ...adapter, supportedQuestionTypes: ['boolean'] }, fetch: async () => assert.fail('must not run') });
  await assert.rejects(unsupported.evaluate(request), UnsupportedFeatureError);
});

test('headers merge case-insensitively while credentials and protocol headers stay reserved', async () => {
  const client = new SystemOne({ apiKey: 'fixture', headers: { 'X-Tenant': 'old' }, fetch: async (_, init) => {
    assert.equal(init.headers.get('x-tenant'), 'new');
    return jsonResponse(booleanPayload);
  } });
  await client.evaluate(booleanRequest, { headers: { 'x-tenant': 'new' } });
  for (const key of ['Authorization', 'CONTENT-TYPE', 'Host', 'Content-Length']) {
    await assert.rejects(client.evaluate(booleanRequest, { headers: { [key]: 'override' } }), ConfigurationError);
  }
});

test('input is snapshotted before resolving an asynchronous key', async () => {
  let resolveKey;
  const key = new Promise(resolve => { resolveKey = resolve; });
  const input = structuredClone(request);
  const client = new SystemOne({ apiKey: () => key, fetch: async (_, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.state.message, request.state.message);
    assert.deepEqual(body.questions.action.criteria, request.questions.action.criteria);
    return jsonResponse(nativePayload());
  } });
  const result = client.evaluate(input);
  input.state.message = 'A different instruction';
  delete input.questions.action.criteria.drink;
  resolveKey('fixture');
  assert.equal((await result).answers.action.choice, 'drink');
});

test('question builders preserve structured JSON instead of flattening it to a prompt', async () => {
  const questions = defineQuestions({
    ...request.questions,
    action: choice({ instruction: 'Choose', focus: ['message'] }, { drink: { includes: ['water'] }, rest: null }),
    urgency: score(null, [null, { name: 'medium' }, ['high']]),
    interrupt: booleanQuestion(['Should this interrupt?'], { true: { condition: 'new instruction' }, false: null }),
  });
  const client = new SystemOne({ apiKey: 'fixture', fetch: async (_, init) => {
    assert.deepEqual(JSON.parse(init.body).questions.action.instructions, questions.action.instructions);
    return jsonResponse(nativePayload());
  } });
  await client.evaluate({ state: [request.state, { history: [] }], questions });
});

test('keys such as __proto__ and constructor cannot pollute prototypes or disappear', async () => {
  const criteria = Object.fromEntries([['__proto__', null], ['constructor', null]]);
  const questions = Object.fromEntries([['__proto__', choice('Pick an option', criteria)]]);
  const payload = { answers: Object.fromEntries([['__proto__', {
    type: 'choice', choice: '__proto__', probabilities: Object.fromEntries([['__proto__', 1], ['constructor', 0]]),
  }]]) };
  const client = new SystemOne({ apiKey: null, fetch: async () => jsonResponse(payload) });
  const result = await client.evaluate({ state: {}, questions });
  assert.equal(result.answers.__proto__.choice, '__proto__');
  assert.equal(result.answers.__proto__.probabilities.constructor, 0);
  assert.equal(Object.getPrototypeOf(result.answers), Object.prototype);
  assert.equal(Object.prototype.polluted, undefined);
});
