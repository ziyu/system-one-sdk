# Native Cloudflare Workers AI binding

**English** | [简体中文](cloudflare-workers.zh-CN.md)

Migrated from SDK 0.5.3 into the independent Cloudflare package, this entry complements the Cloudflare REST adapter. Import `@system-one-ai/adapter-cloudflare/workers` to call `env.AI.run()` directly. The client implements `EvaluationClient`, so existing `defineDecision()`, policies and `evaluateMany()` callers retain their interface. The binding reuses core validation, the native codec and transport response utilities without invoking Fetch.

```ts
import { choice } from '@system-one-ai/core';
import { createCloudflareWorkers } from '@system-one-ai/adapter-cloudflare/workers';

const client = createCloudflareWorkers({
  binding: env.AI,
  timeoutMs: 1500,
  maxRetries: 0,
});
const result = await client.evaluate({
  state: { message: 'I was charged twice.' },
  questions: {
    department: choice('Which team should handle this?', {
      billing: 'Payments, charges, refunds',
      technical: 'Bugs and integration problems',
    }),
  },
}, { signal: request.signal });
```

Add `"ai": { "binding": "AI" }` to the service's Wrangler configuration. Model API keys, account IDs and REST base URLs are not constructor options: the deployment supplies the binding. Deployment authentication and inference billing still apply. Your System One API service continues to own public authentication, tenant scope, quotas and its response contract. Outside Workers, continue using `SystemOne` with the REST `cloudflareAdapter`.

## Interface and lifecycle

The optional entry exports `CloudflareWorkers`, `createCloudflareWorkers`, `CloudflareWorkersOptions` and `CloudflareAiBinding`. Native `ImageInput` belongs to `@system-one-ai/core`, not this provider package. The structural binding interface avoids requiring a Cloudflare package in SDK consumers. Model defaults to `typesafe/jev`; a request-level model overrides the client model.

The client requests `returnRawResponse: true` and forwards its total-deadline `AbortSignal`. Cloudflare envelope decoding and bounded UTF-8/JSON Response reading are shared with the REST client. Public `boolean` questions map to native `noul`, and answers retain P(true), distributions, confidence, warnings and reported usage.

Metadata comes from each actual Response, including status and `cf-ai-req-id` (after standard request-ID headers). The client never reads shared binding fields such as `lastRequestId`. Missing statistics stay absent. Inputs and headers are snapshotted before waiting, and each retry supplies a fresh input copy without altering the original validation snapshot.

Defaults: `timeoutMs=10000`, `maxRetries=2`, `retryDelayMs=200`, `maxRetryDelayMs=2000`, `maxResponseBytes=8 MiB`. Per-call options accept `signal`, `timeoutMs`, `maxRetries` and `headers`. Set zero retries for latency-sensitive service calls. Application headers use binding `extraHeaders`; authentication, protocol and `cf-consn-*` headers cannot be overridden. Clef accepts core's native `images` field; Jev rejects nonempty image input. Nonempty `providerOptions`, Gateway routing, websocket, streaming and queued inference remain outside this interface.

HTTP 408, 429 and 5xx errors and interrupted body reads can retry within the same total budget. `Retry-After` is never shortened. A binding exception before a Response returns produces sanitized `BindingError` (`code: 'binding'`, exported by the core error API), with no upstream message/cause, guessed HTTP status or automatic retry. Invalid results and failed/pending runners also reject without retry.

Cancellation and timeout remain distinct (`RequestAbortedError` and `TimeoutError`). The SDK bounds waiting even for an uncooperative custom binding and cancels late response bodies best-effort. Forwarding a signal does not guarantee termination of remote inference or avoided billing. The client never substitutes a different model.

## Clef images

```ts
const vision = createCloudflareWorkers({ binding: env.AI, model: '@cf/cloudflare/clef' });
const result = await vision.evaluate({
  state: 'Inspect the attached receipt.',
  questions: { department: choice('Route it to:', { billing: 'Payments', technical: 'Software issues' }) },
  images: [{ mediaType: 'image/png', base64: receiptBase64 }],
});
```

`receiptBase64` is the application's base64-encoded PNG. Choose `@cf/cloudflare/clef-flash` for Flash. The binding receives that full ID and an input with `model: "clef"` or `"clef-flash"`, `state`, native `questions` and optional `images`. The shared codec validates embedded PNG/JPEG/WebP images and count/byte limits before invoking the binding. Caller and binding mutations cannot alter retry images. See [image formats, provider limits and protocol sources](cloudflare.md#clef-images); remote URLs and video uploads are not supported.

## Example and validation

`examples/cloudflare-workers/` contains a fixed-input smoke Worker. It uses a POST route to opt into inference, and its Wrangler configuration disables public workers.dev routes. With an authenticated Wrangler installation, run `wrangler dev --config examples/cloudflare-workers/wrangler.jsonc` and POST to the printed local URL. Each request uses real Cloudflare AI inference and consumes usage; do not expose the example as an unauthenticated production API.

`tests/cloudflare-workers.test.mjs` covers primitive conversion, response envelopes, invalid inputs/results, deadlines, cancellation, retries, per-response metadata, snapshots, composition and optional ESM/CJS entries. `tests/types/cloudflare-workers.ts` checks inference and the core/subpath boundary. These fixture tests do not establish deployed Workers execution, real Cloudflare inference, model quality or a latency improvement; those require separate checks.

Run `npm run build` followed by `node scripts/test-cloudflare-workers-runtime.mjs` for the separate Workers integration check. It installs Wrangler 4.135.0 and the independent package tarballs in an isolated temporary consumer, verifies generated `Env.AI` and Workers Web API types without casts or skipped declaration checks, and runs nine scenarios in workerd without `nodejs_compat`: success, Clef images with retry isolation, retry, cancel, timeout, invalid output, oversized output, parallel request IDs and composition. These controlled-fixture checks passed again during the live verification. Clef hosted inference is verified separately through REST, but an actual remote `env.AI` session could not authenticate: the supplied account token was active and could list Workers, while `/accounts/{accountId}/workers/subdomain` returned HTTP 403 / code 10000. No Worker was deployed and no binding inference request was made. Supply the necessary Workers development/preview permissions to complete that check. See [validation history](validation.md). Historical feature checks: [Node CI](https://github.com/ziyu/sytem-one-sdk/actions/runs/35352387802) and [Workers runtime](https://github.com/ziyu/sytem-one-sdk/actions/runs/35352387792).

Protocol references checked September 18, 2026: [Jev model](https://developers.cloudflare.com/ai/models/typesafe/jev/), [binding configuration](https://developers.cloudflare.com/workers-ai/configuration/bindings/), and [workerd AI implementation](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts) for `signal`, `returnRawResponse` and `extraHeaders`.
