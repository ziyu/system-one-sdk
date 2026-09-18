import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SystemOneError } from '../.examples/src/index.js';
import { scenarioClient } from '../.examples/examples/scenarios/client.js';
import { cases } from '../.examples/examples/scenarios/cases.js';
import { runFileCommand, seedFiles } from '../.examples/examples/scenarios/files.js';
import { runSupportCommand, seedSupport } from '../.examples/examples/scenarios/support.js';
import { loadJournal } from '../.examples/examples/scenarios/workspace.js';

const { values } = parseArgs({ options: {
  provider: { type: 'string', default: 'typesafe' }, phase: { type: 'string', default: 'all' },
} });
if (!['all', 'development', 'holdout'].includes(values.phase)) throw new Error('phase must be all, development or holdout');
const startedAt = new Date().toISOString();
const report = { startedAt, provider: values.provider, phase: values.phase, sampleData: 'Synthetic business documents and tickets; real model calls and disk operations.', rows: [] };
const workspaces = {};
const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
let connection;
let output;

async function businessSnapshot(kind, directory) {
  if (kind === 'support') {
    const journal = await loadJournal(directory, 'support');
    return { tickets: journal.tickets, teams: journal.teams };
  }
  const entries = {};
  async function visit(relative) {
    for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else entries[name] = bytesHash(await readFile(path.join(directory, name)));
    }
  }
  await visit('inbox');
  await visit('archive');
  return entries;
}

async function verify(scenario, directory, before, after, result) {
  const expected = scenario.expected;
  assert.equal(result.replayed, false);
  assert.equal(result.evaluation.response.status, 200);
  assert.equal(result.evaluation.response.attempts, 1);
  if (expected.blocked) {
    assert.ok(['clarification', 'uncertain'].includes(result.outcome.status), 'unsupported or ambiguous requests must not execute');
    assert.deepEqual(after, before, 'blocked requests must preserve business data');
    return;
  }
  assert.equal(result.decision.action, expected.action, 'wrong action');
  assert.equal(result.outcome.status, expected.action === 'wait' ? 'no-op' : 'executed', 'clear commands must complete, not just abstain');
  for (const key of ['document', 'folder', 'ticket', 'team']) {
    if (expected[key]) assert.equal(result.decision.parameters[key], expected[key], `wrong ${key}`);
  }
  if (expected.action === 'wait') { assert.deepEqual(after, before); return; }
  if (expected.action === 'read') {
    assert.deepEqual(after, before);
    assert.equal(bytesHash(result.outcome.details.content), before[`inbox/${expected.document}`]);
    return;
  }
  if (expected.action === 'file') {
    const wanted = { ...before };
    const source = `inbox/${expected.document}`;
    wanted[`archive/${expected.folder}/${expected.document}`] = wanted[source];
    delete wanted[source];
    assert.deepEqual(after, wanted, 'only the selected document may move, without changing its bytes');
    return;
  }
  const ticket = after.tickets.find(item => item.id === expected.ticket);
  const original = before.tickets.find(item => item.id === expected.ticket);
  assert.equal(ticket.revision, original.revision + 1);
  const wanted = { ...original, revision: original.revision + 1 };
  if (expected.action === 'assign') { wanted.teamId = expected.team; wanted.priority = expected.priority; }
  if (expected.action === 'resolve') wanted.status = 'resolved';
  assert.deepEqual(ticket, wanted);
  assert.deepEqual(after.tickets.filter(item => item.id !== expected.ticket), before.tickets.filter(item => item.id !== expected.ticket));
  assert.deepEqual(after.teams, before.teams);
}

