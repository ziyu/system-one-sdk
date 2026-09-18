import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { SystemOne, APIError, RequestAbortedError, ValidationError, ConfigurationError } from '../dist/esm/index.js';
import { evaluateMany } from '../dist/esm/batch.js';
import { booleanRequest, booleanPayload, jsonResponse } from './fixtures.mjs';

const input = (id, request = booleanRequest) => ({ id, request });
const value = (usage = {}, attempts = 1) => ({
  model: 'fixture', answers: { on: { type: 'boolean', probability: 0.9 } }, usage, warnings: [],
  response: { status: 200, attempts, durationMs: 0, adapter: 'fixture' },
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('empty batches perform no I/O and do not fabricate token counts', async () => {
  const report = await evaluateMany({ evaluate() { assert.fail('must not run'); } }, []);
  assert.deepEqual(report.items, []);
  assert.deepEqual(report.summary, { total: 0, started: 0, succeeded: 0, failed: 0, cancelled: 0, successfulAttempts: 0, reportedUsage: {}, usageCoverage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: report.summary.durationMs });
});

test('bounded workers preserve input order when requests complete out of order', async () => {
  const pending = [deferred(), deferred(), deferred()];
  let running = 0, peak = 0, calls = 0;
  const client = { evaluate() {
    running++;
    peak = Math.max(peak, running);
    return pending[calls++].promise.finally(() => { running--; });
  } };
  const task = evaluateMany(client, ['a', 'b', 'c'].map(id => input(id)), { concurrency: 2 });
  assert.equal(calls, 2);
  pending[1].resolve(value({ inputTokens: 2 }));
  await setImmediate();
  assert.equal(calls, 3);
  pending[2].resolve(value({ inputTokens: 3 }));
  pending[0].resolve(value({ inputTokens: 1 }));
  const report = await task;
  assert.equal(peak, 2);
  assert.deepEqual(report.items.map(item => [item.id, item.index, item.value.usage.inputTokens]), [['a', 0, 1], ['b', 1, 2], ['c', 2, 3]]);
  assert.equal(report.summary.started, 3);
  assert.equal(report.summary.succeeded, 3);
});

test('one failed item preserves the original error and does not discard other results or add retries', async () => {
  const failure = new APIError(429, 'original-request', 1500);
  let calls = 0;
  const client = { evaluate() {
    if (calls++ === 1) throw failure;
    return Promise.resolve(value({ inputTokens: 10, outputTokens: 2, totalTokens: 12 }, 2));
  } };
  const report = await evaluateMany(client, [input('a'), input('b'), input('c')]);
  assert.equal(calls, 3);
  assert.deepEqual(report.items.map(item => item.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.strictEqual(report.items[1].error, failure);
  assert.equal(report.items[1].started, true);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.successfulAttempts, 4);
  assert.deepEqual(report.summary.reportedUsage, { inputTokens: 20, outputTokens: 4, totalTokens: 24 });
  assert.deepEqual(report.summary.usageCoverage, { inputTokens: 2, outputTokens: 2, totalTokens: 2 });
});

test('reported usage includes zero and partial coverage without inventing missing counts', async () => {
  const values = [value({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }), value({ inputTokens: 5 }), value()];
  const report = await evaluateMany({ evaluate: async () => values.shift() }, [input('a'), input('b'), input('c')]);
  assert.deepEqual(report.summary.reportedUsage, { inputTokens: 5, outputTokens: 0, totalTokens: 0 });
  assert.deepEqual(report.summary.usageCoverage, { inputTokens: 2, outputTokens: 1, totalTokens: 1 });
  const overflow = await evaluateMany({ evaluate: async () => value({ inputTokens: Number.MAX_SAFE_INTEGER }) }, [input('a'), input('b')]);
  assert.equal(overflow.summary.reportedUsage.inputTokens, undefined);
  assert.equal(overflow.summary.usageCoverage.inputTokens, 2);
});

test('all request snapshots are taken before dispatch, including queued states and headers', async () => {
  const first = deferred();
  const second = structuredClone(booleanRequest);
  second.state = { label: 'original' };
  const headers = { 'x-tenant': 'original' };
  let calls = 0;
  const reportPromise = evaluateMany({ evaluate: async (request, options) => {
    assert.equal(options.headers.get('x-tenant'), 'original');
    options.headers.set('x-tenant', 'custom-wrapper-mutation');
    assert.equal(options.timeoutMs, 2000);
    assert.equal(options.maxRetries, 0);
    if (calls++ === 0) return first.promise;
    assert.deepEqual(request.state, { label: 'original' });
    assert.equal(request.questions.on.instructions, 'Is the light on?');
    return value();
  } }, [input('first'), input('second', second)], { concurrency: 1, requestOptions: { headers, timeoutMs: 2000, maxRetries: 0 } });
  second.state.label = 'changed';
  second.questions.on.instructions = 'Changed question';
  headers['x-tenant'] = 'changed';
  first.resolve(value());
  assert.equal((await reportPromise).summary.succeeded, 2);
});

test('invalid per-item requests stay local while invalid correlation or batch settings reject before I/O', async () => {
  let calls = 0;
  const client = { evaluate: async () => { calls++; return value(); } };
  const report = await evaluateMany(client, [input('invalid', { state: null, questions: {} }), input('valid')]);
  assert.equal(calls, 1);
  assert.equal(report.items[0].status, 'rejected');
  assert.equal(report.items[0].started, false);
  assert.ok(report.items[0].error instanceof ValidationError);
  calls = 0;
  await assert.rejects(evaluateMany(client, [input('duplicate'), input('duplicate')]), ValidationError);
  await assert.rejects(evaluateMany(client, [input('')]), ValidationError);
  await assert.rejects(evaluateMany(client, new Array(1)), ValidationError);
  for (const concurrency of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(evaluateMany(client, [input('a')], { concurrency }), ConfigurationError);
  }
  await assert.rejects(evaluateMany(client, [input('a')], { requestOptions: { signal: new AbortController().signal } }), ValidationError);
  await assert.rejects(evaluateMany(client, [input('a')], { requestOptions: { timeoutMs: 0 } }), ConfigurationError);
  await assert.rejects(evaluateMany(client, [input('a')], { signal: null }), ConfigurationError);
  assert.equal(calls, 0);
});

test('pre-cancelled batches return one cancelled result per valid item without starting calls', async () => {
  const controller = new AbortController();
  controller.abort('private-caller-reason');
  const report = await evaluateMany({ evaluate() { assert.fail('must not run'); } }, [input('a'), input('b')], { signal: controller.signal });
  assert.equal(report.summary.started, 0);
  assert.equal(report.summary.cancelled, 2);
  for (const item of report.items) {
    assert.equal(item.status, 'cancelled');
    assert.equal(item.started, false);
    assert.ok(item.error instanceof RequestAbortedError);
    assert.ok(!item.error.message.includes('private-caller-reason'));
  }
});

test('cancellation aborts active calls and skips queued work even when a custom client ignores the signal', { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const pending = [deferred(), deferred()];
  const signals = [];
  let calls = 0;
  const task = evaluateMany({ evaluate: (_, options) => {
    signals.push(options.signal);
    return pending[calls++].promise;
  } }, [input('a'), input('b'), input('c'), input('d')], { concurrency: 2, signal: controller.signal });
  controller.abort();
  const report = await task;
  assert.equal(calls, 2);
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(report.summary.cancelled, 4);
  assert.deepEqual(report.items.map(item => item.started), [true, true, false, false]);
  pending[0].resolve(value());
  pending[1].reject(new Error('late-rejection'));
  await setImmediate();
  assert.ok(report.items.every(item => item.status === 'cancelled'));
});

test('cancellation preserves completed results and removes its external listener', async () => {
  const controller = new AbortController();
  const pending = [deferred(), deferred(), deferred()];
  let calls = 0, added = 0, removed = 0;
  const external = {
    get aborted() { return controller.signal.aborted; },
    addEventListener(...args) { added++; controller.signal.addEventListener(...args); },
    removeEventListener(...args) { removed++; controller.signal.removeEventListener(...args); },
  };
  const task = evaluateMany({ evaluate: () => pending[calls++].promise }, [input('a'), input('b'), input('c'), input('d')], { concurrency: 2, signal: external });
  pending[0].resolve(value({ inputTokens: 5 }));
  await setImmediate();
  assert.equal(calls, 3);
  controller.abort();
  const report = await task;
  assert.deepEqual(report.items.map(item => item.status), ['fulfilled', 'cancelled', 'cancelled', 'cancelled']);
  assert.deepEqual(report.summary.reportedUsage, { inputTokens: 5 });
  assert.equal(added, 1);
  assert.equal(removed, 1);
  pending[1].resolve(value());
  pending[2].resolve(value());
});

test('batch requests retain the existing native client validation and retry controls', async () => {
  let attempts = 0;
  const client = new SystemOne({ apiKey: null, maxRetries: 2, fetch: async (_, init) => {
    attempts++;
    if (JSON.parse(init.body).state === 'reject') return jsonResponse({}, { status: 503 });
    return jsonResponse(booleanPayload);
  } });
  const report = await evaluateMany(client, [input('valid'), input('failed', { ...booleanRequest, state: 'reject' })], { requestOptions: { maxRetries: 0 } });
  assert.equal(attempts, 2);
  assert.equal(report.items[0].value.answers.on.probability, 0.97);
  assert.ok(report.items[1].error instanceof APIError);
  assert.equal(report.items[1].error.statusCode, 503);
});
