import { createFetchTransport } from '@system-one-ai/transport-fetch';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { APIError, ConfigurationError, RequestAbortedError, ResponseValidationError, SystemOne, TimeoutError, UnsupportedFeatureError, booleanQuestion } from '@system-one-ai/core';
import { cloudflareAdapter } from '@system-one-ai/adapter-cloudflare';
import { evaluateMany } from '@system-one-ai/batch';
import { request, nativePayload, jsonResponse } from './fixtures.mjs';

const accountId = '0123456789abcdef0123456789abcdef';
const adapter = cloudflareAdapter({ accountId });
const expectedURL = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`;
const envelope = result => ({ success: true, errors: [], messages: [], result });
const runnerResult = result => ({ state: 'Completed', result, gatewayMetadata: { keySource: 'Unified' } });
const runnerEnvelope = result => envelope(runnerResult(result));

// Native answers follow the model page; runner fixtures cover the reported compatibility fix.
// Fixtures remain offline; they do not establish access to a Cloudflare account.
for (const [wrapped, wrap] of [['raw', value => value], ['wrapped', envelope], ['runner', runnerEnvelope], ['raw runner', runnerResult]]) {
  test(`Cloudflare uses its default endpoint/model and normalizes ${wrapped} native results`, async () => {
    let calls = 0;
    const input = structuredClone(request);
    const client = new SystemOne({ adapter, apiKey: 'cloudflare-fixture', transport: createFetchTransport(async (url, init) => {
      calls++;
      assert.equal(url, expectedURL);
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.get('authorization'), 'Bearer cloudflare-fixture');
      assert.equal(init.headers.get('content-type'), 'application/json');
      assert.equal(init.headers.get('ai-model-id'), null);
      assert.deepEqual(JSON.parse(init.body), {
        model: 'typesafe/jev',
        input: { state: request.state, questions: { ...request.questions, interrupt: { ...request.questions.interrupt, type: 'noul' } } },
      });
      const payload = wrap(nativePayload());
      return jsonResponse(payload, { headers: { 'x-request-id': 'cf-fixture-request' } });
    }) });
    const result = await client.evaluate(input);
    assert.equal(calls, 1);
    assert.equal(result.model, 'jev-1.13.0');
    assert.equal(result.response.adapter, 'cloudflare');
    assert.equal(result.response.requestId, 'cf-fixture-request');
    assert.equal(result.answers.action.choice, 'drink');
    assert.deepEqual(result.answers.action.probabilities, { drink: 0.86, rest: 0.14 });
    assert.equal(result.answers.action.confidence, 0.73);
    assert.deepEqual(result.answers.interrupt, { type: 'boolean', probability: 0.94 });
    assert.equal(result.answers.urgency.score, 1.6);
    assert.equal(result.answers.urgency.legend['2'], 'High');
    assert.deepEqual(result.usage, { inputTokens: 215, outputTokens: 31, totalTokens: 246 });
    assert.deepEqual(input, request);
  });
}

test('runner states are checked before unwrapping at every level', async () => {
  for (const state of ['Failed', 'Running', 'Pending', 'Cancelled', '', null, 1, {}, ['Completed']]) {
    for (const wrap of [value => value, envelope]) {
      let calls = 0;
      const client = new SystemOne({ adapter, apiKey: null, transport: createFetchTransport(async () => {
        calls++;
        return jsonResponse(wrap({ state, result: nativePayload() }));
      }) });
      await assert.rejects(client.evaluate(request), ResponseValidationError, `must reject runner state ${JSON.stringify(state)}`);
      assert.equal(calls, 1);
    }
  }
});

test('runner contents cannot hide errors, ambiguous answers or additional envelopes', async () => {
  const malformed = [
    { ...runnerResult(nativePayload()), answers: nativePayload().answers },
    runnerResult({ ...nativePayload(), result: nativePayload() }),
    runnerResult({ ...nativePayload(), state: 'Failed' }),
    runnerResult({ ...nativePayload(), error: { message: 'secret-echo' } }),
    runnerResult({ ...nativePayload(), errors: [{ message: 'secret-echo' }] }),
    runnerResult({ ...nativePayload(), success: false }),
    { state: 'Completed' },
    runnerResult(null),
    runnerResult([]),
    runnerResult('secret-echo'),
    runnerResult({}),
  ];
  for (const payload of malformed) {
    for (const wrap of [value => value, envelope]) {
      let calls = 0;
      const client = new SystemOne({ adapter, apiKey: null, transport: createFetchTransport(async () => { calls++; return jsonResponse(wrap(payload)); }) });
      await assert.rejects(client.evaluate(request), error => error instanceof ResponseValidationError
        && !error.message.includes('secret-echo') && !JSON.stringify(error).includes('secret-echo'));
      assert.equal(calls, 1);
    }
  }
  const tooDeep = new SystemOne({ adapter, apiKey: null, transport: createFetchTransport(async () => jsonResponse(envelope(runnerResult(runnerResult(nativePayload()))))) });
  await assert.rejects(tooDeep.evaluate(request), ResponseValidationError);
});

for (const [baseURL, expected] of [
  ['https://api.cloudflare.com', expectedURL],
  ['https://api.cloudflare.com/client/v4/', expectedURL],
  ['https://api.cloudflare.com/client/v4/accounts/', expectedURL],
  [`https://api.cloudflare.com/client/v4/accounts/${accountId}`, expectedURL],
  [`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`, expectedURL],
  [`${expectedURL}/`, expectedURL],
  ['https://proxy.example/team/client/v4', `https://proxy.example/team/client/v4/accounts/${accountId}/ai/run`],
  [`https://proxy.example/team/accounts/${accountId}/ai/run`, `https://proxy.example/team/accounts/${accountId}/ai/run`],
  ['https://proxy.example/team/ai', 'https://proxy.example/team/ai/run'],
  ['https://proxy.example/team/ai/run', 'https://proxy.example/team/ai/run'],
]) {
  test(`Cloudflare URL override preserves the selected origin and prefix: ${baseURL}`, async () => {
    const client = new SystemOne({ adapter, baseURL, apiKey: 'fixture', transport: createFetchTransport(async url => {
      assert.equal(url, expected);
      return jsonResponse(nativePayload());
    }) });
    await client.evaluate(request);
  });
}

