import type { Questions } from '@system-one-ai/core';
import { isRecord, responseRecord } from '@system-one-ai/core/validation';

/** Shared wire encoding for native System One question primitives. */
export function nativeQuestions(questions: Questions) {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => [
    id, question.type === 'boolean' ? { ...question, type: 'noul' as const } : question,
  ]));
}

export function decodeNative(payload: unknown) {
  const root = responseRecord(payload, 'response');
  const rawAnswers = responseRecord(root.answers, 'answers');
  const answers = Object.fromEntries(Object.entries(rawAnswers).map(([id, value]) => {
    const answer = responseRecord(value, `answers.${id}`);
    return [id, answer.type === 'noul' ? { type: 'boolean', probability: answer.noul } : answer];
  }));
  let usage: unknown = root.usage;
  if (isRecord(usage)) {
    usage = {
      ...(usage.input_tokens == null ? {} : { inputTokens: usage.input_tokens }),
      ...(usage.output_tokens == null ? {} : { outputTokens: usage.output_tokens }),
    };
  }
  return {
    ...root, answers,
    ...(usage === undefined ? {} : { usage }),
    // TypeSafe displays rounded probabilities/scores. Never renormalize the original values.
    rounding: root.rounding ?? { probabilityDecimals: 2, scoreDecimals: 2 },
  };
}
