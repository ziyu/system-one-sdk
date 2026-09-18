# System One SDK

**English** | [简体中文](README.zh-CN.md)

A TypeScript SDK for decision models with a shared `evaluate({ state, questions })` interface. The default client uses the native protocol supported by TypeSafe Jev and compatible services. Other protocols are available through explicit adapters.

The runtime has no third-party dependencies and uses standard Fetch, AbortController, and ReadableStream APIs. The package includes ESM, CommonJS, and TypeScript declarations, with Node.js 20 as the minimum target. Browsers, Workers, and other environments need these Web APIs. Keep long-lived model API keys on the server.

## Installation

```sh
npm install @system-one-ai/sdk
```

## Local setup

Build and verify the project locally:

```sh
npm install
npm run check
npm run test:package
```

Other projects can install the built local directory or the `.artifacts/system-one-ai-sdk-0.5.0.tgz` package. For example, when the two projects are sibling directories:

```sh
npm install ../sytem-one-sdk
```

```ts
import { SystemOne, choice, booleanQuestion } from '@system-one-ai/sdk';

const client = new SystemOne({
  apiKey: process.env.SYSTEM_ONE_API_KEY!,
});

const result = await client.evaluate({
  state: { userMessage: 'Please get me a glass of water.', location: 'living room' },
  questions: {
    action: choice('Choose the next available action based on the user request.', {
      drink: 'Go to the kitchen and get water',
      rest: 'Sit on the sofa and rest',
      think: 'Ask the application to invoke its slower planning module',
    }),
    interrupt: booleanQuestion('Is the user asking to change the current activity?'),
  },
});

result.answers.action.choice;           // 'drink' | 'rest' | 'think'
result.answers.action.probabilities;    // Optional, original model probability distribution
result.answers.action.confidence;       // Optional, provider-reported confidence statistic
result.answers.interrupt.probability;   // number, P(true)
result.usage.inputTokens;               // number | undefined
```

Built-in adapters supply their default URL and model. Choose an adapter and provide its credentials; Cloudflare also needs your account ID. Normal use does not require looking up a `baseURL` or model ID. `baseURL` remains an optional override for proxies and compatible services, and `model` can pin a version or select another supported decision model. The client does not infer a provider from the hostname.

```ts
const direct = new SystemOne({
  apiKey: process.env.TYPESAFE_API_KEY!,
});

const compatible = new SystemOne({
  baseURL: 'https://your-provider.example/api/v1',
  apiKey: process.env.SYSTEM_ONE_API_KEY!,
  model: 'your-system-one-model',
});
```

## Question types

| Factory | Input | Output |
| --- | --- | --- |
| `choice(instructions, criteria)` | A map of named options, with at least one option | A typed `choice`, plus optional `probabilities` and `confidence` |
| `score(instructions, criteria)` | At least two ordered levels | A potentially fractional `score`, plus optional `probabilities`, `confidence`, and `legend` |
| `booleanQuestion(instructions, criteria?)` | A true/false question, with optional descriptions for each case | `probability`, between 0 and 1 |

The public SDK calls true/false questions `boolean`. The TypeSafe adapter converts them to native `noul` questions and maps the returned `noul` value to `probability`. The value retains its probability semantics; the SDK does not apply a threshold to turn it into true or false.

`state` accepts a string, JSON object, or array. An array is still one shared state, not a batch of independent requests. Multiple questions share that state. For independent states, call `evaluate` separately or use the optional `evaluateMany` scheduler below.

The actual model determines limits on option counts, scoring levels, and context length. The SDK does not impose one Jev version's limits on every provider. Requests that exceed a model's capabilities retain the server's error.

`instructions` and descriptions for options, scoring levels, and true/false criteria accept strings, JSON objects, arrays, or null. Nested content must be valid JSON. Circular references, undefined, NaN, functions, and class instances are rejected before a request is sent. Use `defineQuestions()` to preserve literal types when sharing question definitions.

## Optional decision composition (0.4.0+)

These modules work with `SystemOne` and any wrapper implementing the exported `EvaluationClient` type. They do not select providers or add runtime dependencies, and the core does not import them. Composition declarations require TypeScript 5.4+.

