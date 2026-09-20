# @system-one-ai/runtime-onnx-node

## 0.2.0

### Minor Changes

- 36fd83c: Move Laya-specific browser and Node integrations into opt-in `model-laya` subpath exports so generic runtimes no longer depend on or export a concrete model.

## 0.1.0

- Added in-process ONNX Runtime Node drivers with a generic model plugin contract and built-in support for exported Laya ONNX models.
