import assert from 'node:assert/strict';
import test from 'node:test';
import { SystemOne, choice, score, booleanQuestion, ValidationError, ResponseValidationError, RequestAbortedError, APIError } from '../dist/esm/index.js';
import { choiceFrom, defineDecision } from '../dist/esm/decisions.js';
import { vercelAdapter } from '../dist/esm/adapters/vercel.js';
import { openRouterAdapter } from '../dist/esm/adapters/openrouter.js';
import { cloudflareAdapter } from '../dist/esm/adapters/cloudflare.js';
import { jsonResponse } from './fixtures.mjs';

test('choiceFrom snapshots membership and descriptions, but preserves business object identity', () => {
  const item = { id: 'button', privateValue: 'local-only', click() {} };
  const items = [item];
  const description = { label: 'Submit' };
  const candidates = choiceFrom({ instructions: { purpose: 'Choose' }, items, id: item => item.id, describe: () => description });
  items.splice(0, 1, { id: 'later' });
  description.label = 'Changed';
  assert.strictEqual(candidates.resolve('button'), item);
  assert.throws(() => candidates.resolve('later'), ResponseValidationError);
  assert.equal(candidates.question.criteria.button.label, 'Submit');
  assert.ok(Object.isFrozen(candidates.question.criteria.button));
  assert.ok(!JSON.stringify(candidates.question).includes('local-only'));
  assert.equal(Object.isFrozen(item), false);
});

test('empty candidates require explicit none; duplicate and invalid IDs fail early', () => {
  const base = { instructions: 'Choose', items: [], id: item => item.id, describe: () => null };
  assert.throws(() => choiceFrom(base), ValidationError);
  const empty = choiceFrom({ ...base, none: { id: 'none', description: 'No match' } });
  assert.equal(empty.resolve('none'), undefined);
  assert.throws(() => empty.resolve('unknown'), ResponseValidationError);
  assert.throws(() => choiceFrom({ ...base, items: [{ id: 'x' }, { id: 'x' }] }), ValidationError);
  assert.throws(() => choiceFrom({ ...base, items: [{ id: 'none' }], none: { id: 'none', description: null } }), ValidationError);
  assert.throws(() => choiceFrom({ ...base, items: [{ id: '' }] }), ValidationError);
  assert.throws(() => choiceFrom({ ...base, items: new Array(1) }), ValidationError);
});

function scenario() {
  const target = { id: 'desk', label: 'Desk lamp', setBrightness() { assert.fail('actions require explicit application dispatch'); } };
  const targets = choiceFrom({ instructions: 'Choose the requested object', items: [target], id: item => item.id, describe: item => item.label });
  const definition = defineDecision({
    instructions: 'Choose the next action',
    actions: {
      adjust: { description: 'Adjust the light', parameters: { target: targets, mode: choice('Mode', { warm: null, cool: null }), intensity: score('Brightness', ['low', 'medium', 'high']), urgent: booleanQuestion('Urgent?') } },
      wait: { description: 'Wait', parameters: { reason: choice('Reason', { no_request: null, unavailable: null }) } },
    },
  });
  return { target, definition };
}

function answers(native = false, selected = 'adjust') {
  return {
    action: { type: 'choice', choice: selected, probabilities: { adjust: selected === 'adjust' ? 1 : 0, wait: selected === 'wait' ? 1 : 0 } },
    parameter_0_0: { type: 'choice', choice: 'desk' },
    parameter_0_1: { type: 'choice', choice: 'warm' },
    parameter_0_2: { type: 'score', score: 1.5 },
    parameter_0_3: native ? { type: 'noul', noul: 0.3 } : { type: 'boolean', probability: 0.3 },
    parameter_1_0: { type: 'choice', choice: 'no_request' },
  };
}

