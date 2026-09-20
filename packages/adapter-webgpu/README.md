# @system-one-ai/adapter-webgpu

Run System One models locally in the browser behind one model-agnostic client API. `createBrowserClient()` accepts a `BrowserModelDriver`; built-in drivers currently support GGUF/Wllama and exported Laya ONNX models. WebGPU is preferred when available, with WASM/CPU as the fallback. No request is sent to a model API.

```ts
import { createBrowserClient, createGGUFDriver } from '@system-one-ai/adapter-webgpu';
import { choice } from '@system-one-ai/core';

const client = await createBrowserClient({
  driver: createGGUFDriver({ model: 'qwen3-0.6b' }),
});
const result = await client.evaluate({
  state: 'The customer cannot sign in after a password reset.',
  questions: { queue: choice('Which queue?', { access: 'Account access', billing: 'Billing' }) },
});
console.log(result.answers.queue);
```

`createBrowserClient()` defaults to `device: 'auto'`. Each driver resolves that request for its runtime: the GGUF driver uses WebGPU when Wllama can enable it and otherwise loads the same checkpoint with `n_gpu_layers: 0` on WASM/CPU. Set `device: 'wasm'` to force CPU-only inference or `device: 'webgpu'` to require GPU execution.

The client/runner layer is deliberately independent of model families. A future model integration implements `BrowserModelDriver.createRunner()` and can immediately use `createBrowserClient()` and `createBrowserRunner()`. `createOpenJevBrowserClient()`, `createOpenJevWebGPUClient()`, `createLayaBrowserClient()` and `createLayaWebGPUClient()` remain exported for compatibility but are not the primary API.

Exported Laya ONNX checkpoints use the same browser-device policy:

```ts
import { createBrowserClient, createLayaDriver } from '@system-one-ai/adapter-webgpu';

const client = await createBrowserClient({
  driver: createLayaDriver({ manifestUrl: '/models/laya/laya.json' }),
});
```

The Laya driver prefers the ONNX Runtime WebGPU execution provider and falls back to its `wasm` CPU provider. Pass `device: 'wasm'` on `createBrowserClient()` to force CPU inference.

