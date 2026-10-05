---
"@system-one-ai/core": minor
"@system-one-ai/adapter-local": minor
"@system-one-ai/decisions": minor
"@system-one-ai/evaluation": minor
"@system-one-ai/batch": minor
"@system-one-ai/adapter-cloudflare": minor
"@system-one-ai/protocol-system-one": minor
"@system-one-ai/transport-fetch": minor
---

Add native multimodal image requests to core with `EvaluateRequest.images`, the provider-independent `ImageInput` type (embedded data URLs or `{ mediaType, base64 }`), representation/base64 validation and snapshot isolation. Adapters explicitly opt in through `supportsImages`; unsupported images fail before preparation, authentication or transport execution instead of silently becoming text-only.

Support `@cf/cloudflare/clef` and `@cf/cloudflare/clef-flash` through REST and the native Workers AI binding. Encode model-specific endpoints and selectors, map core image fields to Cloudflare's wire format, and enforce Clef's PNG/JPEG/WebP, count and decoded-byte limits. Preserve the existing Jev default and native answer precision. No provider-specific image options or image type exports are introduced.

Preserve images through decision composition, batch snapshots and evaluation context variants. Local model runners can opt in with `supportsImages: true`; text-only local runners reject image input.

Release scope is limited to eight packages: core, adapter-cloudflare, adapter-local, decisions and evaluation have implementation changes; batch must require the image-aware core snapshot; protocol-system-one and transport-fetch must resolve the same core error classes as Cloudflare to preserve instanceof checks, retries and cancellation. The three dependency-contract changes use the 0.7 line, not a 0.6 patch, so existing ^0.6 consumers cannot accidentally acquire a different core generation. Changesets updates dependency ranges only inside this explicit set.

Unchanged LLM, OpenRouter, TypeSafe, Vercel, WebGPU, Laya, ONNX and policy packages keep their published versions, manifests and dependency ranges. Their registry bytes are tested separately rather than republished. Real Clef and Clef Flash REST inference passed; native Workers binding is covered by workerd fixtures but real binding inference remains blocked by the test account's development/preview permissions.
