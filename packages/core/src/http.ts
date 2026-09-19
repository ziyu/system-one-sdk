import { ConfigurationError } from './errors.js';

export function parseBaseURL(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConfigurationError('baseURL must be an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ConfigurationError('baseURL must use HTTP(S) and contain no credentials, query, or fragment.');
  }
  return url;
}

export function snapshotHeaders(value?: HeadersInit): Headers {
  try { return new Headers(value); }
  catch { throw new ConfigurationError('headers contains an invalid HTTP header.'); }
}

export function checkRequestURL(url: string, baseURL: string): string {
  const target = parseBaseURL(url);
  if (target.origin !== parseBaseURL(baseURL).origin) throw new ConfigurationError('An adapter request must use the configured baseURL origin.');
  return target.toString();
}
