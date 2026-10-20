---
"@system-one-ai/core": minor
"@system-one-ai/adapter-system-one": minor
"@system-one-ai/adapter-cloudflare": minor
"@system-one-ai/protocol-system-one": minor
"@system-one-ai/transport-fetch": minor
---

Add Clairic extraction to core: typed field specs (`text`, `number`, `date`, `time`, `datetime`, `duration`, `list`, `estimate`, `forecast`), `extract({ state, fields })` on the shared client, and client-side validation of field names, per-type properties, image limits (PNG/JPEG/WebP, at most four, 4 MiB each, 8 MiB total decoded) and a 16 MiB JSON body.

`systemOneAdapter` sends extract requests to `{baseURL}/extract` (typically `POST /v1/extract`) with default model `clairic`. Direct Cloudflare REST and Workers bindings encode the same field schema on the Clairic model path. Adapters opt in with `supportsExtract`; question-only adapters reject `extract()` before I/O.

Protocol and Fetch packages are included so extract-capable adapters resolve the same core generation as the new extract types and error classes. Unchanged LLM, OpenRouter, Vercel, local, WebGPU, Laya, ONNX, decisions, policies, evaluation and batch packages keep their published versions.
