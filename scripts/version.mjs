import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, workspaces } from './workspaces.mjs';

const require = createRequire(import.meta.url);
export function validateInitialVersions(items, currentBatch, tags) {
  const pending = new Map(currentBatch.packages?.map(pkg => [pkg.name, pkg.version]));
  for (const { directory, manifest } of items) {
    if (!tags.some(tag => tag.startsWith(`${directory}-v`)) && pending.get(manifest.name) !== manifest.version) {
      assert.equal(manifest.version, '0.0.0', `${manifest.name} has never been released; start it at 0.0.0 so its first minor release is 0.1.0.`);
    }
  }
}

async function main() {
  const currentBatch = JSON.parse(await readFile(path.join(root, '.changeset/release.json'), 'utf8'));
  const tags = execFileSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  validateInitialVersions(workspaces, currentBatch, tags);
  execFileSync(process.execPath, [require.resolve('@changesets/cli/bin.js'), 'version'], { cwd: root, stdio: 'inherit' });
  const packages = [];
  for (const workspace of workspaces) {
    const manifest = JSON.parse(await readFile(path.join(workspace.cwd, 'package.json'), 'utf8'));
    if (manifest.version !== workspace.manifest.version) packages.push({ name: manifest.name, version: manifest.version });
  }
  assert.ok(packages.length, 'No versions changed; add a changeset or exit prerelease mode first.');
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' });
  await writeFile(path.join(root, '.changeset/release.json'), JSON.stringify({ packages }, null, 2) + '\n');
  console.log(`Prepared Release PR versions for ${packages.length} packages.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
