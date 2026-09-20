import { booleanQuestion, choice, score, type EvaluationClient } from '@system-one-ai/core';
import { createLocalClient, type LocalModelRunner } from '@system-one-ai/adapter-local';
import { createBrowserClient, createLayaDriver, createLayaWebGPURunner, type LayaTokenizer, type LayaWebGPUOptions } from '@system-one-ai/adapter-webgpu';

async function verifyLayaTypes() {
  const options: LayaWebGPUOptions = { manifestUrl: '/models/laya/laya.json', batchSize: 4 };
  const client = await createBrowserClient({ driver: createLayaDriver(options), device: 'webgpu' });
  const compatible: EvaluationClient = client;
  const result = await client.evaluate({ state: 'A refund is requested.', questions: {
    queue: choice('Which queue?', { billing: 'Refunds', access: 'Login' }),
    urgency: score('Urgency?', ['low', 'high']),
    refund: booleanQuestion('Refund requested?'),
  } });
  const queue: 'billing' | 'access' = result.answers.queue.choice;
  const urgency: number = result.answers.urgency.score;
  const probability: number = result.answers.refund.probability;
  // @ts-expect-error Laya retains the exact choice union from the core contract.
  const unknownQueue: 'sales' = result.answers.queue.choice;
  // @ts-expect-error Boolean answers do not contain a choice.
  result.answers.refund.choice;
  const disposed: Promise<void> = client.dispose();
  const runner = await createLayaWebGPURunner(options);
  const localRunner: LocalModelRunner = runner;
  createLocalClient(localRunner);
  await runner.dispose();
  void [compatible, queue, urgency, probability, unknownQueue, disposed];
}

const tokenizer: LayaTokenizer = { encode: async (_text, _options) => [1, 2, 3] };
// @ts-expect-error A complete model manifest is required; there is no invented ONNX URL.
const missingManifest: LayaWebGPUOptions = {};
void [verifyLayaTypes, tokenizer, missingManifest];
