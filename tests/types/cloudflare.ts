import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { SystemOne, choice, type SystemOneAdapter } from '@system-one-ai/core';
import { cloudflareAdapter, type CloudflareAdapterOptions } from '@system-one-ai/adapter-cloudflare';
// @ts-expect-error Cloudflare is an optional entry point, never loaded by the core.
import { cloudflareAdapter as invalidRootExport } from '@system-one-ai/core';

const options: CloudflareAdapterOptions = { accountId: 'account-id' };
const adapter: SystemOneAdapter = cloudflareAdapter(options);
const client = new SystemOne({ transport: createFetchTransport(), adapter, apiKey: 'token' });
new SystemOne({ transport: createFetchTransport(), adapter, apiKey: 'token', baseURL: 'https://proxy.example/ai/run' });
// @ts-expect-error Account configuration is required by the adapter factory.
cloudflareAdapter();
// @ts-expect-error Missing account ID.
cloudflareAdapter({});
// @ts-expect-error Account ID is a string.
cloudflareAdapter({ accountId: 1 });
// @ts-expect-error Authentication belongs to the client, not the adapter.
cloudflareAdapter({ accountId: 'account-id', apiKey: 'token' });
// @ts-expect-error URL overrides belong to the client.
cloudflareAdapter({ accountId: 'account-id', baseURL: 'https://proxy.example' });
// @ts-expect-error A factory must be called with its required configuration.
new SystemOne({ transport: createFetchTransport(), adapter: cloudflareAdapter, apiKey: 'token' });

async function inference() {
  const result = await client.evaluate({ state: 'Refund this charge.', questions: { team: choice('Team?', { billing: null, support: null }) } });
  const team: 'billing' | 'support' = result.answers.team.choice;
  // @ts-expect-error Provider selection must not widen the choice union.
  const invalid: 'sales' = result.answers.team.choice;
  return { team, invalid };
}
void [invalidRootExport, inference];
