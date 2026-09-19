# System One

[English](README.md) | **简体中文**

面向决策模型的 TypeScript 库：`evaluate({ state, questions })` 从共享状态返回选择项、评分和真假概率。应用显式选择 adapter 和 transport。

仓库根目录是私有 npm workspace，运行时代码均位于独立包中。旧 `@system-one-ai/sdk` 入口及转导出子路径已删除。LLM 保持一个可选 adapter 包。

## 包职责

| 包（`@system-one-ai/…`） | 职责 | 运行时依赖 |
| --- | --- | --- |
| `core` | 问题、类型、客户端、快照、结果校验和错误 | 无 |
| `transport-fetch` | Fetch、鉴权、期限、取消、重试和响应大小限制 | core |
| `protocol-system-one` | 共用原生 boolean/noul 与响应编解码 | core |
| `adapter-system-one` | TypeSafe 原生协议 | core、protocol-system-one |
| `adapter-openrouter` | OpenRouter Decisions | core、protocol-system-one |
| `adapter-cloudflare` | Cloudflare REST 与 Workers 原生 binding | core、protocol-system-one、transport-fetch |
| `adapter-vercel` | Vercel Evaluation v4 | core |
| `adapter-llm` | OpenAI Responses/Chat Completions、Anthropic Messages | core |
| `decisions` | 动态候选和类型化动作参数 | core |
| `policies` | 概率、差值和 confidence 策略 | core |
| `batch` | 有界并发、顺序结果和部分失败 | core |

core 不导入具体 adapter 或 transport。各包提供 ESM、CommonJS 和 TypeScript 声明。运行时使用 Web API，无第三方依赖；支持目标为 Node.js 20+，Cloudflare 原生 binding 另有 workerd 运行时验证。模型密钥应保留在服务端。

## 安装与调用

**`0.6.0-rc.0` 已通过 npm 的 `next` 标签发布。** 按需安装应用使用的包，npm 自动解析其依赖。这是预发布版本，详见[迁移说明](docs/migration-0.6.md)和[发布包验证记录](docs/validation.md)。

npm 为这批首次发布的包同时创建了 `latest`，目前拒绝删除。因此不指定标签安装也会得到该 RC；稳定版 `0.6.0` 尚未发布。

```sh
npm install @system-one-ai/core@next @system-one-ai/transport-fetch@next @system-one-ai/adapter-system-one@next
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

## LLM adapter

安装 `adapter-llm`、core 和 transport-fetch。LLM 协议、prompt、schema、鉴权映射和答案转换都保留在同一个包。

```sh
npm install @system-one-ai/core@next @system-one-ai/transport-fetch@next @system-one-ai/adapter-llm@next
```

```ts
import { createSystemOne } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { llmAdapter } from '@system-one-ai/adapter-llm';

const client = createSystemOne({
  adapter: llmAdapter({ provider: 'openai', llmAnswerMode: 'probabilities' }),
  transport: createFetchTransport(),
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
});
```

OpenAI 在 `api.openai.com` 使用 Responses，自定义地址使用 Chat Completions；也可通过 `api` 显式选择。Anthropic 使用 Messages。`llmAnswerMode` 支持 `probabilities` 和 `discrete`。服务不支持原生 JSON schema 时设置 `structuredOutputs: false`；概率归一化需显式启用 `normalizeProbabilities`。评估、校验和组合接口保持一致。

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
