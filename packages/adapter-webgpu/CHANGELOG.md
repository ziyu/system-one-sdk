# @system-one-ai/adapter-webgpu

## Unreleased

- Added the model-agnostic `createBrowserClient()` / `createBrowserRunner()` API and `BrowserModelDriver` extension point, with built-in GGUF/Wllama and Laya ONNX drivers.
- Added browser-local `auto | webgpu | wasm` device selection with WASM/CPU fallback while preserving the older model-named constructors for compatibility.

## 0.6.0

- Added real browser WebGPU GGUF inference through Wllama.
