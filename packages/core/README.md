# @system-one-ai/core

Create a shared `evaluate` client, define choice, score and boolean questions, and validate model answers. Supply the adapter for your model service and a transport when creating the client.

```ts
import { createSystemOne } from '@system-one-ai/core';
// Supply an explicit adapter and transport to createSystemOne({ adapter, transport, apiKey }).
```

## Native image input

`EvaluateRequest.images` is part of the core request, alongside `state` and `questions`. Import `ImageInput` from this package:

```ts
import { booleanQuestion, type ImageInput } from '@system-one-ai/core';

const images: readonly ImageInput[] = [{ mediaType: 'image/png', base64: imageBase64 }];
await client.evaluate({
  state: 'Inspect the attached image.',
  images,
  questions: { document: booleanQuestion('Is this a document?') },
});
```

`client` must use an image-capable adapter; `imageBase64` is supplied by the application. Each image is an embedded base64 data URL or `{ mediaType: 'image/...', base64 }`. Core validates the representation and padded base64, and snapshots images before asynchronous authentication, queuing or retries. It never downloads URLs or decodes pixels. `state` remains required and can be an empty string for an image-only task.

Adapters explicitly declare `supportsImages: true`. Without it, a nonempty image request fails with `UnsupportedFeatureError` before adapter preparation or transport execution; images are never silently downgraded to text. The adapter still enforces the selected model's formats, size limits and wire encoding. Core does not impose Cloudflare's PNG/JPEG/WebP list or count/byte limits on other providers. No audio/video request fields are defined.

`defineDecision`, `evaluateMany` and `runEvaluation` retain the same core image field; local model runners opt in with `supportsImages: true`. Cloudflare Clef supports images in both REST and Workers, while existing text-only adapters reject them.

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/core`.
