import type { BrowserRunResult, BrowserTask } from './agent.js';

export const browserTasks: Record<string, BrowserTask> = {
  'npm-sdk': {
    id: 'npm-sdk', startURL: 'https://www.npmjs.com/',
    goal: 'Search npm for the exact package @system-one-ai/sdk. Open its package page, follow its Repository link to GitHub, then open the LICENSE file and read its license. Finish on the actual LICENSE file page.',
    inputs: [{ id: 'package-name', text: '@system-one-ai/sdk' }],
    allowedOrigins: ['https://www.npmjs.com', 'https://github.com'],
  },
  'github-agents': {
    id: 'github-agents', startURL: 'https://github.com/search?type=repositories',
    goal: 'Find the official cloudflare/agents repository using GitHub search. Open that repository and then open its examples directory to see the available example projects. Finish inside the examples directory.',
    inputs: [{ id: 'repository-query', text: 'cloudflare agents' }],
    allowedOrigins: ['https://github.com'],
  },
  'mdn-abort': {
    id: 'mdn-abort', startURL: 'https://developer.mozilla.org/en-US/',
    goal: 'Use MDN search to find the AbortController documentation, then open the documentation for its abort() method. Read the method syntax and finish on that method documentation page.',
    inputs: [{ id: 'api-name', text: 'AbortController' }],
    allowedOrigins: ['https://developer.mozilla.org'],
  },
};

/** These assertions run AFTER the agent finishes. They never guide its choices. */
export function verifyBrowserTask(taskId: string, run: BrowserRunResult): { passed: boolean; checks: Record<string, boolean> } {
  const final = run.final;
  const pathname = final ? new URL(final.url).pathname : '';
  const actions = run.steps.filter(step => step.outcome === 'executed').map(step => step.action);
  const checks: Record<string, boolean> = {
    modelFinished: run.status === 'model-finished',
    expectedOrigin: final !== undefined && new URL(final.url).origin === (taskId === 'mdn-abort' ? 'https://developer.mozilla.org' : 'https://github.com'),
    browserInputExecuted: actions.includes('fill'),
    browserClickExecuted: actions.includes('click'),
    multipleModelDecisions: run.steps.length >= 3,
  };
  if (taskId === 'npm-sdk') {
    checks.repositoryLicenseURL = /^\/ziyu\/sytem-one-sdk\/blob\/[^/]+\/LICENSE$/.test(pathname);
    checks.licenseActuallyRendered = /MIT License/.test(final?.text ?? '') && /Permission is hereby granted/.test(final?.text ?? '');
    checks.npmPackageVisited = run.steps.some(step => /^https:\/\/www\.npmjs\.com\/package\/@system-one-ai\/sdk(?:$|\?)/.test(String((step.before as { url: string }).url)));
  } else if (taskId === 'github-agents') {
    checks.examplesDirectoryURL = /^\/cloudflare\/agents\/tree\/[^/]+\/examples$/.test(pathname);
    checks.repositoryRendered = /agents/.test(final?.title ?? '') && /examples/.test(final?.text ?? '');
  } else if (taskId === 'mdn-abort') {
    checks.methodURL = pathname.replace(/\/$/, '') === '/en-US/docs/Web/API/AbortController/abort';
    checks.methodActuallyRendered = /abort\(\)/.test(final?.text ?? '') && /Syntax/.test(final?.text ?? '');
  } else throw new Error('No independent verifier is registered for this task.');
  return { passed: Object.values(checks).every(Boolean), checks };
}
