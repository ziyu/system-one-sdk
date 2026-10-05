import assert from 'node:assert/strict';
import semver from 'semver';
import { buildOrder } from './workspaces.mjs';

const ordered = packages => buildOrder(undefined, packages.map(manifest => ({ manifest }))).map(item => item.manifest);
const internal = name => name.startsWith('@system-one-ai/');
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
