# 决策组合、概率策略与批量评估

[English](composition.md) | **简体中文**

三个独立包通过 `EvaluationClient` 组合评估能力。运行时零第三方依赖，使用 Web API；新的组合模块声明要求 TypeScript 5.4 或更高版本。

| 入口 | API | 职责 |
| --- | --- | --- |
| `@system-one-ai/decisions` | `choiceFrom`、`defineDecision` | 动态候选对象映射及动作参数组合 |
| `@system-one-ai/policies` | `gateChoice`、`gateBoolean` | 显式接受、不确定和弃权 |
| `@system-one-ai/batch` | `evaluateMany` | 多个独立状态的客户端有界并发 |

组合模块只依赖核心导出的 `EvaluationClient` 类型。`SystemOne` 可以直接使用，应用也可实现符合相同返回契约、保留请求控制的包装器。模块不选择供应商，不读取环境变量，也不管理凭据。核心入口不会加载这些可选模块。

## 动态候选

```ts
import { choiceFrom, defineDecision } from '@system-one-ai/decisions';
import { gateChoice } from '@system-one-ai/policies';

const devices = [{ id: 'desk', label: '台灯', on: false }];
const targets = choiceFrom({
  instructions: '选择用户提到的设备。',
  items: devices,
  id: device => device.id,
  describe: device => ({ label: device.label, on: device.on }),
});

const definition = defineDecision({
  instructions: '选择下一步动作；请求不明确时要求澄清。',
  actions: {
    turn_on: { description: '打开设备', parameters: { device: targets } },
    ask: { description: '请求澄清' },
  },
});

const { decision, evaluation } = await definition.evaluate(client, {
  state: '请打开台灯。',
}, { timeoutMs: 5000, maxRetries: 0 });

const actionGate = gateChoice(evaluation.answers.action, {
  minProbability: 0.8, abstain: ['ask'],
});
if (actionGate.status === 'accepted' && decision.action === 'turn_on') {
  const targetGate = gateChoice(decision.parameterAnswers.device, { minProbability: 0.8 });
  if (targetGate.status === 'accepted') {
    // 原业务对象；这次状态修改由应用代码显式执行。
    decision.parameters.device.on = true;
  }
}
```

`choiceFrom` 构造时对每个候选调用一次 `id` 和 `describe`。ID 必须是非空且唯一的字符串；模型只看到 ID 和生成的 JSON 描述，业务对象本身不被序列化。需要模型看到的其他信息应主动放进 `state` 或描述。

候选集合和问题描述会建立快照，问题被深度冻结。原业务对象保留引用，既不克隆也不冻结。修改原数组不会给已有定义增加候选；修改业务对象仍可改变它的本地属性。更新模型可见的描述或候选集合时，需要重新构造定义。

空集合必须提供显式 `none: { id, description }`，否则抛出 `ValidationError`。`none` 的 ID 不能与候选冲突；配置后返回类型为 `T | undefined`，选中此项得到 `undefined`。未知 ID 抛出 `ResponseValidationError`。也可以直接把 `targets.question` 交给普通 `evaluate`，再用 `targets.resolve(answer.choice)` 取得对象。

## 动作与参数契约

`defineDecision` 返回冻结的 `questions`、`resolve(evaluation)` 和 `evaluate(client, request, options)`。请求包括 `state`，可选 `model` 和 `providerOptions`，不允许替换编译后的问题。第二组调用选项仍使用现有超时、取消、重试与请求头语义。

一次评估包含动作问题和所有预先定义分支的参数问题。参数说明会包含“假定选择该动作”的条件；服务仍必须为所有问题返回有效答案。最终 `decision.parameters` 和 `decision.parameterAnswers` 只包含选中分支。

| 参数定义 | `parameters` 中的值 | `parameterAnswers` 中的证据 |
| --- | --- | --- |
| `choiceFrom(...)` | 原业务对象；配置 none 后可能为 undefined | 包含候选 ID 的 ChoiceAnswer |
| `choice(...)` | 候选 ID 的字面量联合类型 | 类型化 ChoiceAnswer |
| `score(...)` | 可带小数的评分 | ScoreAnswer |
| `booleanQuestion(...)` | 数值 P(true)，不会隐式变成布尔值 | BooleanAnswer |

对 `decision.action` 分支判断后，TypeScript 会收窄对应参数。`parameterAnswers` 使用用户定义的参数名，因此可以独立评估目标的确定程度。`evaluation` 保留完整答案、舍入声明、警告、用量、耗时和供应商元数据；生成的参数问题 ID 是内部细节，只有公开的 `action` 问题及具名参数证据属于稳定契约。

必须等上一个结果才能构造的参数，需要后续独立评估。此接口不能生成任意文本或无限参数空间。应用负责目标是否仍有效、动作执行、执行节奏和状态反馈。`examples/decisions.ts` 演示动作和目标分别通过策略后调用处理函数，实际更新本地设备状态。

## 不确定性策略

