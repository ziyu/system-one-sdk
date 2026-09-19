import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildOrder } from './workspaces.mjs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, '.artifacts');
const rootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await mkdir(artifacts, { recursive: true });
const packs = new Map();
for (const workspace of buildOrder()) {
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '.', '--ignore-scripts', '--pack-destination', artifacts, '--json'], { cwd: workspace.cwd, encoding: 'utf8' }));
  assert.ok(packed.files.some(file => file.path === 'LICENSE'));
  packs.set(workspace.manifest.name, packed);
}
const tarballs = names => names.map(name => path.join(artifacts, packs.get(name).filename));
// Consumers live outside the repository: missing packages cannot resolve through workspace links.
for (const workspace of buildOrder()) {
  const isolated = await mkdtemp(path.join(tmpdir(), 'system-one-package-'));
  try {
    const closure = buildOrder(workspace.directory).map(item => item.manifest.name);
    await writeFile(path.join(isolated, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    execFileSync('npm', ['install', ...tarballs(closure), '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: isolated, stdio: 'pipe' });
    await copyFile(path.join(root, 'tests/package-contracts.mjs'), path.join(isolated, 'contract.mjs'));
    execFileSync(process.execPath, ['contract.mjs', workspace.directory], { cwd: isolated, stdio: 'inherit' });
    await writeFile(path.join(isolated, 'consumer.mts'), `import * as pkg from '${workspace.manifest.name}'; void pkg;`);
    await writeFile(path.join(isolated, 'consumer.cts'), `import * as pkg from '${workspace.manifest.name}'; void pkg;`);
    execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.mts', 'consumer.cts'], { cwd: isolated, stdio: 'inherit' });
  } finally { await rm(isolated, { recursive: true, force: true }); }
}
const [pack] = JSON.parse(execFileSync('npm', ['pack', '.', '--ignore-scripts', '--pack-destination', artifacts, '--json'], { cwd: root, encoding: 'utf8' }));
assert.ok(pack.files.some(file => file.path === 'dist/esm/index.js'));
assert.ok(pack.files.some(file => file.path === 'dist/cjs/index.js'));
assert.ok(pack.files.some(file => file.path === 'dist/esm/adapters/vercel.js'));
assert.ok(pack.files.some(file => file.path === 'dist/cjs/adapters/vercel.js'));
assert.ok(pack.files.some(file => file.path === 'dist/esm/adapters/openrouter.js'));
assert.ok(pack.files.some(file => file.path === 'dist/cjs/adapters/openrouter.js'));
for (const entry of ['decisions', 'policies', 'batch', 'adapters/cloudflare']) {
  for (const format of ['esm', 'cjs']) {
    assert.ok(pack.files.some(file => file.path === `dist/${format}/${entry}.js`));
    assert.ok(pack.files.some(file => file.path === `dist/${format}/${entry}.d.ts`));
  }
}
assert.ok(pack.files.every(file => /^(dist\/|docs\/|README(?:\.zh-CN)?\.md$|LICENSE$|package\.json$)/.test(file.path)), 'Unexpected file in package');
const consumer = await mkdtemp(path.join(tmpdir(), 'system-one-sdk-'));
try {
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const minimal = ['@system-one-ai/core', '@system-one-ai/protocol-system-one', '@system-one-ai/adapter-system-one', '@system-one-ai/transport-fetch'];
  execFileSync('npm', ['install', ...tarballs(minimal), path.join(artifacts, pack.filename), '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: consumer, stdio: 'pipe' });
  execFileSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import * as sdk from '@system-one-ai/sdk';
    const require = createRequire(import.meta.url);
    require('@system-one-ai/sdk');
    assert.equal('llmAdapter' in sdk, false);
    for (const name of ['adapter-llm', 'adapter-vercel', 'adapter-openrouter', 'adapter-cloudflare', 'decisions', 'policies', 'batch']) {
      assert.throws(() => require.resolve('@system-one-ai/' + name), { code: 'MODULE_NOT_FOUND' });
    }
    const client = new sdk.SystemOne({ apiKey: null, fetch: async () => new Response(JSON.stringify({ answers: { on: { type: 'noul', noul: 1 } } })) });
    assert.equal((await client.evaluate({ state: 'on', questions: { on: sdk.booleanQuestion('On?') } })).answers.on.probability, 1);
    console.log('Minimal SDK install contains only native adapter and Fetch; optional packages are absent.');
  `], { cwd: consumer, stdio: 'inherit' });
  execFileSync('npm', ['install', ...tarballs([...packs.keys()]), '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: consumer, stdio: 'pipe' });
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
    assert.deepEqual(manifest.dependencies ?? {}, ${JSON.stringify(rootManifest.dependencies)});
    assert.equal(manifest.devDependencies?.['@ai-sdk/gateway'], undefined);
    assert.equal('vercelAdapter' in esm, false);
    assert.equal('vercelAdapter' in cjs, false);
    assert.equal('openRouterAdapter' in esm, false);
    assert.equal('openRouterAdapter' in cjs, false);
    assert.equal('cloudflareAdapter' in esm, false);
    assert.equal('cloudflareAdapter' in cjs, false);
    for (const name of ['choiceFrom', 'defineDecision', 'gateChoice', 'gateBoolean', 'evaluateMany']) {
      assert.equal(name in esm, false);
      assert.equal(name in cjs, false);
    }
    assert.ok(!Object.keys(require.cache).some(path => ['/adapters/vercel.js', '/adapters/openrouter.js', '/adapters/cloudflare.js'].some(suffix => path.endsWith(suffix))), 'Core import must not load optional adapters');
    assert.ok(!Object.keys(require.cache).some(path => ['/decisions.js', '/policies.js', '/batch.js'].some(suffix => path.endsWith(suffix))), 'Core import must not load composition modules');
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
    const openRouterESM = await import('@system-one-ai/sdk/adapters/openrouter');
    const openRouterCJS = require('@system-one-ai/sdk/adapters/openrouter');
    for (const [sdk, optional] of [[esm, openRouterESM], [cjs, openRouterCJS]]) {
      const client = new sdk.SystemOne({
        apiKey: 'package-fixture', adapter: optional.openRouterAdapter,
        fetch: async (url, init) => {
          assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
          assert.equal(JSON.parse(init.body).model, '~typesafe/jev-latest');
          return new Response(JSON.stringify({id:'gen-dec-package',model:'typesafe/jev-1.13',provider:'TypeSafe',answers:{on:{type:'noul',noul:0.9}},usage:{input_tokens:10,output_tokens:2,cost:0}}));
        },
      });
      const result = await client.evaluate({state:'on',questions:{on:sdk.booleanQuestion('Is the light on?')}});
      assert.equal(result.answers.on.probability, 0.9);
      assert.equal(result.providerMetadata.openrouter.generationId, 'gen-dec-package');
      assert.equal(result.providerMetadata.openrouter.cost, 0);
    }
    const cloudflareESM = await import('@system-one-ai/sdk/adapters/cloudflare');
    const cloudflareCJS = require('@system-one-ai/sdk/adapters/cloudflare');
    for (const [sdk, optional] of [[esm, cloudflareESM], [cjs, cloudflareCJS]]) {
      let runnerState = 'Completed';
      const client = new sdk.SystemOne({
        adapter: optional.cloudflareAdapter({ accountId: 'package-test-account' }),
        apiKey: 'package-fixture',
        fetch: async (url, init) => {
          assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/package-test-account/ai/run');
          assert.deepEqual(JSON.parse(init.body), {model:'typesafe/jev',input:{state:'on',questions:{on:{type:'noul',instructions:'Is the light on?'}}}});
          return new Response(JSON.stringify({success:true,errors:[],result:{state:runnerState,result:{model:'jev-1.13.0',answers:{on:{type:'noul',noul:0.9}},usage:{input_tokens:10,output_tokens:2}}}}));
        },
      });
      const result = await client.evaluate({state:'on',questions:{on:sdk.booleanQuestion('Is the light on?')}});
      assert.equal(result.model, 'jev-1.13.0');
      assert.equal(result.answers.on.probability, 0.9);
      assert.equal(result.usage.totalTokens, 12);
      runnerState = 'Failed';
      await assert.rejects(client.evaluate({state:'on',questions:{on:sdk.booleanQuestion('Is the light on?')}}), sdk.ResponseValidationError);
    }
    const compositionESM = [await import('@system-one-ai/sdk/decisions'), await import('@system-one-ai/sdk/policies'), await import('@system-one-ai/sdk/batch')];
    const compositionCJS = [require('@system-one-ai/sdk/decisions'), require('@system-one-ai/sdk/policies'), require('@system-one-ai/sdk/batch')];
    for (const [sdk, [decisions, policies, batch]] of [[esm, compositionESM], [cjs, compositionCJS]]) {
      const object = { id: 'one', localOnly: true };
      const target = decisions.choiceFrom({ instructions: 'Target', items: [object], id: item => item.id, describe: () => null });
      const definition = decisions.defineDecision({ instructions: 'Action', actions: {
        choose: { description: null, parameters: { target } }, wait: { description: null },
      } });
      const client = new sdk.SystemOne({ apiKey: null, fetch: async () => new Response(JSON.stringify({ answers: {
        action: { type: 'choice', choice: 'choose', probabilities: { choose: 1, wait: 0 } },
        parameter_0_0: { type: 'choice', choice: 'one', probabilities: { one: 1 } },
      } })) });
      const result = await definition.evaluate(client, { state: {} });
      assert.strictEqual(result.decision.parameters.target, object);
      assert.equal(policies.gateChoice(result.evaluation.answers.action, { minProbability: 0.9 }).status, 'accepted');
      assert.equal(policies.gateChoice(result.decision.parameterAnswers.target, { minProbability: 0.9 }).status, 'accepted');
      assert.deepEqual(policies.gateBoolean({ type: 'boolean', probability: 0.5 }, { maxFalseProbability: 0.2, minTrueProbability: 0.8 }), { status: 'uncertain', reason: 'between-thresholds' });
      const report = await batch.evaluateMany(client, [{ id: 'one', request: { state: {}, questions: definition.questions } }]);
      assert.equal(report.items[0].status, 'fulfilled');
      assert.strictEqual(definition.resolve(report.items[0].value).parameters.target, object);
    }
    console.log('Installed tarball: ESM/CJS core, adapters, decisions, policies, and batch passed; optional imports remain isolated.');
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', smoke], { cwd: consumer, stdio: 'inherit' });
  const typeConsumer = `
    import { createSystemOne as createCore, type Transport } from '@system-one-ai/core';
    import { createFetchTransport } from '@system-one-ai/transport-fetch';
    import { systemOneAdapter } from '@system-one-ai/adapter-system-one';
    import { llmAdapter } from '@system-one-ai/adapter-llm';
    createCore({ apiKey: null, adapter: systemOneAdapter, transport: createFetchTransport() });
    createCore({ apiKey: 'fixture', adapter: llmAdapter(), transport: createFetchTransport(), model: 'llm' });
    // @ts-expect-error The core requires an explicit adapter.
    createCore({ apiKey: null, transport: createFetchTransport() });
    // @ts-expect-error The core requires an explicit transport.
    createCore({ apiKey: null, adapter: systemOneAdapter });
    // @ts-expect-error LLM is independently installed and has no root re-export.
    import { llmAdapter as removedLlm } from '@system-one-ai/sdk';
    void removedLlm;

    import { SystemOne, choice } from '@system-one-ai/sdk';
    import { vercelAdapter } from '@system-one-ai/sdk/adapters/vercel';
    import { openRouterAdapter } from '@system-one-ai/sdk/adapters/openrouter';
    import { cloudflareAdapter, type CloudflareAdapterOptions } from '@system-one-ai/sdk/adapters/cloudflare';
    import { choiceFrom, defineDecision } from '@system-one-ai/sdk/decisions';
    import { gateChoice } from '@system-one-ai/sdk/policies';
    import { evaluateMany } from '@system-one-ai/sdk/batch';
    // @ts-expect-error Optional adapters are not part of the core entry point.
    import { vercelAdapter as removedRootExport } from '@system-one-ai/sdk';
    // @ts-expect-error OpenRouter is an optional subpath, never a core export.
    import { openRouterAdapter as absentRootExport } from '@system-one-ai/sdk';
    // @ts-expect-error Cloudflare is only exported from its explicit subpath.
    import { cloudflareAdapter as absentCloudflare } from '@system-one-ai/sdk';
    const client = new SystemOne({apiKey: null});
    const target = choiceFrom({instructions:'Target',items:[{id:'lamp',on:false}],id:item=>item.id,describe:()=>null});
    const definition = defineDecision({instructions:'Action',actions:{
      select:{description:null,parameters:{target,mode:choice('Mode',{warm:null,cool:null})}},wait:{description:null},
    }});
    new SystemOne({apiKey: 'fixture', adapter: vercelAdapter});
    new SystemOne({apiKey: 'fixture', adapter: openRouterAdapter});
    const cloudflareOptions: CloudflareAdapterOptions = {accountId:'package-test-account'};
    const cloudflareClient = new SystemOne({apiKey:'fixture',adapter:cloudflareAdapter(cloudflareOptions)});
    // @ts-expect-error The factory's account ID is required in the installed declarations.
    cloudflareAdapter({});
    // @ts-expect-error The former protocol string must not silently persist in declarations.
    new SystemOne({apiKey: 'fixture', protocol: 'vercel'});
    void removedRootExport;
    void absentRootExport;
    void absentCloudflare;
    async function run() {
      const cf = await cloudflareClient.evaluate({state:'water',questions:{action:choice('Next?',{drink:null,rest:null})}});
      const cfAction: 'drink' | 'rest' = cf.answers.action.choice;
      // @ts-expect-error Cloudflare must preserve the same closed answer types.
      const invalidCFAction: 'fly' = cf.answers.action.choice;
      void [cfAction, invalidCFAction];
      const result = await client.evaluate({state:'water',questions:{action:choice('Next?',{drink:null,rest:null})}});
      const action: 'drink' | 'rest' = result.answers.action.choice;
      // @ts-expect-error The packaged declaration must retain the choice union.
      const invalid: 'fly' = result.answers.action.choice;
      const resolved = await definition.evaluate(client, {state:{}});
      if (resolved.decision.action === 'select') {
        const on: boolean = resolved.decision.parameters.target.on;
        const mode: 'warm' | 'cool' = resolved.decision.parameters.mode;
        const answer: 'warm' | 'cool' = resolved.decision.parameterAnswers.mode.choice;
        void [on, mode, answer];
      } else {
        // @ts-expect-error Branch narrowing must survive packed declarations.
        resolved.decision.parameters.target;
      }
      const outcome = gateChoice(resolved.evaluation.answers.action, {minProbability:0.9});
      if (outcome.status === 'accepted') { const action: 'select' | 'wait' = outcome.value; void action; }
      const report = await evaluateMany(client, [
        {id:'typed',request:{state:{},questions:{action:choice('Action',{run:null,stop:null})}}},
        {id:'compiled',request:{state:{},questions:definition.questions}},
      ]);
      const id: 'typed' = report.items[0].id;
      if (report.items[0].status === 'fulfilled') {
        const action: 'run' | 'stop' = report.items[0].value.answers.action.choice;
        // @ts-expect-error Per-item option unions remain closed.
        const invalid: 'fly' = report.items[0].value.answers.action.choice;
        void [action, invalid];
      }
      void id;
      return {action, invalid};
    }
    void run;
  `;
  await Promise.all(['consumer.mts', 'consumer.cts'].map(name => writeFile(path.join(consumer, name), typeConsumer)));
  await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: [], strict: true, noEmit: true, skipLibCheck: false }, include: ['consumer.mts', 'consumer.cts'] }));
  const require = createRequire(import.meta.url);
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', path.join(consumer, 'tsconfig.json')], { cwd: consumer, stdio: 'inherit' });
  await writeFile(path.join(artifacts, 'package-manifest.json'), JSON.stringify({
    name: pack.name, version: pack.version, filename: pack.filename, integrity: pack.integrity,
    packages: [...packs.values()].map(({ name, version, filename, integrity }) => ({ name, version, filename, integrity })),
  }, null, 2) + '\n');
  console.log(`Installed declarations: ESM and CommonJS type inference passed. Package: .artifacts/${pack.filename}`);
} finally {
  // Only the temporary consumer created by this script is removed. The tarball is retained.
  await rm(consumer, { recursive: true, force: true });
}
