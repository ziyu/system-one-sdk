# @system-one-ai/runtime-onnx-node

Run arbitrary ONNX model plugins inside the Node.js process. This package owns ONNX Runtime session lifecycle, device selection, cancellation and disposal; it does not depend on any concrete model package.

Install the native runtime alongside it:

```sh
npm install @system-one-ai/core @system-one-ai/adapter-local @system-one-ai/runtime-onnx-node onnxruntime-node
```

```ts
import { createNativeClient } from '@system-one-ai/adapter-local';
import { createOnnxDriver } from '@system-one-ai/runtime-onnx-node';
import { myModel } from './my-model.js';

const client = await createNativeClient({
  driver: createOnnxDriver({ model: myModel }),
});
```

A model family implements `OnnxModelPlugin` and supplies its model path, supported question types, session validation and evaluation logic. Laya is one optional implementation, exported from `@system-one-ai/model-laya/node`.

CPU is the portable default for `onnxruntime-node`. Set `device: 'coreml'` on macOS to request CoreML with CPU fallback for unsupported graph nodes, or pass an explicit `executionProviders` list for advanced configurations. The package does not silently select CUDA or DirectML because those providers are not available on every machine.
