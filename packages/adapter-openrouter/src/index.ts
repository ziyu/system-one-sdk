import { ResponseValidationError, UnsupportedFeatureError, ValidationError } from '@system-one-ai/core';
import type { AdapterContext, JsonObject, Questions, SystemOneAdapter } from '@system-one-ai/core';
import { hasOwn, isRecord, parseBaseURL, responseRecord } from '@system-one-ai/core';

function nativeQuestions(questions: Questions) {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => [
    id, question.type === 'boolean' ? { ...question, type: 'noul' as const } : question,
  ]));
}

function decodeNative(payload: unknown): unknown {
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
    rounding: root.rounding ?? { probabilityDecimals: 2, scoreDecimals: 2 },
  };
}

function endpoint(baseURL: string): string {
  const url = parseBaseURL(baseURL);
  let path = url.pathname.replace(/\/+$/, '');
  // These are explicit aliases for this adapter, never hostname-based core behavior.
  if (path === '' || path === '/api' || path === '/api/v1') path = '/api/alpha';
  if (!path.endsWith('/decisions')) path += '/decisions';
  url.pathname = path;
  return url.toString();
}

function requestOptions(providerOptions: JsonObject | undefined): JsonObject {
  if (providerOptions === undefined || Object.keys(providerOptions).length === 0) return {};
  if (Object.keys(providerOptions).some(key => key !== 'openrouter')) {
    throw new UnsupportedFeatureError('OpenRouter options must be placed under providerOptions.openrouter.');
  }
  const options = providerOptions.openrouter;
  if (!isRecord(options)) throw new ValidationError('providerOptions.openrouter', 'expected an object');
  if (Object.keys(options).some(key => !['provider', 'session_id', 'trace', 'user'].includes(key))) {
    throw new UnsupportedFeatureError('OpenRouter Decisions supports provider, session_id, trace, and user options.');
  }
  if (options.provider !== undefined && options.provider !== null && !isRecord(options.provider)) {
    throw new ValidationError('providerOptions.openrouter.provider', 'expected an object or null');
  }
  if (options.trace !== undefined && !isRecord(options.trace)) throw new ValidationError('providerOptions.openrouter.trace', 'expected an object');
  for (const key of ['session_id', 'user'] as const) {
    if (options[key] !== undefined && (typeof options[key] !== 'string' || options[key].length === 0)) {
      throw new ValidationError(`providerOptions.openrouter.${key}`, 'expected a nonempty string');
    }
  }
  if (typeof options.session_id === 'string' && options.session_id.length > 256) {
    throw new ValidationError('providerOptions.openrouter.session_id', 'must not exceed 256 characters');
  }
  return options as JsonObject;
}

/** Optional OpenRouter Decisions codec. Import from @system-one-ai/adapter-openrouter. */
export const openRouterAdapter: SystemOneAdapter = Object.freeze({
  id: 'openrouter',
  defaultBaseURL: 'https://openrouter.ai/api/alpha',
  defaultModel: '~typesafe/jev-latest',
  supportedQuestionTypes: Object.freeze(['choice', 'score', 'boolean'] as const),
  prepare({ baseURL, model, request }: AdapterContext) {
    const options = requestOptions(request.providerOptions);
    const questions = nativeQuestions(request.questions);
    return {
      url: endpoint(baseURL),
      body: { ...options, model, state: request.state, questions },
    };
  },
  decode(payload: unknown, context: AdapterContext) {
    const root = responseRecord(payload, 'response');
    if (hasOwn(root, 'error')) throw new ResponseValidationError('response.error', 'OpenRouter returned an error instead of a decision');
    if (typeof root.model !== 'string' || root.model.trim().length === 0) throw new ResponseValidationError('model', 'expected the resolved model ID');
    const metadata: Record<string, string | number> = {};
    for (const [source, target] of [['id', 'generationId'], ['provider', 'provider']] as const) {
      if (root[source] === undefined) continue;
      const value = root[source];
      if (typeof value !== 'string' || value.trim().length === 0) throw new ResponseValidationError(source, 'expected a nonempty string');
      metadata[target] = value;
    }
    const usage = responseRecord(root.usage, 'usage');
    if (usage.cost !== undefined) {
      if (typeof usage.cost !== 'number' || !Number.isFinite(usage.cost) || usage.cost < 0) {
        throw new ResponseValidationError('usage.cost', 'expected a finite nonnegative number');
      }
      metadata.cost = usage.cost;
    }
    // Reuse native answer and token normalization; preserve provider-reported statistics.
    const normalized = responseRecord(decodeNative(payload), 'response');
    const existingMetadata = normalized.providerMetadata === undefined ? {} : responseRecord(normalized.providerMetadata, 'providerMetadata');
    const jev = typeof root.model === 'string' && /^(?:~?typesafe\/)?jev(?:-|$)/.test(root.model);
    return {
      ...normalized,
      // TypeSafe's two-decimal convention must not be assumed for future non-Jev providers.
      rounding: root.rounding === undefined && jev ? normalized.rounding : root.rounding,
      providerMetadata: { ...existingMetadata, openrouter: metadata },
    };
  },
});
