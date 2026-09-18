import { score, SystemOneError } from '../src/index.js';
import { evaluateMany } from '../src/batch.js';
import { exampleClient } from './config.js';

const snippets = [
  { id: 'bounds', code: 'function first(xs) { return xs[0].name; }' },
  { id: 'fallback', code: 'function first(xs) { return xs[0]?.name ?? null; }' },
  { id: 'mutation', code: 'function sorted(xs) { return xs.sort(); }' },
];
try {
  const report = await evaluateMany(exampleClient(), snippets.map(snippet => ({
    id: snippet.id,
    request: {
      state: { code: snippet.code, requirement: 'Accept an empty list and do not mutate the input.' },
      questions: { risk: score('Assess the likelihood of violating the stated requirement.', [
        'No clear violation', 'A violation is possible', 'An obvious violation',
      ]) },
    },
  })), { concurrency: 2, requestOptions: { maxRetries: 0, timeoutMs: 5000 } });
  for (const item of report.items) {
    console.log(item.status === 'fulfilled'
      ? { id: item.id, status: item.status, score: item.value.answers.risk.score }
      : { id: item.id, status: item.status, code: item.error instanceof SystemOneError ? item.error.code : 'application' });
  }
  console.log(report.summary);
  if (report.summary.failed || report.summary.cancelled) process.exitCode = 1;
} catch (error) {
  console.error({ status: 'failed', code: error instanceof SystemOneError ? error.code : 'application' });
  process.exitCode = 1;
}
