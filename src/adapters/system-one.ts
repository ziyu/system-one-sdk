import { UnsupportedFeatureError } from '../errors.js';
import type { AdapterContext, Questions, SystemOneAdapter } from '../types.js';
import { isRecord, parseBaseURL, responseRecord } from '../validation.js';

const questionTypes = Object.freeze(['choice', 'score', 'boolean'] as const);

/** Shared wire encoding for native System One question primitives. */
export function nativeQuestions(questions: Questions) {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => [
    id, question.type === 'boolean' ? { ...question, type: 'noul' as const } : question,
  ]));
}

function endpoint(baseURL: string): string {
  const url = parseBaseURL(baseURL);
  let path = url.pathname.replace(/\/+$/, '');
  if (path === '') path = '/v1';
  if (!path.endsWith('/systemone')) path += '/systemone';
  url.pathname = path;
  return url.toString();
}

export const systemOneAdapter: SystemOneAdapter = Object.freeze({
  id: 'system-one',
  defaultBaseURL: 'https://api.typesafe.ai/v1',
  defaultModel: 'jev-latest',
  supportedQuestionTypes: questionTypes,
  prepare({ baseURL, model, request }: AdapterContext) {
    if (request.providerOptions !== undefined && Object.keys(request.providerOptions).length > 0) {
      throw new UnsupportedFeatureError('The TypeSafe System One protocol does not define providerOptions. Use an adapter that supports them.');
    }
    // Per-model upper limits belong to the service; do not freeze current Jev limits into a portable codec.
    const questions = nativeQuestions(request.questions);
    return { url: endpoint(baseURL), body: { model, state: request.state, questions } };
  },
  decode(payload: unknown) {
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
  },
});
