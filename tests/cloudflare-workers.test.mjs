import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { APIError, BindingError, ConfigurationError, RequestAbortedError, ResponseValidationError, TimeoutError, UnsupportedFeatureError, ValidationError, booleanQuestion, choice, score } from '@system-one-ai/core';
import { CloudflareWorkers, createCloudflareWorkers } from '@system-one-ai/adapter-cloudflare/workers';
import { choiceFrom, defineDecision } from '@system-one-ai/decisions';
import { gateChoice } from '@system-one-ai/policies';
import { evaluateMany } from '@system-one-ai/batch';

const request = () => ({ state: { message: 'Route this' }, questions: { route: choice('Where?', { a: 'Team A', b: 'Team B' }) } });
const payload = () => ({ model: 'jev-1.13.0', answers: { route: { type: 'choice', choice: 'a', probabilities: { a: 0.9, b: 0.1 }, confidence: 0.53 } }, usage: { input_tokens: 10, output_tokens: 2 } });
const response = (body = payload(), init = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('native binding invokes run with receiver, all primitives, signal and raw response', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Public fetch must not be used'); });
  const binding = {
    calls: 0,
    async run(model, input, options) {
      assert.strictEqual(this, binding);
      this.calls++;
      assert.equal(model, 'typesafe/jev');
      assert.deepEqual(Object.keys(input).sort(), ['questions', 'state']);
      assert.equal(input.questions.urgent.type, 'noul');
      assert.equal(input.questions.route.type, 'choice');
      assert.equal(input.questions.quality.type, 'score');
      assert.equal(options.returnRawResponse, true);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.signal.aborted, false);
      assert.deepEqual(options.extraHeaders, {});
      return response({ ...payload(), answers: { ...payload().answers,
        urgent: { type: 'noul', noul: 0.97 },
        quality: { type: 'score', score: 1.04, probabilities: { 0: 0, 1: 0.96, 2: 0.04 }, confidence: 0.94 },
      } }, { status: 201, headers: { 'cf-ai-req-id': 'native-req' } });
    },
  };
  const client = createCloudflareWorkers({ binding });
  const result = await client.evaluate({ ...request(), questions: {
    ...request().questions, urgent: booleanQuestion('Urgent?'), quality: score('Quality?', ['low', 'medium', 'high']),
  } });
  assert.ok(client instanceof CloudflareWorkers);
  assert.equal(binding.calls, 1);
  assert.equal(result.model, 'jev-1.13.0');
  assert.equal(result.answers.urgent.probability, 0.97);
  assert.equal(result.answers.quality.score, 1.04);
  assert.equal(result.answers.route.confidence, 0.53);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 2, totalTokens: 12 });
  assert.deepEqual(result.response, { status: 201, requestId: 'native-req', attempts: 1, durationMs: result.response.durationMs, adapter: 'cloudflare-workers' });
});

test('completed envelopes decode; failed, pending, ambiguous and invalid results do not retry', async () => {
  for (const body of [payload(), { result: payload() }, { state: 'Completed', result: payload() }, { success: true, errors: [], result: { state: 'Completed', result: payload() } }]) {
    const client = createCloudflareWorkers({ binding: { run: async () => response(body) } });
    assert.equal((await client.evaluate(request())).answers.route.choice, 'a');
  }
  for (const body of [{ state: 'Failed', result: payload() }, { state: 'Pending', result: payload() },
    { state: 'Completed' }, { success: false, result: payload() }, { result: { errors: ['failure'], result: payload() } },
    { answers: payload().answers, result: payload() }, { result: { result: { result: payload() } } },
    { answers: { route: { type: 'choice', choice: 'invented' } } }]) {
    let calls = 0;
    const client = createCloudflareWorkers({ binding: { async run() { calls++; return response(body); } } });
    await assert.rejects(client.evaluate(request()), ResponseValidationError);
    assert.equal(calls, 1);
  }
  await assert.rejects(createCloudflareWorkers({ binding: { run: async () => payload() } }).evaluate(request()), ResponseValidationError);
});

