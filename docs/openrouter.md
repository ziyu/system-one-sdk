# OpenRouter Decisions integration

The OpenRouter adapter is an optional entry point added for the 0.3.0 source version:

```ts
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { SystemOne } from '@system-one-ai/core';
import { openRouterAdapter } from '@system-one-ai/adapter-openrouter';

const client = new SystemOne({
  transport: createFetchTransport(),
  adapter: openRouterAdapter,
  apiKey: process.env.SYSTEM_ONE_API_KEY!,
});
```

The adapter supplies the OpenRouter URL and `~typesafe/jev-latest` model. `baseURL` and `model` are optional overrides for proxies or explicit model selection. The core entry point does not load this adapter. There is no OpenRouter SDK dependency, and the existing native TypeSafe and optional Vercel interfaces stay unchanged.

## Verified wire contract

Research date: September 18, 2026. OpenRouter uses `POST /api/alpha/decisions` with Bearer authentication and a JSON object containing `model`, `state`, and `questions`. True/false questions use native `noul`; responses return `answers`, the resolved `model`, optional `id` and `provider`, and `usage.input_tokens`, `usage.output_tokens`, and optional `usage.cost`.

The local adapter converts the SDK's `boolean` questions to `noul`, normalizes the answer and token fields, and preserves native statistics. Generation ID, provider, and cost are exposed under `result.providerMetadata.openrouter`. A missing optional statistic remains absent; the adapter does not invent a confidence score or fee. TypeSafe's rounding convention is applied to Jev answers, not to arbitrary future models.

The default model ID is exactly `~typesafe/jev-latest`. Explicit IDs are sent unchanged, including the leading `~`. TypeSafe-direct `jev-latest` is a different provider's name. The local `.env.openrouter` model field was corrected to the requested OpenRouter ID; its key was retained.

Additional documented fields are available under `providerOptions.openrouter` using API-native spelling: `provider`, `session_id`, `trace`, and `user`. They cannot override the request's model, state, questions, or streaming behavior. App attribution headers can be supplied through `headers`.

Sources inspected from OpenRouter's official site and official TypeScript SDK:

- [Jev Latest](https://openrouter.ai/~typesafe/jev-latest): model alias.
- [Decisions request function](https://github.com/OpenRouterTeam/typescript-sdk/blob/main/src/funcs/decisionsCreate.ts): HTTP path, method, headers, and response handling.
- [Decisions request body](https://github.com/OpenRouterTeam/typescript-sdk/blob/main/src/models/decisionsrequest.ts): native request fields and `session_id` mapping.
- [Decisions response](https://github.com/OpenRouterTeam/typescript-sdk/blob/main/src/models/decisionsresponse.ts): answers, generation ID, resolved model, provider, and usage.
- [Generation metadata API](https://openrouter.ai/docs/api/api-reference/generations/get-generation): authenticated lookup by generation ID.

This is an alpha API. The adapter encodes the verified protocol, not a promise that arbitrary future changes will remain compatible.

## Real inference results

Four requests were sent from this project's `.env.openrouter` using an instrumented native Fetch. The instrumentation records request destinations and non-sensitive response headers; it does not substitute responses. Each POST used `~typesafe/jev-latest`, returned HTTP 200, resolved to `typesafe/jev-1.13-20260917`, and reported provider `TypeSafe`. No POST retries or alternate-model substitution were used.

Inference window: **2026-09-18 03:17:46–03:17:48 UTC** (September 18, 11:17:46–11:17:48 in China; September 17, 20:17:46–20:17:48 in Los Angeles).

| Scenario | Result | End-to-end time | Input / output tokens | Reported cost |
| --- | --- | --- | --- | --- |
| Chinese action request, object state, all three primitives | `drink`; urgency `1.05`; interrupt probability `0.81` | 1,062 ms | 490 / 69 | 0.000020580 |
| Refund routing, string state | `billing` | 298 ms | 392 / 38 | 0.000016464 |
| Software issue, array state | Severity `1` | 327 ms | 377 / 17 | 0.000015834 |
| Positive and negative boolean judgments | Light on `0.01`; door open `0.99` | 318 ms | 354 / 40 | 0.000014868 |

Total: **1,613 input tokens, 164 output tokens, 1,777 total tokens**. Summed `usage.cost`: **0.000067746**. These are four small integration checks, not a performance or accuracy benchmark. Timings include client and network overhead.

## Independent backend lookup

After inference, the script used the same key to query `GET /api/v1/generation?id=...` for each returned generation ID. The first immediate lookup phase did not complete successfully. A later `--verify-only` run reused the original IDs and successfully retrieved all four records without sending any new inference requests.

| Scenario | Generation ID |
| --- | --- |
| Chinese action | `gen-dec-1789701467-XonUGZkfEEp7erkpnH1k` |
| Refund routing | `gen-dec-1789701467-fbYoeKbmNvlvlZWdSBud` |
| Software severity | `gen-dec-1789701467-oYSugqjsBDlgbGfocUgW` |
| Boolean judgments | `gen-dec-1789701468-qRUeQ9QAlVzHSEuEkzAx` |

All records identify `api_type: decisions`, the same model and provider, and the same session ID:

```text
system-one-sdk-374b9225-8670-4546-8bf4-9ef1161de60e
```

The records' `native_tokens_prompt`, `native_tokens_completion`, and `total_cost` match the inference responses. In these four records, the generic `tokens_prompt` and `tokens_completion` fields are zero; the actual native token counts are in the `native_tokens_*` fields. `request_id` is null in these records, so the returned generation ID is the identifier used for reconciliation.

Local reports retain the original timestamps and IDs under `.artifacts/live-openrouter*.json`. Credentials, authentication headers, and private configuration files are excluded from git and package contents. The original failed audit and later successful audit are saved separately.

## Reproduce

```sh
# Four new inference requests plus authenticated generation lookups:
npm run test:live:openrouter

# Only recheck the existing generation IDs, with no new inference:
node scripts/test-openrouter-live.mjs --verify-only
```

The script reads `.env.openrouter` directly so inherited shell credentials do not override it. Its live target is restricted to the configured OpenRouter origin and the requested model. New runs receive a unique session ID. Inference and backend lookup failures both produce a nonzero exit code and a saved diagnostic report.
