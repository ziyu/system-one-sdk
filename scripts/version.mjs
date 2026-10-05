import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, workspaces } from './workspaces.mjs';
import { selectReleasePlan, assertUnselectedUnchanged } from './release-scope.mjs';

const require = createRequire(import.meta.url);
const unwrap = name => { const value = require(name); return value.default ?? value; };
const getReleasePlan = unwrap('@changesets/get-release-plan');
const applyReleasePlan = unwrap('@changesets/apply-release-plan');
const { getPackages } = require('@manypkg/get-packages');
const { read: readConfig } = require('@changesets/config');
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
  const workspacePackages = await getPackages(root);
  const config = await readConfig(root, workspacePackages);
  const selected = selectReleasePlan(await getReleasePlan(root), config);
  const before = new Map(await Promise.all(workspaces.map(async workspace => [workspace.manifest.name, await readFile(path.join(workspace.cwd, 'package.json'), 'utf8')])));
  if (process.argv.includes('--plan')) {
    console.log(JSON.stringify({ packages: selected.packages, unchangedDependents: selected.excluded }, null, 2));
    return;
  }
  await applyReleasePlan(selected.plan, workspacePackages, config);
  const after = new Map(await Promise.all(workspaces.map(async workspace => [workspace.manifest.name, await readFile(path.join(workspace.cwd, 'package.json'), 'utf8')])));
  assertUnselectedUnchanged(before, after, selected.packages);
  const packages = selected.packages;
  for (const pkg of packages) assert.equal(JSON.parse(after.get(pkg.name)).version, pkg.version, `Generated version differs for ${pkg.name}.`);
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' });
  await writeFile(path.join(root, '.changeset/release.json'), JSON.stringify({ packages }, null, 2) + '\n');
  console.log(`Prepared Release PR versions for ${packages.length} packages.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
