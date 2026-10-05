# 验证记录

本文件保留当前 workspace 验证及历史 SDK 发布记录；不同版本的真实请求分别记录。

## 2026-10-05 撤销未发布的全量批次，改为选择性发布

用户明确要求只升级有改动的包。原 Release run `37218048854` 已在上传等待审批时取消并拒绝 deployment；逐包查询确认原 16 个候选版本均不存在于 npm，`latest` 未改变。已撤销未发布的版本生成提交，保留多模态实现；旧 16 包 manifest 和产物作废，不得重跑上传。

本次明确选择 8 包：core、Cloudflare、local、decisions、evaluation 的实现/类型变化；batch 使用新增图片快照；protocol-system-one、transport-fetch 必须和新 core 共享错误类型身份。后三个依赖契约更新进入 `0.7.0`，避免作为 `0.6.x` patch 被旧客户端自动安装。未改动的 LLM、OpenRouter、TypeSafe、Vercel、WebGPU、Laya、ONNX、policies 恢复原已发布版本、依赖范围、changelog，并撤回附带的非必要元数据改动。

版本脚本只应用显式 changeset 条目，未选包 manifest 必须逐字节不变；冻结发布清单保存前后版本和变更原因，prepare/verify 拒绝无范围依据的上传。消费者按各自兼容依赖图测试，历史依赖安装 npm 已发布字节，而不是为了让全仓使用同一 core 而全量发版。真实 Changesets 场景及范围拒绝、registry 依赖隔离的 13 项针对性测试通过。

Node `24.19.0` 的完整选择性演练在 `/var/folders/dg/6z94gr516x7fssvd7_5w7_8h0000gn/T/system-one-release-e89gRj` 完成：只生成 8 包，282 项回归、13 项业务场景通过，16 个 workspace 根按新旧两个兼容图进行 ESM/CJS/声明安装验证，最终只冻结 8 个上传产物。篡改产物被拒绝，未选包 manifest/changelog 与已发布基线 `ccf1cfa` 逐字节相同。

同一候选产物通过 Wrangler 生成类型和 9 项 workerd fixture 场景；隔离安装后 TypeSafe 7 次、Clef/Clef Flash 7 次真实调用全部通过且不重试。TypeSafe adapter 和 policies 使用未升级的 npm 已发布版本，不纳入上传清单。演练源码为 `f921a101b4426cc0d4ecbb8c70029ff8ebe35987`，真实报告位于该目录 `.artifacts/release-live.json` 与 `release-cloudflare-live-candidate.json`；正式 CI 与 registry 验收仍分别执行。

Release PR #25 的干净 CI 安装暴露了源码测试混用 core 0.6/0.7 副本的错误身份问题；初轮演练仅刷新 lockfile、保留旧 workspace 链接，因此遗漏。现在演练在版本生成后重新 `npm ci`，源码集成用测试专用 workspace ESM resolver；隔离 tarball/registry/workerd/live 消费者不加载 resolver，额外保留 local、protocol、transport、policies 的错误身份断言。没有升级未改动包或改动运行时代码。新的 Node 24.19.0 演练 `/var/folders/dg/6z94gr516x7fssvd7_5w7_8h0000gn/T/system-one-release-jp4p0Z` 从干净安装通过 282 项回归、13 项场景、两个兼容图及 8 包冻结/篡改验证；独立 smoke 确認历史 core 确实安装且源码测试身份正确。

## 2026-10-05 多模态发布前审查与演练（16 包计划已撤销）

发布前审查复现了旧包 `repository.url` 仍为 `ziyu/sytem-one-sdk`、而发布 guard 要求 `ziyu/system-one-sdk` 的元数据不一致。修正 10 个旧包的规范仓库 URL，并将对应元数据更新纳入 changeset；没有放宽发布校验。

明确固定 Node `24.19.0` / npm `11.17.0` 后，`scripts/test-release.mjs` 在临时仓库完成 Changesets 版本生成、类型/构建、278 项回归、13 项业务场景、16 包隔离 ESM/CJS/声明验证、候选产物冻结及篡改拒绝检查。core / Cloudflare / decisions 生成为 `0.7.0`，local / evaluation 为 `0.2.0`；其余依赖包同步 patch 更新，合计 16 包，图片依赖的 core 最低版本为 `^0.7.0`。工作区版本由后续 Release PR 正式生成，不在本机手改。

