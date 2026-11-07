import { ResponseValidationError, ValidationError } from '@system-one-ai/core';
import type {
  Answer, BooleanQuestion, Description, EvaluateRequest, ImageInput, Question, Questions, Usage,
} from '@system-one-ai/core';
import { hasOwn, isRecord, responseRecord } from '@system-one-ai/core/validation';

/** Current native OpenAI limit; Cloudflare's proxied schema is lower. */
export const OPENAI_DECISIONS_MAX_QUESTIONS = 400;
export const OPENAI_DECISIONS_MAX_CHOICES = 255;
export const OPENAI_DECISIONS_MAX_SCORE_LEVELS = 10;

export interface OpenAiDecisionsEncodeOptions {
  /** Provider-specific question cap. Defaults to OpenAI's native limit. */
  readonly maxQuestions?: number;
  /**
   * Encode object and array state as an `input_json` part. Use `text` for a
   * provider whose published schema only accepts `input_text` and `input_image`.
   */
  readonly structuredState?: 'json' | 'text';
}

function textOf(value: Description): string {
  if (value === null) return 'No additional instructions.';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function predicateInstructions(question: BooleanQuestion): string {
  let instructions = textOf(question.instructions);
  if (question.criteria?.true !== undefined) instructions += `\nTrue criteria: ${textOf(question.criteria.true)}`;
  if (question.criteria?.false !== undefined) instructions += `\nFalse criteria: ${textOf(question.criteria.false)}`;
  return instructions;
}

function decisionQuestion(id: string, question: Question): Record<string, unknown> {
  if (question.type === 'boolean') {
    return { name: id, type: 'predicate', instructions: predicateInstructions(question) };
  }
  const instructions = textOf(question.instructions);
  if (question.type === 'choice') {
    const options = Object.entries(question.criteria);
    if (options.length < 2) {
      throw new ValidationError(`questions.${id}.criteria`, 'OpenAI Decisions choice questions require at least two options');
    }
    if (options.length > OPENAI_DECISIONS_MAX_CHOICES) {
      throw new ValidationError(`questions.${id}.criteria`, `OpenAI Decisions choice questions accept at most ${OPENAI_DECISIONS_MAX_CHOICES} options`);
    }
    return {
      name: id, type: 'choice', instructions,
      choices: options.map(([value, description]) => ({
        value,
        ...(description === null ? {} : { description: textOf(description) }),
      })),
    };
  }
  if (question.criteria.length < 2) {
    throw new ValidationError(`questions.${id}.criteria`, 'OpenAI Decisions score questions require at least two levels');
  }
  if (question.criteria.length > OPENAI_DECISIONS_MAX_SCORE_LEVELS) {
    throw new ValidationError(`questions.${id}.criteria`, `OpenAI Decisions score questions accept at most ${OPENAI_DECISIONS_MAX_SCORE_LEVELS} levels`);
  }
  return {
    name: id, type: 'score', instructions,
    levels: question.criteria.map((criterion, index) => typeof criterion === 'string' && criterion.length > 0
      ? { label: criterion }
      : { label: String(index), ...(criterion === null ? {} : { description: textOf(criterion) }) }),
  };
}

function imageURL(image: ImageInput): string {
  return typeof image === 'string' ? image : `data:${image.mediaType};base64,${image.base64}`;
}

function message(content: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { role: 'user', type: 'message', content };
}

function canUseJsonState(state: Exclude<EvaluateRequest['state'], string>): boolean {
  return isRecord(state) || Array.isArray(state) && state.every(entry => isRecord(entry));
}

function inputOf(request: EvaluateRequest, structuredState: 'json' | 'text'): unknown {
  const { state } = request;
  const images = (request.images ?? []).map(image => ({ type: 'input_image', image_url: imageURL(image) }));
  if (typeof state === 'string') {
    return images.length === 0 ? state : [message([{ type: 'input_text', text: state }, ...images])];
  }
  if (structuredState === 'json' && canUseJsonState(state)) {
    return [message([{ type: 'input_json', data: state }, ...images])];
  }
  const text = JSON.stringify(state);
  return images.length === 0 ? text : [message([{ type: 'input_text', text }, ...images])];
}

/** Encodes the shared input and question primitives expected by OpenAI Decisions. */
export function encodeOpenAiDecisionsRequest(
  request: EvaluateRequest,
  options: OpenAiDecisionsEncodeOptions = {},
): Record<string, unknown> {
  const ids = Object.keys(request.questions);
  const maxQuestions = options.maxQuestions ?? OPENAI_DECISIONS_MAX_QUESTIONS;
  if (ids.length > maxQuestions) {
    throw new ValidationError('questions', `OpenAI Decisions accepts at most ${maxQuestions} questions per request`);
  }
  return {
    input: inputOf(request, options.structuredState ?? 'json'),
    questions: ids.map(id => decisionQuestion(id, request.questions[id]!)),
  };
}

function probabilityOf(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ResponseValidationError(path, 'expected a probability between 0 and 1');
  }
  return value;
}

function confidenceOf(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : probabilityOf(value, path);
}

