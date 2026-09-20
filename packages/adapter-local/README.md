# @system-one-ai/adapter-local

统一本地权重运行时的 System One adapter。它不绑定 PyTorch、MLX、CUDA 或某个模型格式；应用为每个模型实现一个很薄的 `LocalModelRunner`，SDK 负责统一请求、超时、取消、答案校验和组合能力。

```ts
import { booleanQuestion } from '@system-one-ai/core';
import { createLocalClient, type LocalModelRunner } from '@system-one-ai/adapter-local';

const runner: LocalModelRunner = {
  id: 'kev-0.5b',
  defaultModel: 'kev-latest',
  async evaluate(request) {
    // 在这里调用已经加载好的 Python / MLX / CUDA / WASM 权重。
    return {
      model: request.model,
      answers: { on: { type: 'boolean', probability: 0.9 } },
      usage: {},
    };
  },
};

const client = createLocalClient(runner);
const result = await client.evaluate({
  state: 'The light is on.',
  questions: { on: booleanQuestion('Is the light on?') },
});
```

Kev、Laya、Nimble 等 Python、MLX、CUDA 或 sidecar 权重可以通过这个 runner 接入；它们不需要各自复制一套 TypeScript adapter。浏览器里的 OpenJev/SemIf GGUF 权重有现成的 `@system-one-ai/adapter-webgpu` 实现。runner 必须返回 core 的 `ProviderResponse` 形状，core 会继续校验选项、概率、score 和模型 ID。

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/adapter-local`.
