import { createFetchTransport } from '@system-one-ai/transport-fetch';
import assert from 'node:assert/strict';
import test from 'node:test';
import { SystemOne } from '@system-one-ai/core';
import { vercelAdapter } from '@system-one-ai/adapter-vercel';
import { request, gatewayPayload, jsonResponse } from './fixtures.mjs';

// Wire values recorded from the previously passing @ai-sdk/gateway@4.0.85 comparison.
// This regression uses the recorded contract without installing the provider SDK.
test('optional Vercel adapter preserves the recorded Evaluation v4 wire contract', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) });
    return jsonResponse(gatewayPayload());
  };
  const providerOptions = { gateway: { order: ['typesafe'] } };
  const client = new SystemOne({ adapter: vercelAdapter, apiKey: 'contract-fixture', transport: createFetchTransport(fetch) });
  const result = await client.evaluate({ ...request, providerOptions });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model');
  assert.deepEqual(calls[0].body, { ...request, providerOptions });
  for (const [name, value] of Object.entries({
    authorization: 'Bearer contract-fixture',
    'content-type': 'application/json',
    'ai-model-id': 'typesafe-ai/jev',
    'ai-gateway-protocol-version': '0.0.1',
    'ai-gateway-auth-method': 'api-key',
    'ai-evaluation-model-specification-version': '4',
  })) {
    assert.equal(calls[0].headers.get(name), value, name);
  }
  const expected = gatewayPayload();
  assert.deepEqual(result.answers.interrupt, expected.answers.interrupt);
  assert.deepEqual(result.answers.action.probabilities, expected.answers.action.probabilities);
  assert.deepEqual(result.rounding, expected.rounding);
  assert.deepEqual(result.providerMetadata, expected.providerMetadata);
});
