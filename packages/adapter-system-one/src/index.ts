import { encodeExtractBody, UnsupportedFeatureError } from '@system-one-ai/core';
import type { AdapterContext, ExtractAdapterContext, SystemOneAdapter } from '@system-one-ai/core';
import { parseBaseURL } from '@system-one-ai/core/validation';
import { nativeQuestions, decodeNative } from '@system-one-ai/protocol-system-one';

const questionTypes = Object.freeze(['choice', 'score', 'boolean'] as const);
const fieldTypes = Object.freeze([
  'text', 'number', 'date', 'time', 'datetime', 'duration', 'list', 'estimate', 'forecast',
] as const);

function endpoint(baseURL: string, kind: 'systemone' | 'extract' = 'systemone'): string {
  const url = parseBaseURL(baseURL);
  let path = url.pathname.replace(/\/+$/, '');
  if (path === '') path = '/v1';
  if (kind === 'extract') {
    if (path.endsWith('/systemone')) path = path.slice(0, -'/systemone'.length) || '/v1';
    if (!path.endsWith('/extract')) path += '/extract';
  } else if (!path.endsWith('/systemone')) {
    path += '/systemone';
  }
  url.pathname = path;
  return url.toString();
}

export const systemOneAdapter: SystemOneAdapter = Object.freeze({
  id: 'system-one',
  defaultBaseURL: 'https://api.typesafe.ai/v1',
  defaultModel: 'jev-latest',
  defaultExtractModel: 'clairic',
  supportedQuestionTypes: questionTypes,
  supportedFieldTypes: fieldTypes,
  supportsExtract: true,
  prepare({ baseURL, model, request }: AdapterContext) {
    if (request.providerOptions !== undefined && Object.keys(request.providerOptions).length > 0) {
      throw new UnsupportedFeatureError('The TypeSafe System One protocol does not define providerOptions. Use an adapter that supports them.');
    }
    // Per-model upper limits belong to the service; do not freeze current Jev limits into a portable codec.
    const questions = nativeQuestions(request.questions);
    return { url: endpoint(baseURL), body: { model, state: request.state, questions } };
  },
  decode: decodeNative,
  prepareExtract({ baseURL, model, request }: ExtractAdapterContext) {
    return { url: endpoint(baseURL, 'extract'), body: encodeExtractBody(model, request) };
  },
  decodeExtract(payload: unknown) {
    return payload;
  },
});
