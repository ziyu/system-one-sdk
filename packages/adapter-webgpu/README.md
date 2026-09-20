# @system-one-ai/adapter-webgpu

Run System One models locally in the browser behind a model-agnostic client API. `createBrowserClient()` accepts a `BrowserModelDriver`; this package includes a GGUF/Wllama driver and lets optional model packages provide others. WebGPU is preferred when available, with WASM/CPU as the fallback.

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

`createBrowserClient()` defaults to `device: 'auto'`. Each driver resolves that request for its runtime. Set `device: 'wasm'` to force CPU-only inference or `device: 'webgpu'` to require GPU execution.

The client/runner layer has no dependency on a specific model package. A model integration implements `BrowserModelDriver.createRunner()` and can immediately use `createBrowserClient()` and `createBrowserRunner()`. Laya support is an opt-in driver from `@system-one-ai/model-laya/browser`.

The built-in model IDs pin the same GGUF files used by [SemIf/OpenJev](https://openjev.com/). To use another GGUF checkpoint, pass `modelUrl` and a stable `model` name. The default Wllama module and WASM are loaded from jsDelivr; strict CSP or air-gapped deployments should inject the module, set `wasmUrl`, and use a local model URL.

WebGPU acceleration requires a secure browser context (`https:` or localhost) and a compatible GPU. WASM/CPU inference does not require WebGPU. This package is browser-only; Python/CUDA/MLX runtimes use `@system-one-ai/adapter-local` instead.
