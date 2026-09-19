import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { SystemOne, choice, score, booleanQuestion } from '@system-one-ai/core';
import { openRouterAdapter } from '@system-one-ai/adapter-openrouter';

// In a consuming app, import from @system-one-ai/core and @system-one-ai/adapter-openrouter.
// Run with npm run example:openrouter to load this project's .env.openrouter.
try {
  const apiKey = process.env.SYSTEM_ONE_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Configure SYSTEM_ONE_API_KEY in .env.openrouter.');
  const baseURL = process.env.SYSTEM_ONE_BASE_URL;
  const model = process.env.SYSTEM_ONE_MODEL;
  const client = new SystemOne({
    transport: createFetchTransport(),
    adapter: openRouterAdapter,
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(model ? { model } : {}),
  });
  const result = await client.evaluate({
    state: { userMessage: 'Please get me a glass of water.', currentAction: 'rest' },
    questions: {
      action: choice('Choose the next action.', { drink: 'Get water', rest: 'Continue resting', think: 'Ask for a plan' }),
      urgency: score('How urgent is the request?', ['No task', 'Routine request', 'Immediate action requested']),
      interrupt: booleanQuestion('Should the current activity change?'),
    },
  }, { maxRetries: 0 });
  console.log({ model: result.model, answers: result.answers, usage: result.usage, openrouter: result.providerMetadata?.openrouter });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'OpenRouter evaluation failed.');
  process.exitCode = 1;
}
