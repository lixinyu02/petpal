import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {openUIPrompt} from '../src/openui/library.mjs';

// The service consumes a static guide, never imports the React SDK at startup.
const root = new URL('../', import.meta.url);
const publicDir = new URL('public/third-party/openui/', root);
await mkdir(publicDir, {recursive:true});
await mkdir(new URL('server/openui/', root), {recursive:true});
await writeFile(new URL('server/openui/prompt.txt', root), openUIPrompt, 'utf8');
const packages = ['@openuidev/lang-core', '@openuidev/react-lang', '@openuidev/observability', 'zod', 'ci-info'];
const licenses = [], dependencies = {};
for (const name of packages) {
  const base = new URL(`node_modules/${name}/`, root);
  const metadata = JSON.parse(await readFile(new URL('package.json', base), 'utf8'));
  let license;
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']) { try { license = await readFile(new URL(file, base), 'utf8'); break; } catch {} }
  if (!license) throw new Error(`Missing license: ${name}`);
  dependencies[name] = metadata.version;
  licenses.push(`${name}@${metadata.version} (${metadata.license})\n${license.trim()}`);
}
await writeFile(new URL('LICENSES.txt', publicDir), licenses.join('\n\n---\n\n')+'\n');
await writeFile(new URL('manifest.json', publicDir), JSON.stringify({dependencies, promptSha256:createHash('sha256').update(openUIPrompt).digest('hex'), runtime:'lazy Vite chunk using the application React instance'},null,2)+'\n');
console.log('OpenUI guide and dependency licenses generated from the locked component library.');
