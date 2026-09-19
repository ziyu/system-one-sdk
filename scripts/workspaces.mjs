import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const workspaces = readdirSync(path.join(root, 'packages')).map(directory => {
  const cwd = path.join(root, 'packages', directory);
  return { directory, cwd, manifest: JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')) };
});

/** Include local dependencies first, using package manifests as the only package list. */
export function buildOrder(selected) {
  const result = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(workspace) {
    if (!workspace) throw new Error(`Unknown workspace: ${selected}`);
    if (visiting.has(workspace)) throw new Error(`Workspace dependency cycle at ${workspace.manifest.name}`);
    if (visited.has(workspace)) return;
    visiting.add(workspace);
    for (const dependency of Object.keys(workspace.manifest.dependencies ?? {})) {
      const local = workspaces.find(item => item.manifest.name === dependency);
      if (local) visit(local);
    }
    visiting.delete(workspace);
    visited.add(workspace);
    result.push(workspace);
  }
  if (selected) visit(workspaces.find(item => item.directory === selected || item.manifest.name === selected));
  else for (const workspace of workspaces) visit(workspace);
  return result;
}
