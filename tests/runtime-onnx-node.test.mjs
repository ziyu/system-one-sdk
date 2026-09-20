import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { booleanQuestion, choice } from '@system-one-ai/core';
import { createNativeClient } from '@system-one-ai/adapter-local';
import { createOnnxDriver } from '@system-one-ai/runtime-onnx-node';
import { createLayaOnnxModel } from '@system-one-ai/model-laya/node';

function runtimeFixture() {
  const state = { creates: [], runs: 0, released: 0 };
  class Tensor {
    constructor(type, data, dims) { Object.assign(this, { type, data, dims }); }
  }
  const session = {
    inputNames: ['input_ids', 'attention_mask', 'marker_pos', 'marker_mask', 'qtype'],
    outputNames: ['logits', 'act_logits'],
    async run(feeds) {
      state.runs++;
      const [rows, columns] = feeds.marker_pos.dims;
      const logits = new Float32Array(rows * columns).fill(-10000);
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          if (feeds.marker_mask.data[row * columns + column]) logits[row * columns + column] = column * Math.log(4);
        }
      }
      return {
        logits: new Tensor('float32', logits, [rows, columns]),
        act_logits: new Tensor('float32', new Float32Array(rows * 2), [rows, 2]),
      };
    },
    async release() { state.released++; },
  };
  const runtime = {
    Tensor,
    InferenceSession: {
      async create(modelPath, options) {
        state.creates.push({ modelPath, options });
        return session;
      },
    },
  };
  return { runtime, state };
}

function tokenizer() {
  return {
    encode(text, options) {
      assert.equal(options.add_special_tokens, false);
      return text === '[MASK]' ? [103] : Array.from(text, character => character.codePointAt(0) + 1000);
    },
  };
}

const manifest = {
  format: 'system-one-laya-onnx-v1',
  model: 'convaiinnovations/laya',
  revision: 'fixture-revision',
  modelFile: 'model.onnx',
  externalData: [{ path: 'model.onnx.data', data: 'model.onnx.data' }],
  tokenizer: 'tokenizer',
  maxLength: 512,
  headMaxLength: 192,
  temperature: [1, 1, 1],
  temperatureByOptions: { 'choice:2': 1, 'noul:2': 1 },
  tokenIds: { cls: 101, sep: 102, pad: 0, mask: 103 },
  maskToken: '[MASK]',
};

test('native ONNX driver runs Laya in-process on the portable CPU provider', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'system-one-laya-node-'));
  const manifestPath = path.join(directory, 'laya.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const { runtime, state } = runtimeFixture();
  try {
    const client = await createNativeClient({
      driver: createOnnxDriver({
        runtime,
        model: createLayaOnnxModel({ manifestPath, tokenizer: tokenizer() }),
      }),
    });
    try {
      const result = await client.evaluate({
        state: 'customer asks for a refund',
        questions: {
          queue: choice('Which queue?', { access: 'Account access', billing: 'Billing' }),
          refund: booleanQuestion('Is a refund requested?'),
        },
      });
      assert.equal(result.answers.queue.choice, 'billing');
      assert.ok(Math.abs(result.answers.queue.probabilities.billing - 0.8) < 1e-7);
      assert.ok(Math.abs(result.answers.refund.probability - 0.8) < 1e-7);
      assert.equal(result.providerMetadata.runtime, 'onnxruntime-node');
      assert.equal(result.providerMetadata.device, 'cpu');
      assert.equal(result.response.adapter, 'local-onnx-laya');
      assert.equal(state.runs, 1);
      assert.equal(state.creates[0].modelPath, path.join(directory, 'model.onnx'));
      assert.deepEqual(state.creates[0].options.executionProviders, ['cpu']);
      assert.equal(state.creates[0].options.externalData, undefined, 'native ORT resolves ONNX external data from the model directory');
    } finally {
      await client.dispose();
      await client.dispose();
    }
    assert.equal(state.released, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('generic ONNX driver accepts future model plugins without adding a model-named client', async () => {
  const { runtime, state } = runtimeFixture();
  const client = await createNativeClient({
    driver: createOnnxDriver({
      runtime,
      executionProviders: ['cpu'],
      model: {
        id: 'future',
        async load({ device }) {
          assert.equal(device, 'custom');
          return {
            defaultModel: 'future-v1',
            supportedQuestionTypes: ['boolean'],
            modelPath: 'future.onnx',
            async evaluate(_session, request) {
              return { model: request.model, answers: { ready: { type: 'boolean', probability: 0.9 } }, usage: {} };
            },
          };
        },
      },
    }),
  });
  assert.equal((await client.evaluate({ state: 'local', questions: { ready: booleanQuestion('Ready?') } })).answers.ready.probability, 0.9);
  await client.dispose();
  assert.equal(state.released, 1);
});