test('missing usage and IDs stay absent; shared binding metadata is never read', async () => {
  const binding = {
    get lastRequestId() { throw new Error('Shared metadata is unsafe'); },
    get lastRequestHttpStatusCode() { throw new Error('Shared metadata is unsafe'); },
    run: async () => response({ answers: payload().answers }),
  };
  const result = await createCloudflareWorkers({ binding }).evaluate(request());
  assert.equal(result.model, 'typesafe/jev');
  assert.deepEqual(result.usage, {});
  assert.equal('requestId' in result.response, false);
});

test('invalid options, headers and inputs reject before binding invocation', async () => {
  let calls = 0;
  const binding = { async run() { calls++; return response(); } };
  for (const options of [{}, { binding: {} }, { binding, apiKey: 'secret' }, { binding, accountId: 'account' },
    { binding, baseURL: 'https://example.com' }, { binding, timeoutMs: 0 }, { binding, maxRetries: -1 },
    { binding, maxResponseBytes: 0 }, { binding, model: '' }, { binding, headers: { Authorization: 'secret' } }]) {
    assert.throws(() => createCloudflareWorkers(options), ConfigurationError);
  }
  const client = createCloudflareWorkers({ binding });
  await assert.rejects(client.evaluate({ ...request(), state: null }), ValidationError);
  await assert.rejects(client.evaluate({ ...request(), providerOptions: { stream: true } }), UnsupportedFeatureError);
  await assert.rejects(client.evaluate(request(), { signal: {} }), ConfigurationError);
  for (const header of ['authorization', 'cf-consn-model-id', 'content-type', 'host']) {
    await assert.rejects(client.evaluate(request(), { headers: { [header]: 'override' } }), ConfigurationError);
  }
  assert.equal(calls, 0);
});

test('model overrides and snapshots survive caller mutation while the binding awaits', async () => {
  const latch = deferred();
  const source = request();
  source.model = 'typesafe/jev-pinned';
  const headers = new Headers({ 'x-trace': 'before' });
  const defaults = new Headers({ 'x-default': 'configured', 'x-trace': 'default' });
  const binding = { async run(model, input, options) {
    await latch.promise;
    assert.equal(model, 'typesafe/jev-pinned');
    assert.equal(input.state.message, 'Route this');
    assert.deepEqual(Object.keys(input.questions.route.criteria), ['a', 'b']);
    assert.deepEqual(options.extraHeaders, { 'x-default': 'configured', 'x-trace': 'before' });
    return response();
  } };
  const client = createCloudflareWorkers({ binding, model: 'typesafe/jev-other', headers: defaults });
  defaults.set('x-default', 'changed');
  const pending = client.evaluate(source, { headers });
  source.state.message = 'changed';
  source.questions.route.criteria.c = 'changed';
  headers.set('x-trace', 'changed');
  binding.run = async () => { throw new Error('method was replaced'); };
  latch.resolve();
  assert.equal((await pending).answers.route.choice, 'a');
});

test('binding mutation cannot change validation or retried input', async () => {
  let calls = 0;
  const client = createCloudflareWorkers({ retryDelayMs: 0, binding: { async run(model, input) {
    assert.deepEqual(Object.keys(input.questions.route.criteria), ['a', 'b']);
    assert.equal(input.state.message, 'Route this');
    input.questions.route.criteria.c = 'injected';
    input.state.message = 'changed by binding';
    if (++calls === 1) return new Response('unavailable', { status: 503 });
    return response();
  } } });
  assert.equal((await client.evaluate(request())).response.attempts, 2);
});

