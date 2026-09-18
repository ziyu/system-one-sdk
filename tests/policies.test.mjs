import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigurationError, ResponseValidationError } from '../dist/esm/index.js';
import { gateBoolean, gateChoice } from '../dist/esm/policies.js';

const choice = { type: 'choice', choice: 'run', probabilities: { run: 0.75, wait: 0.25 }, confidence: 0.95 };

test('choice policy keeps probability, margin and provider confidence distinct', () => {
  assert.deepEqual(gateChoice(choice, { minProbability: 0.8 }), { status: 'uncertain', reason: 'below-probability' });
  assert.deepEqual(gateChoice(choice, { minConfidence: 0.9 }), { status: 'accepted', value: 'run' });
  assert.deepEqual(gateChoice(choice, { minMargin: 0.6 }), { status: 'uncertain', reason: 'below-margin' });
  assert.deepEqual(gateChoice(choice, { minProbability: 0.75, minMargin: 0.5, minConfidence: 0.95 }), { status: 'accepted', value: 'run' });
  assert.equal(gateChoice(choice, { minProbability: 0.75, minConfidence: 0.99 }).reason, 'below-confidence');
});

test('missing evidence remains uncertain even for a zero threshold', () => {
  const answer = { type: 'choice', choice: 'run' };
  assert.equal(gateChoice(answer, { minProbability: 0 }).reason, 'missing-probabilities');
  assert.equal(gateChoice(answer, { minMargin: 0 }).reason, 'missing-probabilities');
  assert.equal(gateChoice(answer, { minConfidence: 0 }).reason, 'missing-confidence');
  assert.equal(gateChoice({ ...answer, confidence: 1 }, { minProbability: 0.5 }).status, 'uncertain');
});

test('explicit abstention remains separate from low probability', () => {
  assert.deepEqual(gateChoice({ type: 'choice', choice: 'none' }, { abstain: ['none'], minProbability: 0.8 }), { status: 'abstained', reason: 'abstain-option' });
  assert.equal(gateChoice(choice, { abstain: ['wait'], minProbability: 0.5 }).status, 'accepted');
});

test('ties, single choices and prototype-like IDs use the reported distribution', () => {
  assert.equal(gateChoice({ type: 'choice', choice: 'a', probabilities: { a: 0.5, b: 0.5 } }, { minMargin: 0.1 }).reason, 'below-margin');
  assert.equal(gateChoice({ type: 'choice', choice: 'a', probabilities: { a: 1 } }, { minMargin: 1 }).status, 'accepted');
  const probabilities = Object.fromEntries([['__proto__', 0.9], ['constructor', 0.1]]);
  assert.equal(gateChoice({ type: 'choice', choice: '__proto__', probabilities }, { minProbability: 0.9 }).value, '__proto__');
});

test('a margin exactly at its threshold is not rejected by floating-point subtraction', () => {
  const answer = { type: 'choice', choice: 'run', probabilities: { run: 0.7, wait: 0.3 } };
  assert.equal(gateChoice(answer, { minMargin: 0.4 }).status, 'accepted');
  assert.equal(gateChoice(answer, { minMargin: 0.4000000001 }).status, 'uncertain');
});

test('abstention arrays reject holes and getters without invoking callbacks', () => {
  assert.throws(() => gateChoice(choice, { minProbability: 0.5, abstain: new Array(1) }), ConfigurationError);
  let invoked = false;
  const abstain = [];
  Object.defineProperty(abstain, '0', { enumerable: true, get() { invoked = true; return 'run'; } });
  assert.throws(() => gateChoice(choice, { minProbability: 0.5, abstain }), ConfigurationError);
  assert.equal(invoked, false);
});

test('boolean policy uses two inclusive regions and never thresholds uncertainty silently', () => {
  const policy = { maxFalseProbability: 0.2, minTrueProbability: 0.8 };
  for (const [probability, expected] of [[0, false], [0.2, false], [0.8, true], [1, true]]) {
    assert.deepEqual(gateBoolean({ type: 'boolean', probability }, policy), { status: 'accepted', value: expected });
  }
  assert.deepEqual(gateBoolean({ type: 'boolean', probability: 0.5 }, policy), { status: 'uncertain', reason: 'between-thresholds' });
});

test('invalid policies fail instead of adopting implicit defaults', () => {
  for (const policy of [{}, { minProbability: NaN }, { minMargin: -1 }, { minConfidence: 2 }, { minProbability: '0.8' }, { minProbability: 0.5, unknown: true }, { minProbability: 0.5, abstain: [1] }]) {
    assert.throws(() => gateChoice(choice, policy), ConfigurationError);
  }
  for (const policy of [{}, { maxFalseProbability: 0.8, minTrueProbability: 0.2 }, { maxFalseProbability: 0.5, minTrueProbability: 0.5 }, { maxFalseProbability: 0, minTrueProbability: Infinity }]) {
    assert.throws(() => gateBoolean({ type: 'boolean', probability: 0.5 }, policy), ConfigurationError);
  }
  let invoked = false;
  assert.throws(() => gateChoice(choice, { get minProbability() { invoked = true; return 0.5; } }), ConfigurationError);
  assert.equal(invoked, false);
});

test('malformed answers raise response errors; policies do not mutate evidence', () => {
  for (const answer of [null, { type: 'boolean', probability: 1 }, { type: 'choice', choice: 'run', confidence: NaN }, { ...choice, probabilities: { wait: 1 } }, { ...choice, probabilities: { run: -1, wait: 2 } }]) {
    assert.throws(() => gateChoice(answer, { minProbability: 0.5 }), ResponseValidationError);
  }
  assert.throws(() => gateBoolean({ type: 'boolean', probability: NaN }, { maxFalseProbability: 0.2, minTrueProbability: 0.8 }), ResponseValidationError);
  const frozen = Object.freeze({ ...choice, probabilities: Object.freeze({ ...choice.probabilities }) });
  gateChoice(frozen, { minProbability: 0.5 });
  assert.deepEqual(frozen, choice);
});
