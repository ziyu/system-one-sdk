# Decisions driving a real browser

[简体中文](browser-decisions.zh-CN.md)

This example opens Chrome, reads the current DOM, builds a decision with `choiceFrom()` and `defineDecision()`, and executes the selected action through Playwright. It visits public websites. The live command does not serve replacement pages, use model fixtures, or call a website's search API instead of interacting with its UI.

## Run

From a checkout of this repository with the existing TypeSafe `.env` configured:

```sh
npm install
npm run example:browser
```

The default opens a visible Chrome window, expands MDN's search, enters `AbortController`, and opens the `abort()` method documentation. It prints each actual action and the report directory. Chrome closes at the end; screenshots and an interactive Playwright trace remain available.

```sh
# Search GitHub, open cloudflare/agents, and enter its examples directory.
npm run example:browser -- --task github-agents

# Same implementation, two independent tasks, using the existing OpenRouter config.
npm run example:browser -- --task github-agents --task mdn-abort --provider openrouter

# Both tasks without a visible window. This consumes real model usage.
npm run test:live:browser

# Optional npm -> repository -> license task. npm may require browser verification.
npm run example:browser -- --task npm-sdk
```

`--provider typesafe` reads `.env`; `openrouter` reads `.env.openrouter`; `cloudflare` reads `.env.cloudflare`. These use the existing example client and explicit adapters. Cloudflare requires account ID and token; its live browser path has not been verified with credentials in this repository.

The default browser channel is installed Google Chrome. To use Playwright's bundled Chromium instead:

```sh
npx playwright install chromium
npm run example:browser -- --channel chromium
```

Playwright is a **development dependency for this example**. The SDK's runtime still has no third-party dependencies, and importing the SDK does not import browser code.

## Supply your own task

```sh
npm run example:browser -- \
  --url 'https://github.com/search?type=repositories' \
  --goal 'Find microsoft/playwright, open the repository, and then open its examples directory.' \
  --input 'microsoft playwright' \
  --max-steps 14
```

The start URL, goal and literal input text are provided by the caller. Jev selects the action, actual DOM target and appropriate supplied value. It does not invent text, URLs, selectors or JavaScript. Repeat `--input` for multiple possible input values, and `--origin` to permit an additional top-level navigation origin.

Custom tasks report `model-finished` when the model decides to stop. They do **not** claim independently verified task success. Add your own final-state verifier when embedding `runBrowserTask()` in an application.

## Execution loop

`examples/browser/observe.ts` discovers visible controls, including controls in **open Shadow DOM**. Hidden, disabled, off-canvas and password/file controls are excluded. It retains references to the actual observed nodes. A replacement node, changed link destination, changed label or edited input invalidates that target.

`examples/browser/agent.ts` exposes `createBrowserDecision()` and `runBrowserTask()`. Every iteration builds a fresh candidate set and offers the actions the current page can support: `click`, `fill`, `enter`, `scroll`, `back`, `wait`, `finish`, and `blocked`. Filling and pressing Enter are different operations. There is no fixed site-specific sequence. For example, the MDN run can click a live autocomplete result directly rather than submitting a search first.

The selection rule prefers clicking an already-displayed appropriate search result over submitting the same query again. Equivalent navigation controls use the described region/order preference; the model still selects the concrete current candidate.

The action and each selected parameter must pass an explicit probability gate. The default example threshold is `0.65` and can be changed with `--min-probability`; it is not a universal calibration recommendation. Missing evidence and low probability stop the run as `uncertain`. Provider failures remain failures, with no retries or automatic provider replacement.

Page text and control descriptions have separate roles. State includes page text, current editable fields and a compact summary of visible controls. Full clickable descriptions and destinations belong to their choice question. Composed DOM regions distinguish navigation, dialogs and page content; equivalent site-wide search controls use a navigation-first, then document-order tie-break. The observer defaults to 96 candidates, prioritizing the viewport and editable controls. Truncation is recorded. Use scrolling to expose additional controls or `--max-targets` to change the limit (1–200). Increasing the limit can exceed the selected model's context capacity.

Browser actions use bounded timeouts. The default run allows 14 model decisions; `--max-steps` accepts 1–40. A step limit, repeated ineffective action, failed navigation, or security-verification page is not successful task completion. SIGINT cancels pending SDK inference and cleanup closes the browser after outstanding bounded browser operations return.

## Independent verification and evidence

`examples/browser/tasks.ts` contains tasks and separate final-state checks. The agent receives only the start URL, goal, input values and allowed origins. Expected final URL patterns and assertions are evaluated **after** the agent stops, never supplied to it as navigation instructions.

Built-in checks require real input and clicking, multiple model decisions, the expected final URL and actual rendered content. GitHub checks the repository directory; MDN checks the method page and its syntax section; npm additionally checks that the package page was visited before the repository license.

Each run creates a fresh `.artifacts/browser-decisions-<provider>-.../` directory with:

| Artifact | Contents |
| --- | --- |
| `summary.json` | Browser version, source hashes, actual provider requests, per-task outcomes |
| `<task>/run.json` | DOM observations, decisions, probabilities, gates, timing, actual execution outcomes |
| `<task>/verification.json` | Independent assertion results and observed document navigation statuses |
| `<task>/*-before.png`, `final.png` | Actual browser screenshots |
| `<task>/final-page.txt` | Text read from the final page |
| `<task>/trace.zip` | Playwright actions, DOM snapshots and screenshots |

Open an existing trace with:

```sh
npx playwright show-trace .artifacts/browser-decisions-<provider>-<run>/<task>/trace.zip
```

Traces are browser-only: model API calls happen in Node, outside the browser context. The example uses an isolated, unauthenticated browser context. It is intended for public search and reading; it does not use your personal browser profile. Closed Shadow DOM, iframe interaction, canvas interfaces, arbitrary text generation and persistent login sessions are not implemented.

## Regression tests and live results

```sh
# Real local browser + local HTTP server + explicitly simulated model responses.
npm run test:browser

# Chromium instead of installed Chrome for the offline browser tests.
BROWSER_CHANNEL=chromium npm run test:browser
```

Browser tests cover Shadow DOM observation, hidden controls, stale nodes, actual form submission, navigation, false completion, step limits and cancellation. They are separate from normal SDK tests so ordinary CI does not require a browser installation or model credentials. Public-site runs use `example:browser` or `test:live:browser` and are recorded separately in [validation.md](validation.md).

Development encountered and retained real failures: npm returned a security-verification page; the first observer missed MDN's Shadow DOM search button; a large GitHub page exceeded the model's context constraints. The observer and request representation were corrected for the latter two. Equivalent MDN search buttons also split the decision probability until region context was supplied. A later GitHub run rendered a 429 rate-limit page; it remains a failed run. No probability threshold was lowered to make those cases pass. Public websites can still change or deny automated access; the run reports the actual outcome.

Implementation references: [Playwright Library](https://playwright.dev/docs/library), [browser channels](https://playwright.dev/docs/browsers), [locators and Shadow DOM](https://playwright.dev/docs/locators), and [TypeSafe function-calling composition](https://docs.typesafe.ai/cookbooks/function_calling).
