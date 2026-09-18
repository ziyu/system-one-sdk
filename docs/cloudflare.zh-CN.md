# Cloudflare Jev 接入

[English](cloudflare.md) | **简体中文**

`0.5.0` 起提供可选入口 `@system-one-ai/sdk/adapters/cloudflare`；AI runner 响应包装需要使用 `0.5.2+`。默认地址和模型由 adapter 提供，应用只需传入账户 ID 和 API token。

```ts
import { SystemOne, choice } from '@system-one-ai/sdk';
import { cloudflareAdapter } from '@system-one-ai/sdk/adapters/cloudflare';

const client = new SystemOne({
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

需要代理时，在 `SystemOne` 的配置中额外传入 `baseURL`。以下路径形式会保留所选 origin 和代理前缀：

| 输入路径 | 最终路径 |
| --- | --- |
| 空路径 | `/client/v4/accounts/{accountId}/ai/run` |
| `/client/v4` 或 `/team/client/v4` | 追加 `/accounts/{accountId}/ai/run` |
| `/client/v4/accounts` | 追加 `/{accountId}/ai/run` |
| `/client/v4/accounts/{accountId}` | 追加 `/ai/run` |
| `/client/v4/accounts/{accountId}/ai` | 追加 `/run` |
| `/client/v4/accounts/{accountId}/ai/run` | 原样使用 |
| `/team/ai` 或 `/team/ai/run` | 使用代理的 `/team/ai/run` 端点 |

末尾斜线会被移除。`baseURL` 中存在账户段时，它必须与 adapter 的账户 ID 一致。旧式把模型放在路径中的地址会被拒绝；不包含账户段的代理端点需要自行路由到目标账户。账户 ID 必须是仅包含字母、数字、下划线或连字符的非空路径段，账户是否存在由 Cloudflare 确认。

客户端 `model` 覆盖 adapter 默认模型，单次请求的 `model` 再覆盖客户端值。显式 ID 原样发送，其他模型需要支持同一决策原语及协议。当前只实现 Jev 文档中的 `state`、`questions` 输入；非空 `providerOptions` 会被拒绝。

## 协议与来源

核对日期：2026-09-18。[Cloudflare Jev 模型页](https://developers.cloudflare.com/ai/models/typesafe/jev/) 使用 `POST /client/v4/accounts/{accountId}/ai/run`、Bearer 鉴权以及 `{ model, input: { state, questions } }` 请求体。adapter 按该模型专属契约发送请求。

模型页展示 `choice`、`score`、`noul` 原语，输出包含答案、服务端提供的实际模型 ID 和 snake-case token 用量。SDK 将 `boolean` 映射为 `noul`，将返回值还原为 P(true)，保留原始概率、分数、legend 和 confidence，并统一用量字段。缺失的可选统计不补零。Jev 保留两位小数精度约定；未来非 Jev 模型需要自行声明所需的舍入精度。

[通用 AI REST 参考](https://developers.cloudflare.com/api/resources/ai/methods/run/) 还展示了 Cloudflare 响应 envelope。解码器既接受模型直接结果，也接受 `result` 包装；提供了 `success` 时必须为 true，提供了 `errors` 时必须为空数组。外层和内层错误都会拒绝处理；同时存在顶层答案和包装结果的歧义响应同样拒绝。HTTP 失败保留现有 `APIError`；HTTP 200 正文中的失败转换为不重试的 `ResponseValidationError`，错误中不附带可能回显凭据的响应正文。

`0.5.2` 补上本次反馈的 AI runner 兼容结构：`{ success: true, result: { state: "Completed", result: modelResult } }`，也接受没有外层 REST envelope 的 runner。最多解开两层包装，每层在解包之前校验；存在 `state` 时必须严格为 `"Completed"` 且包含 `result`，不轮询失败或未完成任务。任何一层同时出现 `answers` 和 `result` 都会拒绝。最内层模型结果继续经过统一答案、概率和用量校验。runner fixture 用于兼容性回归；模型页本身展示的是内部模型结果，没有展示额外的 runner 包装。

此 adapter 使用 Fetch 调用 REST。Workers 原生 `env.AI.run()` binding 属于独立接口，本入口尚未封装。账户和 token 配置参见 [REST 入门](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)。SDK 不探测备用端点，也不自动切换供应商。

## 验证方式

`tests/cloudflare-adapter.test.mjs` 使用独立 fixture 覆盖直接结果、REST 包装、runner 包装、地址生成、账户校验、覆盖配置、非法响应、重试、取消，并通过原生 Fetch 访问真实本地 HTTP server。即使包含看似有效的答案，也会检查失败/非法状态和内层错误。决策组合、批量评估及安装后的 ESM/CommonJS 检查同样覆盖 runner 响应。`tests/adapter-defaults.test.mjs` 验证所有内置 adapter 均可省略地址和模型，同时仍支持显式覆盖。这些测试保持离线，不代表模型推理成功。

真实联调独立读取 `.env.cloudflare`，不会继承其他供应商凭据或自动选择别的地址。在仓库内运行：

```sh
cp .env.cloudflare.example .env.cloudflare
# 填写 CLOUDFLARE_ACCOUNT_ID 和 CLOUDFLARE_API_TOKEN。
npm run example:cloudflare
npm run test:live:cloudflare
```

示例支持可选地址/模型覆盖；联调脚本验证官方默认值，拒绝冲突覆盖。成功路径只发出三次推理请求且不重试，分别验证包含三个原语的对象状态、中文动作请求、数组状态的正反真假判断。答案、HTTP 状态、模型、已报告用量、耗时及选取的诊断响应头写入 `.artifacts/live-cloudflare.json` 和时间戳副本。报告不包含 API token 或 Authorization，端点中的账户 ID 被替换为占位符。

实现时项目没有 Cloudflare 凭据或 `.env.cloudflare`，联调命令在配置阶段退出，推理请求数为零。真实 Cloudflare 推理与 Workers 运行时执行尚未验证。实际执行结果见 [验证历史](validation.md)；普通测试及 CI 不运行付费联调命令。
