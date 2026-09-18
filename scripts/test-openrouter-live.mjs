import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { SystemOne, SystemOneError, choice, score, booleanQuestion } from '../dist/esm/index.js';
import { openRouterAdapter } from '../dist/esm/adapters/openrouter.js';

// Explicit opt-in. Read this file directly so inherited shell variables cannot select another key.
// The wrapper below delegates every request to native Fetch; there are no mock responses.
const runId = `system-one-sdk-${randomUUID()}`;
const startedAt = new Date().toISOString();
const report = { runId, startedAt, configFile: '.env.openrouter', node: process.version, requests: [], rows: [] };
const nativeFetch = globalThis.fetch.bind(globalThis);
const verifyOnly = process.argv.includes('--verify-only');
let apiKey;
let activeScenario = 'configuration';

async function readJSON(response) {
  // The metadata endpoint has its own deadline through the Fetch AbortSignal.
  const body = await response.text();
  if (body.length > 1024 * 1024) throw new Error('Metadata response exceeded the size limit.');
  return JSON.parse(body);
}

async function verifyGeneration(generationId) {
  const url = new URL('https://openrouter.ai/api/v1/generation');
  url.searchParams.set('id', generationId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await nativeFetch(url, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    const payload = await readJSON(response);
    const data = payload.data ?? {};
    const record = {
      generationId, checkedAt: new Date().toISOString(), status: response.status,
      ...(typeof payload.error?.code === 'number' ? { errorCode: payload.error.code } : {}),
      data: Object.fromEntries([
        'id', 'request_id', 'created_at', 'model', 'provider_name', 'api_type',
        'tokens_prompt', 'tokens_completion', 'native_tokens_prompt', 'native_tokens_completion',
        'total_cost', 'is_byok', 'session_id',
      ].filter(key => data[key] !== undefined).map(key => [key, data[key]])),
    };
    (report.generationLookups ??= []).push(record);
    console.log(JSON.stringify({ generationId, lookupStatus: record.status, model: data.model }).replaceAll(apiKey, '[redacted]'));
    if (response.status === 404 && attempt < 2) {
      await delay(1000 * (attempt + 1));
      continue;
    }
    assert.equal(response.status, 200, 'OpenRouter generation record must be readable with this key.');
    assert.equal(data?.id, generationId, 'Generation lookup must identify the actual request.');
    return record.data;
  }
  throw new Error('Generation record was not available.');
}

try {
  if (verifyOnly) {
    const previous = JSON.parse(await readFile(new URL('../.artifacts/live-openrouter.json', import.meta.url), 'utf8'));
    assert.equal(previous.requestedModel, '~typesafe/jev-latest');
    assert.equal(previous.rows?.length, 4);
    Object.assign(report, previous, { lookupResumedAt: startedAt });
    delete report.failure;
  }
  const config = parseEnv(await readFile(new URL('../.env.openrouter', import.meta.url), 'utf8'));
  apiKey = config.SYSTEM_ONE_API_KEY ?? config.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Configure SYSTEM_ONE_API_KEY in .env.openrouter.');
  const baseURL = config.SYSTEM_ONE_BASE_URL ?? openRouterAdapter.defaultBaseURL;
  const model = config.SYSTEM_ONE_MODEL ?? openRouterAdapter.defaultModel;
  assert.equal(new URL(baseURL).origin, 'https://openrouter.ai', 'Live verification only sends credentials to OpenRouter.');
  assert.equal(model, '~typesafe/jev-latest', 'Use the exact requested OpenRouter model ID in .env.openrouter.');
  report.requestedModel = model;
  const client = new SystemOne({
    adapter: openRouterAdapter, baseURL, apiKey, model, timeoutMs: 15000, maxRetries: 0,
    headers: { 'HTTP-Referer': 'https://github.com/ziyu/sytem-one-sdk', 'X-OpenRouter-Title': 'System One SDK integration test' },
    fetch: async (input, init) => {
      const url = String(input);
      assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
      assert.equal(init.method, 'POST');
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${apiKey}`);
      const request = JSON.parse(init.body);
      const record = { scenario: activeScenario, startedAt: new Date().toISOString(), url, method: init.method, model: request.model };
      report.requests.push(record);
      const response = await nativeFetch(input, init);
      record.status = response.status;
      record.responseURL = response.url;
      record.headers = Object.fromEntries(['date', 'x-request-id', 'request-id', 'cf-ray'].flatMap(name => {
        const value = response.headers.get(name);
        return value === null ? [] : [[name, value]];
      }));
      return response;
    },
  });
  const scenarios = [
    {
      id: 'mixed-chinese-object',
      state: { request: '请帮我倒一杯水。', currentAction: 'rest', waterAvailable: true, runId },
      questions: {
        action: choice('根据用户请求选择下一步行动。', { drink: '接一杯水', rest: '继续休息', think: '请求复杂规划' }),
        urgency: score('用户请求有多紧急？', ['没有任务', '普通请求', '明确要求马上执行']),
        interrupt: booleanQuestion('用户是否要求改变当前行为？'),
      },
      check: answers => { assert.equal(answers.action.choice, 'drink'); assert.ok(answers.interrupt.probability > 0.5); },
    },
    {
      id: 'choice-string',
      state: `同一笔订单被扣款两次，请退回重复扣款。Verification: ${runId}`,
      questions: { department: choice('哪个团队应该处理？', { billing: '付款及退款', shipping: '配送及物流', technical: '软件故障' }) },
      check: answers => assert.equal(answers.department.choice, 'billing'),
    },
    {
      id: 'score-array',
      state: [{ issue: 'Export crashes in Safari. Users can switch to Chrome, where export works.' }, { runId }],
      questions: { severity: score('Rate this issue.', ['Cosmetic only', 'A feature is broken but a workaround exists', 'Blocking without a workaround']) },
      check: answers => assert.ok(answers.severity.score >= 0.5 && answers.severity.score <= 1.5),
    },
    {
      id: 'boolean-positive-negative',
      state: { lamp: { isOn: false }, door: { isOpen: true }, runId },
      questions: { lightOn: booleanQuestion('Is the lamp on?'), doorOpen: booleanQuestion('Is the door open?') },
      check: answers => { assert.ok(answers.lightOn.probability < 0.5); assert.ok(answers.doorOpen.probability > 0.5); },
    },
  ];
  for (const { id, check, ...input } of verifyOnly ? [] : scenarios) {
    activeScenario = id;
    const result = await client.evaluate({ ...input, providerOptions: { openrouter: { session_id: runId } } });
    const metadata = result.providerMetadata?.openrouter;
    const row = { scenario: id, completedAt: new Date().toISOString(), status: result.response.status, model: result.model, durationMs: result.response.durationMs, attempts: result.response.attempts, requestId: result.response.requestId, ...metadata, answers: result.answers, usage: result.usage };
    report.rows.push(row);
    assert.equal(row.status, 200);
    assert.equal(row.attempts, 1);
    assert.ok(typeof row.generationId === 'string' && row.generationId.length > 0, 'OpenRouter must return a generation ID.');
    assert.ok(Number.isSafeInteger(row.usage.inputTokens));
    assert.ok(Number.isSafeInteger(row.usage.outputTokens));
    check(result.answers);
    console.log(JSON.stringify(row).replaceAll(apiKey, '[redacted]'));
  }
  // Verify persisted backend records after all inference requests; never repeat a POST for logging lag.
  activeScenario = 'generation-records';
  report.generationRecordsVerified = 0;
  for (const row of report.rows) {
    row.generationRecord = await verifyGeneration(row.generationId);
    assert.equal(row.generationRecord.model, row.model);
    assert.equal(row.generationRecord.provider_name, row.provider);
    assert.equal(row.generationRecord.api_type, 'decisions');
    assert.equal(row.generationRecord.native_tokens_prompt, row.usage.inputTokens);
    assert.equal(row.generationRecord.native_tokens_completion, row.usage.outputTokens);
    if (row.cost !== undefined) assert.ok(Math.abs(row.generationRecord.total_cost - row.cost) < 1e-12);
    if (row.generationRecord.session_id != null) assert.equal(row.generationRecord.session_id, report.runId);
    report.generationRecordsVerified++;
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = {
    scenario: activeScenario,
    code: error instanceof SystemOneError ? error.code : error?.code === 'ERR_ASSERTION' ? 'assertion' : 'configuration-or-network',
    ...(error instanceof SystemOneError && 'statusCode' in error ? { status: error.statusCode } : {}),
    ...(error instanceof SystemOneError && 'path' in error ? { path: error.path } : {}),
  };
  console.error(JSON.stringify(report.failure));
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  const directory = new URL('../.artifacts/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const text = JSON.stringify(report, null, 2);
  const sanitized = (apiKey ? text.replaceAll(apiKey, '[redacted]') : text) + '\n';
  const filename = `live-openrouter-${startedAt.replaceAll(':', '-')}.json`;
  await writeFile(new URL(filename, directory), sanitized);
  await writeFile(new URL('live-openrouter.json', directory), sanitized);
  console.log(JSON.stringify({ runId: report.runId, status: report.status, inferenceRequests: report.requests.length, newInferenceRequests: verifyOnly ? 0 : report.requests.length, generationRecordsVerified: report.generationRecordsVerified ?? 0, report: `.artifacts/${filename}` }));
}
