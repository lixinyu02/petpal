import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openCliQueryPolicy, resolveOpenCliQueryBundle, validateOpenCliQuery, OPENCLI_VERSION } from './opencli-sites.mjs';

// This process never imports the CLI entry, HOME adapters, plugins or user hooks.
let deadline, networkController;
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString('utf8');
    if (Buffer.byteLength(input) > 16384) throw new Error('OpenCLI 查询输入过大。');
  }
  const request = validateOpenCliQuery(JSON.parse(input));
  const policy = openCliQueryPolicy(request.site, request.command);
  const bundle = await resolveOpenCliQueryBundle();
  const manifest = JSON.parse(await readFile(path.join(bundle.root, 'cli-manifest.json'), 'utf8'));
  const entry = manifest.find(item => item.site === request.site && item.name === request.command);
  if (!entry || entry.modulePath !== policy.modulePath || entry.access !== 'read' || entry.strategy !== 'public' || entry.browser !== false) throw new Error('内置查询命令与已审阅版本不匹配。');
  const modulePath = path.join(bundle.root, 'clis', policy.modulePath);
  const canonical = await realpath(modulePath), canonicalRoot = await realpath(path.join(bundle.root, 'clis'));
  if (path.relative(canonicalRoot, canonical).startsWith('..') || path.isAbsolute(path.relative(canonicalRoot, canonical))) throw new Error('OpenCLI 模块路径越界。');
  // Only the fixed hosts used by the reviewed module can receive HTTP requests.
  const originalFetch = globalThis.fetch.bind(globalThis);
  const hosts = new Set(policy.hosts);
  const controller = new AbortController(); networkController = controller;
  deadline = setTimeout(() => controller.abort(new Error('OpenCLI 网站查询超时。')), 25000);
  globalThis.fetch = async (input, init = {}) => {
    if (!(typeof input === 'string' || input instanceof URL)) throw new Error('公开网站查询仅接受内置 URL 请求。');
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET' && !(request.site === 'juejin' && request.command === 'recommend' && method === 'POST')) throw new Error('OpenCLI 查询 HTTP 方法未开放。');
    let url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    for (let redirects = 0; redirects < 5; redirects++) {
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.has(url.hostname)) throw new Error('OpenCLI 请求地址不在此命令的固定网站范围内。');
      const headers = new Headers(init.headers);
      if (['authorization', 'cookie', 'proxy-authorization'].some(name => headers.has(name))) throw new Error('公开网站查询不能携带凭据。');
      const response = await originalFetch(url, { ...init, headers, redirect: 'manual', credentials: 'omit', signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.ok) { await response.body?.cancel(); throw new Error(`OpenCLI 网站返回 HTTP ${response.status}。`); }
        if (!response.body) return response;
        const reader = response.body.getReader(), chunks = []; let bytes = 0;
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('OpenCLI 网站原始响应过大。'); } chunks.push(Buffer.from(value)); } }
        finally { reader.releaseLock(); }
        return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new Error('OpenCLI 网站重定向缺少地址。');
      url = new URL(location, url);
    }
    throw new Error('OpenCLI 网站重定向过多。');
  };
  const registry = await import(pathToFileURL(path.join(bundle.root, 'dist/src/registry.js')).href);
  await import(pathToFileURL(modulePath).href);
  const command = registry.getRegistry().get(`${request.site}/${request.command}`);
  if (!command || command.browser !== false || command.access !== 'read' || command.strategy !== 'public') throw new Error('OpenCLI 已加载命令不匹配。');
  const { executeCommand } = await import(pathToFileURL(path.join(bundle.root, 'dist/src/execution.js')).href);
  const result = await executeCommand(command, request.arguments);
  clearTimeout(deadline);
  const rows = Array.isArray(result) ? result : result === undefined || result === null ? [] : [result];
  if (rows.length > 200) throw new Error('OpenCLI 网站返回项目过多。');
  const output = JSON.stringify({ site: request.site, command: request.command, version: OPENCLI_VERSION, rows, count: rows.length });
  if (Buffer.byteLength(output) > 128 * 1024) throw new Error('OpenCLI 网站返回内容过大。');
  process.stdout.write(output + '\n');
  // Let Node drain stdout and network cleanup. Forced process.exit can race
  // Undici/libuv async handle closure on Windows after a successful fetch.
  process.exitCode = 0;
} catch (error) {
  networkController?.abort(error);
  process.stderr.write(String(error?.message || 'OpenCLI 查询失败。').slice(0, 1200) + '\n');
  process.exitCode = 1;
} finally { clearTimeout(deadline); }
