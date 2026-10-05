// Explicit opt-in: the same live scenarios run against isolated candidate or npm-installed bytes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root, workspaces } from './workspaces.mjs';
import { artifacts, digest, sourceIdentity, withConsumer } from './test-package.mjs';

const fromRegistry = process.argv.includes('--registry');
const [nativeEnv, llmEnv] = process.argv.slice(2).filter(arg => arg !== '--registry');
assert.ok(nativeEnv, 'Usage: test-release-live.mjs /path/to/typesafe.env [/path/to/llm.env] [--registry]');
const bytes = await readFile(path.join(artifacts, 'release-manifest.json'));
const manifest = JSON.parse(bytes);
assert.deepEqual(await sourceIdentity(), manifest.source, 'Live tests must use the frozen candidate checkout.');
const packages = fromRegistry ? manifest.packages.map(({ filename, ...pkg }) => pkg) : manifest.packages;
// Live scenarios may use an unchanged provider. Install its exact published version without
// adding it to the upload batch or rewriting its dependency range to the new core generation.
const supportingPackages = [];
for (const name of ['@system-one-ai/adapter-system-one', '@system-one-ai/policies', ...(llmEnv ? ['@system-one-ai/adapter-llm'] : [])]) {
  if (packages.some(pkg => pkg.name === name)) continue;
  const version = workspaces.find(workspace => workspace.manifest.name === name)?.manifest.version;
  assert.ok(version, `Unknown live scenario dependency ${name}.`);
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, `Cannot install unchanged live provider ${name}@${version}.`);
  const metadata = await response.json();
  assert.equal(metadata.name, name);
  assert.equal(metadata.version, version);
  assert.ok(metadata.dist?.integrity);
  supportingPackages.push({ name, version, integrity: metadata.dist.integrity, dependencies: metadata.dependencies ?? {} });
}
const startedAt = new Date().toISOString();
const reports = await withConsumer([...packages, ...supportingPackages], async consumer => {
  await mkdir(path.join(consumer, 'scripts'));
  const reports = [];
  const checks = [
    ['test-live.mjs', nativeEnv, 'live-typesafe.json'],
    ['test-composition-live.mjs', nativeEnv, 'live-composition.json'],
    ...(llmEnv ? [['test-llm-live.mjs', llmEnv, 'live-llm.json']] : []),
  ];
  for (const [script, env, report] of checks) {
    await copyFile(path.join(root, 'scripts', script), path.join(consumer, 'scripts', script));
    execFileSync(process.execPath, [path.join(consumer, 'scripts', script), path.resolve(env)], { cwd: consumer, stdio: 'inherit' });
    reports.push({ scenario: script, result: JSON.parse(await readFile(path.join(consumer, '.artifacts', report), 'utf8')) });
  }
  return reports;
});
await writeFile(path.join(artifacts, 'release-live.json'), JSON.stringify({
  status: 'passed', source: manifest.source, manifestSha256: digest(bytes), fromRegistry,
  startedAt, completedAt: new Date().toISOString(), node: process.version,
  packages: packages.map(({ name, version, integrity }) => ({ name, version, integrity })),
  supportingPackages: supportingPackages.map(({ name, version, integrity }) => ({ name, version, integrity })), reports,
}, null, 2) + '\n');
console.log('Frozen release live checks passed: .artifacts/release-live.json');
