import { ConfigurationError, ResponseValidationError, ValidationError } from './errors.js';
import type { Answer, Answers, Description, EvaluateRequest, JsonObject, JsonValue, ProviderResponse, Questions, Rounding, Usage } from './types.js';

type Fail = (path: string, message: string) => never;
const invalidInput: Fail = (path, message) => { throw new ValidationError(path, message); };
const invalidResponse: Fail = (path, message) => { throw new ResponseValidationError(path, message); };
export const hasOwn = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
export function responseRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalidResponse(path, 'expected an object');
  return value;
}

/** Reject silent JSON losses (NaN, undefined, cycles, getters, class instances, sparse arrays). */
export function assertJson(value: unknown, path: string, fail: Fail = invalidInput, stack = new Set<object>(), depth = 0): asserts value is JsonValue {
  if (depth > 128) fail(path, 'JSON nesting exceeds 128 levels');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'expected a finite JSON number');
    return;
  }
  if (typeof value !== 'object' || !Array.isArray(value) && !isRecord(value)) {
    fail(path, 'expected JSON data; functions, undefined, bigint, and class instances are unsupported');
  }
  if (stack.has(value)) fail(path, 'circular JSON reference');
  if (Object.getOwnPropertySymbols(value).length) fail(path, 'symbol properties are unsupported');
  stack.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(path, 'array subclasses are unsupported');
    if (Object.getOwnPropertyNames(value).length !== value.length + 1) fail(path, 'extra array properties are unsupported');
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) fail(path, 'sparse arrays and accessors are unsupported');
      assertJson(descriptor.value, `${path}[${index}]`, fail, stack, depth + 1);
    }
    if (Object.keys(value).length !== value.length) fail(path, 'extra array properties are unsupported');
  } else {
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) fail(path, 'accessor properties are unsupported');
      // JSON.stringify can invoke even a nonenumerable toJSON method.
      if (descriptor.enumerable || key === 'toJSON') assertJson(descriptor.value, `${path}.${key}`, fail, stack, depth + 1);
    }
  }
  stack.delete(value);
}

function description(value: unknown, path: string, fail: Fail = invalidInput): asserts value is Description {
  if (value !== null && typeof value !== 'string' && !Array.isArray(value) && !isRecord(value)) {
    fail(path, 'expected a string, object, array, or null');
  }
  assertJson(value, path, fail);
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, fail: Fail): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(path, 'contains an unsupported field');
}
function nonemptyString(value: unknown, path: string, fail: Fail): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(path, 'expected a nonempty string');
}

