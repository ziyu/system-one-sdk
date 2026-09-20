# @system-one-ai/model-laya

Optional Laya model support for System One. The root entry validates `laya.json`, renders questions, applies checkpoint token budgets and converts logits into typed answers. Runtime integrations are explicit subpath exports, so generic runtimes never depend on Laya.

## Browser

```ts
import { createBrowserClient } from '@system-one-ai/adapter-webgpu';
import { createLayaDriver } from '@system-one-ai/model-laya/browser';

const client = await createBrowserClient({
  driver: createLayaDriver({ manifestUrl: '/models/laya/laya.json' }),
});
```

The browser driver uses ONNX Runtime WebGPU when available and falls back to WASM/CPU. It loads the tokenizer and model assets described by the manifest.

## Node.js

```sh
npm install @system-one-ai/model-laya @system-one-ai/runtime-onnx-node onnxruntime-node @huggingface/transformers
```

```ts
import { createNativeClient } from '@system-one-ai/adapter-local';
import { createOnnxDriver } from '@system-one-ai/runtime-onnx-node';
import { createLayaOnnxModel } from '@system-one-ai/model-laya/node';

const client = await createNativeClient({
  driver: createOnnxDriver({
    model: createLayaOnnxModel({ manifestPath: './models/laya/laya.json' }),
  }),
});
```

The manifest is data: asset paths, token IDs, length limits and calibration values. Prompt construction, tokenizer calls, truncation, tensor layout and output decoding remain code because they are part of Laya's execution protocol.

The [export tool](../../scripts/laya/README.md) produces the complete graph, tokenizer and manifest. Serve or copy the whole exported directory. The browser and Node plugins share the same rendering and calibration implementation.