同一已打包产物另通过 Wrangler 4.135.0 的生成类型及 9 项 workerd 场景。此前通过 mise 启动 npm 的子进程实际选到了 Node 26，Wrangler 类型生成后未及时退出；该次不能记作 Node 24 验证。后续用明确 PATH 和 Node 二进制执行，上述检查通过。真实 binding 的权限限制仍保持记录。

从候选 tarball 隔离安装后，再完成 Clef/Clef Flash 7 次图片、批量、决策、评测调用及 TypeSafe 7 次原生/组合调用，全部通过且不重试。报告绑定临时演练源码 `9908a2da5bae8d47e61d6167ff2ef5369c339570`、manifest 摘要及每包 integrity，位于演练目录的 `release-cloudflare-live-candidate.json` 和 `release-live.json`。这些是本机候选验收；正式 CI 产物和 registry 安装仍须各自验证。

## 2026-10-05 Clef / Clef Flash 真实多模态验证

使用用户新增到本仓库 `.env` 的 Cloudflare 账户 token 和 TypeSafe API key，运行的是当前 SDK 构建，不是直接调用 API 绕过 SDK。真实请求时间为 UTC `2026-10-04T15:59:36Z` 至 `16:09:07Z`；Node.js `26.10.0`。没有修改 `.env`、发布包、部署 Worker 或关闭 TLS 校验。

| 服务 | 实际推理请求 | 结果 |
| --- | --- | --- |
| Cloudflare Clef | 13 | 全部 HTTP 200，单次尝试、无重试；输入 token 合计 6701，输出 0 |
| Cloudflare Clef Flash | 11 | 全部 HTTP 200，单次尝试、无重试；输入 token 合计 5774，输出 0 |
| TypeSafe `jev-1.13.0` | 7 | 4 项原生文本场景及 3 项决策/策略/批量兼容场景全部通过，无重试 |
| 真正 Workers `env.AI` | 0 | Wrangler remote binding 会话认证被权限阻塞，不能计为真实 binding 通过 |

Cloudflare 的 24 次推理覆盖：文本 choice/score/boolean；512×512 白底红/蓝方块的 PNG、JPEG、WebP；对象 `{ mediaType, base64 }` 和三种格式 data URL；四图输入及首尾顺序；空字符串 state 的图片任务；异步 API key 等待期间修改原图片不影响实际请求；排队批量快照、并发批量；图片驱动的 `defineDecision`、候选对象身份及概率策略；`runEvaluation` 的文本/JSON 状态变体保持图片。4 个评测结果均符合已知颜色标签。另验证远程 URL、5 张图片、单图/总字节超限、Jev 图片输入、旧供应商图片参数、预取消共 7 种本地拒绝，网络请求数为零。

首轮红方块混合问题中，Clef 返回 red 概率 `0.9924`、redness `1.9768`；Flash 为 `0.9674`、`1.9444`。JPEG 红图、WebP 蓝图及四图顺序均与已知样本标签一致。所有回答经过 SDK 原生解码、概率/评分及用量校验，没有修改答案或放宽验证。该小样本只证明接口与基本图像语义跑通，不代表业务图片准确率或延迟基准。

真实命令包括 `node scripts/test-live.mjs .env`、`node scripts/test-composition-live.mjs .env` 及临时多模态 runner；本次均使用进程内 DNS 预加载脚本。默认 DNS 最初解析到异常地址，未携带凭据的连接出现自签名证书/重置；改用进程内 `1.1.1.1` / `8.8.8.8` 解析后保留原生 Fetch 与完整 TLS 校验。没有修改系统 DNS、证书或 SDK 网络实现。临时 runner 与 DNS 脚本在完成后删除。

Workers 权限证据：账户级 `/accounts/{id}/tokens/verify` 返回 active，`/workers/scripts` 返回 200，但 `/workers/subdomain` 返回 403 / code 10000；Wrangler 4.135.0 明确报告 remote session 无法认证。用户级 `/user/tokens/verify` 对该账户 token 返回 401，不能据此认定账户 token 失效。需补充 Workers 开发/预览所需权限后完成原生 binding 真推理。未用 REST 包装伪装 `env.AI`，也未创建公开 Worker。

