import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
// Only generated build output is replaced.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
for (const args of [
  ['-p', 'tsconfig.build.json'],
  ['-p', 'tsconfig.build.json', '--module', 'CommonJS', '--moduleResolution', 'Node10', '--outDir', 'dist/cjs'],
]) {
  execFileSync(process.execPath, [tsc, ...args], { stdio: 'inherit' });
}
await mkdir(new URL('../dist/cjs/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/cjs/package.json', import.meta.url), '{"type":"commonjs"}\n');
console.log('Built ESM, CommonJS, declarations, and source maps.');
