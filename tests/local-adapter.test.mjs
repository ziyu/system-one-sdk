import assert from 'node:assert/strict';
import test from 'node:test';
import { booleanQuestion, ConnectionError, ResponseValidationError } from '@system-one-ai/core';
import { createLocalClient } from '@system-one-ai/adapter-local';

test('local runner uses the shared client validation contract', async () => {
  const seen = [];
  const client = createLocalClient({
    id: 'fixture',
    defaultModel: 'fixture-local',
    async evaluate(request, options) {
      seen.push({ request, timeoutMs: options.timeoutMs });
      return { model: request.model, answers: { on: { type: 'boolean', probability: 0.9 } }, usage: {} };
    },
  }, { timeoutMs: 1000 });
  const result = await client.evaluate({ state: 'on', questions: { on: booleanQuestion('Is it on?') } });
  assert.equal(result.answers.on.probability, 0.9);
  assert.equal(seen[0].request.model, 'fixture-local');
  assert.equal(seen[0].request.questions.on.type, 'boolean');
  assert.ok(seen[0].timeoutMs > 0 && seen[0].timeoutMs <= 1000);
});

test('local runner output still passes core response validation', async () => {
  const client = createLocalClient({
    id: 'invalid',
    async evaluate() {
      return { model: 'invalid', answers: { on: { type: 'boolean', probability: 2 } }, usage: {} };
    },
  });
  await assert.rejects(client.evaluate({ state: 'on', questions: { on: booleanQuestion('Is it on?') } }), ResponseValidationError);
});

test('local runner failures are sanitized', async () => {
  const client = createLocalClient({ id: 'broken', async evaluate() { throw new Error('private model path'); } });
  await assert.rejects(client.evaluate({ state: 'on', questions: { on: booleanQuestion('Is it on?') } }), error => error instanceof ConnectionError && !String(error).includes('private model path'));
});
