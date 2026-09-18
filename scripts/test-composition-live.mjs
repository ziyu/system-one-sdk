import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { SystemOne, SystemOneError, booleanQuestion, score } from '../dist/esm/index.js';
import { choiceFrom, defineDecision } from '../dist/esm/decisions.js';
import { gateBoolean, gateChoice } from '../dist/esm/policies.js';
import { evaluateMany } from '../dist/esm/batch.js';

// Explicit opt-in: three real native requests using this project's .env; no retries or slow-model calls.
const startedAt = new Date().toISOString();
const rows = [];
let requests = 0;
let apiKey = '';
let failure;
try {
  const env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
  apiKey = env.SYSTEM_ONE_API_KEY ?? '';
  assert.ok(apiKey, 'SYSTEM_ONE_API_KEY is required.');
  const client = new SystemOne({
    apiKey,
    ...(env.SYSTEM_ONE_BASE_URL ? { baseURL: env.SYSTEM_ONE_BASE_URL } : {}),
    ...(env.SYSTEM_ONE_MODEL ? { model: env.SYSTEM_ONE_MODEL } : {}),
    timeoutMs: 15_000, maxRetries: 0,
    fetch: (url, init) => { requests++; return fetch(url, init); },
  });
  const devices = [{ id: 'desk', label: 'Desk lamp', on: false }, { id: 'ceiling', label: 'Ceiling lamp', on: false }];
  const targets = choiceFrom({ instructions: 'Select the device named by the user.', items: devices, id: item => item.id, describe: item => item.label });
  const definition = defineDecision({ instructions: 'Select the action explicitly requested by the user.', actions: {
    turn_on: { description: 'Turn on a device', parameters: { device: targets } },
    wait: { description: 'No action requested' },
  } });
  const evaluated = await definition.evaluate(client, { state: { userMessage: 'Turn on the desk lamp.', devices } });
  rows.push({ scenario: 'dynamic-action', model: evaluated.evaluation.model, response: evaluated.evaluation.response, answers: evaluated.evaluation.answers, usage: evaluated.evaluation.usage });
  assert.equal(evaluated.decision.action, 'turn_on');
  assert.strictEqual(evaluated.decision.parameters.device, devices[0]);
  const policy = gateChoice(evaluated.evaluation.answers.action, { minProbability: 0.5 });
  assert.equal(policy.status, 'accepted');
  assert.equal(gateChoice(evaluated.decision.parameterAnswers.device, { minProbability: 0.5 }).status, 'accepted');
  evaluated.decision.parameters.device.on = true;
  assert.equal(devices[0].on, true);
  assert.equal(devices[1].on, false);
  const batch = await evaluateMany(client, [
    { id: 'boolean', request: { state: { lampOn: false }, questions: { on: booleanQuestion('Is the lamp on?') } } },
    { id: 'score', request: { state: 'Export fails in Safari, but users can export in Chrome.', questions: { severity: score('Rate the defect severity.', ['Cosmetic', 'Broken feature with a workaround', 'Blocking with no workaround']) } } },
  ], { concurrency: 2 });
  for (const item of batch.items) {
    if (item.status !== 'fulfilled') throw item.error;
    rows.push({ scenario: item.id, model: item.value.model, response: item.value.response, answers: item.value.answers, usage: item.value.usage });
  }
  assert.equal(batch.summary.succeeded, 2);
  assert.deepEqual(gateBoolean(batch.items[0].value.answers.on, { maxFalseProbability: 0.4, minTrueProbability: 0.6 }), { status: 'accepted', value: false });
  assert.ok(batch.items[1].value.answers.severity.score >= 0 && batch.items[1].value.answers.severity.score <= 2);
  assert.equal(requests, 3);
  for (const row of rows) { assert.equal(row.response.status, 200); assert.equal(row.response.attempts, 1); }
} catch (error) {
  failure = {
    code: error instanceof SystemOneError ? error.code : error?.code === 'ERR_ASSERTION' ? 'assertion' : 'configuration',
    ...(error instanceof SystemOneError && 'statusCode' in error ? { status: error.statusCode } : {}),
  };
  process.exitCode = 1;
}
const report = { startedAt, completedAt: new Date().toISOString(), status: failure ? 'failed' : 'passed', node: process.version, requests, rows, ...(failure ? { failure } : {}) };
const text = JSON.stringify(report, null, 2);
const redacted = apiKey ? text.replaceAll(apiKey, '[redacted]') : text;
await mkdir(new URL('../.artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('../.artifacts/live-composition.json', import.meta.url), redacted + '\n');
await writeFile(new URL(`../.artifacts/live-composition-${startedAt.replaceAll(/[:.]/g, '-')}.json`, import.meta.url), redacted + '\n');
console.log(JSON.stringify({ status: report.status, requests, completedScenarios: rows.length, ...(failure ? { failure } : {}), report: '.artifacts/live-composition.json' }));
