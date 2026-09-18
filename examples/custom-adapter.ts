import { SystemOne, booleanQuestion, ResponseValidationError, type SystemOneAdapter } from '../src/index.js';

/** An illustrative wire protocol for a future vendor; not a claim about an existing service. */
const futureAdapter: SystemOneAdapter = {
  id: 'future-vendor',
  defaultModel: 'reflex-1',
  supportedQuestionTypes: ['choice', 'score', 'boolean'],
  prepare({ baseURL, model, request }) {
    return { url: `${baseURL}/decisions`, body: { engine: model, context: request.state, queries: request.questions } };
  },
  authenticate(apiKey) { return apiKey === null ? {} : { 'x-api-key': apiKey }; },
  decode(payload) {
    if (!payload || typeof payload !== 'object' || !('evaluation' in payload)) {
      throw new ResponseValidationError('response', 'expected an evaluation envelope');
    }
    return payload.evaluation;
  },
};

export function futureClient(baseURL: string, apiKey: string): SystemOne {
  return new SystemOne({ baseURL, apiKey, adapter: futureAdapter });
}

// The application interface stays unchanged after registering a different protocol once.
export async function checkLight(client: SystemOne) {
  return client.evaluate({ state: 'The light is on.', questions: { on: booleanQuestion('Is the light on?') } });
}
