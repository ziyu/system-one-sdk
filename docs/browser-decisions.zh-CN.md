# 用 decisions 驱动真实浏览器

[English](browser-decisions.md)

此示例打开实际 Chrome，读取当前页面的 DOM，用 `choiceFrom()` 和 `defineDecision()` 选择动作与目标，再通过 Playwright 执行。访问的是公开网站；真实运行命令没有替换网页、模拟模型响应或通过网站的搜索 API 代替界面操作。

实现位于 `examples/browser-use/`。命令行入口为 `examples/browser.ts`，通过 `npm run example:browser` 运行；浏览器回归测试位于 `tests/browser/`。

## 直接运行

在本仓库中，复用已经配置好的 TypeSafe `.env`：

```sh
npm install
npm run example:browser
```

默认显示 Chrome 窗口，展开 MDN 搜索，输入 `AbortController`，再打开 `abort()` 方法文档。终端会逐步输出实际动作及报告目录。任务结束后关闭浏览器，截图和可交互回放保留在磁盘。

```sh
# 搜索 GitHub，进入 cloudflare/agents，再打开 examples 目录。
npm run example:browser -- --task github-agents

# 同一个实现运行两个任务，改用已有 OpenRouter 配置。
npm run example:browser -- --task github-agents --task mdn-abort --provider openrouter

# 无界面运行两个任务；会消耗真实模型用量。
npm run test:live:browser

# 可选：npm 搜索包 -> GitHub 仓库 -> 许可证。npm 可能要求浏览器安全验证。
npm run example:browser -- --task npm-sdk
```

`typesafe` 读取 `.env`，`openrouter` 读取 `.env.openrouter`，`cloudflare` 读取 `.env.cloudflare`。使用已有示例客户端和显式 adapter。Cloudflare 需要账户 ID 与 token，本仓库尚未用 Cloudflare 凭据验证浏览器流程。

默认使用已安装的 Google Chrome。使用 Playwright 的 Chromium 时：

```sh
npx playwright install chromium
npm run example:browser -- --channel chromium
```

Playwright 仅作为此示例的**开发依赖**；SDK 运行时仍然零第三方依赖，导入 SDK 不会加载浏览器代码。

## 换成自己的任务

```sh
npm run example:browser -- \
  --url 'https://github.com/search?type=repositories' \
  --goal '搜索 microsoft/playwright，打开仓库，再进入 examples 目录。' \
  --input 'microsoft playwright' \
  --max-steps 14
```

调用方提供起始网址、自然语言目标和输入文本；Jev 决定动作、当前 DOM 中的目标和应填入哪项文本。模型不会生成任意文本、网址、选择器或 JavaScript。可以重复 `--input` 提供多个文本候选，使用 `--origin` 增加允许导航到的站点。

自定义任务中，模型选择结束时返回 `model-finished`，**不会宣称已经独立验证任务成功**。在自己的应用中接入 `runBrowserTask()` 时，应另外定义最终页面验收条件。

## 每一步如何执行

`examples/browser-use/observe.ts` 收集可见控件，支持**开放的 Shadow DOM**，排除隐藏、禁用、屏幕外隐藏及密码/文件输入控件。观察器保留真实 DOM 节点引用；节点被替换、链接地址或文字变化、输入内容被修改，都会使旧目标失效。

`examples/browser-use/agent.ts` 提供 `createBrowserDecision()` 和 `runBrowserTask()`。每一步重新读取页面并构造候选，只提供当前页面可执行的 `click`、`fill`、`enter`、`scroll`、`back`、`wait`、`finish`、`blocked`。填入文本和按 Enter 是两个动作，没有为网站写死操作顺序；例如 MDN 的自动补全结果出现后，可以直接选择其中的目标文档。

选择规则优先点击已经显示的合适搜索结果，只有尚无目标时才提交查询。等价控件按照区域和顺序优先级处理，具体当前目标仍由模型选择。

动作和选中分支的参数分别检查概率。示例默认阈值为 `0.65`，可通过 `--min-probability` 调整；这不是适用于所有业务的默认正确率。证据缺失或概率不足时返回 `uncertain`；API 失败保持失败，不自动重试或更换供应商。

