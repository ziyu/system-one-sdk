# Cloudflare Jev and Clef integration

**English** | [简体中文](cloudflare.zh-CN.md)

The independent `@system-one-ai/adapter-cloudflare` package supports Jev and the multimodal Clef / Clef Flash models, including REST and AI runner response envelopes. It supplies the REST URL; the application supplies an account ID, API token and optional model selection. Jev remains the default.

```ts
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { SystemOne, choice } from '@system-one-ai/core';
import { cloudflareAdapter } from '@system-one-ai/adapter-cloudflare';

const client = new SystemOne({
  transport: createFetchTransport(),
  adapter: cloudflareAdapter({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID! }),
  apiKey: process.env.CLOUDFLARE_API_TOKEN!,
});
const result = await client.evaluate({
  state: 'Please refund this duplicate charge.',
  questions: { team: choice('Who should handle the request?', {
    billing: 'Charges and refunds', support: 'Technical issues',
  }) },
});
console.log(result.answers.team.choice); // 'billing' | 'support'
```

`cloudflareAdapter` is a factory because the endpoint belongs to an account. It snapshots the account ID and returns a frozen `SystemOneAdapter`. Authentication, timeouts, cancellation, retries, response validation, and injected Fetch implementations remain the responsibility of the existing client. There are no new runtime dependencies. Applications can use this client with the existing decision composition, policies, and batch scheduler.

## Defaults and overrides

The default URL is `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run`; the default model is `typesafe/jev`. The client does not read environment variables. Examples explicitly pass the configuration shown above.

`baseURL` is optional. For a proxy, set it on `SystemOne`, alongside the adapter and key. These path forms preserve the selected origin and any proxy prefix. Clef appends its model ID to the resulting `/ai/run` path:

| Supplied path | Resulting path |
| --- | --- |
| Empty | `/client/v4/accounts/{accountId}/ai/run` |
| `/client/v4` or `/team/client/v4` | Append `/accounts/{accountId}/ai/run` |
| `/client/v4/accounts` | Append `/{accountId}/ai/run` |
| `/client/v4/accounts/{accountId}` | Append `/ai/run` |
| `/client/v4/accounts/{accountId}/ai` | Append `/run` |
| `/client/v4/accounts/{accountId}/ai/run` | Use unchanged |
| `/team/ai` or `/team/ai/run` | Use the proxy's `/team/ai/run` endpoint |

Trailing slashes are removed. An account segment in `baseURL` must match the adapter's account ID. Supply the base URL without a model suffix; the adapter adds the documented Clef suffix, while Jev keeps the runner path. A proxy endpoint without an account segment must route to the intended account itself. Account IDs are validated as a single nonempty segment containing letters, digits, underscores, or hyphens; the service determines whether that account actually exists.

Client `model` overrides the adapter default; per-request `model` overrides the client. `@cf/cloudflare/clef` and `@cf/cloudflare/clef-flash` select the Clef protocol below. Other explicit IDs retain the existing runner contract and must support the same decision primitives. Nonempty `providerOptions` are rejected; image input is a native core request field.

## Clef images

Use the full Workers AI model ID, not the short body selector. Images belong in core's `EvaluateRequest.images`, alongside `state` and `questions`. Both REST and the [native Workers client](cloudflare-workers.md) accept the same `ImageInput` type:

```ts
import { readFile } from 'node:fs/promises';
import type { ImageInput } from '@system-one-ai/core';

const images: readonly ImageInput[] = [
  { mediaType: 'image/png', base64: (await readFile('receipt.png')).toString('base64') },
];
const result = await client.evaluate({
  model: '@cf/cloudflare/clef', // or @cf/cloudflare/clef-flash
  state: 'Inspect the attached receipt.',
  questions: { team: choice('Who should handle it?', {
    billing: 'Payments and refunds', support: 'Technical issues',
  }) },
  images,
});
```

Each image is a base64 data URL (`data:image/png;base64,...`, JPEG or WebP), or `{ mediaType, base64 }`. Core exports `ImageInput`, validates the representation and base64, and snapshots it with the request. The Cloudflare adapter converts `mediaType` to the native `content_type`; callers never need that provider-specific field. Text-only calls omit `images`. Jev rejects nonempty image input, and remote URLs are rejected before authentication or binding invocation. The SDK never downloads images automatically.

Core requires adapters to opt in with `supportsImages: true`; unsupported image requests fail rather than silently becoming text-only. Cloudflare enforces its own PNG/JPEG/WebP formats, at most four images, 4 MiB decoded bytes per image and 8 MiB in total. These provider-specific limits do not restrict other core adapters. The service additionally enforces valid image content, 16 megapixels per image and a 13 MiB whole-request limit; the SDK does not decode pixels or enforce those last two limits. Images precede state at the model. Although the model description mentions video, the published API schema exposes only `images`; there is no SDK video-upload field or automatic frame extraction.

