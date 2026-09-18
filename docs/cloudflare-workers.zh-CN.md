# Cloudflare Workers AI 原生 binding

[English](cloudflare-workers.md) | **简体中文**

这是 0.5.2 的 REST 支持之后新增、尚未发布的入口。通过 `@system-one-ai/sdk/cloudflare-workers` 直接调用 `env.AI.run()`。客户端实现现有 `EvaluationClient`，已有 `defineDecision()`、概率策略及 `evaluateMany()` 可以继续使用，运行时依赖保持不变。

```ts
import { choice } from '@system-one-ai/sdk';
import { createCloudflareWorkers } from '@system-one-ai/sdk/cloudflare-workers';

const client = createCloudflareWorkers({
  binding: env.AI,
  timeoutMs: 1500,
  maxRetries: 0,
});
const result = await client.evaluate({
  state: { message: '我被重复扣款了。' },
  questions: {
    department: choice('应该交给哪个团队处理？', {
      billing: '付款、扣款与退款',
      technical: '软件故障与集成问题',
    }),
  },
}, { signal: request.signal });
```

在服务的 Wrangler 配置中加入 `"ai": { "binding": "AI" }`。构造器不需要模型 API key、account ID 或 REST baseURL，部署环境提供 binding。部署认证与推理计费仍然存在。System One API 服务继续负责公开 API 的认证、租户范围、配额和响应契约；Workers 外部可以继续使用 `SystemOne` 与 Cloudflare REST adapter。

## 接口与调用生命周期

新入口导出 `CloudflareWorkers`、`createCloudflareWorkers()`、`CloudflareWorkersOptions` 和 `CloudflareAiBinding`。结构化 binding 接口避免 SDK 使用方依赖 Cloudflare 包。默认模型为 `typesafe/jev`，单次请求可以覆盖。

原生调用使用 `returnRawResponse: true` 并传入总期限 `AbortSignal`。REST 与 binding 复用 Cloudflare envelope 解码和限长 UTF-8/JSON Response 读取。`boolean` 映射为原生 `noul`，返回值保留 P(true)、概率分布、confidence、warnings 和已报告用量。

元数据来自每次真实 Response，包括状态码与 `cf-ai-req-id`（优先级在标准请求 ID 头之后）。不会读取 binding 上并发共享的 `lastRequestId` 等字段，缺失统计量保持缺省。输入及 headers 在等待前生成快照，每次重试复制传给 binding 的输入，保护校验依据与后续尝试。

默认 `timeoutMs=10000`、`maxRetries=2`、`retryDelayMs=200`、`maxRetryDelayMs=2000`、`maxResponseBytes=8 MiB`。单次调用可设置 `signal`、`timeoutMs`、`maxRetries` 和 `headers`；低延迟服务建议显式关闭重试。应用 headers 通过 `extraHeaders` 传递，但不能覆盖认证、协议头或 `cf-consn-*`。非空 `providerOptions` 会拒绝，首版不提供 Gateway 路由、WebSocket、流式模型响应及异步排队推理。

HTTP 408、429、5xx 与响应体读取中断可在同一总期限内重试，不能提前于 Retry-After。binding 在返回 Response 前直接抛错时产生脱敏 `BindingError`（核心错误入口导出，`code: 'binding'`），不附带上游消息或 cause、不猜状态码、不自动重试。损坏响应和失败/未完成的 runner 同样不重试。

取消与超时分别产生 `RequestAbortedError`、`TimeoutError`。SDK 不会无限等待忽略取消的自定义 binding，并尽力清理迟到响应；信号传递不保证远端推理停止或免于计费，也不会自动更换模型。

## 示例与验证

`examples/cloudflare-workers/` 提供固定输入的 smoke Worker，通过 POST 主动触发推理，配置关闭公开 workers.dev 路由。使用已认证的 Wrangler 执行 `wrangler dev --config examples/cloudflare-workers/wrangler.jsonc`，然后 POST 到终端打印的本地地址。每次请求均会调用真实 Cloudflare AI 并消耗用量；示例不应作为无认证的生产 API 公开。

新增测试覆盖三种原语、envelope、配置及格式错误、总期限、取消、重试、并发请求 ID、快照、组合模块与 ESM/CJS 入口。类型测试覆盖闭合选项推导与可选入口边界。可控 binding 测试不能证明部署后的 Workers 执行、真实推理、模型质量或延迟提升，这些需要单独验证。

协议依据（2026-09-18 核对）：[Jev 模型页](https://developers.cloudflare.com/ai/models/typesafe/jev/)、[binding 配置](https://developers.cloudflare.com/workers-ai/configuration/bindings/)、[workerd AI binding 源码](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts)。
