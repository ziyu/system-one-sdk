# @system-one-ai/adapter-system-one

## 0.7.0

### Minor Changes

- d971587: 新增 Clairic extract()
- ab56588: Add Clairic extraction to core: typed field specs (`text`, `number`, `date`, `time`, `datetime`, `duration`, `list`, `estimate`, `forecast`), `extract({ state, fields })` on the shared client, and client-side validation of field names, per-type properties, image limits (PNG/JPEG/WebP, at most four, 4 MiB each, 8 MiB total decoded) and a 16 MiB JSON body.

  `systemOneAdapter` defaults to `https://system-one.dev/v1` and sends extract requests to `{baseURL}/systemone` (`POST https://system-one.dev/v1/systemone`) with a `fields` body and default model `clairic`. Direct Cloudflare REST and Workers bindings encode the same field schema on the Clairic model path. Adapters opt in with `supportsExtract`; question-only adapters reject `extract()` before I/O.

  Protocol and Fetch packages are included so extract-capable adapters resolve the same core generation as the new extract types and error classes. Unchanged LLM, local, WebGPU, Laya, ONNX, decisions, evaluation and batch packages keep their published versions.

  `adapter-system-one` package metadata now points `repository.url` at the canonical GitHub repository `ziyu/system-one-sdk`.

### Patch Changes

- Updated dependencies [d971587]
- Updated dependencies [ab56588]
  - @system-one-ai/core@0.8.0
  - @system-one-ai/protocol-system-one@0.8.0

## 0.6.0

### Minor Changes

- afcbe0c: BREAKING: migrate from the single `@system-one-ai/sdk` package to independently installed packages. Core requires an explicit adapter and transport. Pass custom Fetch implementations to `createFetchTransport(fetch)`.

  Preserve SDK 0.5.3's native Cloudflare Workers binding through `@system-one-ai/adapter-cloudflare/workers`, including typed binding errors, deadlines, cancellation and composition. LLM support remains a single optional adapter.

  See the repository's `docs/migration-0.6.md` for installation and import mappings.

### Patch Changes

- Updated dependencies [afcbe0c]
  - @system-one-ai/core@0.6.0
  - @system-one-ai/protocol-system-one@0.6.0

## 0.6.0-rc.0

### Minor Changes

- afcbe0c: BREAKING: migrate from the single `@system-one-ai/sdk` package to independently installed packages. Core requires an explicit adapter and transport. Pass custom Fetch implementations to `createFetchTransport(fetch)`.

  Preserve SDK 0.5.3's native Cloudflare Workers binding through `@system-one-ai/adapter-cloudflare/workers`, including typed binding errors, deadlines, cancellation and composition. LLM support remains a single optional adapter.

  See the repository's `docs/migration-0.6.md` for installation and import mappings.

### Patch Changes

- Updated dependencies [afcbe0c]
  - @system-one-ai/core@0.6.0-rc.0
  - @system-one-ai/protocol-system-one@0.6.0-rc.0
