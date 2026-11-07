import { createFetchTransport } from '@system-one-ai/transport-fetch';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { APIError, ConfigurationError, RequestAbortedError, ResponseValidationError, SystemOne, TimeoutError, UnsupportedFeatureError, ValidationError, booleanQuestion } from '@system-one-ai/core';
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

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const png = `data:image/png;base64,${pngBase64}`;

test('Clef uses the model-specific REST contract with images and unrounded native answers', async t => {
  const received = [];
  const raw = { ...nativePayload(), model: 'clef', answers: {
    ...nativePayload().answers,
    action: { type: 'choice', choice: 'drink', probabilities: { drink: 0.876543, rest: 0.123457 }, confidence: 0.456789 },
  } };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(envelope(raw)));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const client = new SystemOne({ adapter, apiKey: null, transport: createFetchTransport(),
    baseURL: `http://127.0.0.1:${server.address().port}/team/ai/run`, model: '@cf/cloudflare/clef', maxRetries: 0 });
  const result = await client.evaluate({ ...request, images: [png, { mediaType: 'image/png', base64: pngBase64 }] });
  assert.deepEqual(received[0], {
    url: '/team/ai/run/@cf/cloudflare/clef',
    body: { model: 'clef', state: request.state, questions: { ...request.questions, interrupt: { ...request.questions.interrupt, type: 'noul' } },
      images: [png, { content_type: 'image/png', base64: pngBase64 }] },
  });
  assert.equal(result.answers.action.probabilities.drink, 0.876543);
  assert.equal(result.answers.action.confidence, 0.456789);
  assert.equal(result.answers.interrupt.probability, 0.94);
  assert.equal(result.answers.urgency.score, 1.6);
  assert.deepEqual(result.usage, { inputTokens: 215, outputTokens: 31, totalTokens: 246 });
  assert.equal(result.rounding, undefined);
  await client.evaluate({ ...request, model: '@cf/cloudflare/clef-flash' });
  assert.equal(received[1].url, '/team/ai/run/@cf/cloudflare/clef-flash');
  assert.equal(received[1].body.model, 'clef-flash');
  assert.equal('images' in received[1].body, false);
  assert.equal('input' in received[1].body, false);
});