function choiceProbabilities(value: unknown, path: string): Readonly<Record<string, number>> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ResponseValidationError(path, 'expected a probabilities array');
  const result: Record<string, number> = {};
  value.forEach((entry, index) => {
    const item = responseRecord(entry, `${path}[${index}]`);
    const option = item.value;
    if (typeof option !== 'string' && typeof option !== 'boolean') {
      throw new ResponseValidationError(`${path}[${index}].value`, 'expected a choice value');
    }
    const key = String(option);
    if (hasOwn(result, key)) throw new ResponseValidationError(`${path}[${index}].value`, 'duplicate choice value');
    result[key] = probabilityOf(item.probability, `${path}[${index}].probability`);
  });
  return result;
}

function scoreProbabilities(value: unknown, path: string): Readonly<Record<string, number>> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ResponseValidationError(path, 'expected a probabilities array');
  const result: Record<string, number> = {};
  value.forEach((entry, index) => {
    const item = responseRecord(entry, `${path}[${index}]`);
    const level = item.value;
    if (typeof level !== 'number' || !Number.isSafeInteger(level) || level < 0) {
      throw new ResponseValidationError(`${path}[${index}].value`, 'expected a nonnegative level index');
    }
    const key = String(level);
    if (hasOwn(result, key)) throw new ResponseValidationError(`${path}[${index}].value`, 'duplicate level index');
    result[key] = probabilityOf(item.probability, `${path}[${index}].probability`);
  });
  return result;
}

function decodeAnswer(answer: Record<string, unknown>, question: Question, path: string): Answer {
  if (answer.type === 'refusal') {
    throw new ResponseValidationError(path, 'OpenAI Decisions refused to answer');
  }
  if (answer.type === 'predicate') {
    if (question.type !== 'boolean') throw new ResponseValidationError(`${path}.type`, 'does not match its question');
    return { type: 'boolean', probability: probabilityOf(answer.probability, `${path}.probability`) };
  }
  if (answer.type === 'choice') {
    if (question.type !== 'choice') throw new ResponseValidationError(`${path}.type`, 'does not match its question');
    if (typeof answer.choice !== 'string' && typeof answer.choice !== 'boolean') {
      throw new ResponseValidationError(`${path}.choice`, 'expected a choice value');
    }
    const probabilities = choiceProbabilities(answer.probabilities, `${path}.probabilities`);
    const confidence = confidenceOf(answer.confidence, `${path}.confidence`);
    return {
      type: 'choice', choice: String(answer.choice),
      ...(probabilities === undefined ? {} : { probabilities }),
      ...(confidence === undefined ? {} : { confidence }),
    };
  }
  if (answer.type === 'score') {
    if (question.type !== 'score') throw new ResponseValidationError(`${path}.type`, 'does not match its question');
    if (typeof answer.score !== 'number' || !Number.isFinite(answer.score)) {
      throw new ResponseValidationError(`${path}.score`, 'expected a finite number');
    }
    const probabilities = scoreProbabilities(answer.probabilities, `${path}.probabilities`);
    const confidence = confidenceOf(answer.confidence, `${path}.confidence`);
    return {
      type: 'score', score: answer.score,
      ...(probabilities === undefined ? {} : { probabilities }),
      ...(confidence === undefined ? {} : { confidence }),
      legend: Object.fromEntries(question.criteria.map((criterion, index) => [String(index), criterion])),
    };
  }
  throw new ResponseValidationError(`${path}.type`, 'expected predicate, choice, score, or refusal');
}

function tokenCount(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ResponseValidationError(path, 'expected a nonnegative integer token count');
  }
  return value;
}

function usageOf(value: unknown): Usage {
  const usage = responseRecord(value, 'usage');
  return {
    ...(usage.input_tokens === undefined ? {} : { inputTokens: tokenCount(usage.input_tokens, 'usage.input_tokens') }),
    ...(usage.output_tokens === undefined ? {} : { outputTokens: tokenCount(usage.output_tokens, 'usage.output_tokens') }),
  };
}

/** Converts the Decisions answer array into the keyed answer map used by core. */
export function decodeOpenAiDecisionsResponse(
  value: unknown,
  questions: Questions,
): Record<string, unknown> {
  const payload = responseRecord(value, 'response');
  if (!Array.isArray(payload.answers)) {
    throw new ResponseValidationError('answers', 'expected an OpenAI Decisions answer array');
  }
  const ids = Object.keys(questions);
  if (payload.answers.length !== ids.length) {
    throw new ResponseValidationError('answers', 'expected one answer for every question');
  }
  const answers: Record<string, Answer> = {};
  payload.answers.forEach((raw, index) => {
    const answer = responseRecord(raw, `answers[${index}]`);
    const name = answer.name === undefined || answer.name === null ? ids[index] : answer.name;
    if (typeof name !== 'string' || !hasOwn(questions, name)) {
      throw new ResponseValidationError(`answers[${index}].name`, 'expected a requested question name');
    }
    if (hasOwn(answers, name)) {
      throw new ResponseValidationError(`answers[${index}].name`, 'duplicate answer name');
    }
    answers[name] = decodeAnswer(answer, questions[name]!, `answers[${index}]`);
  });
  return {
    ...payload,
    answers,
    ...(payload.usage === undefined ? {} : { usage: usageOf(payload.usage) }),
  };
}
