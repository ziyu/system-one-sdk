# Export Laya for the browser adapter

These scripts export the complete original bidirectional encoder, two-layer decision head, and action head from [`convaiinnovations/laya`](https://huggingface.co/convaiinnovations/laya/tree/1c5edc17a7acd8701df6fc341c0d179f1c62c982), pinned to revision `1c5edc17a7acd8701df6fc341c0d179f1c62c982`. They load the checkpoint strictly and use its own `rl_common.py` and `rl_agent_api.py` for reference preprocessing and inference. Transformers remote custom code and authentication are disabled.

The [recorded trained-model validation](VALIDATION.md) documents the successful complete export, six CPU parity cases, artifact sizes, and the separate browser verification requirement. CPU parity does not establish WebGPU support or browser latency.

Use Python 3.12 in an isolated environment. For Windows PowerShell:

```powershell
py -3.12 -m venv .research/laya-venv
.research\laya-venv\Scripts\python.exe -m pip install -r scripts/laya/requirements.txt
.research\laya-venv\Scripts\python.exe scripts/laya/export.py --output .artifacts/laya
```

When the default Python is a different version, create the environment with `uv venv --python 3.12 .research/laya-venv`. On macOS/Linux use `.research/laya-venv/bin/python` instead. Export runs on CPU in FP32 and downloads the root checkpoint only, excluding multilingual checkpoints. It needs several gigabytes of memory and disk for the checkpoint, graph, external weights, and framework. No browser latency or GPU compatibility is inferred from this step.

The output directory must be empty. The export uses opset 18, a dynamic batch, sequence length, and option count, and writes `laya.json` only after Python/ONNX Runtime numerical verification succeeds. A failed run can leave diagnostic intermediate files; choose a fresh output directory after fixing the failure.

Loading uses a meta architecture, strict checkpoint assignment, and reconstruction of ModernBERT's nonpersistent rotary buffers to avoid a second random copy of the full model. Verification captures reference outputs before releasing PyTorch weights and opening ONNX Runtime. The exporter captures the non-singleton batch branch required by Torch's shape guards; actual ONNX Runtime batch-one cases are mandatory in the default verification suite.

For Windows commit limits, the loader converts the original checkpoint in small chunks into a read-only FP32 cache under `.research/laya-fp32`. Source and converted data are checked with SHA-256; the full parameter set is assigned directly from a read-only mapping. Pass `--weight-cache-dir` to place this cache elsewhere and `--threads` to change the default four CPU threads. These mapped parameters are inference-only and must never be modified in place or used with an optimizer.

`UPSTREAM_MODEL_CARD.md` preserves the checkpoint's original model card and license metadata. Any root license/notice files present at that revision are copied with an `UPSTREAM_` prefix; `MODEL_PROVENANCE.md` records the original source and identifies those documents. The environment pins Transformers 5.0.0 to match the saved encoder configuration.

| Graph input | Type | Shape |
| --- | --- | --- |
| `input_ids` | int64 | `[batch, sequence]` |
| `attention_mask` | int64 | `[batch, sequence]` |
| `marker_pos` | int64 | `[batch, options]` |
| `marker_mask` | bool | `[batch, options]` |
| `qtype` | int64 | `[batch]` |

Outputs are `logits: float32[batch, options]` and `act_logits: float32[batch, 2]`. Both are raw logits. The graph does not apply answer calibration or turn action logits into probabilities. Invalid padded options have logit `-10000`. The marker axis needs at least two columns because the original action head takes the top two answer probabilities. The SDK supports singleton choices by padding a masked second column. Out-of-range marker positions and truncated option sets must be rejected before inference.

`laya.json` contains `format: "system-one-laya-onnx-v1"`, the immutable model/revision, `modelFile`, `externalData`, a relative `tokenizer` directory, `maxLength`, `headMaxLength`, `temperature`, `temperatureByOptions`, `tokenIds`, and `maskToken`. Every `externalData[].path` is the exact filename embedded in the ONNX graph; its `data` is a URL relative to the manifest. Serve the entire output directory together. ONNX Runtime Web needs those external file mappings explicitly; model bytes alone are insufficient.

Answer calibration selects `choice`, `score`, or `noul` and a cardinality bucket (`2`, `3-5`, `6-10`, `11+`), falling back to the per-type temperature. Apply softmax to valid answer logits divided by this temperature. `choice` uses the first maximum; `score` is the probability-weighted zero-based level. Both use confidence `1 - entropy(p) / log(optionCount)`. Boolean questions use upstream `noul` with fixed option order `[false, true]`, returning `p[1]`. The upstream Python API rounds answer values to four decimal places; SDK responses retaining that rounding need matching probability/score rounding metadata. Action probability is `softmax(act_logits)[0]` without answer temperature.

The generated `parity-report.json` records CPU runtime versions, shapes, and raw-output error; `parity-fixtures.json` includes exact token IDs, masks, raw reference logits, and upstream responses for independent browser testing. The default cases cover mixed question types, padded options, a one-row batch, 1/2/3/4/5/8/11 options, structured Unicode input, literal mask-token text, and instruction/option/state truncation. They check both raw tensors and the original API's typed answers. A standalone singleton request cannot run through the original API because its `topk(2)` fails; that case compares the original model using the SDK's masked padding and records `originalApiCompared: false`. A singleton mixed with other questions is also checked through the original API. These checks do not measure model quality.

Recheck an existing export without downloading anything:

```powershell
.research\laya-venv\Scripts\python.exe scripts/laya/verify.py --manifest .artifacts/laya/laya.json --offline
```

The default Hugging Face cache is `.research/laya-hf` inside this repository, including for the preflight. Pass `--cache-dir` consistently to override it. `--cases` accepts a JSON array of `{ "name": "case name", "request": { "state": ..., "questions": ... } }`; question names and criteria retain insertion order. SDK `boolean` is mapped to upstream `noul`. The reference deliberately preserves Python's JSON formatting, default boolean criteria, option rendering, and mask-token sanitization instead of reconstructing them from model-card examples.

For a small exporter diagnostic before loading the full checkpoint, run `python scripts/laya/preflight.py`. It downloads only the pinned architecture code/configuration and tests smaller, randomly initialized instances of the same ModernBERT and decision-model classes at several batch/sequence/option sizes. Its temporary graph is deleted, and it never creates `laya.json`. Passing this diagnostic does not establish trained-model correctness or browser support.
