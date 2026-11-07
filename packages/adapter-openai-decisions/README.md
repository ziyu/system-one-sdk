# @system-one-ai/adapter-openai-decisions

Call the OpenAI Decisions API, or another provider that implements the same `openai/decisions` wire contract, through one System One adapter. Install this package with `@system-one-ai/core` and `@system-one-ai/transport-fetch`.

```ts
import { createSystemOne } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { openAiDecisionsAdapter } from '@system-one-ai/adapter-openai-decisions';

const client = createSystemOne({
  adapter: openAiDecisionsAdapter,
  transport: createFetchTransport(),
  apiKey: process.env.OPENAI_API_KEY!,
});
```

Defaults are `https://api.openai.com/v1`, model `gpt-6-luna`, and `POST /v1/decisions`. Switch providers without changing the protocol code:

```ts
const compatible = createSystemOne({
  adapter: openAiDecisionsAdapter,
  transport: createFetchTransport(),
  baseURL: 'https://provider.example/v1',
  apiKey: process.env.PROVIDER_API_KEY!,
  model: 'provider/decisions-model',
});
```

`baseURL` may be an API root, a `/v1` root, or an endpoint already ending in `/decisions`; a trailing slash is removed. The transport supplies the Bearer token, retries, timeout, cancellation and response bounds.

The adapter maps core `boolean` to `predicate`, `choice` to `choice`, and `score` to `score`. Object state and arrays of objects are sent as `input_json` evidence; images become ordered user-message `input_image` data URLs. Responses are matched by question name, with position used only when a name is absent. Refusals fail as `ResponseValidationError`. The native limit is 400 questions, choice questions accept 2–255 options, and score questions accept 2–10 levels. Nonempty `providerOptions` are not supported.

The protocol codec is also available from `@system-one-ai/protocol-openai-decisions` for adapter authors. Requires Node.js 20+.
