import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const registry = 'https://registry.npmjs.org/';
const artifacts = path.resolve('.artifacts');
const digest = (bytes, algorithm) => createHash(algorithm).update(bytes).digest(algorithm === 'sha512' ? 'base64' : 'hex');

export function bootstrapSelection(manifest, requested) {
  assert.equal(manifest.schema, 1, 'Unsupported release manifest schema.');
  assert.equal(manifest.dryRun, false, 'Dry-run artifacts cannot be bootstrapped.');
  assert.ok(Array.isArray(manifest.packages), 'Release manifest has no packages.');
  assert.ok(requested.length, 'Specify at least one package to bootstrap.');
  assert.equal(new Set(requested).size, requested.length, 'Duplicate bootstrap package.');
  return requested.map(name => {
    const pkg = manifest.packages.find(item => item.name === name);
    assert.ok(pkg?.filename && pkg.version && pkg.integrity && pkg.sha256, `Package is not a versioned frozen artifact: ${name}`);
    return pkg;
  });
}

async function metadata(name, version) {
  const response = await fetch(`${registry}${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  assert.ok(response.ok, `Registry metadata failed for ${name}@${version}: HTTP ${response.status}`);
  return response.json();
}

async function packument(name) {
  const response = await fetch(`${registry}${encodeURIComponent(name)}`, {
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  assert.ok(response.ok, `Registry package metadata failed for ${name}: HTTP ${response.status}`);
  return response.json();
}

async function tags(name) {
  const response = await fetch(`${registry}-/package/${encodeURIComponent(name)}/dist-tags`, {
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  assert.ok(response.ok, `Registry dist-tags failed for ${name}: HTTP ${response.status}`);
  return response.json();
}

function verifyPublished(pkg, value) {
  assert.equal(value?.name, pkg.name, 'Registry returned another package.');
  assert.equal(value?.version, pkg.version, 'Registry returned another version.');
  assert.equal(value?.dist?.integrity, pkg.integrity, `Registry integrity differs for ${pkg.name}@${pkg.version}.`);
}

export async function waitForPublished(pkg) {
  for (let attempt = 0; attempt < 61; attempt++) {
    const value = await metadata(pkg.name, pkg.version);
    if (value) {
      verifyPublished(pkg, value);
      const packageMetadata = await packument(pkg.name);
      const listedVersion = packageMetadata?.versions?.[pkg.version];
      if (listedVersion) {
        verifyPublished(pkg, listedVersion);
        const distTags = await tags(pkg.name);
        if (distTags) return distTags;
      }
    }
    await delay(5_000);
  }
  throw new Error(`Published metadata, packument, and dist-tags did not become visible for ${pkg.name}@${pkg.version}.`);
}

async function main() {
  assert.ok(process.env.NODE_AUTH_TOKEN, 'NPM_TAG_TOKEN is required through NODE_AUTH_TOKEN.');
  const commit = process.env.RELEASE_COMMIT?.trim();
  const runId = process.env.RELEASE_ARTIFACT_RUN_ID?.trim();
  assert.match(commit ?? '', /^[0-9a-f]{40}$/, 'RELEASE_COMMIT must be a full SHA.');
  assert.match(runId ?? '', /^\d+$/, 'RELEASE_ARTIFACT_RUN_ID must be numeric.');
  const requested = (process.env.RELEASE_BOOTSTRAP_PACKAGES ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const manifest = JSON.parse(await readFile(path.join(artifacts, 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.source?.commit, commit, 'Frozen release source differs from requested commit.');
  assert.equal(manifest.verification?.workflowRun, `https://github.com/ziyu/system-one-sdk/actions/runs/${runId}`, 'Frozen artifact belongs to another release run.');
  const packages = bootstrapSelection(manifest, requested);

  for (const pkg of packages) {
    const bytes = await readFile(path.join(artifacts, pkg.filename));
    assert.equal(digest(bytes, 'sha256'), pkg.sha256, `SHA-256 differs for ${pkg.filename}.`);
    assert.equal(`sha512-${digest(bytes, 'sha512')}`, pkg.integrity, `SHA-512 differs for ${pkg.filename}.`);
    const existing = await metadata(pkg.name, pkg.version);
    if (existing) {
      verifyPublished(pkg, existing);
      await waitForPublished(pkg);
      console.log(`Already bootstrapped with identical bytes: ${pkg.name}@${pkg.version}`);
      continue;
    }
    // First publication cannot use a package-level trusted publisher because the
    // package does not exist yet. Use the protected environment token only for
    // this exact frozen tarball, then configure Trusted Publishing immediately.
    execFileSync('npm', ['publish', path.join(artifacts, pkg.filename), '--access', 'public', '--tag', 'next', '--provenance=false'], {
      stdio: 'inherit', env: process.env,
    });
    const distTags = await waitForPublished(pkg);
    assert.equal(distTags.next, pkg.version, `${pkg.name} next tag was not initialized to ${pkg.version}.`);
    if (distTags.latest === pkg.version) {
      console.warn(`npm also initialized unavoidable latest for new package ${pkg.name}@${pkg.version}; finalization will verify it again.`);
    } else {
      assert.equal(distTags.latest, undefined, `${pkg.name} received an unexpected latest tag.`);
    }
    console.log(`Bootstrapped exact frozen bytes: ${pkg.name}@${pkg.version}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
