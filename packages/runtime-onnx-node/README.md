# @system-one-ai/runtime-onnx-node

Run local System One ONNX models inside the Node.js process. There is no Python environment, subprocess, HTTP server, or sidecar.

Install the native ONNX runtime alongside this package:

```sh
npm install @system-one-ai/core @system-one-ai/adapter-local @system-one-ai/runtime-onnx-node onnxruntime-node
```

The stable client remains model-agnostic:

```ts
import { createNativeClient } from '@system-one-ai/adapter-local';
import { createOnnxDriver, createLayaOnnxModel } from '@system-one-ai/runtime-onnx-node';

const client = await createNativeClient({
  driver: createOnnxDriver({
    model: createLayaOnnxModel({ manifestPath: './models/laya/laya.json' }),
  }),
});
```

Laya tokenization additionally needs `@huggingface/transformers`. Install it when using `createLayaOnnxModel()` without an injected tokenizer.

Large ONNX exports may keep weights in external data files. The Node binding resolves those files from the ONNX model path, so the Laya plugin leaves them on disk instead of reading multi-gigabyte weights into JavaScript memory.

CPU is the portable default for `onnxruntime-node`. Set `device: 'coreml'` on macOS to request CoreML with CPU fallback for unsupported graph nodes, or pass an explicit `executionProviders` list for advanced ONNX Runtime configurations. The package does not silently select CUDA or DirectML because those providers are not available on every machine.

`createOnnxDriver()` accepts any `OnnxModelPlugin`, so future System One ONNX model families can reuse the same runtime and native client API.
