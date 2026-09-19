# @system-one-ai/adapter-llm

llm decision protocol adapter. Install this package alongside core and transport-fetch; other adapters are not required.

```ts
import { createSystemOne } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { llmAdapter } from '@system-one-ai/adapter-llm';

const client = createSystemOne({
  adapter: llmAdapter({ provider: 'openai', api: 'chat_completions' }),
  transport: createFetchTransport(),
  apiKey: process.env.API_KEY!,
  model: 'your-model',
});
```

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/adapter-llm`.
