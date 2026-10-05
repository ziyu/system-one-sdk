import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { assertUnselectedUnchanged, selectReleasePlan, validateReleaseScope } from '../scripts/release-scope.mjs';
import { consumerGraphs } from '../scripts/test-package.mjs';

const require = createRequire(import.meta.url);
const unwrap = name => { const module = require(name); return module.default ?? module; };
const getReleasePlan = unwrap('@changesets/get-release-plan');
const applyReleasePlan = unwrap('@changesets/apply-release-plan');
const { getPackages } = require('@manypkg/get-packages');
const { read: readConfig } = require('@changesets/config');
const config = { fixed: [], linked: [] };
const release = (name, type = 'patch', oldVersion = '0.6.0', newVersion = '0.6.1') => ({ name, type, oldVersion, newVersion, changesets: [] });

// This uses Changesets itself: its automatic out-of-range dependency bumps must not become uploads.
test('version generation leaves unselected dependent manifests and changelogs untouched', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'system-one-scope-'));
  try {
    await mkdir(path.join(directory, '.changeset'));
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }));
    await writeFile(path.join(directory, '.changeset/config.json'), JSON.stringify({ changelog: false, fixed: [], linked: [], access: 'public', baseBranch: 'main', updateInternalDependencies: 'patch', ignore: [], prettier: false }));
    const manifests = [
      { name: '@fixture/core', version: '0.6.0' },
      { name: '@fixture/vision', version: '0.1.0', dependencies: { '@fixture/core': '^0.6.0' } },
      { name: '@fixture/text', version: '0.6.0', dependencies: { '@fixture/core': '^0.6.0' } },
    ];
    for (const manifest of manifests) {
      const destination = path.join(directory, 'packages', manifest.name.split('/')[1]);
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
      await writeFile(path.join(destination, 'CHANGELOG.md'), `# ${manifest.name}\n\n## ${manifest.version}\n\nPublished history.\n`);
    }
    await writeFile(path.join(directory, '.changeset/images.md'), '---\n"@fixture/core": minor\n"@fixture/vision": minor\n---\n\nCore adds image requests; vision consumes that contract.\n');
    const packages = await getPackages(directory);
    const actualConfig = await readConfig(directory, packages);
    const plan = await getReleasePlan(directory);
    assert.ok(plan.releases.some(pkg => pkg.name === '@fixture/text' && pkg.type === 'patch'));
    const selected = selectReleasePlan(plan, actualConfig);
    assert.deepEqual(selected.packages.map(pkg => pkg.name).sort(), ['@fixture/core', '@fixture/vision']);
    const textFile = path.join(directory, 'packages/text/package.json');
    const historyFile = path.join(directory, 'packages/text/CHANGELOG.md');
    const before = await readFile(textFile, 'utf8');
    const history = await readFile(historyFile, 'utf8');
    await applyReleasePlan(selected.plan, packages, actualConfig);
    assert.equal(await readFile(textFile, 'utf8'), before);
    assert.equal(await readFile(historyFile, 'utf8'), history);
    const vision = JSON.parse(await readFile(path.join(directory, 'packages/vision/package.json'), 'utf8'));
    assert.equal(vision.version, '0.2.0');
    assert.equal(vision.dependencies['@fixture/core'], '^0.7.0');
    validateReleaseScope({ packages: selected.packages });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('prerelease exit includes only already-prereleased packages without new changesets', () => {
  const selected = selectReleasePlan({ changesets: [], preState: { mode: 'exit' }, releases: [
    release('preview', 'patch', '0.7.0-rc.0', '0.7.0'), release('unrelated'),
  ] }, config);
  assert.deepEqual(selected.packages, [{ name: 'preview', previousVersion: '0.7.0-rc.0', version: '0.7.0', reason: 'prerelease-exit', changesets: [] }]);
  assert.deepEqual(selected.excluded, ['unrelated']);
});

test('scope rejects fixed groups, unexplained packages and accidental unselected mutations', () => {
  const plan = { changesets: [{ id: 'fix', summary: 'Fix incorrect output.', releases: [{ name: 'core', type: 'patch' }] }], releases: [release('core')] };
  assert.throws(() => selectReleasePlan(plan, { ...config, fixed: [['core', 'unrelated']] }), /Fixed/);
  assert.throws(() => selectReleasePlan(plan, { ...config, linked: [['core', 'unrelated']] }), /Linked/);
  assert.throws(() => selectReleasePlan({ ...plan, releases: [] }, config), /no version/);
  assert.throws(() => validateReleaseScope({ packages: [{ name: 'core', version: '0.6.1' }] }), /valid versions/);
  const { packages } = selectReleasePlan(plan, config);
  assert.throws(() => validateReleaseScope({ packages: [...packages, { ...packages[0], name: 'unrelated', changesets: [] }] }), /reviewed changeset/);
  assert.throws(() => validateReleaseScope({ packages: [...packages, packages[0]] }), /duplicate/);
  assert.throws(() => assertUnselectedUnchanged(new Map([['text', 'old manifest']]), new Map([['text', 'changed dependency']]), packages), /unselected/);
});

test('consumer graphs preserve older registry core for an unchanged text package', async () => {
  const oldCore = { name: '@system-one-ai/core', version: '0.6.0', dependencies: {}, dist: { integrity: 'sha512-published-core' } };
  const core = { name: oldCore.name, version: '0.7.0', dependencies: {}, integrity: 'sha512-new-core', filename: 'core.tgz' };
  const vision = { name: '@system-one-ai/vision', version: '0.2.0', dependencies: { [core.name]: '^0.7.0' }, integrity: 'sha512-vision', filename: 'vision.tgz' };
  const text = { name: '@system-one-ai/text', version: '0.6.0', dependencies: { [core.name]: '^0.6.0' }, integrity: 'sha512-text', filename: 'text.tgz' };
  const groups = await consumerGraphs([core, vision, text], async name => {
    assert.equal(name, core.name);
    return { versions: { '0.6.0': oldCore } };
  });
  const oldGraph = groups.find(group => group.some(pkg => pkg.name === text.name));
  const oldDependency = oldGraph.find(pkg => pkg.name === core.name);
  assert.equal(oldDependency.version, '0.6.0');
  assert.equal(oldDependency.integrity, 'sha512-published-core');
  assert.equal(oldDependency.filename, undefined);
  const newGraph = groups.find(group => group.some(pkg => pkg.name === vision.name));
  assert.equal(newGraph.find(pkg => pkg.name === core.name), core);
  assert.ok(!groups.some(group => group.some(pkg => pkg.name === text.name) && group.some(pkg => pkg.name === vision.name)));
});
