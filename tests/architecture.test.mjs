import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { buildOrder, workspaces } from '../scripts/workspaces.mjs';

test('workspace imports follow declared dependencies, with no adapter or transport in core', () => {
  assert.equal(buildOrder().length, workspaces.length);
  for (const { cwd, manifest, directory } of workspaces) {
    const dependencies = Object.keys(manifest.dependencies ?? {});
    if (directory === 'core') assert.deepEqual(dependencies, []);
    for (const dependency of dependencies) {
      assert.ok(!dependency.startsWith('@system-one-ai/adapter-'), 'No workspace may depend on a concrete adapter');
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