test('Clef enforces its image limits before credentials or I/O', async () => {
  const client = new SystemOne({ adapter, model: '@cf/cloudflare/clef',
    apiKey: () => assert.fail('invalid images must not resolve credentials'),
    transport: createFetchTransport(() => assert.fail('invalid images must not send requests')) });
  const cases = [
    Array(5).fill(png),
    ['data:image/gif;base64,AAAA'],
    [{ mediaType: 'image/svg+xml', base64: 'AAAA' }],
    [{ mediaType: 'image/png', base64: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64') }],
    Array(3).fill({ mediaType: 'image/png', base64: Buffer.alloc(3 * 1024 * 1024).toString('base64') }),
  ];
  for (const images of cases) {
    await assert.rejects(client.evaluate({ ...request, images }), error => error instanceof ValidationError && error.path.startsWith('images'));
  }
  for (const providerOptions of [{ images: [png] }, { cloudflare: { images: [png] } }, { cloudflare: { model: 'clef-flash' } }]) {
    await assert.rejects(client.evaluate({ ...request, providerOptions }), UnsupportedFeatureError);
  }
  await assert.rejects(client.evaluate({ ...request, model: 'typesafe/jev', images: [png] }), UnsupportedFeatureError);
});

const decisionsState = { ticket: 'The same order was charged twice.', order: { charges: [49, 49] } };
const decisionsQuestions = {
  billing: { type: 'boolean', instructions: 'Is this about billing?', criteria: { true: 'Charges, invoices, or refunds.', false: 'Other topics.' } },
  department: {
    type: 'choice', instructions: 'Which team should handle it?',
    criteria: { billing: 'Payments and refunds', technical: 'Product issues', shipping: 'Delivery and tracking' },
  },
  severity: { type: 'score', instructions: 'How severe is it?', criteria: ['Cosmetic', 'Workaround available', 'Fully blocked'] },
};
const decisionsRequest = { state: decisionsState, questions: decisionsQuestions };
const decisionsPayload = () => ({
  model: 'gpt-6-luna',
  answers: [
    { type: 'predicate', name: 'billing', probability: 0.93 },
    {
      type: 'choice', name: 'department', choice: 'billing', confidence: 0.88,
      probabilities: [
        { value: 'billing', probability: 0.88 },
        { value: 'technical', probability: 0.07 },
        { value: 'shipping', probability: 0.05 },
      ],
    },
    {
      type: 'score', name: 'severity', score: 1.2, confidence: 0.7,
      probabilities: [
        { value: 0, label: 'Cosmetic', probability: 0.1 },
        { value: 1, label: 'Workaround available', probability: 0.6 },
        { value: 2, label: 'Fully blocked', probability: 0.3 },
      ],
    },
  ],
  usage: {
    input_tokens: 123, output_tokens: 0, total_tokens: 123,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
});

for (const [wrapped, wrap] of [['raw', value => value], ['wrapped', envelope], ['runner', runnerEnvelope], ['raw runner', runnerResult]]) {
  test(`Cloudflare encodes and decodes the OpenAI Decisions ${wrapped} contract`, async () => {
    let calls = 0;
    const client = new SystemOne({ adapter, model: 'openai/decisions', apiKey: null, transport: createFetchTransport(async (url, init) => {
      calls++;
      assert.equal(url, expectedURL);
      assert.deepEqual(JSON.parse(init.body), {
        model: 'openai/decisions',
        input: {
          input: JSON.stringify(decisionsState),
          questions: [
            {
              name: 'billing', type: 'predicate',
              instructions: 'Is this about billing?\nTrue criteria: Charges, invoices, or refunds.\nFalse criteria: Other topics.',
            },
            {
              name: 'department', type: 'choice', instructions: 'Which team should handle it?',
              choices: [
                { value: 'billing', description: 'Payments and refunds' },
                { value: 'technical', description: 'Product issues' },
                { value: 'shipping', description: 'Delivery and tracking' },
              ],
            },
            {
              name: 'severity', type: 'score', instructions: 'How severe is it?',
              levels: [{ label: 'Cosmetic' }, { label: 'Workaround available' }, { label: 'Fully blocked' }],
            },
          ],
        },
      });
      return jsonResponse(wrap(decisionsPayload()));
    }) });
    const result = await client.evaluate(decisionsRequest);
    assert.equal(calls, 1);
    assert.equal(result.model, 'gpt-6-luna');
    assert.deepEqual(result.answers.billing, { type: 'boolean', probability: 0.93 });
    assert.equal(result.answers.department.choice, 'billing');
    assert.deepEqual(result.answers.department.probabilities, { billing: 0.88, technical: 0.07, shipping: 0.05 });
    assert.equal(result.answers.department.confidence, 0.88);
    assert.equal(result.answers.severity.score, 1.2);
    assert.deepEqual(result.answers.severity.probabilities, { 0: 0.1, 1: 0.6, 2: 0.3 });
    assert.deepEqual(result.answers.severity.legend, { 0: 'Cosmetic', 1: 'Workaround available', 2: 'Fully blocked' });
    assert.equal(result.answers.severity.confidence, 0.7);
    assert.deepEqual(result.usage, { inputTokens: 123, outputTokens: 0, totalTokens: 123 });
    assert.equal(result.rounding, undefined);
  });
}

test('OpenAI Decisions encodes state as text and preserves image order', async () => {
  let body;
  const client = new SystemOne({ adapter, model: 'openai/decisions', apiKey: null, transport: createFetchTransport(async (_, init) => {
    body = JSON.parse(init.body);
    return jsonResponse({ model: 'gpt-6-luna',
      answers: [{ type: 'predicate', name: 'visible', probability: 0.8 }], usage: {} });
  }) });
  const state = { note: 'Inspect the evidence.', tags: ['a', 'b'] };
  await client.evaluate({
    state,
    images: [png, { mediaType: 'image/jpeg', base64: pngBase64 }],
    questions: { visible: booleanQuestion('Is damage visible?') },
  });
  assert.deepEqual(body, {
    model: 'openai/decisions',
    input: {
      input: [{
        role: 'user', type: 'message',
        content: [
          { type: 'input_text', text: JSON.stringify(state) },
          { type: 'input_image', image_url: png },
          { type: 'input_image', image_url: `data:image/jpeg;base64,${pngBase64}` },
        ],
      }],
      questions: [{ name: 'visible', type: 'predicate', instructions: 'Is damage visible?' }],
    },
  });
});

test('OpenAI Decisions rejects refusals and malformed answer arrays without retrying', async () => {
  const oneRequest = { state: 'The light is on.', questions: { on: booleanQuestion('Is it on?') } };
  for (const payload of [
    { model: 'gpt-6-luna', answers: [{ type: 'refusal', name: 'on' }], usage: {} },
    { model: 'gpt-6-luna', answers: [], usage: {} },
    { model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'other', probability: 0.5 }], usage: {} },
    { model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'on', probability: 1.1 }], usage: {} },
    { model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'on', probability: 0.5 }], usage: { input_tokens: -1 } },
  ]) {
    let calls = 0;
    const client = new SystemOne({ adapter, model: 'openai/decisions', apiKey: null,
      transport: createFetchTransport(async () => { calls++; return jsonResponse(payload); }) });
    await assert.rejects(client.evaluate(oneRequest), ResponseValidationError);
    assert.equal(calls, 1);
  }
});

