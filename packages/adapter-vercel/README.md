# @system-one-ai/adapter-vercel

Call decision models through Vercel AI Gateway’s Evaluation API, converting requests and answers to this library’s format. Install this package with `@system-one-ai/core` and `@system-one-ai/transport-fetch`.

```ts
import { createSystemOne } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { vercelAdapter } from '@system-one-ai/adapter-vercel';

const client = createSystemOne({
  adapter: vercelAdapter,
  transport: createFetchTransport(),
  apiKey: process.env.API_KEY!,
});
```

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/adapter-vercel`.
