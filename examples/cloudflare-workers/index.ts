import { APIError, SystemOneError, booleanQuestion, choice, score } from '@system-one-ai/core';
import { createCloudflareWorkers, type CloudflareAiBinding } from '@system-one-ai/adapter-cloudflare/workers';

interface Env { AI: CloudflareAiBinding }

/** Fixed-input live smoke example. Production services supply their own auth and quotas. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== '/') return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('POST to run the fixed inference example.', { status: 405, headers: { allow: 'POST' } });
    const client = createCloudflareWorkers({ binding: env.AI, timeoutMs: 15_000, maxRetries: 0 });
    try {
      const result = await client.evaluate({
        state: 'Help! My payouts have been failing for 3 days.',
        questions: {
          urgent: booleanQuestion('Does this convey urgency?'),
          department: choice('Which team should handle this?', { billing: 'Payments, invoicing, refunds', technical: 'Bugs, outages, integrations', sales: 'Pricing, upgrades' }),
          frustration: score('How frustrated is the customer?', ['Calm', 'Frustrated', 'Very angry']),
        },
      }, { signal: request.signal });
      return Response.json(result);
    } catch (error) {
      const code = error instanceof SystemOneError ? error.code : 'application';
      return Response.json({ error: { code, ...(error instanceof APIError ? { upstreamStatus: error.statusCode, requestId: error.requestId } : {}) } }, { status: 502 });
    }
  },
};
