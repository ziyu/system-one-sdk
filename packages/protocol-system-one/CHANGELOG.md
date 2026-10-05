# @system-one-ai/protocol-system-one

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
