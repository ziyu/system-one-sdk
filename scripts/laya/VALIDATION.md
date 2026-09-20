# Laya export validation — September 20, 2026

The complete trained checkpoint `convaiinnovations/laya` at revision `1c5edc17a7acd8701df6fc341c0d179f1c62c982` was exported and compared against its original Python implementation on Windows with Python 3.12.14. The command completed with exit code 0:

```powershell
.research\laya-venv\Scripts\python.exe scripts/laya/export.py --output .artifacts/laya --cache-dir .research/laya-hf --offline
```

The source snapshot had already been downloaded from that immutable revision. Inference used the full encoder, both decision-head layers, and the action head with strictly matched trained parameters in FP32. The original `rl_common.py` supplied preprocessing and the model implementation; `rl_agent_api.py` supplied the typed-answer reference. No random model or substitute classifier was used for this result.

The runtime versions recorded in `parity-report.json` are PyTorch 2.8.0, Transformers 5.0.0, ONNX 1.19.1, ONNX Script 0.5.6, ONNX IR 0.1.12, and ONNX Runtime 1.23.2 with `CPUExecutionProvider`. Transformers matches the saved encoder configuration. A source- and data-hash-checked, read-only FP32 cache at `.research/laya-fp32` avoided Windows copy-on-write commit pressure. `--weight-cache-dir` can relocate that cache; `--threads` defaults to four.

## Trained-model numerical results

Raw output comparisons used `abs(actual - reference) <= 0.0005 + 0.0001 * abs(reference)`, checked shapes and FP32/finite outputs, and checked that padded option logits remain exactly `-10000`. Decoded responses were compared with the original API, including first-maximum choice, calibrated probabilities, entropy confidence, score expectation, action probability, and token usage. Answer-value tolerance was `0.0002`, including the API's four-decimal rounding.

| Case | Batch / sequence / padded options | Max answer-logit absolute error | Max action-logit absolute error |
| --- | --- | --- | --- |
| Mixed choice, score, boolean, and singleton | 4 / 50 / 4 | 0.000009536743 | 0.012451171875 |
| One boolean question | 1 / 32 / 2 | 0.000001430511 | 0 |
| Singleton with a masked second column | 1 / 19 / 2 | 0.000001966953 | 0.001464843750 |
| Structured Unicode state/instructions and literal mask text | 1 / 138 / 11 | 0.000008106232 | 0.004150390625 |
| State truncated to the context budget | 1 / 512 / 5 | 0.000007390976 | 0.003417968750 |
| Instruction and option-text truncation | 1 / 202 / 8 | 0.000008106232 | 0.004394531250 |

All six cases passed. The mixed batch covers valid option counts 4, 3, 2, and 1 with padding. A standalone singleton cannot run through the original API because its action head calls `topk(2)`; that case verifies the original model with the SDK's masked second column and is explicitly marked `originalApiCompared: false`. The other five cases call the original API directly, including the singleton within a mixed batch.

The action-head absolute error needs its scale stated: original action logits across the nine questions range approximately from `-3939` to `+4807`. The largest recorded action error belongs to the mixed batch; this report did not retain which row attained it. Large action logits also occur without padding: the standalone two-option boolean has `[4807.3330078125, -3939.2431640625]`. They therefore cannot be attributed solely to singleton padding. Original action probabilities are saturated at `1.0` for all these examples. This check establishes numerical agreement; it does not establish action calibration or task quality.

## Produced artifacts

The export generated `.artifacts/laya/model.onnx` (14,212,919 bytes) and `model.onnx.data` (1,685,258,240 bytes), plus the original tokenizer, preserved upstream model card, and provenance information. ONNX model checking passed. `parity-fixtures.json` (84,254 bytes) retains exact input tensors, reference logits, requests, and reference answers; `parity-report.json` (3,834 bytes) records the measured CPU results. The 841-byte `laya.json` manifest was written only after all comparisons passed.

These generated files are local verification artifacts under the repository's ignored `.artifacts` directory. Serve the model, external data, and tokenizer together. The external-data path in the manifest is exactly `model.onnx.data`.

## Other checks and limits

Python syntax compilation and exporter/verifier command-line parsing passed. The separate small, randomly initialized architecture diagnostic also passed four batch/sequence/option combinations, including batch one and sequence length 512, with raw error below `0.0000004`. It was used to diagnose exporter compatibility and is distinct from the trained-model results above.

No browser or WebGPU result is asserted by this document or by the CPU parity report (`browserVerified: false`). The browser harness must independently load the emitted graph with the real WebGPU provider and compare the saved tensors and answers. Browser operator support, GPU memory limits, device loss, WASM fallback behavior, latency, task accuracy, and non-English quality are not established by CPU export parity. The original model card is preserved as source information; its performance claims are not treated as browser measurements.
