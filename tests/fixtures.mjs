export const request = {
  state: { location: 'living room', message: 'Please get some water.', thirst: 'high' },
  questions: {
    action: { type: 'choice', instructions: 'Which available action addresses the request?', criteria: { drink: 'Drink water', rest: 'Rest on the sofa' } },
    urgency: { type: 'score', instructions: 'How urgently should the agent respond?', criteria: ['Low', 'Medium', 'High'] },
    interrupt: { type: 'boolean', instructions: 'Does this request interrupt the current activity?', criteria: { true: 'A new action is needed', false: null } },
  },
};

// Independent wire fixtures based on the official HTTP/SDK contracts; these are not live model outputs.
export function nativePayload() {
  return {
    model: 'jev-1.13.0',
    answers: {
      action: { type: 'choice', choice: 'drink', probabilities: { drink: 0.86, rest: 0.14 }, confidence: 0.73 },
      urgency: { type: 'score', score: 1.6, probabilities: { 0: 0.05, 1: 0.3, 2: 0.65 }, confidence: 0.78, legend: { 0: 'Low', 1: 'Medium', 2: 'High' } },
      interrupt: { type: 'noul', noul: 0.94 },
    },
    usage: { input_tokens: 215, output_tokens: 31 },
  };
}
export function gatewayPayload() {
  return {
    answers: {
      action: { type: 'choice', choice: 'drink', probabilities: { drink: 0.86, rest: 0.14 } },
      urgency: { type: 'score', score: 1.6, probabilities: { 0: 0.05, 1: 0.3, 2: 0.65 } },
      interrupt: { type: 'boolean', probability: 0.94 },
    },
    rounding: { probabilityDecimals: 2, scoreDecimals: 2 },
    usage: { inputTokens: 215, outputTokens: 31 },
    warnings: [],
    providerMetadata: { typesafe: { confidence: { action: 0.73, urgency: 0.78 } } },
  };
}
export const jsonResponse = (payload, init = {}) => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' }, ...init });
export const booleanRequest = { state: 'The light is on.', questions: { on: { type: 'boolean', instructions: 'Is the light on?' } } };
export const booleanPayload = { answers: { on: { type: 'noul', noul: 0.97 } } };
