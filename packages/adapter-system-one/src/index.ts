import { UnsupportedFeatureError } from '@system-one-ai/core';
import type { AdapterContext, SystemOneAdapter } from '@system-one-ai/core';
import { parseBaseURL } from '@system-one-ai/core/validation';
import { nativeQuestions, decodeNative } from '@system-one-ai/protocol-system-one';

const questionTypes = Object.freeze(['choice', 'score', 'boolean'] as const);

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
  decode: decodeNative,
});
