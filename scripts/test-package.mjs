import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildOrder, root } from './workspaces.mjs';
import { pathToFileURL } from 'node:url';

export const artifacts = path.join(root, '.artifacts');
export const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest(algorithm === 'sha512' ? 'base64' : 'hex');
const run = (command, args, cwd = root) => {
  // Windows cannot execFile npm.cmd directly. Invoke npm's JS entry without a
  // shell so package paths and arguments retain their original boundaries.
  if (command === 'npm' && process.platform === 'win32') {
    const npmCli = process.env.npm_execpath?.endsWith('npm-cli.js')
      ? process.env.npm_execpath
      : path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
  }
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
};
export async function sourceIdentity() {
  return {
    commit: run('git', ['rev-parse', 'HEAD']).trim(),
    lockSha256: digest(await readFile(path.join(root, 'package-lock.json'))),
    dirty: Boolean(run('git', ['status', '--porcelain', '--untracked-files=normal']).trim()),
  };
}

/** Install exact artifacts or registry versions outside the repository's workspace links. */
export async function withConsumer(packages, check) {
  const consumer = await mkdtemp(path.join(tmpdir(), 'system-one-consumer-'));
  try {
    await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    const specs = packages.map(pkg => pkg.filename ? path.join(artifacts, pkg.filename) : `${pkg.name}@${pkg.version}`);
    run('npm', ['install', ...specs, '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/', ...(packages.every(pkg => pkg.filename) ? ['--offline'] : [])], consumer);
    const lock = JSON.parse(await readFile(path.join(consumer, 'package-lock.json'), 'utf8'));
    for (const pkg of packages) {
      const installed = lock.packages[`node_modules/${pkg.name}`];
      assert.equal(installed?.version, pkg.version, `Wrong installed version: ${pkg.name}`);
      assert.equal(installed.integrity, pkg.integrity, `Wrong installed bytes: ${pkg.name}`);
    }
    run('npm', ['ls', '--all'], consumer);
    return await check(consumer);
  } finally { await rm(consumer, { recursive: true, force: true }); }
}

export async function testPackages(packages) {
  const items = packages.map(pkg => ({ directory: pkg.name.split('/')[1], manifest: pkg }));
  for (const pkg of packages) {
    const closure = buildOrder(pkg.name, items).map(item => item.manifest);
    await withConsumer(closure, async consumer => {
      await copyFile(path.join(root, 'tests/package-contracts.mjs'), path.join(consumer, 'contract.mjs'));
      run(process.execPath, ['contract.mjs', pkg.name.split('/')[1]], consumer);
      for (const extension of ['mts', 'cts']) await writeFile(path.join(consumer, `consumer.${extension}`), `import * as pkg from '${pkg.name}'; void pkg;`);
      run(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.mts', 'consumer.cts'], consumer);
    });
  }
  await withConsumer(packages, async consumer => {
    const names = new Set(packages.map(pkg => pkg.name));
    let fixtures = 0;
    for (const file of await readdir(path.join(root, 'tests/types'))) {
      if (!file.endsWith('.ts')) continue;
      const source = await readFile(path.join(root, 'tests/types', file), 'utf8');
      const imports = [...source.matchAll(/['"](@system-one-ai\/[^/'"]+)(?:\/[^'"]+)?['"]/g)];
      if (!imports.every(([, name]) => names.has(name))) continue;
      for (const extension of ['mts', 'cts']) await writeFile(path.join(consumer, file.replace(/ts$/, extension)), source);
      fixtures++;
    }
    if (fixtures) {
      await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: [], strict: true,
        noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: false,
      }, include: ['*.mts', '*.cts'] }));
      run(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer);
    }
  });
  console.log(`${packages.length} packages passed isolated ESM/CJS contracts and declaration checks (${process.version}).`);
}

async function packAndTest() {
  await mkdir(artifacts, { recursive: true });
  await rm(path.join(artifacts, 'package-manifest.json'), { force: true });
  const packages = [];
  for (const workspace of buildOrder()) {
    const [packed] = JSON.parse(run('npm', ['pack', '.', '--ignore-scripts', '--pack-destination', artifacts, '--json'], workspace.cwd));
    for (const required of ['LICENSE', 'dist/esm/index.js', 'dist/cjs/index.js', 'dist/esm/index.d.ts', 'dist/cjs/index.d.ts']) {
      assert.ok(packed.files.some(file => file.path === required), `${packed.name} is missing ${required}`);
    }
    assert.ok(packed.files.every(file => /^(dist\/|README\.md$|CHANGELOG\.md$|LICENSE$|package\.json$)/.test(file.path)), 'Unexpected file in package');
    const { name, version, filename, integrity } = packed;
    packages.push({ name, version, filename, integrity, dependencies: workspace.manifest.dependencies ?? {} });
  }
  await testPackages(packages);
  await writeFile(path.join(artifacts, 'package-manifest.json'), JSON.stringify({
    source: await sourceIdentity(), node: process.version, npm: run('npm', ['--version']).trim(),
    testedAt: new Date().toISOString(), packages,
  }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await packAndTest();
