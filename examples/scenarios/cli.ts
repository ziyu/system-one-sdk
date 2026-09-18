import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SystemOneError } from '../../src/index.js';
import { scenarioClient } from './client.js';
import { runFileCommand, seedFiles } from './files.js';
import { runSupportCommand, seedSupport } from './support.js';
import type { CommandResult } from './workspace.js';

const demos = {
  files: ['先给我看看 Cedar Studio 那份服务合同的内容。', '把办公桌椅采购的发票归到财务发票目录。', '把 Cedar Studio 的服务合同归到法务合同目录。'],
  support: ['把重复扣款的工单交给账务组处理。', 'Route the Safari export ticket to product support; keep its priority unchanged.', '把所有用户无法登录的工单交给平台值班组，设置为紧急。', 'Safari 导出问题已修复，请关闭对应工单。'],
};

export async function runScenarioCli(kind: 'files' | 'support'): Promise<void> {
  try {
    const { values } = parseArgs({ options: {
      provider: { type: 'string', default: 'typesafe' }, workspace: { type: 'string' },
      message: { type: 'string' }, 'message-file': { type: 'string' },
      'request-id': { type: 'string' }, init: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
    } });
    if (values.help) {
      console.log('Options: --provider typesafe|openrouter|cloudflare --init --workspace <existing directory> --message <instruction> --message-file <utf8 file> --request-id <stable id>');
      return;
    }
    if (values.message !== undefined && values['message-file'] !== undefined) throw new Error('Use either --message or --message-file.');
    if (values.init && values.workspace) throw new Error('--init creates a new workspace; omit --workspace.');
    if (values.init && (values.message !== undefined || values['message-file'] !== undefined || values['request-id'] !== undefined)) throw new Error('--init only creates data; omit instruction options.');
    const message = values.message ?? (values['message-file'] ? await readFile(values['message-file'], 'utf8') : undefined);
    if (message !== undefined && !message.trim()) throw new Error('The instruction cannot be empty.');
    if (values['request-id'] && message === undefined) throw new Error('A stable request ID requires one instruction.');
    // --init does not need credentials. Every directory is new; existing user files are not replaced.
    const connection = values.init ? undefined : await scenarioClient(values.provider!);
    const directory = values.workspace ? path.resolve(values.workspace) : await (kind === 'files' ? seedFiles() : seedSupport());
    console.log(JSON.stringify({ workspace: directory, kind, sampleData: !values.workspace, liveModel: !values.init }));
    if (!connection) return;
    const results: CommandResult[] = [];
    const instructions = message === undefined ? demos[kind] : [message];
    const run = kind === 'files' ? runFileCommand : runSupportCommand;
    const runId = randomUUID();
    let failure: { code: string } | undefined;
    try {
      for (const [index, instruction] of instructions.entries()) {
        const result = await run(connection.client, directory, instruction, values['request-id'] ?? `${runId}-${index}`);
        results.push(result);
        console.log(connection.redact(JSON.stringify({ instruction, requestId: result.requestId, replayed: result.replayed, decision: result.decision, outcome: result.outcome, gates: result.gates, model: result.evaluation?.model, durationMs: result.evaluation?.response.durationMs })));
      }
    } catch (error) {
      failure = { code: error instanceof SystemOneError ? error.code : (error as NodeJS.ErrnoException).code ?? 'application' };
      process.exitCode = 1;
    }
    const reportPath = path.join(directory, `run-${runId}.json`);
    await writeFile(reportPath, connection.redact(JSON.stringify({ provider: connection.provider, requests: connection.requests, results, ...(failure ? { failure } : {}) }, null, 2)) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ report: reportPath, requests: connection.requests.length, ...(failure ? { status: 'failed', failure } : {}) }));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', code: error instanceof SystemOneError ? error.code : (error as NodeJS.ErrnoException).code ?? 'application' }));
    process.exitCode = 1;
  }
}
