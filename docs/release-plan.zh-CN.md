# 下一次发布规划

状态（2026-09-19）：P0–P2 已完成；P3 的 11 个 `0.6.0-rc.0` 包已发布到 npm `next`，远端发布工作流和 npm 安装后的 7 次 TypeSafe、2 次 LLM 真实调用全部通过。npm 自动添加的 `latest` 在成功认证后仍因 registry HTTP 400 无法清理，P3 尚有该服务端阻塞项；P4 已获授权并开始实施：稳定版本由 Changesets 生成，上传与晋级拆为两道受保护部署。操作说明见 [releasing.md](releasing.md)，证据见 [validation.md](validation.md)。

## 1. 本次发布的定位与基线

本次交付以独立包、清晰契约和可重复发布为核心。保留现有业务能力，完成单包用户到独立包的迁移。LLM 保持一个 adapter 包。

以下是规划时的历史基线，当前 RC 发布状态见上文：

| 位置 | 状态 |
| --- | --- |
| 当前开发分支 | `codex/split-sdk-packages`，基于 `c831621`，已完成拆包与真实 TypeSafe/LLM 验证 |
| 本地 main worktree | `3a828db`，仍在 0.5.2 发布提交 |
| 远端 main | `5d4befb`，已包含后续 0.5.3 改动 |
| npm 旧 SDK | `@system-one-ai/sdk@latest` 为 **0.5.3** |
| 当前 11 个独立包名 | 公共 registry 均返回 404；这不等于已确认发布权限 |

**已解决的首要差异：规划时开发分支没有完整覆盖已发布的 0.5.3。** 远端新增了 Cloudflare Workers 原生 binding、`BindingError`、共享 Cloudflare codec、示例、类型测试及 workerd 检查。先对齐这些变化，再冻结新版本。迁入实现时使用独立包结构，根目录继续保持 private。

建议 Workers 能力归属 Cloudflare 包，通过 `@system-one-ai/adapter-cloudflare/workers` 独立入口提供，继续实现 `EvaluationClient`。REST 与原生 binding 保留各自执行方式，复用已有 codec 和必要工具。具体依赖边界在迁入时核对，不因发布而引入通用执行框架。

验收：逐项核对 0.5.3 的公共导出、错误类型、行为、示例及测试，形成旧入口到新入口的完整映射；所有已发布能力都有明确去向。

## 2. 版本与兼容政策

建议首批独立包采用 **0.6.0-rc.N → 0.6.0**，后续独立升级。首批同号便于迁移；包之间不建立永久同步版本组。包名是新的 npm 身份，0.6.0 是项目迁移批次的选择，并非旧包的原地升级。

当前仍有首次包边界与公共契约需要验证，先完成 0.6，而不是仅凭改动规模宣告 1.0。进入 1.0 的条件是公开契约、支持范围、迁移政策和发布流程都已稳定执行。

- 兼容修复使用 patch；兼容新增能力使用 minor。
- 0.x 阶段的破坏性变更必须提升 minor，明确标记 BREAKING，并提供迁移说明；禁止放入 patch。
- 1.x 起破坏性变更使用 major。
- 依赖下界必须覆盖实际使用的 API；共享契约变化时一起评估受影响包及其范围。
- RC 的内部依赖明确指向匹配的预发布版本，不能意外安装旧稳定依赖；正式版重新生成稳定版本依赖并测试。
- `exports`、声明文件、错误类型、默认行为、超时/重试语义和运行环境要求均属于兼容性契约。

本次冻结 `core/http`、`core/validation`、`core/composition` 等已导出的跨包入口：明确其支持级别。对已发布的工具入口也执行版本规则。

## 3. 版本管理采用 Changesets

引入 Changesets 作为开发依赖，负责版本计划、依赖联动、预发布版本和逐包 changelog。采用独立版本配置，`fixed`、`linked` 为空，基于 main。

每个改变消费方行为或公开类型的 PR 附带 changeset，写明受影响包、变更级别和用户可理解的说明。纯文档、内部 CI 等无需发布的变更在 PR 中说明原因。版本号和 changelog 统一由 Release PR 生成。

沿用现有发布代码中有用的源提交检查、tarball 校验、OIDC 和 registry 核验；版本计算交给 Changesets。Git commit 文本不作为另一套自动版本来源。