页面状态包含正文、当前输入框和可见控件的简短摘要；完整候选描述与链接地址放在相应 choice 问题中。观察器穿过 Shadow DOM 收集导航区、对话框等位置语义；对于等价站内搜索入口，优先导航区，然后按页面顺序选择。默认最多 96 个候选，优先当前视口和输入框，并记录是否截断。需要更多控件时可滚动，或通过 `--max-targets` 调整数量（1–200）；提高数量可能超过模型上下文容量。

浏览器操作均有期限，默认最多 14 次模型决策，`--max-steps` 可设置为 1–40。超过步数、重复无效动作、导航失败、安全验证页都不会算成功。Ctrl+C 会取消等待中的 SDK 推理，当前有界浏览器操作结束后关闭浏览器。

## 如何证明真的完成了

`examples/browser-use/tasks.ts` 将任务描述与最终页面校验分开。运行循环只接收起始网址、目标、文本候选及允许站点；最终 URL 正则与断言在模型结束后执行，不参与指导下一步。

内置验收要求实际输入和点击、多次模型决策、正确的最终 URL，以及真实页面内容。GitHub 核对目标仓库目录；MDN 核对方法页及 Syntax 段落；npm 还会检查是否先访问过包页面，再进入仓库 LICENSE。

每次运行创建独立 `.artifacts/browser-decisions-<provider>-.../` 目录：

| 文件 | 内容 |
| --- | --- |
| `summary.json` | 浏览器版本、代码哈希、实际模型请求和任务结果 |
| `<task>/run.json` | 每步 DOM、选择结果、概率、策略、耗时和实际执行结果 |
| `<task>/verification.json` | 独立验收结果与文档导航状态 |
| `<task>/*-before.png`、`final.png` | 浏览器真实截图 |
| `<task>/final-page.txt` | 从最终页面读取的文本 |
| `<task>/trace.zip` | Playwright 操作、DOM 快照和截图回放 |

新的运行按 `examples/browser-use/` 路径记录源码摘要。目录改名前的报告保留原有路径和哈希，作为历史验证证据。

打开已有回放：

```sh
npx playwright show-trace .artifacts/browser-decisions-<provider>-<run>/<task>/trace.zip
```

模型请求由 Node 发出，位于浏览器回放之外。浏览器使用独立未登录环境，不读取个人浏览器配置。当前用途是公开网站搜索和阅读；尚未实现关闭的 Shadow DOM、iframe 操作、Canvas 界面、任意文本生成和登录态持久化。

## 回归与实测

```sh
# 实际本地浏览器 + 本地 HTTP 服务 + 明确标注的模型模拟响应。
npm run test:browser

# 离线浏览器测试改用 Chromium。
BROWSER_CHANNEL=chromium npm run test:browser
```

浏览器回归覆盖 Shadow DOM、隐藏控件、过期目标、真实表单提交、页面跳转、错误的完成声明、步数限制和取消。此测试独立于普通 SDK 检查，常规 CI 无需安装浏览器或配置模型凭据。公开网站真实调用使用 `example:browser` 或 `test:live:browser`，结果单独记录在 [validation.md](validation.md)。

开发过程中保留了实际失败：npm 返回安全验证页；最初观察器漏掉了 MDN 的 Shadow DOM 搜索按钮；GitHub 较大页面触发模型上下文相关错误。后两项通过完善观察器和压缩重复输入修正。MDN 的等价搜索入口曾分散概率，补充区域语义后通过；后续 GitHub 运行显示 429 限流页，保留为失败。没有降低概率阈值。公开网站仍可能变化或限制自动化访问，命令会报告实际结果。

实现资料：[Playwright Library](https://playwright.dev/docs/library)、[浏览器 channel](https://playwright.dev/docs/browsers)、[定位器与 Shadow DOM](https://playwright.dev/docs/locators)、[TypeSafe 函数组合](https://docs.typesafe.ai/cookbooks/function_calling)。
