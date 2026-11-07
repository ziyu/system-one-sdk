import { ResponseValidationError, UnsupportedFeatureError } from '@system-one-ai/core';
import type { AdapterContext, SystemOneAdapter } from '@system-one-ai/core';
import { hasOwn, parseBaseURL, responseRecord } from '@system-one-ai/core/validation';
import {
  decodeOpenAiDecisionsResponse,
  encodeOpenAiDecisionsRequest,
} from '@system-one-ai/protocol-openai-decisions';

function endpoint(baseURL: string): string {
  const url = parseBaseURL(baseURL);
  let path = url.pathname.replace(/\/+$/, '');
  if (path === '') path = '/v1';
  if (!path.endsWith('/decisions')) path += '/decisions';
  url.pathname = path;
  return url.toString();
}

/** OpenAI Decisions API adapter; set baseURL/model for another compatible provider. */
export const openAiDecisionsAdapter: SystemOneAdapter = Object.freeze({
  id: 'openai-decisions',
  defaultBaseURL: 'https://api.openai.com/v1',
  defaultModel: 'gpt-6-luna',
  supportedQuestionTypes: Object.freeze(['choice', 'score', 'boolean'] as const),
  supportsImages: true,
  prepare({ baseURL, model, request }: AdapterContext) {
    if (request.providerOptions !== undefined && Object.keys(request.providerOptions).length > 0) {
      throw new UnsupportedFeatureError('The OpenAI Decisions adapter does not support providerOptions.');
    }
    return {
      url: endpoint(baseURL),
      body: { model, ...encodeOpenAiDecisionsRequest(request) },
    };
  },
  decode(payload: unknown, context: AdapterContext) {
    const root = responseRecord(payload, 'response');
    if (hasOwn(root, 'error')) {
      throw new ResponseValidationError('response.error', 'OpenAI Decisions returned an error instead of a decision');
    }
    return decodeOpenAiDecisionsResponse(root, context.request.questions);
  },
});