AI SDK 当前同样使用 Changesets 的独立版本配置，可参考其 [.changeset/config.json](https://github.com/vercel/ai/blob/main/.changeset/config.json) 和 [release/version scripts](https://github.com/vercel/ai/blob/main/package.json)。

## 4. 发布以同一份清单为依据

目标流程：

```text
功能 PR + changeset
    → Release PR（版本、依赖、changelog）
    → 合并到 main，确定源码 commit
    → 构建、打包、验证，冻结发布清单
    → 同一任务按依赖顺序发布
    → 从 npm 安装并验收
    → 更新 dist-tag、生成 package tag 和发布说明
```

Release PR 负责内容审核，受保护的 npm environment 控制发布权限。发布 job 消费验证 job 保存的产物，不重新构建。人工执行相同任务时使用明确的 commit 和同一发布清单。

清单至少记录 commit、lockfile 摘要、Node/npm 版本、包名和版本、依赖、tarball SHA-512，以及验证结果的引用。每次发布任务保存清单和 tarball，失败后可以继续核对同一份产物。

需要修正现行流程的两个问题：

1. 每个包 tag 启动一次发布、每次又测试所有包，会重复工作；同一个 Actions concurrency group 也不能保证多个 tag 按依赖顺序执行。改为同一批次的一个编排任务，按包 manifest 推导顺序。
2. 当前脚本要求未变化的依赖在当前源码下重新打包后，与 npm 上的历史 tarball 完全相同，形成不必要的发布耦合。发布清单区分“本次产物”和“已发布依赖”：前者验证本次 SHA-512，后者按选定版本从 registry 安装、核验并测试，不要求重新打包历史依赖。

Changesets Release PR 成为统一入口后，停止通过任意 package tag 直接启动另一条发布路径。package tag 在对应版本验证成功后生成，用于追溯。发布说明使用该包 changelog，避免每个包都复制整个仓库的提交列表。

## 5. 测试与验收标准

保留现有类型、协议、边界、超时/取消/重试、真实本地 HTTP、场景测试和 tarball 隔离安装。迁入 Workers 后恢复其 workerd、类型与组合测试。

发布验收增加以下要求：

- 明确 Node/TypeScript 支持范围；当前声明的 Node 20/22/24 兼容性由对应 CI 验证，本机 Node 26 的结果不能替代它们。若调整最低版本，单独写明迁移影响。
- 使用同一份候选 tarball 验证 ESM/CJS 和声明解析；消费项目位于仓库外，不能依赖 workspace 链接。
- 消费测试同时覆盖本次变更包与已发布依赖，验证声明的依赖下界；共享 core 类型和错误行为保持一致。
- TypeSafe 作为主要接入，在最终候选包上验证 choice、score、boolean、decisions、policies、batch；LLM 保留概率/离散模式的基础联调。
- 真实测试报告记录源码与包摘要、模型、时间、状态和结果。外部服务调用通过显式配置运行，不在普通 PR 中自动消耗凭据。
- 逐供应商标明“协议测试”“运行时测试”“真实推理”的证据范围。缺少某个供应商凭据时，不声称其真实接口已验证。
- RC 和正式版本字节不同，正式 tarball 仍需自身的安装与运行验收。

## 6. 本次发布与迁移安排

先发布 RC 到 `next`，按真实消费方式从 npm 安装，执行类型、运行和模型测试。达到验收条件后生成正式版本及新的测试产物。

正式版本先通过 `next` 发布并完成 registry 安装验收，再更新本批各包的 `latest`，最后发布迁移公告。npm 的多包发布和 tag 更新不是原子操作：任一步失败都按清单恢复，全部完成后才宣布整批发布成功。

发布顺序由依赖图产生，当前大致为 core → protocol/transport → adapters/组合包。Workers 迁移后以实际 manifest 为准。

迁移文档面向 **SDK 0.5.3** 用户，必须包含：

- 旧包/子路径与新包/子路径的一一映射，包括 Cloudflare Workers。
- 最小安装组合、显式 adapter/transport、自定义 fetch 的新写法。
- 原有 evaluate、答案、概率与错误行为中保持一致及发生变化的部分。
- TypeSafe、LLM、Cloudflare REST、Workers 的可运行示例及相应验证范围。

新稳定包全部可用后，再给旧 `@system-one-ai/sdk` 添加 npm deprecation 提示与迁移链接。保留历史版本可安装。正式版发现问题时发布修复版本；有上一稳定版时可恢复 `latest` 指向，已发布版本和 Git tag 保持不变。

首次发布前逐包确认 npm scope 权限、名称、Trusted Publisher 与 GitHub environment。若空包尚不能配置 OIDC，则将首次 bootstrap 作为单独的一次操作，复用已验证产物，之后统一走 CI。本批已确认 scope owner 权限，完成 11 个包的精确产物 bootstrap 和 Trusted Publisher 配置；首次上传无 provenance。`npm` environment 已配置 main 分支限制、维护者审批和禁止管理员绕过；独立包的标签凭据已存入该环境。稳定发布仍需实际验证 OIDC 上传与 dist-tag 写入。

## 7. 实施批次及完成标准

| 批次 | 交付 | 完成标准 |
| --- | --- | --- |
| P0：对齐基线 | 纳入远端 0.5.3，迁移 Workers 能力和测试，冻结包名/公开入口 | 0.5.3 能力映射完整，回归和 workerd 通过 |
| P1：版本规范 | Changesets、逐包 changelog、PR 模板、贡献规则 | 一个多包变更能生成正确版本与依赖的 Release PR |
| P2：发布流水线 | 批次清单、固定产物、顺序发布、恢复执行、registry 安装验收 | 无发布权限的 dry-run 通过；模拟中途失败能按原清单恢复 |
| P3：RC | 首次权限配置、0.6.0-rc.N、完整迁移文档 | 从 npm 安装后，类型/运行时/已支持的真实模型验收通过 |
| P4：稳定版 | 0.6.0 产物、验证报告、dist-tags、公告与旧包提示 | 每包版本、依赖、产物和安装行为一致，工作流完成 |

后续开发统一要求：明确代码所属包；说明公开契约和兼容影响；附可复现验证；按需提供 changeset 和迁移说明。发布流程维护与库运行时改动分别提交，便于审查。

P3 的实现 PR 与 Release PR 已合并，RC 已完成 npm 发布、registry 消费和真实模型验收。P4 正在生成稳定产物并验收；通过后以真实 `0.6.0` 正式版本替换 RC 的 `latest`，完成迁移公告与旧 SDK deprecation。发布和晋级的失败恢复、清单绑定及禁止版本回退已加入自动化检查。