for (const [name, adapter, native] of [['native', undefined, true], ['vercel', vercelAdapter, false], ['openrouter', openRouterAdapter, true], ['cloudflare', cloudflareAdapter({ accountId: 'composition-test' }), true]]) {
  test(`one evaluation resolves typed action parameters through ${name} while retaining metadata`, async () => {
    const { target, definition } = scenario();
    let calls = 0;
    const client = new SystemOne({ apiKey: null, ...(adapter ? { adapter } : {}), fetch: async (_, init) => {
      calls++;
      const wire = JSON.parse(init.body);
      const body = name === 'cloudflare' ? wire.input : wire;
      assert.equal(Object.keys(body.questions).length, 6);
      assert.equal(body.questions.parameter_0_0.instructions.action.id, 'adjust');
      assert.equal(body.questions.parameter_0_0.criteria.desk, 'Desk lamp');
      assert.equal(body.questions.parameter_0_3.type, native ? 'noul' : 'boolean');
      assert.deepEqual(body.state, { request: 'Turn on the desk lamp' });
      const usage = native ? { input_tokens: 10, output_tokens: 2 } : { inputTokens: 10, outputTokens: 2 };
      return jsonResponse({ answers: answers(native), usage, ...(name === 'openrouter' ? { id: 'gen-dec-test', provider: 'TypeSafe', model: 'typesafe/jev-1.13' } : {}) }, { headers: { 'x-request-id': 'test-decision' } });
    } });
    const result = await definition.evaluate(client, { state: { request: 'Turn on the desk lamp' } }, { maxRetries: 0 });
    assert.equal(calls, 1);
    assert.equal(result.decision.action, 'adjust');
    assert.strictEqual(result.decision.parameters.target, target);
    assert.deepEqual(result.decision.parameters, { target, mode: 'warm', intensity: 1.5, urgent: 0.3 });
    assert.ok(!('reason' in result.decision.parameters));
    assert.equal(result.decision.parameterAnswers.mode.choice, 'warm');
    assert.equal(result.decision.parameterAnswers.urgent.probability, 0.3);
    assert.ok(!('reason' in result.decision.parameterAnswers));
    assert.equal(result.evaluation.response.requestId, 'test-decision');
    assert.equal(result.evaluation.usage.totalTokens, 12);
    assert.equal(result.evaluation.answers.action.probabilities.adjust, 1);
    if (name === 'openrouter') assert.equal(result.evaluation.providerMetadata.openrouter.generationId, 'gen-dec-test');
  });
}

test('unselected branch values are excluded and compiled questions are immutable', async () => {
  const { definition } = scenario();
  const client = new SystemOne({ apiKey: null, fetch: async () => jsonResponse({ answers: answers(true, 'wait') }) });
  const result = await definition.evaluate(client, { state: {} });
  assert.deepEqual(result.decision, { action: 'wait', parameters: { reason: 'no_request' }, parameterAnswers: { reason: { type: 'choice', choice: 'no_request' } } });
  assert.deepEqual(definition.resolve(result.evaluation), result.decision);
  assert.ok(Object.isFrozen(definition.questions.action.criteria));
  assert.throws(() => definition.resolve({ ...result.evaluation, answers: { ...result.evaluation.answers, action: { type: 'choice', choice: 'other' } } }), ResponseValidationError);
  assert.throws(() => definition.resolve(null), ResponseValidationError);
  await assert.rejects(definition.evaluate(client, { state: {}, questions: {} }), ValidationError);
});

test('prototype-like action and parameter IDs cannot collide with generated wire IDs', async () => {
  const candidate = { id: '__proto__' };
  const targets = choiceFrom({ instructions: 'Target', items: [candidate], id: item => item.id, describe: () => null });
  const definition = defineDecision({ instructions: 'Next', actions: Object.fromEntries([
    ['__proto__', { description: null, parameters: Object.fromEntries([['constructor', targets]]) }],
    ['action', { description: null }],
  ]) });
  const client = new SystemOne({ apiKey: null, fetch: async () => jsonResponse({ answers: {
    action: { type: 'choice', choice: '__proto__' }, parameter_0_0: { type: 'choice', choice: '__proto__' },
  } }) });
  const result = await definition.evaluate(client, { state: {} });
  assert.equal(result.decision.action, '__proto__');
  assert.strictEqual(result.decision.parameters.constructor, candidate);
  assert.equal(Object.prototype.polluted, undefined);
});

test('invalid definitions fail before I/O and action definitions are snapshotted', () => {
  for (const actions of [{}, { a: {} }, { a: { description: null, parameters: { x: { type: 'text', instructions: 'Generate' } } } }]) {
    assert.throws(() => defineDecision({ instructions: 'Next', actions }), ValidationError);
  }
  const question = choice('Mode', { warm: 'Warm' });
  const definition = defineDecision({ instructions: 'Next', actions: { adjust: { description: 'Lamp', parameters: { mode: question } } } });
  question.criteria.warm = 'Changed';
  assert.equal(definition.questions.parameter_0_0.criteria.warm, 'Warm');
});

test('decision composition preserves cancellation and API failures', async () => {
  const { definition } = scenario();
  const aborted = new AbortController();
  aborted.abort();
  const client = new SystemOne({ apiKey: null, maxRetries: 0, fetch: async () => jsonResponse({}, { status: 401 }) });
  await assert.rejects(definition.evaluate(client, { state: {} }, { signal: aborted.signal }), RequestAbortedError);
  await assert.rejects(definition.evaluate(client, { state: {} }), error => error instanceof APIError && error.statusCode === 401);
});
