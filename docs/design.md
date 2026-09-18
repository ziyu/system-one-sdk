# SDK 设计

## 目标

调用方只围绕状态、问题和结果编写业务逻辑。地址、凭据、模型及协议转换集中在客户端配置。核心默认采用 TypeSafe Jev 原生兼容协议；其他协议显式传入适配器，未来兼容服务无需修改业务函数。

## 分层

| 模块 | 职责 |
| --- | --- |
| `src/types.ts` | 共享状态、问题、结果、适配器及调用选项的公共契约 |
| `src/questions.ts` | 简单问题构造器、字面量类型保留 |
| `src/client.ts` | 选择适配器、生成快照、组织一次完整调用和重试 |
| `src/adapters/system-one.ts` | 默认原生协议转换 |
| `src/adapters/vercel.ts` | 显式子路径导入的可选 Evaluation v4 适配器 |
| `src/adapters/openrouter.ts` | 显式子路径导入的可选 Decisions 适配器，保留 generation ID 和费用 |
| `src/transport.ts` | Fetch、鉴权、总期限、取消、受限读取及 HTTP 错误 |
| `src/validation.ts` | 输入与输出边界验证，概率和评分的一致性检查 |
| `src/errors.ts` | 调用方可以分支处理的稳定错误类型 |
| `src/decisions.ts` | 可选决策组合：候选快照、原对象映射、动作分支及具名参数证据 |
| `src/policies.ts` | 可选纯函数策略：分别处理概率、差值、置信统计量和真假接受区间 |
| `src/batch.ts` | 可选批量评估：有界并发、输入顺序、部分失败、取消和已报告用量 |

运行时代码不依赖 Node API。环境变量读取只出现在示例和主动运行的联调脚本中，不让共享 SDK 隐式读取宿主凭据。SDK 没有进程级全局配置，客户端之间不会共享请求状态。

主入口不引用 Vercel 或 OpenRouter 模块，不进行 hostname 自动识别，不保留 `protocol` 字符串选项。适配器差异只由 `adapter` 对象表达。可选适配器与核心一同打包，但仅在调用方显式导入相应的 `@system-one-ai/sdk/adapters/*` 子路径时加载。

## 统一接口与供应商差异

公共真假原语用 `boolean`，TypeSafe codec 映射原生 `noul`。Choice 的候选项键会传递到 TypeScript 的答案联合类型；Score 保留连续评分；概率均不做阈值化。

选择和评分的概率分布、confidence 都是可选字段，以兼容将来能力不同的供应商。存在的值需要通过校验；没有的值保持缺省。供应商原始 metadata 会保留。业务不应假定所有供应商的置信定义相同。

`SystemOneAdapter` 声明支持的原语，把请求编码成 JSON、把响应映射成 `ProviderResponse`。公共 transport 拥有网络生命周期。新的鉴权头可通过 `authenticate` 定义，跨 origin 请求会被阻止。

## 调用生命周期

客户端先验证输入并制作快照，再选择模型和编码请求，之后解析凭据并发出请求。这样，外部代码在异步等待期间修改原输入不会改变本次推理的实际请求或校验依据。

一次调用只有一个总期限；所有尝试、退避和 body 读取共用取消信号。用户取消与超时返回不同异常。即使注入的 Fetch 忽略信号，也会结束 SDK 等待；SDK 无法强制终止用户自定义函数的内部副作用。原生 Fetch 会接收到 AbortSignal。

成功响应以流方式计数字节并解码 UTF-8，超过上限或格式错误立即失败。失败清理不等待可能挂起的取消回调，也不覆盖原异常。重试只处理明确的暂时性错误，不会偷偷更换模型或制造结果。

## 验证与发布

协议 fixture 来源于官方契约。Vercel 固定请求格式曾与 `@ai-sdk/gateway@4.0.85` 对照通过，当前回归直接验证该格式，不再安装 Gateway SDK。真实本地 HTTP 测试覆盖原生 Fetch。类型测试包含负面断言，防止宽化为任意字符串或恢复已移除的核心导出。

构建生成两套独立模块及声明：ESM 与 CommonJS。打包测试在临时消费项目安装真实 tarball，并检查两种模块的核心及可选入口运行、加载边界和 TypeScript NodeNext 声明解析。运行时零第三方依赖，开发依赖仅保留 TypeScript 与 Node 类型声明。

`npm run test:live` 单独发出四组真实原生请求，正常测试不会读取密钥。联调保存经过 SDK 校验的答案、用量和耗时，结果是接口连通性与小样本语义检查，不代表大规模质量或性能评测。

`npm run test:live:openrouter` 读取独立 `.env.openrouter`，使用原生 Fetch 包装记录实际地址、时间和非敏感响应头。四个 POST 完成后用同一密钥 GET `/api/v1/generation?id=...`，核对 ID、模型、提供商、`api_type`、原生 token 数和费用。支持 `--verify-only` 仅回查已有 ID，避免因记录暂不可用而重复推理；初始失败报告与后续成功报告分别保留。

核心客户端继续关注一次状态评估。0.4.0 在独立的 `decisions`、`policies`、`batch` 子路径增加通用组合层，依赖结构化 `EvaluationClient` 接口，核心不加载这些模块。动作执行器、Agent 循环、聊天生成和慢思考服务由应用显式接入。公共接口、快照边界、概率语义和批量取消行为见 [组合模块契约](composition.zh-CN.md)。
