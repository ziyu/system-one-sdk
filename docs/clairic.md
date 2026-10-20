# Clairic extraction

Clairic is a System One extraction model: it reads shared state and a map of typed fields, then returns one typed value per field. It does not generate free-form text. Decision models still use `evaluate({ state, questions })`; extraction uses `extract({ state, fields })`.

The hosted API path used by `systemOneAdapter` is `POST {baseURL}/extract`. The default `baseURL` is `https://system-one.dev/v1`, so extract is `POST https://system-one.dev/v1/extract`. If `baseURL` already ends in `/systemone`, the adapter replaces that suffix with `/extract`. The default extract model is `clairic`.

```ts
import { createSystemOne, defineFields, textField, numberField, dateField, listField, estimateField } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { systemOneAdapter } from '@system-one-ai/adapter-system-one';

const client = createSystemOne({
  adapter: systemOneAdapter,
  transport: createFetchTransport(),
  apiKey: process.env.SYSTEM_ONE_API_KEY!,
});

const fields = defineFields({
  invoice_number: textField(),
  due_date: dateField({ instructions: 'Issue date plus the net payment days' }),
  total: numberField({ decimals: 2, unit: 'USD', instructions: 'Amount due including shipping' }),
  contacts: listField({ items: 'text' }),
  days_to_pay: estimateField({ min: 0, max: 120, step: 1 }),
});

const result = await client.extract({
  model: 'clairic',
  state: 'Invoice INV-2291 from Northwind Supply, issued 2026-09-02, net 30.',
  fields,
  referenceDate: '2026-10-19',
  options: { includeQuantiles: false },
});

const invoice: string | null = result.answers.invoice_number.value;
```

## Request

| Field | Rule |
| --- | --- |
| `fields` | Required. At least one named field; no upper limit. Names match `[A-Za-z_][A-Za-z0-9_.-]{0,63}`. |
| `state` | String to read. Required and nonempty unless `images` are sent. Text answers are spans of this string. |
| `images` | Optional. At most four embedded PNG, JPEG or WebP images (4 MiB decoded each, 8 MiB total). Remote URLs are rejected. The JSON body may not exceed 16 MiB. |
| `referenceDate` | Optional ISO date (`YYYY-MM-DD`) that anchors dates written without a year. |
| `options.nullThreshold` | Optional `(0, 1]`, default `0.5` on the service. Applied to scalar fields that omit their own threshold. `value` is `null` when `pNull` is above the threshold; `guess` may still hold a value. |
| `options.includeQuantiles` | Optional. Adds all 99 percentiles to estimate and forecast answers. |
| `options.returnStateText` | Optional. Returns the text that spans index into. |

Field types: `text`, `number`, `date`, `time`, `datetime`, `duration`, `list`, `estimate`, `forecast`. Per-type properties include `instructions`, `unit`, `integer`, `decimals` (0–6), `items` (`text` \| `number` \| `date`, required on lists), `min`/`max` (required on estimate/forecast), `step`, `scale` (`linear` \| `log`), `horizon` (1–64) and `interval`.

## Response

Only `value` is guaranteed on each answer. Scalar types also report `guess`, `confidence` and `pNull` when the model sends them. Text includes `span: [start, end]`. Lists include `value` and optional `spans`. Estimates and forecasts include `mean`, `median`, `p10`, `p90`, `pBelow` and `pAbove`; they do not use `confidence` / `pNull`. Forecast `value` is an array, one step ahead.

`usage` normalizes wire token counts to `inputTokens`, `outputTokens`, `totalTokens`, and optional `stateTokens`, `imageTokens`, `schemaTokens`, `passes`. `truncated` is always a boolean.

Adapters opt in with `supportsExtract: true` and implement `prepareExtract` / `decodeExtract`. Adapters that only implement `evaluate` reject `extract()` with `UnsupportedFeatureError` before I/O.
