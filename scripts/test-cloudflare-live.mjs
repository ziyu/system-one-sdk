import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { SystemOne, SystemOneError, choice, score, booleanQuestion } from '../dist/esm/index.js';
import { cloudflareAdapter } from '../dist/esm/adapters/cloudflare.js';

// Explicit opt-in. Only .env.cloudflare supplies credentials; ordinary tests never call this file.
// All responses come from native Fetch. Three small requests, no retries, no fallback providers.
const startedAt = new Date().toISOString();
const report = { startedAt, node: process.version, configFile: '.env.cloudflare', requests: [], rows: [] };
const nativeFetch = globalThis.fetch.bind(globalThis);
let apiKey = '';
let scenario = 'configuration';

try {
  const config = parseEnv(await readFile(new URL('../.env.cloudflare', import.meta.url), 'utf8'));
  apiKey = config.CLOUDFLARE_API_TOKEN ?? '';
  assert.ok(apiKey, 'CLOUDFLARE_API_TOKEN is required.');
  const accountId = config.CLOUDFLARE_ACCOUNT_ID;
  const adapter = cloudflareAdapter({ accountId });
  const expectedURL = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`;
  // Live verification deliberately exercises defaults. Proxy and model overrides stay in examples.
  assert.ok(!config.SYSTEM_ONE_BASE_URL || config.SYSTEM_ONE_BASE_URL.replace(/\/+$/, '') === expectedURL, 'Live verification requires the default Cloudflare endpoint.');
  assert.ok(!config.SYSTEM_ONE_MODEL || config.SYSTEM_ONE_MODEL === 'typesafe/jev', 'Live verification requires the default Jev model.');
  const client = new SystemOne({
    adapter, apiKey, timeoutMs: 15_000, maxRetries: 0,
    fetch: async (url, init) => {
      assert.equal(String(url), expectedURL);
      assert.equal(init.method, 'POST');
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${apiKey}`);
      const record = { scenario, startedAt: new Date().toISOString(), endpoint: '/client/v4/accounts/{accountId}/ai/run', model: JSON.parse(init.body).model };
      report.requests.push(record);
      const response = await nativeFetch(url, init);
      record.status = response.status;
      record.headers = Object.fromEntries(['date', 'x-request-id', 'request-id', 'cf-ray', 'cf-ai-req-id'].flatMap(name => {
        const value = response.headers.get(name);
        return value === null ? [] : [[name, value]];
      }));
      return response;
    },
  });
  const cases = [
    {
      id: 'mixed-object',
      state: { message: 'My order was charged twice. Please refund the duplicate charge.' },
      questions: {
        team: choice('Which team handles this request?', { billing: 'Charges and refunds', technical: 'Software defects', shipping: 'Delivery tracking' }),
        urgency: score('How urgent is the request?', ['No request', 'Routine request', 'Explicit emergency']),
        refund: booleanQuestion('Does the customer request a refund?'),
      },
      check: answers => { assert.equal(answers.team.choice, 'billing'); assert.ok(answers.refund.probability > 0.5); },
    },
    {
      id: 'chinese-string',
      state: '请打开台灯。',
      questions: { action: choice('选择用户要求的操作。', { turn_on: '打开台灯', turn_off: '关闭台灯', wait: '等待用户指令' }) },
      check: answers => assert.equal(answers.action.choice, 'turn_on'),
    },
    {
      id: 'boolean-array',
      state: [{ lamp: { on: false } }, { door: { open: true } }],
      questions: { lampOn: booleanQuestion('Is the lamp on?'), doorOpen: booleanQuestion('Is the door open?') },
      check: answers => { assert.ok(answers.lampOn.probability < 0.5); assert.ok(answers.doorOpen.probability > 0.5); },
    },
  ];
  for (const { id, check, ...input } of cases) {
    scenario = id;
    const result = await client.evaluate(input);
    report.rows.push({ scenario, model: result.model, response: result.response, answers: result.answers, usage: result.usage });
    assert.equal(result.response.status, 200);
    assert.equal(result.response.attempts, 1);
    check(result.answers);
  }
  assert.equal(report.requests.length, 3);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = {
    scenario,
    code: error instanceof SystemOneError ? error.code : error?.code === 'ENOENT' ? 'missing-config-file' : error?.code === 'ERR_ASSERTION' ? 'assertion' : 'configuration',
    ...(error instanceof SystemOneError && 'statusCode' in error ? { status: error.statusCode } : {}),
    ...(error instanceof SystemOneError && 'path' in error ? { path: error.path } : {}),
  };
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  const text = JSON.stringify(report, null, 2);
  const sanitized = (apiKey ? text.replaceAll(apiKey, '[redacted]') : text) + '\n';
  const directory = new URL('../.artifacts/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('live-cloudflare.json', directory), sanitized);
  await writeFile(new URL(`live-cloudflare-${startedAt.replaceAll(/[:.]/g, '-')}.json`, directory), sanitized);
  console.log(JSON.stringify({ status: report.status, inferenceRequests: report.requests.length, completedScenarios: report.rows.length, ...(report.failure ? { failure: report.failure } : {}), report: '.artifacts/live-cloudflare.json' }));
}
