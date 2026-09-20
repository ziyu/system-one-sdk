# System One

[English](README.md) | **简体中文**

面向决策模型的 TypeScript 库：`evaluate({ state, questions })` 从共享状态返回选择项、评分和真假概率。应用显式选择 adapter 和 transport。

仓库根目录是私有 npm workspace，运行时代码均位于独立包中。旧 `@system-one-ai/sdk` 入口及转导出子路径已删除。LLM 保持一个可选 adapter 包。

## 各包的功能

| 包（`@system-one-ai/…`） | 功能 | 运行时依赖 |
| --- | --- | --- |
| `core` | 创建统一的 `evaluate` 客户端，定义选择、评分和真假问题，并校验模型返回的答案。 | 无 |
| `transport-fetch` | 通过 Fetch 发送模型请求，处理鉴权、超时、取消、重试和响应大小限制。 | core |
| `protocol-system-one` | 在本库的问题／答案格式与原生 System One 协议之间转换，供 TypeSafe、OpenRouter 和 Cloudflare adapter 复用。 | core |
| `adapter-system-one` | 连接 TypeSafe 官方 System One 服务，用原生决策模型回答选择、评分和真假问题。 | core、protocol-system-one |
| `adapter-openrouter` | 通过 OpenRouter Decisions 接口调用 System One 模型，将答案、用量和费用信息转换为本库结果。 | core、protocol-system-one |
| `adapter-cloudflare` | 在 Cloudflare 上调用 System One 模型，支持 REST API 和 Workers 内的 `env.AI` binding。 | core、protocol-system-one、transport-fetch |
| `adapter-vercel` | 通过 Vercel AI Gateway 的 Evaluation 接口调用决策模型，将请求和答案转换为本库格式。 | core |
| `adapter-llm` | 把通用 LLM 接口适配为 System One 决策接口：将问题转为 prompt 和输出约束，再把 LLM 回答转换为选择、评分和真假结果。 | core |
| `adapter-local` | 将 Python、MLX、CUDA、WASM 或 sidecar 本地模型统一接入，并执行结果校验。 | core |
| `adapter-webgpu` | 在浏览器本地运行 GGUF/OpenJev 与导出的 Laya ONNX 模型，有 WebGPU 时使用 GPU，否则回退到 WASM/CPU。 | adapter-local、core |
| `runtime-onnx-node` | 在 Node.js 进程内运行 ONNX 模型，通过统一本地 driver 接入；CPU 是可靠默认，macOS 可显式使用 CoreML。 | adapter-local、core、model-laya；peer：onnxruntime-node（Laya 另需 Transformers.js） |
| `model-laya` | 在浏览器与原生 runtime 之间共享 Laya manifest 校验、问题渲染、截断和答案校准逻辑。 | core |
| `evaluation` | 对任意 `EvaluationClient` 运行统一的质量、校准、延迟和长上下文压力评测。 | core |
| `decisions` | 让模型从业务对象中选出目标、选择动作及其参数，并将答案映射回原始对象，供应用执行。 | core |
| `policies` | 按概率、选项差值或 confidence 阈值判断是否接受模型答案，明确返回接受、不确定或弃权。 | core |
| `batch` | 以指定并发数执行多次 `evaluate`，按输入顺序返回每项结果，保留失败和取消信息。 | core |

core 不导入具体 adapter 或 transport。各包提供 ESM、CommonJS 和 TypeScript 声明。大多数 runtime 保持轻依赖；`runtime-onnx-node` 将原生 ONNX runtime 和可选 tokenizer 作为 peer dependency，因此不使用原生推理的应用不会下载平台二进制。支持目标为 Node.js 20+，Cloudflare 原生 binding 另有 workerd 运行时验证。模型密钥应保留在服务端。

`adapter-local` 是自部署权重的统一边界。runner 负责 Python、MLX、CUDA、WASM 或本地 sidecar 的模型运行时，并返回 core 的 `ProviderResponse`；SDK 负责请求快照、期限、取消和结果校验。

Node.js 进程内推理使用 `createNativeClient()` 加载 `NativeModelDriver`，SDK 不启动额外进程。`runtime-onnx-node` 提供模型无关的 ONNX driver，具体模型族以 `OnnxModelPlugin` 接入；内置的 Laya plugin 直接读取浏览器 runtime 使用的同一份 ONNX 导出。