`gateChoice` 至少要显式提供 `minProbability`、`minMargin`、`minConfidence` 之一。多个条件同时满足才接受；每个阈值必须是 0–1 的有限数。可选 `abstain` 列出表示主动弃权的候选 ID。

`minProbability` 比较选中项的概率；`minMargin` 比较选中项与概率最高的其他项之差，没有其他项时按零计算其他项；`minConfidence` 比较供应商独立返回的 confidence。它们不会互相替代，策略也不会重选候选、归一化或相乘概率。

这些函数用于 SDK 已归一化的答案；完整分布和舍入一致性仍由核心校验。策略比较实际返回的数值；差值比较只补偿机器精度级别的减法误差，不应用供应商舍入容差。缺少策略需要的证据时返回不确定，即使对应阈值为零也如此。选中显式弃权项时优先返回弃权。

`gateBoolean(answer, { maxFalseProbability, minTrueProbability })` 要求 `0 <= maxFalseProbability < minTrueProbability <= 1`。P(true) 小于等于下限时接受 false，大于等于上限时接受 true，中间区域为不确定；两端边界均包含。

结果以 `status` 区分：`accepted` 带有 `value`；`uncertain` 带有稳定原因，如 `missing-probabilities`、`below-margin`、`between-thresholds`；choice 弃权返回 `abstained` 和 `abstain-option`。策略配置错误抛出 `ConfigurationError`，无效答案字段抛出 `ResponseValidationError`。网络、鉴权及超时错误不会转成低置信度结果。

没有默认阈值；示例数字需要在自己的标注场景中检验。动作与重要参数应分别判断。`examples/uncertainty.ts` 通过应用传入的回调转交任务。没有 `SLOW_THINK_URL` 时只记录 `handoff_required`，不会声称调用了慢模型；设置后向应用服务 POST `{state, reason}`，可用 `SLOW_THINK_API_KEY` 携带 Bearer 凭据。服务协议和超时属于示例中的应用代码。

## 有界并发批量评估

```ts
import { evaluateMany } from '@system-one-ai/batch';

const report = await evaluateMany(client, [
  { id: 'a', request: { state: '打开台灯。', questions: definition.questions } },
  { id: 'b', request: { state: '我需要帮助。', questions: definition.questions } },
], {
  concurrency: 2,
  signal: controller.signal,
  requestOptions: { timeoutMs: 5000, maxRetries: 0 },
});
for (const item of report.items) {
  if (item.status === 'fulfilled') {
    console.log(item.id, definition.resolve(item.value));
  } else {
    console.log(item.id, item.status, item.started);
  }
}
```

这是客户端并发调度，不是服务端 batch API。每项包含唯一非空 ID 和标准请求；不同项可以使用不同问题，readonly tuple 保留每项答案类型。默认并发数为 4，无全局队列，不额外增加重试或自动切换模型。

所有输入请求和共享请求头在首次调度前完成快照。批量选项、ID 重复、列表结构错误会在 I/O 前拒绝整个调用；单条请求内容无效时，该项返回 `rejected`、`started: false`，其他有效项继续。结果始终按输入顺序排列，包含 `id`、`index` 和 `started`，待所有项结束后一起返回。批次在内存中保留，大数据集应由调用方分块。

`fulfilled` 携带完整 `value`；`rejected` 保留原始 `error`；`cancelled` 携带 `RequestAbortedError`，并通过 `started` 区分已发起和未发起的项。取消会停止启动排队任务并向运行中的请求发送取消信号，最终仍返回已经完成的结果。即使自定义客户端忽略信号，SDK 也能结束等待，但无法强行停止其内部工作或撤销上游计费。

`requestOptions.timeoutMs` 从单条任务发起时计时，不包含排队。批次本身没有另一个默认总期限；可以通过调用方的 AbortSignal 设置总期限。

`summary.started` 是客户端 evaluate 调用次数，不是 HTTP 次数。`successfulAttempts` 只统计成功结果报告的尝试数。`reportedUsage` 累计成功结果中已知 token 计数，`usageCoverage` 记录每一计数有多少项提供；缺失不代表零，超出安全整数范围的合计被省略。失败或取消的请求也可能消耗未报告用量，因此不能将此汇总当作完整账单。单条供应商元数据会保留，不臆测跨供应商费用单位。

## 验证

`npm run check` 执行运行时测试与正反类型断言。`npm run test:package` 安装实际 tarball，核对 ESM/CJS 导出、NodeNext 声明和核心加载隔离。

`example:uncertainty` 和 `example:batch` 读取 `.env` 并发出真实模型请求。`npm run test:live:composition` 直接读取 `.env`，成功路径发出三次真实推理、不重试，记录脱敏后的当前报告和带时间戳报告。它验证动态动作与参数、概率策略及异构批量评估，不调用慢模型服务。普通测试始终保持离线。

`example:decisions` 现为文件收件箱归档流程，`example:support` 提供持久化工单处理；均支持自由指令和切换 provider。`test:live:decisions` 验证 20 个场景及实际执行效果。配置、执行器、重放、状态冲突与实测记录见[决策业务示例](decision-workflows.zh-CN.md)。
