# @system-one-ai/transport-fetch

Send model requests using Fetch, with authentication, timeouts, cancellation, retries and response size limits.

```ts
import { createFetchTransport } from '@system-one-ai/transport-fetch';
const transport = createFetchTransport(); // or createFetchTransport(customFetch)
```

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/transport-fetch`.