本轮 `npm run typecheck`、278 项回归、示例编译及 13 项业务场景全部通过。`node scripts/test-cloudflare-workers-runtime.mjs` 在优先 npm 缓存的环境下完成安装包 ESM/CJS、Wrangler 生成类型和 9 项 workerd 场景；这些仍是可控推理 fixture，与上述真实 REST 分开记录。未发现需要修改 SDK 的缺陷。

脱敏证据保存在 `.artifacts/live-multimodal-summary.json`、`.artifacts/live-clef-features.json`、`.artifacts/live-clef-representations-2026-10-04T16-09-00-932Z.json`、两份 `probe-clef*.json`、`.artifacts/live-typesafe.json`、`.artifacts/live-composition.json` 和 `.artifacts/live-cloudflare-workers-blocker.json`。包含真实请求 ID、时间、模型、原始响应/规范化答案、token 与结果；不包含 token、账户 ID、Authorization 或图片 base64。图像样本及 SHA-256 可用于复核，报告未上传公共服务。

## 2026-10-04 core 原生多模态契约修正

将图片提升为 core 的 `EvaluateRequest.images`，导出供应商无关 `ImageInput`（data URL 或 `{ mediaType, base64 }`）。core 校验表示、base64 并生成快照，`supportsImages` 未声明的 adapter 在 prepare/鉴权/transport 前拒绝非空图片。Cloudflare 只做 Clef 格式/数量/大小限制及原生 `content_type` 转换；上轮未发布的供应商图片入口和类型已移除，没有兼容别名。

`defineDecision` 的请求白名单、`runEvaluation` 的状态变体请求构造已迁移；`evaluateMany` 通过 core 快照保留图片；本地 runner 可显式声明 `supportsImages: true`。没有更改 Jev 默认值，也没有伪造音频/视频接口。

Node.js `26.10.0` 上实际验证：

| 命令 / 场景 | 结果 |
| --- | --- |
| `npm run typecheck` | 16 包 ESM/CJS 构建、核心/供应商/组合类型与示例检查通过 |
| `npm test` | 278 项通过，包括 core 非法图片拒绝、未声明能力拒绝、队列图片快照及本地纯文本 runner 拒绝 |
| `node node_modules/typescript/bin/tsc -p tsconfig.examples.json` 与 `node --test tests/examples/*.test.mjs` | 示例编译、13 项业务场景通过 |
| 临时原生图片 smoke，已删除 | 5 次原生 Fetch 本地 HTTP 请求通过；覆盖异步鉴权期间图片不变、Clef/Flash 批量、状态变体保留图片、纯文本 adapter 在 I/O 前拒绝、Workers 决策组合、本地视觉 runner 快照，以及 core 不施加 Clef 的格式/数量限制 |
| `node scripts/test-package.mjs` | 16 个包隔离安装 ESM/CJS 契约和声明检查通过 |
| `env npm_config_prefer_offline=true npm_config_fetch_retries=0 npm_config_fetch_timeout=20000 node scripts/test-cloudflare-workers-runtime.mjs` | 安装包、Wrangler 生成 `Env.AI` 类型及 9 项 workerd 场景通过，Clef 场景使用 core 原生 `images` |
| 临时 Changesets 版本演练，已删除 | 在临时目录应用本次 changeset，确认 core 生成 `0.7.0`，Cloudflare/local/decisions/evaluation/batch 的 core 依赖均生成 `^0.7.0`；工作区版本、锁文件及发布状态未改变 |

推理响应均来自本地协议 fixture，不是托管模型。上轮已确认缺少 `.env.cloudflare` 和凭据，本轮未重复发起 live 检查；真实推理、图片语义、延迟和计费仍未验证。

## 2026-10-04 Cloudflare Clef 初版适配验证（已被上方 core 契约取代）

