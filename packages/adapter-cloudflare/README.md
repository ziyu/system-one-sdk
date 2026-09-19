# @system-one-ai/adapter-cloudflare

Run System One models on Cloudflare through its REST API or the native `env.AI` binding inside Workers. Install this package with `@system-one-ai/core` and `@system-one-ai/transport-fetch`.

```ts
import { createSystemOne } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { cloudflareAdapter } from '@system-one-ai/adapter-cloudflare';

const client = createSystemOne({
  adapter: cloudflareAdapter({ accountId: 'your-account' }),
  transport: createFetchTransport(),
  apiKey: process.env.API_KEY!,
});
```

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/adapter-cloudflare`.

Native Workers AI bindings are available through the explicit `@system-one-ai/adapter-cloudflare/workers` entry. `createCloudflareWorkers({ binding: env.AI })` implements core's `EvaluationClient` and needs no API token or REST account URL. The REST entry does not load the binding client. Both paths share validation and response codecs.
