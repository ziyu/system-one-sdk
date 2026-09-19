import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createSystemOne, booleanQuestion, choice, score } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { llmAdapter } from '@system-one-ai/adapter-llm';

const filename = process.argv[2];
if (!filename) throw new Error('Usage: npm run test:live:llm -- /path/to/llm.env');
const env = parseEnv(await readFile(filename, 'utf8'));
if (!env.LLM_BASE_URL || !env.LLM_MODEL || !env.LLM_API_KEY) throw new Error('Provide LLM_BASE_URL, LLM_MODEL and LLM_API_KEY.');
const runs = [];
for (const llmAnswerMode of ['probabilities', 'discrete']) {
  const client = createSystemOne({
    apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL, model: env.LLM_MODEL,
    adapter: llmAdapter({ provider: 'openai', api: 'chat_completions', structuredOutputs: false, llmAnswerMode, normalizeProbabilities: true }),
    transport: createFetchTransport(), timeoutMs: 60_000, maxRetries: 0,
  });
  try {
    const result = await client.evaluate({
      state: 'The lamp is ON. The room temperature is exactly 20 degrees Celsius.',
      questions: {
        on: booleanQuestion('Is the lamp on?'),
        temperature: choice('What is the stated temperature?', { twenty: '20 degrees Celsius', thirty: '30 degrees Celsius' }),
        level: score('Classify the lamp state.', ['The lamp is off.', 'The lamp is on.']),
      },
    });
    assert.equal(result.answers.temperature.choice, 'twenty');
    assert.ok(result.answers.on.probability >= 0.9);
    assert.ok(result.answers.level.score >= 0.9);
    assert.equal(result.response.attempts, 1);
    runs.push({ mode: llmAnswerMode, model: result.model, answers: result.answers, usage: result.usage, response: result.response });
    console.log(`Live LLM passed: ${llmAnswerMode}, model=${result.model}, status=${result.response.status}, durationMs=${result.response.durationMs}`);
  } catch (error) {
    // Do not print fetch causes, credentials, upstream bodies or the credential file.
    console.error(`Live LLM failed (${llmAnswerMode}): ${error instanceof Error ? error.name : 'Error'}`);
    process.exitCode = 1;
    break;
  }
}
if (!process.exitCode) {
  await mkdir(new URL('../.artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../.artifacts/live-llm.json', import.meta.url), JSON.stringify({ testedAt: new Date().toISOString(), runs }, null, 2) + '\n');
}
