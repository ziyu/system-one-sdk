import { systemOneAdapter } from '@system-one-ai/adapter-system-one';
import { cloudflareAdapter } from '@system-one-ai/adapter-cloudflare';
import { createCloudflareWorkers } from '@system-one-ai/adapter-cloudflare/workers';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  SystemOne, UnsupportedFeatureError, ValidationError, ResponseValidationError,
  defineFields, textField, numberField, dateField, listField, estimateField,
} from '@system-one-ai/core';
import { jsonResponse } from './fixtures.mjs';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const png = `data:image/png;base64,${pngBase64}`;
const fields = defineFields({
  invoice_number: textField(),
  due_date: dateField({ instructions: 'Issue date plus the net payment days' }),
  total: numberField({ decimals: 2, unit: 'USD', instructions: 'Amount due including shipping' }),
  contacts: listField({ items: 'text' }),
  days_to_pay: estimateField({ min: 0, max: 120, step: 1, instructions: 'Days after issue until this invoice is paid' }),
});
const request = {
  state: 'Invoice INV-2291 from Northwind Supply, issued 2026-09-02, net 30. 4 pallets at $250.00 each, shipping $80.00. Contact: Dana Ruiz, Priya Shah.',
  fields,
};
const payload = () => ({
  model: 'clairic',
  answers: {
    invoice_number: { type: 'text', p_null: 3.8e-10, span: [8, 16], guess: 'INV-2291', confidence: 1, value: 'INV-2291' },
    due_date: { type: 'date', p_null: 1.9e-08, guess: '2026-10-02', confidence: 0.9999, value: '2026-10-02' },
    total: { type: 'number', p_null: 2.3e-08, guess: 1080, confidence: 0.9999, value: 1080 },
    contacts: { type: 'list', value: ['Dana Ruiz', 'Priya Shah'], spans: [[120, 129], [131, 141]], confidence: 0.9999 },
    days_to_pay: { type: 'estimate', value: 30, mean: 29.535, median: 30, p10: 21, p90: 38, p_below: 5.9e-06, p_above: 1.2e-05 },
  },
  truncated: false,
  usage: { state_tokens: 61, image_tokens: 0, schema_tokens: 472, input_tokens: 655, output_tokens: 0, passes: 3 },
});

function extractClient(fetch, options = {}) {
  return new SystemOne({
    adapter: systemOneAdapter, apiKey: 'fixture', transport: createFetchTransport(fetch), maxRetries: 0, ...options,
  });
}

test('system-one extract posts Clairic fields to /v1/systemone and normalizes answers', async () => {
  let calls = 0;
  const input = structuredClone(request);
  const client = extractClient(async (url, init) => {
    calls++;
    assert.equal(url, 'https://system-one.dev/v1/systemone');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.get('authorization'), 'Bearer fixture');
    assert.deepEqual(JSON.parse(init.body), {
      model: 'clairic',
      state: request.state,
      fields: {
        invoice_number: { type: 'text' },
        due_date: { type: 'date', instructions: 'Issue date plus the net payment days' },
        total: { type: 'number', decimals: 2, unit: 'USD', instructions: 'Amount due including shipping' },
        contacts: { type: 'list', items: 'text' },
        days_to_pay: { type: 'estimate', min: 0, max: 120, step: 1, instructions: 'Days after issue until this invoice is paid' },
      },
    });
    return jsonResponse(payload(), { headers: { 'x-request-id': 'extract-fixture' } });
  });
  const result = await client.extract(input);
  assert.equal(calls, 1);
  assert.equal(result.model, 'clairic');
  assert.equal(result.truncated, false);
  assert.equal(result.answers.invoice_number.value, 'INV-2291');
  assert.deepEqual(result.answers.invoice_number.span, [8, 16]);
  assert.equal(result.answers.due_date.value, '2026-10-02');
  assert.equal(result.answers.total.value, 1080);
  assert.deepEqual(result.answers.contacts.value, ['Dana Ruiz', 'Priya Shah']);
  assert.equal(result.answers.days_to_pay.median, 30);
  assert.equal(result.answers.days_to_pay.pBelow, 5.9e-06);
  assert.deepEqual(result.usage, { inputTokens: 655, outputTokens: 0, totalTokens: 655, stateTokens: 61, imageTokens: 0, schemaTokens: 472, passes: 3 });
  assert.equal(result.response.adapter, 'system-one');
  assert.equal(result.response.requestId, 'extract-fixture');
  assert.deepEqual(input, request);
});

