# OpenAI Decisions

[English](openai-decisions.md) | **简体中文**

OpenAI Decisions 是 OpenAI 的 wire 协议，不是 Cloudflare 专有格式。本仓库把协议 codec 与供应商分离：

- `@system-one-ai/protocol-openai-decisions` 负责 System One 问题／答案与 Decisions payload 的转换。
- `@system-one-ai/adapter-openai-decisions` 直接调用 OpenAI，或调用任何实现同一契约的兼容供应商。
- `@system-one-ai/adapter-cloudflare` 只包装 Cloudflare 的 `/ai/run` runner、鉴权和响应 envelope。

## 直接调用 OpenAI

```ts
import { createSystemOne, booleanQuestion } from '@system-one-ai/core';
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { openAiDecisionsAdapter } from '@system-one-ai/adapter-openai-decisions';

const client = createSystemOne({
  adapter: openAiDecisionsAdapter,
  transport: createFetchTransport(),
  apiKey: process.env.OPENAI_API_KEY!,
});
const result = await client.evaluate({
  state: '同一订单被重复扣款。',
  questions: { refund: booleanQuestion('客户是否要求退款？') },
});
```

默认地址为 `https://api.openai.com/v1`，默认模型为 `gpt-6-luna`，请求 `POST /v1/decisions`。

## 兼容供应商

只改客户端配置即可切换供应商，不需要改协议代码：

```ts
const compatible = createSystemOne({
  adapter: openAiDecisionsAdapter,
  transport: createFetchTransport(),
  baseURL: 'https://provider.example/openai/v1',
  apiKey: process.env.PROVIDER_API_KEY!,
  model: 'provider/decisions-model',
});
```

`baseURL` 可以是 origin、`/v1` 根路径，或已经以 `/decisions` 结尾的端点。路径为空时 adapter 先补 `/v1`，再补 `/decisions`；已存在则不重复。鉴权、重试、超时、取消和响应大小限制仍由 transport 负责。

如果供应商有不同的外层 envelope 或鉴权方式，依赖 `protocol-openai-decisions`，用 `encodeOpenAiDecisionsRequest()` 与 `decodeOpenAiDecisionsResponse()` 写一个薄 adapter 即可。Cloudflare adapter 就是这么做的。

## 映射关系

| core 题型 | OpenAI Decisions |
| --- | --- |
| `boolean` | `predicate`；true/false 条件描述追加到 `instructions` |
| `choice` | `choice`，`choices: [{ value, description? }]` |
| `score` | `score`，有序 `levels: [{ label, description? }]` |

字符串 state 直接作为 `input`。对象 state 和对象数组转换为一条 user message，使用 `input_json` content part，证据放在 `data` 字段。无法由 OpenAI `input_json.data` schema 表示的状态（例如顶层原始值数组）回退为 JSON 文本。图片转换为有序的 `input_image` data URL；字符串 state 搭配 `input_text`，结构化 state 搭配 `input_json`。响应按问题 name 匹配，仅当 name 缺失时按位置回退。predicate 转为 boolean 概率，choice 概率数组转为选项映射，score 概率数组转为索引键概率并附带原始 rubric legend。`refusal` 以 `ResponseValidationError` 失败。

OpenAI 原生 schema 最多 400 个问题；Cloudflare 代理 schema 为 200 个。choice 问题限制为 2–255 个选项，score 问题限制为 2–10 个有序级别。Cloudflare 公开 schema 未暴露 `input_json`，因此其 adapter 显式选择文本 state 编码；这是供应商能力差异，不是另一套协议。非空 `providerOptions` 暂不支持。Decisions 未声明舍入约定，因此不套用 Jev 的两位小数精度。

2026-11-07 核对：[OpenAI Decisions 指南](https://developers.openai.com/api/docs/guides/decisions)、[Cloudflare 模型页](https://developers.cloudflare.com/ai/models/openai/decisions/)。
