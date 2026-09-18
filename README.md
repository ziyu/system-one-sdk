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

Other projects can install the built local directory or the `.artifacts/system-one-ai-sdk-0.2.0.tgz` package. For example, when the two projects are sibling directories:

```sh
npm install ../sytem-one-sdk
```

```ts
import { SystemOne, choice, booleanQuestion } from '@system-one-ai/sdk';

const client = new SystemOne({
  baseURL: 'https://api.typesafe.ai/v1',
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

For services compatible with the native protocol, change `baseURL` and `apiKey` while keeping the application calls unchanged. The default model is `jev-latest`; use the exact `model` ID in the client configuration or an individual request when selecting another model. The client does not infer a provider or switch protocols based on the hostname.

```ts
const direct = new SystemOne({
  baseURL: 'https://api.typesafe.ai/v1',
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

`state` accepts a string, JSON object, or array. An array is still one shared state, not a batch of independent requests. Multiple questions share that state. Call `evaluate` separately for independent states.

The actual model determines limits on option counts, scoring levels, and context length. The SDK does not impose one Jev version's limits on every provider. Requests that exceed a model's capabilities retain the server's error.

`instructions` and descriptions for options, scoring levels, and true/false criteria accept strings, JSON objects, arrays, or null. Nested content must be valid JSON. Circular references, undefined, NaN, functions, and class instances are rejected before a request is sent. Use `defineQuestions()` to preserve literal types when sharing question definitions.

## URLs and protocols

| `baseURL` | Default protocol | Request URL or path |
| --- | --- | --- |
| Omitted | TypeSafe-compatible | `https://api.typesafe.ai/v1/systemone` |
| `https://api.typesafe.ai` or `https://api.typesafe.ai/v1` | TypeSafe-compatible | `/v1/systemone` |
| `https://custom.example/prefix/v1` | TypeSafe-compatible | `/prefix/v1/systemone` |

You can also provide the complete endpoint ending in `/systemone`. Custom path prefixes are preserved. The SDK adds `/v1` only when the API URL has no path.

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

`npm test` stays offline, covering protocols, cancellation, timeouts, retries, errors, and actual local HTTP requests. `npm run typecheck` checks TypeScript inference. Package tests install the tarball into an isolated temporary project, verify the ESM/CommonJS core and optional entry points and their declarations, and confirm that importing the core does not load Vercel.

Official API integration checks use a separate command that reads this project's `.env` and makes four real requests:

```sh
npm run test:live
```

It verifies Chinese action selection, refund classification, scoring, true/false judgments, and string, object, and array states. Successful results are written to `.artifacts/live-typesafe.json`. This command consumes actual API usage and does not retry by default. Its output includes answers, usage, and latency, but no API keys or authentication headers. Recorded live results are in `docs/validation.md`.

See the [design document](docs/design.md), [Jev API research](docs/jev-api.md), and [validation record](docs/validation.md) for implementation details and sources. These supporting documents are currently in Chinese.

## License

This project is licensed under the [MIT License](LICENSE).
