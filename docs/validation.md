# 验证记录

日期：2026-09-18。本文件按版本保留验证历史，当前开发版本为 `0.5.0`。npm 包名为 `@system-one-ai/sdk`；旧版记录不与新请求合并统计。

## Cloudflare 与默认配置增量验证（0.5.0）

新增 `@system-one-ai/sdk/adapters/cloudflare`，按账户 ID 生成默认 REST 地址和模型。原有 adapter 已支持默认地址，本轮精简示例与环境模板，并增加所有内置 adapter 的统一默认值及覆盖优先级测试。原生问题编码由内部 helper 复用，核心和组合 API 保持兼容。

| 检查 | 结果 |
| --- | --- |
| 严格类型检查、ESM/CJS 构建、示例编译 | 通过；包含 Cloudflare 工厂参数、可选入口和选择项联合类型 |
| Node.js 26.5.0 全量测试 | 197 通过，0 失败、0 跳过；`.artifacts/check-0.5.0.log` |
| Node.js 20.20.2 同一测试集 | 197 通过，0 失败、0 跳过；`.artifacts/test-node20-0.5.0.log` |
| tarball 独立安装 | ESM/CJS 全部入口、Cloudflare 模拟请求、NodeNext 声明和核心导入隔离通过 |
| 四个内置 adapter 默认配置 | 省略地址/模型可用；客户端覆盖和单次模型覆盖优先级通过 |
| Cloudflare 协议 fixture | `/ai/run`、`model + input`、原生原语、直接及 result 包装结果均通过 |
| 地址和失败语义 | 账户快照、错误账户/路径、非法配置/响应、HTTP 错误、Retry-After、取消与总期限通过 |
| 原生 Fetch 与本地 HTTP | 真实本地 server 验证完整请求、Bearer 鉴权和响应解码通过；未连接 Cloudflare |
| 组合能力复用 | 动态动作/参数和批量评估通过 Cloudflare adapter 的离线回归 |
| Cloudflare 真实推理 | 未执行：缺少 `.env.cloudflare`，配置阶段退出，推理请求数为 0 |

本轮新增 41 项运行时测试。`node scripts/test-cloudflare-live.mjs` 的实际诊断记录为 `.artifacts/live-cloudflare.json`，完成于 `2026-09-18T06:35:30.676Z`，错误类别为 `missing-config-file`，没有将 fixture 当作真实模型结果。脚本在凭据齐备时将发出三次真实请求、不重试，保留脱敏结果。

当前覆盖 Cloudflare REST 接口，未封装或验证 Workers 原生 `env.AI.run()` binding，也未在 Workers、浏览器、Bun、Deno 运行。本地安装包为 `.artifacts/system-one-ai-sdk-0.5.0.tgz`；本轮未提交、推送或发布 0.5.0。完整协议来源见 [Cloudflare 文档](cloudflare.zh-CN.md)。

## 通用组合增量验证（0.4.0）

新增独立的 `decisions`、`policies`、`batch` 入口，保留原有单次 evaluate、供应商适配器和错误语义。核心运行时继续零第三方依赖，不加载新增可选模块。

| 检查 | 结果 |
| --- | --- |
| 严格类型检查、ESM/CJS 构建、所有示例编译 | 通过；包含动作分支、原对象映射、具名参数答案、异构批次及负面类型断言 |
| Node.js 26.5.0 全量离线测试 | 156 通过，0 失败，0 跳过；日志 `.artifacts/check-0.4.0.log` |
| Node.js 20.20.2 同一测试集 | 156 通过，0 失败，0 跳过；日志 `.artifacts/test-node20.log` |
| tarball 独立安装检查 | ESM/CJS 的核心、适配器及三个新入口运行通过；NodeNext 声明与导入隔离通过 |
| 候选与参数 | 重复/空 ID、显式 none、快照、对象身份、原型敏感键、分支筛选和独立参数证据 |
| 策略边界 | 缺失证据、真假双区间、主动弃权、差值浮点边界、非法阈值及带访问器/空洞的数组 |
| 批量边界 | 并发上限、输入顺序、单项失败、输入/请求头快照、已取消/运行中取消、忽略信号的客户端、部分用量与溢出 |
| 新组合的供应商协议 | TypeSafe、Vercel、OpenRouter 三类协议离线回归通过；本次真实调用仅使用原生协议 |
| 真实组合联调 | 3 次请求全部 HTTP 200，均一次尝试；未调用慢思考服务 |

