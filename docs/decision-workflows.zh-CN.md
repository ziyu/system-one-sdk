# 有实际执行结果的决策示例

[English](decision-workflows.md) | **简体中文**

这两个仓库示例通过公开的 `choiceFrom`、`defineDecision` 和 `gateChoice` 接口，将自然语言指令转换成应用操作。流程包含真实磁盘数据、真实模型请求、动作执行和执行后回读验证。业务文档和工单为生成的样例数据，模型响应与文件操作是真实的；不会连接生产客服系统、退款服务或邮箱。

## 在仓库里运行

默认使用现有 `.env` 的 `SYSTEM_ONE_API_KEY` 调用 TypeSafe，地址和模型可以省略。下列命令自动编译示例。

```sh
# 读取合同，然后分别归档发票和合同。
npm run example:decisions

# 分配工单、保留优先级、升级故障优先级、关闭已解决工单。
npm run example:support

# 输入自己的指令；流程不靠匹配内置案例来选择动作。
npm run example:decisions -- --message '把办公桌椅采购的发票归到财务发票目录。'
npm run example:support -- --message '把所有用户无法登录的工单交给平台值班组，设置为紧急。'

# 切换 provider，业务流程保持一致。
npm run example:support -- --provider openrouter --message 'Route the duplicate-charge ticket to billing.'
```

每次默认创建新的 `.artifacts/decision-examples/` 子目录，并输出准确路径。需要连续操作同一批数据时，通过 `--workspace` 复用该目录。下例的 `XXXXXX` 需要替换成命令实际输出的目录后缀。

```sh
# 仅生成样例数据，不需要凭据，也不请求模型。
npm run example:decisions -- --init

# 在生成的目录中执行自己的指令。
npm run example:decisions -- \
  --workspace .artifacts/decision-examples/files-XXXXXX \
  --request-id archive-invoice-1 \
  --message '把办公桌椅采购的发票放到财务发票目录。'
```

相同请求 ID 和相同文本会返回保存的结果，`replayed: true`，不重复调用模型或执行动作。相同 ID 配合不同文本会报冲突。新指令或状态冲突后的重新评估应使用新 ID。还支持 `--message-file <UTF-8 文件>` 和 `--help`；`--message-file` 与 `--message` 不能同时使用。

