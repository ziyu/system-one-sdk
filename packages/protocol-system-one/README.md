# @system-one-ai/protocol-system-one

Convert between this library’s questions/answers and the native System One wire format, shared by the TypeSafe, OpenRouter and Cloudflare adapters. The native adapters install this dependency automatically; use it directly when building a compatible adapter.

```ts
import { nativeQuestions, decodeNative } from '@system-one-ai/protocol-system-one';
```

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/protocol-system-one`.
