// Published installer caches belong to the web download service, not the client.
import { cp, readdir } from 'node:fs/promises';
import path from 'node:path';

export function includeClientPayload(relative) {
  const normalized = relative.replaceAll('\\', '/');
  return normalized !== 'dist/downloads' && !normalized.startsWith('dist/downloads/');
}

export async function copyClientPayload(sourceRoot, targetRoot) {
  for (const name of ['dist', 'server', 'desktop']) {
    await cp(path.join(sourceRoot, name), path.join(targetRoot, name), {
      recursive: true,
      filter: file => includeClientPayload(path.relative(sourceRoot, file)),
    });
  }
}

export async function listClientPayloadFiles(root, relative) {
  const result = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = path.posix.join(relative, entry.name);
    if (!includeClientPayload(file)) continue;
    if (entry.isDirectory()) result.push(...await listClientPayloadFiles(root, file));
    else result.push(file);
  }
  return result;
}
