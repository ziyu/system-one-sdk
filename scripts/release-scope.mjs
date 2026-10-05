import assert from 'node:assert/strict';
import semver from 'semver';

/** Changesets may propose dependent bumps; only reviewed changeset entries authorize a release. */
export function selectReleasePlan(plan, config) {
  assert.equal(config.fixed.length, 0, 'Fixed package groups violate independent release scope.');
  assert.equal(config.linked.length, 0, 'Linked package groups violate independent release scope.');
  const explicit = new Map();
  for (const changeset of plan.changesets) {
    assert.ok(changeset.summary.trim(), `Changeset ${changeset.id} must explain its package changes.`);
    for (const release of changeset.releases) {
      if (release.type === 'none') continue;
      const entries = explicit.get(release.name) ?? [];
      entries.push({ id: changeset.id, summary: changeset.summary });
      explicit.set(release.name, entries);
    }
  }
  const releases = plan.releases.filter(release => release.type !== 'none' && (
    explicit.has(release.name) || plan.preState?.mode === 'exit' && semver.prerelease(release.oldVersion)
  ));
  const scope = releases.map(release => ({
    name: release.name, version: release.newVersion, previousVersion: release.oldVersion,
    reason: explicit.has(release.name) ? 'changeset' : 'prerelease-exit',
    changesets: explicit.get(release.name) ?? [],
  }));
  for (const name of explicit.keys()) {
    assert.ok(releases.some(release => release.name === name), `Changeset selects ${name}, but no version was generated.`);
  }
  assert.ok(scope.length, 'No explicitly selected package releases; add a package-scoped changeset.');
  validateReleaseScope({ packages: scope });
  return { plan: { ...plan, releases }, packages: scope,
    excluded: plan.releases.filter(release => release.type !== 'none' && !releases.includes(release)).map(release => release.name) };
}

/** A frozen batch must retain the reason for every upload, not merely a list of workspace versions. */
export function validateReleaseScope(batch) {
  assert.ok(Array.isArray(batch?.packages) && batch.packages.length > 0, 'Release batch must select at least one package.');
  const names = new Set();
  for (const pkg of batch.packages) {
    assert.ok(typeof pkg.name === 'string' && !names.has(pkg.name), 'Release scope contains an invalid or duplicate package.');
    names.add(pkg.name);
    assert.ok(semver.valid(pkg.version) && semver.valid(pkg.previousVersion), `Release scope needs valid versions for ${pkg.name}.`);
    assert.ok(semver.gt(pkg.version, pkg.previousVersion), `Release must advance ${pkg.name}.`);
    assert.ok(Array.isArray(pkg.changesets), `Missing changeset evidence for ${pkg.name}.`);
    if (pkg.reason === 'prerelease-exit') {
      assert.ok(semver.prerelease(pkg.previousVersion) && !semver.prerelease(pkg.version), `Invalid stable transition for ${pkg.name}.`);
      assert.equal(pkg.changesets.length, 0);
    } else {
      assert.equal(pkg.reason, 'changeset', `Package ${pkg.name} has no explicit release authorization.`);
      assert.ok(pkg.changesets.length > 0 && pkg.changesets.every(entry => typeof entry.id === 'string' && entry.id.trim()
        && typeof entry.summary === 'string' && entry.summary.trim()), `Package ${pkg.name} needs a reviewed changeset reason.`);
    }
  }
}

/** Unselected packages keep their manifests byte-for-byte, including old dependency ranges. */
export function assertUnselectedUnchanged(before, after, selected) {
  const names = new Set(selected.map(pkg => pkg.name));
  for (const [name, manifest] of before) {
    if (!names.has(name)) assert.equal(after.get(name), manifest, `Versioning changed unselected package ${name}.`);
  }
}
