# WebGPU local inference demo

This page exercises the real `@system-one-ai/adapter-webgpu` path against the pinned OpenJev/SemIf GGUF checkpoints. It is intentionally a static page: the import map points at the workspace build output, so no framework or demo backend is needed.

From the repository root:

```sh
npm run demo:webgpu
```

Then open `http://localhost:4173/examples/webgpu-demo/` in a WebGPU-capable browser. The first load downloads the selected checkpoint from Hugging Face and caches it in the browser; inference stays in the tab.
