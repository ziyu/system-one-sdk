import { createSystemOne, choice, type Transport } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { systemOneAdapter } from '@system-one-ai/adapter-system-one';
import { llmAdapter } from '@system-one-ai/adapter-llm';
import { evaluateMany } from '@system-one-ai/batch';

const transport: Transport = createFetchTransport();
const client = createSystemOne({ adapter: systemOneAdapter, transport, apiKey: null });
createSystemOne({ adapter: llmAdapter(), transport, apiKey: null, model: 'fixture' });
// @ts-expect-error Core never supplies a concrete adapter.
createSystemOne({ transport, apiKey: null });
// @ts-expect-error Core never supplies a concrete transport.
createSystemOne({ adapter: systemOneAdapter, apiKey: null });
// @ts-expect-error Fetch implementation options belong to transport-fetch.
createSystemOne({ adapter: systemOneAdapter, transport, apiKey: null, fetch: globalThis.fetch });
async function check() {
  const request = { state: 'on', questions: { action: choice('Action?', { on: null, off: null }) } };
  const result = await client.evaluate(request);
  const action: 'on' | 'off' = result.answers.action.choice;
  // @ts-expect-error Closed question choices survive independent packages.
  const invalid: 'missing' = result.answers.action.choice;
  const report = await evaluateMany(client, [{ id: 'one', request }]);
  if (report.items[0].status === 'fulfilled') {
    const value: 'on' | 'off' = report.items[0].value.answers.action.choice;
    void value;
  }
  void [action, invalid];
}
void check;
