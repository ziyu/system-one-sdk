// Real Changesets/build/pack/consumer rehearsal in a disposable checkout. Never publishes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { root } from './workspaces.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'system-one-release-'));
const run = (program, args) => execFileSync(program, args, { cwd: directory, stdio: 'inherit', env: { ...process.env, HUSKY: '0' } });
const json = async file => JSON.parse(await readFile(path.join(directory, file), 'utf8'));
console.log(`Release rehearsal: ${directory}`);
// Copy tracked and untracked source without secrets, generated output or workspace links.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of files) {
  await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
  await cp(path.join(root, file), path.join(directory, file));
}
run('git', ['init', '-q']);
run('git', ['config', 'user.name', 'Release rehearsal']);
run('git', ['config', 'user.email', 'rehearsal@example.invalid']);
run('git', ['add', '.']);
run('git', ['commit', '-qm', 'Release rehearsal source']);
run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
run('npm', ['run', 'version:packages']);
const plan = await json('.changeset/release.json');
assert.equal(plan.packages.length, 11);
for (const pkg of plan.packages) {
  assert.equal(pkg.version, '0.6.0-rc.0');
  const manifest = await json(`packages/${pkg.name.split('/')[1]}/package.json`);
  for (const version of Object.values(manifest.dependencies ?? {})) assert.equal(version, '^0.6.0-rc.0');
  assert.ok((await readFile(path.join(directory, `packages/${pkg.name.split('/')[1]}/CHANGELOG.md`), 'utf8')).includes('## 0.6.0-rc.0'));
}
run('git', ['add', '.']);
run('git', ['commit', '-qm', 'Version RC candidates']);
run('npm', ['run', 'check']);
run('npm', ['run', 'test:package']);
run('node', ['scripts/release.mjs', 'prepare', '--dry-run']);
// A corrupted artifact must fail the production manifest verifier before any publication.
const release = await json('.artifacts/release-manifest.json');
const tarball = path.join(directory, '.artifacts', release.packages[0].filename);
const original = await readFile(tarball);
await writeFile(tarball, Buffer.concat([original, Buffer.from('tampered')]));
assert.throws(() => execFileSync('node', ['scripts/release.mjs', 'verify'], { cwd: directory, stdio: 'pipe' }), error => String(error.stderr).includes('Tested tarball has changed'));
await writeFile(tarball, original);
run('node', ['scripts/release.mjs', 'verify']);
assert.throws(() => execFileSync('node', ['scripts/release.mjs', 'publish'], { cwd: directory, stdio: 'pipe' }), error => String(error.stderr).includes('Dry-run manifest cannot be published'));
// Stable transition is generated and checked separately; restore the RC checkout afterward.
run('npm', ['run', 'changeset', '--', 'pre', 'exit']);
run('npm', ['run', 'version:packages']);
for (const pkg of (await json('.changeset/release.json')).packages) {
  assert.equal(pkg.version, '0.6.0');
  const manifest = await json(`packages/${pkg.name.split('/')[1]}/package.json`);
  for (const version of Object.values(manifest.dependencies ?? {})) assert.equal(version, '^0.6.0');
}
run('git', ['restore', '.']);
console.log(`Release rehearsal passed. Retained RC artifacts for optional live tests: ${directory}/.artifacts`);