真实记录来自 `node scripts/test-composition-live.mjs`，脚本直接读取项目 `.env`，不受继承环境变量覆盖。完成时间 `2026-09-18T05:45:24.829Z`，模型均为 `jev-1.13.0`。当前记录为 `.artifacts/live-composition.json`，另保留带时间戳版本。

| 新场景 | 实际结果 | 端到端耗时 | 输入 / 输出 tokens |
| --- | --- | --- | --- |
| 动态动作与目标 | `turn_on`、`desk`，两者概率均为 1；解析对象身份检查通过并更新本地设备状态 | 925 ms | 496 / 66 |
| 批量项：真假判断 | P(lamp on) = 0.01，策略接受 false | 328 ms | 277 / 20 |
| 批量项：评分 | severity = 1.08，评分与舍入校验通过 | 617 ms | 316 / 17 |

这是少量连通性与组合行为验证，不是性能或任务质量评测。新示例已经编译；未配置 `SLOW_THINK_URL` 时，转交示例只报告待转交状态。Cloudflare Workers、浏览器、Bun、Deno 仍未做本次运行验证。

本地包版本已更新为 `0.4.0`，产物为 `.artifacts/system-one-ai-sdk-0.4.0.tgz`。本轮未执行 npm 发布或推送版本标签。

## OpenRouter 增量验证（0.3.0）

新增 `@system-one-ai/sdk/adapters/openrouter`，保持核心零依赖、供应商适配器显式导入。真实推理 4/4 HTTP 200，随后按相同 generation ID 从 OpenRouter 后台回查 4/4 成功；请求与记录中的模型、提供商、原生 tokens、费用一致。完整协议来源、时间、结果和 generation ID 见 [OpenRouter 联调记录](openrouter.md)。以下 0.2.0 表格保留原始历史验证，不与新请求混合统计。

| 0.3.0 检查 | 结果 |
| --- | --- |
| TypeScript 严格检查、双格式构建、所有示例编译 | 通过 |
| Node.js 26.5.0 离线测试 | 123 通过，0 失败 |
| Node.js 20.20.2 同一测试集 | 123 通过，0 失败 |
| 实际 tarball 独立安装 | ESM/CJS 原生、Vercel、OpenRouter 调用和声明检查通过 |
| 可选适配器边界 | 核心不导出或加载 OpenRouter / Vercel |
| OpenRouter 推理及后台记录 | 4 次 POST 成功，4 条记录回查匹配；未重复推理 |

0.3.0 本地安装包为 `.artifacts/system-one-ai-sdk-0.3.0.tgz`；本次功能开发未发布新的 npm 版本。

## 已执行

| 检查 | 环境 / 方法 | 结果 |
| --- | --- | --- |
| 严格类型检查 | TypeScript 5.9.3，含示例及正反类型断言 | 通过 |
| ESM / CommonJS 构建 | Node.js 26.5.0，npm 11.17.0 | 通过，生成 JS、声明及 source map |
| 全部运行测试 | Node.js 26.5.0，`npm run check` | 97 通过，0 失败，0 跳过 |
| 最低声明版本 | Node.js 20.20.2，同一套测试 | 97 通过，0 失败 |
| 示例编译 | `npm run examples:build` | 通过 |
| 安装实际 tarball | `npm run test:package`，独立临时消费项目 | ESM/CJS 核心及可选适配器的模拟请求均通过 |
| 核心加载边界 | 实际安装包的导出及 CommonJS 模块缓存 | 核心不导出或加载 Vercel 适配器 |
| 安装后声明解析 | 独立项目，TypeScript NodeNext，`.mts` 与 `.cts` | 可选子路径可解析；选择项联合类型保留；旧 protocol 参数被拒绝 |
| 官方真实请求 | `.env` 中的官方凭据，原生 Fetch | 4/4 返回 HTTP 200，无重试 |
| 实际示例调用 | `basic.ts`、`realtime-agent.ts` 编译后加载 `.env` | 两个示例均成功 |

