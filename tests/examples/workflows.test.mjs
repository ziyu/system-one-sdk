import { systemOneAdapter } from '@system-one-ai/adapter-system-one';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SystemOne, APIError, RequestAbortedError } from '@system-one-ai/core';
import { listDocuments, runFileCommand, seedFiles } from '../../.examples/examples/scenarios/files.js';
import { runSupportCommand, seedSupport } from '../../.examples/examples/scenarios/support.js';
import { loadJournal, saveJournal } from '../../.examples/examples/scenarios/workspace.js';

async function workspace(t, kind) {
  const directory = await (kind === 'files' ? seedFiles : seedSupport)(path.resolve('.artifacts/offline-scenarios'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// Offline protocol fixtures exercise the real application executors. Live semantics are a separate suite.
function fixture(action, parameters = {}, { probability = 1, parameterProbabilities = {}, beforeResponse, inspect, failureStatus } = {}) {
  let calls = 0;
  const client = new SystemOne({ adapter: systemOneAdapter, apiKey: null, maxRetries: 0, transport: createFetchTransport(async (_, init) => {
    calls++;
    const body = JSON.parse(init.body);
    inspect?.(body);
    await beforeResponse?.();
    if (failureStatus) return new Response(JSON.stringify({ error: 'do-not-expose' }), { status: failureStatus });
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
      const name = question.instructions?.parameter;
      const selectedBranch = question.instructions?.action?.id === action;
      if (question.type === 'noul') return [id, { type: 'noul', noul: selectedBranch ? parameters[name] ?? 0.01 : 0.01 }];
      const keys = Object.keys(question.criteria);
      const selected = id === 'action' ? action : selectedBranch && typeof parameters[name] === 'string' ? parameters[name] : keys[0];
      assert.ok(keys.includes(selected), `fixture must use a declared candidate: ${id}/${selected}`);
      const p = id === 'action' ? probability : selectedBranch ? parameterProbabilities[name] ?? 1 : 1;
      const probabilities = Object.fromEntries(keys.map(key => [key, key === selected ? p : (1 - p) / (keys.length - 1)]));
      return [id, { type: 'choice', choice: selected, probabilities }];
    }));
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers }));
  }) });
  return { client, get calls() { return calls; } };
}

test('file action moves actual bytes, journals once, and replays without another inference', async t => {
  const directory = await workspace(t, 'files');
  const before = await listDocuments(directory);
  const model = fixture('file', { document: 'document-a.txt', folder: 'finance' });
  const first = await runFileCommand(model.client, directory, 'File the invoice.', 'request-1');
  assert.equal(first.outcome.status, 'executed');
  assert.equal(await readFile(path.join(directory, 'archive/finance/document-a.txt'), 'utf8'), before[0].content);
  assert.deepEqual((await listDocuments(directory)).map(item => item.id), ['document-b.txt', 'document-c.txt']);
  const second = await runFileCommand(model.client, directory, 'File the invoice.', 'request-1');
  assert.equal(second.replayed, true);
  assert.deepEqual(second.outcome, first.outcome);
  const collision = await runFileCommand(model.client, directory, 'File the contract.', 'request-1');
  assert.equal(collision.outcome.status, 'conflict');
  assert.equal(model.calls, 1);
  assert.equal((await loadJournal(directory, 'files')).receipts.length, 1);
});

test('an archive collision does not overwrite bytes or remove the inbox source', async t => {
  const directory = await workspace(t, 'files');
  const destination = path.join(directory, 'archive/finance/document-a.txt');
  await writeFile(destination, 'previous archive');
  const before = await listDocuments(directory);
  const result = await runFileCommand(fixture('file', { document: 'document-a.txt', folder: 'finance' }).client, directory, 'File invoice.', 'collision');
  assert.equal(result.outcome.status, 'conflict');
  assert.equal(await readFile(destination, 'utf8'), 'previous archive');
  assert.deepEqual(await listDocuments(directory), before);
});

test('a document edited during inference rejects the stale action', async t => {
  const directory = await workspace(t, 'files');
  const model = fixture('file', { document: 'document-a.txt', folder: 'finance' }, {
    beforeResponse: () => writeFile(path.join(directory, 'inbox/document-a.txt'), 'A new version the model has not seen.'),
  });
  const result = await runFileCommand(model.client, directory, 'File invoice.', 'stale');
  assert.equal(result.outcome.status, 'conflict');
  assert.equal(result.outcome.details.reason, 'inbox-changed-during-evaluation');
  assert.equal((await listDocuments(directory)).length, 3);
  await assert.rejects(readFile(path.join(directory, 'archive/finance/document-a.txt')), { code: 'ENOENT' });
});

test('read returns disk contents without changing the inbox', async t => {
  const directory = await workspace(t, 'files');
  const before = await listDocuments(directory);
  const result = await runFileCommand(fixture('read', { document: 'document-b.txt' }).client, directory, 'Show contract.', 'read');
  assert.equal(result.outcome.status, 'executed');
  assert.equal(result.outcome.details.content, before[1].content);
  assert.deepEqual(await listDocuments(directory), before);
});

test('ambiguous targets, explicit abstention and weak action evidence produce no file changes', async t => {
  const directory = await workspace(t, 'files');
  const before = await listDocuments(directory);
  for (const [id, model, expected] of [
    ['none', fixture('file', { document: 'none', folder: 'finance' }), 'clarification'],
    ['clarify', fixture('clarify'), 'clarification'],
    ['weak', fixture('file', { document: 'document-a.txt', folder: 'finance' }, { probability: 0.55 }), 'uncertain'],
  ]) {
    const result = await runFileCommand(model.client, directory, 'Do something.', id);
    assert.equal(result.outcome.status, expected);
    assert.deepEqual(await listDocuments(directory), before);
  }
});

