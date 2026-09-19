import assert from 'node:assert/strict';
import test from 'node:test';
import { publishBatch, registryState, resolveGraph, validatePackage } from '../scripts/release.mjs';

const pkg = (name, version = '0.6.0', dependencies = {}) => ({ name: `@system-one-ai/${name}`, version, dependencies, integrity: `sha512-${name}-${version}`, filename: `${name}.tgz` });
const metadata = value => ({ ...value, dist: { integrity: value.integrity } });

test('batch preflight, dependency order, partial failure and resume use immutable versions', async () => {
  const core = pkg('core');
  const adapter = pkg('adapter-llm', '0.6.0', { [core.name]: '^0.6.0' });
  const manifest = { dryRun: false, packages: [adapter, core] };
  const published = new Map();
  const events = [];
  let fail = true;
  const effects = {
    metadata: async value => published.get(value.name) ?? null,
    publish: async value => {
      events.push(`publish:${value.name}`);
      if (value === adapter && fail) throw new Error('simulated network failure');
      published.set(value.name, metadata(value));
    },
    confirm: async value => assert.equal(registryState(published.get(value.name), value), 'identical'),
    verify: async values => { assert.ok(values.every(value => !value.filename)); events.push('verify'); },
    latest: async () => '0.5.0',
    promote: async value => events.push(`latest:${value.name}`),
    github: async value => events.push(`github:${value.name}`),
  };
  await assert.rejects(publishBatch(manifest, effects), /simulated/);
  assert.deepEqual(events, [`publish:${core.name}`, `publish:${adapter.name}`]);
  fail = false;
  events.length = 0;
  await publishBatch(manifest, effects);
  assert.deepEqual(events, [`publish:${adapter.name}`, 'verify', `latest:${core.name}`, `latest:${adapter.name}`, `github:${core.name}`, `github:${adapter.name}`]);
  // A conflict in the last package prevents publication of the first package as well.
  published.delete(core.name);
  published.set(adapter.name, metadata({ ...adapter, integrity: 'other' }));
  events.length = 0;
  await assert.rejects(publishBatch(manifest, effects), /different contents/);
  assert.deepEqual(events, []);
});

test('failed consumer verification withholds promotion/tags; RC and retries never downgrade latest', async () => {
  const candidate = pkg('core');
  const events = [];
  const effects = {
    metadata: async value => metadata(value), publish: async () => assert.fail(), confirm: async () => {},
    verify: async () => { throw new Error('consumer failed'); }, latest: async () => '0.7.0',
    promote: async () => events.push('promote'), github: async () => events.push('github'),
  };
  await assert.rejects(publishBatch({ dryRun: false, packages: [candidate] }, effects), /consumer failed/);
  assert.deepEqual(events, []);
  effects.verify = async () => {};
  await publishBatch({ dryRun: false, packages: [candidate] }, effects);
  assert.deepEqual(events, ['github']);
  events.length = 0;
  effects.latest = async () => assert.fail('RC cannot query/promote latest');
  await publishBatch({ dryRun: false, packages: [pkg('core', '0.6.0-rc.0')] }, effects);
  assert.deepEqual(events, ['github']);
  await assert.rejects(publishBatch({ dryRun: true, packages: [candidate] }, effects), /Dry-run/);
});

test('unchanged dependencies use published bytes and minimum ranges, never repacked historical bytes', async () => {
  const core = pkg('core', '0.6.1');
  const adapter = pkg('adapter-llm', '0.6.2', { [core.name]: '^0.6.0' });
  const historical = { ...pkg('core'), integrity: 'sha512-historical' };
  const lookup = async name => ({ versions: { '0.6.0': metadata(historical), '0.6.1': metadata(core) } });
  const graph = await resolveGraph([adapter], [adapter], lookup);
  assert.equal(graph[0].version, '0.6.0');
  assert.equal(graph[0].integrity, 'sha512-historical');
  assert.equal(graph[0].filename, undefined);
  assert.equal((await resolveGraph([adapter], [adapter, core], lookup))[0], core);
  assert.equal((await resolveGraph([adapter], [adapter, core], lookup, true))[0].version, '0.6.0');
  await assert.rejects(resolveGraph([adapter], [adapter], async () => null), /No published dependency/);
  await assert.rejects(resolveGraph([adapter, pkg('core', '0.7.0')], [], lookup), /does not satisfy/);
  await assert.rejects(publishBatch({ dryRun: false, packages: graph }, { metadata: async () => null }), /dependency disappeared/);
});

test('RC dependencies select the matching prerelease and reject cycles', async () => {
  const core = pkg('core', '0.6.0-rc.0');
  const adapter = pkg('adapter-llm', '0.6.0-rc.0', { [core.name]: '^0.6.0-rc.0' });
  const graph = await resolveGraph([adapter], [adapter, core], async () => assert.fail(), true);
  assert.deepEqual(graph, [core, adapter]);
  const cycle = pkg('core', '0.6.0-rc.0', { [adapter.name]: '^0.6.0-rc.0' });
  await assert.rejects(resolveGraph([cycle, adapter], [], async () => null), /cycle/);
});

test('release package metadata rejects version/lock/repository/registry mismatches', () => {
  const manifest = { ...pkg('core'), license: 'MIT', repository: { url: 'git+https://github.com/ziyu/sytem-one-sdk.git', directory: 'packages/core' }, publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' } };
  const lock = { packages: { 'packages/core': { version: '0.6.0' } } };
  assert.equal(validatePackage(manifest, lock).tag, 'core-v0.6.0');
  for (const changed of [{ version: '0.6.1' }, { version: '0.6.0+build' }, { private: true }, { name: '@other/core' }, { publishConfig: {} }, { repository: {} }]) {
    assert.throws(() => validatePackage({ ...manifest, ...changed }, lock));
  }
  assert.throws(() => registryState(metadata({ ...manifest, version: '0.6.1' }), manifest));
});