| Entry point | Functions |
| --- | --- |
| `@system-one-ai/sdk/decisions` | `choiceFrom`, `defineDecision` |
| `@system-one-ai/sdk/policies` | `gateChoice`, `gateBoolean` |
| `@system-one-ai/sdk/batch` | `evaluateMany` |

```ts
import { choiceFrom, defineDecision } from '@system-one-ai/sdk/decisions';
import { gateChoice } from '@system-one-ai/sdk/policies';

const targets = choiceFrom({
  instructions: 'Choose the requested device.',
  items: [{ id: 'desk', label: 'Desk lamp', on: false }],
  id: device => device.id,
  describe: device => device.label,
});
const definition = defineDecision({
  instructions: 'Choose an action; ask when the request is unclear.',
  actions: {
    turn_on: { description: 'Turn on a device', parameters: { device: targets } },
    ask: { description: 'Request clarification' },
  },
});
const { decision, evaluation } = await definition.evaluate(client, {
  state: 'Turn on the desk lamp.',
}, { maxRetries: 0 });

const actionGate = gateChoice(evaluation.answers.action, {
  minProbability: 0.8, abstain: ['ask'],
});
if (actionGate.status === 'accepted' && decision.action === 'turn_on') {
  const targetGate = gateChoice(decision.parameterAnswers.device, { minProbability: 0.8 });
  if (targetGate.status === 'accepted') {
    decision.parameters.device.on = true; // Explicit application action on the original object.
  }
}
```

Candidate IDs and descriptions are snapshotted, while resolved objects preserve identity. Duplicate IDs reject; an empty set requires an explicit `none: { id, description }`, which adds `undefined` to the resolved type. A decision evaluates all predefined branches in one call, then exposes only the selected branch's typed parameters and named `parameterAnswers`. Ordinary choice, score and boolean parameters produce option IDs, fractional scores and P(true), respectively. Keep `evaluation` for full evidence and provider metadata.

Policies have no default thresholds. `gateChoice` can require selected probability, margin over alternatives, and/or provider confidence. `gateBoolean` uses `maxFalseProbability` and `minTrueProbability` with an uncertain interval between them. Results explicitly distinguish acceptance, uncertainty and choice abstention. Missing evidence stays uncertain; API failures stay errors. Example thresholds are illustrative. Action execution and slow-thinking callbacks belong to the application.

```ts
import { evaluateMany } from '@system-one-ai/sdk/batch';

const report = await evaluateMany(client, [
  { id: 'first', request: { state: 'Turn on the desk lamp.', questions: definition.questions } },
  { id: 'second', request: { state: 'I need help.', questions: definition.questions } },
], { concurrency: 2, requestOptions: { timeoutMs: 5000, maxRetries: 0 } });

for (const item of report.items) {
  if (item.status === 'fulfilled') console.log(item.id, definition.resolve(item.value));
  else console.log(item.id, item.status); // rejected or cancelled; original error retained
}
```

The default concurrency is 4; this is client-side scheduling, not a provider batch endpoint. Input order and IDs are preserved, and individual failures do not discard other results. A batch `signal` aborts active work and skips queued work, returning a partial report. Per-item timeouts start at dispatch. `summary.reportedUsage` and `usageCoverage` distinguish reported tokens from missing counts; they are not a complete bill for failed or cancelled calls.

See the [complete API contract](docs/composition.md) ([中文](docs/composition.zh-CN.md)) for types, validation, snapshots, parameter evidence, cancellation and usage semantics.

### Runnable decision workflows

The repository includes a file-inbox organizer and a persistent support queue. They accept your own natural-language instructions, call the selected model, execute handlers, and save the resulting files or ticket changes. Business data is seeded in a new local workspace; model calls and disk operations are real.

```sh
npm run example:decisions -- --message 'File the signed Cedar Studio contract in the legal folder.'
npm run example:support -- --message '把登录故障工单交给平台值班组，设置为紧急。'
npm run test:live:decisions -- --provider typesafe
```

