import { systemOneAdapter } from '@system-one-ai/adapter-system-one';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { SystemOne, choice, score, booleanQuestion, defineQuestions, type Questions, type SystemOneAdapter } from '@system-one-ai/core';
import { vercelAdapter } from '@system-one-ai/adapter-vercel';
// @ts-expect-error Optional providers must not be re-exported by the core entry point.
import { vercelAdapter as removedRootExport } from '@system-one-ai/core';

const client = new SystemOne({ adapter: systemOneAdapter, transport: createFetchTransport(), apiKey: 'compile-time-only' });
new SystemOne({ transport: createFetchTransport(), apiKey: 'compile-time-only', adapter: vercelAdapter });
void removedRootExport;
const questions = defineQuestions({
  action: choice('Choose an action', { drink: null, rest: { description: 'Sit down' } }),
  urgency: score('Urgency', ['low', 'medium', 'high']),
  interrupt: booleanQuestion('Interrupt?', { true: null, false: 'No new instruction' }),
});

async function verifyInference() {
  const result = await client.evaluate({ state: { message: 'water' }, questions });
  const action: 'drink' | 'rest' = result.answers.action.choice;
  const probability: number | undefined = result.answers.action.probabilities?.drink;
  const booleanProbability: number = result.answers.interrupt.probability;
  const fractionalScore: number = result.answers.urgency.score;
  // @ts-expect-error Choice answers do not turn into arbitrary strings.
  const wrongChoice: 'fly' = result.answers.action.choice;
  // @ts-expect-error Only requested question IDs exist.
  result.answers.unrequested;
  // @ts-expect-error Boolean probabilities are numbers, not booleans.
  const yes: boolean = result.answers.interrupt.probability;
  // @ts-expect-error Each result retains its primitive's type.
  result.answers.action.score;
  const inline = await client.evaluate({ state: '', questions: { color: { type: 'choice', instructions: '', criteria: { red: null, blue: null } } } });
  const color: 'red' | 'blue' = inline.answers.color.choice;
  const numeric = await client.evaluate({ state: '', questions: { level: choice('Level?', { 0: null, 1: null }) } });
  const numericKey: '0' | '1' = numeric.answers.level.choice;
  // @ts-expect-error JSON object keys become strings on the wire, never numeric answer values.
  const numberKey: 0 | 1 = numeric.answers.level.choice;
  void numericKey;
  void numberKey;
  return { action, probability, booleanProbability, fractionalScore, wrongChoice, yes, color };
}

const adapter: SystemOneAdapter = {
  id: 'future', supportedQuestionTypes: ['boolean'],
  prepare: ({ request, baseURL }) => ({ url: `${baseURL}/decisions`, body: { context: request.state, questions: request.questions } }),
  decode: payload => payload,
};
// @ts-expect-error Unknown question primitives require a future SDK contract, not an unchecked string.
const invalidQuestions: Questions = { arbitrary: { type: 'text', instructions: '' } };
void verifyInference;
void adapter;
void invalidQuestions;
