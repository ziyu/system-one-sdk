# @system-one-ai/model-laya

Shared model semantics for Laya checkpoints. This package contains no inference runtime. It validates the exported `laya.json` manifest, renders System One questions exactly as the pinned Laya model expects, prepares token rows, and converts raw logits into typed System One answers.

Browser and native ONNX runtimes both consume this package so tokenization, truncation, temperature calibration, confidence, and boolean ordering stay identical.

Most applications should install a runtime package instead of using this package directly.
