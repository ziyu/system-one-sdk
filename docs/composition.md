# Decision composition, policies, and batches

**English** | [简体中文](composition.zh-CN.md)

Available in SDK 0.4.0 through optional subpaths. The existing `evaluate` API and provider adapters are unchanged. The new runtime modules have no third-party dependencies and use Web APIs. TypeScript consumers need TypeScript 5.4 or newer for the published composition declarations.

| Entry point | Exports | Responsibility |
| --- | --- | --- |
| `@system-one-ai/sdk/decisions` | `choiceFrom`, `defineDecision` | Candidate mapping and action/parameter composition |
| `@system-one-ai/sdk/policies` | `gateChoice`, `gateBoolean` | Explicit acceptance, uncertainty and abstention |
| `@system-one-ai/sdk/batch` | `evaluateMany` | Bounded client-side concurrency across independent states |

Composition accepts the structural `EvaluationClient` interface exported as a type by the core. `SystemOne` implements it, as can application wrappers. A wrapper must preserve the normalized response contract and honor request controls. No composition module selects a provider, resolves credentials or reads environment variables. Importing the core does not load these modules.

## Dynamic candidates

```ts
import { choiceFrom } from '@system-one-ai/sdk/decisions';

const devices = [{ id: 'desk', label: 'Desk lamp', on: false }];
const targets = choiceFrom({
  instructions: 'Select the device requested by the user.',
  items: devices,
  id: device => device.id,
  describe: device => ({ label: device.label, on: device.on }),
});

const result = await client.evaluate({
  state: 'Turn on the desk lamp.',
  questions: { target: targets.question },
});
const device = targets.resolve(result.answers.target.choice);
// device is the original object, with its original application type.
```

`id` and `describe` are called once per item during construction. IDs must be nonempty unique strings. Only the resulting IDs and JSON descriptions are included in questions; the objects themselves are not serialized. Include business state explicitly in `state` or descriptions when needed.

Membership and question descriptions are snapshotted at construction. Questions are deeply frozen. Original business objects retain identity and are neither cloned nor frozen. Mutating the input array cannot add a new candidate to an existing definition. Mutating an object can still change its local fields; rebuild the definition to refresh its model-visible description.

Empty arrays reject unless an explicit `none: { id, description }` option is supplied. Its ID cannot collide with an item ID. With `none`, `resolve` returns `T | undefined`; choosing that sentinel returns `undefined`. Unknown IDs throw `ResponseValidationError`. The SDK does not insert a hidden fallback option or silently remove actions.

## Typed action branches

```ts
import { choice, booleanQuestion } from '@system-one-ai/sdk';
import { defineDecision } from '@system-one-ai/sdk/decisions';
import { gateChoice } from '@system-one-ai/sdk/policies';

const definition = defineDecision({
  instructions: 'Choose the next action. Ask when the request is unclear.',
  actions: {
    adjust: {
      description: 'Adjust a device',
      parameters: {
        device: targets,
        mode: choice('Lighting mode?', { warm: 'Warm light', cool: 'Cool light' }),
        urgent: booleanQuestion('Does the request require immediate action?'),
      },
    },
    ask: { description: 'Ask for clarification' },
  },
});

const { decision, evaluation } = await definition.evaluate(client, {
  state: 'Set the desk lamp to warm light.',
}, { timeoutMs: 5000, maxRetries: 0 });

const actionPolicy = gateChoice(evaluation.answers.action, {
  minProbability: 0.8, abstain: ['ask'],
});
if (actionPolicy.status === 'accepted' && decision.action === 'adjust') {
  const targetPolicy = gateChoice(decision.parameterAnswers.device, { minProbability: 0.8 });
  if (targetPolicy.status === 'accepted') {
    console.log(decision.parameters.device.id);
    console.log(decision.parameters.mode);   // 'warm' | 'cool'
    console.log(decision.parameters.urgent); // number: P(true), not boolean
  }
}
```

`defineDecision` produces immutable `questions`, a `resolve(evaluation)` method and the `evaluate(client, request, options)` convenience method. `request` contains `state` and optionally `model` and `providerOptions`. It cannot replace the compiled questions. Standard per-call cancellation, timeout, retry and header options pass to the supplied client.

One evaluation contains the action question plus parameters for every predefined branch. Parameter instructions specify the hypothetical action to which they belong. All those questions still require valid answers under the core response contract. Only the selected branch is exposed in `decision.parameters` and `decision.parameterAnswers`.

| Parameter definition | Value in `decision.parameters` | Evidence in `decision.parameterAnswers` |
| --- | --- | --- |
| `choiceFrom(...)` | Original candidate object, optionally `undefined` | `ChoiceAnswer` with the candidate ID |
| `choice(...)` | Literal option ID union | Typed `ChoiceAnswer` |
| `score(...)` | Fractional numeric score | `ScoreAnswer` |
| `booleanQuestion(...)` | Numeric P(true) | `BooleanAnswer` |

`decision.action` discriminates the parameter types: narrowing to `ask` removes access to `adjust` parameters. `parameterAnswers` uses the original parameter names, so applications can gate each argument without relying on generated wire IDs. `evaluation` retains all raw normalized answers, rounding, warnings, usage, response timing and provider metadata. Generated parameter question IDs are implementation details; only the public `action` question and named parameter evidence are stable contracts.

Dependent questions that cannot be defined until another answer is known require a later evaluation. This API cannot generate open-ended text or arbitrary tool arguments. Application code owns execution, current-state/target checks, action pacing and feedback. See `examples/decisions.ts` for an explicit handler that changes a local device's state after both action and target gates pass.