The built-in model IDs pin the same GGUF files used by [SemIf/OpenJev](https://openjev.com/). To use another GGUF checkpoint, pass `modelUrl` and a stable `model` name. The model and Wllama runtime are downloaded by the browser and cached locally; set `wasmUrl` and use a local model URL for a fully self-hosted deployment.

The default Wllama module and WASM are loaded from jsDelivr. Strict CSP or air-gapped deployments should pass `wllama` (the imported Wllama module), `wasmUrl`, and a local `modelUrl`.

WebGPU acceleration requires a secure browser context (`https:` or localhost) and a compatible GPU. WASM/CPU inference does not require WebGPU. This package is browser-only; Python/CUDA/MLX runtimes use `@system-one-ai/adapter-local` instead.

## Laya model preparation and evaluation

Laya uses a bidirectional encoder and custom decision/action heads, so a GGUF file or an encoder-only ONNX export is insufficient. The repository's [export tool](../../scripts/laya/README.md) downloads the complete trained English checkpoint at revision `1c5edc17a7acd8701df6fc341c0d179f1c62c982`, exports all five inputs and both outputs, and writes `laya.json` only after comparison with the original Python implementation succeeds. Serve the entire exported directory, including external weights and tokenizer files.

```ts
import { createBrowserClient, createLayaDriver } from '@system-one-ai/adapter-webgpu';
import { choice, score, booleanQuestion } from '@system-one-ai/core';

const client = await createBrowserClient({
  driver: createLayaDriver({
    manifestUrl: '/models/laya/laya.json',
    batchSize: 4,
    onProgress: ({ status }) => console.log(status),
  }),
});

try {
  const result = await client.evaluate({
    state: 'The customer was charged twice and asks for a refund.',
    questions: {
      queue: choice('Which queue?', { billing: 'Payments and refunds', access: 'Account access' }),
      urgency: score('How urgent?', ['low', 'normal', 'urgent']),
      refund: booleanQuestion('Is a refund requested?'),
    },
  });
  console.log(result.answers, result.warnings);
} finally {
  await client.dispose();
}
```

`createBrowserRunner({ driver: createLayaDriver(options) })` exposes the same runtime as a `LocalModelRunner` for lower-level composition. Both the client and runner support disposal. Evaluation calls are serialized for one session, and `batchSize` (default 4, maximum 64) limits questions per forward pass. A call with more questions uses several forward passes; input-token usage counts every question's non-padding tokens and output-token usage is zero.

The adapter retains the checkpoint's question rendering, `[MASK]` escaping, option truncation, per-type/per-cardinality temperature and entropy-based confidence. SDK `boolean` maps to upstream `noul`, with fixed `[false, true]` ordering. It returns unrounded probabilities and scores; the original Python API rounds them to four decimals. `providerMetadata.actProbabilities` exposes the independent action-head probability for each question. These are model statistics, not a promise of calibration for an application's data.

State, instructions or option text cut to the checkpoint budget produce explicit `laya_*_truncated` warnings. A question whose option markers cannot fit is rejected. Structured boolean criteria are rejected because the original Python renderer accepts strings or null there. The loaded model cannot be changed through `evaluate({ model })`, and nonempty `providerOptions` are rejected instead of silently ignored. Singleton choices use a masked second marker to accommodate the upstream action head's top-two operation; standalone singletons are an SDK extension.

`evaluate(request, { signal, timeoutMs })` rejects cancelled or expired calls promptly. ONNX Runtime cannot interrupt an already submitted native run: its tensors are released after that run settles, and the next queued call waits. `dispose()` also waits before releasing the session. Initialization accepts a separate `signal`; if model loading finishes after cancellation, the late session is released.

Default browser assets are pinned to ONNX Runtime Web 1.30.0 and Transformers.js 3.8.1 on jsDelivr. Only tokenizer code from Transformers.js is used. To bundle runtimes or deploy offline, inject `ort` from `onnxruntime-web/webgpu` and a `tokenizer` implementing `encode(text, { add_special_tokens: false })`, and configure the imported ORT module's WASM asset paths as required by your bundler. The tokenizer must match the exported checkpoint; its mask ID is checked. `fetch` overrides manifest/tokenizer fetching, while ONNX Runtime manages graph/external-weight downloads. Model caching follows the runtime and your server's HTTP cache policy; the Laya adapter does not implement a persistent model cache.

The initial export uses FP32 for numerical verification. It is a large desktop-oriented artifact; Q4, FP16 quality and browser latency are not inferred from Python/CUDA benchmarks. The pinned root checkpoint is English, with 512-token context and a 192-token head budget; multilingual checkpoints and automatic language routing are separate upstream models, outside this exporter. See [the Laya model card](https://huggingface.co/convaiinnovations/laya) and [ONNX Runtime WebGPU documentation](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html).

Run the [standalone Laya demo](../../examples/laya-webgpu-demo/README.md) after export. `node scripts/test-laya-webgpu.mjs --probe` checks browser availability and responsive layout; `npm run test:live:laya` compares real browser token IDs, tensor inputs, raw outputs and typed answers against the export's Python fixtures. The live check uses the strict WebGPU provider and fails when a model or GPU is unavailable.

The [recorded WebGPU validation](../../docs/laya-webgpu-validation.md) passed all six trained-model cases and two warm repeats on Edge 153 with an Intel `gen-12lp` GPU. It records numerical error, actual GPU compute dispatches, timings, and the initial runtime error that did not recur in the next two runs. The measured 32-token single-question warm calls took 780–944 ms; this FP32 implementation is not presented as a low-millisecond inference benchmark.
