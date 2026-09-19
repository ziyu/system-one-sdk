import { choice, type EvaluationClient } from '@system-one-ai/core';
import { CloudflareWorkers, createCloudflareWorkers, type CloudflareAiBinding } from '@system-one-ai/adapter-cloudflare/workers';
import { defineDecision } from '@system-one-ai/decisions';
import { evaluateMany } from '@system-one-ai/batch';
// @ts-expect-error Native binding is an optional entry, not a core export.
import { CloudflareWorkers as absentRootExport } from '@system-one-ai/core';

declare const binding: CloudflareAiBinding;
const native = createCloudflareWorkers({ binding, timeoutMs: 1500, maxRetries: 0 });
const common: EvaluationClient = native;
new CloudflareWorkers({ binding });
// @ts-expect-error Binding must be provided.
createCloudflareWorkers({});
// @ts-expect-error Native binding does not use an API token.
createCloudflareWorkers({ binding, apiKey: 'token' });
// @ts-expect-error Native binding does not use an account ID or a REST URL.
createCloudflareWorkers({ binding, accountId: 'account' });

async function check() {
  const result = await native.evaluate({ state: {}, questions: { action: choice('Act?', { run: null, stop: null }) } });
  const action: 'run' | 'stop' = result.answers.action.choice;
  // @ts-expect-error Result stays a closed choice union.
  const invalid: 'fly' = result.answers.action.choice;
  const decision = defineDecision({ instructions: 'Act', actions: { run: { description: null }, stop: { description: null } } });
  const selected = await decision.evaluate(common, { state: {} });
  const name: 'run' | 'stop' = selected.decision.action;
  await evaluateMany(native, [{ id: 'one', request: { state: {}, questions: decision.questions } }]);
  void [action, invalid, name];
}
void [check, absentRootExport];
