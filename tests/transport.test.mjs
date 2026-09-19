import { systemOneAdapter } from '@system-one-ai/adapter-system-one';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { SystemOne, APIError, TimeoutError, RequestAbortedError, ConnectionError, ResponseValidationError, ConfigurationError } from '@system-one-ai/core';
import { parseRetryAfter } from '@system-one-ai/transport-fetch';
import { booleanRequest, booleanPayload, jsonResponse } from './fixtures.mjs';

for (const status of [408, 429, 500, 503, 529]) {
  test(`transient HTTP ${status} is retried with the same evaluation`, async () => {
    const bodies = [];
    const client = new SystemOne({ adapter: systemOneAdapter, apiKey: 'fixture', retryDelayMs: 0, transport: createFetchTransport(async (_, init) => {
      bodies.push(init.body);
      return bodies.length === 1 ? new Response('temporary', { status }) : jsonResponse(booleanPayload);
    }) });
    const result = await client.evaluate(booleanRequest);
    assert.equal(result.response.attempts, 2);
    assert.equal(bodies[0], bodies[1]);
  });
}

for (const status of [400, 401, 403, 404, 409, 422]) {
  test(`HTTP ${status} retains status/request ID and is not retried`, async () => {
    let calls = 0;
    const client = new SystemOne({ adapter: systemOneAdapter, apiKey: 'hidden-fixture-key', transport: createFetchTransport(async () => {
      calls++;
      return new Response('echoed hidden-fixture-key', { status, headers: { 'x-request-id': 'request-failed' } });
    }) });
    await assert.rejects(client.evaluate(booleanRequest), error => {
      assert.ok(error instanceof APIError);
      assert.equal(error.statusCode, status);
      assert.equal(error.requestId, 'request-failed');
      assert.equal(error.retryable, false);
      assert.ok(!String(error).includes('hidden-fixture-key'));
      assert.ok(!JSON.stringify(error).includes('hidden-fixture-key'));
      return true;
    });
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(client).includes('hidden-fixture-key'));
  });
}

test('retry exhaustion and per-request retry opt-out preserve the last error', async () => {
  let calls = 0;
  const client = new SystemOne({ adapter: systemOneAdapter, apiKey: 'fixture', retryDelayMs: 0, transport: createFetchTransport(async () => { calls++; return new Response('', { status: 529 }); }) });
  await assert.rejects(client.evaluate(booleanRequest), APIError);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(client.evaluate(booleanRequest, { maxRetries: 0 }), APIError);
  assert.equal(calls, 1);
});

test('connection failures retry, without copying possibly sensitive fetch errors', async () => {
  let calls = 0;
  const client = new SystemOne({ adapter: systemOneAdapter, apiKey: 'fixture', retryDelayMs: 0, transport: createFetchTransport(async () => { calls++; throw new Error('echoed fixture key'); }) });
  await assert.rejects(client.evaluate(booleanRequest), error => error instanceof ConnectionError && !String(error).includes('echoed'));
  assert.equal(calls, 3);
});

test('Retry-After supports milliseconds, seconds, dates, and rejects malformed numbers', () => {
  assert.equal(parseRetryAfter(new Headers({ 'retry-after-ms': '12.1', 'retry-after': '100' })), 13);
  assert.equal(parseRetryAfter(new Headers({ 'retry-after': '1.5' })), 1500);
  const now = Date.UTC(2026, 8, 18, 12);
  assert.equal(parseRetryAfter(new Headers({ 'retry-after': new Date(now + 5000).toUTCString() }), now), 5000);
  assert.equal(parseRetryAfter(new Headers({ 'retry-after': '-1' }), now), undefined);
  assert.equal(parseRetryAfter(new Headers({ 'retry-after': 'not a date' }), now), undefined);
});

test('server Retry-After is honored even when greater than the configured backoff cap', async () => {
  const times = [];
  const client = new SystemOne({ adapter: systemOneAdapter, apiKey: 'fixture', maxRetryDelayMs: 0, transport: createFetchTransport(async () => {
    times.push(performance.now());
    return times.length === 1 ? new Response('', { status: 429, headers: { 'retry-after-ms': '60' } }) : jsonResponse(booleanPayload);
  }) });
  await client.evaluate(booleanRequest);
  assert.ok(times[1] - times[0] >= 55);
});

test('a Retry-After beyond the deadline never causes an early retry', async () => {
  let calls = 0;
  const client = new SystemOne({ adapter: systemOneAdapter, apiKey: 'fixture', timeoutMs: 200, transport: createFetchTransport(async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '86400' } }); }) });
  await assert.rejects(client.evaluate(booleanRequest), TimeoutError);
  assert.equal(calls, 1);
});

test('an already-aborted call performs no authentication or network request', async () => {
  const controller = new AbortController();
  controller.abort('private caller context');
  const client = new SystemOne({ adapter: systemOneAdapter, apiKey: () => assert.fail('no key resolution'), transport: createFetchTransport(async () => assert.fail('no fetch')) });
  await assert.rejects(client.evaluate(booleanRequest, { signal: controller.signal }), RequestAbortedError);
});

