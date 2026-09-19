# Jev 与 API 调研

核对日期：2026-09-18。资料来自 TypeSafe、Vercel、OpenRouter、Cloudflare 官方文档及官方 SDK；不把厂商宣传的速度、成本或准确率当成本项目的实测结果。

## 模型定位

TypeSafe 将 Jev 定义为面向软件决策的 System One 模型。它读取文本或文本形式的结构化状态，在预先定义的回答空间内作判断，不生成任意聊天文本。它适合路由、分类、局部判断和等级评分；这些能力可以成为 Agent 行为决策的输入，但模型本身不是动作执行器。

参考：[System One](https://docs.typesafe.ai/concepts/system-one)、[Introduction](https://docs.typesafe.ai/introduction)。

TypeSafe 的三个原语是 Choice、Score、Noul。Noul 返回 P(true)；Choice 和 Score 返回相应结果、概率分布及独立的 confidence 统计量。置信统计量和最大概率不能混用，概率校准也不是单次正确性的保证。

参考：[Choice](https://docs.typesafe.ai/primitives/choice)、[Score](https://docs.typesafe.ai/primitives/score)、[Noul](https://docs.typesafe.ai/primitives/noul)、[Confidence](https://docs.typesafe.ai/confidence)。

结构化 instructions 和 criteria 不是先拼成聊天 prompt 再生成 JSON；SDK 将这些结构直接传给接口。高级文档明确说明这些字段支持字符串、对象、数组及 null，故实现没有照基础示例误收窄为只接受字符串。

参考：[Advanced: structure](https://docs.typesafe.ai/primitives/advanced)。

## 原生与 Vercel 协议

| 项目 | TypeSafe 原生 | Vercel Gateway Evaluation |
| --- | --- | --- |
| 请求 | `POST /v1/systemone` | `POST /v4/ai/evaluation-model` |
| 鉴权 | Bearer API key | Bearer Gateway key；Gateway 协议头 |
| 模型 | JSON `model` | `ai-model-id` 请求头 |
| 默认 Jev ID | `jev-latest` | `typesafe-ai/jev` |
| 真假问题 | `type: noul` | `type: boolean` |
| 真假结果 | `noul` | `probability` |
| 用量 | `input_tokens` / `output_tokens` | `inputTokens` / `outputTokens` |
| confidence | 原生答案字段 | 可通过 TypeSafe provider metadata 返回 |

原生接口在 body 中接收 `state`、`model`、`questions`。结果按问题 ID 返回。常见失败包括 401、422、429 和 529，后两者需要退避。

参考：[TypeSafe API](https://docs.typesafe.ai/api)、[Models](https://docs.typesafe.ai/models)。

Vercel 文档要求 AI SDK 7+ 的 Evaluation 能力，明确不支持通过 OpenAI-compatible、Anthropic-compatible 或 Cohere-compatible 接口调用 Evaluation。因此，仅把 JEV 原生地址换成 `/chat/completions` 会失败。本 SDK 的可选模块 `@system-one-ai/adapter-vercel` 实现官方 Gateway SDK 所使用的 Evaluation wire protocol，核心不自动选择该协议。

参考：[Vercel Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation)、[AI SDK Evaluation](https://ai-sdk.dev/docs/ai-sdk-core/evaluation)。

0.1.0 实现核对了以下官方源码，并以 npm 发布的 `@ai-sdk/gateway@4.0.85` 做过离线请求对照。0.2.0 将该适配器拆到可选入口，移除供应商 SDK 依赖；测试保留已核对的请求格式：

- [Gateway Evaluation model](https://github.com/vercel/ai/blob/main/packages/gateway/src/gateway-evaluation-model.ts)：请求路径、模型及规格版本头、返回字段。
- [Gateway provider](https://github.com/vercel/ai/blob/main/packages/gateway/src/gateway-provider.ts)：`/v4/ai` 默认前缀、鉴权及 Gateway 协议版本。
- [TypeSafe Evaluation model](https://github.com/vercel/ai/blob/main/packages/typesafe-ai/src/typesafe-ai-evaluation-model.ts)：boolean/noul 转换、confidence metadata、两位小数舍入。

官方 JavaScript SDK 也已存在。本项目的价值是为多个服务提供独立的统一客户端和适配器契约，而不是声称 TypeSafe 没有 TypeScript 支持。

参考：[TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)。

## 兼容边界

System One 是能力类别，不代表所有供应商已经遵循同一个 HTTP 标准。本项目通过独立 adapter 支持 TypeSafe-compatible，Vercel Evaluation、OpenRouter Decisions 与 Cloudflare Jev REST 通过可选入口提供，也支持用户自定义适配器。其他模型需要具备相应问题能力；不同 wire protocol 接入后可复用同一业务接口。TypeSafe 真实调用记录见 `validation.md`；OpenRouter 的独立真实请求及后台记录核验见 [openrouter.md](openrouter.md)。Vercel 与 Cloudflare 尚未进行真实调用验证。

Cloudflare 的 [Jev 模型页](https://developers.cloudflare.com/ai/models/typesafe/jev/) 使用账户下 `/ai/run` 端点，请求体为 `{ model: 'typesafe/jev', input: { state, questions } }`。0.5.0 增加 `cloudflareAdapter({ accountId })`，自动提供地址及模型，不要求用户手写端点。协议转换、代理覆盖及验证范围见 [Cloudflare 接入](cloudflare.zh-CN.md)。