export function snapshotRequest<Q extends Questions>(request: EvaluateRequest<Q>): EvaluateRequest<Q> {
  if (!isRecord(request)) invalidInput('request', 'expected an object');
  if (Object.getOwnPropertySymbols(request).length) invalidInput('request', 'symbol properties are unsupported');
  for (const key of Object.getOwnPropertyNames(request)) {
    if (!('value' in Object.getOwnPropertyDescriptor(request, key)!)) invalidInput('request', 'accessor properties are unsupported');
  }
  onlyKeys(request, ['state', 'questions', 'model', 'providerOptions'], 'request', invalidInput);
  if (!hasOwn(request, 'state') || request.state === null) invalidInput('state', 'expected a string, object, or array');
  description(request.state, 'state');
  if (!hasOwn(request, 'questions') || !isRecord(request.questions) || Object.keys(request.questions).length === 0) invalidInput('questions', 'expected at least one named question');
  assertJson(request.questions, 'questions');
  for (const [id, value] of Object.entries(request.questions)) {
    nonemptyString(id, 'questions', invalidInput);
    const path = `questions.${id}`;
    if (!isRecord(value)) invalidInput(path, 'expected an object');
    onlyKeys(value, ['type', 'instructions', 'criteria'], path, invalidInput);
    if (!hasOwn(value, 'instructions')) invalidInput(`${path}.instructions`, 'is required');
    description(value.instructions, `${path}.instructions`);
    if (value.type === 'choice') {
      if (!isRecord(value.criteria) || Object.keys(value.criteria).length === 0) invalidInput(`${path}.criteria`, 'expected at least one named option');
      for (const [key, entry] of Object.entries(value.criteria)) {
        nonemptyString(key, `${path}.criteria`, invalidInput);
        description(entry, `${path}.criteria.${key}`);
      }
    } else if (value.type === 'score') {
      if (!Array.isArray(value.criteria) || value.criteria.length < 2) invalidInput(`${path}.criteria`, 'expected at least two ordered levels');
      value.criteria.forEach((entry: unknown, index: number) => description(entry, `${path}.criteria[${index}]`));
    } else if (value.type === 'boolean') {
      if (value.criteria !== undefined) {
        if (!isRecord(value.criteria)) invalidInput(`${path}.criteria`, 'expected an object');
        onlyKeys(value.criteria, ['true', 'false'], `${path}.criteria`, invalidInput);
        for (const [key, entry] of Object.entries(value.criteria)) description(entry, `${path}.criteria.${key}`);
      }
    } else invalidInput(`${path}.type`, 'expected choice, score, or boolean');
  }
  if (request.model !== undefined) nonemptyString(request.model, 'model', invalidInput);
  if (request.providerOptions !== undefined) {
    if (!isRecord(request.providerOptions)) invalidInput('providerOptions', 'expected an object');
    assertJson(request.providerOptions, 'providerOptions');
  }
  // A stable snapshot prevents caller mutation while an asynchronous API key or retry is pending.
  return JSON.parse(JSON.stringify({
    state: request.state,
    questions: request.questions,
    ...(request.model === undefined ? {} : { model: request.model }),
    ...(request.providerOptions === undefined ? {} : { providerOptions: request.providerOptions }),
  })) as EvaluateRequest<Q>;
}

function numberIn(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    invalidResponse(path, `expected a finite number between ${min} and ${max}`);
  }
  return value;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !hasOwn(value, key))) invalidResponse(path, 'keys must match the request exactly');
}
function roundingOf(value: unknown): Rounding | undefined {
  if (value === undefined) return undefined;
  const record = responseRecord(value, 'rounding');
  const result: { probabilityDecimals?: number; scoreDecimals?: number } = {};
  for (const key of ['probabilityDecimals', 'scoreDecimals'] as const) {
    if (record[key] === undefined) continue;
    const number = numberIn(record[key], 0, 15, `rounding.${key}`);
    if (!Number.isInteger(number)) invalidResponse(`rounding.${key}`, 'expected an integer');
    result[key] = number;
  }
  return result;
}
function usageOf(value: unknown): Usage {
  if (value === undefined) return {};
  const record = responseRecord(value, 'usage');
  const result: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
  for (const key of ['inputTokens', 'outputTokens'] as const) {
    if (record[key] === undefined) continue;
    const count = numberIn(record[key], 0, Number.MAX_SAFE_INTEGER, `usage.${key}`);
    if (!Number.isSafeInteger(count)) invalidResponse(`usage.${key}`, 'expected a safe integer');
    result[key] = count;
  }
  if (result.inputTokens !== undefined && result.outputTokens !== undefined) {
    const total = result.inputTokens + result.outputTokens;
    if (!Number.isSafeInteger(total)) invalidResponse('usage.totalTokens', 'total exceeds the safe integer range');
    result.totalTokens = total;
  }
  return result;
}
function probabilitiesOf(value: unknown, keys: readonly string[], path: string, rounding: Rounding | undefined): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  const record = responseRecord(value, path);
  exactKeys(record, keys, path);
  const probabilities = Object.fromEntries(keys.map(key => [key, numberIn(record[key], 0, 1, `${path}.${key}`)]));
  const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
  const unit = rounding?.probabilityDecimals === undefined ? 0 : 10 ** -rounding.probabilityDecimals;
  if (Math.abs(sum - 1) > 1e-6 + keys.length * unit / 2) invalidResponse(path, 'probabilities do not sum to one within reported rounding');
  return probabilities;
}

