---
"@system-one-ai/adapter-openai-decisions": minor
"@system-one-ai/protocol-openai-decisions": minor
"@system-one-ai/adapter-cloudflare": minor
---

Separate the OpenAI Decisions wire protocol from Cloudflare. Add `protocol-openai-decisions` as a provider-neutral codec and `adapter-openai-decisions` for OpenAI (`POST /v1/decisions`) or another compatible provider selected through `baseURL`, `apiKey` and `model`. Cloudflare keeps only its runner wrapper for `openai/decisions`, reusing the shared codec and enforcing Cloudflare's narrower schema limits. The codec maps boolean/choice/score questions to predicate/choice/score, sends object and array-of-object state through `input_json`, supports ordered image parts, enforces 2-255 choices and 2-10 score levels, and decodes answer arrays while preserving confidence and token usage. Providers whose published schema omits `input_json` can opt into text state encoding explicitly.
