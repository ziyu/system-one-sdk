import type { BooleanQuestion, ChoiceCriteria, ChoiceQuestion, Description, Questions, ScoreQuestion } from './types.js';

export function choice<const C extends ChoiceCriteria>(instructions: Description, criteria: C): ChoiceQuestion<C> {
  return { type: 'choice', instructions, criteria };
}
export function score<const C extends readonly Description[]>(instructions: Description, criteria: C): ScoreQuestion<C> {
  return { type: 'score', instructions, criteria };
}
export function booleanQuestion(instructions: Description, criteria?: BooleanQuestion['criteria']): BooleanQuestion {
  return { type: 'boolean', instructions, ...(criteria === undefined ? {} : { criteria }) };
}
/** Preserves literal question IDs and choice labels when definitions are shared between calls. */
export function defineQuestions<const Q extends Questions>(questions: Q): Q { return questions; }
