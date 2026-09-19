# @system-one-ai/adapter-cloudflare

cloudflare decision protocol adapter. Install this package alongside core and transport-fetch; other adapters are not required.

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

Requires Node.js 20+. This workspace is not yet published separately. Build from the repository with `npm run build --workspace @system-one-ai/adapter-cloudflare`.

Native Workers AI bindings are available through the explicit `@system-one-ai/adapter-cloudflare/workers` entry. `createCloudflareWorkers({ binding: env.AI })` implements core's `EvaluationClient` and needs no API token or REST account URL. The REST entry does not load the binding client. Both paths share validation and response codecs.
