# @system-one-ai/adapter-cloudflare

Run System One models on Cloudflare through its REST API or the native `env.AI` binding inside Workers. Install this package with `@system-one-ai/core` and `@system-one-ai/transport-fetch`.

```ts
import { createSystemOne } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { cloudflareAdapter } from '@system-one-ai/adapter-cloudflare';

const client = createSystemOne({
  adapter: cloudflareAdapter({ accountId: 'your-account' }),
  transport: createFetchTransport(),
  apiKey: process.env.API_KEY!,
});
```

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/adapter-cloudflare`.

Native Workers AI bindings are available through the explicit `@system-one-ai/adapter-cloudflare/workers` entry. `createCloudflareWorkers({ binding: env.AI })` implements core's `EvaluationClient` and needs no API token or REST account URL. The REST entry does not load the binding client. Both paths share validation and response codecs.

Select `model: '@cf/cloudflare/clef'` (or `@cf/cloudflare/clef-flash`) on either client or per request for Clef. Jev remains the default. Clef uses its model-specific REST path and required short input selector; the native binding receives the same input.

```ts
import { booleanQuestion, type ImageInput } from '@system-one-ai/core';

const images: readonly ImageInput[] = [{ mediaType: 'image/png', base64: receiptBase64 }];
await client.evaluate({
  model: '@cf/cloudflare/clef',
  state: 'Inspect the receipt.',
  questions: { refund: booleanQuestion('Does this receipt show a refund?') },
  images,
});
```

`receiptBase64` is supplied by the application. Images may instead be base64 data URLs. Core owns `ImageInput`, representation/base64 validation and request snapshots; this adapter converts `mediaType` to Cloudflare's `content_type` and enforces PNG/JPEG/WebP, up to four images, 4 MiB per image and 8 MiB total decoded bytes. Cloudflare enforces valid image contents, 16 megapixels per image and a 13 MiB request body; pixel dimensions and whole-request size are not checked locally. Remote URLs and video fields are unsupported. Text-only calls omit images; Jev rejects nonempty images. Nonempty provider options are not supported.

Protocol reference: [Cloudflare Clef](https://developers.cloudflare.com/workers-ai/models/clef/). In this repository, see `docs/cloudflare.md` and `docs/cloudflare-workers.md` for setup and verification limits.