初版按 Cloudflare [Clef](https://developers.cloudflare.com/workers-ai/models/clef/) 的公开 schema 接入 REST 与 Workers，当时图片仅通过供应商参数透传、未扩展 core。该未发布设计已被上方原生 `images` 契约取代；以下保留初轮执行证据，不是当前调用指南。

本地环境 Node.js `26.10.0`，实际执行结果：

| 命令 / 场景 | 结果 |
| --- | --- |
| `npm run typecheck` | 16 个 workspace 包的 ESM/CJS 构建、类型及示例检查通过 |
| `npm test` | 275 项通过，包含 Clef REST 契约、图片拒绝边界及 binding 图片快照/重试隔离 |
| `node node_modules/typescript/bin/tsc -p tsconfig.examples.json` 与 `node --test tests/examples/*.test.mjs` | 示例编译和 13 项业务场景通过 |
| 临时 smoke 脚本，已删除 | 原生 Fetch 访问真实本地 HTTP server，分别完成 Clef / Clef Flash 图片请求；另完成原生 binding 客户端图片调用，三种问题答案、概率精度与 token 用量通过断言；上游响应均为本地 fixture |
| `node scripts/test-package.mjs` | 16 个包隔离安装的 ESM/CJS 契约与声明检查通过 |
| `env npm_config_prefer_offline=true npm_config_fetch_retries=0 npm_config_fetch_timeout=20000 node scripts/test-cloudflare-workers-runtime.mjs` | 安装包 ESM/CJS、Wrangler 生成的真实 `Env.AI` 类型与 9 项 workerd 场景通过，包括 Clef 图片及重试隔离；无 `nodejs_compat` |
| `node scripts/test-cloudflare-live.mjs` | 配置阶段 `missing-config-file`，0 次推理请求；脱敏报告在 `.artifacts/live-cloudflare.json` |

Workers 验证首次安装 Wrangler 4.135.0 时达到脚本 180 秒 npm 子进程期限；确认 registry 可访问并优先使用本地 npm 缓存后，通过相同版本工具和场景。没有更换工具版本或跳过场景。

通用 documentation-governance 检查器扫描 62 个 Markdown 文件：未报告链接或围栏错误，但因仓库现有文档不采用其 `docs/README.md` 和 lifecycle frontmatter 约定而返回 21 个结构错误；本次不为通过外部检查器引入新的文档治理结构。

本工作区和进程环境均没有 Cloudflare 凭据；没有验证托管模型推理、图片语义质量、延迟或计费。图片像素解码、1600 万像素限制及 13 MiB 整包限制仍由服务端执行；公开 schema 不提供视频字段。普通回归和 workerd 验证不调用付费模型。

## 2026-09-19 正式版 0.6.0 验收与自动晋级

11 个独立包均已发布稳定版 `0.6.0`，内部依赖为稳定范围 `^0.6.0`，`latest` 与 `next` 均指向本批正式版本。源码为 `aa4c0173ba56c48f25c260002139d464382010db`（[Release PR #7](https://github.com/ziyu/sytem-one-sdk/pull/7)）；[Release 工作流](https://github.com/ziyu/sytem-one-sdk/actions/runs/35436132802)首轮全部成功，已创建 11 个正式 GitHub release，例如 [core 0.6.0](https://github.com/ziyu/sytem-one-sdk/releases/tag/core-v0.6.0)。

CI 完成 232 项回归、13 项场景、类型与构建检查、11 个包的 ESM/CJS/声明隔离安装和 workerd 验证；Node 20/22/24 消费测试使用同一份冻结 tarball。发布 job 使用 npm Trusted Publishing/OIDC 上传到 `next`，逐包核对 registry SHA-512 并完成安装验收。全部包的来源记录与该源码提交及 `.github/workflows/release.yml` 一致；另在仓库外的 npm 消费项目执行 `npm audit signatures`，11 个 registry signatures 和 11 个 attestations 全部验证通过。

正式候选 tarball 和发布后的 npm 安装分别执行真实模型检查：每轮 TypeSafe `jev-1.13.0` 7 次（choice、score、boolean、decisions、policies、batch），DeepSeek `deepseek-flash` 2 次（probabilities、discrete）。两轮共 18 次均 HTTP 200，无重试，语义与结果结构断言通过。候选验收完成于 `2026-09-19T10:01:07.106Z`；npm 安装验收完成于 `2026-09-19T10:18:11.397Z`，报告确认 `fromRegistry: true`。Cloudflare 仍仅验证 workerd fixture；本轮未实测其他供应商推理。

两轮验收、registry receipt 和晋级报告绑定同一 manifest SHA-256：`88698086eeba2d50afa9962b8bd3019a73367fc927e31d9ea8248c74e5552fcf`。本地原始产物和模型报告保存在 `.artifacts/stable-release/`；模型完整结果及凭据未上传公共 GitHub。公开 release 附件包含 tarball、manifest、checksums、registry receipt 和 `release-result.json`。

发布与晋级分别通过 `npm` environment 审批。候选真实验收通过后批准上传；registry 真实验收及验签通过后批准晋级。标签写入使用仅覆盖 11 个新包的 environment secret，上传仍使用 OIDC；每个 `latest` 回读成功后才生成 GitHub release。此批已实际验证两种鉴权路径；RC 的默认标签问题通过真实稳定版晋级解决。旧 SDK 迁移提示单独使用维护者认证，npm 回读确认 7 个历史版本均已添加迁移链接；旧包 `latest` 仍为 `0.5.3`，历史 tarball 保留可安装。

## 2026-09-19 已发布 RC 的安装与真实模型验收

11 个独立包均已发布 `0.6.0-rc.0`，`next` 指向本批 RC；源码为 `09d4a2ead1e26dbc9804468b267303e6dd8ca22e`（[Release PR #3](https://github.com/ziyu/sytem-one-sdk/pull/3)）。[Release 工作流第 3 次执行](https://github.com/ziyu/sytem-one-sdk/actions/runs/35430490022)成功：构建和冻结产物、Node 20/22/24 消费检查、registry 完整性与 ESM/CJS/声明验收通过，生成 11 个逐包 prerelease。各 release 附有原始 tarball、manifest、checksums 和 registry 验证报告，例如 [core RC](https://github.com/ziyu/sytem-one-sdk/releases/tag/core-v0.6.0-rc.0)。

发布后的真实测试从公共 npm registry 匿名安装这批包到仓库外的消费项目，再读取本地配置调用服务；报告确认 `fromRegistry: true`，结束时间为 `2026-09-19T08:16:03.980Z`。TypeSafe `jev-1.13.0` 的 7 次调用覆盖 choice、score、boolean、decisions、policies、batch；DeepSeek `deepseek-flash` 的 2 次调用覆盖 probabilities 与 discrete。9 次均 HTTP 200，无重试，语义与结果结构断言通过。Cloudflare 验证范围仍为 workerd fixture；本轮未实测其他外部供应商。

复现命令（在该发布源码的干净 checkout 中使用原始 manifest）：

```sh
node scripts/test-release-live.mjs /path/to/typesafe.env /path/to/llm.env --registry
```

本地脱敏完整报告与原始产物位于 `.artifacts/rc-release/`，未公开上传模型报告或凭据。真实测试与 CI registry 报告绑定同一 manifest SHA-256：`586285fee00f41e0466acddddcc82f712441f525e01d3795cafb780913904696`。

首次创建包时尚不能预配置 Trusted Publisher，因此本批使用已验证的 CI tarball 完成一次本地 bootstrap，SHA-512 与清单一致；这次上传没有 npm provenance。随后 11 个包均已配置并回读 GitHub Trusted Publisher（`ziyu/sytem-one-sdk`、`release.yml`、`npm` environment）。成功重跑核验并复用已存在版本，没有再次上传；后续新版本的 OIDC 上传仍需首次执行验证。首次 metadata 可见早于安装索引，曾导致 registry 安装 404；索引同步后原批次恢复成功。

npm 为首次创建的包自动添加了 `latest`，即使上传指定 `next`。清理时用户两次成功完成安全密钥认证，但 npm 11.17.0 的 `npm dist-tag rm @system-one-ai/core latest` 均被 registry 以 HTTP 400 拒绝；捕获的正文仅为 `Request failed with status code 400`，未给出具体原因，不能归因为登录失效，也不能据此断言 npm 永久禁止删除 `latest`。停止重复认证和删除重试。`2026-09-19T09:17:11.213Z` 回读确认 11 个包的 `next` 与自动 `latest` 都仍为 `0.6.0-rc.0`；无标签或 `@latest` 安装也会选择 RC。脱敏阻塞记录保存在 `.artifacts/rc-release/rc-dist-tags.json`。这是当时的 RC 状态；上方正式版 `0.6.0` 已通过稳定晋级替换全部 `latest`。

RC 发布时，旧 `@system-one-ai/sdk@latest` 保持 `0.5.3`，没有 deprecation，GitHub `npm` environment 尚未配置审批保护。稳定 P4 随后完成了 main 分支限制、维护者审批、禁止管理员绕过和标签鉴权验收。

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
