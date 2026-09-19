# @system-one-ai/transport-fetch

Fetch transport with authentication, total deadlines, cancellation, bounded response reading and HTTP retries.

```ts
import { createFetchTransport } from '@system-one-ai/transport-fetch';
const transport = createFetchTransport(); // or createFetchTransport(customFetch)
```

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/transport-fetch`.
