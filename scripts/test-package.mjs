import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildOrder } from './workspaces.mjs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, '.artifacts');
await mkdir(artifacts, { recursive: true });
await rm(path.join(artifacts, 'package-manifest.json'), { force: true });
const packs = new Map();
for (const workspace of buildOrder()) {
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '.', '--ignore-scripts', '--pack-destination', artifacts, '--json'], { cwd: workspace.cwd, encoding: 'utf8' }));
  for (const required of ['LICENSE', 'dist/esm/index.js', 'dist/cjs/index.js', 'dist/esm/index.d.ts', 'dist/cjs/index.d.ts']) {
    assert.ok(packed.files.some(file => file.path === required), `${packed.name} is missing ${required}`);
  }
  assert.ok(packed.files.every(file => /^(dist\/|README\.md$|LICENSE$|package\.json$)/.test(file.path)), 'Unexpected file in package');
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
const consumer = await mkdtemp(path.join(tmpdir(), 'system-one-types-'));
try {
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', ...tarballs([...packs.keys()]), '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: consumer, stdio: 'pipe' });
  // The same inference and negative checks must pass against installed declarations.
  for (const file of await readdir(path.join(root, 'tests/types'))) {
    if (!file.endsWith('.ts')) continue;
    const source = await readFile(path.join(root, 'tests/types', file), 'utf8');
    for (const extension of ['mts', 'cts']) await writeFile(path.join(consumer, file.replace(/ts$/, extension)), source);
  }
  await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: [], strict: true,
    noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: false,
  }, include: ['*.mts', '*.cts'] }));
  execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: consumer, stdio: 'inherit' });
  await writeFile(path.join(artifacts, 'package-manifest.json'), JSON.stringify({
    packages: [...packs.values()].map(({ name, version, filename, integrity }) => ({ name, version, filename, integrity })),
  }, null, 2) + '\n');
  console.log('All workspace tarballs passed isolated ESM/CJS contracts and declaration inference checks.');
} finally {
  await rm(consumer, { recursive: true, force: true });
}