Use `--workspace` to continue with the printed directory, `--request-id` to verify replay, and `--provider openrouter` to switch adapters. The 20-case live suite checks exact actions, parameter choices, disk effects and repeat requests. Setup, limits, code structure and recorded results are in [Decision workflows](docs/decision-workflows.md) ([中文](docs/decision-workflows.zh-CN.md)).

### Real browser example

```sh
# Opens Chrome: search MDN, then open the AbortController abort() method page.
npm run example:browser
# Same decision loop: search GitHub, open cloudflare/agents, then enter examples.
npm run example:browser -- --task github-agents
```

These commands use real model requests and actual public pages. Every step observes the current DOM, selects an action and its target through `decisions`, then executes it with Playwright. Final-state checks, screenshots and a Playwright trace are saved under `.artifacts/`. The example supports custom `--url`, `--goal` and `--input`, plus provider selection. Playwright is only a development dependency; the SDK runtime remains dependency-free. See [browser setup, implementation and evidence](docs/browser-decisions.md) ([中文](docs/browser-decisions.zh-CN.md)).

## URLs and protocols

| Adapter | Required configuration | Default model |
| --- | --- | --- |
| Omitted, or `systemOneAdapter` | TypeSafe `apiKey` | `jev-latest` |
| `openRouterAdapter` | OpenRouter `apiKey` | `~typesafe/jev-latest` |
| `vercelAdapter` | Vercel AI Gateway `apiKey` | `typesafe-ai/jev` |
| `cloudflareAdapter({ accountId })` (0.5.0+) | Cloudflare account ID and API token as `apiKey` | `typesafe/jev` |

Explicit client settings override adapter defaults. A request's `model` overrides the client's model. Custom adapters can supply `defaultBaseURL` and `defaultModel`, too; only adapters without a default URL require `baseURL`. Account-specific defaults can be built in an adapter factory, as Cloudflare does.

For the default native protocol, custom addresses are resolved as follows:

| `baseURL` | Default protocol | Request URL or path |
| --- | --- | --- |
| Omitted | TypeSafe-compatible | `https://api.typesafe.ai/v1/systemone` |
| `https://api.typesafe.ai` or `https://api.typesafe.ai/v1` | TypeSafe-compatible | `/v1/systemone` |
| `https://custom.example/prefix/v1` | TypeSafe-compatible | `/prefix/v1/systemone` |

You can also provide the complete endpoint ending in `/systemone`. Custom path prefixes are preserved. The SDK adds `/v1` only when the API URL has no path.

## Optional OpenRouter adapter

Requires SDK version 0.3.0 or later. Version 0.2.0 does not contain this entry point.

```ts
import { SystemOne, choice } from '@system-one-ai/sdk';
import { openRouterAdapter } from '@system-one-ai/sdk/adapters/openrouter';

const openrouter = new SystemOne({
  adapter: openRouterAdapter,
  apiKey: process.env.SYSTEM_ONE_API_KEY!,
});

const result = await openrouter.evaluate({
  state: 'Please refund the duplicate charge.',
  questions: {
    department: choice('Which team should handle this?', {
      billing: 'Payments and refunds',
      support: 'Software issues',
    }),
  },
  providerOptions: { openrouter: { session_id: 'my-agent-session' } },
});

console.log(result.answers.department.choice); // 'billing' | 'support'
console.log(result.providerMetadata?.openrouter); // generationId, provider, cost (when returned)
```

This uses OpenRouter's `POST /api/alpha/decisions`, not Chat Completions. It translates `boolean` to `noul`, preserves native probabilities and confidence, and normalizes token usage. The `~` in `~typesafe/jev-latest` is part of the model ID; bare `jev-latest` is a TypeSafe-direct name and is not rewritten. Explicit model IDs are sent unchanged. The resolved model is returned in `result.model`.

`baseURL` accepts the origin, `/api`, `/api/v1`, `/api/alpha`, or the full `/api/alpha/decisions` endpoint. Only this explicitly selected adapter translates those root aliases; custom proxy prefixes are preserved. Neither this adapter nor a provider SDK is imported by the core entry point.

