# Cloudflare Jev 与 Clef 接入

[English](cloudflare.md) | **简体中文**

独立包 `@system-one-ai/adapter-cloudflare` 支持 Jev 和多模态 Clef / Clef Flash，兼容 REST 与 AI runner 响应包装。adapter 提供默认地址，应用传入账户 ID、API token 及可选模型配置；默认模型仍为 Jev。

```ts
import { createFetchTransport } from '@system-one-ai/transport-fetch';
import { SystemOne, choice } from '@system-one-ai/core';
import { cloudflareAdapter } from '@system-one-ai/adapter-cloudflare';

const client = new SystemOne({
  transport: createFetchTransport(),
  adapter: cloudflareAdapter({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID! }),
  apiKey: process.env.CLOUDFLARE_API_TOKEN!,
});
const result = await client.evaluate({
  state: '请退回重复扣除的钱。',
  questions: { team: choice('由哪个团队处理？', {
    billing: '付款与退款', support: '技术问题',
  }) },
});
console.log(result.answers.team.choice); // 'billing' | 'support'
```

Cloudflare 的接口属于具体账户，因此使用 `cloudflareAdapter({ accountId })` 工厂建立账户配置快照，返回冻结的 `SystemOneAdapter`。鉴权、期限、取消、重试、结果验证及自定义 Fetch 仍由现有客户端负责，不引入新的运行时依赖。已有决策组合、概率策略、批量调度模块可以直接复用该客户端。

## 默认配置与覆盖

默认地址为 `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run`，默认模型为 `typesafe/jev`。SDK 不自行读取环境变量；示例在应用代码中显式传入账户和凭据。

需要代理时，在 `SystemOne` 的配置中额外传入 `baseURL`。以下路径形式保留所选 origin 和代理前缀；Clef 会在最终 `/ai/run` 路径后追加模型 ID：

| 输入路径 | 最终路径 |
| --- | --- |
| 空路径 | `/client/v4/accounts/{accountId}/ai/run` |
| `/client/v4` 或 `/team/client/v4` | 追加 `/accounts/{accountId}/ai/run` |
| `/client/v4/accounts` | 追加 `/{accountId}/ai/run` |
| `/client/v4/accounts/{accountId}` | 追加 `/ai/run` |
| `/client/v4/accounts/{accountId}/ai` | 追加 `/run` |
| `/client/v4/accounts/{accountId}/ai/run` | 原样使用 |
| `/team/ai` 或 `/team/ai/run` | 使用代理的 `/team/ai/run` 端点 |

末尾斜线会被移除。`baseURL` 中存在账户段时，它必须与 adapter 的账户 ID 一致。请传不带模型后缀的基础地址；adapter 为 Clef 添加文档规定的后缀，Jev 保持 runner 路径。不包含账户段的代理端点需要自行路由到目标账户。账户 ID 必须是仅包含字母、数字、下划线或连字符的非空路径段，账户是否存在由 Cloudflare 确认。

客户端 `model` 覆盖 adapter 默认模型，单次请求的 `model` 再覆盖客户端值。`@cf/cloudflare/clef` 与 `@cf/cloudflare/clef-flash` 选择下方 Clef 协议；其他显式 ID 保留原有 runner 契约，必须支持相同决策原语。非空 `providerOptions` 均被拒绝；图片使用 core 的原生请求字段。

## Clef 图片输入

选择完整 Workers AI 模型 ID，而不是请求体里的短名称。图片通过 core 的 `EvaluateRequest.images` 传入，与 `state`、`questions` 并列。REST 与 [Workers 原生客户端](cloudflare-workers.zh-CN.md) 接受相同的 `ImageInput` 类型：

```ts
import { readFile } from 'node:fs/promises';
import type { ImageInput } from '@system-one-ai/core';

const images: readonly ImageInput[] = [
  { mediaType: 'image/png', base64: (await readFile('receipt.png')).toString('base64') },
];
const result = await client.evaluate({
  model: '@cf/cloudflare/clef', // 或 @cf/cloudflare/clef-flash
  state: '检查附带的收据。',
  questions: { team: choice('应该交给谁处理？', {
    billing: '付款与退款', support: '技术问题',
  }) },
  images,
});
```

每张图片可以是 base64 data URL（`data:image/png;base64,...`，或 JPEG、WebP），也可以是 `{ mediaType, base64 }`。core 导出 `ImageInput`，校验图片表示、base64 并与请求一起生成快照；Cloudflare adapter 将 `mediaType` 转为原生 `content_type`，调用方不接触供应商字段。纯文本调用省略 `images`；Jev 拒绝非空图片输入。远程图片 URL 在鉴权或调用 binding 前拒绝，SDK 不自动下载图片。

core 要求 adapter 显式声明 `supportsImages: true`，否则非空图片请求直接报错，不会静默变成纯文本。Cloudflare adapter 负责自身的 PNG/JPEG/WebP 格式、最多 4 张、单张解码后不超过 4 MiB、总计不超过 8 MiB 限制；这些限制不污染其他 core adapter。服务端另外检查图片内容有效性、单张不超过 1600 万像素及整个请求不超过 13 MiB；SDK 不解码像素，也不在本地强制后两项限制。模型将图片置于 state 之前。虽然模型介绍提及视频，当前公开 API schema 只暴露 `images`，SDK 没有视频上传字段或自动抽帧功能.

