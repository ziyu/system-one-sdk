import { SystemOne, SystemOneError, choice, score, booleanQuestion } from '../src/index.js';
import { cloudflareAdapter } from '../src/adapters/cloudflare.js';

// Consumers import @system-one-ai/sdk and @system-one-ai/sdk/adapters/cloudflare.
// npm run example:cloudflare loads this project's .env.cloudflare.
try {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiKey = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiKey) throw new Error('Cloudflare accountId and API token are required.');
  const baseURL = process.env.SYSTEM_ONE_BASE_URL;
  const model = process.env.SYSTEM_ONE_MODEL;
  const client = new SystemOne({
    adapter: cloudflareAdapter({ accountId }),
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(model ? { model } : {}),
  });
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
  console.error(error instanceof SystemOneError ? { code: error.code, message: error.message } : 'Configure CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env.cloudflare.');
  process.exitCode = 1;
}
