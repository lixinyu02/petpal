// Isolated actual Cubism fixture. Builds/serves only task-private artifacts.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, open, readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'tests/fixtures/deep-fluidity-avatar');
const ALLOWED = path.join(ROOT, '.data/deep-fluidity-20261023');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2), mode = args.shift(), options = {};
while (args.length) { const key = args.shift(), value = args.shift(); assert.ok(/^--[a-z-]+$/.test(key) && value && !value.startsWith('--'), 'Expected --option value'); assert.ok(!(key in options), 'Duplicate option'); options[key] = value; }
assert.ok(['build', 'serve', 'selfcheck'].includes(mode), 'Expected build, serve or selfcheck');
assert.ok(Object.keys(options).every(key => ['--out', '--expected-head', '--port', '--model-delay-ms'].includes(key)));
const OUTPUT = path.resolve(ROOT, options['--out'] || '.data/deep-fluidity-20261023/avatar-baseline');
assert.ok(OUTPUT.startsWith(ALLOWED + path.sep), 'Output must remain in this task private directory');
const WEB = path.join(OUTPUT, 'web');
const write = async (file, value) => { const handle = await open(file, 'wx', 0o600); try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); } };
async function files(root) { const item = await lstat(root); assert.ok(!item.isSymbolicLink()); if (item.isFile()) return [root]; assert.ok(item.isDirectory()); const result = []; for (const name of (await readdir(root)).sort()) result.push(...await files(path.join(root, name))); return result; }
const normalized = file => path.relative(ROOT, file).replaceAll('\\', '/');
async function inventory(root) { const result = []; for (const file of await files(root)) { const bytes = await readFile(file); result.push({ name: path.relative(root, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes) }); } return result; }
if (mode === 'build') {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  if (options['--expected-head']) assert.ok(head.startsWith(options['--expected-head']), 'Git HEAD differs from requested baseline');
  await mkdir(OUTPUT, { recursive: true, mode: 0o700 });
  assert.deepEqual(await readdir(OUTPUT), [], 'Use a new empty output directory; earlier evidence must remain');
  const { build } = await import('vite'), { default: react } = await import('@vitejs/plugin-react');
  const inputs = new Map();
  await build({
    configFile: false, root: FIXTURE, publicDir: false,
    define: { __PETPAL_VERSION__: JSON.stringify('0.9.14'), 'process.env.OPENUI_RUNTIME_TELEMETRY_ENABLED': '"0"' },
    plugins: [{ name: 'bench-source-fingerprint', enforce: 'pre', async transform(_code, id) {
      const file = id.split('?')[0];
      if (!file.startsWith(ROOT + path.sep) && !file.startsWith(ROOT.replaceAll('\\', '/') + '/')) return;
      if (file.includes('node_modules') || !/\.(?:tsx?|mjs|css)$/.test(file)) return;
      const bytes = await readFile(file), prior = inputs.get(file); if (prior) assert.equal(prior.sha256, sha(bytes), 'Build source changed');
      inputs.set(file, { name: normalized(file), bytes: bytes.length, sha256: sha(bytes) });
    } }, react()],
    build: { outDir: WEB, emptyOutDir: false, manifest: true, rollupOptions: { output: { manualChunks: id => /\/node_modules\/three\//.test(id.replaceAll('\\', '/')) ? 'three' : undefined } } },
  });
  // Freeze the real bundled model, official Framework/Core, and existing same-
  // character preview/recovery art. No symlink into mutable production assets.
  for (const relative of ['avatars/akari-cubism-v12', 'avatars/cubism-runtime', 'avatars/akari', 'vendor/live2d']) {
    const source = path.join(ROOT, 'public', relative); await files(source); await cp(source, path.join(WEB, relative), { recursive: true, errorOnExist: true, force: false });
  }
  for (const [file, expected] of inputs) { const bytes = await readFile(file); assert.equal(bytes.length, expected.bytes); assert.equal(sha(bytes), expected.sha256, 'Build source changed during compilation'); }
  const sourceFiles = [...inputs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const receipt = { passed: true, at: new Date().toISOString(), head, sourceMeaning: 'Production Vite build from these actual on-disk source fingerprints; no clean-HEAD claim', sourceFiles, webFiles: await inventory(WEB), fixture: 'actual CompanionScene/CubismScene/V12/Core', hmr: false, productionChanged: false, backendUsed: false, privateValuesIncluded: false };
  assert.ok(sourceFiles.some(item => item.name.endsWith('CubismScene.tsx')) && sourceFiles.some(item => item.name.endsWith('runtime.mjs')));
  await write(path.join(OUTPUT, 'build-receipt.json'), receipt);
  console.log(JSON.stringify({ passed: true, out: normalized(OUTPUT), sourceFiles: sourceFiles.length, webFiles: receipt.webFiles.length, head, hmr: false }));
} else if (mode === 'selfcheck') {
  const receipt = JSON.parse(await readFile(path.join(OUTPUT, 'build-receipt.json'), 'utf8'));
  assert.deepEqual(await inventory(WEB), receipt.webFiles);
  const html = await readFile(path.join(WEB, 'index.html'), 'utf8'); assert.ok(html.includes('/assets/')); assert.ok(!html.includes('/@vite/client'));
  const model = JSON.parse(await readFile(path.join(WEB, 'avatars/akari-cubism-v12/akari.model3.json'), 'utf8'));
  assert.ok(model.FileReferences.Moc.endsWith('.moc3')); assert.equal(model.FileReferences.Textures.length, 1);
  await stat(path.join(WEB, 'avatars/akari-cubism-v12', model.FileReferences.Moc));
  await stat(path.join(WEB, 'avatars/akari-cubism-v12', model.FileReferences.Textures[0]));
  await stat(path.join(WEB, 'vendor/live2d/live2dcubismcore.min.js'));
  await stat(path.join(WEB, 'avatars/cubism-runtime/framework.mjs'));
  console.log(JSON.stringify({ passed: true, staticIntegrity: true, hmr: false, realAssetsPresent: true, browserRenderVerified: false, files: receipt.webFiles.length }));
} else {
  const receipt = JSON.parse(await readFile(path.join(OUTPUT, 'build-receipt.json'), 'utf8'));
  const port = Number(options['--port'] || 4546), modelDelayMs = Number(options['--model-delay-ms'] || 0);
  assert.ok(Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
  assert.ok(Number.isSafeInteger(modelDelayMs) && modelDelayMs >= 0 && modelDelayMs <= 2000);
  const origin = `http://127.0.0.1:${port}`, reportDirectory = path.join(OUTPUT, 'reports');
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.vert': 'text/plain', '.frag': 'text/plain' };
  let serial = 0;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin); response.setHeader('X-Content-Type-Options', 'nosniff');
      if (url.pathname === '/__bench/info' && request.method === 'GET') { response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify({ head: receipt.head, modelDelayMs, delayMeaning: 'Controlled local avatar-resource response delay, not public-network SLA', productionBuild: true, hmr: false })); return; }
      if (url.pathname === '/__bench/report' && request.method === 'POST') {
        assert.equal(request.headers.origin, origin, 'Only the local fixture may save reports');
        let bytes = 0; const chunks = []; for await (const chunk of request) { bytes += chunk.length; assert.ok(bytes <= 4 * 1024 * 1024); chunks.push(chunk); }
        const report = JSON.parse(Buffer.concat(chunks).toString('utf8')); assert.equal(report.fixture, 'real-cubism-isolated'); assert.equal(report.schemaVersion, 1); assert.ok(Array.isArray(report.samples));
        const file = `report-${Date.now()}-${++serial}.json`;
        await write(path.join(reportDirectory, file), { ...report, server: { head: receipt.head, modelDelayMs, productionBuild: true, hmr: false }, buildReceiptSha256: sha(await readFile(path.join(OUTPUT, 'build-receipt.json'))) });
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ passed: true, file })); return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname), target = path.resolve(WEB, '.' + name);
      assert.ok(target.startsWith(WEB + path.sep), 'Path outside frozen build');
      const item = await lstat(target); assert.ok(item.isFile() && !item.isSymbolicLink());
      response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
      response.setHeader('Content-Length', item.size);
      const avatarResource = name.startsWith('/avatars/') || name.startsWith('/vendor/live2d/');
      response.setHeader('Cache-Control', avatarResource ? 'no-store' : 'no-cache');
      if (avatarResource && modelDelayMs) await new Promise(resolve => setTimeout(resolve, modelDelayMs));
      response.writeHead(200); if (request.method === 'HEAD') response.end(); else createReadStream(target).pipe(response);
    } catch (error) { if (!response.headersSent) response.writeHead(error.code === 'ENOENT' ? 404 : 400); response.end('Fixture request refused'); }
  });
  server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ ready: true, url: origin, head: receipt.head, modelDelayMs, hmr: false, reportDirectory: normalized(reportDirectory), productionChanged: false })));
}
