---
"@system-one-ai/adapter-webgpu": minor
---

Add a model-agnostic browser inference API built around `createBrowserClient`, `createBrowserRunner`, and extensible `BrowserModelDriver` implementations. Built-in GGUF/Wllama and Laya ONNX drivers support automatic WebGPU selection with WASM/CPU fallback, while older model-named constructors remain compatible.
