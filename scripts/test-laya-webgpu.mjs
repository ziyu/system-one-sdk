import assert from 'node:assert/strict';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({ options: {
  manifest: { type: 'string', default: '.artifacts/laya/laya.json' },
  probe: { type: 'boolean', default: false },
  ui: { type: 'boolean', default: false },
  headed: { type: 'boolean', default: false },
} });
assert.ok(!(values.probe && values.ui), '--probe and --ui are separate checks.');
async function bounded(work, milliseconds) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Browser check exceeded its ${milliseconds} ms execution limit.`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = path.resolve(root, values.manifest);
assert.ok(manifest.startsWith(root + path.sep), 'The manifest must be inside this repository.');
if (!values.probe) assert.ok(existsSync(manifest), 'Export the trained model with scripts/laya/export.py before running browser parity.');
const artifacts = path.join(root, '.artifacts');
await mkdir(artifacts, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`);
    if (!file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end('Not found'); return;
    }
    response.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'content-length': statSync(file).size });
    createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch { response.writeHead(400).end('Invalid path'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const candidates = [
  chromium.executablePath(),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const executablePath = candidates.find(candidate => existsSync(candidate));
const report = { kind: values.probe ? 'browser-probe' : values.ui ? 'trained-model-demo-smoke' : 'trained-model-webgpu-parity', passed: false, startedAt: new Date().toISOString(), consoleErrors: [], consoleWarnings: [] };
let browser;
try {
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: !values.headed });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  report.stages = [];
  await page.exposeFunction('recordLayaStage', event => {
    report.stages.push(event);
    console.log(`Laya: ${JSON.stringify(event)}`);
  });
  if (!values.ui) await page.addInitScript(() => {
    window.layaGPUDispatches = 0;
    if (typeof GPUDevice !== 'undefined') {
      const createBuffer = GPUDevice.prototype.createBuffer;
      GPUDevice.prototype.createBuffer = function (descriptor) {
        try { return createBuffer.call(this, descriptor); }
        catch (error) {
          void window.recordLayaStage({ status: 'gpu-error', operation: 'createBuffer', size: descriptor.size, usage: descriptor.usage, message: error.message, maxBufferSize: this.limits.maxBufferSize });
          throw error;
        }
      };
    }
    if (typeof GPUComputePassEncoder !== 'undefined') {
      for (const method of ['dispatchWorkgroups', 'dispatchWorkgroupsIndirect']) {
        const dispatch = GPUComputePassEncoder.prototype[method];
        GPUComputePassEncoder.prototype[method] = function (...args) {
          window.layaGPUDispatches++;
          return dispatch.apply(this, args);
        };
      }
    }
    if (typeof GPUAdapter === 'undefined') return;
    const original = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...args) {
      const device = await original.apply(this, args);
      device.addEventListener('uncapturederror', event => { void window.recordLayaStage({ status: 'gpu-error', message: event.error.message }); });
      void device.lost.then(info => window.recordLayaStage({ status: 'device-lost', reason: info.reason, message: info.message }));
      return device;
    };
  });
  page.on('console', message => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const target = message.type() === 'warning' || message.text().includes('[W:onnxruntime:') ? report.consoleWarnings : report.consoleErrors;
    if (target.length < 10) target.push(message.text().slice(0, 1500));
  });
  page.on('pageerror', error => { if (report.consoleErrors.length < 10) report.consoleErrors.push(error.message); });
  await page.goto(`${base}/examples/laya-webgpu-demo/`);
  await page.waitForFunction(() => document.getElementById('status').textContent !== 'Checking browser capabilities…');
  assert.equal(await page.locator('#run').isDisabled(), true);
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Demo overflows at 375px.');
  await page.screenshot({ path: path.join(artifacts, 'laya-demo-mobile.png'), fullPage: true });
  report.browser = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    const info = adapter?.info;
    return { userAgent: navigator.userAgent, webgpu: Boolean(adapter), adapter: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null, features: adapter ? [...adapter.features] : [] };
  });
  assert.equal(report.browser.webgpu, true, 'A real WebGPU adapter is required; no software fallback is used by this check.');
  report.modules = await bounded(page.evaluate(async () => {
    const [ort, tokenizers] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs'),
      import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js'),
    ]);
    if (typeof ort.InferenceSession?.create !== 'function' || typeof tokenizers.PreTrainedTokenizer !== 'function') throw new Error('Pinned runtime modules do not expose the required APIs.');
    return { onnxruntime: ort.env.versions, tokenizerConstructor: typeof tokenizers.PreTrainedTokenizer };
  }), 90_000);
  if (values.ui) {
    const manifestUrl = `${base}/${path.relative(root, manifest).split(path.sep).join('/')}`;
    const fixture = await page.evaluate(async manifestUrl => {
      const response = await fetch(new URL('parity-fixtures.json', manifestUrl));
      if (!response.ok) throw new Error('Missing trained-model fixtures.');
      return (await response.json()).cases[0];
    }, manifestUrl);
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.locator('#manifest').fill(manifestUrl);
    await page.locator('#device').selectOption('webgpu');
    await page.locator('#state').fill(fixture.request.state);
    await page.locator('#questions').fill(JSON.stringify(fixture.request.questions, null, 2));
    const loadedAt = performance.now();
    await page.locator('#load').click();
    await page.waitForFunction(() => !document.getElementById('run').disabled || !document.getElementById('load').disabled, undefined, { timeout: 180_000 });
    assert.equal(await page.locator('#run').isDisabled(), false, await page.locator('#status').innerText());
    const loadMs = performance.now() - loadedAt;
    await page.locator('#run').click();
    await page.waitForFunction(() => !document.getElementById('run').disabled, undefined, { timeout: 180_000 });
    assert.match(await page.locator('#status').innerText(), /^Evaluation completed/);
    const result = JSON.parse(await page.locator('#result').innerText());
    assert.equal(result.providerMetadata.device, 'webgpu');
    for (const [id, expected] of Object.entries(fixture.upstreamResponse.answers)) {
      const actual = result.answers[id];
      if (expected.type === 'choice') assert.equal(actual.choice, expected.choice);
      if (expected.type === 'noul') assert.ok(Math.abs(actual.probability - expected.noul) <= 0.0002);
      if (expected.type === 'score') assert.ok(Math.abs(actual.score - expected.score) <= 0.0002);
    }
    report.ui = { loadMs, timing: await page.locator('#timing').innerText(), questions: Object.keys(result.answers), device: result.providerMetadata.device };
    await page.locator('#result-title').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, 'laya-demo-result.png') });
    await page.locator('#unload').click();
    await page.waitForFunction(() => !document.getElementById('load').disabled, undefined, { timeout: 60_000 });
    assert.equal(await page.locator('#status').innerText(), 'Model resources released.');
    assert.equal(await page.locator('#run').isDisabled(), true);
    report.ui.disposed = true;
  } else if (!values.probe) {
    const manifestUrl = `${base}/${path.relative(root, manifest).split(path.sep).join('/')}`;
    report.parity = await bounded(page.evaluate(async manifestUrl => {
      const [{ createBrowserClient }, { createLayaDriver }, { prepareLayaRow }, { PreTrainedTokenizer }, ort] = await Promise.all([
        import('@system-one-ai/adapter-webgpu'), import('@system-one-ai/model-laya/browser'), import('@system-one-ai/model-laya'),
        import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js'),
        import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs'),
      ]);
      const fetchJSON = async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Asset failed: ${response.status} ${url}`);
        return response.json();
      };
      const manifest = await fetchJSON(manifestUrl);
      const fixtures = await fetchJSON(new URL('parity-fixtures.json', manifestUrl));
      if (fixtures.model !== manifest.model || fixtures.revision !== manifest.revision) throw new Error('Fixtures do not identify the loaded model.');
      const directory = new URL(`${manifest.tokenizer}/`, manifestUrl);
      const tokenizer = new PreTrainedTokenizer(await fetchJSON(new URL('tokenizer.json', directory)), await fetchJSON(new URL('tokenizer_config.json', directory)));
      const exact = (actual, expected, label) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: preprocessing differs from the original Python tokenizer.`);
      };
      const near = (actual, expected, label, atol = 0.0005, rtol = 0.0001) => {
        if (!Number.isFinite(actual) || Math.abs(actual - expected) > atol + rtol * Math.abs(expected)) throw new Error(`${label}: ${actual} differs from ${expected}.`);
      };
      let activeCase;
      let rawError = {};
      let runtimeError;
      // Instrument the real runtime without substituting its sessions or outputs.
      const observedOrt = { Tensor: ort.Tensor, InferenceSession: { async create(url, config) {
        if (JSON.stringify(config.executionProviders) !== '["webgpu"]') throw new Error('Expected the strict WebGPU provider.');
        const session = await ort.InferenceSession.create(url, config);
        return { inputNames: session.inputNames, outputNames: session.outputNames, release: () => session.release(), async run(feeds) {
          try {
          for (const [key, tensor] of Object.entries(feeds)) {
            const actual = Array.from(tensor.data, value => typeof value === 'bigint' ? Number(value) : key === 'marker_mask' ? Boolean(value) : value);
            exact(actual, activeCase.inputs[key].flat(), `${activeCase.name}.${key}`);
          }
          const outputs = await session.run(feeds);
          try {
            for (const key of ['logits', 'act_logits']) {
              const expected = activeCase.outputs[key].flat();
              const actual = Array.from(outputs[key].data);
              if (actual.length !== expected.length) throw new Error(`${key}: output shape differs.`);
              actual.forEach((value, index) => near(value, expected[index], `${activeCase.name}.${key}[${index}]`));
              rawError[key] = Math.max(...actual.map((value, index) => Math.abs(value - expected[index])));
            }
            return outputs;
          } catch (error) { Object.values(outputs).forEach(tensor => tensor.dispose()); throw error; }
          } catch (error) { runtimeError = error.stack ?? error.message; throw error; }
        } };
      } } };
      const started = performance.now();
      const client = await createBrowserClient({ driver: createLayaDriver({ manifestUrl, tokenizer, ort: observedOrt, batchSize: 64,
        onProgress: ({ status }) => { void window.recordLayaStage({ status }); },
      }), device: 'webgpu' });
      const loadMs = performance.now() - started;
      const results = [];
      let evaluationError;
      try {
        const repeat = fixtures.cases.find(fixture => fixture.name === 'one-row-two-options');
        const runs = [...fixtures.cases.map(fixture => ({ fixture, phase: 'first-shape-run' })),
          ...(repeat ? [{ fixture: repeat, phase: 'warm-repeat' }, { fixture: repeat, phase: 'warm-repeat' }] : [])];
        for (const { fixture, phase } of runs) {
          activeCase = fixture;
          rawError = {};
          runtimeError = undefined;
          await window.recordLayaStage({ status: 'case', name: fixture.name, phase });
          const rows = [];
          for (const [id, question] of Object.entries(fixture.request.questions)) rows.push(await prepareLayaRow(id, fixture.request.state, question, tokenizer, manifest));
          rows.forEach((row, index) => {
            exact(row.ids, fixture.inputs.input_ids[index].slice(0, row.ids.length), `${fixture.name}.${row.id}.tokens`);
            exact(row.markers, fixture.inputs.marker_pos[index].slice(0, row.markers.length), `${fixture.name}.${row.id}.markers`);
          });
          const start = performance.now();
          const dispatchesBefore = window.layaGPUDispatches;
          const result = await client.evaluate(fixture.request);
          const gpuDispatches = window.layaGPUDispatches - dispatchesBefore;
          if (!gpuDispatches) throw new Error(`${fixture.name}: no WebGPU compute dispatches were observed.`);
          for (const [id, expected] of Object.entries(fixture.upstreamResponse.answers)) {
            const actual = result.answers[id];
            if (expected.type === 'noul') near(actual.probability, expected.noul, `${id}.probability`, 0.0002, 0);
            else {
              if (expected.type === 'choice') exact(actual.choice, expected.choice, `${id}.choice`);
              else near(actual.score, expected.score, `${id}.score`, 0.0002, 0);
              near(actual.confidence, expected.confidence, `${id}.confidence`, 0.0002, 0);
              for (const [key, probability] of Object.entries(expected.probabilities)) near(actual.probabilities[key], probability, `${id}.${key}`, 0.0002, 0);
            }
            near(result.providerMetadata.actProbabilities[id], expected.rl_agent.act_probability, `${id}.act_probability`);
          }
          results.push({ name: fixture.name, phase, durationMs: performance.now() - start, gpuDispatches, rawError, inputTokens: result.usage.inputTokens });
        }
      } catch (error) { evaluationError = new Error(runtimeError ?? error.message); }
      finally {
        try { await client.dispose(); }
        catch (error) {
          if (!evaluationError) throw error;
          evaluationError.message += `\nCleanup also failed: ${error.stack ?? error.message}`;
        }
      }
      if (evaluationError) throw evaluationError;
      return { model: manifest.model, revision: manifest.revision, loadMs, cases: results };
    }, manifestUrl), 600_000);
  }
  assert.equal(report.consoleErrors.length, 0, 'The browser emitted unexpected errors.');
  assert.equal(report.stages.some(stage => stage.status === 'gpu-error' || (stage.status === 'device-lost' && stage.reason !== 'destroyed')), false, 'The GPU emitted an error or lost its device.');
  report.passed = true;
} catch (error) { report.error = error.stack ?? String(error); process.exitCode = 1; }
finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  const destination = path.join(artifacts, values.probe ? 'laya-browser-probe.json' : values.ui ? 'laya-ui-report.json' : 'laya-webgpu-report.json');
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${destination}`);
}
