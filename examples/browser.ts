import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { scenarioClient } from './scenarios/client.js';
import { runBrowserTask, type BrowserTask } from './browser-use/agent.js';
import { browserTasks, verifyBrowserTask } from './browser-use/tasks.js';

const { values } = parseArgs({ options: {
  task: { type: 'string', multiple: true }, provider: { type: 'string', default: 'typesafe' },
  channel: { type: 'string', default: 'chrome' }, headless: { type: 'boolean', default: false },
  url: { type: 'string' }, goal: { type: 'string' }, input: { type: 'string', multiple: true },
  origin: { type: 'string', multiple: true }, 'max-steps': { type: 'string', default: '14' },
  'max-targets': { type: 'string', default: '96' },
  'min-probability': { type: 'string', default: '0.65' }, help: { type: 'boolean' },
} });

if (values.help) {
  console.log('Usage: npm run example:browser -- --task github-agents|mdn-abort|npm-sdk|all --provider typesafe|openrouter|cloudflare [--headless] [--channel chrome|chromium]');
  console.log('Default task: mdn-abort. Repeat --task to run several tasks in one browser.');
  console.log('Custom: --url <start page> --goal <instruction> --input <literal text> [--input <more text>] [--origin <additional allowed origin>] [--max-steps 14] [--min-probability 0.65]');
} else {
  let browser;
  let output: string | undefined;
  let connection: Awaited<ReturnType<typeof scenarioClient>> | undefined;
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  try {
    const maxSteps = Number(values['max-steps']);
    const maxTargets = Number(values['max-targets']);
    const minProbability = Number(values['min-probability']);
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 40) throw new Error('max-steps must be 1–40.');
    if (!Number.isInteger(maxTargets) || maxTargets < 1 || maxTargets > 200) throw new Error('max-targets must be 1–200.');
    if (!Number.isFinite(minProbability) || minProbability < 0 || minProbability > 1) throw new Error('min-probability must be within 0–1.');
    if (!['chrome', 'chromium'].includes(values.channel!)) throw new Error('channel must be chrome or chromium.');
    if (Boolean(values.url) !== Boolean(values.goal)) throw new Error('Custom browsing requires both --url and --goal.');
    if (values.url && !['http:', 'https:'].includes(new URL(values.url).protocol)) throw new Error('Custom start URL must use HTTP or HTTPS.');
    const taskIds = values.task ?? ['mdn-abort'];
    const tasks: BrowserTask[] = values.url && values.goal ? [{
      id: 'custom', startURL: values.url, goal: values.goal,
      inputs: (values.input ?? []).map((text, i) => ({ id: `input-${i}`, text })),
      allowedOrigins: [new URL(values.url).origin, ...(values.origin ?? []).map(origin => new URL(origin).origin)],
    }] : taskIds.includes('all') ? Object.values(browserTasks) : [...new Set(taskIds)].map(id => browserTasks[id]!);
    if (tasks.some(task => !task)) throw new Error('Unknown task. Use --help.');
    connection = await scenarioClient(values.provider!);
    await mkdir('.artifacts', { recursive: true });
    output = await mkdtemp(path.resolve('.artifacts', `browser-decisions-${values.provider}-`));
    const sourceHashes = Object.fromEntries(await Promise.all([
      'examples/browser.ts', 'examples/browser-use/agent.ts', 'examples/browser-use/observe.ts', 'examples/browser-use/tasks.ts', 'src/decisions.ts',
    ].map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
    browser = await chromium.launch({ ...(values.channel === 'chrome' ? { channel: 'chrome' } : {}), headless: values.headless!, timeout: 15000 });
    const summary: Record<string, unknown> = { startedAt: new Date().toISOString(), provider: values.provider, browser: browser.version(), headless: values.headless, sourceHashes, results: [] };
    const results: Record<string, unknown>[] = [];
    summary.results = results;
    console.log(JSON.stringify({ browser: browser.version(), headed: !values.headless, output, tasks: tasks.map(task => task.id), liveModel: true, websites: 'public internet; no response fixtures' }));
    for (const task of tasks) {
      if (abort.signal.aborted) break;
      const directory = path.join(output, task.id);
      await mkdir(directory);
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', serviceWorkers: 'block', acceptDownloads: false });
      const navigation: Record<string, unknown>[] = [];
      await context.route('**/*', async route => {
        const request = route.request();
        if (request.isNavigationRequest() && request.frame().parentFrame() === null && !task.allowedOrigins.includes(new URL(request.url()).origin)) {
          navigation.push({ url: request.url(), blocked: true });
          await route.abort('blockedbyclient');
        } else await route.continue();
      });
      context.on('response', response => {
        if (response.request().isNavigationRequest()) navigation.push({ url: response.url(), status: response.status() });
      });
      const page = await context.newPage();
      page.on('dialog', dialog => { void dialog.dismiss(); });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const requestStart = connection.requests.length;
      try {
        const run = await runBrowserTask(connection.client, page, task, {
          output: directory, maxSteps, maxTargets, minProbability, signal: abort.signal, redact: connection.redact,
          onStep: step => console.log(connection!.redact(JSON.stringify({ task: task.id, ...step }))),
        });
        const verification = task.id === 'custom' ? { passed: false, checks: {}, note: 'Model finish is not independent verification for a custom goal.' } : verifyBrowserTask(task.id, run);
        const row = { task: task.id, status: run.status, verification, steps: run.steps.length, actualRequests: connection.requests.length - requestStart, finalURL: run.final?.url, directory, navigation, failure: run.failure };
        results.push(row);
        await writeFile(path.join(directory, 'verification.json'), connection.redact(JSON.stringify(row, null, 2)) + '\n');
        console.log(JSON.stringify(row));
        if (task.id === 'custom' ? run.status !== 'model-finished' : !verification.passed) process.exitCode = 1;
      } finally {
        await context.tracing.stop({ path: path.join(directory, 'trace.zip') });
        await context.close();
        await writeFile(path.join(output, 'summary.json'), connection.redact(JSON.stringify({ ...summary, completedAt: new Date().toISOString(), requests: connection.requests }, null, 2)) + '\n');
      }
    }
    if (abort.signal.aborted) process.exitCode = 130;
    console.log(JSON.stringify({ report: path.join(output, 'summary.json'), tasks: results.length, actualRequests: connection.requests.length }));
  } catch (error) {
    const failure = { status: 'failed', message: error instanceof Error ? error.message.slice(0, 600) : 'Browser example failed.' };
    const text = JSON.stringify(failure);
    console.error(connection ? connection.redact(text) : text);
    if (output) await writeFile(path.join(output, 'failure.json'), connection ? connection.redact(text) : text);
    process.exitCode = 1;
  } finally { await browser?.close(); process.removeListener('SIGINT', stop); }
}
