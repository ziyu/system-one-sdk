import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import { buildOrder, root, workspaces } from './workspaces.mjs';
import { artifacts, digest, sourceIdentity, testPackages } from './test-package.mjs';

const repository = 'ziyu/sytem-one-sdk';
const registry = 'https://registry.npmjs.org/';
const run = (program, args) => execFileSync(program, args, { cwd: root, encoding: 'utf8' });
const readJSON = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const save = async (file, value) => writeFile(path.join(artifacts, file), JSON.stringify(value, null, 2) + '\n');
const versionURL = pkg => `${registry}${encodeURIComponent(pkg.name)}/${pkg.version}`;
const ordered = packages => buildOrder(undefined, packages.map(manifest => ({ manifest }))).map(item => item.manifest);
const internal = name => name.startsWith('@system-one-ai/');
const releases = manifest => ordered(manifest.packages).filter(pkg => pkg.filename);
const stable = pkg => !semver.prerelease(pkg.version);

/** Pick one stable package release as the repository-level GitHub Latest marker. */
export function canonicalRelease(packages) {
  return [...packages].filter(pkg => pkg.filename && stable(pkg)).sort((a, b) =>
    semver.rcompare(a.version, b.version) ||
    (a.name === '@system-one-ai/core' ? -1 : b.name === '@system-one-ai/core' ? 1 : a.name.localeCompare(b.name))
  )[0];
}

export function validateVerification(manifest, receipt, manifestSha256) {
  assert.equal(receipt.status, 'passed', 'Registry verification has not passed.');
  assert.equal(receipt.commit, manifest.source.commit, 'Registry verification belongs to another commit.');
  assert.equal(receipt.manifestSha256, manifestSha256, 'Registry verification belongs to another artifact set.');
  assert.deepEqual(receipt.packages, ordered(manifest.packages).map(({ name, version, integrity }) => ({ name, version, integrity })), 'Registry verification package integrities differ.');
}

export function validatePackage(manifest, lock) {
  const directory = manifest.name?.replace('@system-one-ai/', '');
  assert.ok(workspaces.some(item => item.directory === directory), 'Unknown workspace.');
  assert.ok(semver.valid(manifest.version) === manifest.version && !manifest.version.includes('+'), 'Invalid release version.');
  assert.equal(lock.packages?.[`packages/${directory}`]?.version, manifest.version, 'Lockfile version differs.');
  assert.equal(manifest.repository?.directory, `packages/${directory}`);
  assert.equal(manifest.repository?.url, `git+https://github.com/${repository}.git`);
  assert.notEqual(manifest.private, true, 'Cannot publish a private package.');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.publishConfig?.access, 'public');
  assert.equal(manifest.publishConfig?.registry, registry);
  return { name: manifest.name, version: manifest.version, dependencies: manifest.dependencies ?? {},
    filename: `system-one-ai-${directory}-${manifest.version}.tgz`, tag: `${directory}-v${manifest.version}` };
}

export function registryState(metadata, artifact) {
  if (metadata === null) return 'missing';
  assert.equal(metadata.name, artifact.name, 'Registry returned another package.');
  assert.equal(metadata.version, artifact.version, 'Registry returned another version.');
  assert.equal(metadata.dist?.integrity, artifact.integrity, 'Version already exists with different contents. Use a new version.');
  return 'identical';
}

/** Resolve one shared version per internal dependency, including its declared minimum. */
export async function resolveGraph(roots, candidates, lookup, minimum = false) {
  let selected = new Map(roots.map(pkg => [pkg.name, pkg]));
  for (let pass = 0; pass < 50; pass++) {
    const ranges = new Map();
    for (const pkg of selected.values()) for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
      assert.ok(internal(name), `Add explicit artifact verification for external runtime dependency ${name} before releasing it.`);
      assert.ok(semver.validRange(range), `Invalid dependency range: ${name} ${range}`);
      ranges.set(name, [...(ranges.get(name) ?? []), range]);
    }
    const next = new Map(roots.map(pkg => [pkg.name, pkg]));
    for (const [name, requirements] of ranges) {
      const fits = pkg => requirements.every(range => semver.satisfies(pkg.version, range));
      if (next.has(name)) { assert.ok(fits(next.get(name)), `Batch version does not satisfy ${name} ${requirements}`); continue; }
      const candidate = candidates.find(pkg => pkg.name === name && fits(pkg));
      if (candidate && (!minimum || requirements.some(range => semver.eq(semver.minVersion(range), candidate.version)))) {
        next.set(name, candidate); continue;
      }
      const metadata = await lookup(name);
      const versions = Object.values(metadata?.versions ?? {}).filter(fits).map(pkg => ({
        name: pkg.name, version: pkg.version, dependencies: pkg.dependencies ?? {}, integrity: pkg.dist?.integrity,
      }));
      if (candidate) versions.push(candidate);
      versions.sort((a, b) => semver.compare(a.version, b.version));
      const chosen = versions[0];
      assert.ok(chosen?.integrity, `No published dependency satisfies ${name} ${requirements}`);
      next.set(name, chosen);
    }
    if (JSON.stringify([...next]) === JSON.stringify([...selected])) return ordered([...next.values()]);
    selected = next;
  }
  throw new Error('Dependency resolution did not converge. Check dependency ranges/cycles.');
}

