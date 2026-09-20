# @system-one-ai/adapter-webgpu

## 0.2.0

### Minor Changes

- 36fd83c: Move Laya-specific browser and Node integrations into opt-in `model-laya` subpath exports so generic runtimes no longer depend on or export a concrete model.

## 0.1.0

- Added the model-agnostic `createBrowserClient()` / `createBrowserRunner()` API and `BrowserModelDriver` extension point, with built-in GGUF/Wllama and Laya ONNX drivers.
- Added browser-local `auto | webgpu | wasm` device selection with WASM/CPU fallback while preserving the older model-named constructors for compatibility.
- Added real browser WebGPU GGUF inference through Wllama.
- Added complete Laya ONNX inference, resource disposal, cancellation serialization, and input-truncation reporting.
