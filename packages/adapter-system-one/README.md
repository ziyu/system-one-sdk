# @system-one-ai/adapter-system-one

Connect to the hosted System One service (`https://system-one.dev/v1`) to answer choice, score and boolean questions with native decision models. Install this package with `@system-one-ai/core` and `@system-one-ai/transport-fetch`.

```ts
import { createSystemOne } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { systemOneAdapter } from '@system-one-ai/adapter-system-one';

const client = createSystemOne({
  adapter: systemOneAdapter,
  transport: createFetchTransport(),
  apiKey: process.env.API_KEY!,
});
```

Extraction uses the same client. `extract()` posts to `{baseURL}/extract` (`POST https://system-one.dev/v1/extract` by default) with the Clairic field schema. The default extract model is `clairic`.

```ts
import { textField } from '@system-one-ai/core';

const extracted = await client.extract({
  state: 'Invoice INV-2291, total $1,080.00.',
  fields: { invoice_number: textField(), total: { type: 'number', decimals: 2, unit: 'USD' } },
});
extracted.answers.invoice_number.value;
```

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/adapter-system-one`.
