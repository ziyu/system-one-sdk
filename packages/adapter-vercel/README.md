# @system-one-ai/adapter-vercel

vercel decision protocol adapter. Install this package alongside core and transport-fetch; other adapters are not required.

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

Requires Node.js 20+. This workspace is not yet published separately. Build from the repository with `npm run build --workspace @system-one-ai/adapter-vercel`.
