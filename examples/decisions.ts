import { runScenarioCli } from './scenarios/cli.js';

// Files are created in a new .artifacts/decision-examples/files-* workspace by default.
// Reuse it with --workspace and give your own natural-language instruction with --message.
await runScenarioCli('files');