async function getJSON(url, headers = {}) {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  assert.ok(response.ok, `Metadata lookup failed with HTTP ${response.status}.`);
  return response.json();
}

async function sourceGuard(source, dryRun) {
  assert.deepEqual(await sourceIdentity(), source, 'Source/lockfile changed since packaging.');
  if (dryRun) return;
  assert.equal(source.dirty, false, 'Release source must be clean, including untracked files.');
  if (process.env.GITHUB_REPOSITORY) assert.equal(process.env.GITHUB_REPOSITORY, repository);
  if (process.env.RELEASE_COMMIT) assert.equal(source.commit, process.env.RELEASE_COMMIT);
  run('git', ['merge-base', '--is-ancestor', source.commit, 'origin/main']);
}

async function verifyFiles(packages) {
  for (const pkg of packages) {
    assert.ok(/^@system-one-ai\/[a-z-]+$/.test(pkg.name) && semver.valid(pkg.version), 'Invalid manifest package.');
    assert.ok(/^sha512-[A-Za-z0-9+/]+=*$/.test(pkg.integrity), 'Missing package integrity.');
    if (!pkg.filename) continue;
    assert.equal(pkg.filename, `system-one-ai-${pkg.name.split('/')[1]}-${pkg.version}.tgz`, 'Invalid artifact path.');
    const bytes = await readFile(path.join(artifacts, pkg.filename));
    assert.equal(`sha512-${digest(bytes, 'sha512')}`, pkg.integrity, 'Tested tarball has changed.');
    if (pkg.sha256) assert.equal(digest(bytes), pkg.sha256, 'Tarball SHA-256 differs.');
    const packed = JSON.parse(run('tar', ['-xOf', path.join(artifacts, pkg.filename), 'package/package.json']));
    assert.equal(packed.name, pkg.name);
    assert.equal(packed.version, pkg.version);
    assert.deepEqual(packed.dependencies ?? {}, pkg.dependencies, 'Tarball dependency metadata differs.');
  }
}

