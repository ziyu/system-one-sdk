import { choice, booleanQuestion, score } from '@system-one-ai/core';
import { createCloudflareWorkers } from '@system-one-ai/adapter-cloudflare/workers';
import { defineDecision, choiceFrom } from '@system-one-ai/decisions';
import { evaluateMany } from '@system-one-ai/batch';
import { gateChoice } from '@system-one-ai/policies';

function check(condition, message) { if (!condition) throw new Error(message); }
async function rejects(operation, code) {
  try { await operation(); } catch (error) { check(error.code === code, `Expected ${code}, received ${error.code}`); return; }
  throw new Error(`Expected ${code} rejection`);
}
const request = () => ({ state: {}, questions: { route: choice('Route?', { a: null, b: null }) } });
const payload = () => ({ answers: { route: { type: 'choice', choice: 'a', probabilities: { a: 0.9, b: 0.1 } } } });
const answer = () => Response.json(payload(), { headers: { 'cf-ai-req-id': 'fixture' } });

// This fixture runs inside workerd with no nodejs_compat and never calls a real model.
export default {
  async fetch(incoming) {
    const scenario = new URL(incoming.url).pathname.slice(1);
    try {
      if (scenario === 'success') {
        const binding = { async run(model, input, options) {
          check(this === binding, 'Binding receiver lost');
          check(model === 'typesafe/jev', 'Wrong default model');
          check(input.questions.yes.type === 'noul', 'Boolean not encoded');
          check(options.returnRawResponse && options.signal instanceof AbortSignal, 'Raw response or signal missing');
          return Response.json({ state: 'Completed', result: { ...payload(), answers: { ...payload().answers,
            yes: { type: 'noul', noul: 0.9 }, quality: { type: 'score', score: 0.8, probabilities: { 0: 0.2, 1: 0.8 } },
          }, usage: { input_tokens: 12, output_tokens: 3 } } }, { headers: { 'cf-ai-req-id': 'own-request' } });
        } };
        const result = await createCloudflareWorkers({ binding }).evaluate({ ...request(), questions: {
          ...request().questions, yes: booleanQuestion('Yes?'), quality: score('Quality?', ['low', 'high']),
        } });
        check(result.answers.yes.probability === 0.9 && result.answers.quality.score === 0.8, 'Primitives decoded incorrectly');
        check(result.usage.totalTokens === 15 && result.response.requestId === 'own-request', 'Usage or ID missing');
      } else if (scenario === 'retry') {
        let calls = 0;
        const client = createCloudflareWorkers({ retryDelayMs: 0, binding: { async run() {
          return ++calls === 1 ? new Response(null, { status: 503 }) : answer();
        } } });
        check((await client.evaluate(request())).response.attempts === 2 && calls === 2, 'Retry incorrect');
      } else if (scenario === 'cancel') {
        const controller = new AbortController(); let forwarded;
        const client = createCloudflareWorkers({ binding: { run(model, input, options) {
          forwarded = options.signal;
          return new Promise(() => {});
        } } });
        const pending = client.evaluate(request(), { signal: controller.signal });
        controller.abort();
        await rejects(() => pending, 'aborted');
        check(forwarded.aborted, 'Signal not forwarded');
      } else if (scenario === 'timeout') {
        let cancelled = false;
        const client = createCloudflareWorkers({ binding: { run: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) } });
        await rejects(() => client.evaluate(request(), { timeoutMs: 30 }), 'timeout');
        check(cancelled, 'Stalled body not cancelled');
      } else if (scenario === 'invalid') {
        const client = createCloudflareWorkers({ binding: { run: async () => Response.json({ state: 'Pending', result: payload() }) } });
        await rejects(() => client.evaluate(request()), 'response');
      } else if (scenario === 'oversized') {
        const client = createCloudflareWorkers({ maxResponseBytes: 16, binding: { run: async () => new Response('x'.repeat(100)) } });
        await rejects(() => client.evaluate(request()), 'response');
      } else if (scenario === 'parallel') {
        const client = createCloudflareWorkers({ binding: {
          get lastRequestId() { throw new Error('Shared metadata read'); },
          async run(model, input) {
            await new Promise(resolve => setTimeout(resolve, input.state.id === 'first' ? 10 : 1));
            return Response.json(payload(), { headers: { 'cf-ai-req-id': input.state.id } });
          },
        } });
        const results = await Promise.all(['first', 'second'].map(id => client.evaluate({ ...request(), state: { id } })));
        check(results[0].response.requestId === 'first' && results[1].response.requestId === 'second', 'Parallel IDs crossed');
      } else if (scenario === 'composition') {
        const object = { id: 'lamp' };
        const target = choiceFrom({ instructions: 'Target', items: [object], id: item => item.id, describe: () => 'Lamp' });
        const decision = defineDecision({ instructions: 'Action', actions: { select: { description: 'Select', parameters: { target } }, wait: { description: 'Wait' } } });
        const client = createCloudflareWorkers({ binding: { async run(model, input) {
          return Response.json({ answers: Object.fromEntries(Object.entries(input.questions).map(([id, question]) => {
            const options = Object.keys(question.criteria);
            return [id, { type: 'choice', choice: options[0], probabilities: Object.fromEntries(options.map((key, index) => [key, index === 0 ? 1 : 0])) }];
          })) });
        } } });
        const result = await decision.evaluate(client, { state: {} });
        check(result.decision.parameters.target === object, 'Object identity lost');
        check(gateChoice(result.evaluation.answers.action, { minProbability: 0.9 }).status === 'accepted', 'Policy failed');
        const batch = await evaluateMany(client, [{ id: 'one', request: { state: {}, questions: decision.questions } }]);
        check(batch.summary.succeeded === 1, 'Batch failed');
      } else return new Response('Unknown scenario', { status: 404 });
      return Response.json({ passed: scenario });
    } catch (error) {
      return Response.json({ failed: scenario, message: error instanceof Error ? error.message : 'Unknown failure' }, { status: 500 });
    }
  },
};
