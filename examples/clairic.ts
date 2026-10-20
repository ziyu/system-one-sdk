import { defineFields, estimateField, listField, numberField, textField, dateField } from '@system-one-ai/core';
import { exampleClient } from './config.js';

try {
  const client = exampleClient();
  const fields = defineFields({
    invoice_number: textField(),
    due_date: dateField({ instructions: 'Issue date plus the net payment days' }),
    total: numberField({ decimals: 2, unit: 'USD', instructions: 'Amount due including shipping' }),
    contacts: listField({ items: 'text' }),
    days_to_pay: estimateField({ min: 0, max: 120, step: 1, instructions: 'Days after issue until this invoice is paid' }),
  });
  const result = await client.extract({
    model: 'clairic',
    state: 'Invoice INV-2291 from Northwind Supply, issued 2026-09-02, net 30. 4 pallets at $250.00 each, shipping $80.00. Contact: Dana Ruiz, Priya Shah.',
    fields,
  });
  const invoice: string | null = result.answers.invoice_number.value;
  console.log({
    model: result.model,
    invoice,
    dueDate: result.answers.due_date.value,
    total: result.answers.total.value,
    contacts: result.answers.contacts.value,
    daysToPay: result.answers.days_to_pay.median,
    truncated: result.truncated,
    usage: result.usage,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Extraction failed.');
  process.exitCode = 1;
}