Use `providerOptions.openrouter` for the API-native `provider`, `session_id`, `trace`, and `user` fields. Unknown options are rejected, and options cannot replace the model, questions, or state. Standard `headers` can carry `HTTP-Referer` and `X-OpenRouter-Title` for app attribution. This alpha protocol may change. See [OpenRouter protocol and live verification](docs/openrouter.md) for sources and recorded results.

For a live check, configure a separate `.env.openrouter`:

```dotenv
SYSTEM_ONE_API_KEY=your-openrouter-key
```

```sh
npm run test:live:openrouter
```

This command reads that file directly, makes four real inference requests with no retries, and verifies their generation records through OpenRouter. It saves timestamps, endpoint, generation IDs, answers, token usage, and cost in `.artifacts/live-openrouter.json` and a timestamped report. Inherited shell settings do not override the file. Credentials and authentication headers are excluded from reports.

If inference succeeds but generation records are not yet available, check the existing IDs again without repeating inference:

```sh
node scripts/test-openrouter-live.mjs --verify-only
```

`npm run example:openrouter` runs the smaller example in `examples/openrouter.ts` with the same environment file. Live commands consume API usage; ordinary tests remain offline.

## Optional Cloudflare adapter (0.5.0+)

```ts
import { SystemOne, booleanQuestion } from '@system-one-ai/sdk';
import { cloudflareAdapter } from '@system-one-ai/sdk/adapters/cloudflare';

const cloudflare = new SystemOne({
  adapter: cloudflareAdapter({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID! }),
  apiKey: process.env.CLOUDFLARE_API_TOKEN!,
});

const result = await cloudflare.evaluate({
  state: 'Please refund the duplicate charge.',
  questions: { refund: booleanQuestion('Does the customer request a refund?') },
});
console.log(result.answers.refund.probability);
```

The factory constructs the account-specific URL and selects `typesafe/jev`. It implements the model page's REST protocol: `POST /client/v4/accounts/{accountId}/ai/run` with `{ model, input: { state, questions } }`. It maps `boolean` to native `noul`, preserves probabilities and confidence, and normalizes token usage. Explicit `baseURL` overrides support API roots or proxy endpoints ending in `/ai/run`; `model` overrides are sent unchanged.

This is a REST adapter using the existing Fetch transport; native Workers `env.AI.run()` bindings are a separate interface. No Cloudflare SDK dependency is added. The existing `decisions`, `policies`, and `batch` modules work with this client unchanged.

```sh
cp .env.cloudflare.example .env.cloudflare
# Fill in CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, then:
npm run example:cloudflare
npm run test:live:cloudflare
```

The opt-in live check makes three real requests with no retries and saves sanitized reports under `.artifacts/`. It requires Cloudflare credentials and is never run by ordinary tests or CI. Protocol fixtures and local HTTP tests do not establish live account access. See the [Cloudflare contract and verification scope](docs/cloudflare.md) ([中文](docs/cloudflare.zh-CN.md)).

## Optional Vercel adapter

Vercel uses a separate Evaluation protocol, provided through its own export. The core entry point does not import, re-export, or automatically select this adapter. There is no runtime or development dependency on `@ai-sdk/gateway`. Import the adapter explicitly to use Vercel:

```ts
import { SystemOne } from '@system-one-ai/sdk';
import { vercelAdapter } from '@system-one-ai/sdk/adapters/vercel';

const gateway = new SystemOne({
  adapter: vercelAdapter,
  apiKey: process.env.AI_GATEWAY_API_KEY!,
});

// Default URL: https://ai-gateway.vercel.sh/v4/ai
// Default model: typesafe-ai/jev
// For a custom proxy, set baseURL: 'https://proxy.example/team/v4/ai'
```

This optional module only translates Evaluation v4 requests and responses. It accepts the API origin, `/v1`, `/v4/ai`, or a complete endpoint ending in `/evaluation-model`, preserving prefixes for custom proxies. Protocol regression tests use the fixed request format previously checked against the official `@ai-sdk/gateway@4.0.85`, without requiring that provider SDK to be installed. Evaluation is experimental, so this module may need updates when the provider changes its protocol.

