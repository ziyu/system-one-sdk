import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { buildOrder, root, workspaces } from '../scripts/workspaces.mjs';

test('workspace imports follow declared dependencies, with no adapter or transport in core', () => {
  assert.equal(buildOrder().length, workspaces.length);
  for (const { cwd, manifest, directory } of workspaces) {
    const dependencies = Object.keys(manifest.dependencies ?? {});
    if (directory === 'core') assert.deepEqual(dependencies, []);
    for (const dependency of dependencies) {
      assert.ok(directory === 'adapter-webgpu' && dependency === '@system-one-ai/adapter-local' || !dependency.startsWith('@system-one-ai/adapter-'), 'Only the WebGPU adapter may compose the local runtime adapter');
      assert.notEqual(dependency, '@system-one-ai/sdk');
    }
    for (const filename of readdirSync(path.join(cwd, 'src')).filter(name => name.endsWith('.ts'))) {
      const source = readFileSync(path.join(cwd, 'src', filename), 'utf8');
      for (const [, specifier] of source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
        if (specifier.startsWith('.')) assert.ok(!specifier.startsWith('../'), 'Source cannot reach another package by relative path');
        else assert.ok(dependencies.some(name => specifier === name || specifier.startsWith(`${name}/`)), `${manifest.name} has an undeclared import: ${specifier}`);
      }
    }
  }
});

test('the root is a private workspace without a runtime or compatibility entry point', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.private, true);
  for (const field of ['main', 'module', 'types', 'exports', 'dependencies', 'peerDependencies']) assert.equal(manifest[field], undefined);
  assert.equal(existsSync(path.join(root, 'src')), false);
  for (const directory of ['tests', 'examples', 'scripts']) {
    for (const file of readdirSync(path.join(root, directory), { recursive: true })) {
      if (!/\.(mjs|ts)$/.test(file)) continue;
      const source = readFileSync(path.join(root, directory, file), 'utf8');
      for (const [, specifier] of source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
        assert.ok(!specifier.startsWith('@system-one-ai/sdk'), `Legacy import in ${file}`);
        assert.ok(!/^(?:\.\.\/)+(?:src|dist|\.examples\/src)\//.test(specifier), `Legacy relative import in ${file}`);
      }
    }
  }
});
