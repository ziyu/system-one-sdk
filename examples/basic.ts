// In a consuming project, import from '@system-one-ai/core'.
import { booleanQuestion, choice, score } from '@system-one-ai/core';
import { exampleClient } from './config.js';

try {
  const client = exampleClient();
  const result = await client.evaluate({
    state: { message: 'I was charged twice. Please refund the duplicate charge.' },
    questions: {
      department: choice('Which team should handle this request?', {
        billing: 'Charges, invoices, and refunds',
        support: 'Problems using the application',
        other: 'Neither billing nor application support',
      }),
      urgency: score('How urgent is this request?', ['Routine', 'Time sensitive', 'Immediate action needed']),
      refund: booleanQuestion('Does the message request money back?'),
    },
  });
  const department: 'billing' | 'support' | 'other' = result.answers.department.choice;
  console.log({ model: result.model, department, refundProbability: result.answers.refund.probability, urgency: result.answers.urgency.score, usage: result.usage });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Evaluation failed.');
  process.exitCode = 1;
}
