import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildOrder } from './workspaces.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = 'ziyu/sytem-one-sdk';
const registry = 'https://registry.npmjs.org/';
const readJSON = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const run = (program, args, options = {}) => execFileSync(program, args, { cwd: root, encoding: 'utf8', ...options });

/** Pure release guard, also used by offline tests. No version or tag is created automatically. */
export function validateRelease(tag, manifest, lock) {
  assert.equal(typeof tag, 'string', 'RELEASE_TAG is required.');
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(tag);
  assert.ok(match, 'Use a semantic version tag such as v0.3.0 or v0.4.0-rc.1.');
  if (match[4]) {
    assert.ok(match[4].split('.').every(part => !/^\d+$/.test(part) || part === '0' || !part.startsWith('0')), 'Numeric prerelease identifiers cannot have leading zeros.');
  }
  assert.equal(manifest.name, '@system-one-ai/sdk', 'Unexpected npm package.');
  assert.equal(tag, `v${manifest.version}`, 'Tag must exactly match package.json version.');
  assert.equal(lock.name, manifest.name, 'Lockfile package name differs.');
  assert.equal(lock.version, manifest.version, 'Lockfile version differs.');
  assert.equal(lock.packages?.['']?.name, manifest.name, 'Lockfile root name differs.');
  assert.equal(lock.packages?.['']?.version, manifest.version, 'Lockfile root version differs.');
  assert.notEqual(manifest.private, true, 'A private package cannot be published.');
  assert.equal(manifest.license, 'MIT', 'Release must include the MIT license.');
  assert.equal(manifest.publishConfig?.access, 'public', 'Release must be public.');
  assert.equal(manifest.publishConfig?.registry, registry, 'Release must target the public npm registry.');
  assert.equal(manifest.repository?.url, `git+https://github.com/${repository}.git`, 'Repository metadata must match the trusted publisher.');
  return {
    name: manifest.name, version: manifest.version, tag,
    prerelease: Boolean(match[4]), npmTag: match[4] ? 'next' : 'latest',
    filename: `system-one-ai-sdk-${manifest.version}.tgz`,
  };
}

/** An existing version is reusable only when it is the same verified tarball. */
export function registryState(metadata, artifact) {
  if (metadata === null) return 'missing';
  assert.equal(metadata.name, artifact.name, 'Registry returned another package.');
  assert.equal(metadata.version, artifact.version, 'Registry returned another version.');
  assert.equal(metadata.dist?.integrity, artifact.integrity, 'This version already exists with different package contents; do not overwrite or reuse it.');
  return 'identical';
}

/** The SDK facade must not be published before its independently released dependencies. */
export function testedDependency(name, version, packages) {
  const artifact = packages?.find(item => item.name === name && item.version === version);
  assert.ok(artifact?.integrity, `Build and test ${name}@${version} before publishing the SDK.`);
  return artifact;
}

async function sourceRelease() {
  const release = validateRelease(process.env.RELEASE_TAG, await readJSON('../package.json'), await readJSON('../package-lock.json'));
  if (process.env.GITHUB_REPOSITORY) assert.equal(process.env.GITHUB_REPOSITORY, repository, 'Wrong GitHub repository.');
  const commit = run('git', ['rev-parse', 'HEAD']).trim();
  const taggedCommit = run('git', ['rev-parse', '--verify', `refs/tags/${release.tag}^{commit}`]).trim();
  assert.equal(commit, taggedCommit, 'Checkout must be the exact tagged commit.');
  run('git', ['merge-base', '--is-ancestor', commit, 'origin/main']);
  assert.equal(run('git', ['status', '--porcelain', '--untracked-files=no']).trim(), '', 'Tracked source must be clean.');
  return { ...release, commit };
}

async function testedArtifact(release) {
  // test-package writes this receipt only after installation and type checks have passed.
  const tested = await readJSON('../.artifacts/package-manifest.json');
  assert.equal(tested.name, release.name);
  assert.equal(tested.version, release.version);
  assert.equal(tested.filename, release.filename);
  const bytes = await readFile(new URL(`../.artifacts/${release.filename}`, import.meta.url));
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.equal(tested.integrity, integrity, 'The tested package has changed.');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(new URL('../.artifacts/SHA256SUMS', import.meta.url), `${sha256}  ${release.filename}\n`);
  return { ...release, integrity, sha256 };
}

async function getJSON(url, headers = {}) {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  assert.ok(response.ok, `Metadata lookup failed with HTTP ${response.status}.`);
  return response.json();
}

