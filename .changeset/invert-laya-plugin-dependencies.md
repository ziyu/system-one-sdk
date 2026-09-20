---
'@system-one-ai/adapter-webgpu': minor
'@system-one-ai/runtime-onnx-node': minor
'@system-one-ai/model-laya': minor
---

Move Laya-specific browser and Node integrations into opt-in `model-laya` subpath exports so generic runtimes no longer depend on or export a concrete model.
