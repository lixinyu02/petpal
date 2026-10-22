import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Verify the actual deployable entry graph, rather than stale files in assets/. */
export function verifyOpenUIWebBuild(directory) {
  const root = path.resolve(directory);
  const manifest = JSON.parse(readFileSync(path.join(root, '.vite/manifest.json'), 'utf8'));
  const entry = manifest['index.html'];
  if (!entry?.isEntry) throw new Error('Missing web application entry. Build with vite build --manifest.');
  const visited = new Set(), queue = ['index.html'];
  for (const name of queue) {
    if (visited.has(name)) continue;
    const chunk = manifest[name];
    if (!chunk) throw new Error('Build manifest references a missing module.');
    visited.add(name);
    for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
      const target = path.resolve(root, file), relative = path.relative(root, target);
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep) || !statSync(target).isFile()) {
        throw new Error('Build references an unavailable asset.');
      }
    }
    queue.push(...(chunk.imports ?? []), ...(chunk.dynamicImports ?? []));
  }
  const renderer = 'src/openui/OpenUIBlock.tsx';
  if (!visited.has(renderer) || !manifest[renderer].isDynamicEntry) {
    throw new Error('This web entry cannot load the OpenUI card renderer. Do not deploy it.');
  }
  const html = readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
  const loadsEntry = scripts.some(([, attributes]) => {
    if (!/\btype\s*=\s*["']module["']/i.test(attributes)) return false;
    const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
    return [entry.file, '/' + entry.file, './' + entry.file].includes(source);
  });
  if (!loadsEntry) throw new Error('HTML entry and build manifest disagree.');
  return { entry: entry.file, renderer: manifest[renderer].file, modules: visited.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(verifyOpenUIWebBuild(process.argv[2] || 'dist'))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
