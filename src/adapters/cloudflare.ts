import { ConfigurationError, UnsupportedFeatureError } from '../errors.js';
import type { AdapterContext, SystemOneAdapter } from '../types.js';
import { isRecord, parseBaseURL } from '../validation.js';
import { decodeCloudflareResponse } from './cloudflare-codec.js';
import { nativeQuestions } from './system-one.js';

export interface CloudflareAdapterOptions {
  /** Cloudflare account identifier. The API token is passed as SystemOne's apiKey. */
  readonly accountId: string;
}

function accountIdOf(options: CloudflareAdapterOptions): string {
  if (!isRecord(options) || Object.getOwnPropertySymbols(options).length > 0
    || Object.getOwnPropertyNames(options).some(key => key !== 'accountId')) {
    throw new ConfigurationError('cloudflareAdapter requires an options object containing accountId.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(options, 'accountId');
  const value: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  // Keep the identifier to one unambiguous path segment, including on custom proxies.
  if (typeof value !== 'string' || value.length === 0 || /[^A-Za-z0-9_-]/.test(value)) {
    throw new ConfigurationError('Cloudflare accountId must be a nonempty identifier containing only letters, digits, underscores, or hyphens.');
  }
  return value;
}

function endpoint(baseURL: string, accountId: string): string {
  const url = parseBaseURL(baseURL);
  let path = url.pathname.replace(/\/+$/, '');
  if (path === '') path = '/client/v4';

  const account = /^(.*\/accounts)\/([^/]+)(?:\/ai(?:\/run)?)?$/.exec(path);
  if (account) {
    if (account[2] !== accountId) throw new ConfigurationError('The account in baseURL must match the Cloudflare adapter accountId.');
    path = `${account[1]}/${accountId}/ai/run`;
  } else if (path.includes('/accounts/')) {
    throw new ConfigurationError('Cloudflare baseURL must be an API root, account root, or endpoint ending in /ai/run.');
  } else if (path.endsWith('/ai/run')) {
    // An explicitly supplied proxy endpoint may already have its account configured.
  } else if (path.endsWith('/ai')) {
    path += '/run';
  } else {
    if (!path.endsWith('/accounts')) path += '/accounts';
    path += `/${accountId}/ai/run`;
  }
  url.pathname = path;
  return url.toString();
}

/** Cloudflare AI REST codec. The factory supplies the account-specific URL and Jev model. */
export function cloudflareAdapter(options: CloudflareAdapterOptions): SystemOneAdapter {
  const accountId = accountIdOf(options);
  return Object.freeze({
    id: 'cloudflare',
    defaultBaseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`,
    defaultModel: 'typesafe/jev',
    supportedQuestionTypes: Object.freeze(['choice', 'score', 'boolean'] as const),
    prepare({ baseURL, model, request }: AdapterContext) {
      if (request.providerOptions !== undefined && Object.keys(request.providerOptions).length > 0) {
        throw new UnsupportedFeatureError('The Cloudflare Jev REST protocol does not define providerOptions.');
      }
      return {
        url: endpoint(baseURL, accountId),
        body: { model, input: { state: request.state, questions: nativeQuestions(request.questions) } },
      };
    },
    decode: decodeCloudflareResponse,
  });
}
