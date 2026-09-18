import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { SystemOne } from '../../src/index.js';
import { openRouterAdapter } from '../../src/adapters/openrouter.js';
import { cloudflareAdapter } from '../../src/adapters/cloudflare.js';

export type Provider = 'typesafe' | 'openrouter' | 'cloudflare';
export interface RequestTrace {
  readonly startedAt: string;
  readonly origin: string;
  readonly method: string;
  status?: number;
  headers?: Record<string, string>;
}

export async function scenarioClient(provider: string) {
  if (!['typesafe', 'openrouter', 'cloudflare'].includes(provider)) throw new Error('Choose typesafe, openrouter or cloudflare.');
  const file = provider === 'typesafe' ? '.env' : `.env.${provider}`;
  // Files are read explicitly: shell credentials cannot silently select another account.
  const env = parseEnv(await readFile(file, 'utf8'));
  const apiKey = provider === 'cloudflare' ? env.CLOUDFLARE_API_TOKEN : env.SYSTEM_ONE_API_KEY ?? env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error(`Configure the API key in ${file}.`);
  const adapter = provider === 'openrouter' ? openRouterAdapter : provider === 'cloudflare'
    ? cloudflareAdapter({ accountId: env.CLOUDFLARE_ACCOUNT_ID ?? '' }) : undefined;
  const expectedOrigin = provider === 'typesafe' ? 'https://api.typesafe.ai' : provider === 'openrouter' ? 'https://openrouter.ai' : 'https://api.cloudflare.com';
  const requests: RequestTrace[] = [];
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const client = new SystemOne({
    apiKey, ...(adapter ? { adapter } : {}),
    ...(env.SYSTEM_ONE_MODEL ? { model: env.SYSTEM_ONE_MODEL } : {}),
    ...(env.SYSTEM_ONE_BASE_URL ? { baseURL: env.SYSTEM_ONE_BASE_URL } : {}),
    timeoutMs: 15_000, maxRetries: 0,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== expectedOrigin) throw new Error('Live examples require the selected provider origin.');
      const trace: RequestTrace = { startedAt: new Date().toISOString(), origin: url.origin, method: init?.method ?? 'GET' };
      requests.push(trace);
      const response = await nativeFetch(input, init);
      trace.status = response.status;
      trace.headers = Object.fromEntries(['date', 'x-request-id', 'request-id', 'cf-ray', 'cf-ai-req-id'].flatMap(name => {
        const value = response.headers.get(name);
        return value === null ? [] : [[name, value]];
      }));
      return response;
    },
  });
  return { client, provider, configFile: file, requests, redact: (text: string) => text.replaceAll(apiKey, '[redacted]') };
}