test('thrown binding errors are sanitized, separately typed and not retried', async () => {
  for (const sync of [true, false]) {
    let calls = 0;
    const client = createCloudflareWorkers({ binding: { run() {
      calls++;
      const error = new Error('secret input or token');
      if (sync) throw error;
      return Promise.reject(error);
    } } });
    await assert.rejects(client.evaluate(request()), error => {
      assert.ok(error instanceof BindingError);
      assert.equal(error.code, 'binding');
      assert.equal(error.cause, undefined);
      assert.ok(!String(error).includes('secret'));
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('HTTP errors retain status, request ID and Retry-After without upstream text', async () => {
  const client = createCloudflareWorkers({ maxRetries: 0, binding: { run: async () => new Response('secret body', {
    status: 429, headers: { 'cf-ai-req-id': 'limited', 'retry-after': '2' },
  }) } });
  await assert.rejects(client.evaluate(request()), error => {
    assert.ok(error instanceof APIError);
    assert.equal(error.statusCode, 429);
    assert.equal(error.requestId, 'limited');
    assert.equal(error.retryAfterMs, 2000);
    assert.ok(!String(error).includes('secret'));
    return true;
  });
});

test('transient HTTP failures retry and per-call maxRetries can disable retries', async () => {
  let calls = 0;
  const client = createCloudflareWorkers({ binding: { async run() {
    if (++calls % 2) return new Response(null, { status: 503, headers: { 'retry-after-ms': '1' } });
    return response();
  } } });
  assert.equal((await client.evaluate(request())).response.attempts, 2);
  await assert.rejects(client.evaluate(request(), { maxRetries: 0 }), APIError);
  assert.equal(calls, 3);
});

test('permanent HTTP errors and redirects are not retried', async () => {
  for (const status of [302, 400, 401, 403, 404, 422]) {
    let calls = 0;
    const client = createCloudflareWorkers({ binding: { async run() { calls++; return new Response('failure', { status }); } } });
    await assert.rejects(client.evaluate(request()), error => error instanceof APIError && error.statusCode === status);
    assert.equal(calls, 1);
  }
});

test('Retry-After beyond the total budget cannot trigger an early retry', async () => {
  let calls = 0;
  const client = createCloudflareWorkers({ binding: { async run() {
    calls++;
    return new Response(null, { status: 429, headers: { 'retry-after': '60' } });
  } } });
  await assert.rejects(client.evaluate(request(), { timeoutMs: 100 }), TimeoutError);
  assert.equal(calls, 1);
});

test('pre-aborted signals make no calls and in-flight cancellation reaches the binding', async () => {
  let calls = 0; let bindingSignal;
  const client = createCloudflareWorkers({ binding: { run(model, input, options) {
    calls++; bindingSignal = options.signal;
    return new Promise(() => {});
  } } });
  const pre = new AbortController(); pre.abort();
  await assert.rejects(client.evaluate(request(), { signal: pre.signal }), RequestAbortedError);
  assert.equal(calls, 0);
  const controller = new AbortController();
  const pending = client.evaluate(request(), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, RequestAbortedError);
  assert.equal(bindingSignal.aborted, true);
  assert.equal(calls, 1);
});

test('deadline bounds an uncooperative binding and cancels a late response body', async () => {
  const late = deferred(); let signal;
  const client = createCloudflareWorkers({ binding: { run(model, input, options) { signal = options.signal; return late.promise; } } });
  await assert.rejects(client.evaluate(request(), { timeoutMs: 20 }), TimeoutError);
  assert.equal(signal.aborted, true);
  let cancelled = false;
  late.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await nextTurn();
  assert.equal(cancelled, true);
});

test('total deadline includes a stalled response body and cancels the reader', async () => {
  let cancelled = false;
  const client = createCloudflareWorkers({ binding: { run: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) } });
  await assert.rejects(client.evaluate(request(), { timeoutMs: 20 }), TimeoutError);
  assert.equal(cancelled, true);
});

test('bounded decoding rejects oversized, invalid UTF-8 and invalid JSON without retry', async () => {
  for (const build of [() => new Response('x'.repeat(100)), () => new Response('x', { headers: { 'content-length': '100' } }),
    () => new Response(new Uint8Array([0xff])), () => new Response('{invalid')]) {
    let calls = 0;
    const client = createCloudflareWorkers({ maxResponseBytes: 32, binding: { async run() { calls++; return build(); } } });
    await assert.rejects(client.evaluate(request()), ResponseValidationError);
    assert.equal(calls, 1);
  }
});

test('parallel evaluations preserve their own Response metadata', async () => {
  const first = deferred(); const second = deferred();
  const client = createCloudflareWorkers({ binding: {
    get lastRequestId() { throw new Error('Never read shared metadata'); },
    run: (model, input) => input.state.id === 1 ? first.promise : second.promise,
  } });
  const a = client.evaluate({ ...request(), state: { id: 1 } });
  const b = client.evaluate({ ...request(), state: { id: 2 } });
  second.resolve(response(payload(), { headers: { 'cf-ai-req-id': 'second' } }));
  first.resolve(response(payload(), { headers: { 'cf-ai-req-id': 'first' } }));
  assert.equal((await a).response.requestId, 'first');
  assert.equal((await b).response.requestId, 'second');
});

test('decisions, policies and batch preserve selected original objects', async () => {
  const item = { id: 'lamp', localOnly: true };
  const target = choiceFrom({ instructions: 'Target', items: [item], id: value => value.id, describe: () => 'Lamp' });
  const definition = defineDecision({ instructions: 'Act', actions: { select: { description: 'Select', parameters: { target } }, wait: { description: 'Wait' } } });
  const client = createCloudflareWorkers({ binding: { async run(model, input) {
    const answers = Object.fromEntries(Object.entries(input.questions).map(([id, question]) => {
      const keys = Object.keys(question.criteria);
      return [id, { type: 'choice', choice: keys[0], probabilities: Object.fromEntries(keys.map((key, index) => [key, index === 0 ? 1 : 0])) }];
    }));
    return response({ answers });
  } } });
  const result = await definition.evaluate(client, { state: {} });
  assert.strictEqual(result.decision.parameters.target, item);
  assert.equal(gateChoice(result.evaluation.answers.action, { minProbability: 0.9 }).status, 'accepted');
  const report = await evaluateMany(client, [{ id: 'one', request: { state: {}, questions: definition.questions } }, { id: 'two', request: { state: {}, questions: definition.questions } }]);
  assert.equal(report.summary.succeeded, 2);
  assert.strictEqual(definition.resolve(report.items[1].value).parameters.target, item);
});

test('batch cancellation stops queued work and aborts active native calls', async () => {
  const started = deferred(); const controller = new AbortController();
  let calls = 0; let bindingSignal;
  const client = createCloudflareWorkers({ binding: { run(model, input, options) {
    calls++; bindingSignal = options.signal; started.resolve(); return new Promise(() => {});
  } } });
  const pending = evaluateMany(client, [{ id: 'one', request: request() }, { id: 'two', request: request() }], { concurrency: 1, signal: controller.signal });
  await started.promise;
  controller.abort();
  const report = await pending;
  assert.equal(calls, 1);
  assert.equal(bindingSignal.aborted, true);
  assert.equal(report.items[0].status, 'cancelled');
  assert.equal(report.items[1].started, false);
});

test('optional ESM/CJS entries work while core avoids loading the binding client', async () => {
  const require = createRequire(import.meta.url);
  const core = require('@system-one-ai/core');
  assert.equal('CloudflareWorkers' in core, false);
  assert.ok(!Object.keys(require.cache).some(file => file.endsWith('/workers.js')));
  const esm = await import('@system-one-ai/adapter-cloudflare/workers');
  const cjs = require('@system-one-ai/adapter-cloudflare/workers');
  for (const entry of [esm, cjs]) {
    const result = await entry.createCloudflareWorkers({ binding: { run: async () => response() } }).evaluate(request());
    assert.equal(result.answers.route.choice, 'a');
  }
});
