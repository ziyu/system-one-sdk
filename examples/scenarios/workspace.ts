import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvaluationResult, JsonObject, Questions } from '../../src/index.js';
import type { PolicyResult } from '../../src/policies.js';

export type EffectStatus = 'executed' | 'clarification' | 'uncertain' | 'no-op' | 'conflict';
export interface Outcome {
  readonly status: EffectStatus;
  readonly action: string;
  readonly details: JsonObject;
}
export interface Receipt {
  readonly requestId: string;
  readonly inputHash: string;
  readonly outcome: Outcome;
}
export interface Journal {
  readonly kind: 'files' | 'support';
  receipts: Receipt[];
}
export interface Gate {
  readonly name: string;
  readonly result: PolicyResult<string | boolean>;
}
export interface CommandResult {
  readonly requestId: string;
  readonly replayed: boolean;
  readonly outcome: Outcome;
  readonly decision?: { readonly action: string; readonly parameters: JsonObject };
  readonly evaluation?: EvaluationResult<Questions>;
  readonly gates?: readonly Gate[];
}

export function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function createWorkspace(kind: Journal['kind'], parent = path.resolve('.artifacts/decision-examples')): Promise<string> {
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, `${kind}-`));
}

export async function loadJournal<T extends Journal>(directory: string, kind: T['kind']): Promise<T> {
  const value = JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8')) as T;
  if (value.kind !== kind || !Array.isArray(value.receipts)) throw new Error('This directory is not a matching example workspace.');
  return value;
}

/** One writer at a time; an occupied workspace fails promptly instead of silently racing. */
export async function withLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const filename = path.join(directory, '.decision.lock');
  const handle = await open(filename, 'wx');
  try { return await operation(); }
  finally { await handle.close(); await unlink(filename); }
}

/** Store ticket changes and their receipt together in one atomic JSON replacement. */
export async function saveJournal(directory: string, value: Journal): Promise<void> {
  const temporary = path.join(directory, `.workspace-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, path.join(directory, 'workspace.json'));
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function replay(journal: Journal, requestId: string, message: string): CommandResult | undefined {
  if (!requestId.trim() || !message.trim()) throw new Error('Provide a nonempty request ID and message.');
  const existing = journal.receipts.find(receipt => receipt.requestId === requestId);
  if (!existing) return undefined;
  if (existing.inputHash !== digest(message)) {
    return { requestId, replayed: true, outcome: { status: 'conflict', action: 'none', details: { reason: 'request-id-reused-with-different-message' } } };
  }
  return { requestId, replayed: true, outcome: existing.outcome };
}

export function remember(journal: Journal, requestId: string, message: string, outcome: Outcome): void {
  journal.receipts.push({ requestId, inputHash: digest(message), outcome });
}

export function gatedOutcome(action: string, gates: readonly Gate[]): Outcome | undefined {
  const blocked = gates.find(gate => gate.result.status !== 'accepted');
  if (!blocked) return undefined;
  return {
    status: blocked.result.status === 'abstained' ? 'clarification' : 'uncertain', action,
    details: { reason: blocked.result.status, gate: blocked.name },
  };
}

export const choicePolicy = Object.freeze({ minProbability: 0.8, minMargin: 0.2 });
