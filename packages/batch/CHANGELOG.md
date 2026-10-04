# @system-one-ai/batch

## 0.6.1

### Patch Changes

- 2681b49: Add native multimodal image requests to core with `EvaluateRequest.images`, the provider-independent `ImageInput` type (embedded data URLs or `{ mediaType, base64 }`), representation/base64 validation and snapshot isolation. Adapters explicitly opt in through `supportsImages`; unsupported images fail before preparation, authentication or transport execution instead of silently becoming text-only.

  Support `@cf/cloudflare/clef` and `@cf/cloudflare/clef-flash` through REST and the native Workers AI binding. Encode model-specific endpoints and selectors, map core image fields to Cloudflare's wire format, and enforce Clef's PNG/JPEG/WebP, count and decoded-byte limits. Preserve the existing Jev default and native answer precision. No provider-specific image options or image type exports are introduced.

  Preserve images through decision composition, batch snapshots and evaluation context variants. Local model runners can opt in with `supportsImages: true`; text-only local runners reject image input. The core minor release must be installed with image-capable adapters and composition packages; Changesets updates internal dependency ranges together.

  Correct legacy package repository URLs to `ziyu/system-one-sdk` so package provenance metadata matches the release workflow. Real Clef and Clef Flash REST inference passed; native Workers binding is covered by workerd fixtures but real binding inference remains blocked by the test account's development/preview permissions.

- Updated dependencies [2681b49]
  - @system-one-ai/core@0.7.0

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
