import { choice } from '@system-one-ai/core';
import { createOpenJevWebGPUClient, OPENJEV_MODELS } from '@system-one-ai/adapter-webgpu';

const $ = (selector) => document.querySelector(selector);
const modelSelect = $('#model-select');
const loadButton = $('#load-button');
const runButton = $('#run-button');
const stateInput = $('#state-input');
const questionInput = $('#question-input');
const optionsList = $('#options-list');
const modelIds = Object.keys(OPENJEV_MODELS);
let client;
let loading = false;

for (const id of modelIds) {
  const model = OPENJEV_MODELS[id];
  const option = document.createElement('option');
  option.value = id;
  option.textContent = `${model.name}  ·  ${model.size}`;
  modelSelect.append(option);
}
modelSelect.value = 'minicpm5-2b';

function setOptions(values) {
  optionsList.replaceChildren();
  values.forEach((value, index) => {
    const row = document.createElement('label');
    row.className = 'option-row';
    const letter = document.createElement('b');
    letter.textContent = String.fromCharCode(65 + index);
    const input = document.createElement('input');
    input.className = 'option-input';
    input.value = value;
    input.placeholder = 'Describe this option';
    input.setAttribute('aria-label', `Option ${String.fromCharCode(65 + index)}`);
    row.append(letter, input);
    optionsList.append(row);
  });
  $('#option-count').textContent = `${values.length} / 20`;
  $('#remove-option').disabled = values.length <= 2;
  $('#add-option').disabled = values.length >= 20;
}

function renderModel() {
  const model = OPENJEV_MODELS[modelSelect.value];
  $('#model-size').textContent = model.size;
  $('#model-note').textContent = `${model.name} · pinned GGUF checkpoint. First load downloads to browser cache; later loads reuse it.`;
  $('#result-model').textContent = `${model.name.toUpperCase()} / NOT LOADED`;
}

function setStatus(message, percent = null, kind = '') {
  $('#load-status').textContent = message;
  $('#download-percent').textContent = percent === null ? '—' : `${Math.round(percent)}%`;
  if (percent !== null) $('#download-meter').style.width = `${Math.min(100, Math.max(0, percent))}%`;
  $('#gpu-pip').classList.toggle('ok', kind === 'ok');
}

function modelProgress(progress) {
  if (progress.total && progress.loaded !== undefined) setStatus(progress.status === 'done' ? 'checkpoint cached' : 'downloading checkpoint', progress.loaded / progress.total * 100);
  else if (progress.status === 'initiate') setStatus('checking browser cache');
}

async function loadModel() {
  if (loading || client) return;
  loading = true;
  loadButton.disabled = true;
  modelSelect.disabled = true;
  document.body.classList.add('is-loading');
  setStatus('checking WebGPU');
  try {
    client = await createOpenJevWebGPUClient({ model: modelSelect.value, onProgress: modelProgress });
    const model = OPENJEV_MODELS[modelSelect.value];
    setStatus(`${model.name} ready on WebGPU`, 100, 'ok');
    $('#result-model').textContent = `${model.name.toUpperCase()} / READY`;
    loadButton.innerHTML = '<span class="button-icon">✓</span> CHECKPOINT READY';
    runButton.disabled = false;
  } catch (error) {
    setStatus(error?.message || String(error));
    loadButton.disabled = false;
    modelSelect.disabled = false;
  } finally {
    loading = false;
    document.body.classList.remove('is-loading');
  }
}

function renderResult(result, startedAt) {
  const answer = result.answers.decision;
  const model = OPENJEV_MODELS[modelSelect.value];
  const entries = Object.entries(answer.probabilities || {});
  const winner = answer.choice;
  $('#answer-text').textContent = winner ? `${winner} · ${(result.answers.decision.probabilities[winner] * 100).toFixed(1)}%` : '—';
  $('#answer-badge').textContent = winner ? 'HIGHEST PROBABILITY' : 'NO CHOICE';
  $('#result-bars').replaceChildren(...entries.map(([key, probability]) => {
    const row = document.createElement('div');
    row.className = 'choice-bar';
    const name = document.createElement('span');
    name.className = 'choice-name';
    name.textContent = key;
    const track = document.createElement('span');
    track.className = 'bar-track';
    const fill = document.createElement('i');
    fill.className = 'bar-fill';
    fill.style.width = `${probability * 100}%`;
    track.append(fill);
    const score = document.createElement('span');
    score.className = 'choice-prob';
    score.textContent = `${(probability * 100).toFixed(1)}%`;
    row.append(name, track, score);
    return row;
  }));
  $('#meta-model').textContent = model.name;
  $('#meta-input').textContent = result.usage.inputTokens ? `${result.usage.inputTokens} tok` : '—';
  $('#meta-output').textContent = result.usage.outputTokens ? `${result.usage.outputTokens} tok` : '—';
  $('#meta-time').textContent = `${Date.now() - startedAt} ms`;
}

async function runDecision() {
  if (!client) return;
  const values = [...document.querySelectorAll('.option-input')].map((input) => input.value.trim());
  if (!stateInput.value.trim() || !questionInput.value.trim() || values.some((value) => !value)) {
    setStatus('state, question and every option must be nonempty');
    return;
  }
  runButton.disabled = true;
  runButton.innerHTML = '<span class="button-icon">↻</span> RUNNING LOCALLY';
  $('#answer-badge').textContent = 'GENERATING JSON';
  $('#result-bars').innerHTML = '<div class="empty-state">The loaded checkpoint is generating a structured answer…</div>';
  const startedAt = Date.now();
  try {
    const criteria = Object.fromEntries(values.map((value, index) => [String.fromCharCode(65 + index), value]));
    const result = await client.evaluate({ state: stateInput.value.trim(), questions: { decision: choice(questionInput.value.trim(), criteria) } });
    renderResult(result, startedAt);
    setStatus('decision complete', 100, 'ok');
  } catch (error) {
    $('#answer-badge').textContent = 'INFERENCE ERROR';
    $('#result-bars').innerHTML = `<div class="empty-state">${error?.message || String(error)}</div>`;
  } finally {
    runButton.disabled = false;
    runButton.innerHTML = '<span class="button-icon">↗</span> RUN AGAIN';
  }
}

$('#add-option').addEventListener('click', () => {
  const values = [...document.querySelectorAll('.option-input')].map((input) => input.value);
  if (values.length < 20) setOptions([...values, '']);
});
$('#remove-option').addEventListener('click', () => {
  const values = [...document.querySelectorAll('.option-input')].map((input) => input.value);
  if (values.length > 2) setOptions(values.slice(0, -1));
});
modelSelect.addEventListener('change', renderModel);
loadButton.addEventListener('click', loadModel);
runButton.addEventListener('click', runDecision);
setOptions(['Account access support', 'Billing support', 'Close as resolved']);
renderModel();
if (!('gpu' in navigator)) setStatus('WebGPU unavailable · use Chrome/Edge over HTTPS or localhost');
else setStatus('WebGPU detected · choose LOAD CHECKPOINT');
