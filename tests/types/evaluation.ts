import { booleanQuestion, choice, type EvaluationClient } from '@system-one-ai/core';
import { backgroundVariant, pairedContextEffect, runEvaluation, summarizeEvaluation, type EvaluationCase } from '@system-one-ai/evaluation';

async function verifyEvaluationTypes(client: EvaluationClient) {
  const cases = [
    {
      id: 'route', questionId: 'route', gold: 'billing',
      request: { state: 'refund', questions: { route: choice('Route?', { billing: 'Billing', access: 'Access' }) } },
    },
    {
      id: 'urgent', questionId: 'urgent', gold: true,
      request: { state: 'outage', questions: { urgent: booleanQuestion('Urgent?') } },
    },
  ] satisfies EvaluationCase[];
  const rows = await runEvaluation(client, cases, { variants: [{ id: 'base' }, backgroundVariant('stress', 'noise')] });
  const accuracy: number | null = summarizeEvaluation(rows).effectiveAccuracy;
  const changed: number = pairedContextEffect(rows, 'base', 'stress').predictionChanged;
  void [accuracy, changed];
}

void verifyEvaluationTypes;
