import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { SystemOne, SystemOneError, choice, score, booleanQuestion } from '../dist/esm/index.js';

// Explicit opt-in only: npm run test:live loads this project's .env. Normal tests stay offline.
// Four short sequential requests, no retries, and no logging of headers or credentials.
const apiKey = process.env.SYSTEM_ONE_API_KEY;
const rows = [];
let activeScenario = 'configuration';

const scenarios = [
  {
    id: 'mixed-structured-state',
    input: {
      state: { userMessage: '请帮我倒一杯水。', currentAction: 'rest', waterDispenserAvailable: true },
      questions: {
        action: choice('根据用户请求选择下一步行动。', { drink: '去饮水机接一杯水', rest: '继续坐着休息', think: '请求更复杂的规划' }),
        urgency: score('用户请求有多紧急？', ['用户没有提出任务', '普通请求，没有立即执行的期限', '明确要求紧急、马上执行']),
        interrupt: booleanQuestion('用户是否提出了不同于当前行为的请求？'),
      },
    },
    check(result) {
      assert.equal(result.answers.action.choice, 'drink');
      assert.ok(result.answers.action.probabilities);
      assert.ok(result.answers.urgency.probabilities);
      assert.ok(result.answers.urgency.legend);
      assert.ok(result.answers.interrupt.probability > 0.5);
    },
  },
  {
    id: 'choice-string-state',
    input: {
      state: '同一笔订单被扣款两次，请退回重复扣除的钱。',
      questions: { department: choice('哪一个团队应处理这条消息？', { billing: '付款、重复扣款和退款', shipping: '包裹配送和物流', technical: '软件故障和技术问题' }) },
    },
    check(result) { assert.equal(result.answers.department.choice, 'billing'); },
  },
  {
    id: 'score-array-state',
    input: {
      state: [{ role: 'user', content: 'The export button crashes in Safari. It works in Chrome, so users can switch to Chrome to export.' }],
      questions: { severity: score('How severe is this software defect?', ['Cosmetic; no impact on functionality', 'A feature is broken but there is a working workaround', 'Blocking issue with no workaround']) },
    },
    check(result) {
      assert.ok(result.answers.severity.score >= 0 && result.answers.severity.score <= 2);
      assert.ok(result.answers.severity.probabilities);
      assert.ok(result.answers.severity.legend);
    },
  },
  {
    id: 'boolean-positive-and-negative',
    input: {
      state: { lamp: { isOn: false }, door: { isOpen: true } },
      questions: { lightOn: booleanQuestion('Is the lamp on?'), doorOpen: booleanQuestion('Is the door open?') },
    },
    check(result) {
      assert.ok(result.answers.lightOn.probability < 0.5);
      assert.ok(result.answers.doorOpen.probability > 0.5);
    },
  },
];

try {
  if (!apiKey) throw new Error('SYSTEM_ONE_API_KEY is required.');
  const client = new SystemOne({
    ...(process.env.SYSTEM_ONE_BASE_URL ? { baseURL: process.env.SYSTEM_ONE_BASE_URL } : {}),
    apiKey,
    ...(process.env.SYSTEM_ONE_MODEL ? { model: process.env.SYSTEM_ONE_MODEL } : {}),
    timeoutMs: 15_000,
    maxRetries: 0,
  });
  const redact = text => text.replaceAll(apiKey, '[redacted]');
  for (const scenario of scenarios) {
    activeScenario = scenario.id;
    const result = await client.evaluate(scenario.input);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.attempts, 1);
    assert.ok(Number.isSafeInteger(result.usage.inputTokens));
    assert.ok(Number.isSafeInteger(result.usage.outputTokens));
    scenario.check(result);
    const row = {
      scenario: scenario.id,
      status: result.response.status,
      model: result.model,
      durationMs: result.response.durationMs,
      attempts: result.response.attempts,
      answers: result.answers,
      usage: result.usage,
    };
    rows.push(row);
    console.log(redact(JSON.stringify(row)));
  }
  const report = { completedAt: new Date().toISOString(), node: process.version, transport: 'native Fetch', requests: rows.length, rows };
  await mkdir(new URL('../.artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../.artifacts/live-typesafe.json', import.meta.url), redact(JSON.stringify(report, null, 2)) + '\n');
  console.log('Live checks passed. Report: .artifacts/live-typesafe.json');
} catch (error) {
  // Do not print arbitrary causes, upstream bodies, or the client configuration.
  const failure = {
    scenario: activeScenario,
    code: error instanceof SystemOneError ? error.code : error?.code === 'ERR_ASSERTION' ? 'assertion' : 'configuration',
    ...(error instanceof SystemOneError && 'statusCode' in error ? { status: error.statusCode } : {}),
    ...(error instanceof SystemOneError && 'path' in error ? { path: error.path } : {}),
    completedScenarios: rows.length,
  };
  console.error(JSON.stringify(failure));
  process.exitCode = 1;
}
