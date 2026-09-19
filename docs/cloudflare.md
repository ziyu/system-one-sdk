# Cloudflare Jev integration

**English** | [简体中文](cloudflare.zh-CN.md)

The independent `@system-one-ai/adapter-cloudflare` package handles REST and AI runner response envelopes. It supplies the REST URL and model; the application supplies an account ID and API token.

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

`baseURL` is optional. For a proxy, set it on `SystemOne`, alongside the adapter and key. These path forms preserve the selected origin and any proxy prefix:

| Supplied path | Resulting path |
| --- | --- |
| Empty | `/client/v4/accounts/{accountId}/ai/run` |
| `/client/v4` or `/team/client/v4` | Append `/accounts/{accountId}/ai/run` |
| `/client/v4/accounts` | Append `/{accountId}/ai/run` |
| `/client/v4/accounts/{accountId}` | Append `/ai/run` |
| `/client/v4/accounts/{accountId}/ai` | Append `/run` |
| `/client/v4/accounts/{accountId}/ai/run` | Use unchanged |
| `/team/ai` or `/team/ai/run` | Use the proxy's `/team/ai/run` endpoint |

Trailing slashes are removed. An account segment in `baseURL` must match the adapter's account ID. Legacy model-in-path endpoints are rejected rather than guessed. A proxy endpoint without an account segment must route to the intended account itself. Account IDs are validated as a single nonempty segment containing letters, digits, underscores, or hyphens; the service determines whether that account actually exists.

Client `model` overrides the adapter default; per-request `model` overrides the client. Explicit IDs are sent unchanged. Supporting another model requires that it accept the same decision primitives and wire contract. Nonempty `providerOptions` are rejected because this adapter currently implements only the documented Jev `state` and `questions` input fields.

## Wire contract and source references

Reviewed September 18, 2026. The [Cloudflare Jev model page](https://developers.cloudflare.com/ai/models/typesafe/jev/) specifies `POST /client/v4/accounts/{accountId}/ai/run` with Bearer authentication and a JSON body of `{ model, input: { state, questions } }`. This model-specific contract is the source for the adapter's request shape.

The model page shows native `choice`, `score`, and `noul` primitives. Its output contains `answers`, a resolved model ID when supplied, and snake-case token usage. The SDK maps `boolean` to `noul`, maps the returned `noul` to P(true), preserves the original choice probabilities, scores, legend and confidence, and normalizes usage to the common SDK contract. Missing optional statistics remain absent. Jev's two-decimal precision convention is retained; future non-Jev models must report their own rounding when needed.

The [general AI REST reference](https://developers.cloudflare.com/api/resources/ai/methods/run/) also documents Cloudflare response envelopes. The decoder accepts either the model result directly or a `result` wrapper. Any supplied `success` must be true and any supplied `errors` must be an empty array; root and nested errors are rejected. An ambiguous response containing both top-level answers and a wrapped result is rejected. HTTP errors retain the existing `APIError` semantics; errors inside an HTTP 200 response become non-retryable `ResponseValidationError` values without copying the upstream body.

Version 0.5.2 adds the reported AI runner compatibility shape: `{ success: true, result: { state: "Completed", result: modelResult } }`. A runner without the outer REST envelope is also accepted. Unwrapping is limited to two envelopes, and every layer is checked before it is removed. A supplied `state` must be exactly `"Completed"` with a `result`; failed or unfinished states are not polled. Simultaneous `answers` and `result` are rejected at any layer. The model result still passes the common answer, probability and usage validation. Runner fixtures are compatibility regression coverage; the model page itself illustrates the inner model result, not this additional runner envelope.

This adapter calls REST through Fetch. Cloudflare's native Workers `env.AI.run()` binding is a separate interface and is not implemented by this entry point. The [REST setup guide](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) explains Cloudflare account and token setup. No automatic endpoint fallback or provider substitution takes place.

## Local verification

`tests/cloudflare-adapter.test.mjs` contains independent fixtures for raw, REST-wrapped and runner results, URL construction, account validation, explicit overrides, malformed responses, retries, cancellation, and a real local HTTP server using native Fetch. It checks failed/malformed states and nested errors even when valid-looking answers are present. Composition, batch and installed ESM/CommonJS package checks also exercise runner responses. `tests/adapter-defaults.test.mjs` checks omitted URLs/models and explicit overrides for every built-in adapter. These are offline checks, not model inference.

The opt-in integration command reads `.env.cloudflare` directly. It does not inherit credentials from another provider or silently use another endpoint. In the repository:

```sh
cp .env.cloudflare.example .env.cloudflare
# Fill in CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.
npm run example:cloudflare
npm run test:live:cloudflare
```

The example accepts optional URL/model overrides. The live check exercises the official defaults and rejects conflicting overrides. On success it makes three inference requests with no retries: a mixed-primitives object state, a Chinese action request, and positive/negative boolean questions over an array state. It saves results, observed HTTP status, model, reported usage, timings and response headers selected for diagnostics to `.artifacts/live-cloudflare.json` and a timestamped copy. API tokens and authorization headers are excluded, and the endpoint masks the account ID.

At implementation time the project had no Cloudflare credentials or `.env.cloudflare`; the integration command exited at configuration with zero requests. Live Cloudflare inference and execution inside a Workers runtime remain unverified. See [validation history](validation.md) for the checks actually executed. Ordinary tests and CI never run the live command.
