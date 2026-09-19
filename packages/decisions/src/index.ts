import { denseArray, freezeJson, identifier, record } from '@system-one-ai/core/composition';
import { ResponseValidationError, ValidationError } from '@system-one-ai/core';
import type { Answer, AnswerFor, ChoiceAnswer, ChoiceQuestion, Description, EvaluateRequest, EvaluationClient, EvaluationResult, Question, Questions, RequestOptions } from '@system-one-ai/core';
import { snapshotRequest, validateResponse } from '@system-one-ai/core/validation';

const candidateBrand: unique symbol = Symbol('CandidateChoice');

/** Only IDs and descriptions are sent to the model. Values remain in this process. */
export interface CandidateChoice<T> {
  readonly [candidateBrand]: true;
  readonly question: ChoiceQuestion;
  /** Resolve against the original candidate membership, never a subsequently mutated array. */
  resolve(id: string): T;
}

export interface NoneChoice {
  readonly id: string;
  readonly description: Description;
}
export interface ChoiceFromOptions<T> {
  readonly instructions: Description;
  readonly items: readonly T[];
  readonly id: (item: T, index: number) => string;
  readonly describe: (item: T, index: number) => Description;
}

export function choiceFrom<T>(options: ChoiceFromOptions<T> & { readonly none: NoneChoice }): CandidateChoice<T | undefined>;
export function choiceFrom<T>(options: ChoiceFromOptions<T> & { readonly none?: never }): CandidateChoice<T>;
export function choiceFrom<T>(options: ChoiceFromOptions<T> & { readonly none?: NoneChoice }): CandidateChoice<T | undefined>;
export function choiceFrom<T>(options: ChoiceFromOptions<T> & { readonly none?: NoneChoice }): CandidateChoice<T | undefined> {
  record(options, 'choiceFrom', ['instructions', 'items', 'id', 'describe', 'none']);
  denseArray(options.items, 'choiceFrom.items');
  if (typeof options.id !== 'function' || typeof options.describe !== 'function') {
    throw new ValidationError('choiceFrom', 'id and describe must be functions');
  }
  const values = new Map<string, T | undefined>();
  const entries: [string, Description][] = [];
  // Copy membership before executing application callbacks. Business objects retain identity.
  const items = [...options.items];
  for (const [index, item] of items.entries()) {
    const id = options.id(item, index);
    identifier(id, `choiceFrom.items[${index}].id`);
    if (values.has(id)) throw new ValidationError('choiceFrom.items', 'candidate IDs must be unique');
    values.set(id, item);
    entries.push([id, options.describe(item, index)]);
  }
  if (options.none !== undefined) {
    record(options.none, 'choiceFrom.none', ['id', 'description']);
    identifier(options.none.id, 'choiceFrom.none.id');
    if (values.has(options.none.id)) throw new ValidationError('choiceFrom.none.id', 'must not collide with a candidate ID');
    values.set(options.none.id, undefined);
    entries.push([options.none.id, options.none.description]);
  }
  if (entries.length === 0) throw new ValidationError('choiceFrom.items', 'provide at least one candidate or an explicit none option');
  const question = freezeJson(snapshotRequest({
    state: {},
    questions: { candidate: { type: 'choice', instructions: options.instructions, criteria: Object.fromEntries(entries) } },
  }).questions.candidate);
  return Object.freeze({
    [candidateBrand]: true as const,
    question,
    resolve(id: string): T | undefined {
      if (!values.has(id)) throw new ResponseValidationError('choice', 'is not a candidate from this definition');
      return values.get(id);
    },
  });
}

export type DecisionParameter = Question | CandidateChoice<unknown>;
export type DecisionParameters = Readonly<Record<string, DecisionParameter>>;
export interface ActionDefinition {
  readonly description: Description;
  readonly parameters?: DecisionParameters;
}
export type DecisionActions = Readonly<Record<string, ActionDefinition>>;
type ActionKey<A extends DecisionActions> = Extract<keyof A, string | number>;
export type ActionName<A extends DecisionActions> = `${ActionKey<A>}`;
export type ParameterValue<P extends DecisionParameter> =
  P extends CandidateChoice<infer T> ? T :
  P extends ChoiceQuestion<infer C> ? `${Extract<keyof C, string | number>}` : number;
export type ParameterAnswer<P extends DecisionParameter> =
  P extends CandidateChoice<unknown> ? ChoiceAnswer : P extends Question ? AnswerFor<P> : never;
type ParametersFor<A extends ActionDefinition> = {
  readonly [K in keyof NonNullable<A['parameters']>]: NonNullable<A['parameters']>[K] extends DecisionParameter
    ? ParameterValue<NonNullable<A['parameters']>[K]> : never;
};
type ParameterAnswersFor<A extends ActionDefinition> = {
  readonly [K in keyof NonNullable<A['parameters']>]: NonNullable<A['parameters']>[K] extends DecisionParameter
    ? ParameterAnswer<NonNullable<A['parameters']>[K]> : never;
};

