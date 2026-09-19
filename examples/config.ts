import { systemOneAdapter } from '@system-one-ai/adapter-system-one';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { SystemOne } from '@system-one-ai/core';

export function exampleClient(): SystemOne {
  const apiKey = process.env.SYSTEM_ONE_API_KEY;
  if (!apiKey) throw new Error('Set SYSTEM_ONE_API_KEY before running a live example.');
  const model = process.env.SYSTEM_ONE_MODEL;
  const baseURL = process.env.SYSTEM_ONE_BASE_URL;
  return new SystemOne({
    adapter: systemOneAdapter,
    transport: createFetchTransport(),
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(model ? { model } : {}),
  });
}
