# Laya browser-local demo

Export the complete trained Laya checkpoint first, following [the export instructions](../../scripts/laya/README.md), with the output at `.artifacts/laya`. Then run `npm run demo:webgpu` from the repository root and open `http://localhost:4173/examples/laya-webgpu-demo/`.

The page uses the generic `createBrowserClient()` API with the built-in Laya driver. It prefers WebGPU and can fall back to WASM/CPU, accepts a manifest URL, shows actual loading stages, evaluates all three question types, displays truncation warnings, and releases the model on request. There is no model API or generated placeholder response. First inference may include runtime compilation; the displayed duration measures the entire `evaluate()` call.

The default export is the root English Laya checkpoint. Serve its `laya.json`, ONNX graph, external weights and tokenizer directory together. Model download size and runtime memory depend on export precision. The initial exporter preserves FP32 weights; it does not claim Q4/FP16 quality or mobile suitability.

The device selector supports automatic selection, required WebGPU, and forced WASM/CPU. For measured trained-model browser results and their limits, see [the validation record](../../docs/laya-webgpu-validation.md).