## Probability policies

`gateChoice(answer, policy)` requires at least one of `minProbability`, `minMargin` or `minConfidence`. Supplied thresholds are combined with AND. Each must be finite and within 0–1. Optional `abstain` contains IDs that mean an intentional non-answer.

| Setting | Compared evidence |
| --- | --- |
| `minProbability` | Probability of the selected option |
| `minMargin` | Selected probability minus the largest other probability; zero is used when there is no alternative |
| `minConfidence` | The provider's separate confidence statistic |

The helpers never reinterpret confidence as probability, renormalize distributions, multiply parameter probabilities, or select a different option. Policies are intended for normalized SDK answers; core response validation remains responsible for complete distributions and provider rounding. Thresholds are applied to the reported numbers; margin comparison compensates only for machine-precision subtraction error, not provider rounding. Missing evidence required by a policy produces uncertainty even when its threshold is zero. An explicitly selected abstention ID returns abstention before threshold comparison.

`gateBoolean(answer, { maxFalseProbability, minTrueProbability })` requires `0 <= maxFalseProbability < minTrueProbability <= 1`. It accepts `false` at or below the lower bound and `true` at or above the upper bound. Values between them are uncertain. Both acceptance boundaries are inclusive.

The result discriminant is `status`: `accepted` includes `value`; `uncertain` includes a stable reason such as `missing-probabilities`, `below-margin` or `between-thresholds`; choice abstention returns `abstained` with `abstain-option`. Invalid configuration throws `ConfigurationError`; malformed answer fields throw `ResponseValidationError`. No policy invokes actions or catches model/API errors. An API timeout or authentication failure remains an error from `evaluate`, not a low-confidence result.

There is no default threshold. Example values are illustrative and should be checked against labeled application cases. Check important parameters separately from the action. `examples/uncertainty.ts` demonstrates an application-supplied handoff callback. Without `SLOW_THINK_URL`, it reports `handoff_required`; it does not claim to have called a slow model. With the URL, it posts `{state, reason}` to that application service. `SLOW_THINK_API_KEY` optionally supplies a Bearer token. The callback, timeout and service contract are application code.

## Independent evaluations with bounded concurrency

```ts
import { evaluateMany } from '@system-one-ai/sdk/batch';

const report = await evaluateMany(client, [
  { id: 'first', request: { state: 'Turn on the desk lamp.', questions: definition.questions } },
  { id: 'second', request: { state: 'I need help.', questions: definition.questions } },
], {
  concurrency: 2,
  signal: controller.signal,
  requestOptions: { timeoutMs: 5000, maxRetries: 0 },
});

for (const item of report.items) {
  if (item.status === 'fulfilled') {
    const selected = definition.resolve(item.value);
    console.log(item.id, selected.action);
  } else {
    console.log(item.id, item.status, item.started);
  }
}
```

`evaluateMany(client, items, options?)` uses client-side scheduling, not a provider batch endpoint. Every item has a unique nonempty `id` and a normal `request`. Different items may have different questions; readonly tuples retain per-item ID and answer types. The default concurrency is 4. There are no global queues, hidden model substitutions, or extra retries beyond each client's configured retries.

All requests and shared headers are snapshotted before the first dispatch. IDs, list shape and batch options are validated before any I/O. An invalid individual request becomes a rejected item with `started: false`; other valid requests continue. Results always occupy the original input order and carry `id`, `index` and `started`. The entire report is returned when all entries have settled. The API holds the supplied batch in memory; callers should partition very large datasets.

| Item status | Payload |
| --- | --- |
| `fulfilled` | `value`: complete `EvaluationResult` |
| `rejected` | `error`: original error; no conversion to a default decision |
| `cancelled` | `error`: `RequestAbortedError`; `started` distinguishes active and queued calls |

The shared abort signal cancels active evaluations and prevents queued ones from starting. Cancellation resolves a partial report rather than throwing away completed results. It ends SDK waiting even for a custom client that ignores cancellation, but cannot stop that client's internal work or refund upstream usage. Per-request `timeoutMs` starts when the item is dispatched, not when it enters the queue. There is no separate batch deadline; callers can provide an abort signal with their own deadline.

`summary.started` counts calls to the client's `evaluate`, not HTTP attempts. `successfulAttempts` sums only successful results' reported HTTP attempts. `reportedUsage` sums available counts from successful results; `usageCoverage` records how many successful results contributed each count. Missing values are not zero. A sum that exceeds safe integer precision is omitted. Failed or cancelled requests may consume unreported usage, so this summary is not a complete bill. Per-result provider metadata is retained without guessing cross-provider cost units.

## Verification and examples

`npm run check` covers runtime tests and positive/negative type assertions. `npm run test:package` installs a real tarball and checks all optional entry points under ESM and CommonJS, including NodeNext declaration resolution and core import isolation.

`npm run example:uncertainty` and `npm run example:batch` read `.env` and consume real model usage. `npm run test:live:composition` reads `.env` directly, makes exactly three inference requests on success, performs no retries, and writes sanitized current and timestamped reports under `.artifacts/`. It verifies candidate/action composition, policy handling and heterogeneous batch evaluations. It does not invoke a slow-model service. Ordinary tests remain offline.

`example:decisions` now runs a file-inbox organizer. `example:support` adds a persistent support queue. Both accept free-form commands and alternate providers; `test:live:decisions` checks 20 scenarios and their actual effects. See [Decision workflows](decision-workflows.md) for configuration, application handlers, replay, state conflicts and measured results.
