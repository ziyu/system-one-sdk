import { SystemOne, choice, score, booleanQuestion, type EvaluationClient } from '../../src/index.js';
import { choiceFrom, defineDecision } from '../../src/decisions.js';
import { gateBoolean, gateChoice } from '../../src/policies.js';
import { evaluateMany } from '../../src/batch.js';
// @ts-expect-error Optional composition modules stay out of the core entry point.
import { defineDecision as absent } from '../../src/index.js';

const client: EvaluationClient = new SystemOne({ apiKey: null });
const objects = [{ id: 'lamp', brightness: 42 }];
const targets = choiceFrom({ instructions: 'Target', items: objects, id: item => item.id, describe: item => ({ brightness: item.brightness }) });
const optional = choiceFrom({ instructions: 'Target', items: objects, id: item => item.id, describe: () => null, none: { id: 'none', description: null } });
const selected: { id: string; brightness: number } = targets.resolve('lamp');
const maybe: { id: string; brightness: number } | undefined = optional.resolve('none');
// @ts-expect-error A none option requires handling an absent object.
const required: { id: string; brightness: number } = optional.resolve('none');
const definition = defineDecision({ instructions: 'Next action', actions: {
  adjust: { description: null, parameters: { target: targets, mode: choice('Mode', { warm: null, cool: null }), level: score('Level', ['low', 'high']), urgent: booleanQuestion('Urgent?') } },
  wait: { description: null },
} });

async function verify() {
  const result = await definition.evaluate(client, { state: {} });
  const chosen: 'adjust' | 'wait' = result.evaluation.answers.action.choice;
  if (result.decision.action === 'adjust') {
    const target: { id: string; brightness: number } = result.decision.parameters.target;
    const mode: 'warm' | 'cool' = result.decision.parameters.mode;
    const probability: number = result.decision.parameters.urgent;
    const modeAnswer: 'warm' | 'cool' = result.decision.parameterAnswers.mode.choice;
    const targetProbability: number | undefined = result.decision.parameterAnswers.target.probabilities?.lamp;
    // @ts-expect-error Boolean parameters preserve P(true), not a hidden threshold.
    const boolean: boolean = result.decision.parameters.urgent;
    // @ts-expect-error Closed choices retain their labels.
    const wrong: 'green' = result.decision.parameters.mode;
    void [target, mode, probability, boolean, wrong, modeAnswer, targetProbability];
  } else {
    // @ts-expect-error The wait branch has no target parameter.
    result.decision.parameters.target;
  }
  const outcome = gateChoice(result.evaluation.answers.action, { minProbability: 0.8, abstain: ['wait'] });
  if (outcome.status === 'accepted') { const value: 'adjust' | 'wait' = outcome.value; void value; }
  else {
    // @ts-expect-error Uncertainty cannot be used as an accepted action.
    outcome.value;
  }
  // @ts-expect-error Abstention IDs must belong to the answer's option set.
  gateChoice(result.evaluation.answers.action, { minProbability: 0.8, abstain: ['missing'] });
  // @ts-expect-error Choice policy requires an explicit threshold.
  gateChoice(result.evaluation.answers.action, {});
  const bool = gateBoolean({ type: 'boolean', probability: 0.9 }, { maxFalseProbability: 0.2, minTrueProbability: 0.8 });
  if (bool.status === 'accepted') { const value: boolean = bool.value; void value; }
  const batch = await evaluateMany(client, [
    { id: 'route', request: { state: '', questions: { action: choice('Next', { run: null, stop: null }) } } },
    { id: 'score', request: { state: '', questions: { quality: score('Quality', ['low', 'high']) } } },
  ]);
  const id: 'route' = batch.items[0].id;
  if (batch.items[0].status === 'fulfilled') {
    const action: 'run' | 'stop' = batch.items[0].value.answers.action.choice;
    // @ts-expect-error Heterogeneous tuples preserve each item's question types.
    batch.items[0].value.answers.quality;
    void action;
  }
  if (batch.items[1].status === 'fulfilled') { const quality: number = batch.items[1].value.answers.quality.score; void quality; }
  // @ts-expect-error A batch supplies its shared cancellation signal separately.
  await evaluateMany(client, [], { requestOptions: { signal: new AbortController().signal } });
  void [chosen, id];
}
void [absent, selected, maybe, required, verify];
