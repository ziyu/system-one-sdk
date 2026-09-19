import { execFileSync } from 'node:child_process';
import { buildOrder, root } from './workspaces.mjs';

const target = buildOrder(process.argv[2]).at(-1);
if (!process.argv[2]) throw new Error('Specify a workspace.');
execFileSync(process.execPath, ['scripts/build-packages.mjs', target.directory], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, ['tests/package-contracts.mjs', target.directory], { cwd: root, stdio: 'inherit' });