async function prepare(dryRun) {
  const receipt = await readJSON('.artifacts/package-manifest.json');
  await sourceGuard(receipt.source, dryRun);
  const plan = await readJSON('.changeset/release.json');
  assert.ok(plan.packages?.length, 'No versioned Release PR batch. Run version:packages in the Release PR.');
  assert.equal(new Set(plan.packages.map(pkg => pkg.name)).size, plan.packages.length, 'Duplicate package.');
  const lock = await readJSON('package-lock.json');
  const packages = [];
  for (const expected of plan.packages) {
    const workspace = workspaces.find(item => item.manifest.name === expected.name);
    assert.ok(workspace && workspace.manifest.version === expected.version, 'Release PR version differs from source.');
    const pkg = validatePackage(workspace.manifest, lock);
    const tested = receipt.packages.find(item => item.name === pkg.name && item.version === pkg.version);
    assert.ok(tested, `Missing tested artifact: ${pkg.name}`);
    assert.deepEqual(tested.dependencies, pkg.dependencies);
    const changelog = await readFile(path.join(workspace.cwd, 'CHANGELOG.md'), 'utf8');
    const notes = changelog.split(`## ${pkg.version}\n`)[1]?.split(/\n## /)[0]?.trim();
    assert.ok(notes, `Missing generated changelog for ${pkg.name}@${pkg.version}`);
    packages.push({ ...pkg, integrity: tested.integrity, sha256: digest(await readFile(path.join(artifacts, pkg.filename))), notes });
  }
  await verifyFiles(packages);
  const cache = new Map();
  const lookup = async name => {
    if (!cache.has(name)) cache.set(name, await getJSON(`${registry}${encodeURIComponent(name)}`));
    return cache.get(name);
  };
  const resolved = await resolveGraph(packages, packages, lookup);
  await testPackages(resolved);
  const minimums = [];
  for (const pkg of packages) {
    const graph = await resolveGraph([pkg], packages, lookup, true);
    // Normal closure already tests identical lower bounds. Only test distinct selections again.
    if (graph.every(dep => resolved.some(item => item.name === dep.name && item.version === dep.version))) continue;
    await testPackages(graph);
    minimums.push(graph);
  }
  const manifest = {
    schema: 1, dryRun, source: receipt.source,
    planSha256: digest(await readFile(path.join(root, '.changeset/release.json'))),
    toolchain: { node: receipt.node, npm: receipt.npm }, preparedAt: new Date().toISOString(),
    verification: { receipt: 'package-manifest.json', receiptSha256: digest(await readFile(path.join(artifacts, 'package-manifest.json'))), contracts: 'passed', minimumDependencies: 'passed',
      ...(process.env.GITHUB_RUN_ID ? { workflowRun: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` } : {}),
    },
    packages: resolved, minimums,
  };
  await save('release-manifest.json', manifest);
  await writeFile(path.join(artifacts, 'SHA256SUMS'), packages.map(pkg => `${pkg.sha256}  ${pkg.filename}\n`).join(''));
  console.log(`Frozen ${packages.length} releases and ${resolved.length - packages.length} registry dependencies${dryRun ? ' (dry-run; publication disabled)' : ''}.`);
}

async function loadManifest(publishing = false) {
  const manifest = await readJSON('.artifacts/release-manifest.json');
  assert.equal(manifest.schema, 1);
  assert.equal(typeof manifest.dryRun, 'boolean');
  if (publishing) assert.equal(manifest.dryRun, false, 'Dry-run manifest cannot be published.');
  await sourceGuard(manifest.source, manifest.dryRun);
  assert.equal(manifest.planSha256, digest(await readFile(path.join(root, '.changeset/release.json'))), 'Release plan changed.');
  assert.equal(manifest.verification?.contracts, 'passed');
  assert.equal(manifest.verification?.minimumDependencies, 'passed');
  assert.equal(manifest.verification.receiptSha256, digest(await readFile(path.join(artifacts, 'package-manifest.json'))));
  const plan = await readJSON('.changeset/release.json');
  const receipt = await readJSON('.artifacts/package-manifest.json');
  const releases = manifest.packages.filter(pkg => pkg.filename);
  assert.deepEqual(releases.map(({ name, version }) => ({ name, version })).sort((a, b) => a.name.localeCompare(b.name)),
    [...plan.packages].sort((a, b) => a.name.localeCompare(b.name)), 'Manifest does not match the Release PR batch.');
  assert.equal(new Set(manifest.packages.map(pkg => pkg.name)).size, manifest.packages.length);
  for (const pkg of releases) {
    const tested = receipt.packages.find(item => item.name === pkg.name && item.version === pkg.version);
    assert.equal(pkg.integrity, tested?.integrity, 'Manifest bytes differ from the tested receipt.');
    const expected = validatePackage(workspaces.find(item => item.manifest.name === pkg.name)?.manifest ?? {}, await readJSON('package-lock.json'));
    for (const key of Object.keys(expected)) assert.deepEqual(pkg[key], expected[key], `Manifest field differs: ${key}`);
  }
  for (const graph of [manifest.packages, ...manifest.minimums]) {
    await verifyFiles(graph);
    for (const pkg of graph) for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
      assert.ok(graph.some(dep => dep.name === name && semver.satisfies(dep.version, range)), `Unresolved dependency: ${name}`);
    }
    ordered(graph); // Cycle guard.
  }
  return manifest;
}

/** Effects are injected only here so failure/resume is tested without publishing packages. */
export async function publishBatch(manifest, effects) {
  assert.equal(manifest.dryRun, false, 'Dry-run manifest cannot be published.');
  const packages = ordered(manifest.packages);
  const states = new Map();
  // Preflight the entire batch before the first mutation, including immutable existing dependencies.
  for (const pkg of packages) {
    const state = registryState(await effects.metadata(pkg), pkg);
    if (!pkg.filename) assert.equal(state, 'identical', `Published dependency disappeared: ${pkg.name}`);
    states.set(pkg.name, state);
  }
  for (const pkg of packages.filter(pkg => pkg.filename)) {
    if (states.get(pkg.name) === 'missing') await effects.publish(pkg);
    await effects.confirm(pkg);
  }
  await effects.verify(packages.map(({ filename, ...pkg }) => pkg));
}

/** Separate from uploads: the protected finalization job runs only after registry acceptance. */
export async function finalizeBatch(manifest, effects) {
  assert.equal(manifest.dryRun, false, 'Dry-run manifest cannot be finalized.');
  await effects.accept();
  const packages = releases(manifest);
  for (const pkg of ordered(manifest.packages)) {
    assert.equal(registryState(await effects.metadata(pkg), pkg), 'identical', 'Verified registry version disappeared.');
  }
  const latestVersion = async pkg => {
    const latest = await effects.latest(pkg.name);
    assert.ok(!latest || semver.valid(latest), `Invalid latest for ${pkg.name}.`);
    assert.ok(!latest || !semver.prerelease(latest) || semver.lt(latest, pkg.version), `Newer prerelease occupies latest for ${pkg.name}; resolve the channel explicitly.`);
    return latest;
  };
  // Check every target before any writes, then re-read immediately before each promotion.
  for (const pkg of packages.filter(stable)) await latestVersion(pkg);
  for (const pkg of packages.filter(stable)) {
    const latest = await latestVersion(pkg);
    if (!latest || semver.lt(latest, pkg.version)) await effects.promote(pkg);
  }
  const tags = [];
  for (const pkg of packages.filter(stable)) {
    const latest = await latestVersion(pkg);
    assert.ok(latest && semver.gte(latest, pkg.version), `Stable tag not confirmed for ${pkg.name}; resume finalization.`);
    tags.push({ name: pkg.name, version: pkg.version, latest });
  }
  await effects.record(tags);
  for (const pkg of packages) await effects.github(pkg);
}

async function githubTag(pkg, commit, create = false) {
  const headers = { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' };
  let ref = await getJSON(`https://api.github.com/repos/${repository}/git/ref/tags/${pkg.tag}`, headers);
  if (ref) {
    let object = ref.object;
    while (object.type === 'tag') object = (await getJSON(object.url, headers)).object;
    assert.equal(object.sha, commit, `Existing tag ${pkg.tag} points to another commit.`);
  } else if (create) {
    run('gh', ['api', '--method', 'POST', `repos/${repository}/git/refs`, '-f', `ref=refs/tags/${pkg.tag}`, '-f', `sha=${commit}`]);
  }
}

async function publish() {
  const manifest = await loadManifest(true);
  assert.ok(process.env.GH_TOKEN, 'GH_TOKEN is required to preflight and finalize release tags.');
  for (const pkg of manifest.packages.filter(pkg => pkg.filename)) await githubTag(pkg, manifest.source.commit);
  await publishBatch(manifest, {
    metadata: pkg => getJSON(versionURL(pkg)),
    publish: pkg => {
      // All versions start on next. Stable promotion follows whole-batch registry installation.
      execFileSync('npm', ['publish', path.join(artifacts, pkg.filename), '--ignore-scripts', '--access=public', '--tag=next', '--provenance', `--registry=${registry}`], { cwd: root, stdio: 'inherit' });
    },
    confirm: async pkg => {
      for (let attempt = 0; attempt < 61; attempt++) {
        if (registryState(await getJSON(versionURL(pkg)), pkg) === 'identical') return;
        if (attempt < 60) await delay(5000);
      }
      throw new Error(`npm has not exposed ${pkg.name}@${pkg.version}; resume this batch with the same artifacts later.`);
    },
    verify: async packages => {
      await testPackages(packages);
      for (const graph of manifest.minimums) await testPackages(graph.map(({ filename, ...pkg }) => pkg));
      await save('registry-verification.json', { status: 'passed', commit: manifest.source.commit, manifestSha256: digest(await readFile(path.join(artifacts, 'release-manifest.json'))), verifiedAt: new Date().toISOString(), packages: packages.map(({ name, version, integrity }) => ({ name, version, integrity })) });
    },
  });
  console.log('Batch uploaded to next and verified from npm. Awaiting protected finalization.');
}

async function checkTagAuth() {
  const plan = await readJSON('.changeset/release.json');
  if (!plan.packages.some(stable)) return;
  assert.ok(process.env.NPM_TAG_TOKEN, 'Stable releases require the protected npm environment secret NPM_TAG_TOKEN.');
  // OIDC handles publish only. This token is passed only to npm identity/tag operations.
  execFileSync('npm', ['whoami', `--registry=${registry}`], { cwd: root, stdio: 'pipe', env: { ...process.env, NODE_AUTH_TOKEN: process.env.NPM_TAG_TOKEN } });
  console.log('Stable tag credential identity verified.');
}

async function finalize() {
  const manifest = await loadManifest(true);
  assert.ok(process.env.GH_TOKEN, 'GH_TOKEN is required to finalize release tags.');
  const manifestSha256 = digest(await readFile(path.join(artifacts, 'release-manifest.json')));
  const packageReleases = releases(manifest);
  for (const pkg of packageReleases) await githubTag(pkg, manifest.source.commit);
  await finalizeBatch(manifest, {
    accept: async () => {
      validateVerification(manifest, await readJSON('.artifacts/registry-verification.json'), manifestSha256);
      await checkTagAuth();
    },
    metadata: pkg => getJSON(versionURL(pkg)),
    latest: async name => (await getJSON(`${registry}-/package/${encodeURIComponent(name)}/dist-tags`))?.latest,
    promote: async pkg => {
      execFileSync('npm', ['dist-tag', 'add', `${pkg.name}@${pkg.version}`, 'latest', `--registry=${registry}`], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_AUTH_TOKEN: process.env.NPM_TAG_TOKEN } });
      for (let attempt = 0; attempt < 61; attempt++) {
        const latest = (await getJSON(`${registry}-/package/${encodeURIComponent(pkg.name)}/dist-tags`))?.latest;
        if (latest && semver.valid(latest) && !semver.prerelease(latest) && semver.gte(latest, pkg.version)) return;
        if (attempt < 60) await delay(5000);
      }
      throw new Error(`Stable tag not visible for ${pkg.name}; resume finalization.`);
    },
    record: tags => save('release-result.json', { status: 'passed', commit: manifest.source.commit, manifestSha256, finalizedAt: new Date().toISOString(), tags }),
      github: async pkg => {
      await githubTag(pkg, manifest.source.commit, true);
      const existing = await getJSON(`https://api.github.com/repos/${repository}/releases/tags/${pkg.tag}`, { authorization: `Bearer ${process.env.GH_TOKEN}` });
      const assets = [path.join(artifacts, pkg.filename), path.join(artifacts, 'release-manifest.json'), path.join(artifacts, 'SHA256SUMS'), path.join(artifacts, 'registry-verification.json'), path.join(artifacts, 'release-result.json')];
      if (existing) {
        run('gh', ['release', 'upload', pkg.tag, ...assets, '--clobber', '--repo', repository]);
        if (existing.draft) run('gh', ['release', 'edit', pkg.tag, '--draft=false', '--repo', repository]);
      } else {
        const notes = path.join(artifacts, 'release-notes.md');
        await writeFile(notes, `Install: npm install ${pkg.name}@${pkg.version}\n\n${pkg.notes}\n`);
        run('gh', ['release', 'create', pkg.tag, ...assets, '--verify-tag', '--title', pkg.tag, '--notes-file', notes, '--repo', repository, '--latest=false', ...(semver.prerelease(pkg.version) ? ['--prerelease'] : [])]);
      }
    },
  });
  const canonical = canonicalRelease(packageReleases);
  if (canonical) run('gh', ['release', 'edit', canonical.tag, '--latest', '--repo', repository]);
  console.log('Batch published, installed from npm, and finalized on GitHub.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv[2];
    assert.ok(['prepare', 'verify', 'check-tag-auth', 'publish', 'finalize'].includes(command), 'Use release.mjs prepare [--dry-run], verify, check-tag-auth, publish, or finalize.');
    if (command === 'prepare') await prepare(process.argv.includes('--dry-run'));
    if (command === 'verify') {
      const manifest = await loadManifest();
      await testPackages(manifest.packages);
      for (const graph of manifest.minimums) await testPackages(graph);
    }
    if (command === 'publish') await publish();
    if (command === 'check-tag-auth') await checkTagAuth();
    if (command === 'finalize') await finalize();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release failed.');
    process.exitCode = 1;
  }
}
