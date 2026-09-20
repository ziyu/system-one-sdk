# @system-one-ai/adapter-webgpu

## 0.7.0

### Minor Changes

- 013fdc0: Add a model-agnostic browser inference API built around `createBrowserClient`, `createBrowserRunner`, and extensible `BrowserModelDriver` implementations. Built-in GGUF/Wllama and Laya ONNX drivers support automatic WebGPU selection with WASM/CPU fallback, while older model-named constructors remain compatible.
- 013fdc0: Add Laya inference using a complete ONNX export of its trained encoder, decision head and action head. The WebGPU client preserves upstream tokenization, option ordering, temperature calibration and entropy confidence through the existing System One interface. Expose explicit resource disposal, serialize native inference across cancellation, and report truncated inputs. Include reproducible model export and numerical parity verification tools in the repository.

### Patch Changes

- 013fdc0: Add model-agnostic native driver lifecycle support and an in-process ONNX Runtime Node package. Share Laya rendering and calibration across browser and Node runtimes, and run exported Laya ONNX checkpoints without Python or a sidecar.
- Updated dependencies [013fdc0]
  - @system-one-ai/adapter-local@0.7.0
  - @system-one-ai/model-laya@0.7.0

## Unreleased

- Added the model-agnostic `createBrowserClient()` / `createBrowserRunner()` API and `BrowserModelDriver` extension point, with built-in GGUF/Wllama and Laya ONNX drivers.
- Added browser-local `auto | webgpu | wasm` device selection with WASM/CPU fallback while preserving the older model-named constructors for compatibility.

## 0.6.0

- Added real browser WebGPU GGUF inference through Wllama.
