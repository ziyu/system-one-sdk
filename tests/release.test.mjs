import assert from 'node:assert/strict';
import test from 'node:test';
import { registryState, validateRelease } from '../scripts/release.mjs';

function config(version = '0.3.0') {
  return {
    manifest: {
      name: '@system-one-ai/sdk', version, license: 'MIT',
      repository: { url: 'git+https://github.com/ziyu/sytem-one-sdk.git' },
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
    },
    lock: { name: '@system-one-ai/sdk', version, packages: { '': { name: '@system-one-ai/sdk', version } } },
  };
}

test('stable releases target latest, while prereleases target next', () => {
  const stable = config();
  assert.equal(validateRelease('v0.3.0', stable.manifest, stable.lock).npmTag, 'latest');
  const preview = config('0.4.0-rc.1');
  const result = validateRelease('v0.4.0-rc.1', preview.manifest, preview.lock);
  assert.equal(result.npmTag, 'next');
  assert.equal(result.prerelease, true);
  assert.equal(result.filename, 'system-one-ai-sdk-0.4.0-rc.1.tgz');
});

test('release guard rejects branches, malformed tags, and command-like tag strings', () => {
  const { manifest, lock } = config();
  for (const tag of [undefined, 'main', '0.3.0', 'v00.3.0', 'v0.3.0-01', 'v0.3.0+build', 'v0.3.0\nother', 'v0.3.0; echo bad', 'v0.3.0/other']) {
    assert.throws(() => validateRelease(tag, manifest, lock));
  }
});

test('tag, manifest, and both lockfile versions must match', () => {
  const { manifest, lock } = config();
  assert.throws(() => validateRelease('v0.4.0', manifest, lock));
  lock.version = '0.2.0';
  assert.throws(() => validateRelease('v0.3.0', manifest, lock));
  lock.version = '0.3.0';
  lock.packages[''].version = '0.2.0';
  assert.throws(() => validateRelease('v0.3.0', manifest, lock));
});

test('release guard rejects a different package, repository, registry, or visibility', () => {
  for (const mutate of [
    value => { value.manifest.name = '@another/sdk'; },
    value => { value.lock.packages[''].name = '@another/sdk'; },
    value => { value.manifest.private = true; },
    value => { value.manifest.publishConfig.access = 'restricted'; },
    value => { value.manifest.publishConfig.registry = 'https://example.test/'; },
    value => { value.manifest.repository.url = 'git+https://github.com/another/sdk.git'; },
    value => { delete value.manifest.repository; },
  ]) {
    const value = config();
    mutate(value);
    assert.throws(() => validateRelease('v0.3.0', value.manifest, value.lock));
  }
});

test('reruns may skip npm publication only for the exact same package bytes', () => {
  const artifact = { name: '@system-one-ai/sdk', version: '0.3.0', integrity: 'sha512-fixture' };
  const metadata = { name: artifact.name, version: artifact.version, dist: { integrity: artifact.integrity } };
  assert.equal(registryState(null, artifact), 'missing');
  assert.equal(registryState(metadata, artifact), 'identical');
  assert.throws(() => registryState({ ...metadata, dist: { integrity: 'sha512-different' } }, artifact));
  assert.throws(() => registryState({ ...metadata, version: '0.2.0' }, artifact));
  assert.throws(() => registryState({ ...metadata, name: '@another/sdk' }, artifact));
  assert.throws(() => registryState({ error: 'Unavailable' }, artifact));
});
