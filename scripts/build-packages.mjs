import { execFileSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildOrder } from './workspaces.mjs';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const selected = process.argv.slice(2).find(arg => arg !== '--check');
const order = buildOrder(selected);
for (const workspace of order) {
  const check = process.argv.includes('--check') && workspace === order.at(-1) && selected;
  if (!check) await rm(path.join(workspace.cwd, 'dist'), { recursive: true, force: true });
  for (const args of check ? [['--noEmit']] : [[], ['--module', 'CommonJS', '--moduleResolution', 'Node10', '--outDir', 'dist/cjs']]) {
    execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json', ...args], { cwd: workspace.cwd, stdio: 'inherit' });
  }
  if (!check) await writeFile(path.join(workspace.cwd, 'dist/cjs/package.json'), '{"type":"commonjs"}\n');
  console.log(`${check ? 'Checked' : 'Built'} ${workspace.manifest.name}.`);
}
