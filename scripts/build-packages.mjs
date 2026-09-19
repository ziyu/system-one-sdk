import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
const packages = ['core', 'adapter-system-one', 'adapter-llm', 'adapter-vercel', 'adapter-openrouter', 'adapter-cloudflare'];

for (const name of packages) {
  const directory = path.join(root, 'packages', name);
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  await rm(path.join(directory, 'dist'), { recursive: true, force: true });
  for (const args of [
    ['-p', 'tsconfig.json'],
    ['-p', 'tsconfig.json', '--module', 'CommonJS', '--moduleResolution', 'Node10', '--outDir', 'dist/cjs'],
  ]) {
    execFileSync(process.execPath, [tsc, ...args], { cwd: directory, stdio: 'inherit' });
  }
  await mkdir(path.join(directory, 'dist', 'cjs'), { recursive: true });
  await writeFile(path.join(directory, 'dist', 'cjs', 'package.json'), '{"type":"commonjs"}\n');
  console.log(`Built ${manifest.name}.`);
}
