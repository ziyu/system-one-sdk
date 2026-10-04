---
"@system-one-ai/core": minor
"@system-one-ai/adapter-local": minor
"@system-one-ai/decisions": minor
"@system-one-ai/evaluation": minor
"@system-one-ai/batch": patch
"@system-one-ai/adapter-cloudflare": minor
"@system-one-ai/adapter-openrouter": patch
"@system-one-ai/adapter-system-one": patch
"@system-one-ai/adapter-vercel": patch
"@system-one-ai/policies": patch
"@system-one-ai/protocol-system-one": patch
"@system-one-ai/transport-fetch": patch
---

Add native multimodal image requests to core with `EvaluateRequest.images`, the provider-independent `ImageInput` type (embedded data URLs or `{ mediaType, base64 }`), representation/base64 validation and snapshot isolation. Adapters explicitly opt in through `supportsImages`; unsupported images fail before preparation, authentication or transport execution instead of silently becoming text-only.

Support `@cf/cloudflare/clef` and `@cf/cloudflare/clef-flash` through REST and the native Workers AI binding. Encode model-specific endpoints and selectors, map core image fields to Cloudflare's wire format, and enforce Clef's PNG/JPEG/WebP, count and decoded-byte limits. Preserve the existing Jev default and native answer precision. No provider-specific image options or image type exports are introduced.

Preserve images through decision composition, batch snapshots and evaluation context variants. Local model runners can opt in with `supportsImages: true`; text-only local runners reject image input. The core minor release must be installed with image-capable adapters and composition packages; Changesets updates internal dependency ranges together.

Correct legacy package repository URLs to `ziyu/system-one-sdk` so package provenance metadata matches the release workflow. Real Clef and Clef Flash REST inference passed; native Workers binding is covered by workerd fixtures but real binding inference remains blocked by the test account's development/preview permissions.
