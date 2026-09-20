# @system-one-ai/adapter-webgpu

Use the same System One client with OpenJev-compatible GGUF weights in a browser. The adapter loads the model with Wllama, which uses llama.cpp's WebGPU backend when the browser exposes WebGPU; no request is sent to a model API.

```ts
import { createOpenJevWebGPUClient } from '@system-one-ai/adapter-webgpu';
import { choice } from '@system-one-ai/core';

const client = await createOpenJevWebGPUClient({ model: 'qwen3-0.6b' });
const result = await client.evaluate({
  state: 'The customer cannot sign in after a password reset.',
  questions: { queue: choice('Which queue?', { access: 'Account access', billing: 'Billing' }) },
});
console.log(result.answers.queue);
```

The built-in model IDs pin the same GGUF files used by [SemIf/OpenJev](https://openjev.com/). To use another GGUF checkpoint, pass `modelUrl` and a stable `model` name. The model and Wllama runtime are downloaded by the browser and cached locally; set `wasmUrl` and use a local model URL for a fully self-hosted deployment.

The default Wllama module and WASM are loaded from jsDelivr. Strict CSP or air-gapped deployments should pass `wllama` (the imported Wllama module), `wasmUrl`, and a local `modelUrl`.

WebGPU requires a secure browser context (`https:` or localhost) and a compatible GPU. This package is browser-only; Python/CUDA/MLX runtimes use `@system-one-ai/adapter-local` instead.
