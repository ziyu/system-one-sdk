import { systemOneAdapter } from '@system-one-ai/adapter-system-one';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import {
  SystemOne, defineFields, textField, numberField, dateField, timeField, dateTimeField, durationField,
  listField, estimateField, forecastField,
  type ExtractRequest, type ExtractResult, type FieldAnswers,
} from '@system-one-ai/core';

const client = new SystemOne({ adapter: systemOneAdapter, transport: createFetchTransport(), apiKey: 'compile-time-only' });
const fields = defineFields({
  invoice_number: textField(),
  total: numberField({ decimals: 2, unit: 'USD' }),
  issued: dateField(),
  opens: timeField(),
  signed: dateTimeField(),
  delay: durationField({ unit: 'days' }),
  contacts: listField({ items: 'text' }),
  amounts: listField({ items: 'number' }),
  days_to_pay: estimateField({ min: 0, max: 120, step: 1 }),
  travelers: forecastField({ min: 500000, max: 4000000, horizon: 1, interval: 'day' }),
});

type InvoiceRequest = ExtractRequest<typeof fields>;
type InvoiceResult = ExtractResult<typeof fields>;
type InvoiceAnswers = FieldAnswers<typeof fields>;

const request: InvoiceRequest = {
  state: 'Invoice INV-2291',
  fields,
  referenceDate: '2026-10-19',
  options: { includeQuantiles: true, nullThreshold: 0.8 },
};

async function verifyExtract() {
  const result: InvoiceResult = await client.extract(request);
  const answers: InvoiceAnswers = result.answers;
  const invoice: string | null = answers.invoice_number.value;
  const total: number | null = answers.total.value;
  const issued: string | null = answers.issued.value;
  const opens: string | null = answers.opens.value;
  const signed: string | null = answers.signed.value;
  const delay: number | null = answers.delay.value;
  const contacts: readonly string[] = answers.contacts.value;
  const amounts: readonly number[] = answers.amounts.value;
  const estimate: number | string = answers.days_to_pay.value;
  const forecast: readonly (number | string)[] = answers.travelers.value;
  // @ts-expect-error Only requested field IDs exist.
  result.answers.unrequested;
  // @ts-expect-error Text answers are strings or null, not numbers.
  const numberInvoice: number = answers.invoice_number.value;
  // @ts-expect-error Number list items are numbers.
  const textAmounts: readonly string[] = answers.amounts.value;
  // @ts-expect-error Estimate answers do not expose confidence.
  answers.days_to_pay.confidence;
  const inline = await client.extract({ state: '', images: ['data:image/png;base64,AAAA'], fields: { name: { type: 'text' } } });
  const name: string | null = inline.answers.name.value;
  return { invoice, total, issued, opens, signed, delay, contacts, amounts, estimate, forecast, numberInvoice, textAmounts, name };
}

void verifyExtract;