## 官方真实联调

使用项目内 `.env`，执行 `node --env-file=.env scripts/test-live.mjs`。脚本通过构建后的 SDK 发出四个真实请求，全部返回 `jev-1.13.0`。原始成功记录位于 `.artifacts/live-typesafe.json`，完成时间为 `2026-09-18T02:19:30.182Z`。

| 场景 | 状态类型 / 原语 | 实际结果 | 端到端耗时 | 输入 / 输出 tokens |
| --- | --- | --- | --- | --- |
| 中文倒水请求 | 对象；Choice + Score + Noul | `drink`，评分 `1`，中断概率 `0.96` | 1,174 ms | 480 / 69 |
| 重复扣款退款 | 字符串；Choice | `billing`，选项概率 `1` | 296 ms | 369 / 38 |
| 有替代方案的软件故障 | 数组；Score | 评分 `1`，对应等级概率 `1` | 239 ms | 354 / 17 |
| 灯关着、门开着 | 对象；两个 Noul | 灯打开概率 `0.01`；门打开概率 `0.99` | 342 ms | 309 / 40 |

四组共用输入 1,512 tokens、输出 164 tokens，总计 1,676。每组均只发出一次请求，未使用重试、模型替换或模拟结果。SDK 检查了所有问题的答案类型、概率、评分范围及统计字段。

另外执行了两个示例的真实请求：`basic` 返回退款概率 `0.99`、部门 `billing`、紧急程度 `0.77`；`realtime-agent` 在其 1,500 ms 预算内选择 `drink`，选项概率 `0.89`。示例结果来自不同输入，不应与上表混合成同一次请求。

这些耗时包含客户端和网络开销，样本量仅四组，不代表模型本身的推理延迟、稳定性能或整体决策质量。离线报告和终端输出没有包含 API key 或 Authorization 头。

## 关键证据

`tests/vercel-adapter.test.mjs` 保留此前与 `@ai-sdk/gateway@4.0.85` 对照通过的请求格式，验证路径、JSON body、模型头、鉴权头和协议版本头。现在直接使用该固定格式，不安装官方 Gateway SDK。Vercel 模块只通过 `@system-one-ai/sdk/adapters/vercel` 导出。

`tests/transport.test.mjs` 启动本地 HTTP server，使用原生 Fetch 发送真实 HTTP 请求，确认 native System One body、Bearer 头和正常响应解码，并确认 307 重定向不会被跟随。

其余测试覆盖 TypeSafe / Gateway 字段转换、完整或带前缀的 API 地址、未来模型与自定义协议、输入快照、类型化选择项、非正常 JSON、错误概率、评分一致性、舍入、可选统计量、响应大小限制、超时、主动取消、重试和 Retry-After。

请求生命周期测试包含不响应取消信号的 Fetch、挂起的密钥解析、挂起或抛错的响应流取消，确认调用不会无限等待，清理失败也不会覆盖原始异常。

## 尚未验证

Vercel 没有进行真实模型调用。OpenRouter 原先没有进行 0.2.0 联调，现在已通过上方 0.3.0 的独立真实请求及后台记录验证。

Cloudflare Workers、浏览器、Bun 和 Deno 未做本次运行验证，也未开展大规模任务质量或并发性能评测。

发布目标为 `@system-one-ai/sdk@0.2.0`，公开访问、MIT 许可证。可安装的本地产物为 `.artifacts/system-one-ai-sdk-0.2.0.tgz`。npm 发布状态以 registry 查询结果为准。