```sh
npm install @system-one-ai/core @system-one-ai/adapter-local @system-one-ai/runtime-onnx-node onnxruntime-node @huggingface/transformers
```

```ts
import { createNativeClient } from '@system-one-ai/adapter-local';
import { createOnnxDriver, createLayaOnnxModel } from '@system-one-ai/runtime-onnx-node';

const client = await createNativeClient({
  driver: createOnnxDriver({
    model: createLayaOnnxModel({ manifestPath: './models/laya/laya.json' }),
  }),
});
```

需要真实浏览器推理时使用 `adapter-webgpu`：它通过 Wllama 加载 OpenJev/SemIf GGUF，也可以通过 ONNX Runtime Web 加载导出的 Laya ONNX。通用浏览器入口优先使用 WebGPU，不可用时自动回退到 WASM/CPU；模型推理留在浏览器内，不调用模型 API。

```sh
npm install @system-one-ai/core @system-one-ai/adapter-webgpu
```

```ts
import { choice } from '@system-one-ai/core';
import { createBrowserClient, createGGUFDriver } from '@system-one-ai/adapter-webgpu';

const client = await createBrowserClient({
  driver: createGGUFDriver({ model: 'qwen3-0.6b' }),
});
const result = await client.evaluate({
  state: '客户重置密码后仍然无法登录。',
  questions: { queue: choice('应该进入哪个队列？', { access: '账户访问', billing: '账单' }) },
});
```

`createBrowserClient()` 是稳定的浏览器本地推理入口，具体模型支持由 `BrowserModelDriver` 提供；当前内置 GGUF/Wllama 和 Laya ONNX 两个 driver。以后增加新的模型族只需要增加 driver，不需要再增加一套 `createXxxClient()`。设置 `device: 'wasm'` 可强制 CPU，`device: 'webgpu'` 可强制 WebGPU；旧的模型命名构造器仅作为兼容别名保留。

导出的 Laya 图使用 `createBrowserClient({ driver: createLayaDriver({ manifestUrl }) })`，同样支持 `auto | webgpu | wasm`。