try {
  connection = await scenarioClient(values.provider);
  await mkdir('.artifacts', { recursive: true });
  output = await mkdtemp(path.resolve('.artifacts', `live-decisions-${values.provider}-`));
  report.output = path.relative(process.cwd(), output);
  report.configFile = connection.configFile;
  report.sourceHashes = Object.fromEntries(await Promise.all([
    'examples/scenarios/files.ts', 'examples/scenarios/support.ts', 'examples/scenarios/workspace.ts',
    'examples/scenarios/cases.ts', 'scripts/test-decisions-live.mjs', 'src/decisions.ts', 'src/policies.ts',
  ].map(async name => [name, bytesHash(await readFile(name))])));
  for (const scenario of cases.filter(item => values.phase === 'all' || item.phase === values.phase)) {
    const row = { id: scenario.id, kind: scenario.kind, phase: scenario.phase, message: scenario.message, expected: scenario.expected, passed: false };
    report.rows.push(row);
    if (!workspaces[scenario.kind] || scenario.fresh) workspaces[scenario.kind] = await (scenario.kind === 'files' ? seedFiles : seedSupport)(output);
    const directory = workspaces[scenario.kind];
    row.workspace = path.relative(process.cwd(), directory);
    const run = scenario.kind === 'files' ? runFileCommand : runSupportCommand;
    row.before = await businessSnapshot(scenario.kind, directory);
    const requestCount = connection.requests.length;
    try {
      row.result = await run(connection.client, directory, scenario.message, scenario.id);
      row.after = await businessSnapshot(scenario.kind, directory);
      assert.equal(connection.requests.length - requestCount, 1, 'each case must make exactly one real request');
      await verify(scenario, directory, row.before, row.after, row.result);
      const replayed = await run(connection.client, directory, scenario.message, scenario.id);
      assert.equal(replayed.replayed, true);
      assert.deepEqual(replayed.outcome, row.result.outcome);
      assert.equal(connection.requests.length - requestCount, 1, 'replay must not repeat inference');
      assert.deepEqual(await businessSnapshot(scenario.kind, directory), row.after, 'replay must not duplicate effects');
      row.replayVerified = true;
      row.passed = true;
    } catch (error) {
      row.failure = { code: error instanceof SystemOneError ? error.code : error.code ?? 'application', ...(error instanceof SystemOneError && 'statusCode' in error ? { status: error.statusCode } : {}), ...(error.code === 'ERR_ASSERTION' ? { message: error.message } : {}) };
    }
    console.log(connection.redact(JSON.stringify({ id: row.id, passed: row.passed, action: row.result?.decision?.action, parameters: row.result?.decision?.parameters, status: row.result?.outcome.status, durationMs: row.result?.evaluation?.response.durationMs, ...(row.failure ? { failure: row.failure } : {}) })));
    // Preserve intermediate results even if a later request or scenario fails.
    await writeFile(path.join(output, 'report.json'), connection.redact(JSON.stringify({ ...report, requests: connection.requests }, null, 2)) + '\n');
  }
} catch (error) {
  report.failure = { code: error instanceof SystemOneError ? error.code : error.code ?? 'configuration' };
} finally {
  const measured = report.rows.flatMap(row => row.result?.evaluation ? [row.result.evaluation] : []);
  const latencies = measured.map(item => item.response.durationMs).sort((a, b) => a - b);
  const percentile = p => latencies.length ? latencies[Math.ceil(latencies.length * p) - 1] : null;
  const positives = report.rows.filter(row => !row.expected.blocked);
  const blocked = report.rows.filter(row => row.expected.blocked);
  const correctActions = positives.filter(row => row.result?.decision?.action === row.expected.action).length;
  report.completedAt = new Date().toISOString();
  report.requests = connection?.requests ?? [];
  report.summary = {
    cases: report.rows.length, passed: report.rows.filter(row => row.passed).length,
    clearCommands: positives.length, correctActions, completedClearCommands: positives.filter(row => row.passed).length,
    ambiguousOrUnsupported: blocked.length, safelyBlocked: blocked.filter(row => row.passed).length,
    wrongExecutions: report.rows.filter(row => !row.passed && row.result?.outcome.status === 'executed').length,
    replaysVerified: report.rows.filter(row => row.replayVerified).length,
    actualRequests: report.requests.length, models: [...new Set(measured.map(item => item.model))],
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: latencies.at(-1) ?? null },
    reportedTokens: {
      input: measured.reduce((sum, item) => sum + (item.usage.inputTokens ?? 0), 0),
      output: measured.reduce((sum, item) => sum + (item.usage.outputTokens ?? 0), 0),
      inputCoverage: measured.filter(item => item.usage.inputTokens !== undefined).length,
      outputCoverage: measured.filter(item => item.usage.outputTokens !== undefined).length,
    },
  };
  report.status = !report.failure && report.rows.length > 0 && report.rows.every(row => row.passed) ? 'passed' : 'failed';
  await mkdir('.artifacts', { recursive: true });
  if (!output) output = await mkdtemp(path.resolve('.artifacts', 'live-decisions-config-'));
  const serialized = JSON.stringify(report, null, 2) + '\n';
  await writeFile(path.join(output, 'report.json'), connection ? connection.redact(serialized) : serialized);
  console.log(JSON.stringify({ status: report.status, ...report.summary, failure: report.failure, report: path.relative(process.cwd(), path.join(output, 'report.json')) }));
  if (report.status !== 'passed') process.exitCode = 1;
}
