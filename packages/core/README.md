# @system-one-ai/core

Create a shared `evaluate` client, define choice, score and boolean questions, and validate model answers. Supply the adapter for your model service and a transport when creating the client. Extraction models such as Clairic use `extract({ state, fields })` on the same client.

```ts
import { createSystemOne } from '@system-one-ai/core';
// Supply an explicit adapter and transport to createSystemOne({ adapter, transport, apiKey }).
```

## Clairic extraction

```ts
import { createSystemOne, defineFields, textField, numberField, dateField } from '@system-one-ai/core';
// const client = createSystemOne({ adapter, transport, apiKey });

const result = await client.extract({
  model: 'clairic',
  state: 'Invoice INV-2291 from Northwind Supply, issued 2026-09-02, net 30.',
  fields: defineFields({
    invoice_number: textField(),
    due_date: dateField({ instructions: 'Issue date plus the net payment days' }),
    total: numberField({ decimals: 2, unit: 'USD' }),
  }),
});
const invoice: string | null = result.answers.invoice_number.value;
```

`state` must be a nonempty string unless `images` are sent. Fields are a discriminated union of `text`, `number`, `date`, `time`, `datetime`, `duration`, `list`, `estimate` and `forecast`. Core validates field names, per-type properties, image representation/limits (PNG/JPEG/WebP, at most four, 4 MiB each, 8 MiB total decoded) and a 16 MiB JSON body. Adapters must set `supportsExtract: true`. See [Clairic extraction](../../docs/clairic.md).

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
