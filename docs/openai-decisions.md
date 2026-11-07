# OpenAI Decisions

**English** | [简体中文](openai-decisions.zh-CN.md)

OpenAI Decisions is an OpenAI wire protocol, not a Cloudflare-specific format. This repository keeps the protocol codec separate from every provider:

- `@system-one-ai/protocol-openai-decisions` converts System One questions/answers to and from the Decisions payload.
- `@system-one-ai/adapter-openai-decisions` calls OpenAI directly or any provider implementing the same contract.
- `@system-one-ai/adapter-cloudflare` only wraps the codec in Cloudflare's `/ai/run` runner, authentication and response envelopes.

## Direct OpenAI

```ts
import { createSystemOne, booleanQuestion } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { openAiDecisionsAdapter } from '@system-one-ai/adapter-openai-decisions';

const client = createSystemOne({
  adapter: openAiDecisionsAdapter,
  transport: createFetchTransport(),
  apiKey: process.env.OPENAI_API_KEY!,
});
const result = await client.evaluate({
  state: 'The same order was charged twice.',
  questions: { refund: booleanQuestion('Does the customer request a refund?') },
});
```

Defaults are `https://api.openai.com/v1`, `gpt-6-luna` and `POST /v1/decisions`.

## Compatible providers

Switch providers through the existing client configuration; the protocol code does not change:

```ts
const compatible = createSystemOne({
  adapter: openAiDecisionsAdapter,
  transport: createFetchTransport(),
  baseURL: 'https://provider.example/openai/v1',
  apiKey: process.env.PROVIDER_API_KEY!,
  model: 'provider/decisions-model',
});
```

`baseURL` may be an origin, a `/v1` root, or an endpoint already ending in `/decisions`. The adapter appends `/v1` only when the supplied path is empty, then appends `/decisions` unless present. Authentication, retries, timeouts, cancellation and response bounds remain the transport's responsibility.

For a provider with a different outer envelope or authentication model, depend on `protocol-openai-decisions` and write a thin adapter that wraps `encodeOpenAiDecisionsRequest()` and `decodeOpenAiDecisionsResponse()`. That is exactly what the Cloudflare adapter does.

## Mapping

| Core question | OpenAI Decisions |
| --- | --- |
| `boolean` | `predicate`; true/false criteria are appended to `instructions` |
| `choice` | `choice` with `choices: [{ value, description? }]` |
| `score` | `score` with ordered `levels: [{ label, description? }]` |

String states are sent directly as `input`. Object states and arrays of objects become one user message with an `input_json` content part whose `data` field contains the evidence. Arrays that cannot be represented by OpenAI's `input_json.data` schema, such as top-level arrays of primitives, fall back to JSON text. Images become ordered `input_image` data-URL parts alongside `input_text` for string state or `input_json` for structured state. Responses are matched by question name, with position used only when a name is absent. Predicates become boolean probabilities, choice probability arrays become option maps, and score probability arrays become index-keyed probabilities plus the original rubric legend. A `refusal` fails as `ResponseValidationError`.

OpenAI's native schema allows up to 400 questions; Cloudflare's proxied schema allows 200. Choice questions accept 2–255 options, and score questions accept 2–10 ordered levels. Cloudflare's published schema does not expose `input_json`, so its adapter explicitly requests text state encoding; that is a provider capability, not a different protocol. Nonempty `providerOptions` are currently unsupported. Decisions does not declare a rounding convention, so Jev-style two-decimal rounding is not applied.

Reviewed November 7, 2026: [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions) and [Cloudflare model page](https://developers.cloudflare.com/ai/models/openai/decisions/).
