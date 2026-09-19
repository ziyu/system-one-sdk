# System One

**English** | [简体中文](README.zh-CN.md)

Typed decisions over shared state: `evaluate({ state, questions })` returns choices, scores, and boolean probabilities. Applications choose an adapter and a transport explicitly.

The repository is a private npm workspace. Runtime code lives in independently packaged modules; the old `@system-one-ai/sdk` entry point and forwarding subpaths have been removed. LLM support remains one optional adapter package.

## Packages

| Package (`@system-one-ai/…`) | What it does | Runtime dependencies |
| --- | --- | --- |
| `core` | Create a shared `evaluate` client, define choice, score and boolean questions, and validate model answers. | None |
| `transport-fetch` | Send model requests using Fetch, with authentication, timeouts, cancellation, retries and response size limits. | core |
| `protocol-system-one` | Convert between this library’s questions/answers and the native System One wire format, shared by the TypeSafe, OpenRouter and Cloudflare adapters. | core |
| `adapter-system-one` | Connect to TypeSafe’s official System One service to answer choice, score and boolean questions with native decision models. | core, protocol-system-one |
| `adapter-openrouter` | Call System One models through OpenRouter Decisions and convert answers, usage and cost metadata into this library’s results. | core, protocol-system-one |
| `adapter-cloudflare` | Run System One models on Cloudflare through its REST API or the native `env.AI` binding inside Workers. | core, protocol-system-one, transport-fetch |
| `adapter-vercel` | Call decision models through Vercel AI Gateway’s Evaluation API, converting requests and answers to this library’s format. | core |
| `adapter-llm` | Adapt general-purpose LLM APIs to the System One decision interface: turn questions into prompts and output constraints, then convert LLM responses into choices, scores and boolean results. | core |
| `decisions` | Select business objects, actions and action parameters with a model, then map answers back to the original objects for the application to act on. | core |
| `policies` | Decide whether to accept model answers using probability, option margin or confidence thresholds; return accepted, uncertain or abstained outcomes. | core |
| `batch` | Run multiple `evaluate` calls at a chosen concurrency, returning results in input order with per-item failure and cancellation information. | core |

Core imports no concrete adapter or transport. Each package provides ESM, CommonJS and TypeScript declarations. Runtime packages use Web APIs and have no third-party dependencies. Node.js 20+ is the supported target; the native Cloudflare binding is verified separately in workerd. Keep model credentials on the server.

## Install and use

**Stable `0.6.0` is available on npm.** Install only the packages your application uses; npm resolves their dependencies. See the [SDK 0.5.3 migration guide](docs/migration-0.6.md) and [published-package verification](docs/validation.md).

```sh
npm install @system-one-ai/core @system-one-ai/transport-fetch @system-one-ai/adapter-system-one
```

```ts
import { createSystemOne, choice, score, booleanQuestion } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { systemOneAdapter } from '@system-one-ai/adapter-system-one';

const client = createSystemOne({
  adapter: systemOneAdapter,
  transport: createFetchTransport(),
  apiKey: process.env.SYSTEM_ONE_API_KEY!,
});

const result = await client.evaluate({
  state: { message: 'Please bring me water.' },
  questions: {
    action: choice('What should happen next?', { drink: 'Bring water', rest: 'Rest' }),
    urgency: score('How urgent is the request?', ['Low', 'Medium', 'High']),
    interrupt: booleanQuestion('Does the user request an action?'),
  },
});

const action: 'drink' | 'rest' = result.answers.action.choice;
console.log(action, result.answers.urgency.score, result.answers.interrupt.probability);
```

Adapters supply native endpoint/model defaults. `baseURL` and `model` override them; per-request `model` has highest priority. Cloudflare requires `cloudflareAdapter({ accountId })`. Custom Fetch implementations are passed to `createFetchTransport(fetch)`. The client does not infer protocols from hostnames or read environment variables.

## Use a general-purpose LLM for System One decisions

`adapter-llm` adapts general-purpose OpenAI, Anthropic and compatible LLM APIs to System One's `evaluate({ state, questions })` interface. It turns state and questions into prompts and JSON output constraints, then converts LLM responses into this library's choice, score and boolean results. Applications can use an LLM for System One decisions and reuse `decisions`, `policies` and `batch`.

The flow is: System One state and questions → LLM prompt/output constraints → LLM response → System One results.

Install `adapter-llm` with core and transport-fetch:

```sh
npm install @system-one-ai/core @system-one-ai/transport-fetch @system-one-ai/adapter-llm
```

```ts
import { createSystemOne, choice } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { llmAdapter } from '@system-one-ai/adapter-llm';

const client = createSystemOne({
  adapter: llmAdapter({ provider: 'openai', llmAnswerMode: 'probabilities' }),
  transport: createFetchTransport(),
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
});

const result = await client.evaluate({
  state: 'I was charged twice for the same order. Please refund the duplicate charge.',
  questions: {
    department: choice('Which team should handle this message?', {
      billing: 'Payments and refunds', technical: 'Software failures',
    }),
  },
});
const department: 'billing' | 'technical' = result.answers.department.choice;
console.log(department);
```

