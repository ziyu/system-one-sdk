import { choice, SystemOneError, type State, type EvaluationClient } from '@system-one-ai/core';
import { gateChoice, type UncertaintyReason } from '@system-one-ai/policies';
import { exampleClient } from './config.js';

interface Handoff {
  readonly state: State;
  readonly reason: UncertaintyReason | 'abstain-option';
}

// Replace this application callback with your own LLM, human-review queue or workflow.
// Transport/model failures still reject; only an actual uncertain/abstained result is handed off.
export async function routeOrHandoff(client: EvaluationClient, state: State, slowThink: (handoff: Handoff) => Promise<void>) {
  const evaluation = await client.evaluate({
    state,
    questions: { route: choice('Choose a team only when the request clearly identifies the issue.', {
      billing: 'Payments, duplicate charges, refunds',
      support: 'Technical faults',
      clarify: 'Insufficient information; request clarification',
    }) },
  }, { maxRetries: 0, timeoutMs: 5000 });
  const outcome = gateChoice(evaluation.answers.route, { minProbability: 0.9, minMargin: 0.2, abstain: ['clarify'] });
  if (outcome.status !== 'accepted') await slowThink({ state, reason: outcome.reason });
  return { outcome, evaluation };
}

try {
  const result = await routeOrHandoff(exampleClient(), 'I need help with my account.', async handoff => {
    const endpoint = process.env.SLOW_THINK_URL;
    if (!endpoint) {
      console.log({ status: 'handoff_required', ...handoff, note: 'Set SLOW_THINK_URL to dispatch to your own service.' });
      return;
    }
    // Example application contract: POST {state, reason}; any 2xx acknowledges the handoff.
    const apiKey = process.env.SLOW_THINK_API_KEY;
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(handoff),
    });
    void response.body?.cancel().catch(() => {});
    if (!response.ok) throw new Error('Handoff service rejected the request.');
    console.log({ status: 'handed_off', httpStatus: response.status });
  });
  console.log({ outcome: result.outcome, usage: result.evaluation.usage });
} catch (error) {
  console.error({ status: 'failed', code: error instanceof SystemOneError ? error.code : 'application' });
  process.exitCode = 1;
}
