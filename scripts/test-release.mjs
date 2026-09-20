// Real Changesets/build/pack/consumer rehearsal in a disposable checkout. Never publishes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import semver from 'semver';
import { root } from './workspaces.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'system-one-release-'));
const run = (program, args) => execFileSync(program, args, { cwd: directory, stdio: 'inherit', env: { ...process.env, HUSKY: '0' } });
const json = async file => JSON.parse(await readFile(path.join(directory, file), 'utf8'));
const tags = execFileSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
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
for (const tag of tags) run('git', ['tag', tag]);
run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
const stable = process.argv.includes('--stable');
if (stable) {
  const prerelease = await json('.changeset/pre.json');
  assert.ok(['pre', 'exit'].includes(prerelease.mode), 'Stable rehearsal needs an active prerelease.');
  if (prerelease.mode === 'pre') run('npm', ['run', 'changeset', '--', 'pre', 'exit']);
}
run('npm', ['run', 'version:packages']);
const plan = await json('.changeset/release.json');
assert.ok(plan.packages.length);
for (const pkg of plan.packages) {
  assert.ok(semver.valid(pkg.version));
  if (stable) assert.equal(semver.prerelease(pkg.version), null);
  const manifest = await json(`packages/${pkg.name.split('/')[1]}/package.json`);
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    const candidate = plan.packages.find(item => item.name === name);
    if (candidate) assert.ok(semver.satisfies(candidate.version, range));
    if (stable) assert.equal(semver.prerelease(semver.minVersion(range)), null);
  }
  assert.ok((await readFile(path.join(directory, `packages/${pkg.name.split('/')[1]}/CHANGELOG.md`), 'utf8')).includes(`## ${pkg.version}`));
}
run('git', ['add', '.']);
run('git', ['commit', '-qm', 'Version release candidates']);
run('npm', ['run', 'check']);
run('npm', ['run', 'test:package']);
run('node', ['scripts/release.mjs', 'prepare', '--dry-run']);
// A corrupted artifact must fail the production manifest verifier before any publication.
const release = await json('.artifacts/release-manifest.json');
const artifact = release.packages.find(pkg => pkg.filename);
assert.ok(artifact?.filename, 'Release rehearsal did not produce a package tarball.');
const tarball = path.join(directory, '.artifacts', artifact.filename);
const original = await readFile(tarball);
await writeFile(tarball, Buffer.concat([original, Buffer.from('tampered')]));
assert.throws(() => execFileSync('node', ['scripts/release.mjs', 'verify'], { cwd: directory, stdio: 'pipe' }), error => String(error.stderr).includes('Tested tarball has changed'));
await writeFile(tarball, original);
run('node', ['scripts/release.mjs', 'verify']);
assert.throws(() => execFileSync('node', ['scripts/release.mjs', 'publish'], { cwd: directory, stdio: 'pipe' }), error => String(error.stderr).includes('Dry-run manifest cannot be published'));
assert.throws(() => execFileSync('node', ['scripts/release.mjs', 'finalize'], { cwd: directory, stdio: 'pipe' }), error => String(error.stderr).includes('Dry-run manifest cannot be published'));
console.log(`Release rehearsal passed. Retained ${stable ? 'stable' : 'candidate'} artifacts for optional live tests: ${directory}/.artifacts`);