To migrate from 0.1.0, remove the `protocol` setting. Vercel users should import the adapter from the subpath above and pass it as `adapter`. The native `evaluate` interface, question factories, and answer structures remain compatible. Passing the old `protocol` option produces an explicit configuration error.

Switching only the URL and key requires the service to support the same protocol, question types, and model capabilities. Future providers may use different authentication, paths, or fields. Implement those differences once in an adapter while retaining the same `evaluate` calls in application code. The SDK does not guess that an unknown protocol is an OpenAI chat endpoint.

## Request controls and errors

```ts
import { APIError, TimeoutError, RequestAbortedError } from '@system-one-ai/sdk';

const controller = new AbortController();
try {
  const result = await client.evaluate({
    state: 'The user has requested a different action.',
    questions: { interrupt: booleanQuestion('Should the current activity be interrupted?') },
  }, {
    signal: controller.signal,
    timeoutMs: 1500,
    maxRetries: 0,
  });
  console.log(result.answers.interrupt.probability);
} catch (error) {
  if (error instanceof APIError) {
    console.error({ status: error.statusCode, requestId: error.requestId });
  } else if (error instanceof TimeoutError || error instanceof RequestAbortedError) {
    // The application decides whether to pause, show a status, or request a new decision.
  } else {
    throw error;
  }
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `timeoutMs` | 10,000 | Total call budget, including key resolution, retries, backoff, and response body reading |
| `maxRetries` | 2 | Extra attempts after the initial request; range: 0–100 |
| `retryDelayMs` | 200 | Initial exponential backoff delay, with jitter |
| `maxRetryDelayMs` | 2,000 | Cap on the SDK's own backoff; does not shorten the server's Retry-After |
| `maxResponseBytes` | 8 MiB | Maximum size of a successful response body |
| `headers` | None | Custom headers; individual calls can override matching application headers |
| `fetch` | `globalThis.fetch` | An injectable Fetch implementation for proxies, observability, or testing |

Override `timeoutMs`, `maxRetries`, and `headers` per call using the second argument to `evaluate`. `apiKey` accepts a string or a synchronous/asynchronous key resolver. Pass explicit null for an unauthenticated local service. The SDK does not read global environment variables.

Network failures, HTTP 408, 429, and 5xx responses, including TypeSafe's 529, can be retried. HTTP 401, 403, 422, invalid JSON, and invalid answers do not trigger retries. The server's `Retry-After` supports seconds, HTTP dates, and `retry-after-ms`. If the delay exceeds the remaining budget, the SDK throws `TimeoutError` rather than retrying early.

Errors include `ConfigurationError`, `ValidationError`, `UnsupportedFeatureError`, `ResponseValidationError`, `APIError`, `ConnectionError`, `TimeoutError`, and `RequestAbortedError`. All extend `SystemOneError` and carry a stable `code`.

The SDK does not log keys or request bodies, and does not attach server error bodies that might echo sensitive information to exceptions. `APIError` retains the status code, request ID, and retry delay. The SDK manages authentication, Content-Type, Host, and protocol headers; application headers cannot override them. Requests do not automatically follow redirects, and adapters cannot send credentials to an origin different from `baseURL`.

## Response validation and probabilities

Responses must include an answer for every question with the matching type. Choices must belong to the declared options, probabilities must fall within 0–1, and scores must stay within the rubric's range. When a distribution is supplied, the SDK also validates its keys, probability sum, selected option, and the score's weighted mean. Invalid data raises an error instead of becoming a default action.

Validation tolerances account for TypeSafe's known two-decimal rounding and the Gateway's `rounding` declaration. Original values are preserved without renormalization. New compatible services can declare their precision through `rounding`. For custom adapters without a rounding declaration, the base absolute tolerance is `1e-6`.

`confidence` is a provider-reported statistic, not the selected option's probability, and is not necessarily comparable across models. When Vercel returns TypeSafe confidence metadata, the SDK preserves the metadata and extracts the statistic into the corresponding answer. Missing values stay undefined. Providers that omit probability distributions or token counts are not assigned fabricated values.

Jev's probability calibration describes aggregate prediction behavior, not a guarantee that an individual decision is correct. Validate thresholds against your own tasks. The SDK does not generate text replies, execute actions, or invoke a slower planning model. Applications can define `think` as a choice and handle it themselves.

## Adding a protocol

`SystemOneAdapter` implements `prepare`, `decode`, and optionally `authenticate`, while sharing the client's request controls and response validation. A complete TypeScript example is available in [examples/custom-adapter.ts](examples/custom-adapter.ts).

```ts
import type { SystemOneAdapter } from '@system-one-ai/sdk';

