import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { workspaces } from './workspaces.mjs';

const exportsBySpecifier = new Map();
for (const { cwd, manifest } of workspaces) {
  for (const [subpath, entry] of Object.entries(manifest.exports ?? {})) {
    const target = typeof entry === 'string' ? entry : typeof entry.import === 'string' ? entry.import : entry.import?.default;
    if (!target) continue;
    const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
    exportsBySpecifier.set(specifier, pathToFileURL(path.resolve(cwd, target)).href);
  }
}

export function resolve(specifier, context, nextResolve) {
  const url = exportsBySpecifier.get(specifier);
  return nextResolve(url ?? specifier, context);
}