Reviewed October 4, 2026: [Clef](https://developers.cloudflare.com/workers-ai/models/clef/), [input schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json), [output schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-output.json), and [Clef Flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/). REST uses `POST /client/v4/accounts/{accountId}/ai/run/@cf/cloudflare/clef` with `{ model: "clef", state, questions, images? }`; Flash uses its own path and `model: "clef-flash"`. Workers calls `env.AI.run(fullModelId, sameInput, options)`. Both reuse native choice/score/noul decoding and token normalization without applying Jev's rounding convention.

## Wire contract and source references

Reviewed September 18, 2026. The [Cloudflare Jev model page](https://developers.cloudflare.com/ai/models/typesafe/jev/) specifies `POST /client/v4/accounts/{accountId}/ai/run` with Bearer authentication and a JSON body of `{ model, input: { state, questions } }`. This model-specific contract is the source for the adapter's request shape.

The model page shows native `choice`, `score`, and `noul` primitives. Its output contains `answers`, a resolved model ID when supplied, and snake-case token usage. The SDK maps `boolean` to `noul`, maps the returned `noul` to P(true), preserves the original choice probabilities, scores, legend and confidence, and normalizes usage to the common SDK contract. Missing optional statistics remain absent. Jev's two-decimal precision convention is retained; future non-Jev models must report their own rounding when needed.

The [general AI REST reference](https://developers.cloudflare.com/api/resources/ai/methods/run/) also documents Cloudflare response envelopes. The decoder accepts either the model result directly or a `result` wrapper. Any supplied `success` must be true and any supplied `errors` must be an empty array; root and nested errors are rejected. An ambiguous response containing both top-level answers and a wrapped result is rejected. HTTP errors retain the existing `APIError` semantics; errors inside an HTTP 200 response become non-retryable `ResponseValidationError` values without copying the upstream body.

Version 0.5.2 adds the reported AI runner compatibility shape: `{ success: true, result: { state: "Completed", result: modelResult } }`. A runner without the outer REST envelope is also accepted. Unwrapping is limited to two envelopes, and every layer is checked before it is removed. A supplied `state` must be exactly `"Completed"` with a `result`; failed or unfinished states are not polled. Simultaneous `answers` and `result` are rejected at any layer. The model result still passes the common answer, probability and usage validation. Runner fixtures are compatibility regression coverage; the model page itself illustrates the inner model result, not this additional runner envelope.

This entry calls REST through Fetch. The separate `@system-one-ai/adapter-cloudflare/workers` entry implements [native `env.AI.run()` calls](cloudflare-workers.md). The [REST setup guide](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) explains Cloudflare account and token setup. No automatic endpoint fallback or provider substitution takes place.

## Local verification

`tests/cloudflare-adapter.test.mjs` contains independent fixtures for raw, REST-wrapped and runner results, URL construction, account validation, explicit overrides, malformed responses, retries, cancellation, and a real local HTTP server using native Fetch. It checks failed/malformed states and nested errors even when valid-looking answers are present. Composition, batch and installed ESM/CommonJS package checks also exercise runner responses. `tests/adapter-defaults.test.mjs` checks omitted URLs/models and explicit overrides for every built-in adapter. These are offline checks, not model inference.

The opt-in integration command reads `.env.cloudflare` directly. It does not inherit credentials from another provider or silently use another endpoint. In the repository:

```sh
cp .env.cloudflare.example .env.cloudflare
# Fill in CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.
npm run example:cloudflare
npm run test:live:cloudflare
```

The example accepts optional URL/model overrides. Set `SYSTEM_ONE_MODEL=@cf/cloudflare/clef` (or `@cf/cloudflare/clef-flash`) and optionally `CLOUDFLARE_IMAGE_PATH=./receipt.png` for image input. The live check allows Jev and both Clef IDs on the official endpoint and rejects proxy overrides. It makes three text inference requests with no retries: a mixed-primitives object state, a Chinese action request, and positive/negative boolean questions over an array state. Supplying an image adds one image request; its probability contract is checked, not semantic accuracy on an unlabeled image. It saves results, observed HTTP status, model, reported usage, timings and response headers selected for diagnostics to `.artifacts/live-cloudflare.json` and a timestamped copy. API tokens, authorization headers and image bytes are excluded, and the endpoint masks the account ID.

Hosted inference was verified using credentials supplied in the repository's `.env`: 24 Clef / Clef Flash requests returned HTTP 200 without retries. Synthetic red/blue square images covered PNG/JPEG/WebP, object and data-URL representations, four-image ordering, empty-string state, concurrent/queued batches, asynchronous credential snapshots, decision/policy composition and evaluation state variants. These are small-sample connectivity and semantic checks, not a model benchmark. The standard live command above still reads its dedicated `.env.cloudflare`; this mixed-provider verification used temporary runners without changing credentials or SDK configuration. Actual Workers `env.AI` inference remains blocked by development/preview permissions; it is not implied by REST success. See [validation history](validation.md) for reports and limits. Ordinary tests and CI never run paid inference.
