# Laya WebGPU validation

Recorded on 2026-09-20 for `convaiinnovations/laya` at immutable revision `1c5edc17a7acd8701df6fc341c0d179f1c62c982`. These are local engineering checks, not model-quality or cross-device benchmarks.

## Model and runtime

The export includes the original trained ModernBERT encoder, decision head and action head. The root English checkpoint is loaded strictly, with its original tokenizer, context budget and temperature calibration. The graph uses FP32, opset 18 and dynamic batch, sequence and option dimensions.

The actual artifacts contain a 14,212,919-byte ONNX graph and 1,685,258,240 bytes of external weights, plus tokenizer files and provenance. The external weights alone are approximately 1.57 GiB. Download size is not a measurement of peak browser memory. Model files, caches and machine-generated reports stay in ignored `.artifacts` and `.research` directories.

The browser run used Windows, headless Microsoft Edge 153, and an adapter reporting vendor `intel`, architecture `gen-12lp`. The harness imported ONNX Runtime Web 1.30.0 and Transformers.js 3.8.1. It explicitly requested the `webgpu` execution provider and observed real compute dispatches. ONNX Runtime reported that some nodes were assigned to CPU, including its usual shape-operation placement; this is not an assertion that every operator executes on GPU.

## Numerical checks

`scripts/laya/export.py` passed six complete-checkpoint comparisons against the original Python code before writing `laya.json`. CPU verification used PyTorch 2.8.0, Transformers 5.0.0 and ONNX Runtime 1.23.2. The decision-logit maximum absolute difference was `9.5367431640625e-6`.

`scripts/test-laya-webgpu.mjs` then checked exact browser token IDs, attention masks, option positions, option masks and question types against those Python fixtures. It compared both raw output heads and the final SDK choice, score and boolean answers. All six cases and two repeated evaluations passed.

The browser decision-logit maximum absolute difference was `0.0004019737243652344`. Raw comparisons used `atol=0.0005, rtol=0.0001`; final answer comparisons allowed `0.0002`, including the original API's four-decimal rounding. The SDK returns unrounded values.

Action logits have a different scale: the original fixtures contain values around -3,939 to +4,807. Their maximum browser absolute difference was `0.053955078125`, within the declared relative tolerance. The original action probability was 1.0 for every fixture, including non-singleton questions. Agreement here does not establish useful action calibration; action probability is exposed separately in metadata and is not substituted for answer confidence.

## Observed durations

The final run took 18.91 seconds to initialize the model, measured separately from evaluation. Evaluation durations include tokenization, runtime work, validation and instrumentation. The first occurrence of a tensor shape may include shader compilation. A different browser session had slower first-shape durations, so these numbers are descriptive samples rather than performance guarantees.

| Case | Batch / sequence / padded options | Evaluation | GPU dispatches |
| --- | --- | ---: | ---: |
| Mixed choice, score, boolean and singleton | 4 / 50 / 4 | 5,773.5 ms | 1,395 |
| Single boolean question | 1 / 32 / 2 | 1,422.4 ms | 1,396 |
| Singleton choice extension | 1 / 19 / 2 | 955.5 ms | 1,426 |
| Structured Unicode and literal mask text | 1 / 138 / 11 | 3,915.1 ms | 1,396 |
| State truncated to context budget | 1 / 512 / 5 | 8,084.0 ms | 1,396 |
| Instruction and option truncation | 1 / 202 / 8 | 2,942.2 ms | 1,396 |
| Single boolean, warm repeat 1 | 1 / 32 / 2 | 943.8 ms | 1,396 |
| Single boolean, warm repeat 2 | 1 / 32 / 2 | 780.0 ms | 1,396 |

The standalone singleton is an explicit SDK extension: a masked second option permits the original action head's `topk(2)` operation. Its reference uses the original model with that padding; the original unmodified single-question API cannot execute this case. A singleton in a mixed batch is also checked through the original API.

## Reliability and scope

An initial browser attempt raised an ONNX Runtime `TypeError` while destroying a GPU resource. Two subsequent complete browser runs passed, including session disposal; the exact first-attempt cause was not reproduced. The harness now preserves an inference failure even when cleanup also fails, records GPU buffer-allocation errors and device-loss events, and requires GPU dispatches for each evaluation. The final run recorded no unexpected browser or GPU errors. Runtime warnings about CPU node placement were retained separately.

An additional uninstrumented UI check used the demo's default model/tokenizer loaders and clicked its load, evaluate and release buttons with WebGPU required. All four mixed-case answers matched the original fixture. Initialization took 20.52 seconds; evaluation took 6,013.7 ms for 170 input tokens. Resource release and button states passed, with no unexpected browser errors. This check does not replace the instrumented raw-tensor comparison above.

The full repository checks passed 258 unit tests and 13 scenario tests; all 13 packages passed isolated ESM/CJS and declaration checks. The three small weight-loader tests verified precision, strict assignment without a full-model copy, cache integrity and invalid offsets. SDK tests cover cancellation during loading and inference, deadlines for queued requests, serialization of native runs, tensor cleanup, idempotent disposal, malformed outputs, model mismatches and input truncation. A cancelled call stops waiting immediately, while already submitted native inference finishes before its tensors or session are released.

This validation covers one desktop GPU/browser combination, FP32, and the pinned English root checkpoint. It does not establish mobile suitability, multilingual accuracy, quantized/FP16 quality, or a millisecond-level production latency target.

## Reproduce

Prepare the model using [the export instructions](../scripts/laya/README.md), then run:

```sh
npm run test:live:laya
```

The default model is `.artifacts/laya/laya.json`. The output report is `.artifacts/laya-webgpu-report.json`; original CPU results and exact fixtures are inside `.artifacts/laya/`. Use `node scripts/test-laya-webgpu.mjs --probe` to check browser availability and the demo's 375px layout without loading model weights. Use `node scripts/test-laya-webgpu.mjs --ui` for the uninstrumented button flow, recorded separately in `.artifacts/laya-ui-report.json`. Each run closes its own browser and local HTTP server.