const adapter: SystemOneAdapter = {
  id: 'my-provider',
  defaultModel: 'reflex-1',
  supportedQuestionTypes: ['choice', 'score', 'boolean'],
  prepare({ baseURL, model, request }) {
    return {
      url: `${baseURL}/decisions`,
      body: { engine: model, context: request.state, queries: request.questions },
    };
  },
  decode(payload) {
    // This example assumes the service already returns the ProviderResponse format.
    // Map other response formats here; the client validates all fields afterward.
    return payload;
  },
};
```

Unsupported question types are rejected before sending a request. Adapters must return the standard `ProviderResponse` structure. Adding an entirely new decision primitive requires extending the SDK's type contract.

## Examples and verification

`examples/basic.ts` demonstrates all three primitives. `examples/realtime-agent.ts` demonstrates action selection with a `think` option. They require real credentials and make actual API calls.

```sh
cp .env.example .env
# Fill in your credentials in .env, then run:
npm run examples:build
node --env-file=.env .examples/examples/basic.js
node --env-file=.env .examples/examples/realtime-agent.js
```

Alternatively, set environment variables in your shell and run `npm run example` or `npm run example:agent`.

`npm run example:decisions` runs the file-inbox workflow and `npm run example:support` runs the persistent support workflow described above. They read the selected provider's local configuration file. `npm run example:uncertainty` hands unclear requests to an application callback, and `npm run example:batch` scores three independent code snippets with bounded concurrency; those two examples read `.env`. Without `SLOW_THINK_URL`, the uncertainty example reports a pending handoff rather than calling a slow model.

`npm run test:live:composition` directly reads `.env`, makes three real requests on success with no retries, and saves sanitized current and timestamped reports under `.artifacts/`. It verifies dynamic action resolution, policies and heterogeneous batch evaluations without calling a slow-model service.

`npm test` stays offline, covering protocols, cancellation, timeouts, retries, errors, and actual local HTTP requests. `npm run typecheck` checks TypeScript inference. Package tests install the tarball into an isolated temporary project, verify the ESM/CommonJS core and optional entry points and their declarations, and confirm that importing the core does not load Vercel.

`npm run check` also runs `test:scenarios`, which compiles the workflows and tests their actual local executors using offline model fixtures. `test:live:decisions` is separate and opt-in; CI never invokes paid models.

Official API integration checks use a separate command that reads this project's `.env` and makes four real requests:

```sh
npm run test:live
```

It verifies Chinese action selection, refund classification, scoring, true/false judgments, and string, object, and array states. Successful results are written to `.artifacts/live-typesafe.json`. This command consumes actual API usage and does not retry by default. Its output includes answers, usage, and latency, but no API keys or authentication headers. Recorded live results are in `docs/validation.md`.

See the [design document](docs/design.md), [Jev API research](docs/jev-api.md), and [validation record](docs/validation.md) for implementation details and sources. These supporting documents are currently in Chinese.

## CI and releases

Pushes to `main` and pull requests run type checking, offline tests, builds, and package installation checks on Node.js 20, 22, and 24. Version tags such as `v0.4.0` trigger the release workflow, which publishes the tested tarball to npm using Trusted Publishing and then creates a GitHub Release with that same package and its checksum. Prereleases use the npm `next` tag.

See [Releasing the SDK](docs/releasing.md) for the one-time trusted publisher configuration, versioning commands, and how to resume a failed release. CI and release workflows do not run the live model tests.

## License

This project is licensed under the [MIT License](LICENSE).
