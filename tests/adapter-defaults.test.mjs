import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigurationError, SystemOne, systemOneAdapter } from '../dist/esm/index.js';
import { vercelAdapter } from '../dist/esm/adapters/vercel.js';
import { openRouterAdapter } from '../dist/esm/adapters/openrouter.js';
import { cloudflareAdapter } from '../dist/esm/adapters/cloudflare.js';
import { booleanRequest, booleanPayload, jsonResponse } from './fixtures.mjs';

const providers = [
  { name: 'TypeSafe', adapter: systemOneAdapter, url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest', overrideURL: 'https://proxy.example/team/systemone' },
  { name: 'Vercel', adapter: vercelAdapter, url: 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model', model: 'typesafe-ai/jev', overrideURL: 'https://proxy.example/team/evaluation-model' },
  { name: 'OpenRouter', adapter: openRouterAdapter, url: 'https://openrouter.ai/api/alpha/decisions', model: '~typesafe/jev-latest', overrideURL: 'https://proxy.example/team/decisions' },
  { name: 'Cloudflare', adapter: cloudflareAdapter({ accountId: 'test-account' }), url: 'https://api.cloudflare.com/client/v4/accounts/test-account/ai/run', model: 'typesafe/jev', overrideURL: 'https://proxy.example/team/ai/run' },
];

for (const { name, adapter, url, model, overrideURL } of providers) {
  test(`${name} needs no baseURL/model and still honors explicit client and per-request overrides`, async () => {
    const sent = [];
    const fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      const model = init.headers.get('ai-model-id') ?? body.model;
      sent.push({ url, model });
      return jsonResponse(name === 'Vercel' ? { answers: { on: { type: 'boolean', probability: 0.97 } } } : { ...booleanPayload, model, usage: {} });
    };
    const defaults = new SystemOne({ adapter, apiKey: 'fixture', fetch });
    await defaults.evaluate(booleanRequest);
    const overridden = new SystemOne({ adapter, apiKey: 'fixture', fetch, baseURL: overrideURL, model: 'vendor/pinned' });
    await overridden.evaluate(booleanRequest);
    await overridden.evaluate({ ...booleanRequest, model: 'vendor/per-request' });
    assert.deepEqual(sent, [{ url, model }, { url: overrideURL, model: 'vendor/pinned' }, { url: overrideURL, model: 'vendor/per-request' }]);
  });
}

test('custom adapters without a default URL still require an explicit endpoint', () => {
  const custom = { ...systemOneAdapter, id: 'custom' };
  delete custom.defaultBaseURL;
  assert.throws(() => new SystemOne({ adapter: custom, apiKey: null }), ConfigurationError);
  assert.equal(new SystemOne({ adapter: custom, apiKey: null, baseURL: 'https://custom.example/v1' }).baseURL, 'https://custom.example/v1');
});
