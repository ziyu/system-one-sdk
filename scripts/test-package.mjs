import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, '.artifacts');
await mkdir(artifacts, { recursive: true });
const [pack] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', artifacts, '--json'], { cwd: root, encoding: 'utf8' }));
assert.ok(pack.files.some(file => file.path === 'dist/esm/index.js'));
assert.ok(pack.files.some(file => file.path === 'dist/cjs/index.js'));
assert.ok(pack.files.some(file => file.path === 'dist/esm/adapters/vercel.js'));
assert.ok(pack.files.some(file => file.path === 'dist/cjs/adapters/vercel.js'));
assert.ok(pack.files.every(file => /^(dist\/|docs\/|README(?:\.zh-CN)?\.md$|LICENSE$|package\.json$)/.test(file.path)), 'Unexpected file in package');
const consumer = await mkdtemp(path.join(artifacts, 'consumer-'));
try {
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', path.join(artifacts, pack.filename), '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumer, stdio: 'pipe' });
  const smoke = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import * as esm from '@system-one-ai/sdk';
    const require = createRequire(import.meta.url);
    const cjs = require('@system-one-ai/sdk');
    const manifest = require('@system-one-ai/sdk/package.json');
    assert.equal(manifest.name, '@system-one-ai/sdk');
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.publishConfig.access, 'public');
    assert.deepEqual(manifest.dependencies ?? {}, {});
    assert.equal(manifest.devDependencies?.['@ai-sdk/gateway'], undefined);
    assert.equal('vercelAdapter' in esm, false);
    assert.equal('vercelAdapter' in cjs, false);
    assert.ok(!Object.keys(require.cache).some(path => path.endsWith('/adapters/vercel.js')), 'Core import must not load the optional adapter');
    for (const sdk of [esm, cjs]) {
      const client = new sdk.SystemOne({
        apiKey: null,
        fetch: async () => new Response(JSON.stringify({answers:{on:{type:'noul',noul:0.9}}})),
      });
      const result = await client.evaluate({state:'on',questions:{on:sdk.booleanQuestion('Is the light on?')}});
      assert.equal(result.answers.on.probability, 0.9);
    }
    const optionalESM = await import('@system-one-ai/sdk/adapters/vercel');
    const optionalCJS = require('@system-one-ai/sdk/adapters/vercel');
    for (const [sdk, optional] of [[esm, optionalESM], [cjs, optionalCJS]]) {
      const client = new sdk.SystemOne({
        apiKey: 'package-fixture', adapter: optional.vercelAdapter,
        fetch: async (url, init) => {
          assert.equal(url, 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model');
          assert.equal(init.headers.get('ai-model-id'), 'typesafe-ai/jev');
          return new Response(JSON.stringify({answers:{on:{type:'boolean',probability:0.9}}}));
        },
      });
      const result = await client.evaluate({state:'on',questions:{on:sdk.booleanQuestion('Is the light on?')}});
      assert.equal(result.answers.on.probability, 0.9);
    }
    console.log('Installed tarball: ESM/CJS core and optional adapter passed; core does not load Vercel.');
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', smoke], { cwd: consumer, stdio: 'inherit' });
  const typeConsumer = `
    import { SystemOne, choice } from '@system-one-ai/sdk';
    import { vercelAdapter } from '@system-one-ai/sdk/adapters/vercel';
    // @ts-expect-error Optional adapters are not part of the core entry point.
    import { vercelAdapter as removedRootExport } from '@system-one-ai/sdk';
    const client = new SystemOne({apiKey: null});
    new SystemOne({apiKey: 'fixture', adapter: vercelAdapter});
    // @ts-expect-error The former protocol string must not silently persist in declarations.
    new SystemOne({apiKey: 'fixture', protocol: 'vercel'});
    void removedRootExport;
    async function run() {
      const result = await client.evaluate({state:'water',questions:{action:choice('Next?',{drink:null,rest:null})}});
      const action: 'drink' | 'rest' = result.answers.action.choice;
      // @ts-expect-error The packaged declaration must retain the choice union.
      const invalid: 'fly' = result.answers.action.choice;
      return {action, invalid};
    }
    void run;
  `;
  await Promise.all(['consumer.mts', 'consumer.cts'].map(name => writeFile(path.join(consumer, name), typeConsumer)));
  await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: [], strict: true, noEmit: true, skipLibCheck: false }, include: ['consumer.mts', 'consumer.cts'] }));
  const require = createRequire(import.meta.url);
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', path.join(consumer, 'tsconfig.json')], { cwd: consumer, stdio: 'inherit' });
  console.log(`Installed declarations: ESM and CommonJS type inference passed. Package: .artifacts/${pack.filename}`);
} finally {
  // Only the temporary consumer created by this script is removed. The tarball is retained.
  await rm(consumer, { recursive: true, force: true });
}