`typesafe`、`openrouter`、`cloudflare` 分别直接读取 `.env`、`.env.openrouter`、`.env.cloudflare`，避免父进程环境变量覆盖凭据。Cloudflare 使用 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`，另外两者使用 `SYSTEM_ONE_API_KEY`。这些真实示例限定调用所选供应商的官方 origin，不自动切换供应商。本轮未验证 Cloudflare 真实调用。

## 文件收件箱

初始化会在 `inbox/` 创建办公用品发票、已签署的服务合同、会议纪要。文件采用普通名称，模型根据内容与用途选择目标。可以修改生成的文件，也可以添加自己的 UTF-8 文本文件后提交新指令。

| 动作 | 参数 | 实际效果 |
| --- | --- | --- |
| `file` | 当前文档、归档目录 | 将选中文件移到 `archive/finance`、`archive/legal` 或 `archive/meetings`；不覆盖已有文件 |
| `read` | 当前文档 | 读取磁盘上的完整文本，不移动文件 |
| `clarify` | 无 | 记录需要澄清，文件保持不变 |
| `wait` | 无 | 按指令保持文件不变 |

每条新指令都重新读取实际收件箱，使用 `choiceFrom` 构造候选。模型能看到文件名、最多 800 字符预览及可选目录。路径由应用提供，模型只选择合法候选 ID。目标不明确或集合为空时可以选择显式 `none`。示例最多接受 24 个普通 UTF-8 文本文件，每个不超过 32 KiB，不处理 PDF 或 Office 文档解析。

执行前重新核对文件清单和内容摘要。模型请求期间文件发生变化，旧决策会返回冲突。目标文件采用排他创建，避免覆盖已有归档。验收时比较操作前后所有文件的路径与字节摘要，要求只移动指定文件，内容与无关文件均保持不变。

## 客服工单队列

`workspace.json` 保存工单、团队、版本号和操作记录。模型候选只包含未关闭工单与启用中的团队。关闭工单后，下一条指令的候选集合不再包含它；连续改派指令会读取上一步写入的最新数据。

| 动作 | 参数 | 实际效果 |
| --- | --- | --- |
| `assign` | 工单、团队、`keep / normal / high / urgent` 优先级操作 | 更新指定工单的分配和需要修改的优先级，增加版本号 |
| `resolve` | 未关闭工单 | 写入 `resolved` 状态，增加版本号 |
| `clarify` | 无 | 记录需要澄清，不修改工单 |
| `wait` | 无 | 保持工单不变 |

`keep` 明确表示保留原优先级，适用于用户没有提出优先级修改，也适用于“优先级不变”。应用不会把未提供的优先级改成 `normal`，也不会仅因工单描述严重就擅自升级。工单更新与对应操作记录在同一次 JSON 原子替换中保存。

## 代码如何复用

| 文件 | 职责 |
| --- | --- |
| `examples/scenarios/files.ts` | `fileDecision`、文件清单、`runFileCommand` 执行流程 |
| `examples/scenarios/support.ts` | `supportDecision`、队列、`runSupportCommand` 执行流程 |
| `examples/scenarios/workspace.ts` | 明确的策略阈值、写入锁、请求记录、JSON 原子替换 |
| `examples/scenarios/client.ts` | 配置供应商、记录原生 Fetch 请求 |
| `examples/scenarios/cli.ts` | 自由文本指令、工作目录、结果报告 |
| `examples/scenarios/cases.ts` | 只供验证脚本使用的预期答案 |

`runFileCommand(client, directory, message, requestId, options?)` 和 `runSupportCommand(...)` 接受任意 `EvaluationClient`。返回完整模型评估、选中动作与参数 ID、逐项策略结果和执行效果。重放直接返回已保存结果，不虚构一次新的推理元数据。CLI 会保存 `run-*.json`，后续指令失败时也保留前面已完成的结果。

SDK 继续负责评估和类型化解析；磁盘读写、工单版本和执行器属于示例应用。在消费项目里使用 `@system-one-ai/core`、`@system-one-ai/decisions`、`@system-one-ai/policies`，再把持久化操作替换为应用自身的数据层即可。

动作和被选中分支中的相关参数分别检查 `minProbability: 0.8`、`minMargin: 0.2`。`clarify`、`none` 明确返回弃权；未选中分支的答案不会阻止当前动作。接口失败仍是错误，证据不足仍是不确定。这些阈值属于示例配置，不是适用于所有任务的默认标准。

这是本地串行流程：写入锁占用时立即失败。文件移动与操作记录是两个文件系统操作，不保证进程崩溃时的跨文件原子性，也不承诺分布式恰好执行一次。接入生产系统时，需要结合自己的数据库事务和操作日志设计执行层。

## 验证真实决策和落盘效果

```sh
# 离线验证执行器：包含过期状态、目标冲突、取消、重复请求。
npm run test:scenarios

# 每个供应商运行 20 次真实推理，不重试。
npm run test:live:decisions -- --provider typesafe
npm run test:live:decisions -- --provider openrouter

# 也可按固定数据分组运行。
npm run test:live:decisions -- --provider typesafe --phase development
npm run test:live:decisions -- --provider typesafe --phase holdout
```

数据集包含 14 个主要用例和 6 个额外措辞用例，覆盖中英文、按语义选择对象、模糊指令、不支持的动作、空收件箱、保留优先级和连续改派。`holdout` 是额外措辞分组的名称；参与开发反馈后不能再视为独立的统计留出集。

预期答案不会发送到模型。明确指令必须选对动作与参数，且**实际文件或工单修改符合预期**；明确指令返回不确定也算失败。模糊或不支持的指令必须不改业务数据。每个通过用例随后重放一次，检查请求数和业务状态不变。失败会使脚本返回非零，并保留原始报告。

每次运行写入新的 `.artifacts/live-decisions-<provider>-*/report.json`，记录源码摘要、输入、预期结果、原始答案、策略、前后状态、耗时、用量覆盖率和请求跟踪；不包含密钥和鉴权头。耗时包含客户端与网络，不等于纯模型计算时间。

2026 年 9 月 18 日最终验证：TypeSafe **20/20**，OpenRouter **20/20**，分别通过 20 次无新增请求的重放检查。OpenRouter 初次验证为 19/20，发现单独判断“是否指定了优先级”会让“保持原优先级”落入不确定区间；将其改成显式 `keep` 候选后解决该实测问题，没有降低阈值。初测与复测记录均保留在[验证文档](validation.md)。

这些结果是固定样例的集成验证，不是生产准确率基准。设计参考 TypeSafe 官方的[封闭集合函数调用](https://docs.typesafe.ai/cookbooks/function_calling)与[置信度说明](https://docs.typesafe.ai/confidence)。