/** Discriminated by action; unrelated branches' parameters never appear on the selected value. */
export type DecisionValue<A extends DecisionActions> = {
  [K in ActionKey<A>]: {
    readonly action: `${K}`;
    readonly parameters: ParametersFor<A[K]>;
    readonly parameterAnswers: ParameterAnswersFor<A[K]>;
  }
}[ActionKey<A>];
export type DecisionQuestions<A extends DecisionActions> = Questions & {
  readonly action: ChoiceQuestion<Readonly<Record<ActionName<A>, Description>>>;
};
export interface DecisionResult<A extends DecisionActions> {
  readonly decision: DecisionValue<A>;
  /** Complete original evaluation, including distributions, usage, timing and provider metadata. */
  readonly evaluation: EvaluationResult<DecisionQuestions<A>>;
}
export interface DecisionDefinition<A extends DecisionActions> {
  readonly questions: DecisionQuestions<A>;
  /** Validates a normalized evaluation and resolves only the selected branch. Never executes actions. */
  resolve(evaluation: EvaluationResult<DecisionQuestions<A>>): DecisionValue<A>;
  evaluate(client: EvaluationClient, request: Omit<EvaluateRequest, 'questions'>, options?: RequestOptions): Promise<DecisionResult<A>>;
}

function isCandidate(value: DecisionParameter): value is CandidateChoice<unknown> {
  return value !== null && typeof value === 'object' && candidateBrand in value && value[candidateBrand] === true;
}

/** Compile all pre-definable branches into one evaluation. Rebuild for a new candidate set. */
export function defineDecision<const A extends DecisionActions>(options: {
  readonly instructions: Description;
  readonly actions: A;
}): DecisionDefinition<A> {
  record(options, 'decision', ['instructions', 'actions']);
  const actions = record(options.actions, 'decision.actions');
  if (Object.keys(actions).length === 0) throw new ValidationError('decision.actions', 'provide at least one action');
  const criteria: [string, Description][] = [];
  const parameters: [string, Question][] = [];
  const branches = new Map<string, { name: string; questionId: string; resolve: (answer: Answer) => unknown }[]>();
  for (const [actionIndex, [name, rawAction]] of Object.entries(actions).entries()) {
    identifier(name, 'decision.actions');
    const action = record(rawAction, `decision.actions.${name}`, ['description', 'parameters']);
    criteria.push([name, action.description as Description]);
    const fields = action.parameters === undefined ? {} : record(action.parameters, `decision.actions.${name}.parameters`);
    const bindings: { name: string; questionId: string; resolve: (answer: Answer) => unknown }[] = [];
    for (const [parameterIndex, [field, rawParameter]] of Object.entries(fields).entries()) {
      identifier(field, `decision.actions.${name}.parameters`);
      const parameter = rawParameter as DecisionParameter;
      const mapped = isCandidate(parameter);
      const question = mapped ? parameter.question : record(parameter, `decision.actions.${name}.parameters.${field}`, ['type', 'instructions', 'criteria']) as unknown as Question;
      const questionId = `parameter_${actionIndex}_${parameterIndex}`;
      // Each parameter is conditional on its own branch, independent of other branch answers.
      parameters.push([questionId, {
        ...question,
        instructions: {
          action: { id: name, description: action.description as Description },
          instruction: 'Evaluate this parameter assuming this action is selected.',
          parameter: field,
          instructions: question.instructions,
        },
      }]);
      bindings.push({
        name: field, questionId,
        resolve: answer => mapped
          ? parameter.resolve((answer as { choice: string }).choice)
          : answer.type === 'choice' ? answer.choice : answer.type === 'score' ? answer.score : answer.probability,
      });
    }
    branches.set(name, bindings);
  }
  const questions = freezeJson(snapshotRequest({
    state: {},
    questions: Object.fromEntries([
      ['action', { type: 'choice', instructions: options.instructions, criteria: Object.fromEntries(criteria) }],
      ...parameters,
    ]) as Questions,
  }).questions) as DecisionQuestions<A>;

  function resolve(evaluation: EvaluationResult<DecisionQuestions<A>>): DecisionValue<A> {
    const validated = validateResponse(evaluation, questions, 'decision');
    const selected = validated.answers.action.choice;
    const bindings = branches.get(selected)!;
    return {
      action: selected,
      parameters: Object.fromEntries(bindings.map(binding => [binding.name, binding.resolve(validated.answers[binding.questionId]!)])),
      parameterAnswers: Object.fromEntries(bindings.map(binding => [binding.name, validated.answers[binding.questionId]!])),
    } as DecisionValue<A>;
  }
  return Object.freeze({
    questions,
    resolve,
    async evaluate(client: EvaluationClient, request: Omit<EvaluateRequest, 'questions'>, callOptions?: RequestOptions): Promise<DecisionResult<A>> {
      record(request, 'decision.request', ['state', 'model', 'providerOptions']);
      const evaluation = await client.evaluate({ ...request, questions }, callOptions);
      return { decision: resolve(evaluation), evaluation };
    },
  });
}