test('null answers keep guess, and options map to the wire format', async () => {
  const client = extractClient(async (_, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.reference_date, '2026-10-19');
    assert.deepEqual(body.options, { include_quantiles: true, return_state_text: true });
    assert.equal(body.fields.po_number.null_threshold, 0.8);
    assert.equal(body.fields.invoice_number.null_threshold, 0.8);
    return jsonResponse({
      ...payload(),
      answers: {
        invoice_number: payload().answers.invoice_number,
        po_number: { type: 'text', p_null: 1, span: [8, 16], guess: 'INV-2291', confidence: 0.9995, value: null },
      },
      state_text: request.state,
    });
  });
  const result = await client.extract({
    state: request.state,
    referenceDate: '2026-10-19',
    options: { nullThreshold: 0.8, includeQuantiles: true, returnStateText: true },
    fields: { invoice_number: { type: 'text' }, po_number: { type: 'text', instructions: 'Purchase order number' } },
  });
  assert.equal(result.answers.po_number.value, null);
  assert.equal(result.answers.po_number.guess, 'INV-2291');
  assert.equal(result.answers.po_number.pNull, 1);
  assert.equal(result.stateText, request.state);
});

test('image-only extract omits empty state and encodes ImageInput objects', async () => {
  const client = extractClient(async (_, init) => {
    const body = JSON.parse(init.body);
    assert.equal('state' in body, false);
    assert.deepEqual(body.images, [png, { content_type: 'image/png', base64: pngBase64 }]);
    return jsonResponse({
      model: 'clairic', truncated: false,
      answers: { total: { type: 'number', value: 15.98, confidence: 0.99, p_null: 1e-8 } },
      usage: { input_tokens: 10, output_tokens: 0 },
    });
  });
  const result = await client.extract({
    images: [png, { mediaType: 'image/png', base64: pngBase64 }],
    fields: { total: { type: 'number', decimals: 2 } },
  });
  assert.equal(result.answers.total.value, 15.98);
  assert.equal(result.usage.totalTokens, 10);
});

for (const [label, mutate] of [
  ['missing fields', input => { delete input.fields; }],
  ['empty fields', input => { input.fields = {}; }],
  ['invalid field name', input => { input.fields = { '1bad': { type: 'text' } }; }],
  ['unknown field type', input => { input.fields.total.type = 'choice'; }],
  ['list without items', input => { input.fields.contacts = { type: 'list' }; }],
  ['estimate without max', input => { delete input.fields.days_to_pay.max; }],
  ['min not less than max', input => { input.fields.days_to_pay.max = 0; }],
  ['empty state without images', input => { input.state = '  '; }],
  ['object state', input => { input.state = { text: 'invoice' }; }],
  ['remote image URL', input => { input.images = ['https://example.com/receipt.png']; }],
  ['too many images', input => { input.images = Array(5).fill(png); }],
  ['gif image', input => { input.images = ['data:image/gif;base64,AAAA']; }],
  ['invalid reference date', input => { input.referenceDate = '10/19/2026'; }],
  ['null threshold of zero', input => { input.options = { nullThreshold: 0 }; }],
  ['unknown option', input => { input.options = { temperature: 0.2 }; }],
]) {
  test(`invalid extract input is rejected before I/O: ${label}`, async () => {
    const input = structuredClone(request);
    mutate(input);
    const client = extractClient(() => assert.fail('fetch must not run'), { apiKey: () => assert.fail('key resolution must not run') });
    await assert.rejects(client.extract(input), ValidationError);
  });
}

test('extract without images requires a nonempty state', async () => {
  const client = extractClient(() => assert.fail('fetch must not run'));
  await assert.rejects(client.extract({ fields: { name: { type: 'text' } } }), ValidationError);
});

