# Migrate SDK 0.5.3 to independent packages

All 11 independent packages are available as stable `0.6.0` on npm under `latest`. The commands below install the current stable packages; append `@0.6.0` to each package to pin this batch. The old `@system-one-ai/sdk@0.5.3` remains installable, with an npm deprecation notice linking here. See the [published-package verification](validation.md).

## Imports

| SDK 0.5.3 entry / export | New entry |
| --- | --- |
| `@system-one-ai/sdk`: `SystemOne`, `createSystemOne`, question builders, all types and errors (including `BindingError`) | `@system-one-ai/core` |
| `@system-one-ai/sdk`: `systemOneAdapter` | `@system-one-ai/adapter-system-one` |
| `@system-one-ai/sdk/adapters/openrouter` | `@system-one-ai/adapter-openrouter` |
| `@system-one-ai/sdk/adapters/vercel` | `@system-one-ai/adapter-vercel` |
| `@system-one-ai/sdk/adapters/cloudflare` | `@system-one-ai/adapter-cloudflare` |
| `@system-one-ai/sdk/cloudflare-workers` | `@system-one-ai/adapter-cloudflare/workers` |
| `@system-one-ai/sdk/decisions` | `@system-one-ai/decisions` |
| `@system-one-ai/sdk/policies` | `@system-one-ai/policies` |
| `@system-one-ai/sdk/batch` | `@system-one-ai/batch` |
| `@system-one-ai/sdk/package.json` | Each installed package's own `/package.json` |
| Implicit Fetch execution / `SystemOneOptions.fetch` | `@system-one-ai/transport-fetch`: `createFetchTransport(fetch?)` |

Composition and provider exports retain their names. There is no forwarding SDK package in this workspace. `adapter-llm` is a new, optional package; its OpenAI and Anthropic support stays together. Native codecs live in `protocol-system-one`, installed automatically by native adapters.

## TypeSafe and custom Fetch

Install only the packages imported by the application:

```sh
npm install @system-one-ai/core @system-one-ai/transport-fetch @system-one-ai/adapter-system-one
```

```ts
import { createSystemOne, choice, score, booleanQuestion } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { systemOneAdapter } from '@system-one-ai/adapter-system-one';

const client = createSystemOne({
  apiKey: process.env.SYSTEM_ONE_API_KEY!,
  adapter: systemOneAdapter,
  transport: createFetchTransport(),
});
const result = await client.evaluate({
  state: { lampOn: true, temperature: 20 },
  questions: {
    on: booleanQuestion('Is the lamp on?'),
    temperature: choice('Temperature?', { twenty: '20 C', thirty: '30 C' }),
    level: score('Lamp state?', ['Off', 'On']),
  },
});
console.log(result.answers);
```

Previously `new SystemOne({ apiKey, fetch: customFetch })` supplied native defaults. Now both `adapter` and `transport` are required; use `transport: createFetchTransport(customFetch)` to inject Fetch. An omitted adapter/transport is a configuration error. `Fetch` remains a core type; `Transport`, `TransportRequest` and `TransportOptions` define the new execution contract.

## Other HTTP providers and LLM

Keep the same client setup and replace its adapter with `openRouterAdapter`, `vercelAdapter`, or `cloudflareAdapter({ accountId })` from the corresponding package. Cloudflare REST still uses an API token as `apiKey`. See the runnable [Cloudflare example](../examples/cloudflare.ts).

```sh
npm install @system-one-ai/core @system-one-ai/transport-fetch @system-one-ai/adapter-llm
```

```ts
import { createSystemOne, booleanQuestion } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { llmAdapter } from '@system-one-ai/adapter-llm';

const client = createSystemOne({
  apiKey: process.env.LLM_API_KEY!,
  baseURL: process.env.LLM_BASE_URL!,
  model: process.env.LLM_MODEL!,
  adapter: llmAdapter({ provider: 'openai', api: 'chat_completions', structuredOutputs: false }),
  transport: createFetchTransport(),
});
console.log((await client.evaluate({
  state: 'The lamp is on.', questions: { on: booleanQuestion('Is the lamp on?') },
})).answers.on);
```

LLM probabilities are model-reported assessments, not calibrated native model probabilities. Discrete mode supplies deterministic answer values and does not fabricate distributions or confidence. Both modes use the same core validation and composition APIs.

## Cloudflare Workers

```sh
npm install @system-one-ai/core @system-one-ai/adapter-cloudflare
```

```ts
import { booleanQuestion } from '@system-one-ai/core';
import { createCloudflareWorkers } from '@system-one-ai/adapter-cloudflare/workers';

export default {
  async fetch(_request: Request, env: Env) {
    const client = createCloudflareWorkers({ binding: env.AI });
    const result = await client.evaluate({
      state: { lampOn: true }, questions: { on: booleanQuestion('Is the lamp on?') },
    });
    return Response.json(result);
  },
};
```

Generate `Env` with `wrangler types` and configure an AI binding as in [the complete Worker example](../examples/cloudflare-workers/). The native binding requires neither REST account ID/token nor an explicit Fetch transport. `CloudflareWorkers`, `createCloudflareWorkers`, their options and binding types move together. `BindingError` stays with the other core errors. Existing deadlines, cancellation, response limits, retry rules and `EvaluationClient` composition remain supported. The Cloudflare package shares response/deadline helpers with transport-fetch; its Workers entry does not call REST Fetch.

## Behavior and support

`evaluate({ state, questions })`, typed choices, weighted scores, boolean probabilities, per-request controls, native rounding, optional usage/confidence and error classes retain their behavior. The Fetch transport owns HTTP retries, authentication, cancellation and body limits. Core still validates and snapshots requests/results. Unknown or malformed results fail validation; absent probabilities and confidence stay absent. Decisions preserve original candidate identity; policies and batches still accept any `EvaluationClient`.

ESM, CommonJS and TypeScript declarations are provided by each package. Node 20/22/24 are the supported CI versions, with TypeScript 5.9.3 checked. Workers are checked separately against Wrangler-generated types and workerd. Exported `core/http`, `core/validation`, `core/composition` and transport/protocol helpers are supported public entry points under the same version policy; consumers must not import `src/` or unexported `dist/` paths.

TypeSafe choice/score/boolean and composition, plus basic LLM probability/discrete mode, have explicit real-service checks. OpenRouter, Vercel and Cloudflare REST have protocol fixtures; Workers has native runtime fixtures. These fixtures do not establish real provider inference. See [validation evidence](validation.md) and [release operations](releasing.md).
