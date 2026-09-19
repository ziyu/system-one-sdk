import { ConfigurationError, ResponseValidationError } from '@system-one-ai/core';
import type { BooleanAnswer, ChoiceAnswer } from '@system-one-ai/core';
import { hasOwn, isRecord } from '@system-one-ai/core/validation';

export type UncertaintyReason = 'missing-probabilities' | 'missing-confidence' | 'below-probability' | 'below-margin' | 'below-confidence' | 'between-thresholds';
export type PolicyResult<T> =
  | { readonly status: 'accepted'; readonly value: T }
  | { readonly status: 'uncertain'; readonly reason: UncertaintyReason }
  | { readonly status: 'abstained'; readonly reason: 'abstain-option' };

interface ChoiceThresholds {
  readonly minProbability?: number;
  readonly minMargin?: number;
  readonly minConfidence?: number;
}
/** All supplied thresholds must pass. There is deliberately no default threshold. */
export type ChoicePolicy<K extends string = string> = ChoiceThresholds & {
  readonly abstain?: readonly K[];
} & (
  | { readonly minProbability: number }
  | { readonly minMargin: number }
  | { readonly minConfidence: number }
);

export interface BooleanPolicy {
  /** Accept false when P(true) is at or below this value. */
  readonly maxFalseProbability: number;
  /** Accept true when P(true) is at or above this value. Must exceed maxFalseProbability. */
  readonly minTrueProbability: number;
}

function unit(value: unknown, path: string, configuration = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    if (configuration) throw new ConfigurationError(`${path} must be a finite number between zero and one.`);
    throw new ResponseValidationError(path, 'expected a finite number between zero and one');
  }
  return value;
}

function policyRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) {
    throw new ConfigurationError('policy must be an object containing only supported fields.');
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor) || !descriptor.enumerable) throw new ConfigurationError('policy must contain enumerable data properties.');
  }
  return value;
}

/** Pure policy evaluation. It neither invokes callbacks nor converts API failures to uncertainty. */
export function gateChoice<const K extends string>(answer: ChoiceAnswer<K>, policy: ChoicePolicy<NoInfer<K>>): PolicyResult<K> {
  const config = policyRecord(policy, ['minProbability', 'minMargin', 'minConfidence', 'abstain']);
  const thresholds = ['minProbability', 'minMargin', 'minConfidence'] as const;
  if (!thresholds.some(key => config[key] !== undefined)) throw new ConfigurationError('Provide at least one explicit choice threshold.');
  for (const key of thresholds) if (config[key] !== undefined) unit(config[key], `policy.${key}`, true);
  if (config.abstain !== undefined) {
    const ids = config.abstain;
    if (!Array.isArray(ids) || Object.getPrototypeOf(ids) !== Array.prototype || Reflect.ownKeys(ids).length !== ids.length + 1) {
      throw new ConfigurationError('policy.abstain must be a dense array of option IDs.');
    }
    for (let index = 0; index < ids.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(ids, String(index));
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || typeof descriptor.value !== 'string' || !descriptor.value.trim()) {
        throw new ConfigurationError('policy.abstain must contain nonempty option IDs without accessors.');
      }
    }
  }
  if (!isRecord(answer) || answer.type !== 'choice' || typeof answer.choice !== 'string' || !answer.choice.trim()) {
    throw new ResponseValidationError('answer', 'expected a choice answer');
  }
  let probability: number | undefined;
  let margin: number | undefined;
  if (answer.probabilities !== undefined) {
    const probabilities = answer.probabilities;
    if (!isRecord(probabilities) || !hasOwn(probabilities, answer.choice)) {
      throw new ResponseValidationError('answer.probabilities', 'must contain the selected option');
    }
    let alternative = 0;
    for (const [key, value] of Object.entries(probabilities)) {
      const p = unit(value, 'answer.probabilities');
      if (key !== answer.choice) alternative = Math.max(alternative, p);
    }
    probability = unit(probabilities[answer.choice], 'answer.probabilities');
    margin = probability - alternative;
  }
  if (answer.confidence !== undefined) unit(answer.confidence, 'answer.confidence');
  if (policy.abstain?.includes(answer.choice)) return { status: 'abstained', reason: 'abstain-option' };
  if ((policy.minProbability !== undefined || policy.minMargin !== undefined) && probability === undefined) {
    return { status: 'uncertain', reason: 'missing-probabilities' };
  }
  if (policy.minConfidence !== undefined && answer.confidence === undefined) return { status: 'uncertain', reason: 'missing-confidence' };
  if (policy.minProbability !== undefined && probability! < policy.minProbability) return { status: 'uncertain', reason: 'below-probability' };
  // Compensate for subtraction's machine precision only; never apply provider rounding here.
  const marginTolerance = margin === 0 ? 0 : Number.EPSILON;
  if (policy.minMargin !== undefined && margin! < policy.minMargin - marginTolerance) return { status: 'uncertain', reason: 'below-margin' };
  if (policy.minConfidence !== undefined && answer.confidence! < policy.minConfidence) return { status: 'uncertain', reason: 'below-confidence' };
  return { status: 'accepted', value: answer.choice };
}

/** Two inclusive acceptance regions with an explicit uncertain interval between them. */
export function gateBoolean(answer: BooleanAnswer, policy: BooleanPolicy): PolicyResult<boolean> {
  const config = policyRecord(policy, ['maxFalseProbability', 'minTrueProbability']);
  const low = unit(config.maxFalseProbability, 'policy.maxFalseProbability', true);
  const high = unit(config.minTrueProbability, 'policy.minTrueProbability', true);
  if (low >= high) throw new ConfigurationError('maxFalseProbability must be less than minTrueProbability.');
  if (!isRecord(answer) || answer.type !== 'boolean') throw new ResponseValidationError('answer', 'expected a boolean answer');
  const probability = unit(answer.probability, 'answer.probability');
  if (probability <= low) return { status: 'accepted', value: false };
  if (probability >= high) return { status: 'accepted', value: true };
  return { status: 'uncertain', reason: 'between-thresholds' };
}
