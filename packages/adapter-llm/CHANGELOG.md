# @system-one-ai/adapter-llm

## 0.7.0

### Minor Changes

- 013fdc0: Harden LLM-backed System One decisions with internal question IDs, bounded question/outcome grouping, and corrective malformed-output retries. Add a provider-agnostic evaluation package for accuracy, calibration, latency, token, retry, and paired context-stress metrics across any EvaluationClient.

## Unreleased

- Added internal model-facing question IDs, preserving caller IDs only in typed results.
- Added `createLlmEvaluationClient()` for bounded question/outcome groups and corrective retries of malformed decision output without moving network I/O into the adapter.
- Kept the system safety prompt on OpenAI-compatible Chat Completions when structured outputs are enabled.

## 0.6.0

### Minor Changes

- afcbe0c: BREAKING: migrate from the single `@system-one-ai/sdk` package to independently installed packages. Core requires an explicit adapter and transport. Pass custom Fetch implementations to `createFetchTransport(fetch)`.

  Preserve SDK 0.5.3's native Cloudflare Workers binding through `@system-one-ai/adapter-cloudflare/workers`, including typed binding errors, deadlines, cancellation and composition. LLM support remains a single optional adapter.

  See the repository's `docs/migration-0.6.md` for installation and import mappings.

### Patch Changes

- Updated dependencies [afcbe0c]
  - @system-one-ai/core@0.6.0

## 0.6.0-rc.0

### Minor Changes

- afcbe0c: BREAKING: migrate from the single `@system-one-ai/sdk` package to independently installed packages. Core requires an explicit adapter and transport. Pass custom Fetch implementations to `createFetchTransport(fetch)`.

  Preserve SDK 0.5.3's native Cloudflare Workers binding through `@system-one-ai/adapter-cloudflare/workers`, including typed binding errors, deadlines, cancellation and composition. LLM support remains a single optional adapter.

  See the repository's `docs/migration-0.6.md` for installation and import mappings.

### Patch Changes

- Updated dependencies [afcbe0c]
  - @system-one-ai/core@0.6.0-rc.0
