import { booleanQuestion, type EvaluationClient } from '@system-one-ai/core';
import { createNativeClient, type NativeModelDriver } from '@system-one-ai/adapter-local';
import { createLayaOnnxModel, createOnnxDriver, type OnnxModelPlugin } from '@system-one-ai/runtime-onnx-node';

async function verifyNativeOnnxTypes() {
  const model: OnnxModelPlugin = createLayaOnnxModel({ manifestPath: './laya.json', tokenizer: { encode: () => [1] } });
  const driver: NativeModelDriver = createOnnxDriver({ model, device: 'cpu' });
  const client = await createNativeClient({ driver });
  const compatible: EvaluationClient = client;
  const result = await client.evaluate({ state: 'local', questions: { ready: booleanQuestion('Ready?') } });
  const probability: number = result.answers.ready.probability;
  const disposed: Promise<void> = client.dispose();
  void [compatible, probability, disposed];
}

void verifyNativeOnnxTypes;
