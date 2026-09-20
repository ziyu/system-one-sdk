import { createBrowserClient, createLayaDriver } from '@system-one-ai/adapter-webgpu';

const element = id => document.getElementById(id);
let client;
let controller;
let busy = false;

function controls() {
  element('load').disabled = busy || Boolean(client);
  element('manifest').disabled = busy || Boolean(client);
  element('device').disabled = busy || Boolean(client);
  element('run').disabled = busy || !client;
  element('unload').disabled = busy || !client;
  element('cancel').disabled = !busy;
}
function status(message) { element('status').textContent = message; }

element('load').addEventListener('click', async () => {
  busy = true;
  controller = new AbortController();
  controls();
  status('Checking local runtime and exported assets…');
  try {
    client = await createBrowserClient({
      device: element('device').value,
      driver: createLayaDriver({
        manifestUrl: element('manifest').value.trim(), signal: controller.signal,
        onProgress({ status: stage }) {
          const messages = { manifest: 'Reading exported model configuration…', tokenizer: 'Loading tokenizer…', model: 'Loading weights and compiling the ONNX graph…', ready: 'Local model is ready.' };
          status(messages[stage]);
        },
      }),
    });
  } catch (error) { status(error.message); }
  finally { busy = false; controller = undefined; controls(); }
});

element('run').addEventListener('click', async () => {
  if (!client) return;
  busy = true;
  controller = new AbortController();
  controls();
  status('Evaluating with the local model…');
  const started = performance.now();
  try {
    const questions = JSON.parse(element('questions').value);
    const result = await client.evaluate({ state: element('state').value, questions }, { signal: controller.signal });
    element('result').textContent = JSON.stringify(result, null, 2);
    element('timing').textContent = `${(performance.now() - started).toFixed(1)} ms · ${result.usage.inputTokens} input tokens · ${result.usage.outputTokens} generated tokens`;
    status(result.warnings?.length ? 'Evaluation completed. Input truncation warnings are included below.' : `Evaluation completed with ${result.providerMetadata.device}.`);
  } catch (error) { status(error.message); }
  finally { busy = false; controller = undefined; controls(); }
});

element('cancel').addEventListener('click', () => {
  controller?.abort();
  status('Cancelled. Already submitted inference finishes before the next run.');
});
element('unload').addEventListener('click', async () => {
  busy = true;
  controls();
  try { await client?.dispose(); client = undefined; status('Model resources released.'); }
  catch (error) { status(error.message); }
  finally { busy = false; controls(); }
});
status('gpu' in navigator ? 'WebGPU is exposed. Load the exported Laya model to begin.' : 'WebGPU is unavailable. Automatic mode will use WASM / CPU.');
controls();