test('timeout bounds a non-cooperative key resolver', { timeout: 2000 }, async () => {
  const client = new SystemOne({ adapter: systemOneAdapter, apiKey: () => new Promise(() => {}), timeoutMs: 30, transport: createFetchTransport(async () => assert.fail('no fetch')) });
  await assert.rejects(client.evaluate(booleanRequest), TimeoutError);
});

test('timeout aborts and bounds a non-cooperative fetch', { timeout: 2000 }, async () => {
  let signal;
  let calls = 0;
  const client = new SystemOne({ adapter: systemOneAdapter, apiKey: 'fixture', timeoutMs: 30, transport: createFetchTransport(async (_, init) => { calls++; signal = init.signal; return new Promise(() => {}); }) });
  await assert.rejects(client.evaluate(booleanRequest), TimeoutError);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test('timeout includes streamed body reading and cannot hang on cancellation', { timeout: 2000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; return new Promise(() => {}); } });
  const client = new SystemOne({ adapter: systemOneAdapter, apiKey: 'fixture', timeoutMs: 30, transport: createFetchTransport(async () => new Response(body)) });
  await assert.rejects(client.evaluate(booleanRequest), TimeoutError);
  assert.equal(cancelled, true);
});

test('caller cancellation interrupts Retry-After backoff and preserves cancellation semantics', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = new SystemOne({ adapter: systemOneAdapter, apiKey: 'fixture', transport: createFetchTransport(async () => {
    calls++;
    setTimeout(() => controller.abort('sensitive reason'), 20);
    return new Response('', { status: 429, headers: { 'retry-after': '1' } });
  }) });
  await assert.rejects(client.evaluate(booleanRequest, { signal: controller.signal }), error => error instanceof RequestAbortedError && !String(error).includes('sensitive'));
  assert.equal(calls, 1);
});

test('body-size enforcement preserves its error even when stream cancellation rejects', async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(128)); }, cancel() { throw new Error('cleanup failure'); } });
  const client = new SystemOne({ adapter: systemOneAdapter, apiKey: 'fixture', maxResponseBytes: 64, transport: createFetchTransport(async () => new Response(body)) });
  await assert.rejects(client.evaluate(booleanRequest), error => error instanceof ResponseValidationError && error.message.includes('maxResponseBytes'));
});

test('content-length limits, malformed JSON, and invalid UTF-8 are rejected without retries', async () => {
  for (const response of [
    () => new Response('{}', { headers: { 'content-length': '100000' } }),
    () => new Response('<html>not JSON</html>'),
    () => new Response(new Uint8Array([0xc3, 0x28])),
  ]) {
    let calls = 0;
    const client = new SystemOne({ adapter: systemOneAdapter, apiKey: 'fixture', maxResponseBytes: 1024, transport: createFetchTransport(async () => { calls++; return response(); }) });
    await assert.rejects(client.evaluate(booleanRequest), ResponseValidationError);
    assert.equal(calls, 1);
  }
});

test('cross-origin custom adapter requests fail before resolving credentials', async () => {
  const adapter = { id: 'broken', defaultModel: 'test', supportedQuestionTypes: ['boolean'], prepare: () => ({ url: 'https://other.example/evaluate', body: {} }), decode: value => value };
  const client = new SystemOne({ baseURL: 'https://expected.example', adapter, apiKey: () => assert.fail('key must not be resolved'), transport: createFetchTransport(async () => assert.fail('no fetch')) });
  await assert.rejects(client.evaluate(booleanRequest), ConfigurationError);
});

test('native fetch integration: real HTTP JSON request and redirect rejection', async t => {
  let redirected = 0;
  const server = createServer(async (incoming, outgoing) => {
    if (incoming.url === '/redirect/systemone') {
      outgoing.writeHead(307, { location: '/stolen' }); outgoing.end(); return;
    }
    if (incoming.url === '/stolen') { redirected++; outgoing.end(); return; }
    assert.equal(incoming.url, '/v1/systemone');
    assert.equal(incoming.headers.authorization, 'Bearer local-fixture');
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    assert.equal(JSON.parse(Buffer.concat(chunks).toString()).questions.on.type, 'noul');
    outgoing.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'real-http-fixture' });
    outgoing.end(JSON.stringify(booleanPayload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = new SystemOne({ adapter: systemOneAdapter, transport: createFetchTransport(), baseURL: origin, apiKey: 'local-fixture' });
  const result = await client.evaluate(booleanRequest);
  assert.equal(result.answers.on.probability, 0.97);
  assert.equal(result.response.requestId, 'real-http-fixture');
  const redirecting = new SystemOne({ adapter: systemOneAdapter, transport: createFetchTransport(), baseURL: `${origin}/redirect`, apiKey: 'local-fixture' });
  await assert.rejects(redirecting.evaluate(booleanRequest), error => error instanceof APIError && error.statusCode === 307);
  assert.equal(redirected, 0);
});
