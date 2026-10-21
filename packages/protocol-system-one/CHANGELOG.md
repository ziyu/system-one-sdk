# @system-one-ai/protocol-system-one

## 0.8.0

### Minor Changes

- ab56588: Add Clairic extraction to core: typed field specs (`text`, `number`, `date`, `time`, `datetime`, `duration`, `list`, `estimate`, `forecast`), `extract({ state, fields })` on the shared client, and client-side validation of field names, per-type properties, image limits (PNG/JPEG/WebP, at most four, 4 MiB each, 8 MiB total decoded) and a 16 MiB JSON body.

  `systemOneAdapter` defaults to `https://system-one.dev/v1` and sends extract requests to `{baseURL}/systemone` (`POST https://system-one.dev/v1/systemone`) with a `fields` body and default model `clairic`. Direct Cloudflare REST and Workers bindings encode the same field schema on the Clairic model path. Adapters opt in with `supportsExtract`; question-only adapters reject `extract()` before I/O.

  Protocol and Fetch packages are included so extract-capable adapters resolve the same core generation as the new extract types and error classes. Unchanged LLM, local, WebGPU, Laya, ONNX, decisions, evaluation and batch packages keep their published versions.

  `adapter-system-one` package metadata now points `repository.url` at the canonical GitHub repository `ziyu/system-one-sdk`.

### Patch Changes

- Updated dependencies [d971587]
- Updated dependencies [ab56588]
  - @system-one-ai/core@0.8.0

## 0.7.0

### Minor Changes

- 35688ab: Add native multimodal image requests to core with `EvaluateRequest.images`, the provider-independent `ImageInput` type (embedded data URLs or `{ mediaType, base64 }`), representation/base64 validation and snapshot isolation. Adapters explicitly opt in through `supportsImages`; unsupported images fail before preparation, authentication or transport execution instead of silently becoming text-only.

  Support `@cf/cloudflare/clef` and `@cf/cloudflare/clef-flash` through REST and the native Workers AI binding. Encode model-specific endpoints and selectors, map core image fields to Cloudflare's wire format, and enforce Clef's PNG/JPEG/WebP, count and decoded-byte limits. Preserve the existing Jev default and native answer precision. No provider-specific image options or image type exports are introduced.

  Preserve images through decision composition, batch snapshots and evaluation context variants. Local model runners can opt in with `supportsImages: true`; text-only local runners reject image input.

  Release scope is limited to eight packages: core, adapter-cloudflare, adapter-local, decisions and evaluation have implementation changes; batch must require the image-aware core snapshot; protocol-system-one and transport-fetch must resolve the same core error classes as Cloudflare to preserve instanceof checks, retries and cancellation. The three dependency-contract changes use the 0.7 line, not a 0.6 patch, so existing ^0.6 consumers cannot accidentally acquire a different core generation. Changesets updates dependency ranges only inside this explicit set.

  Unchanged LLM, OpenRouter, TypeSafe, Vercel, WebGPU, Laya, ONNX and policy packages keep their published versions, manifests and dependency ranges. Their registry bytes are tested separately rather than republished. Real Clef and Clef Flash REST inference passed; native Workers binding is covered by workerd fixtures but real binding inference remains blocked by the test account's development/preview permissions.

### Patch Changes

- Updated dependencies [35688ab]
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