test('OpenAI Decisions rejects duplicate answer names and mismatched answer types', async () => {
  const twoQuestions = { state: 'x', questions: {
    a: booleanQuestion('A?'), b: booleanQuestion('B?'),
  } };
  for (const answers of [
    [{ type: 'predicate', name: 'a', probability: 0.5 }, { type: 'predicate', name: 'a', probability: 0.5 }],
    [{ type: 'predicate', name: 'a', probability: 0.5 }, { type: 'choice', name: 'b', choice: 'x' }],
  ]) {
    let calls = 0;
    const client = new SystemOne({ adapter, model: 'openai/decisions', apiKey: null,
      transport: createFetchTransport(async () => { calls++; return jsonResponse({ model: 'gpt-6-luna', answers, usage: {} }); }) });
    await assert.rejects(client.evaluate(twoQuestions), ResponseValidationError);
    assert.equal(calls, 1);
  }
});

test('OpenAI Decisions validates protocol limits before credentials or I/O', async () => {
  const client = new SystemOne({ adapter, model: 'openai/decisions',
    apiKey: () => assert.fail('invalid requests must not resolve credentials'),
    transport: createFetchTransport(() => assert.fail('invalid requests must not be sent')) });
  const tooManyQuestions = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [
    `q${index}`, booleanQuestion('Question?'),
  ]));
  await assert.rejects(client.evaluate({ state: 'x', questions: tooManyQuestions }), ValidationError);
  await assert.rejects(client.evaluate({ state: 'x', questions: {
    one: { type: 'choice', instructions: 'Pick', criteria: { only: 'Only option' } },
  } }), ValidationError);
  await assert.rejects(client.evaluate({ state: 'x', questions: {
    many: { type: 'choice', instructions: 'Pick', criteria: Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`c${index}`, 'Option'])) },
  } }), ValidationError);
  await assert.rejects(client.evaluate({ state: 'x', questions: {
    many: { type: 'score', instructions: 'Rate', criteria: Array.from({ length: 11 }, (_, index) => `level ${index}`) },
  } }), ValidationError);
  await assert.rejects(client.evaluate({ state: 'x', questions: { on: booleanQuestion('On?') }, providerOptions: { openai: {} } }), UnsupportedFeatureError);
});
