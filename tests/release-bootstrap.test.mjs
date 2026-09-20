import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapSelection, waitForPublished } from '../scripts/bootstrap-release-packages.mjs';

const artifact = name => ({
  name: `@system-one-ai/${name}`,
  version: '0.7.0',
  filename: `system-one-ai-${name}-0.7.0.tgz`,
  integrity: `sha512-${name}`,
  sha256: `${name}-sha256`,
});

test('bootstrap selects only explicitly requested frozen release artifacts', () => {
  const manifest = { schema: 1, dryRun: false, packages: [artifact('evaluation'), artifact('model-laya')] };
  assert.deepEqual(bootstrapSelection(manifest, ['@system-one-ai/model-laya']), [manifest.packages[1]]);
  assert.throws(() => bootstrapSelection(manifest, ['@system-one-ai/missing']), /not a versioned frozen artifact/);
  assert.throws(() => bootstrapSelection({ ...manifest, dryRun: true }, ['@system-one-ai/evaluation']), /Dry-run/);
  assert.throws(() => bootstrapSelection(manifest, ['@system-one-ai/evaluation', '@system-one-ai/evaluation']), /Duplicate/);
});

test('bootstrap waits for the package packument used by npm install', async () => {
  const pkg = artifact('runtime-onnx-node');
  const published = { name: pkg.name, version: pkg.version, dist: { integrity: pkg.integrity } };
  const urls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    urls.push(url);
    const value = url.includes('/-/package/')
      ? { next: pkg.version }
      : url.endsWith(encodeURIComponent(pkg.name))
        ? { name: pkg.name, versions: { [pkg.version]: published } }
        : published;
    return { status: 200, ok: true, json: async () => value };
  };
  try {
    await waitForPublished(pkg);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(urls, [
    `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${pkg.version}`,
    `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`,
    `https://registry.npmjs.org/-/package/${encodeURIComponent(pkg.name)}/dist-tags`,
  ]);
});
