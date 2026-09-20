# Laya Node ONNX validation

Recorded on 2026-09-20 against the complete exported `convaiinnovations/laya` checkpoint at revision `1c5edc17a7acd8701df6fc341c0d179f1c62c982`.

Environment:

- Windows x64
- Node.js v25.5.0
- `onnxruntime-node` 1.30.0
- `@huggingface/transformers` 3.8.1
- CPU execution provider
- exported graph: `model.onnx` plus the 1,685,258,240-byte `model.onnx.data` external weight file

Command:

```sh
npm run test:live:laya:node
```

The check loads the model in the Node.js process through `createNativeClient()` + `createOnnxDriver()`. There is no Python interpreter, child model process, localhost server, or model API.

The recorded run passed `mixed-types-padded-options`, evaluating four typed questions in one request. The resulting choice, score, boolean probability, per-option probabilities, and confidence values matched the upstream response after the upstream API's four-decimal presentation rounding. The SDK retained unrounded values internally and reported 170 input tokens.

ONNX external data is left on disk. The Node binding resolves the external weight filename from the ONNX graph relative to `model.onnx`; the SDK does not read the 1.68 GB weight file into a JavaScript buffer.