test('Cloudflare account configuration is validated and snapshotted before I/O', () => {
  for (const options of [undefined, null, {}, [], { accountId: '' }, { accountId: 12 }, { accountId: '../other' }, { accountId: 'a/b' }, { accountId: 'a?b' }, { accountId: 'a#b' }, { accountId: '%2e%2e' }, { accountId: ' foo ' }, { accountId: 'a\n' }, { accountId: 'a\r\n' }, { accountId, apiKey: 'misplaced' }]) {
    assert.throws(() => cloudflareAdapter(options), ConfigurationError);
  }
  let reads = 0;
  assert.throws(() => cloudflareAdapter({ get accountId() { reads++; return accountId; } }), ConfigurationError);
  assert.equal(reads, 0);
  const options = { accountId };
  const configured = cloudflareAdapter(options);
  options.accountId = 'changed';
  assert.equal(configured.defaultBaseURL, expectedURL);
  assert.ok(Object.isFrozen(configured));
  assert.ok(Object.isFrozen(configured.supportedQuestionTypes));
  assert.notEqual(cloudflareAdapter({ accountId: 'other-account' }).defaultBaseURL, expectedURL);
});

test('a conflicting account or legacy model URL is rejected before credential resolution', async () => {
  for (const baseURL of [
    'https://api.cloudflare.com/client/v4/accounts/another-account/ai/run',
    `${expectedURL}/typesafe/jev`,
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/unexpected`,
  ]) {
    const client = new SystemOne({ adapter, baseURL, apiKey: () => assert.fail('must not resolve credentials'), transport: createFetchTransport(() => assert.fail('must not send requests')) });
    await assert.rejects(client.evaluate(request), ConfigurationError);
  }
});

test('Cloudflare does not forward undocumented options or silently replace model IDs', async () => {
  const denied = new SystemOne({ transport: createFetchTransport(), adapter, apiKey: () => assert.fail('must fail before authentication') });
  for (const providerOptions of [{ cloudflare: { model: 'other' } }, { cloudflare: { stream: true } }, { cloudflare: {} }, { openrouter: {} }]) {
    await assert.rejects(denied.evaluate({ ...request, providerOptions }), UnsupportedFeatureError);
  }
  const sent = [];
  const client = new SystemOne({ adapter, apiKey: null, model: 'vendor/decision-1', transport: createFetchTransport(async (_, init) => {
    const body = JSON.parse(init.body);
    sent.push(body.model);
    return jsonResponse({ ...nativePayload(), model: body.model });
  }) });
  assert.equal((await client.evaluate({ ...request, providerOptions: {} })).model, 'vendor/decision-1');
  assert.equal((await client.evaluate({ ...request, model: 'vendor/decision-2' })).model, 'vendor/decision-2');
  assert.deepEqual(sent, ['vendor/decision-1', 'vendor/decision-2']);
});

for (const [label, payload] of [
  ['failed envelope with valid answers', () => ({ ...envelope(nativePayload()), success: false })],
  ['non-boolean success', () => ({ ...envelope(nativePayload()), success: 1 })],
  ['nonempty errors', () => ({ ...envelope(nativePayload()), errors: [{ code: 1000, message: 'secret-echo' }] })],
  ['malformed errors', () => ({ ...envelope(nativePayload()), errors: {} })],
  ['missing result', () => ({ success: true, errors: [] })],
  ['null result', () => envelope(null)],
  ['array result', () => envelope([])],
  ['in-band root error', () => ({ ...nativePayload(), error: 'secret-echo' })],
  ['in-band nested error', () => envelope({ ...nativePayload(), error: { message: 'secret-echo' } })],
  ['nested failure', () => envelope({ ...nativePayload(), success: false })],
  ['nested errors', () => envelope({ ...nativePayload(), errors: ['secret-echo'] })],
  ['runner not completed', () => envelope({ state: 'Failed', result: nativePayload() })],
  ['runner missing result', () => envelope({ state: 'Completed' })],
  ['ambiguous raw and wrapped result', () => ({ ...nativePayload(), result: nativePayload() })],
  ['undeclared action', () => { const raw = nativePayload(); raw.answers.action.choice = 'fly'; return envelope(raw); }],
  ['invalid probability', () => { const raw = nativePayload(); raw.answers.interrupt.noul = 1.1; return raw; }],
  ['invalid usage', () => { const raw = nativePayload(); raw.usage.input_tokens = -1; return raw; }],
]) {
  test(`Cloudflare rejects ${label} without retrying or exposing the error body`, async () => {
    let calls = 0;
    const client = new SystemOne({ adapter, apiKey: null, transport: createFetchTransport(async () => { calls++; return jsonResponse(payload()); }) });
    await assert.rejects(client.evaluate(request), error => error instanceof ResponseValidationError && !JSON.stringify(error).includes('secret-echo'));
    assert.equal(calls, 1);
  });
}

test('Jev rounding is preserved while future model statistics remain explicit', async () => {
  const raw = nativePayload();
  raw.answers.urgency = { type: 'score', score: 1.05, probabilities: { '0': 0, '1': 0.94, '2': 0.06 } };
  const client = new SystemOne({ adapter, apiKey: null, transport: createFetchTransport(async () => jsonResponse(envelope(raw))) });
  assert.equal((await client.evaluate(request)).answers.urgency.score, 1.05);
  raw.model = 'future/decision';
  await assert.rejects(client.evaluate(request), ResponseValidationError);
  raw.rounding = { probabilityDecimals: 2, scoreDecimals: 2 };
  assert.equal((await client.evaluate(request)).answers.urgency.score, 1.05);
});

test('missing optional statistics stay missing, including through the batch scheduler', async () => {
  const client = new SystemOne({ adapter, apiKey: null, transport: createFetchTransport(async (_, init) => {
    const { input } = JSON.parse(init.body);
    return jsonResponse(runnerEnvelope({ answers: { on: { type: 'noul', noul: input.state.on ? 0.99 : 0.01 } } }));
  }) });
  const report = await evaluateMany(client, [true, false].map(on => ({ id: String(on), request: { state: { on }, questions: { on: booleanQuestion('Is it on?') } } })), { concurrency: 2 });
  assert.equal(report.summary.succeeded, 2);
  assert.deepEqual(report.items.map(item => item.value.answers.on.probability), [0.99, 0.01]);
  assert.equal(report.items[0].value.model, 'typesafe/jev');
  assert.deepEqual(report.items[0].value.usage, {});
  assert.equal(report.items[0].value.providerMetadata, undefined);
  assert.deepEqual(report.summary.reportedUsage, {});
});

test('Cloudflare HTTP failures retain status and Retry-After while response bodies stay private', async () => {
  const failed = new SystemOne({ adapter, apiKey: null, transport: createFetchTransport(async () => jsonResponse({ errors: [{ message: 'secret-echo' }] }, { status: 401, headers: { 'x-request-id': 'cf-failed' } })) });
  await assert.rejects(failed.evaluate(request), error => error instanceof APIError && error.statusCode === 401 && error.requestId === 'cf-failed' && !JSON.stringify(error).includes('secret-echo'));
  let attempts = 0;
  const retrying = new SystemOne({ adapter, apiKey: null, maxRetries: 1, transport: createFetchTransport(async () => {
    attempts++;
    return attempts === 1 ? jsonResponse({}, { status: 429, headers: { 'retry-after': '0' } }) : jsonResponse(envelope(nativePayload()));
  }) });
  assert.equal((await retrying.evaluate(request)).response.attempts, 2);
  assert.equal(attempts, 2);
});

test('Cloudflare cancellation and total deadlines also bound non-cooperative transports', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  const notStarted = new SystemOne({ transport: createFetchTransport(), adapter, apiKey: () => assert.fail('no authentication after cancellation') });
  await assert.rejects(notStarted.evaluate(request, { signal: cancelled.signal }), RequestAbortedError);
  let signal;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const client = new SystemOne({ adapter, apiKey: null, transport: createFetchTransport((_url, init) => { signal = init.signal; started(); return new Promise(() => {}); }) });
  const controller = new AbortController();
  const pending = client.evaluate(request, { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, RequestAbortedError);
  assert.equal(signal.aborted, true);
  await assert.rejects(client.evaluate(request, { timeoutMs: 30 }), TimeoutError);
});

test('Cloudflare uses native Fetch against a real local HTTP server with the complete REST body', async t => {
  let received;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { url: req.url, method: req.method, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(runnerEnvelope(nativePayload())));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const client = new SystemOne({ transport: createFetchTransport(), adapter, apiKey: 'local-fixture', baseURL: `http://127.0.0.1:${server.address().port}/client/v4`, maxRetries: 0 });
  const result = await client.evaluate(request);
  assert.equal(received.url, `/client/v4/accounts/${accountId}/ai/run`);
  assert.equal(received.method, 'POST');
  assert.equal(received.authorization, 'Bearer local-fixture');
  assert.equal(received.body.model, 'typesafe/jev');
  assert.deepEqual(received.body.input.state, request.state);
  assert.equal(received.body.input.questions.interrupt.type, 'noul');
  assert.equal(result.answers.action.choice, 'drink');
  assert.equal(result.response.attempts, 1);
});
