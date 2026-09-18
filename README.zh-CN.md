# System One SDK

[English](README.md) | **简体中文**

通用 TypeScript 决策模型 SDK。统一使用 `evaluate({ state, questions })`，默认使用 TypeSafe Jev 的原生兼容协议；其他协议通过显式适配器接入。

运行时代码零第三方依赖，使用标准 Fetch、AbortController、ReadableStream；提供 ESM、CommonJS 和 TypeScript 声明。Node.js 最低目标为 20。浏览器、Workers 等环境需要提供这些 Web API；长期模型密钥应放在服务端。

## 安装

```sh
npm install @system-one-ai/sdk
```

## 本地使用

在本项目构建和验证：

```sh
npm install
npm run check
npm run test:package
```

其他项目可以安装构建后的本地目录，或者安装 `.artifacts/system-one-ai-sdk-0.2.0.tgz`。例如两个项目同处一层目录时：

```sh
npm install ../sytem-one-sdk
```

```ts
import { SystemOne, choice, booleanQuestion } from '@system-one-ai/sdk';

const client = new SystemOne({
  baseURL: 'https://api.typesafe.ai/v1',
  apiKey: process.env.SYSTEM_ONE_API_KEY!,
});

const result = await client.evaluate({
  state: { userMessage: '帮我倒杯水', location: 'living room' },
  questions: {
    action: choice('根据用户请求，选择下一步可执行动作', {
      drink: '去厨房接水',
      rest: '坐在沙发上休息',
      think: '交给应用的慢思考模块继续规划',
    }),
    interrupt: booleanQuestion('用户是否要求改变当前行为？'),
  },
});

result.answers.action.choice;           // 'drink' | 'rest' | 'think'
result.answers.action.probabilities;    // 可选，模型返回的原始概率分布
result.answers.action.confidence;       // 可选，供应商提供的置信统计量
result.answers.interrupt.probability;   // number，P(true)
result.usage.inputTokens;               // number | undefined
```

兼容原生协议的服务只需修改 `baseURL` 和 `apiKey`，业务调用保持一致。默认模型为 `jev-latest`；切换到其他模型时，可在客户端配置或单次请求中指定准确的 `model`。客户端不会根据 hostname 猜测供应商或修改协议。

```ts
const direct = new SystemOne({
  baseURL: 'https://api.typesafe.ai/v1',
  apiKey: process.env.TYPESAFE_API_KEY!,
});

const compatible = new SystemOne({
  baseURL: 'https://your-provider.example/api/v1',
  apiKey: process.env.SYSTEM_ONE_API_KEY!,
  model: 'your-system-one-model',
});
```

## 三种问题

| 工厂 | 输入 | 输出 |
| --- | --- | --- |
| `choice(instructions, criteria)` | 有名称的候选项映射，至少一个候选项 | 类型化 `choice`，可选 `probabilities`、`confidence` |
| `score(instructions, criteria)` | 至少两个有序等级 | 可以带小数的 `score`，可选 `probabilities`、`confidence`、`legend` |
| `booleanQuestion(instructions, criteria?)` | 真假问题，可描述 true/false 的含义 | `probability`，范围 0–1 |

SDK 以 `boolean` 命名真假问题，TypeSafe 适配器会将它转换成原生 `noul`，并把返回的 `noul` 转换成 `probability`。这个值保持概率语义，SDK 不会自动把它阈值化为 true/false。

`state` 可以是字符串、JSON 对象或数组；数组仍然是一份共享状态，不代表多条独立请求。多个问题共用同一份状态。需要独立状态时分别调用 `evaluate`。

候选项数量、评分等级数量和上下文长度的上限由实际模型决定，SDK 不把某一代 Jev 的上限固定成所有供应商的限制；超出当前模型能力时保留服务端错误。

`instructions` 和候选项、等级、真假标准的描述可以是字符串、JSON 对象、数组或 null。嵌套内容必须是有效 JSON；循环引用、undefined、NaN、函数和类实例会在发请求前报错。共享问题定义可用 `defineQuestions()` 保存字面量类型。

## 地址与协议

| `baseURL` | 默认协议 | 请求地址 |
| --- | --- | --- |
| 未设置 | TypeSafe-compatible | `https://api.typesafe.ai/v1/systemone` |
| `https://api.typesafe.ai` 或 `/v1` | TypeSafe-compatible | `/v1/systemone` |
| `https://custom.example/prefix/v1` | TypeSafe-compatible | `/prefix/v1/systemone` |