[Laya 导出工具](scripts/laya/README.md)会将训练后的完整编码器、决策头和动作头转换为 ONNX，并与原版 Python 模型做数值对照。将产物导出到 `.artifacts/laya`，运行 `npm run demo:webgpu` 后打开 `http://localhost:4173/examples/laya-webgpu-demo/`，即可验证三类问题。当前导出目标是固定版本的英文根 checkpoint，使用 FP32；详见 [Laya 运行接口和限制](packages/adapter-webgpu/README.md#laya-model-preparation-and-evaluation)。`npm run test:live:laya` 使用真实权重进行浏览器数值对照。

Node.js 使用 `npm run test:live:laya:node` 通过 `onnxruntime-node` 加载同一份导出，并将完整 typed-decision fixture 与已记录的上游响应比较。详见 [Node ONNX 验证记录](docs/laya-node-validation.md)。

[桌面 WebGPU 验证记录](docs/laya-webgpu-validation.md)包含 6 组完整权重对照、实际 GPU 计算提交次数和耗时。在本次 Intel 核显测试中，32-token 单题预热后需要 780–944 ms；记录同时列出了模型加载成本和运行时限制。

## 安装与调用

**稳定版 `0.6.0` 已发布到 npm。** 按需安装应用使用的包，npm 自动解析其依赖。详见 [SDK 0.5.3 迁移说明](docs/migration-0.6.md)和[发布包验证记录](docs/validation.md)。

```sh
npm install @system-one-ai/core @system-one-ai/transport-fetch @system-one-ai/adapter-system-one
```

```ts
import { createSystemOne, choice, score, booleanQuestion } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { systemOneAdapter } from '@system-one-ai/adapter-system-one';

const client = createSystemOne({
  adapter: systemOneAdapter,
  transport: createFetchTransport(),
  apiKey: process.env.SYSTEM_ONE_API_KEY!,
});

const result = await client.evaluate({
  state: { message: '请给我一杯水。' },
  questions: {
    action: choice('下一步做什么？', { drink: '拿水', rest: '休息' }),
    urgency: score('请求有多紧急？', ['低', '中', '高']),
    interrupt: booleanQuestion('用户是否请求采取行动？'),
  },
});

const action: 'drink' | 'rest' = result.answers.action.choice;
console.log(action, result.answers.urgency.score, result.answers.interrupt.probability);
```

原生 adapter 提供默认地址和模型，`baseURL`、`model` 可覆盖；单次请求的 `model` 优先级最高。Cloudflare 通过 `cloudflareAdapter({ accountId })` 配置账户。自定义 fetch 传给 `createFetchTransport(fetch)`。客户端不会根据 hostname 猜测协议，也不读取环境变量。

## 用通用 LLM 提供 System One 决策能力

`adapter-llm` 把 OpenAI、Anthropic 及兼容服务的通用 LLM 接口适配为 System One 的 `evaluate({ state, questions })` 接口。它将状态和问题转换为 prompt 与 JSON 输出约束，再把 LLM 的回答转换为本库的选择、评分和真假结果。应用因此可以用通用 LLM 完成 System One 决策，并继续复用 `decisions`、`policies` 和 `batch`。

调用过程：System One 状态与问题 → LLM prompt／输出约束 → LLM 回答 → System One 结果。

安装 `adapter-llm`、core 和 transport-fetch：

```sh
npm install @system-one-ai/core @system-one-ai/transport-fetch @system-one-ai/adapter-llm
```

```ts
import { createSystemOne, choice } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { llmAdapter } from '@system-one-ai/adapter-llm';

const client = createSystemOne({
  adapter: llmAdapter({ provider: 'openai', llmAnswerMode: 'probabilities' }),
  transport: createFetchTransport(),
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
});

const result = await client.evaluate({
  state: '同一笔订单被扣款两次，请退回重复扣除的钱。',
  questions: {
    department: choice('哪个团队应处理这条消息？', {
      billing: '付款与退款', technical: '软件故障',
    }),
  },
});
const department: 'billing' | 'technical' = result.answers.department.choice;
console.log(department);
```

支持 OpenAI Responses、OpenAI-compatible Chat Completions 和 Anthropic Messages。OpenAI 在 `api.openai.com` 默认使用 Responses，自定义地址默认使用 Chat Completions；也可通过 `api` 显式选择。服务不支持原生 JSON schema 时设置 `structuredOutputs: false`。

`llmAnswerMode: 'probabilities'` 让 LLM 给出概率数值；这些是 LLM 生成的估计值，不保证经过概率校准。`discrete` 让 LLM 直接选出答案，再用 0/1 编码成统一结果；由此得到的分布和 confidence 表示确定的选项编码，不代表模型实测置信度。概率归一化需显式启用 `normalizeProbabilities`。

adapter 给模型暴露的是内部 `q1`、`q2`……，不会把应用传入的问题 key 放进输出 schema。对本地或 OpenAI-compatible LLM，可用 `createLlmEvaluationClient(client, { questionsPerCall, outcomesPerCall, malformedRetries })` 将问题分组，并仅对无效的决策输出做纠正重试；调用方的总 timeout/cancellation 仍覆盖所有分组和纠正尝试。

## 统一评测 System One 模型

`@system-one-ai/evaluation` 可以对任意 `EvaluationClient` 使用同一套质量、校准、延迟和上下文压力测试，无论后端是托管 System One、Laya ONNX、浏览器 GGUF 还是普通 LLM。

```ts
import { runEvaluation, summarizeEvaluation, backgroundVariant } from '@system-one-ai/evaluation';

const rows = await runEvaluation(client, cases, {
  variants: [{ id: 'base' }, backgroundVariant('long-context', backgroundText)],
});
const summary = summarizeEvaluation(rows.filter(row => row.variant === 'base'));
```

指标包括 effective/valid accuracy、Wilson 95% 区间、macro F1、Brier、NLL、ECE、score MAE、P50/P95 延迟、失败数、attempts 和 token 均值。ECE 使用预测类别概率，不把模型/provider 的 `confidence` 当成校准概率。校准/F1 应按同一 task/label space 分组比较；`pairedContextEffect()` 用于比较增加背景上下文前后的预测变化。

## 组合能力

按需安装组合包：

```ts
import { choiceFrom, defineDecision } from '@system-one-ai/decisions';
import { gateChoice, gateBoolean } from '@system-one-ai/policies';
import { evaluateMany } from '@system-one-ai/batch';
```

它们只依赖结构化 `EvaluationClient` 契约，不选择供应商。候选项保留原业务对象，动作参数保留分支类型和概率证据；策略返回接受、不确定或弃权；批处理保留输入顺序和部分失败。完整语义见[组合契约](docs/composition.zh-CN.md)。

## 调用控制与校验

| 选项 | 默认值 | 含义 |
| --- | --- | --- |
| `timeoutMs` | 10,000 | 包括重试和解码的整次调用期限 |
| `maxRetries` | 2 | 额外重试次数，范围 0–100 |
| `retryDelayMs` | 200 | 带抖动的指数退避初始间隔 |
| `maxRetryDelayMs` | 2,000 | 退避上限，不缩短服务端 Retry-After |
| `maxResponseBytes` | 8 MiB | 成功响应体大小上限 |
| `headers` | 无 | 应用请求头；鉴权和协议头保留给库管理 |

`evaluate` 的第二参数支持 `signal`、`timeoutMs`、`maxRetries`、`headers`。`apiKey` 支持 token 或同步/异步解析函数，未鉴权端点需要显式传入 `null`。

Fetch transport 重试网络错误、HTTP 408、429 和 5xx。输入错误、无效答案和 HTTP 401/403/422 不重试。错误均继承 `SystemOneError`：`ConfigurationError`、`ValidationError`、`UnsupportedFeatureError`、`ResponseValidationError`、`APIError`、`ConnectionError`、`TimeoutError`、`RequestAbortedError`。错误不包含密钥或上游错误正文。重定向和 adapter 跨源请求会被拒绝。

core 校验答案类型、选择项、概率、分布、评分范围和加权均值，按声明的舍入精度容差处理原生结果，不修改上游数值。缺失的分布、confidence 和 token 数保持缺省。confidence 与选中项概率不同；业务阈值需用自身数据验证。库不执行动作、不生成聊天回复、不隐式调用备用规划模型。

## 开发与验证

```sh
npm ci --ignore-scripts
npm run check                         # 类型、构建、回归和工作流测试
npm run test:package                  # 隔离 tarball 安装、ESM/CJS、类型推导
npm run test:browser                  # 本地浏览器示例检查
npm test --workspace @system-one-ai/adapter-llm
npm run test:live -- /path/to/system-one.env
npm run test:live:composition -- /path/to/system-one.env
npm run test:live:llm -- /path/to/llm.env
```

LLM 文件包含 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`。真实测试按需运行，会消耗接口用量，脱敏报告写入 `.artifacts/`。CI 不读取本地密钥。其他供应商测试命令为 `test:live`、`test:live:openrouter`、`test:live:cloudflare`。

原生及组合测试从指定文件读取 `SYSTEM_ONE_API_KEY`、`SYSTEM_ONE_BASE_URL`、`SYSTEM_ONE_MODEL`；未传路径时读取本仓库 `.env`。配置以文件为准，不受 shell 环境变量覆盖。

当前与历史证据见[验证记录](docs/validation.md)。真实 LLM 测试不代表其他供应商也已完成真实联调；各供应商协议另有 fixture 和本地 HTTP 回归。

- [包边界](docs/architecture-plan.zh-CN.md)与[设计](docs/design.md)
- [OpenRouter](docs/openrouter.md)、[Cloudflare](docs/cloudflare.zh-CN.md)、[Jev API 研究](docs/jev-api.md)
- [文件/客服工作流](docs/decision-workflows.zh-CN.md)与[浏览器示例](docs/browser-decisions.zh-CN.md)
- [Cloudflare Workers 原生 binding](docs/cloudflare-workers.zh-CN.md)（`@system-one-ai/adapter-cloudflare/workers`）
- [自定义 adapter 示例](examples/custom-adapter.ts)
- [版本与发布](docs/releasing.md)：Changesets Release PR、固定产物与整批验证；根目录禁止发布
- [从 SDK 0.5.3 迁移](docs/migration-0.6.md)：包、入口与配置映射

[MIT 许可证](LICENSE)。
