import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'vendor/cubism-web-framework');
const destination = path.join(root, 'public/avatars/cubism-runtime');
const receipt = JSON.parse(await fs.readFile(path.join(source, 'provenance.json'), 'utf8'));
if (receipt.commit !== 'd4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b') throw new Error('Unexpected Cubism Framework source revision.');
for (const record of receipt.files) {
  const bytes = await fs.readFile(path.join(source, record.path));
  if (bytes.length !== record.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new Error(`Cubism source changed: ${record.path}`);
}
await fs.mkdir(destination, { recursive: true });
await build({ entryPoints: [path.join(source, 'petpal-entry.ts')], outfile: path.join(destination, 'framework.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof', sourcemap: false });
await fs.cp(path.join(source, 'Shaders/WebGL'), path.join(destination, 'Shaders/WebGL'), { recursive: true });
await fs.copyFile(path.join(source, 'LICENSE.md'), path.join(destination, 'LICENSE.md'));
await fs.copyFile(path.join(source, 'NOTICE.md'), path.join(destination, 'NOTICE.md'));
const output = await fs.readFile(path.join(destination, 'framework.mjs'));
await fs.writeFile(path.join(destination, 'framework-provenance.json'), JSON.stringify({ sourceRepository: receipt.repository, sourceCommit: receipt.commit, sampleCommit: receipt.sample_commit, bundleBytes: output.length, bundleSha256: crypto.createHash('sha256').update(output).digest('hex'), compiler: 'esbuild', includesCore: false }, null, 2) + '\n');
console.log(JSON.stringify({ event: 'cubism-framework-bundled', bytes: output.length, coreIncluded: false, commit: receipt.commit }));
