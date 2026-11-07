# @system-one-ai/protocol-openai-decisions

Convert between System One questions/answers and the OpenAI Decisions wire format. The codec has no endpoint, model, authentication or request lifecycle; provider adapters supply those. It is shared by `@system-one-ai/adapter-openai-decisions` and the Cloudflare OpenAI Decisions path.

```ts
import {
  encodeOpenAiDecisionsRequest,
  decodeOpenAiDecisionsResponse,
} from '@system-one-ai/protocol-openai-decisions';
```

`encodeOpenAiDecisionsRequest()` accepts an optional `maxQuestions` cap. The default is OpenAI's native 400-question limit; Cloudflare's proxied schema uses 200. Choice questions are limited to 2–255 options, and score questions to 2–10 levels.

Object state and arrays of objects are encoded as `input_json` parts, matching OpenAI's native Decisions schema. Pass `structuredState: 'text'` for a provider whose published schema only accepts `input_text` and `input_image`; top-level arrays containing primitives also fall back to JSON text because `input_json.data` represents an object or an array of objects.

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/protocol-openai-decisions`.
