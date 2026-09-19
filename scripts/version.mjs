import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { root, workspaces } from './workspaces.mjs';

const require = createRequire(import.meta.url);
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
