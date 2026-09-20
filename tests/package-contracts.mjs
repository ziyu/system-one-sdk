import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

/** Runs from a copied file in an isolated consumer as well as from a workspace. */
export async function checkPackage(name, format = 'esm') {
  const require = createRequire(import.meta.url);
  const load = format === 'cjs' ? async specifier => require(specifier) : specifier => import(specifier);
  const core = await load('@system-one-ai/core');
  const pkg = await load(`@system-one-ai/${name}`);
  const questions = { on: core.booleanQuestion('Is the light on?') };
  const request = { state: 'on', questions };
  const answers = { on: { type: 'boolean', probability: 0.9 } };
  const native = { answers: { on: { type: 'noul', noul: 0.9 } }, usage: {}, model: 'jev-latest' };
  let payload = { answers };
  let url = 'https://fixture.example/evaluate';
  let adapter = { id: 'fixture', defaultBaseURL: 'https://fixture.example', defaultModel: 'fixture', supportedQuestionTypes: ['boolean'], prepare: () => ({ url, body: request }), decode: value => value };
  let transport = { async send(prepared) {
    assert.equal(prepared.url, url);
    return { payload, status: 200, attempts: 1 };
  } };
  if (name === 'adapter-local') {
    assert.equal(typeof pkg.createNativeClient, 'function');
    assert.equal(typeof pkg.createNativeRunner, 'function');
    const localClient = pkg.createLocalClient({
      id: 'fixture-local',
      defaultModel: 'fixture-local',
      async evaluate(localRequest) {
        return { model: localRequest.model, answers, usage: {} };
      },
    });
    assert.equal((await localClient.evaluate(request)).answers.on.probability, 0.9);
    return;
  }
  if (name === 'model-laya') {
    const browser = await load('@system-one-ai/model-laya/browser');
    const node = await load('@system-one-ai/model-laya/node');
    assert.equal(typeof pkg.parseLayaManifest, 'function');
    assert.equal(typeof pkg.prepareLayaRow, 'function');
    assert.equal(typeof pkg.layaAnswer, 'function');
    assert.equal(typeof browser.createLayaDriver, 'function');
    assert.equal(typeof node.createLayaOnnxModel, 'function');
    return;
  }
  if (name === 'runtime-onnx-node') {
    assert.equal(typeof pkg.createOnnxDriver, 'function');
    assert.equal(pkg.createLayaOnnxModel, undefined);
    return;
  }
  if (name === 'evaluation') {
    assert.equal(typeof pkg.runEvaluation, 'function');
    assert.equal(typeof pkg.summarizeEvaluation, 'function');
    assert.equal(typeof pkg.pairedContextEffect, 'function');
    assert.equal(typeof pkg.backgroundVariant, 'function');
    return;
  }
  if (name === 'adapter-webgpu') {
    assert.equal(typeof pkg.createBrowserClient, 'function');
    assert.equal(typeof pkg.createBrowserRunner, 'function');
    assert.equal(typeof pkg.createGGUFDriver, 'function');
    assert.equal(typeof pkg.createOpenJevBrowserClient, 'function');
    assert.equal(typeof pkg.createOpenJevWebGPUClient, 'function');
    assert.equal(pkg.createLayaDriver, undefined);
    assert.equal(pkg.OPENJEV_MODELS['minicpm5-2b'].url.includes('huggingface.co'), true);
    return;
  }
  if (name.startsWith('adapter-')) {
    const cases = {
      'adapter-system-one': ['systemOneAdapter', 'https://api.typesafe.ai/v1/systemone', native],
      'adapter-openrouter': ['openRouterAdapter', 'https://openrouter.ai/api/alpha/decisions', native],
      'adapter-vercel': ['vercelAdapter', 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model', payload],
      'adapter-cloudflare': ['cloudflareAdapter', 'https://api.cloudflare.com/client/v4/accounts/account/ai/run', { success: true, result: native }],
      'adapter-llm': ['llmAdapter', 'https://api.openai.com/v1/responses', { output_text: JSON.stringify({ answers: { q1: 0.9 } }), status: 'completed' }],
    };
    const [key, endpoint, response] = cases[name];
    adapter = name === 'adapter-cloudflare' ? pkg[key]({ accountId: 'account' }) : name === 'adapter-llm' ? pkg[key]() : pkg[key];
    url = endpoint;
    payload = response;
  }
  if (name === 'protocol-system-one') {
    assert.equal(pkg.nativeQuestions(questions).on.type, 'noul');
    assert.equal(pkg.decodeNative(native).answers.on.probability, 0.9);
  }
  if (name === 'transport-fetch') {
    let calls = 0;
    transport = pkg.createFetchTransport(async (target, init) => {
      assert.equal(target, url);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.get('authorization'), 'Bearer fixture');
      return ++calls === 1 ? new Response('', { status: 503 }) : new Response(JSON.stringify(payload));
    });
  }
  const client = core.createSystemOne({ adapter, transport, apiKey: 'fixture', model: 'jev-latest', retryDelayMs: 0 });
  const result = await client.evaluate(request);
  assert.equal(result.answers.on.probability, 0.9);
  if (name === 'transport-fetch') assert.equal(result.response.attempts, 2);
  if (name === 'core') {
    assert.throws(() => core.createSystemOne({ apiKey: null, adapter }), core.ConfigurationError);
    assert.throws(() => core.createSystemOne({ apiKey: null, transport }), core.ConfigurationError);
    payload = { answers: { on: { type: 'boolean', probability: 2 } } };
    await assert.rejects(client.evaluate(request), core.ResponseValidationError);
    assert.equal('llmAdapter' in core, false);
    assert.equal('systemOneAdapter' in core, false);
  }
  if (name === 'adapter-cloudflare') {
    const workers = await load('@system-one-ai/adapter-cloudflare/workers');
    const nativeClient = workers.createCloudflareWorkers({ binding: { run: async () => Response.json(native) } });
    assert.equal((await nativeClient.evaluate(request)).answers.on.probability, 0.9);
  }
  if (name === 'batch') {
    const report = await pkg.evaluateMany(client, [{ id: 'one', request }]);
    assert.equal(report.items[0].status, 'fulfilled');
    assert.equal(report.summary.succeeded, 1);
  }
  if (name === 'policies') assert.equal(pkg.gateBoolean(result.answers.on, { maxFalseProbability: 0.2, minTrueProbability: 0.8 }).status, 'accepted');
  if (name === 'decisions') {
    const original = { id: 'lamp' };
    const candidate = pkg.choiceFrom({ instructions: 'Target', items: [original], id: item => item.id, describe: () => null });
    assert.strictEqual(candidate.resolve('lamp'), original);
    assert.throws(() => candidate.resolve('missing'), core.ResponseValidationError);
  }
}

if (process.argv[2]) {
  for (const format of ['esm', 'cjs']) await checkPackage(process.argv[2], format);
  console.log(`Package contract passed: ${process.argv[2]} (ESM/CJS).`);
}
