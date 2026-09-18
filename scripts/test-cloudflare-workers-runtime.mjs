import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Opt-in integration check: installs pinned tooling in an isolated temporary consumer.
// Requires npm network access, but no Cloudflare credentials and makes no model calls.
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'system-one-workers-'));
const require = createRequire(import.meta.url);
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, cwd = temporary) {
  return execFileSync(command, args, { cwd, env, encoding: 'utf8', stdio: 'pipe', timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
}
let mf;
try {
  await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const [pack] = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root));
  for (const format of ['esm', 'cjs']) for (const extension of ['js', 'd.ts']) {
    assert.ok(pack.files.some(file => file.path === `dist/${format}/cloudflare-workers.${extension}`));
  }
  console.log('Installing Wrangler 4.135.0 and the built SDK tarball in an isolated consumer.');
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', 'wrangler@4.135.0', path.join(temporary, pack.filename)]);
  const consumerRequire = createRequire(path.join(temporary, 'package.json'));
  const wranglerPackage = consumerRequire.resolve('wrangler/package.json');
  const tooling = createRequire(wranglerPackage);
  const { build } = tooling('esbuild');
  const { Miniflare } = tooling('miniflare');
  const wrangler = path.join(path.dirname(wranglerPackage), 'bin/wrangler.js');

  // Actual installed ESM and CommonJS entry points, not package self-resolution.
  await writeFile(path.join(temporary, 'package-smoke.mjs'), `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import * as esmCore from '@system-one-ai/sdk';
    const require = createRequire(import.meta.url);
    const cjsCore = require('@system-one-ai/sdk');
    assert.equal('CloudflareWorkers' in esmCore, false);
    assert.equal('CloudflareWorkers' in cjsCore, false);
    assert.ok(!Object.keys(require.cache).some(file => file.endsWith('/cloudflare-workers.js')));
    const esm = await import('@system-one-ai/sdk/cloudflare-workers');
    const cjs = require('@system-one-ai/sdk/cloudflare-workers');
    for (const [core, native] of [[esmCore, esm], [cjsCore, cjs]]) {
      const client = native.createCloudflareWorkers({ binding: { run: async () => Response.json({ answers: { yes: { type: 'noul', noul: 0.9 } } }) } });
      const result = await client.evaluate({ state: {}, questions: { yes: core.booleanQuestion('Yes?') } });
      assert.equal(result.answers.yes.probability, 0.9);
    }
  `);
  run(process.execPath, ['package-smoke.mjs']);
  console.log('Installed tarball: ESM/CJS native entry and core isolation passed.');

  await writeFile(path.join(temporary, 'worker.mjs'), 'export default { fetch() { return new Response("types"); } };\n');
  await writeFile(path.join(temporary, 'wrangler.json'), JSON.stringify({ name: 'system-one-types-check', main: 'worker.mjs', compatibility_date: '2026-09-18', ai: { binding: 'AI' } }));
  run(process.execPath, [wrangler, 'types', 'worker-configuration.d.ts', '--config', 'wrangler.json']);
  const typeConsumer = `
    import { choice, type EvaluationClient } from '@system-one-ai/sdk';
    import { createCloudflareWorkers } from '@system-one-ai/sdk/cloudflare-workers';
    declare const env: Env;
    // Env.AI and all Web APIs below come from Wrangler's actual generated runtime types.
    const client = createCloudflareWorkers({ binding: env.AI, timeoutMs: 1500, maxRetries: 0 });
    const common: EvaluationClient = client;
    async function verify() {
      const result = await client.evaluate({ state: {}, questions: { action: choice('Act', { run: null, stop: null }) } });
      const action: 'run' | 'stop' = result.answers.action.choice;
      // @ts-expect-error Installed declaration must preserve the closed choice union.
      const invalid: 'fly' = result.answers.action.choice;
      return [action, invalid];
    }
    void [common, verify];
  `;
  for (const extension of ['mts', 'cts']) await writeFile(path.join(temporary, `consumer.${extension}`), typeConsumer);
  await writeFile(path.join(temporary, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ESNext'], types: [],
    strict: true, skipLibCheck: false, noEmit: true,
  }, files: ['worker-configuration.d.ts', 'consumer.mts', 'consumer.cts'] }));
  run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json']);
  console.log('Wrangler-generated Env.AI and Workers Web API types: ESM/CJS consumers passed without casts or DOM/Node globals.');

  // Bundle an installed consumer so workerd runs the published layout rather than TS sources.
  const fixture = await readFile(path.join(root, 'tests/workers/cloudflare-workers.mjs'), 'utf8');
  const bundled = await build({ stdin: { contents: fixture, resolveDir: temporary, sourcefile: 'binding-fixture.mjs', loader: 'js' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  mf = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-09-18', cf: false });
  for (const scenario of ['success', 'retry', 'cancel', 'timeout', 'invalid', 'oversized', 'parallel', 'composition']) {
    const response = await mf.dispatchFetch(`http://localhost/${scenario}`);
    const body = await response.text();
    assert.equal(response.status, 200, `${scenario}: ${body}`);
    assert.deepEqual(JSON.parse(body), { passed: scenario });
    console.log(`workerd fixture: ${scenario} passed.`);
  }
  console.log('Workers checks passed. Fixture inference only: no Cloudflare account access or real model call was verified.');
} catch (error) {
  if (error && typeof error === 'object') {
    if (error.stdout) process.stdout.write(String(error.stdout));
    if (error.stderr) process.stderr.write(String(error.stderr));
  }
  throw error;
} finally {
  if (mf) await mf.dispose();
  // Delete only the isolated consumer created by this script.
  await rm(temporary, { recursive: true, force: true });
}
