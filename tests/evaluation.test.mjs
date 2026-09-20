import assert from 'node:assert/strict';
import test from 'node:test';
import { booleanQuestion, choice, score } from '@system-one-ai/core';
import { backgroundVariant, pairedContextEffect, runEvaluation, summarizeEvaluation, wilsonInterval } from '@system-one-ai/evaluation';

const cases = [
  {
    id: 'route', questionId: 'route', gold: 'billing',
    request: { state: 'refund request', questions: { route: choice('Route?', { billing: 'Billing', access: 'Access' }) } },
  },
  {
    id: 'urgent', questionId: 'urgent', gold: true,
    request: { state: 'production is down', questions: { urgent: booleanQuestion('Urgent?') } },
  },
  {
    id: 'severity', questionId: 'severity', gold: 2,
    request: { state: 'blocking issue', questions: { severity: score('Severity?', ['low', 'medium', 'high']) } },
  },
];

test('provider-agnostic evaluation reports quality, calibration, timing and context shifts', async () => {
  let calls = 0;
  const client = {
    async evaluate(request) {
      calls++;
      const stressed = typeof request.state === 'string' && request.state.includes('background noise');
      const [id, question] = Object.entries(request.questions)[0];
      let answer;
      if (question.type === 'choice') {
        answer = stressed
          ? { type: 'choice', choice: 'access', probabilities: { billing: 0.4, access: 0.6 }, confidence: 0.2 }
          : { type: 'choice', choice: 'billing', probabilities: { billing: 0.8, access: 0.2 }, confidence: 0.6 };
      } else if (question.type === 'boolean') {
        answer = { type: 'boolean', probability: stressed ? 0.4 : 0.9 };
      } else {
        answer = { type: 'score', score: stressed ? 1.2 : 1.8, probabilities: stressed ? { 0: 0.1, 1: 0.6, 2: 0.3 } : { 0: 0.05, 1: 0.1, 2: 0.85 }, confidence: 0.7, legend: { 0: 'low', 1: 'medium', 2: 'high' } };
      }
      return {
        model: 'fixture', answers: { [id]: answer }, usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 }, warnings: [],
        response: { status: 200, attempts: stressed ? 2 : 1, durationMs: 1, adapter: 'fixture' },
      };
    },
  };
  const rows = await runEvaluation(client, cases, {
    variants: [{ id: 'base' }, backgroundVariant('stress', 'background noise')],
  });
  assert.equal(calls, 6);
  assert.equal(rows.length, 6);
  const base = summarizeEvaluation(rows.filter(row => row.variant === 'base'));
  assert.equal(base.total, 3);
  assert.equal(base.correct, 3);
  assert.equal(base.effectiveAccuracy, 1);
  assert.equal(base.failures, 0);
  assert.equal(base.firstPassValid, 3);
  assert.equal(base.inputTokensMean, 10);
  assert.ok(base.brier !== null && base.brier > 0);
  assert.ok(base.nll !== null && base.nll > 0);
  assert.ok(base.ece !== null && base.ece >= 0);
  assert.ok(base.scoreMAE !== null && Math.abs(base.scoreMAE - 0.2) < 1e-12);
  const stress = summarizeEvaluation(rows.filter(row => row.variant === 'stress'));
  assert.equal(stress.correct, 0);
  assert.equal(stress.retriedRequests, 3);
  assert.equal(stress.additionalAttempts, 3);
  assert.deepEqual(pairedContextEffect(rows, 'base', 'stress'), {
    baseVariant: 'base', comparisonVariant: 'stress', validPairs: 3,
    predictionChanged: 3, correctToWrong: 3, wrongToCorrect: 0,
  });
});

test('evaluation counts failed requests as wrong while calibration stays conditional on valid probabilities', async () => {
  const client = { async evaluate() { throw new Error('private failure'); } };
  const rows = await runEvaluation(client, [cases[0]]);
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].errorCode, 'evaluation');
  const summary = summarizeEvaluation(rows);
  assert.equal(summary.total, 1);
  assert.equal(summary.valid, 0);
  assert.equal(summary.failures, 1);
  assert.equal(summary.effectiveAccuracy, 0);
  assert.equal(summary.validAccuracy, null);
  assert.equal(summary.brier, null);
  assert.equal(summary.ece, null);
});

test('Wilson interval validates counts and stays bounded', () => {
  const interval = wilsonInterval(8, 10);
  assert.ok(interval[0] >= 0 && interval[1] <= 1 && interval[0] < 0.8 && interval[1] > 0.8);
  assert.equal(wilsonInterval(0, 0), null);
  assert.throws(() => wilsonInterval(2, 1));
});
