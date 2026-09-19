# 验证记录

本文件保留当前 workspace 验证及历史 SDK 发布记录；不同版本的真实请求分别记录。

## 2026-09-19 已发布 RC 的安装与真实模型验收

11 个独立包均已发布 `0.6.0-rc.0`，`next` 指向本批 RC；源码为 `09d4a2ead1e26dbc9804468b267303e6dd8ca22e`（[Release PR #3](https://github.com/ziyu/sytem-one-sdk/pull/3)）。[Release 工作流第 3 次执行](https://github.com/ziyu/sytem-one-sdk/actions/runs/35430490022)成功：构建和冻结产物、Node 20/22/24 消费检查、registry 完整性与 ESM/CJS/声明验收通过，生成 11 个逐包 prerelease。各 release 附有原始 tarball、manifest、checksums 和 registry 验证报告，例如 [core RC](https://github.com/ziyu/sytem-one-sdk/releases/tag/core-v0.6.0-rc.0)。

发布后的真实测试从公共 npm registry 匿名安装这批包到仓库外的消费项目，再读取本地配置调用服务；报告确认 `fromRegistry: true`，结束时间为 `2026-09-19T08:16:03.980Z`。TypeSafe `jev-1.13.0` 的 7 次调用覆盖 choice、score、boolean、decisions、policies、batch；DeepSeek `deepseek-flash` 的 2 次调用覆盖 probabilities 与 discrete。9 次均 HTTP 200，无重试，语义与结果结构断言通过。Cloudflare 验证范围仍为 workerd fixture；本轮未实测其他外部供应商。

复现命令（在该发布源码的干净 checkout 中使用原始 manifest）：

```sh
node scripts/test-release-live.mjs /path/to/typesafe.env /path/to/llm.env --registry
```

本地脱敏完整报告与原始产物位于 `.artifacts/rc-release/`，未公开上传模型报告或凭据。真实测试与 CI registry 报告绑定同一 manifest SHA-256：`586285fee00f41e0466acddddcc82f712441f525e01d3795cafb780913904696`。

首次创建包时尚不能预配置 Trusted Publisher，因此本批使用已验证的 CI tarball 完成一次本地 bootstrap，SHA-512 与清单一致；这次上传没有 npm provenance。随后 11 个包均已配置并回读 GitHub Trusted Publisher（`ziyu/sytem-one-sdk`、`release.yml`、`npm` environment）。成功重跑核验并复用已存在版本，没有再次上传；后续新版本的 OIDC 上传仍需首次执行验证。首次 metadata 可见早于安装索引，曾导致 registry 安装 404；索引同步后原批次恢复成功。

npm 为首次创建的包自动添加了 `latest`，即使上传指定 `next`。清理时用户两次成功完成安全密钥认证，但 npm 11.17.0 的 `npm dist-tag rm @system-one-ai/core latest` 均被 registry 以 HTTP 400 拒绝；捕获的正文仅为 `Request failed with status code 400`，未给出具体原因，不能归因为登录失效，也不能据此断言 npm 永久禁止删除 `latest`。停止重复认证和删除重试。`2026-09-19T09:17:11.213Z` 回读确认 11 个包的 `next` 与自动 `latest` 都仍为 `0.6.0-rc.0`；无标签或 `@latest` 安装也会选择 RC。脱敏阻塞记录保存在 `.artifacts/rc-release/rc-dist-tags.json`。稳定版未发布，标签清理仍受服务端错误阻塞。

旧 `@system-one-ai/sdk@latest` 保持 `0.5.3`，没有 deprecation。GitHub `npm` environment 已创建，但尚未配置审批保护；稳定发布前需完成保护设置和 dist-tag 鉴权验收。

## 2026-09-19 规范发布流程与 RC 产物演练

Changesets 2.31.1 在仓库外的临时 checkout 实际生成 11 个 `0.6.0-rc.0` 包、逐包 changelog、内部 RC 依赖、lockfile 和批次清单；退出预发布模式后生成 `0.6.0` 及稳定依赖。演练候选提交为 `6630425a01012dfdcafdbb73ed4e274f592db0f5`，属于临时仓库，不是远端已发布 tag。主工作区保留初始 changeset，由 Release PR 正式生成版本。

使用 Node 24.21.0 / npm 11.17.0 构建并冻结同一批 tarball：230 项回归、13 项场景、类型检查和 ESM/CJS 构建通过；11 个包在 Node 20.20.2、22.23.2、24.21.0 分别隔离安装，ESM/CJS 契约与声明推导检查全部通过。Wrangler 4.135.0 的真实生成类型与 workerd 的 8 项场景也通过，使用的仍是这批固定 tarball。GitHub Actions 配置通过 actionlint 1.7.12。

发布离线测试覆盖整批预检、依赖顺序、中途失败后的幂等续跑、已发布依赖使用 registry 原始摘要、最低兼容依赖、RC 范围、循环依赖、版本/仓库/锁文件保护、失败时禁止稳定 tag 提升，以及不降级已有 latest。演练另外实测篡改 tarball 被拒绝、dry-run 清单不能发布。

实际从上述 tarball 安装到仓库外的消费项目，再使用主分支 `.env` 和用户提供的 LLM 文件调用真实服务：

| 服务 | 请求 | 结果 |
| --- | --- | --- |
| TypeSafe `jev-1.13.0` | 4 项 choice/score/boolean + 3 项 decisions/policies/batch | 7 次 HTTP 200，无重试；已知语义、分布、评分和原对象映射断言全部通过 |
| DeepSeek `deepseek-flash` | probabilities、discrete | 2 次 HTTP 200，无重试；choice/boolean/score 断言全部通过 |

首次并发启动的 live 测试进程在输出结果前以 137 退出；单独重跑后上述 9 次调用全部通过。Cloudflare 仅验证 workerd fixture，未声称真实 Cloudflare 推理。GitHub 远端工作流、scope 发布权限和 OIDC 尚未实际执行；未发布 npm 包、推送或创建远端 tag。

完整候选包、清单、SHA256SUMS、脱敏模型报告与验证日志保存在 `.artifacts/release-rc.0-rehearsal/`；`release-live.json` 绑定候选提交、manifest SHA-256 和每个包的 SHA-512。密钥未写入源码、报告或 tarball。

## 2026-09-19 主分支配置的原生 System One 实测

配置直接读取主分支工作目录 /Users/ziyu/Work/projs/sytem-one-sdk/.env；测试执行的是当前拆分后的独立包。配置模型为 jev-latest，服务为 TypeSafe 官方接口，7 次响应均返回实际模型 jev-1.13.0、HTTP 200，均只尝试 1 次，未重试。

运行命令：

```sh
node scripts/test-live.mjs /Users/ziyu/Work/projs/sytem-one-sdk/.env
node scripts/test-composition-live.mjs /Users/ziyu/Work/projs/sytem-one-sdk/.env
```

| 用例 | 实际结果 | 验收 |
| --- | --- | --- |
| 中文倒水请求、紧急程度和打断判断 | drink 概率 1；普通请求评分 1；打断概率 0.96 | 通过 |
| 重复扣款分类 | billing 概率 1 | 通过 |
| Safari 导出故障且 Chrome 可用 | 有替代方案，评分 1，等级 1 概率 1 | 通过 |
| 关灯、开门真假判断 | 灯亮概率 0.01，门开概率 0.99 | 通过 |
| 动态动作和候选参数 | turn_on + desk，概率均为 1；映射原设备对象，仅桌灯状态变为 on | 通过 |
| 并发批量：关灯 | 灯亮概率 0.01，策略接受 false | 通过 |
| 并发批量：故障评分 | 评分 1.09；等级 1 概率 0.91、等级 2 概率 0.09，与加权均值一致 | 通过 |

基础用例完成时间 2026-09-19T05:55:29.603Z；组合用例完成时间 2026-09-19T05:56:16.641Z（UTC）。单请求耗时 331–1360 ms，合计 2601 input tokens + 267 output tokens = 2868 tokens。答案通过公共类型、概率分布、评分范围和舍入一致性校验，并额外断言了业务选择、评分最高概率等级和动态对象映射。

联调脚本支持显式 env 文件路径，未指定时读取本仓库 .env；文件配置不会被 shell 环境变量覆盖。新增语义断言与路径参数均通过此次真实调用验证，11 个包重新构建和 2 项架构检查通过。本次未修改运行时代码。

脱敏报告：.artifacts/live-typesafe-main-env.json、.artifacts/live-composition-main-env.json；配置与密钥未复制到仓库或写入报告。验证范围为上述 7 个用例，不是模型整体质量评测。

## 2026-09-19 独立包清理（未发布）

删除旧根目录 src、SDK 转导出、默认客户端、根包构建与发布入口。根目录改为私有 workspace；示例、类型测试、回归与联调脚本直接使用独立包。LLM 保持单包。旧 protocol 配置的迁移分支及对应旧 API 测试一并删除，新增根目录不能恢复运行时入口的架构检查。

在 Node.js v26.5.0 执行完整检查：类型、11 个包的 ESM/CJS 构建及示例编译通过；211 项回归和 13 项工作流测试全部通过。随后新增的根目录架构检查与依赖边界检查共 2 项通过；当前完整回归计 212 项。真实 Chrome 与本地 HTTP 的浏览器示例检查 7 项全部通过。无跳过项。

11 个真实 tarball 各自安装到仓库外的临时项目，只安装目标包的依赖闭包，ESM/CJS 契约及 NodeNext 声明检查均通过；所有类型推导和负面断言还在安装全部独立包的消费项目中，对 ESM/CJS 声明再次通过。11 个包的发布 tag、manifest 和 lockfile 配置校验通过，未实际发布。

使用用户指定的测试配置调用 DeepSeek deepseek-flash。每种环境分别测试 probabilities 和 discrete，两种模式均检查 choice、boolean 和 score 的已知答案。共 4 次真实请求全部 HTTP 200，均仅尝试 1 次：

| 环境 | UTC 时间 | 概率模式耗时 | 离散模式耗时 |
| --- | --- | --- | --- |
| workspace 独立包 | 2026-09-19T05:44:02.443Z | 1073 ms | 794 ms |
| 仓库外实际安装的 core + transport-fetch + adapter-llm tarball | 2026-09-19T05:45:26.290Z | 1030 ms | 872 ms |

第二组没有仓库 workspace 链接，只使用打包安装后的模块。脱敏结果保存在 .artifacts/live-llm.json、.artifacts/live-llm-installed.json；后者同时记录三个实际安装包的 SHA-512。构建、打包、浏览器日志为 .artifacts/check-modular.log、packages-modular.log、browser-modular.log。凭据和这些本地产物均不提交。

本轮真实外部验证仅覆盖所提供的 OpenAI-compatible Chat Completions 服务，未重新验证 TypeSafe、OpenRouter、Cloudflare、Vercel、OpenAI Responses 或 Anthropic 外部接口；对应协议仍有离线回归。以下为 2026-09-18 的旧 @system-one-ai/sdk 发布历史，不代表当前独立包已发布。


## 0.5.2 Cloudflare runner 修正

接纳原有未提交的 Cloudflare runner 修正，支持 REST `result` 内的 `{ state: "Completed", result: modelResult }`。审查时先用新增回归复现了两处遗漏：裸 runner 的顶层失败状态可能被解包跳过；内层同时存在答案和包装结果可能被接受。现在每层先校验，再解包，最多处理 REST 和 runner 两层。所有错误、非 Completed 状态及歧义结果都作为不重试的响应错误返回。

直接模型结果、普通 REST 包装继续兼容，原始答案、概率、评分、用量和实际模型 ID 仍由已有公共逻辑处理。决策组合、批量调度、本地 HTTP 及实际安装包检查均覆盖 runner 响应。本次检查确认项目和进程仍未提供 Cloudflare 凭据，因此未新增真实 Cloudflare 推理；下方历史真实结果保持原版本和时间。

发布前在 Node.js 26.5.0 执行 `npm run check`：严格类型检查、ESM/CommonJS 构建、示例编译通过，203 项 SDK 回归与 13 项业务执行器回归全部通过，0 失败、0 跳过；日志为 `.artifacts/check-0.5.2.log`。其中新增回归先在原修正上复现失败，再用逐层校验实现通过。安装包检查同时要求 Completed runner 正常解码、Failed runner 抛出响应错误，覆盖 ESM 和 CommonJS 两种入口。

## 0.5.1 变更范围

浏览器示例实现迁至 `examples/browser-use/`，命令入口仍为 `examples/browser.ts`，继续使用 `npm run example:browser`。相关导入、测试和新运行的源码摘要路径已同步。中英文 README 在安装说明之前新增能力与供应商矩阵，区分 SDK 入口、仓库示例及已有真实验证范围。

以下真实调用数据保留原始版本、时间和报告路径，不作为 0.5.1 新发起的模型请求。浏览器示例从仓库运行，npm 包继续提供核心及可选适配器、组合模块与文档。

## 真实浏览器示例验证（基于 0.5.0）

浏览器命令入口为 `examples/browser.ts`，实现现位于 `examples/browser-use/`。以下为目录改名前的真实调用记录：实际启动本机 Google Chrome `153.0.8010.48`，使用未登录的独立浏览器环境访问公开网站；页面响应来自网站，模型响应来自 TypeSafe / OpenRouter。所有输入、点击和页面跳转由 `defineDecision()` 结果驱动，最终 URL 和页面正文由独立检查器验收。没有用本地网页或模型 fixture 替换真实运行。

### 最终默认命令：MDN 搜索与文档导航

`npm run example:browser` 使用 TypeSafe；加 `--provider openrouter` 使用 OpenRouter。默认任务先打开 MDN 首页，目标为搜索 AbortController 并阅读其 abort() 方法文档。两次最终运行结束时，五个源码摘要均与当时源文件逐项核对一致。目录改名后，这些历史报告保留原路径和哈希；新的运行按新路径记录摘要。

| 项目 | TypeSafe | OpenRouter |
| --- | --- | --- |
| 最终验收 | 通过 | 通过 |
| 模型 | `jev-1.13.0` | `typesafe/jev-1.13-20260917` |
| 真实推理请求数 | 4，均 HTTP 200，无重试 | 4，均 HTTP 200，无重试 |
| 浏览器实际操作 | 点击导航搜索、填写查询、点击实时建议、结束 | 同左 |
| 单步 SDK 耗时（ms） | 1311 / 343 / 312 / 384 | 1177 / 271 / 316 / 351 |
| 记录时间（UTC） | 09:09:51.322–09:09:58.948 | 09:09:59.600–09:10:06.675 |
| 报告目录 | `.artifacts/browser-decisions-typesafe-0UT9ev/` | `.artifacts/browser-decisions-openrouter-l426ME/` |

最终页面均为 `https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort`。验收同时要求模型结束、MDN 正确 origin、实际输入和点击、多步模型调用、准确路径、正文包含方法名称和 Syntax 段落。页面标题、正文、截图和 Playwright trace 均保存。准确的目标 URL 没有交给执行循环，模型从浏览器实时搜索建议中选中该链接。

### 其他网站与开发中保留的失败

GitHub 搜索 cloudflare/agents → 打开仓库 → 进入 examples 目录曾分别在 TypeSafe 和 OpenRouter 上完成，每次 5 次模型调用。可查 `.artifacts/browser-decisions-typesafe-SuRuNQ/github-agents/` 与 `.artifacts/browser-decisions-openrouter-hxt8bY/github-agents/`。它们是开发过程中的成功记录，不冒充最终源码的整组复测。

| 实测问题 | 处理和保留证据 |
| --- | --- |
| MDN 的搜索按钮在开放 Shadow DOM 中，最初观察器没有发现 | 增加 Shadow DOM 遍历，原始失败保留在 `browser-decisions-typesafe-DzW4CX`、`browser-decisions-typesafe-XB29zU` |
| Github 较大页面请求返回 400 | 安全诊断只记录状态、请求大小 72849 字节和错误类别，确认为上下文相关；将候选默认上限改为 96，去掉完整控件描述的重复输入。原始失败保留在 `browser-decisions-typesafe-D6B4Cs` |
| 等价 MDN 搜索入口分散概率 | 补充导航区/对话框位置语义及通用选择优先级；没有修改模型概率或降低原来的 0.65 阈值 |
| 已显示合适搜索建议时，click 与 enter 分散概率 | 明确优先点击已显示目标，只有尚无目标时才提交搜索；失败记录 `browser-decisions-typesafe-poTiqj` 保留，最终两条接入复测通过 |
| npm 出现安全验证页（403） | `.artifacts/browser-decisions-typesafe-IBYEDq/npm-sdk/final.png` 保留实际页面；未绕过验证，npm 任务未算成功 |
| GitHub 后续显示 429 限流页 | `.artifacts/browser-decisions-openrouter-whuPIV/github-agents/05-before.png` 明确显示 Status: 429；该任务暂停并失败，未反复重开浏览器刷新冲击网站 |
| TypeSafe 中间一轮网络失败 | `browser-decisions-typesafe-ibb5Sp` 保留两次实际请求失败，未偷偷切换提供商 |

这些结果验证的是当前浏览器、网站和少量任务的实际集成，不是生产准确率或稳定性能承诺。早期失败、最后成功和离线 fixture 测试分别保存。Cloudflare 此轮没有真实推理凭据，未验证其浏览器流程。

### 回归与交付

`npm run check` 的 197 项 SDK 测试、13 项已有业务执行器测试通过，记录在 `.artifacts/check-browser-example.log`。新增 `npm run test:browser` 的 7 项真实浏览器回归全部通过，记录在 `.artifacts/test-browser-example.log`；这些回归明确使用离线模型 fixture，与上述真实网站请求分开。覆盖开放 Shadow DOM、隐藏/敏感输入、过期 DOM、实际表单提交和导航、错误完成声明、步数上限以及取消。最新示例编译通过，tarball 的 ESM/CJS 入口和声明安装检查通过。

每个任务目录有 `run.json`、`verification.json`、逐步截图、`final-page.txt` 和 `trace.zip`。用 `npx playwright show-trace <trace.zip>` 打开回放。Playwright 仅为浏览器案例开发依赖，SDK 运行时仍零依赖；当前只修改仓库示例和文档，未提交或发布新包。完整用法见[浏览器案例](browser-decisions.zh-CN.md)。

## 决策业务示例真实验证（基于 0.5.0）

新增文件收件箱归档与持久化工单示例，使用现有公开 decisions/policies API。业务文档和工单由示例生成，模型调用使用项目内现有 TypeSafe / OpenRouter 凭据和原生 Fetch；文件移动、字节校验及工单落盘是真实执行。没有连接生产客户系统。

### 真实反馈及修正

初测 TypeSafe 的主要用例 14/14、额外措辞 6/6 通过；OpenRouter 初测 19/20。失败用例是 `support-keep-priority`：动作和目标都正确，但“是否指定优先级”的附加真假问题返回 0.21，落在 0.2–0.8 的不确定区间，导致明确指令未执行。这个暂停被记为失败，没有当作通过。

随后将优先级表示为 `keep / normal / high / urgent`，直接表达修改操作。`keep` 保留原值，覆盖“没有要求改优先级”和“明确要求不变”。动作及参数仍使用原来的 `minProbability: 0.8`、`minMargin: 0.2`；没有降低阈值，也没有为单个用例替换结果。

### 最终同一组 20 条用例

| 项目 | TypeSafe | OpenRouter |
| --- | --- | --- |
| 实际模型 | `jev-1.13.0` | `typesafe/jev-1.13-20260917` |
| 真实请求 | 20 次，全部单次尝试 | 20 次，全部单次尝试 |
| 整体验收 | 20/20 | 20/20 |
| 明确指令（含 2 次等待） | 15/15 | 15/15 |
| 模糊、不支持、空集合请求 | 5/5 正确不改数据 | 5/5 正确不改数据 |
| 错误执行 | 0 | 0 |
| 重放检查 | 20/20，无新增推理或执行 | 20/20，无新增推理或执行 |
| SDK 端到端耗时 p50 / p95 / 最大值 | 288 / 405 / 925 ms | 354 / 771 / 1,203 ms |
| 输入 / 输出 tokens | 37,220 / 4,462，覆盖 20/20 | 37,220 / 4,462，覆盖 20/20 |
| 运行时间（UTC） | 07:34:24.071–07:34:30.841 | 07:34:30.967–07:34:39.974 |

每次验收同时核对模型选择及磁盘效果。明确命令返回不确定算失败；文件操作必须只移动指定文件、所有内容摘要保持一致；工单操作必须只改指定字段并增加一次版本号。未关闭工单与启用团队动态生成候选，重复请求 ID 不重复调用模型，相同 ID 换文本返回冲突。预期答案仅用于验收，没有进入模型请求。

### 保留的原始报告

| 阶段 | 报告 |
| --- | --- |
| TypeSafe 初测 14 条 | `.artifacts/live-decisions-typesafe-O9Q1nT/report.json` |
| TypeSafe 额外措辞 6 条 | `.artifacts/live-decisions-typesafe-fENV0F/report.json` |
| OpenRouter 初次 19/20 | `.artifacts/live-decisions-openrouter-R9W2n3/report.json` |
| TypeSafe 最终 20/20 | `.artifacts/live-decisions-typesafe-opjC0E/report.json` |
| OpenRouter 最终 20/20 | `.artifacts/live-decisions-openrouter-6MK48i/report.json` |

报告包含逐题原始答案、选中分支、策略、前后状态、真实请求跟踪、用量、失败和源码摘要。最终报告中的源码摘要已与当前对应源文件逐项核对。`holdout` 是预先划分的额外措辞组；本轮用于开发反馈后，不再视为独立统计留出集。

另外通过两个实际 npm CLI 命令各发出一次真实推理，并独立回读磁盘确认结果：文件例把 `document-c.txt` 移至 `archive/meetings/`；工单例把 T-101 分给 billing、设为 high、版本增至 1，其他工单不变。生成目录分别为 `.artifacts/decision-examples/files-w2voXg`、`.artifacts/decision-examples/support-PgDrje`，其中 `run-*.json` 保存模型和执行记录。

本轮含初测、修正后复测和两个 CLI 验收，共 82 次真实推理，无请求重试。最终结果是固定业务样例的集成验证，不代表生产任务准确率或稳定性能；延迟包含网络和客户端开销。Cloudflare 在此轮未进行真实调用。

### 回归验证

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 严格类型、双格式构建、197 项 SDK 测试与 13 项新增执行器测试均通过；`.artifacts/check-decision-workflows.log` |
| Node.js 20.20.2 | 合并运行 210 项，0 失败、0 跳过；`.artifacts/test-node20-decision-workflows.log` |
| `npm run test:package` | 实际 tarball 安装、ESM/CJS 全入口、NodeNext 类型与导入隔离通过 |
| 执行器边界 | 文件碰撞、推理中状态变化、重复 ID、保留优先级、低证据、候选更新、401、取消、非法文本均通过 |

完整使用方法与本地串行执行边界见[决策业务示例](decision-workflows.zh-CN.md)。本轮为仓库示例和验证补充，版本号仍为 0.5.0，未发布新版本。

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
