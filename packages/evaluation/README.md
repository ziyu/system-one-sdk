# @system-one-ai/evaluation

Evaluate any System One `EvaluationClient` with the same metrics, regardless of whether it is backed by Laya, OpenJev/GGUF, ONNX, a hosted System One model, or a prompted LLM.

```ts
import { runEvaluation, summarizeEvaluation, backgroundVariant } from '@system-one-ai/evaluation';

const rows = await runEvaluation(client, cases, {
  variants: [
    { id: 'base' },
    backgroundVariant('long-context', backgroundText),
  ],
});

console.log(summarizeEvaluation(rows));
```

Cases identify one scored question inside a normal System One request and provide its gold answer. Reports include effective/valid accuracy, Wilson 95% intervals, macro F1, Brier score, NLL, ECE, score MAE, p50/p95 latency, failures, retries, throughput, and reported-token means.

Calibration uses the top-class probability for ECE. System One `confidence` is intentionally not treated as a calibrated class probability.

For calibration and class metrics, summarize one task/label space at a time; Brier magnitude and macro F1 are not directly comparable across unrelated tasks. `pairedContextEffect()` compares the same cases between a base and stressed context variant.

The evaluation design is informed by the MIT-licensed [githubnext/localjev](https://github.com/githubnext/localjev) benchmark harness, adapted to the provider-agnostic `EvaluationClient` contract rather than a LocalJev server/runtime.
