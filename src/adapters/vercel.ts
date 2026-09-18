import type { AdapterContext, SystemOneAdapter } from '../types.js';
import { hasOwn, isRecord, parseBaseURL, responseRecord } from '../validation.js';

/** Optional Evaluation v4 codec. Import from @system-one-ai/sdk/adapters/vercel. */
export const vercelAdapter: SystemOneAdapter = Object.freeze({
  id: 'vercel',
  defaultBaseURL: 'https://ai-gateway.vercel.sh/v4/ai',
  defaultModel: 'typesafe-ai/jev',
  supportedQuestionTypes: Object.freeze(['choice', 'score', 'boolean'] as const),
  prepare({ baseURL, model, request }: AdapterContext) {
    const url = parseBaseURL(baseURL);
    let path = url.pathname.replace(/\/+$/, '');
    if (path === '' || path === '/v1') path = '/v4/ai';
    if (!path.endsWith('/evaluation-model')) path += '/evaluation-model';
    url.pathname = path;
    return {
      url: url.toString(),
      headers: {
        'ai-gateway-protocol-version': '0.0.1',
        'ai-gateway-auth-method': 'api-key',
        'ai-evaluation-model-specification-version': '4',
        'ai-model-id': model,
      },
      body: {
        state: request.state,
        questions: request.questions,
        ...(request.providerOptions === undefined ? {} : { providerOptions: request.providerOptions }),
      },
    };
  },
  decode(payload: unknown) {
    const root = responseRecord(payload, 'response');
    const rawAnswers = responseRecord(root.answers, 'answers');
    const typesafe = isRecord(root.providerMetadata) && hasOwn(root.providerMetadata, 'typesafe') ? root.providerMetadata.typesafe : undefined;
    const confidences = isRecord(typesafe) && hasOwn(typesafe, 'confidence') && isRecord(typesafe.confidence) ? typesafe.confidence : undefined;
    const answers = Object.fromEntries(Object.entries(rawAnswers).map(([id, value]) => {
      const answer = responseRecord(value, `answers.${id}`);
      // Preserve the upstream statistic. It is distinct from max(probabilities).
      return [id, answer.type !== 'boolean' && answer.confidence === undefined && confidences && hasOwn(confidences, id)
        ? { ...answer, confidence: confidences[id] } : answer];
    }));
    return { ...root, answers };
  },
});
