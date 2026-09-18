import { SystemOneError } from '../src/index.js';
import { choiceFrom, defineDecision } from '../src/decisions.js';
import { gateChoice } from '../src/policies.js';
import { exampleClient } from './config.js';

// Application-owned objects: only their IDs/descriptions are sent to the model.
const devices = [
  { id: 'desk-lamp', label: 'Desk lamp', on: false },
  { id: 'ceiling-lamp', label: 'Ceiling lamp', on: false },
];
const targets = choiceFrom({
  instructions: 'Select the device explicitly requested by the user.',
  items: devices, id: device => device.id, describe: device => ({ label: device.label, on: device.on }),
});
const definition = defineDecision({
  instructions: 'Choose an available action. Ask when the request does not identify a supported device.',
  actions: {
    turn_on: { description: 'Turn on the requested device', parameters: { device: targets } },
    ask: { description: 'Request clarification' },
    wait: { description: 'No action requested' },
  },
});
const handlers = {
  turn_on({ device }: { device: typeof devices[number] }) {
    device.on = true;
    return { status: 'executed', device: device.id, on: device.on };
  },
};

try {
  const { decision, evaluation } = await definition.evaluate(exampleClient(), {
    state: { userMessage: 'Please turn on the desk lamp.', devices },
  }, { timeoutMs: 5000, maxRetries: 0 });
  // Illustrative threshold; validate it against your application's labeled cases.
  const outcome = gateChoice(evaluation.answers.action, { minProbability: 0.8, abstain: ['ask'] });
  if (outcome.status === 'accepted' && decision.action === 'turn_on') {
    const targetOutcome = gateChoice(decision.parameterAnswers.device, { minProbability: 0.8 });
    if (targetOutcome.status === 'accepted') {
      console.log(handlers.turn_on(decision.parameters));
      // Feedback for the next decision. Rebuild the definition when the candidate set changes.
      console.log({ nextState: { devices } });
    } else {
      console.log({ status: 'target_uncertain', outcome: targetOutcome });
    }
  } else {
    console.log({ action: decision.action, outcome });
  }
} catch (error) {
  console.error({ status: 'failed', code: error instanceof SystemOneError ? error.code : 'application' });
  process.exitCode = 1;
}
