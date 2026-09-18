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

其他项目可以安装构建后的本地目录，或者安装 `.artifacts/system-one-ai-sdk-0.5.0.tgz`。例如两个项目同处一层目录时：

```sh
npm install ../sytem-one-sdk
```

```ts
import { SystemOne, choice, booleanQuestion } from '@system-one-ai/sdk';

const client = new SystemOne({
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

内置 adapter 自带默认地址和模型。选择 adapter 并提供对应凭据即可使用；Cloudflare 还需要账户 ID。正常接入无需查找 `baseURL` 或模型名称。`baseURL` 保留为代理和兼容服务的可选覆盖项；`model` 可用于固定版本或选择其他受支持的决策模型。客户端不会根据 hostname 猜测供应商。

```ts
const direct = new SystemOne({
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

`state` 可以是字符串、JSON 对象或数组；数组仍然是一份共享状态，不代表多条独立请求。多个问题共用同一份状态。需要独立状态时分别调用 `evaluate`，或使用下方可选的 `evaluateMany` 调度器。

候选项数量、评分等级数量和上下文长度的上限由实际模型决定，SDK 不把某一代 Jev 的上限固定成所有供应商的限制；超出当前模型能力时保留服务端错误。

`instructions` 和候选项、等级、真假标准的描述可以是字符串、JSON 对象、数组或 null。嵌套内容必须是有效 JSON；循环引用、undefined、NaN、函数和类实例会在发请求前报错。共享问题定义可用 `defineQuestions()` 保存字面量类型。

## 可选决策组合（0.4.0+）

这些模块适用于 `SystemOne` 以及实现 `EvaluationClient` 类型的应用包装器。它们不选择供应商，也不增加运行时依赖；核心入口不会加载它们。新的组合声明要求 TypeScript 5.4+。

| 入口 | API |
| --- | --- |
| `@system-one-ai/sdk/decisions` | `choiceFrom`、`defineDecision` |
| `@system-one-ai/sdk/policies` | `gateChoice`、`gateBoolean` |
| `@system-one-ai/sdk/batch` | `evaluateMany` |

```ts
import { choiceFrom, defineDecision } from '@system-one-ai/sdk/decisions';
import { gateChoice } from '@system-one-ai/sdk/policies';

const targets = choiceFrom({
  instructions: '选择用户请求操作的设备。',
  items: [{ id: 'desk', label: '台灯', on: false }],
  id: device => device.id,
  describe: device => device.label,
});
const definition = defineDecision({
  instructions: '选择动作；请求不明确时要求澄清。',
  actions: {
    turn_on: { description: '打开设备', parameters: { device: targets } },
    ask: { description: '请求澄清' },
  },
});
const { decision, evaluation } = await definition.evaluate(client, {
  state: '请打开台灯。',
}, { maxRetries: 0 });

const actionGate = gateChoice(evaluation.answers.action, {
  minProbability: 0.8, abstain: ['ask'],
});
if (actionGate.status === 'accepted' && decision.action === 'turn_on') {
  const targetGate = gateChoice(decision.parameterAnswers.device, { minProbability: 0.8 });
  if (targetGate.status === 'accepted') {
    decision.parameters.device.on = true; // 应用显式修改原业务对象。
  }
}
```

候选 ID 和描述建立快照，解析结果保留原对象引用。重复 ID 会报错；空集合需要显式 `none: { id, description }`，配置后返回类型包含 undefined。一次评估包含所有预定义动作分支，最终只暴露选中分支的类型化参数与具名 `parameterAnswers`。普通 choice、score、boolean 参数分别得到候选 ID、小数评分和 P(true)；完整证据及供应商元数据保留在 `evaluation` 中。

策略没有默认阈值。`gateChoice` 可组合所选概率、与其他项的差值、供应商 confidence；`gateBoolean` 使用 `maxFalseProbability` 与 `minTrueProbability` 定义真假接受区间，中间保留不确定。结果明确区分接受、不确定和 choice 弃权；缺少证据保持不确定，接口失败保持错误。示例阈值需要在业务中验证，动作执行与慢思考回调由应用接入。

```ts
import { evaluateMany } from '@system-one-ai/sdk/batch';

const report = await evaluateMany(client, [
  { id: 'first', request: { state: '打开台灯。', questions: definition.questions } },
  { id: 'second', request: { state: '我需要帮助。', questions: definition.questions } },
], { concurrency: 2, requestOptions: { timeoutMs: 5000, maxRetries: 0 } });

for (const item of report.items) {
  if (item.status === 'fulfilled') console.log(item.id, definition.resolve(item.value));
  else console.log(item.id, item.status); // rejected 或 cancelled，原错误保留
}
```

默认并发数为 4，属于客户端调度，不依赖供应商 batch 接口。输入顺序和 ID 保留，单项失败不会丢失其他结果。批次 `signal` 取消运行中的请求并跳过排队任务，返回部分结果；单项超时从发起时计时。`summary.reportedUsage` 与 `usageCoverage` 区分已报告和缺失的 token 计数，不代表包含失败或取消请求的完整账单。

完整的类型、校验、快照、参数证据、取消及用量契约见 [组合模块文档](docs/composition.zh-CN.md)（[English](docs/composition.md)）。

### 可直接运行的决策业务示例

仓库提供文件收件箱归档和持久化客服工单两个流程：接受自己的自然语言指令，调用模型选择动作及参数，执行处理函数，并保存文件或工单修改。业务数据生成在新的本地目录中，模型请求和磁盘操作是真实的。

```sh
npm run example:decisions -- --message '把办公桌椅采购的发票放进财务发票目录。'
npm run example:support -- --message '把登录故障工单交给平台值班组，设置为紧急。'
npm run test:live:decisions -- --provider typesafe
```

通过 `--workspace` 复用命令输出的目录，`--request-id` 验证重复请求，`--provider openrouter` 切换接入。20 条真实联调用例同时检查动作、参数、落盘效果和重放。配置、实现结构、使用边界及实测结果见[决策业务示例](docs/decision-workflows.zh-CN.md)（[English](docs/decision-workflows.md)）。

### 真实浏览器案例

```sh
# 打开 Chrome：搜索 MDN，再进入 AbortController 的 abort() 方法页。
npm run example:browser
# 同一个决策循环搜索 GitHub，进入 cloudflare/agents 的 examples 目录。
npm run example:browser -- --task github-agents
```

命令发出真实模型请求并操作公开网页。每步读取当前 DOM，通过 `decisions` 选择动作和目标，再由 Playwright 执行。最终页面验收、截图和操作回放保存到 `.artifacts/`。可以用 `--url`、`--goal`、`--input` 配置其他任务，也可以切换 provider。Playwright 仅是开发依赖，SDK 运行时仍然零依赖。配置、实现及证据见[浏览器案例文档](docs/browser-decisions.zh-CN.md)（[English](docs/browser-decisions.md)）。

## 地址与协议

| Adapter | 必需配置 | 默认模型 |
| --- | --- | --- |
| 不填写，或 `systemOneAdapter` | TypeSafe `apiKey` | `jev-latest` |
| `openRouterAdapter` | OpenRouter `apiKey` | `~typesafe/jev-latest` |
| `vercelAdapter` | Vercel AI Gateway `apiKey` | `typesafe-ai/jev` |
| `cloudflareAdapter({ accountId })`（0.5.0+） | Cloudflare 账户 ID，API token 作为 `apiKey` | `typesafe/jev` |

客户端显式配置覆盖 adapter 的默认值，单次请求的 `model` 再覆盖客户端模型。自定义 adapter 同样可以提供 `defaultBaseURL` 和 `defaultModel`；只有没有默认地址的 adapter 才需要调用方填写 `baseURL`。需要账户或租户的地址可以通过工厂生成，Cloudflare 就采用这种方式。

默认原生协议下，自定义地址按以下规则处理：

| `baseURL` | 默认协议 | 请求地址 |
| --- | --- | --- |
| 未设置 | TypeSafe-compatible | `https://api.typesafe.ai/v1/systemone` |
| `https://api.typesafe.ai` 或 `/v1` | TypeSafe-compatible | `/v1/systemone` |
| `https://custom.example/prefix/v1` | TypeSafe-compatible | `/prefix/v1/systemone` |

可以直接提供以 `/systemone` 结尾的完整接口地址。自定义路径前缀会被保留；只有没有路径的 API 根地址会补上 `/v1`。

## 可选 OpenRouter 适配器

需要 SDK 0.3.0 或更高版本；0.2.0 不包含此入口。

```ts
import { SystemOne, choice } from '@system-one-ai/sdk';
import { openRouterAdapter } from '@system-one-ai/sdk/adapters/openrouter';

const openrouter = new SystemOne({
  adapter: openRouterAdapter,
  apiKey: process.env.SYSTEM_ONE_API_KEY!,
});

const result = await openrouter.evaluate({
  state: '同一订单扣款两次，请退回重复扣款。',
  questions: {
    department: choice('由哪个团队处理？', {
      billing: '付款与退款',
      support: '软件故障',
    }),
  },
  providerOptions: { openrouter: { session_id: 'my-agent-session' } },
});

console.log(result.answers.department.choice); // 'billing' | 'support'
console.log(result.providerMetadata?.openrouter); // 服务端提供的 generationId、provider、cost
```

实际调用 `POST /api/alpha/decisions`，不使用 Chat Completions。适配器转换 `boolean` / `noul`，保留原始概率、confidence 并归一化 token 字段。`~typesafe/jev-latest` 开头的 `~` 是模型 ID 的一部分；裸 `jev-latest` 属于 TypeSafe 直连命名，适配器不会自动重写。显式模型名原样发送，实际解析的模型放在 `result.model`。

`baseURL` 支持站点根地址、`/api`、`/api/v1`、`/api/alpha` 或完整 `/api/alpha/decisions`。这些根路径别名仅在显式选择此适配器时转换，自定义代理前缀会保留。核心入口不导入该适配器，也不增加供应商 SDK 依赖。

`providerOptions.openrouter` 支持 API 原生字段 `provider`、`session_id`、`trace`、`user`。未知字段会被拒绝，不能覆盖 model、questions、state。应用标识可通过标准 `headers` 设置 `HTTP-Referer` 和 `X-OpenRouter-Title`。此接口属于 alpha 协议，来源和实测结果见 [OpenRouter 接入与联调](docs/openrouter.md)。

真实联调使用独立 `.env.openrouter`：

```dotenv
SYSTEM_ONE_API_KEY=your-openrouter-key
```

```sh
npm run test:live:openrouter
```

命令直接读取该文件，不受父进程环境变量覆盖；发出四次真实推理请求，不重试，然后回查 OpenRouter 的 generation 记录。端点、时间、generation ID、答案、用量、费用保存在 `.artifacts/live-openrouter.json` 和带时间戳的报告中，不包含密钥或鉴权头。

推理已成功但暂时未查到 generation 记录时，可以只核对原 ID，不重新发起推理：

```sh
node scripts/test-openrouter-live.mjs --verify-only
```

`npm run example:openrouter` 会用同一环境文件运行 `examples/openrouter.ts`。真实命令会产生 API 用量；普通测试保持离线。

## 可选 Cloudflare 适配器（0.5.0+）

```ts
import { SystemOne, booleanQuestion } from '@system-one-ai/sdk';
import { cloudflareAdapter } from '@system-one-ai/sdk/adapters/cloudflare';

const cloudflare = new SystemOne({
  adapter: cloudflareAdapter({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID! }),
  apiKey: process.env.CLOUDFLARE_API_TOKEN!,
});

const result = await cloudflare.evaluate({
  state: '请退回重复扣除的钱。',
  questions: { refund: booleanQuestion('用户是否请求退款？') },
});
console.log(result.answers.refund.probability);
```

工厂自动生成账户地址并选用 `typesafe/jev`。实现模型页的 REST 协议：`POST /client/v4/accounts/{accountId}/ai/run`，请求体为 `{ model, input: { state, questions } }`。适配器将 `boolean` 映射为原生 `noul`，保留概率和 confidence，并统一 token 用量字段。需要代理时，`baseURL` 可覆盖为 API 根地址或以 `/ai/run` 结尾的代理端点；显式模型名原样发送。

此入口通过现有 Fetch transport 调用 REST API；Workers 原生 `env.AI.run()` binding 是另一种接口。没有新增 Cloudflare SDK 依赖，现有 `decisions`、`policies`、`batch` 模块可直接复用。

```sh
cp .env.cloudflare.example .env.cloudflare
# 填写 CLOUDFLARE_ACCOUNT_ID 和 CLOUDFLARE_API_TOKEN，然后：
npm run example:cloudflare
npm run test:live:cloudflare
```

主动运行联调命令会发出三次真实请求，不重试，脱敏报告保存在 `.artifacts/`。该命令需要 Cloudflare 凭据，普通测试和 CI 不会调用。协议 fixture 和本地 HTTP 测试不代表已取得真实账户访问权限。完整契约和验证范围见 [Cloudflare 接入文档](docs/cloudflare.zh-CN.md)（[English](docs/cloudflare.md)）。

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

`npm run example:decisions` 运行上面的文件归档流程，`npm run example:support` 运行持久化工单流程，两者直接读取所选供应商的本地配置文件。`npm run example:uncertainty` 将不明确请求交给应用回调，`npm run example:batch` 以有界并发评估三个独立代码片段；这两个示例读取 `.env`。没有 `SLOW_THINK_URL` 时，转交示例只返回待转交状态，不调用慢模型。

`npm run test:live:composition` 直接读取 `.env`，成功路径发出三次真实请求且不重试，将脱敏后的当前报告及时间戳报告写入 `.artifacts/`。它验证动态动作解析、概率策略及异构批量评估，不调用慢模型服务。

`npm test` 保持离线，覆盖协议、取消、超时、重试、错误和真实本地 HTTP；`npm run typecheck` 检查 TypeScript 类型推断。打包测试会将 tarball 安装到独立临时项目，验证 ESM/CJS 的核心及可选入口、两种模块的声明解析，并确认核心加载时不包含 Vercel 模块。

`npm run check` 还会执行 `test:scenarios`，编译业务示例并通过离线模型 fixture 验证真实本地执行器。`test:live:decisions` 是独立的主动联调命令，CI 不会调用付费模型。

官方 API 联调使用单独的命令，读取当前项目的 `.env` 并发出四个真实请求：

```sh
npm run test:live
```

它验证中文行为决策、退款分类、评分、真假判断，以及字符串、对象、数组状态；成功结果写入 `.artifacts/live-typesafe.json`。该命令会产生实际 API 用量，默认不重试。输出包含答案、用量和耗时，不包含 API key 或鉴权头。本次真实验证结果见 `docs/validation.md`。

设计和来源见 [docs/design.md](docs/design.md)；Jev 与 API 调研见 [docs/jev-api.md](docs/jev-api.md)；实际验证记录见 [docs/validation.md](docs/validation.md)。

## CI 与发布

推送到 `main` 或创建 Pull Request 时，GitHub Actions 会在 Node.js 20、22、24 上检查类型、离线测试、构建及实际安装包。推送 `v0.4.0` 这样的版本标签会触发发布：先用 npm Trusted Publishing 发布已验证的包，再创建 GitHub Release，附上同一安装包及校验文件。预发布版本使用 npm 的 `next` 标签。

一次性可信发布配置、版本操作和失败重跑方法见 [发布说明](docs/releasing.md)。CI 和发布工作流不会执行付费模型联调。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
