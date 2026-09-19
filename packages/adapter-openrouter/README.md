# @system-one-ai/adapter-openrouter

Call System One models through OpenRouter Decisions and convert answers, usage and cost metadata into this library’s results. Install this package with `@system-one-ai/core` and `@system-one-ai/transport-fetch`.

```ts
import { createSystemOne } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { openRouterAdapter } from '@system-one-ai/adapter-openrouter';

const client = createSystemOne({
  adapter: openRouterAdapter,
  transport: createFetchTransport(),
  apiKey: process.env.API_KEY!,
});
```

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/adapter-openrouter`.