Supported APIs are OpenAI Responses, OpenAI-compatible Chat Completions and Anthropic Messages. OpenAI defaults to Responses on `api.openai.com` and Chat Completions on custom base URLs; `api` can select either explicitly. Set `structuredOutputs: false` for compatible services without native JSON-schema support.

`llmAnswerMode: 'probabilities'` asks the LLM to report probabilities. These are estimates generated by the LLM, with no guarantee of calibration. `discrete` asks the LLM to select answers directly, then encodes them as 0/1 values in the shared result format; the resulting distributions and confidence encode the selection, not measured model certainty. Probability normalization is opt-in through `normalizeProbabilities`.

## Composition

Install composition packages only when needed:

```ts
import { choiceFrom, defineDecision } from '@system-one-ai/decisions';
import { gateChoice, gateBoolean } from '@system-one-ai/policies';
import { evaluateMany } from '@system-one-ai/batch';
```

They depend on the structural `EvaluationClient` contract and select no provider. Candidates retain original-object identity; action parameters retain branch types and probability evidence. Policies return accepted, uncertain or abstained outcomes. Batch results preserve input order and partial failures. See the [composition contract](docs/composition.md).

## Request controls and validation

| Option | Default | Meaning |
| --- | --- | --- |
| `timeoutMs` | 10,000 | Total evaluation deadline including retries and decoding |
| `maxRetries` | 2 | Extra attempts; range 0–100 |
| `retryDelayMs` | 200 | Initial exponential backoff with jitter |
| `maxRetryDelayMs` | 2,000 | Backoff cap; never shortens Retry-After |
| `maxResponseBytes` | 8 MiB | Successful response body limit |
| `headers` | None | Application headers; authentication/protocol headers are reserved |

The second argument to `evaluate` accepts `signal`, `timeoutMs`, `maxRetries` and `headers`. `apiKey` accepts a token or synchronous/asynchronous resolver; explicit `null` permits an unauthenticated endpoint.

Fetch transport retries network failures, HTTP 408, 429 and 5xx. Invalid inputs, malformed answers and HTTP 401/403/422 fail without retry. Errors extend `SystemOneError`: `ConfigurationError`, `ValidationError`, `UnsupportedFeatureError`, `ResponseValidationError`, `APIError`, `ConnectionError`, `TimeoutError`, `RequestAbortedError`. Credentials and upstream error bodies are not included in errors. Redirects and cross-origin adapter requests are rejected.

Core validates answer types, declared choices, probabilities, distributions, score ranges and weighted means. Native rounding declarations are honored without rewriting the reported values. Missing distributions, confidence and token counts stay absent. Provider confidence is distinct from selected-option probability; thresholds need evaluation on application data. The library does not execute actions, generate chat replies or invoke a fallback planner.

## Development and verification

```sh
npm ci --ignore-scripts
npm run check                         # types, builds, regression and workflow tests
npm run test:package                  # isolated tarball installs, ESM/CJS, inference
npm run test:browser                  # local browser example checks
npm test --workspace @system-one-ai/adapter-llm
npm run test:live -- /path/to/system-one.env
npm run test:live:composition -- /path/to/system-one.env
npm run test:live:llm -- /path/to/llm.env
```

The LLM file supplies `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY`. Live tests are opt-in, make paid requests and save sanitized reports under `.artifacts/`. CI never reads local credentials. Other provider commands are `test:live`, `test:live:openrouter`, and `test:live:cloudflare`.

The native and composition checks read `SYSTEM_ONE_API_KEY`, `SYSTEM_ONE_BASE_URL` and `SYSTEM_ONE_MODEL` from the supplied file, or the repository's `.env` when no path is supplied. Explicit file values are used without shell-environment overrides.

See [verification records](docs/validation.md) for current and historical evidence. A live LLM pass does not verify other providers. Protocol fixtures and local HTTP servers cover those providers separately.

- [Package boundaries](docs/architecture-plan.zh-CN.md) and [design](docs/design.md)
- [OpenRouter](docs/openrouter.md), [Cloudflare](docs/cloudflare.md), [Jev API research](docs/jev-api.md)
- [File/support workflows](docs/decision-workflows.md) and [browser example](docs/browser-decisions.md)
- [Native Cloudflare Workers binding](docs/cloudflare-workers.md) (`@system-one-ai/adapter-cloudflare/workers`)
- [Custom adapter example](examples/custom-adapter.ts)
- [Versions and releases](docs/releasing.md): Changesets Release PRs, fixed artifacts and batch verification
- [Migrate from SDK 0.5.3](docs/migration-0.6.md): package, entry point and configuration mappings

[MIT License](LICENSE).
