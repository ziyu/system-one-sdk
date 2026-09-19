# SDK 设计

## 目标

调用方只围绕状态、问题和结果编写业务逻辑。地址、凭据、模型及协议转换集中在客户端配置。应用显式选择适配器和 transport，未来兼容服务无需修改业务函数。

## 分层

完整包职责与依赖图见[包边界](architecture-plan.zh-CN.md)。运行时只存在于 `packages/`，根目录是私有 workspace。core 定义契约、生成请求快照并校验结果；adapter 负责协议转换；transport-fetch 负责鉴权和网络生命周期；decisions、policies、batch 通过 `EvaluationClient` 组合业务能力。

每个 adapter 都独立打包，core 不导入任何具体实现。客户端必须显式传入 adapter 与 transport。LLM 保持一个 adapter 包，不拆分 provider 层。运行时代码不依赖 Node API；环境变量和密钥读取只出现在示例和联调脚本中。

## 统一接口与供应商差异

公共真假原语用 `boolean`，TypeSafe codec 映射原生 `noul`。Choice 的候选项键会传递到 TypeScript 的答案联合类型；Score 保留连续评分；概率均不做阈值化。

选择和评分的概率分布、confidence 都是可选字段，以兼容将来能力不同的供应商。存在的值需要通过校验；没有的值保持缺省。供应商原始 metadata 会保留。业务不应假定所有供应商的置信定义相同。

`SystemOneAdapter` 声明支持的原语，把请求编码成 JSON、把响应映射成 `ProviderResponse`。公共 transport 拥有网络生命周期。新的鉴权头可通过 `authenticate` 定义，跨 origin 请求会被阻止。

四个原生决策 adapter 提供 `defaultBaseURL` 和 `defaultModel`，正常使用不需要显式填写地址和模型。客户端 `baseURL`/`model` 是可选覆盖，单次请求模型优先级最高。自定义 adapter 可按相同约定提供默认值。Cloudflare 使用 `cloudflareAdapter({ accountId })` 工厂建立账户配置快照；账户专属信息保留在 adapter 内，不在通用客户端增加供应商字段。原生问题编码由 `protocol-system-one` 中的 `nativeQuestions` 共用。

Cloudflare 按 Jev 模型页使用 `/ai/run` 与 `{ model, input }`，不猜测或轮询备用端点。当前覆盖 REST 调用，未封装 Workers 原生 binding。完整契约和来源见 [Cloudflare 接入文档](cloudflare.zh-CN.md)。

## 调用生命周期

客户端先验证输入并制作快照，再选择模型和编码请求，之后解析凭据并发出请求。这样，外部代码在异步等待期间修改原输入不会改变本次推理的实际请求或校验依据。

一次调用只有一个总期限；所有尝试、退避和 body 读取共用取消信号。用户取消与超时返回不同异常。即使注入的 Fetch 忽略信号，也会结束 SDK 等待；SDK 无法强制终止用户自定义函数的内部副作用。原生 Fetch 会接收到 AbortSignal。

成功响应以流方式计数字节并解码 UTF-8，超过上限或格式错误立即失败。失败清理不等待可能挂起的取消回调，也不覆盖原异常。重试只处理明确的暂时性错误，不会偷偷更换模型或制造结果。

## 验证与发布

协议 fixture 来源于官方契约。Vercel 固定请求格式曾与 `@ai-sdk/gateway@4.0.85` 对照通过，当前回归直接验证该格式，不再安装 Gateway SDK。真实本地 HTTP 测试覆盖原生 Fetch。类型测试包含负面断言，防止宽化为任意字符串或恢复已移除的核心导出。

构建生成两套独立模块及声明：ESM 与 CommonJS。打包测试在临时消费项目安装真实 tarball，并检查两种模块的核心及可选入口运行、加载边界和 TypeScript NodeNext 声明解析。运行时零第三方依赖；开发依赖包含 TypeScript、Node 类型声明，以及仅供浏览器案例使用的 Playwright。浏览器执行器位于 examples 中，不由 SDK 入口加载。

`npm run test:live` 单独发出四组真实原生请求，正常测试不会读取密钥。联调保存经过 SDK 校验的答案、用量和耗时，结果是接口连通性与小样本语义检查，不代表大规模质量或性能评测。

`npm run test:live:openrouter` 读取独立 `.env.openrouter`，使用原生 Fetch 包装记录实际地址、时间和非敏感响应头。四个 POST 完成后用同一密钥 GET `/api/v1/generation?id=...`，核对 ID、模型、提供商、`api_type`、原生 token 数和费用。支持 `--verify-only` 仅回查已有 ID，避免因记录暂不可用而重复推理；初始失败报告与后续成功报告分别保留。

核心客户端关注一次状态评估。独立的 `decisions`、`policies`、`batch` 包提供通用组合层，依赖结构化 `EvaluationClient` 接口，核心不加载这些模块。动作执行器、Agent 循环、聊天生成和慢思考服务由应用显式接入。公共接口、快照边界、概率语义和批量取消行为见 [组合模块契约](composition.zh-CN.md)。