test('support assignment persists the requested team and leaves an unstated priority untouched', async t => {
  const directory = await workspace(t, 'support');
  const model = fixture('assign', { ticket: 'T-102', team: 'product', priority: 'keep' });
  const result = await runSupportCommand(model.client, directory, 'Route export to product.', 'assign');
  assert.equal(result.outcome.status, 'executed');
  const stored = await loadJournal(directory, 'support');
  assert.equal(stored.tickets[1].teamId, 'product');
  assert.equal(stored.tickets[1].priority, 'high');
  assert.equal(stored.tickets[1].revision, 1);
  assert.equal(result.gates.find(gate => gate.name === 'priority').result.value, 'keep');
  assert.equal(stored.tickets[0].revision, 0);
  assert.equal(stored.receipts.length, 1);
});

test('an explicit priority change is applied and replay does not increment the revision', async t => {
  const directory = await workspace(t, 'support');
  const model = fixture('assign', { ticket: 'T-103', team: 'reliability', priority: 'urgent' });
  const result = await runSupportCommand(model.client, directory, 'Route outage urgently.', 'urgent');
  assert.equal(result.outcome.status, 'executed');
  const repeated = await runSupportCommand(model.client, directory, 'Route outage urgently.', 'urgent');
  assert.equal(repeated.replayed, true);
  assert.equal(model.calls, 1);
  const stored = await loadJournal(directory, 'support');
  assert.equal(stored.tickets[2].priority, 'urgent');
  assert.equal(stored.tickets[2].revision, 1);
});

test('uncertainty about an optional parameter blocks mutation instead of guessing a default', async t => {
  const directory = await workspace(t, 'support');
  const before = await loadJournal(directory, 'support');
  const result = await runSupportCommand(fixture('assign', { ticket: 'T-102', team: 'product', priority: 'urgent' }, { parameterProbabilities: { priority: 0.55 } }).client, directory, 'Route export.', 'uncertain');
  assert.equal(result.outcome.status, 'uncertain');
  assert.deepEqual((await loadJournal(directory, 'support')).tickets, before.tickets);
});

test('a team disabled during inference invalidates the plan and cannot receive a ticket', async t => {
  const directory = await workspace(t, 'support');
  const model = fixture('assign', { ticket: 'T-101', team: 'billing', priority: 'keep' }, { beforeResponse: async () => {
    const journal = await loadJournal(directory, 'support');
    journal.teams[0].active = false;
    await saveJournal(directory, journal);
  } });
  const result = await runSupportCommand(model.client, directory, 'Route refund.', 'stale');
  assert.equal(result.outcome.status, 'conflict');
  assert.equal((await loadJournal(directory, 'support')).tickets[0].teamId, null);
});

test('resolved tickets disappear from the next dynamic candidate set', async t => {
  const directory = await workspace(t, 'support');
  const closed = await runSupportCommand(fixture('resolve', { ticket: 'T-102' }).client, directory, 'Close export.', 'close');
  assert.equal(closed.outcome.status, 'executed');
  assert.equal((await loadJournal(directory, 'support')).tickets[1].status, 'resolved');
  const model = fixture('clarify', {}, { inspect: body => {
    for (const question of Object.values(body.questions)) {
      if (question.instructions?.parameter === 'ticket') assert.equal(Object.hasOwn(question.criteria, 'T-102'), false);
    }
  } });
  const result = await runSupportCommand(model.client, directory, 'Close export again.', 'close-again');
  assert.equal(result.outcome.status, 'clarification');
  assert.equal((await loadJournal(directory, 'support')).tickets[1].revision, 1);
});

test('API errors remain errors, without receipts or application effects', async t => {
  const directory = await workspace(t, 'support');
  const before = await loadJournal(directory, 'support');
  const model = fixture('assign', {}, { failureStatus: 401 });
  await assert.rejects(runSupportCommand(model.client, directory, 'Route refund.', 'error'), error => error instanceof APIError && error.statusCode === 401 && !error.message.includes('do-not-expose'));
  assert.deepEqual(await loadJournal(directory, 'support'), before);
  assert.equal(model.calls, 1);
});

test('pre-cancelled commands do not execute or start a network request', async t => {
  const directory = await workspace(t, 'files');
  const controller = new AbortController();
  controller.abort();
  const model = fixture('file', { document: 'document-a.txt', folder: 'finance' });
  await assert.rejects(runFileCommand(model.client, directory, 'File invoice.', 'cancel', { signal: controller.signal }), RequestAbortedError);
  assert.equal(model.calls, 0);
  assert.equal((await listDocuments(directory)).length, 3);
  assert.equal((await loadJournal(directory, 'files')).receipts.length, 0);
});

test('non-text inbox entries fail before sending data to a model', async t => {
  const directory = await workspace(t, 'files');
  await writeFile(path.join(directory, 'inbox/binary.dat'), Buffer.from([0xff, 0xfe]));
  const model = fixture('read', { document: 'document-a.txt' });
  await assert.rejects(runFileCommand(model.client, directory, 'Show documents.', 'binary'), /UTF-8/);
  assert.equal(model.calls, 0);
});
