import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeClient } from '@system-one-ai/adapter-local';
import { createOnnxDriver } from '@system-one-ai/runtime-onnx-node';
import { createLayaOnnxModel } from '@system-one-ai/model-laya/node';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.resolve(process.argv[2] ?? path.join(root, '.artifacts/laya/laya.json'));
const fixturesPath = path.join(path.dirname(manifestPath), 'parity-fixtures.json');
const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'));
assert.equal(fixtures.format, 'system-one-laya-parity-v1');
const fixture = fixtures.cases[0];
assert.ok(fixture?.request && fixture?.upstreamResponse?.answers, 'Parity fixture is incomplete.');

const client = await createNativeClient({
  driver: createOnnxDriver({
    model: createLayaOnnxModel({ manifestPath }),
  }),
});

const rounded = value => Math.round(value * 10_000) / 10_000;
try {
  const result = await client.evaluate(fixture.request);
  const expected = fixture.upstreamResponse.answers;
  for (const [id, answer] of Object.entries(result.answers)) {
    const upstream = expected[id];
    assert.ok(upstream, `Missing upstream answer: ${id}`);
    if (answer.type === 'boolean') {
      assert.equal(rounded(answer.probability), upstream.noul, `${id} boolean probability differs`);
      continue;
    }
    if (answer.type === 'choice') assert.equal(answer.choice, upstream.choice, `${id} choice differs`);
    if (answer.type === 'score') assert.equal(rounded(answer.score), upstream.score, `${id} score differs`);
    for (const [key, probability] of Object.entries(answer.probabilities)) {
      assert.equal(rounded(probability), upstream.probabilities[key], `${id}.${key} probability differs`);
    }
    assert.equal(rounded(answer.confidence), upstream.confidence, `${id} confidence differs`);
  }
  assert.equal(result.providerMetadata.runtime, 'onnxruntime-node');
  console.log(`Laya Node ONNX parity passed: ${fixture.name} (${Object.keys(result.answers).length} questions, ${result.usage.inputTokens} input tokens).`);
} finally {
  await client.dispose();
}
