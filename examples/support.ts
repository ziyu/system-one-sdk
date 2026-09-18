import { runScenarioCli } from './scenarios/cli.js';

// Uses a persistent, local support queue. No customer system or email account is contacted.
await runScenarioCli('support');
