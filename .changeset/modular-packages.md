---
"@system-one-ai/core": minor
"@system-one-ai/transport-fetch": minor
"@system-one-ai/protocol-system-one": minor
"@system-one-ai/adapter-system-one": minor
"@system-one-ai/adapter-openrouter": minor
"@system-one-ai/adapter-cloudflare": minor
"@system-one-ai/adapter-vercel": minor
"@system-one-ai/adapter-llm": minor
"@system-one-ai/decisions": minor
"@system-one-ai/policies": minor
"@system-one-ai/batch": minor
---

BREAKING: migrate from the single `@system-one-ai/sdk` package to independently installed packages. Core requires an explicit adapter and transport. Pass custom Fetch implementations to `createFetchTransport(fetch)`.

Preserve SDK 0.5.3's native Cloudflare Workers binding through `@system-one-ai/adapter-cloudflare/workers`, including typed binding errors, deadlines, cancellation and composition. LLM support remains a single optional adapter.

See the repository's `docs/migration-0.6.md` for installation and import mappings.