可以直接提供以 `/systemone` 结尾的完整接口地址。自定义路径前缀会被保留；只有没有路径的 API 根地址会补上 `/v1`。

## 可选 Vercel 适配器

Vercel 使用独立的 Evaluation 协议，适配器单独导出。核心入口没有导入、重新导出或自动选择它，也没有 `@ai-sdk/gateway` 运行时或开发依赖。使用 Vercel 时显式导入：

```ts
import { SystemOne } from '@system-one-ai/sdk';
import { vercelAdapter } from '@system-one-ai/sdk/adapters/vercel';

const gateway = new SystemOne({
  adapter: vercelAdapter,
  apiKey: process.env.AI_GATEWAY_API_KEY!,
});

// 默认地址：https://ai-gateway.vercel.sh/v4/ai
// 默认模型：typesafe-ai/jev
// 自定义代理可配置 baseURL: 'https://proxy.example/team/v4/ai'
```

该可选模块只实现 Evaluation v4 的请求和返回转换。它支持 API 根地址、`/v1`、`/v4/ai` 和以 `/evaluation-model` 结尾的完整地址，使用自定义代理时保留前缀。协议回归测试使用先前与官方 `@ai-sdk/gateway@4.0.85` 对照通过的固定请求格式，无需安装供应商 SDK。Evaluation 是实验接口，未来供应商修改协议时此模块可能需要更新。

从 0.1.0 迁移：删除 `protocol` 配置，Vercel 用户改为上述子路径导入并传入 `adapter`。原生协议的 `evaluate`、问题构造器和答案结构保持兼容；继续传入旧 `protocol` 参数会收到明确的配置错误。

“修改地址和密钥即可切换”以服务兼容已支持的协议、问题类型和模型能力为前提。任意未来供应商可能使用不同的鉴权、路径或字段；这类差异通过适配器接入一次，业务侧仍使用同一个 `evaluate`。SDK 不会把未知协议猜成 OpenAI 聊天接口。

## 请求控制与错误

```ts
import { APIError, TimeoutError, RequestAbortedError } from '@system-one-ai/sdk';

const controller = new AbortController();
try {
  const result = await client.evaluate({
    state: '用户提出了新的操作要求',
    questions: { interrupt: booleanQuestion('是否需要中断当前行为？') },
  }, {
    signal: controller.signal,
    timeoutMs: 1500,
    maxRetries: 0,
  });
  console.log(result.answers.interrupt.probability);
} catch (error) {
  if (error instanceof APIError) {
    console.error({ status: error.statusCode, requestId: error.requestId });
  } else if (error instanceof TimeoutError || error instanceof RequestAbortedError) {
    // 由应用决定暂停、显示状态，或发起新的决策。
  } else {
    throw error;
  }
}
```

| 配置 | 默认值 | 语义 |
| --- | --- | --- |
| `timeoutMs` | 10,000 | 整次调用的预算，包含密钥解析、重试、退避和响应体读取 |
| `maxRetries` | 2 | 首次请求之外的额外尝试次数；范围 0–100 |
| `retryDelayMs` | 200 | 指数退避初始延迟，带抖动 |
| `maxRetryDelayMs` | 2,000 | SDK 自身退避上限，不缩短服务器的 Retry-After |
| `maxResponseBytes` | 8 MiB | 成功响应体的字节上限 |
| `headers` | 无 | 自定义头；单次调用可覆盖同名业务头 |
| `fetch` | `globalThis.fetch` | 可注入自定义 Fetch 供代理、观测或测试使用 |

`timeoutMs`、`maxRetries` 和 `headers` 可以通过 `evaluate` 的第二个参数单独覆盖。`apiKey` 可以是字符串或同步/异步取密钥函数；无鉴权本地服务可显式传 null。SDK 不会读取全局环境变量。

网络失败、408、429、5xx（包括 TypeSafe 529）可以重试。401、403、422、非法 JSON 和非法答案不会触发重试。服务器的 `Retry-After` 支持秒数、HTTP 日期及 `retry-after-ms`；超出剩余预算时直接报 `TimeoutError`，不会提前重试。

