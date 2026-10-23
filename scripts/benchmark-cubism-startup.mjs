// Serve two immutable real-Cubism builds with the same document-start probe.
// No production state, browser profile, GPU cache or asset directory is changed.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, mkdir, open, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FROZEN_ROOT = path.join(ROOT, '.data/deep-fluidity-20261023');
const OUTPUT = path.join(ROOT, '.data/fluidity-followup-20261023/avatar-startup');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const MODES = new Set(['serve', 'selfcheck']);
const mode = process.argv[2];
assert.ok(MODES.has(mode) && process.argv.length === 3, 'Usage: node scripts/benchmark-cubism-startup.mjs serve|selfcheck');

function startupProbe() {
  'use strict';
  const script = document.currentScript;
  const identity = { variant: script.dataset.variant, buildDigest: script.dataset.buildDigest, probeSha256: script.dataset.probeSha256 };
  const start = performance.now(), timeOrigin = performance.timeOrigin;
  const calls = [], frames = [], visibility = [{ start, state: document.visibilityState }], errors = [], restored = [];
  const contexts = new WeakMap(); let nextContext = 0, finished = false, lastFrame = 0, raf = 0, result, saved = false, saving = false;
  const requestFrame = window.requestAnimationFrame.bind(window), cancelFrame = window.cancelAnimationFrame.bind(window);
  const runId = crypto.randomUUID();
  const methods = ['createProgram', 'compileShader', 'linkProgram', 'getShaderParameter', 'getProgramParameter'];
  const unsupportedMethods = [];
  const prototype = window.WebGL2RenderingContext?.prototype;
  for (const method of methods) {
    const original = prototype?.[method];
    if (typeof original !== 'function') { unsupportedMethods.push(method); continue; }
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
    const wrapped = function (...args) {
      if (finished) return Reflect.apply(original, this, args);
      if (!contexts.has(this)) contexts.set(this, ++nextContext);
      const at = performance.now(); let failed = false;
      try { return Reflect.apply(original, this, args); }
      catch (error) { failed = true; throw error; }
      finally { calls.push({ method, context: contexts.get(this), start: at, duration: performance.now() - at, failed }); }
    };
    Object.defineProperty(prototype, method, { configurable: true, writable: true, value: wrapped });
    restored.push(() => { if (prototype[method] !== wrapped) return; if (descriptor) Object.defineProperty(prototype, method, descriptor); else delete prototype[method]; });
  }
  const hidden = () => { if (!finished) visibility.push({ start: performance.now(), state: document.visibilityState }); };
  const error = event => { if (!finished) errors.push({ start: performance.now(), message: String(event.message || event.reason?.message || event.reason || 'Unknown error').slice(0, 500) }); };
  document.addEventListener('visibilitychange', hidden); window.addEventListener('error', error); window.addEventListener('unhandledrejection', error);
  let observer;
  const longTasks = [];
  try { observer = new PerformanceObserver(list => { if (!finished) for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration }); }); observer.observe({ type: 'longtask', buffered: true }); } catch {}

  function panel() {
    if (!document.body || document.getElementById('cubism-startup-result')) return;
    const section = document.createElement('section'); section.id = 'cubism-startup-result';
    section.setAttribute('aria-label', 'Cubism 启动采样');
    section.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:1000;max-width:min(430px,calc(100vw - 16px));max-height:40vh;overflow:auto;background:#fff;color:#222;border:1px solid #ddd;border-radius:10px;padding:10px;font:12px/1.5 system-ui;box-shadow:0 2px 12px #0002';
    const status = document.createElement('strong'); status.id = 'cubism-startup-status'; status.textContent = '正在记录真实 Cubism 启动…';
    const brief = document.createElement('div'); brief.id = 'cubism-startup-brief';
    const details = document.createElement('details'), summary = document.createElement('summary'), data = document.createElement('pre');
    summary.textContent = '查看原始采样 JSON'; data.id = 'cubism-startup-json'; data.style.whiteSpace = 'pre-wrap'; details.append(summary, data);
    const button = document.createElement('button'); button.id = 'cubism-startup-save'; button.textContent = '保存采样'; button.disabled = true; button.addEventListener('click', () => { void save(); });
    const receipt = document.createElement('span'); receipt.id = 'cubism-startup-saved'; section.append(status, brief, details, button, receipt); document.body.append(section);
  }
  async function save() {
    if (!result || saved || saving) return; saving = true;
    const button = document.getElementById('cubism-startup-save'); if (button) button.disabled = true;
    try {
      const response = await fetch('/__startup/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const receipt = await response.json(); saved = true;
      const target = document.getElementById('cubism-startup-saved'); if (target) target.textContent = ` 已保存 ${receipt.file}`;
    } catch (error) {
      const target = document.getElementById('cubism-startup-saved'); if (target) target.textContent = ` 保存失败：${String(error.message || error)}`;
    } finally { saving = false; if (button) button.disabled = saved; }
  }
  function complete(reason) {
    if (finished) return; finished = true; clearTimeout(timeout); cancelFrame(raf);
    const end = performance.now();
    if (observer) { for (const entry of observer.takeRecords()) longTasks.push({ start: entry.startTime, duration: entry.duration }); observer.disconnect(); }
    for (const restore of restored) restore();
    document.removeEventListener('visibilitychange', hidden); window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', error);
    let fixture;
    try { fixture = window.__avatarBench?.report(); } catch (error) { errors.push({ start: end, message: String(error.message || error) }); }
    const renderer = fixture?.renderer;
    const invalid = [];
    if (reason !== 'ready') invalid.push(reason);
    if (visibility.some(item => item.state !== 'visible') || document.hidden) invalid.push('document-not-continuously-visible');
    if (!fixture || fixture.readyAt === null || renderer?.mode !== 'cubism' || renderer?.renderer !== 'cubism' || !(renderer.frames > 0 && renderer.width > 0 && renderer.height > 0)) invalid.push('real-cubism-not-ready');
    if (unsupportedMethods.length) invalid.push('missing-webgl2-methods');
    if (errors.length || fixture?.errors?.length) invalid.push('page-error');
    if (calls.some(call => call.failed)) invalid.push('webgl-call-threw');
    const summary = Object.fromEntries(methods.map(method => {
      const values = calls.filter(call => call.method === method); return [method, { count: values.length, totalMs: values.reduce((sum, call) => sum + call.duration, 0), maxMs: values.reduce((max, call) => Math.max(max, call.duration), 0) }];
    }));
    result = { schemaVersion: 1, fixture: 'real-cubism-startup', syntheticOnly: true, runId, ...identity, timeOrigin, probeStart: start, end, durationMs: end - start, readyAt: fixture?.readyAt ?? null, valid: !invalid.length, invalidReasons: invalid, visibility, userAgent: navigator.userAgent, devicePixelRatio, viewport: { width: innerWidth, height: innerHeight }, unsupportedMethods, gl: { contextCount: nextContext, summary, calls }, frames, longTasks, errors, fixtureReport: fixture || null,
      metricMeaning: 'WebGL call duration is CPU wall time around actual browser calls, including any synchronous driver waits; it is not GPU execution time or display FPS. rAF starts before modules and ends after the first real Cubism frame. HTTP assets are no-store; GPU/driver/browser shader caches are not cleared.' };
    window.__cubismStartup = { report: () => result, save };
    panel();
    const status = document.getElementById('cubism-startup-status'); if (status) status.textContent = result.valid ? '启动采样完成' : '启动采样结束（无效）';
    const brief = document.getElementById('cubism-startup-brief'); if (brief) brief.textContent = `${identity.variant} · ready ${Number(result.readyAt || 0).toFixed(1)}ms · program ${summary.createProgram.count} · compile ${summary.compileShader.count}`;
    const data = document.getElementById('cubism-startup-json'); if (data) data.textContent = JSON.stringify(result, null, 2);
    const button = document.getElementById('cubism-startup-save'); if (button) button.disabled = false;
    void save();
  }
  function tick(now) {
    if (finished) return;
    frames.push({ start: now, intervalMs: lastFrame ? now - lastFrame : null }); lastFrame = now;
    const renderer = window.__avatarBench?.rendererState();
    if (renderer?.mode === 'cubism' && renderer.frames > 0) { complete('ready'); return; }
    if (renderer?.mode === 'fallback') { complete('fallback'); return; }
    raf = requestFrame(tick);
  }
  const timeout = setTimeout(() => complete('startup-timeout'), 30000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', panel, { once: true }); else panel();
  raf = requestFrame(tick);
}

const PROBE = Buffer.from(`(${startupProbe.toString()})();\n`), PROBE_SHA = sha(PROBE);
const SHA_PATTERN = /^[0-9a-f]{64}$/;
async function inventory(directory, prefix = '') {
  const files = [];
  const own = await lstat(directory); assert.ok(own.isDirectory() && !own.isSymbolicLink(), 'Only real frozen directories are allowed');
  for (const name of (await readdir(directory)).sort()) {
    const file = path.join(directory, name), item = await lstat(file); assert.ok(!item.isSymbolicLink(), 'No symbolic frozen files');
    if (item.isDirectory()) files.push(...await inventory(file, prefix + name + '/'));
    else { assert.ok(item.isFile()); const body = await readFile(file); files.push({ name: prefix + name, bytes: body.length, sha256: sha(body) }); }
  }
  return files;
}
function injectedHtml(html, identity) {
  const module = /<script\b[^>]*\btype=["']module["'][^>]*>/i.exec(html); assert.ok(module, 'Frozen HTML must contain the module entry');
  const tag = `<script src="/__startup/probe.js" data-variant="${identity.variant}" data-build-digest="${identity.buildDigest}" data-probe-sha256="${PROBE_SHA}"></script>\n`;
  return html.slice(0, module.index) + tag + html.slice(module.index);
}
async function frozen(variant, port) {
  const directory = path.join(FROZEN_ROOT, `followup-avatar-${variant}`), web = path.join(directory, 'web');
  const raw = await readFile(path.join(directory, 'build-receipt.json')), receipt = JSON.parse(raw);
  assert.equal(receipt.passed, true); assert.equal(receipt.backendUsed, false); assert.equal(receipt.hmr, false);
  assert.ok(Array.isArray(receipt.webFiles) && receipt.webFiles.length > 0);
  assert.deepEqual(await inventory(web), receipt.webFiles, `${variant} frozen resources changed`);
  const files = new Map(receipt.webFiles.map(item => [item.name, item]));
  const identity = { variant, port, origin: `http://127.0.0.1:${port}`, buildDigest: sha(raw), probeSha256: PROBE_SHA, gitHead: receipt.head };
  const original = await readFile(path.join(web, 'index.html'), 'utf8'), html = Buffer.from(injectedHtml(original, identity));
  return { ...identity, files, web, html, receipt, originalHtmlSha256: sha(original), servedHtmlSha256: sha(html) };
}
const before = await frozen('before', 45336), after = await frozen('after', 45337);
for (const [name, item] of before.files) if (name.startsWith('avatars/') || name.startsWith('vendor/')) assert.deepEqual(after.files.get(name), item, `Model/runtime/art mismatch: ${name}`);
const identity = build => ({ variant: build.variant, origin: build.origin, buildDigest: build.buildDigest, probeSha256: PROBE_SHA, gitHead: build.gitHead, originalHtmlSha256: build.originalHtmlSha256, servedHtmlSha256: build.servedHtmlSha256, resourceCount: build.files.size });
new vm.Script(PROBE.toString('utf8'), { filename: 'cubism-startup-probe.js' });
if (mode === 'selfcheck') {
  for (const build of [before, after]) {
    const served = build.html.toString('utf8'), original = await readFile(path.join(build.web, 'index.html'), 'utf8');
    assert.ok(served.indexOf('/__startup/probe.js') < served.indexOf('type="module"'));
    assert.equal(served.replace(/<script src="\/__startup\/probe.js"[^>]*><\/script>\n/, ''), original);
    assert.equal(sha(PROBE), build.probeSha256);
  }
  console.log(JSON.stringify({ passed: true, mode, frozenResourcesVerified: true, identicalProbe: true, injectedBeforeModules: true, originalHtmlOtherwiseUnchanged: true, modelRuntimeArtIdentical: true, browserTimingVerified: false, builds: [before, after].map(identity) }));
} else {
  const runDirectory = path.join(OUTPUT, 'runs'); await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  assert.ok(!(await lstat(runDirectory)).isSymbolicLink());
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.vert': 'text/plain', '.frag': 'text/plain' };
  const servers = [];
  async function serve(build) {
    const server = createServer(async (request, response) => {
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
      try {
        if (request.headers.host !== new URL(build.origin).host) { response.writeHead(403); response.end(); return; }
        const url = new URL(request.url, build.origin);
        if (request.method === 'POST' && url.pathname === '/__startup/report') {
          assert.equal(request.headers.origin, build.origin, 'Report must come from this origin');
          const chunks = []; let bytes = 0;
          for await (const chunk of request) { bytes += chunk.length; assert.ok(bytes <= 2 * 1024 * 1024, 'Oversized report'); chunks.push(chunk); }
          const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          assert.equal(report.schemaVersion, 1); assert.equal(report.fixture, 'real-cubism-startup'); assert.equal(report.syntheticOnly, true);
          assert.equal(report.variant, build.variant); assert.equal(report.buildDigest, build.buildDigest); assert.equal(report.probeSha256, PROBE_SHA);
          assert.ok(SHA_PATTERN.test(report.buildDigest) && SHA_PATTERN.test(report.probeSha256));
          assert.match(report.runId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/); assert.equal(typeof report.valid, 'boolean');
          assert.ok(Array.isArray(report.gl?.calls) && Array.isArray(report.frames));
          const name = `${build.variant}-${report.runId}.json`, target = path.join(runDirectory, name);
          const data = JSON.stringify({ ...report, server: identity(build) }, null, 2) + '\n';
          let handle;
          try { handle = await open(target, 'wx', 0o600); await handle.writeFile(data); await handle.sync(); }
          catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(await readFile(target, 'utf8'), data, 'Run ID already has different content'); }
          finally { await handle?.close(); }
          response.writeHead(201, { 'Content-Type': types['.json'] }); response.end(JSON.stringify({ file: `runs/${name}` })); return;
        }
        if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
        let body, type;
        if (url.pathname === '/__startup/probe.js') { body = PROBE; type = types['.js']; }
        else if (url.pathname === '/__startup/info') { body = Buffer.from(JSON.stringify(identity(build))); type = types['.json']; }
        else {
          const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
          const expected = build.files.get(name); if (!expected) { response.writeHead(404); response.end(); return; }
          const original = await readFile(path.join(build.web, name)); assert.equal(original.length, expected.bytes); assert.equal(sha(original), expected.sha256, 'Frozen file changed after startup');
          body = name === 'index.html' ? build.html : original; type = types[path.extname(name)] || 'application/octet-stream';
        }
        response.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length }); response.end(request.method === 'HEAD' ? undefined : body);
      } catch (error) { if (!response.headersSent) response.writeHead(400, { 'Content-Type': types['.json'] }); response.end(JSON.stringify({ error: String(error.message || error) })); }
    });
    servers.push(server);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(build.port, '127.0.0.1', resolve); });
  }
  try { await serve(before); await serve(after); }
  catch (error) { for (const server of servers) { server.closeAllConnections(); server.close(); } throw error; }
  console.log(JSON.stringify({ ready: true, syntheticOnly: true, output: OUTPUT, builds: [before, after].map(identity), stop: 'Send close followed by newline to this foreground stdin', cachePolicy: 'HTTP no-store; GPU/driver shader caches are not cleared' }));
  let closing = false, input = '';
  const close = () => { if (closing) return; closing = true; for (const server of servers) server.closeAllConnections(); Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))).then(() => process.exit(0)); };
  process.stdin.setEncoding('utf8'); process.stdin.on('data', value => { input += value; for (let index; (index = input.indexOf('\n')) >= 0;) { const line = input.slice(0, index).trim(); input = input.slice(index + 1); if (line === 'close') close(); } });
  process.stdin.on('end', close); process.stdin.resume(); process.once('SIGINT', close); process.once('SIGTERM', close);
}
