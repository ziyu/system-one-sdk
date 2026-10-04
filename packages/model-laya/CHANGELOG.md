# @system-one-ai/model-laya

## 0.2.1

### Patch Changes

- Updated dependencies [2681b49]
  - @system-one-ai/core@0.7.0
  - @system-one-ai/adapter-webgpu@0.2.1
  - @system-one-ai/runtime-onnx-node@0.2.1

## 0.2.0

### Minor Changes

- 36fd83c: Move Laya-specific browser and Node integrations into opt-in `model-laya` subpath exports so generic runtimes no longer depend on or export a concrete model.

### Patch Changes

- Updated dependencies [36fd83c]
  - @system-one-ai/adapter-webgpu@0.2.0
  - @system-one-ai/runtime-onnx-node@0.2.0

## 0.1.0

- Added shared Laya manifest, rendering, calibration, and answer conversion used by browser and native runtimes.