export function validateResponse<Q extends Questions>(payload: unknown, questions: Q, requestedModel: string): Omit<ProviderResponse, 'answers' | 'model' | 'usage' | 'warnings'> & {
  model: string; answers: Answers<Q>; usage: Usage; warnings: readonly JsonValue[];
} {
  const root = responseRecord(payload, 'response');
  const source = responseRecord(root.answers, 'answers');
  exactKeys(source, Object.keys(questions), 'answers');
  const rounding = roundingOf(root.rounding);
  const result: [string, Answer][] = [];
  for (const [id, question] of Object.entries(questions)) {
    const path = `answers.${id}`;
    const answer = responseRecord(source[id], path);
    if (answer.type !== question.type) invalidResponse(`${path}.type`, 'does not match its question');
    if (question.type === 'boolean') {
      result.push([id, { type: 'boolean', probability: numberIn(answer.probability, 0, 1, `${path}.probability`) }]);
      continue;
    }
    const keys = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_, index) => String(index));
    const probabilities = probabilitiesOf(answer.probabilities, keys, `${path}.probabilities`, rounding);
    const confidence = answer.confidence === undefined ? undefined : numberIn(answer.confidence, 0, 1, `${path}.confidence`);
    const common = {
      ...(probabilities === undefined ? {} : { probabilities }),
      ...(confidence === undefined ? {} : { confidence }),
    };
    if (question.type === 'choice') {
      if (typeof answer.choice !== 'string' || !hasOwn(question.criteria, answer.choice)) invalidResponse(`${path}.choice`, 'is not a declared option');
      if (probabilities) {
        const max = Object.values(probabilities).reduce((a, b) => Math.max(a, b), 0);
        const unit = rounding?.probabilityDecimals === undefined ? 0 : 10 ** -rounding.probabilityDecimals;
        if (probabilities[answer.choice]! < max - 1e-6 - unit) invalidResponse(`${path}.choice`, 'is not a highest-probability option');
      }
      result.push([id, { type: 'choice', choice: answer.choice, ...common }]);
    } else {
      const score = numberIn(answer.score, 0, question.criteria.length - 1, `${path}.score`);
      if (probabilities) {
        const mean = keys.reduce((sum, key) => sum + Number(key) * probabilities[key]!, 0);
        const pUnit = rounding?.probabilityDecimals === undefined ? 0 : 10 ** -rounding.probabilityDecimals;
        const sUnit = rounding?.scoreDecimals === undefined ? 0 : 10 ** -rounding.scoreDecimals;
        const tolerance = 1e-6 + sUnit / 2 + keys.reduce((sum, key) => sum + Number(key), 0) * pUnit / 2;
        if (Math.abs(score - mean) > tolerance) invalidResponse(`${path}.score`, 'does not match the probability-weighted mean');
      }
      let legend: Record<string, Description> | undefined;
      if (answer.legend !== undefined) {
        const rawLegend = responseRecord(answer.legend, `${path}.legend`);
        exactKeys(rawLegend, keys, `${path}.legend`);
        legend = Object.fromEntries(keys.map(key => {
          description(rawLegend[key], `${path}.legend.${key}`, invalidResponse);
          return [key, rawLegend[key] as Description];
        }));
      }
      result.push([id, { type: 'score', score, ...common, ...(legend === undefined ? {} : { legend }) }]);
    }
  }
  const model = root.model === undefined ? requestedModel : root.model;
  nonemptyString(model, 'model', invalidResponse);
  let providerMetadata: JsonObject | undefined;
  if (root.providerMetadata !== undefined) {
    if (!isRecord(root.providerMetadata)) invalidResponse('providerMetadata', 'expected an object');
    assertJson(root.providerMetadata, 'providerMetadata', invalidResponse);
    providerMetadata = root.providerMetadata as JsonObject;
  }
  const warnings = root.warnings ?? [];
  if (!Array.isArray(warnings)) invalidResponse('warnings', 'expected an array');
  assertJson(warnings, 'warnings', invalidResponse);
  return {
    model, answers: Object.fromEntries(result) as Answers<Q>, usage: usageOf(root.usage), warnings,
    ...(rounding === undefined ? {} : { rounding }),
    ...(providerMetadata === undefined ? {} : { providerMetadata }),
  };
}

export function configInteger(value: number, name: string, min: number, max = 2_147_483_647): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new ConfigurationError(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}
export { parseBaseURL } from './http.js';