function versionURL(release) {
  return `${registry}${release.name.replace('/', '%2F')}/${release.version}`;
}

async function publish(release) {
  const artifact = await testedArtifact(release);
  const manifest = await readJSON('../package.json');
  const receipt = await readJSON('../.artifacts/package-manifest.json');
  const dependencies = new Map();
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    for (const workspace of buildOrder(name)) dependencies.set(workspace.manifest.name, workspace.manifest.version);
  }
  for (const [name, version] of dependencies) {
    const dependency = testedDependency(name, version, receipt.packages);
    const metadata = await getJSON(versionURL(dependency));
    assert.equal(registryState(metadata, dependency), 'identical', `Publish and verify ${name}@${version} before releasing the SDK.`);
  }
  const existing = await getJSON(versionURL(release));
  if (registryState(existing, artifact) === 'missing') {
    // npm obtains a short-lived credential from GitHub OIDC; no stored npm token is used.
    run('npm', ['publish', `.artifacts/${artifact.filename}`, '--ignore-scripts', '--access=public', `--tag=${artifact.npmTag}`, '--provenance'], { stdio: 'inherit' });
  } else {
    console.log(`${artifact.name}@${artifact.version} already contains this exact package; resuming the release.`);
  }
  let confirmed = false;
  // npm can accept a publish before asynchronous processing exposes its metadata.
  // Allow five minutes of polling delays; never repeat npm publish while waiting.
  const verificationAttempts = 61;
  for (let attempt = 0; attempt < verificationAttempts; attempt++) {
    const metadata = await getJSON(versionURL(release));
    if (registryState(metadata, artifact) === 'identical') { confirmed = true; break; }
    if (attempt % 12 === 0) console.log(`npm accepted the package; waiting for public metadata (${attempt + 1}/${verificationAttempts}).`);
    if (attempt < verificationAttempts - 1) await delay(5000);
  }
  assert.ok(confirmed, 'npm has not exposed the published version yet. Once the version is publicly readable, rerun this workflow to verify it and finish the GitHub Release.');
  await writeFile(new URL('../.artifacts/release-manifest.json', import.meta.url), JSON.stringify({ ...artifact, npmVerified: true }, null, 2) + '\n');
  console.log(`Verified ${artifact.name}@${artifact.version} on npm with matching SHA-512 integrity.`);
}

async function githubRelease(release) {
  const artifact = await testedArtifact(release);
  const published = await readJSON('../.artifacts/release-manifest.json');
  assert.equal(published.npmVerified, true, 'Verify npm publication first.');
  assert.equal(published.integrity, artifact.integrity);
  assert.equal(published.commit, release.commit);
  assert.ok(process.env.GH_TOKEN, 'GitHub Release requires the job-scoped GH_TOKEN.');
  const existing = await getJSON(`https://api.github.com/repos/${repository}/releases/tags/${release.tag}`, {
    authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json',
  });
  const assets = [`.artifacts/${artifact.filename}`, '.artifacts/SHA256SUMS'];
  if (existing) {
    assert.equal(existing.tag_name, release.tag);
    // All assets have just been checked against the immutable npm version.
    run('gh', ['release', 'upload', release.tag, ...assets, '--clobber', '--repo', repository], { stdio: 'inherit' });
    if (existing.draft) run('gh', ['release', 'edit', release.tag, '--draft=false', '--repo', repository], { stdio: 'inherit' });
  } else {
    const notes = `Install with \`npm install ${release.name}@${release.version}\`.\n\nThe attached tarball is the same package verified on npm. SHA256SUMS records its checksum.\n`;
    await writeFile(new URL('../.artifacts/release-notes.md', import.meta.url), notes);
    run('gh', [
      'release', 'create', release.tag, ...assets, '--verify-tag', '--title', release.tag,
      '--generate-notes', '--notes-file', '.artifacts/release-notes.md', '--repo', repository,
      ...(release.prerelease ? ['--prerelease', '--latest=false'] : []),
    ], { stdio: 'inherit' });
  }
  console.log(`GitHub Release ready: https://github.com/${repository}/releases/tag/${release.tag}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv[2];
    assert.ok(['validate', 'publish', 'github'].includes(command), 'Use release.mjs validate, publish, or github.');
    const release = await sourceRelease();
    if (command === 'validate') console.log(JSON.stringify(release, null, 2));
    if (command === 'publish') await publish(release);
    if (command === 'github') await githubRelease(release);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release failed.');
    process.exitCode = 1;
  }
}
