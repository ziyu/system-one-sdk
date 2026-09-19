# System One

**English** | [简体中文](README.zh-CN.md)

Typed decisions over shared state: `evaluate({ state, questions })` returns choices, scores, and boolean probabilities. Applications choose an adapter and a transport explicitly.

The repository is a private npm workspace. Runtime code lives in independently packaged modules; the old `@system-one-ai/sdk` entry point and forwarding subpaths have been removed. LLM support remains one optional adapter package.

## Packages

| Package (`@system-one-ai/…`) | Responsibility | Runtime dependencies |
| --- | --- | --- |
| `core` | Questions, types, client, snapshots, result validation and errors | None |
| `transport-fetch` | Fetch, authentication, deadlines, cancellation, retries, body limits | core |
| `protocol-system-one` | Shared native boolean/noul and response codecs | core |
| `adapter-system-one` | TypeSafe native protocol | core, protocol-system-one |
| `adapter-openrouter` | OpenRouter Decisions | core, protocol-system-one |
| `adapter-cloudflare` | Cloudflare REST and native Workers binding | core, protocol-system-one, transport-fetch |
| `adapter-vercel` | Vercel Evaluation v4 | core |
| `adapter-llm` | OpenAI Responses/Chat Completions and Anthropic Messages | core |
| `decisions` | Dynamic candidates and typed action parameters | core |
| `policies` | Probability, margin and confidence gates | core |
| `batch` | Bounded concurrency, ordered results and partial failures | core |

Core imports no concrete adapter or transport. Each package provides ESM, CommonJS and TypeScript declarations. Runtime packages use Web APIs and have no third-party dependencies. Node.js 20+ is the supported target; the native Cloudflare binding is verified separately in workerd. Keep model credentials on the server.

## Install and use

**Independent packages are not yet published.** Build and verify local tarballs first:

```sh
npm ci --ignore-scripts
npm run check
npm run test:package
```

In a consuming project, install only the chosen package closure from `.artifacts/`. For example, LLM requires `system-one-ai-core-<version>.tgz`, `system-one-ai-transport-fetch-<version>.tgz` and `system-one-ai-adapter-llm-<version>.tgz`. Native TypeSafe also requires the `protocol-system-one` tarball. After independent publication, the equivalent installation is:

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

## LLM adapter

Install `adapter-llm` with core and transport-fetch. LLM protocols, prompts, schemas, authentication mapping and answer conversion stay together in this package.

```ts
import { createSystemOne } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { llmAdapter } from '@system-one-ai/adapter-llm';

const client = createSystemOne({
  adapter: llmAdapter({ provider: 'openai', llmAnswerMode: 'probabilities' }),
  transport: createFetchTransport(),
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
});
```

OpenAI uses Responses on `api.openai.com` and Chat Completions on custom base URLs; `api` can select either explicitly. Anthropic uses Messages. `llmAnswerMode` accepts `probabilities` or `discrete`. Set `structuredOutputs: false` for compatible services without native JSON-schema support. `normalizeProbabilities` is opt-in. Existing evaluation, validation and composition APIs work with the LLM adapter.

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
