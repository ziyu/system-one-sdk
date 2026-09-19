# @system-one-ai/adapter-openrouter

openrouter decision protocol adapter. Install this package alongside core and transport-fetch; other adapters are not required.

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
