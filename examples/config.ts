import { SystemOne } from '../src/index.js';

export function exampleClient(): SystemOne {
  const apiKey = process.env.SYSTEM_ONE_API_KEY;
  if (!apiKey) throw new Error('Set SYSTEM_ONE_API_KEY before running a live example.');
  const model = process.env.SYSTEM_ONE_MODEL;
  const baseURL = process.env.SYSTEM_ONE_BASE_URL;
  return new SystemOne({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(model ? { model } : {}),
  });
}
