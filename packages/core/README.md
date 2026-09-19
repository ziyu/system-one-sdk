# @system-one-ai/core

Create a shared `evaluate` client, define choice, score and boolean questions, and validate model answers. Supply the adapter for your model service and a transport when creating the client.

```ts
import { createSystemOne } from '@system-one-ai/core';
// Supply an explicit adapter and transport to createSystemOne({ adapter, transport, apiKey }).
```

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/core`.
