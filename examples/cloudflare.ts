import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { SystemOne, SystemOneError, choice, score, booleanQuestion } from '@system-one-ai/core';
import { cloudflareAdapter } from '@system-one-ai/adapter-cloudflare';

// Consumers import @system-one-ai/core and @system-one-ai/adapter-cloudflare.
// npm run example:cloudflare loads this project's .env.cloudflare.
try {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiKey = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiKey) throw new Error('Cloudflare accountId and API token are required.');
  const baseURL = process.env.SYSTEM_ONE_BASE_URL;
  const model = process.env.SYSTEM_ONE_MODEL;
  const client = new SystemOne({
    transport: createFetchTransport(),
    adapter: cloudflareAdapter({ accountId }),
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(model ? { model } : {}),
  });
  const imagePath = process.env.CLOUDFLARE_IMAGE_PATH;
  if (imagePath) {
    const contentType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' } as const)[extname(imagePath).toLowerCase() as '.png' | '.jpg' | '.jpeg' | '.webp'];
    if (!contentType) throw new Error('CLOUDFLARE_IMAGE_PATH must name a PNG, JPEG or WebP file.');
    const imageResult = await client.evaluate({
      state: 'Evaluate the attached image.',
      images: [{ mediaType: contentType, base64: (await readFile(imagePath)).toString('base64') }],
      questions: { document: booleanQuestion('Is this image a document or receipt?') },
    }, { maxRetries: 0 });
    console.log({ model: imageResult.model, answers: imageResult.answers, usage: imageResult.usage, response: imageResult.response });
  }
  const result = await client.evaluate({
    state: { message: 'The same order was charged twice. Please refund the duplicate charge.' },
    questions: {
      department: choice('Choose the team that handles the request.', {
        billing: 'Payments, charges and refunds',
        technical: 'Software defects and integrations',
      }),
      urgency: score('How urgent is the request?', ['No request', 'Routine request', 'Explicit emergency']),
      refund: booleanQuestion('Does the customer request a refund?'),
    },
  }, { maxRetries: 0 });
  console.log({ model: result.model, answers: result.answers, usage: result.usage, response: result.response });
} catch (error) {
  console.error(error instanceof SystemOneError ? { code: error.code, message: error.message } : 'Check .env.cloudflare credentials, model and optional CLOUDFLARE_IMAGE_PATH (PNG/JPEG/WebP).');
  process.exitCode = 1;
}
