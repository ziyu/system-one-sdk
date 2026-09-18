# Native Cloudflare Workers AI binding

**English** | [简体中文](cloudflare-workers.zh-CN.md)

This unreleased entry complements the REST support shipped in 0.5.2. Import `@system-one-ai/sdk/cloudflare-workers` to call `env.AI.run()` directly. The client implements `EvaluationClient`, so existing `defineDecision()`, policies and `evaluateMany()` callers retain their interface. Runtime dependencies remain unchanged.

```ts
import { choice } from '@system-one-ai/sdk';
import { createCloudflareWorkers } from '@system-one-ai/sdk/cloudflare-workers';

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

The optional entry exports `CloudflareWorkers`, `createCloudflareWorkers`, `CloudflareWorkersOptions` and `CloudflareAiBinding`. The structural binding interface avoids requiring a Cloudflare package in SDK consumers. Model defaults to `typesafe/jev`; a request-level model overrides the default.

The client requests `returnRawResponse: true` and forwards its total-deadline `AbortSignal`. Cloudflare envelope decoding and bounded UTF-8/JSON Response reading are shared with the REST client. Public `boolean` questions map to native `noul`, and answers retain P(true), distributions, confidence, warnings and reported usage.

Metadata comes from each actual Response, including status and `cf-ai-req-id` (after standard request-ID headers). The client never reads shared binding fields such as `lastRequestId`. Missing statistics stay absent. Inputs and headers are snapshotted before waiting, and each retry supplies a fresh input copy without altering the original validation snapshot.

Defaults: `timeoutMs=10000`, `maxRetries=2`, `retryDelayMs=200`, `maxRetryDelayMs=2000`, `maxResponseBytes=8 MiB`. Per-call options accept `signal`, `timeoutMs`, `maxRetries` and `headers`. Set zero retries for latency-sensitive service calls. Application headers use binding `extraHeaders`; authentication, protocol and `cf-consn-*` headers cannot be overridden. Nonempty `providerOptions` are rejected; Gateway routing, websocket, streaming and queued inference are outside this initial interface.

HTTP 408, 429 and 5xx errors and interrupted body reads can retry within the same total budget. `Retry-After` is never shortened. A binding exception before a Response returns produces sanitized `BindingError` (`code: 'binding'`, exported by the core error API), with no upstream message/cause, guessed HTTP status or automatic retry. Invalid results and failed/pending runners also reject without retry.

Cancellation and timeout remain distinct (`RequestAbortedError` and `TimeoutError`). The SDK bounds waiting even for an uncooperative custom binding and cancels late response bodies best-effort. Forwarding a signal does not guarantee termination of remote inference or avoided billing. The client never substitutes a different model.

## Example and validation

`examples/cloudflare-workers/` contains a fixed-input smoke Worker. It uses a POST route to opt into inference, and its Wrangler configuration disables public workers.dev routes. With an authenticated Wrangler installation, run `wrangler dev --config examples/cloudflare-workers/wrangler.jsonc` and POST to the printed local URL. Each request uses real Cloudflare AI inference and consumes usage; do not expose the example as an unauthenticated production API.

`tests/cloudflare-workers.test.mjs` covers primitive conversion, response envelopes, invalid inputs/results, deadlines, cancellation, retries, per-response metadata, snapshots, composition and optional ESM/CJS entries. `tests/types/cloudflare-workers.ts` checks inference and the core/subpath boundary. These fixture tests do not establish deployed Workers execution, real Cloudflare inference, model quality or a latency improvement; those require separate checks.

Protocol references checked September 18, 2026: [Jev model](https://developers.cloudflare.com/ai/models/typesafe/jev/), [binding configuration](https://developers.cloudflare.com/workers-ai/configuration/bindings/), and [workerd AI implementation](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts) for `signal`, `returnRawResponse` and `extraHeaders`.
