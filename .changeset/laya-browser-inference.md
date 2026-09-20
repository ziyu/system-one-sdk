---
"@system-one-ai/adapter-webgpu": minor
---

Add Laya inference using a complete ONNX export of its trained encoder, decision head and action head. The WebGPU client preserves upstream tokenization, option ordering, temperature calibration and entropy confidence through the existing System One interface. Expose explicit resource disposal, serialize native inference across cancellation, and report truncated inputs. Include reproducible model export and numerical parity verification tools in the repository.
