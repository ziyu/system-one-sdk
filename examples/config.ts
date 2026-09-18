import { SystemOne } from '../src/index.js';

export function exampleClient(): SystemOne {
  const apiKey = process.env.SYSTEM_ONE_API_KEY;
  if (!apiKey) throw new Error('Set SYSTEM_ONE_API_KEY before running a live example.');
  const model = process.env.SYSTEM_ONE_MODEL;
  return new SystemOne({
    baseURL: process.env.SYSTEM_ONE_BASE_URL ?? 'https://api.typesafe.ai/v1',
    apiKey,
    ...(model ? { model } : {}),
  });
}
