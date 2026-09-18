import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { SystemOne } from '../../.examples/src/index.js';
import { observe } from '../../.examples/examples/browser-use/observe.js';
import { runBrowserTask } from '../../.examples/examples/browser-use/agent.js';
import { verifyBrowserTask } from '../../.examples/examples/browser-use/tasks.js';

// Offline model fixtures with a real browser and local HTTP server. Public-site tests use the CLI.
let browser;
let server;
let origin;
let root;
const searchRequests = [];
before(async () => {
  const channel = process.env.BROWSER_CHANNEL ?? 'chrome';
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/search') {
      searchRequests.push(url.searchParams.get('q'));
      response.end('<h1>Search results</h1><a href="/document">Selected API document</a>');
    } else if (url.pathname === '/document') {
      response.end('<h1>Selected API document</h1><p>This is the actual terminal document.</p>');
    } else {
      response.end('<button onclick="document.querySelector(\'form\').hidden=false">Open search</button><form hidden action="/search"><label>Search terms<input name="q"></label><button>Search</button></form>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  await mkdir('.artifacts', { recursive: true });
  root = await mkdtemp(path.resolve('.artifacts/browser-tests-'));
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (root) await rm(root, { recursive: true, force: true });
});

async function withPage(run) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  try { return await run(await context.newPage()); }
  finally { await context.close(); }
}
async function output() { return mkdtemp(path.join(root, 'run-')); }
const task = () => ({ id: 'local', startURL: origin, goal: 'Search for the given terms and open the selected API document.', inputs: [{ id: 'query', text: 'abort controller' }], allowedOrigins: [origin] });

function fixtureClient(plans, inspect = () => {}) {
  let calls = 0;
  const client = new SystemOne({ apiKey: null, maxRetries: 0, fetch: async (_, init) => {
    const request = JSON.parse(init.body);
    inspect(request, calls);
    const plan = plans[calls++];
    assert.ok(plan, 'unexpected additional model request');
    const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
      let selected = Object.keys(question.criteria)[0];
      if (id === 'action') selected = plan.action;
      else if (question.instructions.action.id === plan.action && question.instructions.parameter === 'target') selected = Object.entries(question.criteria).find(([, entry]) => entry.name === plan.target)?.[0];
      else if (question.instructions.action.id === plan.action && question.instructions.parameter === 'value') selected = 'query';
      assert.ok(Object.hasOwn(question.criteria, selected), `fixture must choose a current candidate for ${id}`);
      return [id, { type: 'choice', choice: selected, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === selected ? 1 : 0])) }];
    }));
    return Response.json({ answers });
  } });
  return { client, calls: () => calls };
}

test('observation includes open Shadow DOM controls and excludes hidden, disabled and secret fields', async () => withPage(async page => {
  await page.setContent('<button disabled>Disabled</button><button hidden>Hidden</button><input type="password" value="private"><a href="#s" style="position:absolute;left:-10000px">Skip to search</a><div id="host"></div>');
  await page.evaluate(() => {
    document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<button>Search docs</button><label>Query<input type="search"></label>';
  });
  const captured = await observe(page);
  try {
    assert.deepEqual(captured.snapshot.targets.map(item => item.name).sort(), ['Query', 'Search docs']);
    assert.ok(!JSON.stringify(captured.snapshot).includes('private'));
    const target = captured.snapshot.targets.find(item => item.name === 'Query');
    const element = await captured.target(target);
    try { await element.fill('public query'); } finally { await element.dispose(); }
    assert.equal(await page.locator('input[type=search]').inputValue(), 'public query');
  } finally { await captured.dispose(); }
}));

test('a replaced element, changed href, changed label or changed field value invalidates the observation', async () => withPage(async page => {
  for (const change of ['replace', 'href', 'label', 'value']) {
    await page.setContent('<a href="https://example.org/a">Document</a><input aria-label="Query" value="original">');
    const captured = await observe(page);
    const target = captured.snapshot.targets.find(item => item.name === (change === 'value' ? 'Query' : 'Document'));
    await page.evaluate(change => {
      const anchor = document.querySelector('a');
      if (change === 'replace') anchor.replaceWith(anchor.cloneNode(true));
      if (change === 'href') anchor.href = 'https://example.org/b';
      if (change === 'label') anchor.textContent = 'Unrelated operation';
      if (change === 'value') document.querySelector('input').value = 'changed';
    }, change);
    await assert.rejects(captured.target(target), /stale-target/);
    await captured.dispose();
  }
}));

test('the decisions loop opens a form, fills, submits, follows a link and captures real server content', async () => withPage(async page => {
  const fixture = fixtureClient([
    { action: 'click', target: 'Open search' }, { action: 'fill', target: 'Search terms' },
    { action: 'enter', target: 'Search terms' }, { action: 'click', target: 'Selected API document' }, { action: 'finish' },
  ], (request, index) => {
    if (index === 0) {
      assert.ok(!Object.hasOwn(request.questions.action.criteria, 'fill'), 'closed search fields are not actions');
      assert.ok(!Object.hasOwn(request.questions.action.criteria, 'enter'));
    }
  });
  const result = await runBrowserTask(fixture.client, page, task(), { output: await output(), maxSteps: 6 });
  assert.equal(result.status, 'model-finished');
  assert.equal(fixture.calls(), 5);
  assert.equal(result.final.url, `${origin}/document`);
  assert.match(result.final.text, /actual terminal document/);
  assert.equal(searchRequests.at(-1), 'abort controller');
  assert.deepEqual(result.steps.map(step => step.outcome), ['executed', 'executed', 'executed', 'executed', 'model-finished']);
}));

test('model-finished never passes the independent website verifier on the wrong page', async () => withPage(async page => {
  const fixture = fixtureClient([{ action: 'finish' }]);
  const result = await runBrowserTask(fixture.client, page, task(), { output: await output() });
  assert.equal(result.status, 'model-finished');
  const verification = verifyBrowserTask('github-agents', result);
  assert.equal(verification.passed, false);
  assert.equal(verification.checks.examplesDirectoryURL, false);
}));

test('the step budget cannot become successful completion', async () => withPage(async page => {
  const fixture = fixtureClient([{ action: 'click', target: 'Open search' }]);
  const result = await runBrowserTask(fixture.client, page, task(), { output: await output(), maxSteps: 1 });
  assert.equal(result.status, 'step-limit');
  assert.equal(fixture.calls(), 1);
  assert.equal(verifyBrowserTask('mdn-abort', result).passed, false);
}));

test('pre-cancelled runs neither navigate nor invoke a model', async () => withPage(async page => {
  const controller = new AbortController();
  controller.abort();
  const fixture = fixtureClient([]);
  const result = await runBrowserTask(fixture.client, page, task(), { output: await output(), signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.equal(page.url(), 'about:blank');
  assert.equal(fixture.calls(), 0);
}));

test('cancellation during real SDK waiting prevents the planned browser action', async () => withPage(async page => {
  const controller = new AbortController();
  let calls = 0;
  const client = new SystemOne({ apiKey: null, fetch: async () => {
    calls++;
    controller.abort();
    return new Promise(() => {});
  } });
  const result = await runBrowserTask(client, page, task(), { output: await output(), signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.equal(calls, 1);
  assert.equal(await page.locator('form').isVisible(), false);
}));