test('oversized extract images are rejected before I/O', async () => {
  const client = extractClient(() => assert.fail('fetch must not run'), { apiKey: () => assert.fail('must not resolve credentials') });
  await assert.rejects(client.extract({
    state: request.state,
    fields: { name: { type: 'text' } },
    images: [{ mediaType: 'image/png', base64: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64') }],
  }), error => error instanceof ValidationError && error.path.startsWith('images'));
  await assert.rejects(client.extract({
    state: request.state,
    fields: { name: { type: 'text' } },
    images: Array(3).fill({ mediaType: 'image/png', base64: Buffer.alloc(3 * 1024 * 1024).toString('base64') }),
  }), error => error instanceof ValidationError && error.path === 'images');
});

test('adapters without extract support fail before prepare', async () => {
  const client = new SystemOne({
    adapter: { ...systemOneAdapter, supportsExtract: false, prepareExtract() { assert.fail('must not prepare'); } },
    apiKey: null, transport: createFetchTransport(() => assert.fail('must not send')),
  });
  await assert.rejects(client.extract(request), UnsupportedFeatureError);
});

test('extract responses must match the requested fields', async () => {
  const client = extractClient(async () => jsonResponse({ ...payload(), answers: { total: payload().answers.total } }));
  await assert.rejects(client.extract(request), ResponseValidationError);
});

test('all nine field types round-trip through extract', async () => {
  const fields = {
    title: { type: 'text' },
    amount: { type: 'number', decimals: 2 },
    issued: { type: 'date' },
    opens: { type: 'time' },
    signed: { type: 'datetime' },
    delay: { type: 'duration', unit: 'days' },
    tags: { type: 'list', items: 'text' },
    wait: { type: 'estimate', min: 0, max: 10, step: 1 },
    demand: { type: 'forecast', min: 0, max: 100, horizon: 2, interval: 'day' },
  };
  const client = extractClient(async (_, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.fields.delay.unit, 'days');
    assert.equal(body.fields.demand.horizon, 2);
    assert.equal(body.fields.demand.interval, 'day');
    return jsonResponse({
      model: 'clairic', truncated: false,
      answers: {
        title: { type: 'text', value: 'INV-2291' },
        amount: { type: 'number', value: 1080 },
        issued: { type: 'date', value: '2026-09-02' },
        opens: { type: 'time', value: '09:00:00' },
        signed: { type: 'datetime', value: '2026-09-02T09:00:00' },
        delay: { type: 'duration', value: 30, unit: 'days' },
        tags: { type: 'list', value: ['net-30'] },
        wait: { type: 'estimate', value: 4, mean: 4.1, median: 4, p10: 2, p90: 7 },
        demand: {
          type: 'forecast', value: [12, 15], mean: [12.2, 14.8], median: [12, 15],
          p10: [10, 12], p90: [14, 18], p_below: [0.01, 0.02], p_above: [0.03, 0.04],
        },
      },
      usage: { input_tokens: 20, output_tokens: 4, passes: 1 },
    });
  });
  const result = await client.extract({ state: request.state, fields });
  assert.equal(result.answers.title.value, 'INV-2291');
  assert.equal(result.answers.amount.value, 1080);
  assert.equal(result.answers.issued.value, '2026-09-02');
  assert.equal(result.answers.opens.value, '09:00:00');
  assert.equal(result.answers.signed.value, '2026-09-02T09:00:00');
  assert.equal(result.answers.delay.value, 30);
  assert.equal(result.answers.delay.unit, 'days');
  assert.deepEqual(result.answers.tags.value, ['net-30']);
  assert.equal(result.answers.wait.median, 4);
  assert.deepEqual(result.answers.demand.value, [12, 15]);
  assert.deepEqual(result.answers.demand.pBelow, [0.01, 0.02]);
});

test('extract JSON body over 16 MiB is rejected before send', async () => {
  const client = extractClient(() => assert.fail('fetch must not run'), { apiKey: () => assert.fail('must not resolve credentials') });
  await assert.rejects(client.extract({
    state: 'x'.repeat(16 * 1024 * 1024),
    fields: { name: { type: 'text' } },
  }), error => error instanceof ValidationError && error.path === 'request');
});

for (const [baseURL, expected] of [
  ['https://system-one.dev', 'https://system-one.dev/v1/systemone'],
  ['https://system-one.dev/v1/', 'https://system-one.dev/v1/systemone'],
  ['https://system-one.dev/v1/systemone', 'https://system-one.dev/v1/systemone'],
  ['https://system-one.dev/v1/systemone/', 'https://system-one.dev/v1/systemone'],
  ['https://local.example/tenant/v2/', 'https://local.example/tenant/v2/systemone'],
]) {
  test(`extract URL preserves the API prefix: ${baseURL}`, async () => {
    const client = extractClient(async url => {
      assert.equal(url, expected);
      return jsonResponse({
        model: 'clairic', truncated: false, answers: { on: { type: 'text', value: 'ok' } },
        usage: { input_tokens: 1, output_tokens: 0 },
      });
    }, { baseURL });
    await client.extract({ state: 'ok', fields: { on: { type: 'text' } } });
  });
}

test('Cloudflare extract uses the Clairic REST path, selector, and envelopes', async t => {
  const received = [];
  const accountId = '0123456789abcdef0123456789abcdef';
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, errors: [], result: payload() }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const client = new SystemOne({
    adapter: cloudflareAdapter({ accountId }), apiKey: null, transport: createFetchTransport(),
    baseURL: `http://127.0.0.1:${server.address().port}/team/ai/run`, maxRetries: 0,
  });
  const result = await client.extract({ ...request, images: [png] });
  assert.equal(received[0].url, '/team/ai/run/@cf/cloudflare/clairic');
  assert.equal(received[0].body.model, 'clairic');
  assert.equal(received[0].body.fields.total.type, 'number');
  assert.deepEqual(received[0].body.images, [png]);
  assert.equal(result.answers.invoice_number.value, 'INV-2291');
  assert.equal(result.rounding, undefined);
  await assert.rejects(client.extract({ ...request, model: '@cf/cloudflare/clef' }), UnsupportedFeatureError);
});

test('Workers extract invokes the Clairic binding with a cloned body', async () => {
  const binding = {
    async run(model, input, options) {
      assert.equal(model, '@cf/cloudflare/clairic');
      assert.equal(input.model, 'clairic');
      assert.equal(input.fields.invoice_number.type, 'text');
      assert.equal(options.returnRawResponse, true);
      input.fields.invoice_number = { type: 'mutated' };
      return new Response(JSON.stringify(payload()), { headers: { 'cf-ai-req-id': 'extract-native' } });
    },
  };
  const client = createCloudflareWorkers({ binding });
  const result = await client.extract(request);
  assert.equal(result.answers.total.value, 1080);
  assert.equal(result.response.requestId, 'extract-native');
  assert.equal(result.response.adapter, 'cloudflare-workers');
});