2026-10-04 核对：[Clef 模型页](https://developers.cloudflare.com/workers-ai/models/clef/)、[输入 schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json)、[输出 schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-output.json)、[Clef Flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/)。REST 使用 `POST /client/v4/accounts/{accountId}/ai/run/@cf/cloudflare/clef`，请求体为 `{ model: "clef", state, questions, images? }`；Flash 使用自己的路径和 `model: "clef-flash"`。Workers 调用 `env.AI.run(完整模型ID, 同一输入, options)`。两者复用 choice/score/noul 解码与 token 归一化，不套用 Jev 的两位小数约定。

## 协议与来源

核对日期：2026-09-18。[Cloudflare Jev 模型页](https://developers.cloudflare.com/ai/models/typesafe/jev/) 使用 `POST /client/v4/accounts/{accountId}/ai/run`、Bearer 鉴权以及 `{ model, input: { state, questions } }` 请求体。adapter 按该模型专属契约发送请求。

模型页展示 `choice`、`score`、`noul` 原语，输出包含答案、服务端提供的实际模型 ID 和 snake-case token 用量。SDK 将 `boolean` 映射为 `noul`，将返回值还原为 P(true)，保留原始概率、分数、legend 和 confidence，并统一用量字段。缺失的可选统计不补零。Jev 保留两位小数精度约定；未来非 Jev 模型需要自行声明所需的舍入精度。

[通用 AI REST 参考](https://developers.cloudflare.com/api/resources/ai/methods/run/) 还展示了 Cloudflare 响应 envelope。解码器既接受模型直接结果，也接受 `result` 包装；提供了 `success` 时必须为 true，提供了 `errors` 时必须为空数组。外层和内层错误都会拒绝处理；同时存在顶层答案和包装结果的歧义响应同样拒绝。HTTP 失败保留现有 `APIError`；HTTP 200 正文中的失败转换为不重试的 `ResponseValidationError`，错误中不附带可能回显凭据的响应正文。

`0.5.2` 补上本次反馈的 AI runner 兼容结构：`{ success: true, result: { state: "Completed", result: modelResult } }`，也接受没有外层 REST envelope 的 runner。最多解开两层包装，每层在解包之前校验；存在 `state` 时必须严格为 `"Completed"` 且包含 `result`，不轮询失败或未完成任务。任何一层同时出现 `answers` 和 `result` 都会拒绝。最内层模型结果继续经过统一答案、概率和用量校验。runner fixture 用于兼容性回归；模型页本身展示的是内部模型结果，没有展示额外的 runner 包装。

本入口使用 Fetch 调用 REST；独立 `@system-one-ai/adapter-cloudflare/workers` 入口封装 [Workers 原生 `env.AI.run()`](cloudflare-workers.zh-CN.md)。账户和 token 配置参见 [REST 入门](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)。SDK 不探测备用端点，也不自动切换供应商。

## 验证方式

`tests/cloudflare-adapter.test.mjs` 使用独立 fixture 覆盖直接结果、REST 包装、runner 包装、地址生成、账户校验、覆盖配置、非法响应、重试、取消，并通过原生 Fetch 访问真实本地 HTTP server。即使包含看似有效的答案，也会检查失败/非法状态和内层错误。决策组合、批量评估及安装后的 ESM/CommonJS 检查同样覆盖 runner 响应。`tests/adapter-defaults.test.mjs` 验证所有内置 adapter 均可省略地址和模型，同时仍支持显式覆盖。这些测试保持离线，不代表模型推理成功。

真实联调独立读取 `.env.cloudflare`，不会继承其他供应商凭据或自动选择别的地址。在仓库内运行：

```sh
cp .env.cloudflare.example .env.cloudflare
# 填写 CLOUDFLARE_ACCOUNT_ID 和 CLOUDFLARE_API_TOKEN。
npm run example:cloudflare
npm run test:live:cloudflare
```

示例支持可选地址/模型覆盖。图片输入设置 `SYSTEM_ONE_MODEL=@cf/cloudflare/clef`（或 `@cf/cloudflare/clef-flash`），并设置 `CLOUDFLARE_IMAGE_PATH=./receipt.png`。联调脚本允许在官方端点使用 Jev、Clef 或 Clef Flash，拒绝代理地址；不重试，发出三次文本推理请求，分别验证三个原语的对象状态、中文动作请求、数组状态的正反真假判断。提供图片时额外发出一次图片请求，只检查概率契约，不将无标签图片作为语义准确率证据。答案、HTTP 状态、模型、用量、耗时及选取的诊断响应头写入 `.artifacts/live-cloudflare.json` 和时间戳副本。报告不包含 API token、Authorization 或图片字节，端点中的账户 ID 被遮蔽。

使用本仓库 `.env` 中的凭据完成了真实托管推理：Clef / Clef Flash 共 24 次请求均 HTTP 200、无重试。红蓝方块合成样本覆盖 PNG/JPEG/WebP、对象及 data URL、四图顺序、空字符串 state、并发/排队批量、异步鉴权快照、决策/概率策略及评测状态变体。这是小样本连通性和语义检查，不是模型质量基准。上方标准命令仍读取独立 `.env.cloudflare`；本次混合供应商验证使用临时 runner，没有改动凭据或 SDK 配置。真正 Workers `env.AI` 推理仍被开发/预览权限阻塞，REST 成功不代表 binding 已线上验证。证据与限制见 [验证历史](validation.md)；普通测试和 CI 不调用付费模型。