错误类型包括 `ConfigurationError`、`ValidationError`、`UnsupportedFeatureError`、`ResponseValidationError`、`APIError`、`ConnectionError`、`TimeoutError`、`RequestAbortedError`，均继承 `SystemOneError`，带有稳定的 `code`。

SDK 不记录密钥和请求体，也不把可能回显敏感信息的服务端错误正文附在异常上。`APIError` 保留状态码、request ID 和重试延迟。鉴权、Content-Type、Host 以及协议头由 SDK 管理，不允许通过普通业务头覆盖。请求不自动跟随重定向；适配器也不能将密钥发送到不同于 baseURL 的 origin。

## 结果校验与概率含义

返回结果需要包含每个问题的答案，并匹配问题类型。选择必须属于候选项，概率需要在 0–1 内，评分需要落在等级范围内。提供概率分布时，还会检查分布键、概率总和、所选项及评分的加权均值。非法数据直接报错，不会被改成默认动作。

TypeSafe 的已知两位小数舍入，以及 Gateway 的 `rounding` 声明，会计入验证容差。SDK 保留原始数值，不擅自重新归一化。新的兼容服务可以通过响应中的 `rounding` 指明精度；自定义适配器未声明舍入时，基础绝对容差为 `1e-6`。

`confidence` 是供应商报告的统计量，不等于所选项的概率，也不保证不同模型间可比。Vercel 返回 TypeSafe 的 confidence 元数据时，SDK 会保留元数据并提取到对应答案；没有提供时保持 undefined。没有概率分布或 token 计数的供应商也不会被补成虚构的数值。

Jev 的概率校准描述的是一组预测的表现，并不保证单次决策正确。应用需要根据自身任务验证阈值。SDK 本身不产生文本回复、执行动作或调用慢思考模型；`think` 可以作为应用定义的候选项。

## 接入新协议

`SystemOneAdapter` 只负责 `prepare`、`decode` 和可选的 `authenticate`，共用客户端的请求控制及结果校验。完整 TypeScript 示例在 [examples/custom-adapter.ts](examples/custom-adapter.ts)。

```ts
import type { SystemOneAdapter } from '@system-one-ai/sdk';

const adapter: SystemOneAdapter = {
  id: 'my-provider',
  defaultModel: 'reflex-1',
  supportedQuestionTypes: ['choice', 'score', 'boolean'],
  prepare({ baseURL, model, request }) {
    return {
      url: `${baseURL}/decisions`,
      body: { engine: model, context: request.state, queries: request.questions },
    };
  },
  decode(payload) {
    // 此示例约定服务已返回 ProviderResponse 格式。
    // 不同返回结构可在这里映射；客户端随后验证全部字段。
    return payload;
  },
};
```

未支持的问题类型会在请求前拒绝。适配器必须返回标准 `ProviderResponse` 结构；新增全新的决策原语需要扩展 SDK 类型契约，不会假装已有原语能表示任何能力。

## 示例与验证

`examples/basic.ts` 演示三个原语；`examples/realtime-agent.ts` 演示实时行为选择及 `think` 候选项。它们需要真实凭据，会产生真实 API 调用。

```sh
cp .env.example .env
# 在 .env 中填入凭据，然后：
npm run examples:build
node --env-file=.env .examples/examples/basic.js
node --env-file=.env .examples/examples/realtime-agent.js
```

也可以通过 shell 设置环境变量后执行 `npm run example` 或 `npm run example:agent`。

`npm test` 保持离线，覆盖协议、取消、超时、重试、错误和真实本地 HTTP；`npm run typecheck` 检查 TypeScript 类型推断。打包测试会将 tarball 安装到独立临时项目，验证 ESM/CJS 的核心及可选入口、两种模块的声明解析，并确认核心加载时不包含 Vercel 模块。

官方 API 联调使用单独的命令，读取当前项目的 `.env` 并发出四个真实请求：

```sh
npm run test:live
```

它验证中文行为决策、退款分类、评分、真假判断，以及字符串、对象、数组状态；成功结果写入 `.artifacts/live-typesafe.json`。该命令会产生实际 API 用量，默认不重试。输出包含答案、用量和耗时，不包含 API key 或鉴权头。本次真实验证结果见 `docs/validation.md`。

设计和来源见 [docs/design.md](docs/design.md)；Jev 与 API 调研见 [docs/jev-api.md](docs/jev-api.md)；实际验证记录见 [docs/validation.md](docs/validation.md)。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
