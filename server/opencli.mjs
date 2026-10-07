import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { browserQueryPolicy, normalizeSiteOrigins, validateBrowserQueryUrl } from './opencli-browser-policies.mjs';
import { validateOpenCliQuery } from './opencli-sites.mjs';
import { BROWSER_ADAPTER_ERRORS, assertBrowserAdapterUrl, browserAdapterOrigins, browserAdapterNetworkRules, runBrowserAdapter } from './opencli-browser-adapters.mjs';

const require = createRequire(import.meta.url);
const VERSION = '1.8.8';
const PORT = 19825;
const EXTENSION_URL = 'https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk';
const POLICY_NOTE = '小伴使用独立网页租约，可能复用 OpenCLI 分组内无活跃租约的空闲页。来源检查不是网络沙箱；网页跳转与已发送操作可能在检查或取消前发生，不会自动重试。';
const abortError = () => Object.assign(new Error('浏览器操作已取消；已发送操作的结果可能未知'), { name: 'AbortError' });
const checkAbort = (signal) => { if (signal?.aborted) throw abortError(); };
const profileCompatible = (profile) => {
  const match = /^1\.(\d+)\.(\d+)$/.exec(String(profile?.extensionVersion || ''));
  return profile?.extensionConnected === true && Boolean(match && (Number(match[1]) > 0 || Number(match[2]) >= 24));
};
const cleanText = (value, limit = 16000) => String(value ?? '')
  .replace(/\b(sk-[\w-]{8,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[已隐藏]')
  .replace(/(Bearer\s+)[^\s"']+/gi, '$1[已隐藏]')
  .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|authorization)\s*[=:]\s*["']?)[^\s"',;&]+/gi, '$1[已隐藏]')
  .replace(/([?&#](?:token|key|code|session|auth)[^=&#]*=)[^&#\s"']+/gi, '$1[已隐藏]')
  .slice(0, limit);

export function browserWebUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('需要有效的 HTTP(S) 网页地址');
  let url;
  try { url = new URL(value); } catch { throw new Error('需要有效的 HTTP(S) 网页地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('只支持无 URL 登录凭据的 HTTP(S) 网页地址');
  return url.href;
}

export function browserDocumentExpression(code, url, { documentId, initializeDocument = false } = {}) {
  const expected = browserWebUrl(url);
  const documentGuard = documentId ? `${initializeDocument ? `document.__petpalOpencliSnapshot = ${JSON.stringify(documentId)};` : ''} if (document.__petpalOpencliSnapshot !== ${JSON.stringify(documentId)}) throw new Error('页面已刷新，请重新读取快照');` : '';
  return `(() => { if (!['http:', 'https:'].includes(location.protocol)) throw new Error('PetPal webpage rejected'); if (location.href !== ${JSON.stringify(expected)}) throw new Error('页面已跳转，请重新读取快照'); ${documentGuard} return (${code}); })()`;
}

/** Strict public boundary. No arbitrary selector, JavaScript, adapter, path or CLI argument. */
export function validateBrowserAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('浏览器操作参数无效');
  const fields = {
    connect: ['profileId'], tabs: ['profileId'], open: ['profileId', 'url'],
    snapshot: ['profileId', 'tabId'], click: ['profileId', 'tabId', 'target'],
    fill: ['profileId', 'tabId', 'target', 'text'], key: ['profileId', 'tabId', 'key'], close: ['profileId', 'tabId'],
  };
  if (!Object.hasOwn(fields, input.action)) throw new Error('不支持的浏览器操作');
  if (Object.keys(input).some((key) => key !== 'action' && !fields[input.action].includes(key))) throw new Error('浏览器操作含不支持的字段');
  const args = { ...input };
  for (const key of ['profileId', 'tabId']) {
    if (args[key] !== undefined && (typeof args[key] !== 'string' || !/^[\w][\w.:-]{0,127}$/.test(args[key]))) throw new Error(`${key} 无效`);
  }
  if (['snapshot', 'click', 'fill', 'key'].includes(args.action) && !args.tabId) throw new Error('请选择小伴创建的标签页');
  if (args.action === 'open') args.url = browserWebUrl(args.url);
  if (['click', 'fill'].includes(args.action) && (!Number.isSafeInteger(args.target) || args.target < 0 || args.target > 100000)) throw new Error('target 必须是最近快照中的数字编号');
  if (args.action === 'fill' && (typeof args.text !== 'string' || args.text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(args.text))) throw new Error('输入内容须为最多 2000 字的文本');
  if (args.action === 'key' && !['Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(args.key)) throw new Error('仅允许回车、退出、方向键和空格');
  return args;
}

export function describeBrowserAction(input) {
  const args = validateBrowserAction(input);
  const labels = { connect: '连接浏览器扩展', tabs: '查看小伴的网页标签页', open: '打开网页', snapshot: '读取网页', click: '点击页面控件', fill: '填写页面文本', key: '按页面按键', close: '关闭小伴浏览器连接或标签页' };
  return `${labels[args.action]}${args.url ? `：${cleanText(args.url, 300)}` : ''}${args.target !== undefined ? `（控件 ${args.target}）` : ''}${args.key ? `（${args.key}）` : ''}${args.profileId ? ` · ${cleanText(args.profileId, 128)}` : ''}`;
}

export async function resolveBundledOpenCli(packageJsonPath) {
  if (!packageJsonPath) {
    try { packageJsonPath = path.resolve(path.dirname(require.resolve('@jackwener/opencli')), '..', '..', 'package.json'); }
    catch (error) { if (error.code === 'MODULE_NOT_FOUND') return null; throw error; }
  }
  const root = path.dirname(packageJsonPath.replace(/\.asar([\\/])/i, '.asar.unpacked$1'));
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (metadata.name !== '@jackwener/opencli' || metadata.version !== VERSION) throw new Error('内置 OpenCLI 版本不匹配');
  const entry = path.join(root, 'dist', 'src', 'main.js');
  const daemon = path.join(root, 'dist', 'src', 'daemon.js');
  const basePage = path.join(root, 'dist', 'src', 'browser', 'base-page.js');
  for (const file of [entry, daemon, basePage, path.join(root, 'LICENSE')]) if (!(await stat(file)).isFile()) throw new Error('内置 OpenCLI 不完整');
  return { root, entry, daemon, basePage, version: metadata.version };
}

/** All isolation variables belong to the child only; the host environment is never changed. */
export function openCliEnvironment(dataDir, inherited = process.env) {
  const childHome = path.join(path.resolve(dataDir), 'opencli', 'home');
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']) {
    if (inherited[key] !== undefined) env[key] = inherited[key];
  }
  Object.assign(env, { HOME: childHome, USERPROFILE: childHome, OPENCLI_CONFIG_DIR: path.join(childHome, '.opencli'),
    XDG_CONFIG_HOME: path.join(childHome, '.config'), XDG_CACHE_HOME: path.join(childHome, '.cache'),
    APPDATA: path.join(childHome, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(childHome, 'AppData', 'Local'),
    CI: '1', ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' });
  return env;
}

async function portBusy(port = PORT) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (busy) => { socket.destroy(); resolve(busy); };
    socket.once('connect', () => finish(true));
    socket.once('error', (error) => finish(error.code !== 'ECONNREFUSED'));
    socket.setTimeout(800, () => finish(true));
  });
}

async function readJson(response, maxBytes = 262144) {
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) { await reader.cancel(); throw new Error('浏览器响应超出长度限制'); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

/**
 * Owns the official daemon child, but deliberately bypasses upstream CLI browser
 * lifecycle/retry code (which can kill/restart an unrelated daemon). The public
 * operations below use OpenCLI's real finite page methods and daemon protocol.
 * Origin checks are a policy aid, not a navigation/network security sandbox.
 */
export class OpenCliRunner {
  constructor({ dataDir, packageJsonPath, runtime = process.execPath, transport, launch, checkPort, timeoutMs = 20000, shutdownTimeoutMs = 1500 } = {}) {
    if (!dataDir) throw new Error('OpenCLI 需要独立数据目录');
    this.dataDir = path.resolve(dataDir);
    this.packageJsonPath = packageJsonPath;
    this.runtime = runtime;
    // Dependency injection is server-only; none of these fields are accepted by execute().
    this.transport = transport || fetch;
    this.launch = launch || spawn;
    this.checkPort = checkPort || portBusy;
    this.timeoutMs = timeoutMs;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.stopping = null;
    this.child = null;
    this.sharedPid = null;
    this.selectedProfileId = null;
    this.session = `petpal-${randomUUID()}`;
    this.tabs = new Map();
    this.adapterLeases = new Map();
    this.adapterOperation = null;
    this.busy = false;
    this.controller = null;
    this.closed = false;
  }

  async #bundle() { return resolveBundledOpenCli(this.packageJsonPath); }
  #owns(status) { return Boolean(this.child && !this.child.killed && this.child.exitCode === null && status?.pid === this.child.pid && status.daemonVersion === VERSION); }
  #attached(status) { return this.#owns(status) || Boolean(this.sharedPid && status?.pid === this.sharedPid && status.daemonVersion === VERSION); }
  async #request(endpoint, body, signal, timeout = this.timeoutMs) {
    checkAbort(signal);
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    const response = await this.transport(`http://127.0.0.1:${PORT}${endpoint}`, {
      method: body ? 'POST' : 'GET', headers: { 'X-OpenCLI': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: combined,
    });
    const result = await readJson(response);
    checkAbort(signal);
    if (!response.ok || result?.ok === false) throw new Error('OpenCLI 浏览器桥操作失败；请检查扩展连接与页面状态');
    return result;
  }
  async #rawStatus() { try { return await this.#request('/status', null, null, 900); } catch { return null; } }

  async status() {
    const [bundle, raw] = await Promise.all([this.#bundle().catch(() => null), this.#rawStatus()]);
    const owned = this.#owns(raw);
    const attached = this.#attached(raw);
    const compatible = Boolean(raw?.daemonVersion === VERSION && Number.isSafeInteger(raw.pid) && raw.pid > 0);
    const state = owned ? 'owned' : attached ? 'shared' : raw ? 'external' : await this.checkPort(PORT) ? 'unavailable' : 'stopped';
    const profiles = attached && Array.isArray(raw.profiles) ? raw.profiles.filter((p) => typeof p.contextId === 'string' && /^[\w][\w.:-]{0,127}$/.test(p.contextId)).map((p) => ({ id: p.contextId, label: p.contextId, connected: profileCompatible(p) })) : [];
    const connected = profiles.some((p) => p.connected);
    const ready = Boolean(bundle && attached && this.selectedProfileId && profiles.some((p) => p.id === this.selectedProfileId && p.connected));
    return { available: Boolean(bundle), version: bundle?.version || null, runtime: 'bundled',
      daemon: { state, owned, port: PORT, compatible }, extension: { connected, required: true, installUrl: EXTENSION_URL },
      profiles, selectedProfileId: this.selectedProfileId, ready, websiteAccess: 'all', allowedOrigins: [], policyNote: POLICY_NOTE,
      message: !bundle ? '内置 OpenCLI 不完整' : state === 'external' && compatible ? '发现兼容的 OpenCLI；点击连接将使用独立页面租约，不接管或重启进程'
        : state === 'external' || state === 'unavailable' ? '端口 19825 被不兼容进程占用；请先自行结束其他 OpenCLI，小伴不会接管或重启它'
        : !attached ? '点击连接以启动小伴的 OpenCLI 浏览器桥' : !connected ? '等待兼容的 Chrome OpenCLI 扩展连接（1.0.24 或更新的 1.x 版本）；请安装或更新扩展并打开浏览器'
          : !ready ? '请选择已连接的 Chrome 配置；不会自动选择' : '浏览器桥已连接，可以访问任意 HTTP(S) 网站' };
  }

  async #connect(args, signal) {
    const bundle = await this.#bundle();
    if (!bundle) throw new Error('未安装内置 OpenCLI');
    let raw = await this.#rawStatus();
    checkAbort(signal);
    if (!this.#attached(raw) && raw?.daemonVersion === VERSION && Number.isSafeInteger(raw.pid) && raw.pid > 0) {
      if (this.tabs.size || this.adapterLeases.size) throw new Error('浏览器桥进程已改变，请先断开旧连接');
      this.sharedPid = raw.pid;
    }
    if (!this.#attached(raw)) {
      if (raw || await this.checkPort(PORT)) throw new Error('OpenCLI 端口已被其他进程使用，小伴不会接管');
      checkAbort(signal);
      const env = openCliEnvironment(this.dataDir);
      await mkdir(env.HOME, { recursive: true });
      checkAbort(signal);
      const child = this.launch(this.runtime, [bundle.daemon], { env, cwd: env.HOME, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
      this.child = child;
      let launchError = false;
      child.on('error', () => { launchError = true; });
      // Drain bounded diagnostics without forwarding upstream logs or secrets.
      child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
      child.once('close', () => { if (this.child === child) { this.child = null; this.tabs.clear(); this.selectedProfileId = null; } });
      const deadline = Date.now() + Math.min(this.timeoutMs, 5000);
      while (Date.now() < deadline && !launchError && child.exitCode === null) {
        checkAbort(signal);
        raw = await this.#rawStatus();
        if (this.#owns(raw)) break;
        if (raw) break;
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
      if (!this.#owns(raw)) { await this.#stopChild(); throw new Error('无法取得小伴专属 OpenCLI 进程；没有接管外部进程'); }
    }
    checkAbort(signal);
    if (args.profileId) {
      if (!raw.profiles?.some((p) => p.contextId === args.profileId && profileCompatible(p))) throw new Error('所选 Chrome 配置未连接或扩展低于 1.0.24，请刷新扩展状态');
      if (this.selectedProfileId && this.selectedProfileId !== args.profileId && (this.tabs.size || this.adapterLeases.size)) throw new Error('请先关闭当前小伴标签页，再切换 Chrome 配置');
      this.selectedProfileId = args.profileId;
    }
    return { action: 'connect', ...await this.status() };
  }

  async #command(action, params, signal, session = this.session) {
    checkAbort(signal);
    const raw = await this.#rawStatus();
    checkAbort(signal);
    if (!this.#attached(raw)) throw new Error('小伴浏览器桥已断开；请手动重新连接');
    if (!this.selectedProfileId || !raw.profiles?.some((p) => p.contextId === this.selectedProfileId && profileCompatible(p))) throw new Error('请先显式选择已连接且扩展兼容的 Chrome 配置');
    return this.#request('/command', { id: `petpal_${randomUUID()}`, action, ...params,
      contextId: this.selectedProfileId, session, surface: 'browser', windowMode: 'foreground', idleTimeout: 600,
      timeout: Math.ceil(this.timeoutMs / 1000), deadlineAt: Date.now() + this.timeoutMs }, signal);
  }

  async #list(signal) {
    const tabs = [];
    for (const [id, record] of this.tabs) {
      const result = await this.#command('tabs', { op: 'list' }, signal, record.session);
      if (!Array.isArray(result.data)) throw new Error('浏览器标签页响应无效');
      tabs.push(...result.data.filter((tab) => tab.page === id));
    }
    // Even an empty list must verify the explicitly selected profile/daemon.
    if (!this.tabs.size) await this.#command('tabs', { op: 'list' }, signal);
    return tabs;
  }
  async #ownedTab(tabId, signal) {
    if (!this.tabs.has(tabId)) throw new Error('只能操作小伴创建的标签页');
    const tab = (await this.#list(signal)).find((entry) => entry.page === tabId);
    if (!tab) { this.tabs.delete(tabId); throw new Error('小伴标签页已关闭'); }
    return tab;
  }
  async #checkTab(tabId, signal, initialNavigation = false) {
    const deadline = Date.now() + Math.min(5000, this.timeoutMs);
    let tab = await this.#ownedTab(tabId, signal);
    // tabs/new acknowledges the page identity before navigation completes.
    // The extension may report an empty URL before about:blank/navigation.
    // Wait only for this new lease's initial page, without replaying new.
    while (initialNavigation && (tab.url === '' || tab.url === 'about:blank')) {
      checkAbort(signal);
      if (Date.now() >= deadline) throw new Error('新网页仍在加载；租约已保留，请查看标签页状态或关闭此页，不要重复打开');
      await new Promise(resolve => setTimeout(resolve, Math.min(75, deadline - Date.now())));
      checkAbort(signal);
      tab = await this.#ownedTab(tabId, signal);
    }
    try { return { ...tab, url: browserWebUrl(tab.url) }; } catch { this.tabs.delete(tabId); throw new Error('页面已离开 HTTP(S) 网页，小伴已停止操作此标签页'); }
  }
  #publicTab(tab) { return { id: tab.page, url: cleanText(tab.url, 2048), title: cleanText(tab.title, 250), active: Boolean(tab.active) }; }

  async #page(tabId, signal, url, documentId, initializeDocument = false) {
    const bundle = await this.#bundle();
    const { BasePage } = await import(pathToFileURL(bundle.basePage).href);
    const page = new BasePage();
    // Bind finite helpers to the document just checked. Website changes are
    // allowed, but cannot silently redirect a helper or reuse the old refs.
    page.evaluate = async (code) => {
      const guarded = browserDocumentExpression(code, url, { documentId, initializeDocument });
      initializeDocument = false;
      const result = await this.#command('exec', { page: tabId, code: guarded }, signal, this.tabs.get(tabId)?.session);
      return result.data;
    };
    // Omit native CDP input: avoid a second unguarded dispatch after DOM check.
    return page;
  }

  async #closeAdapterLease(lease) {
    if (this.selectedProfileId !== lease.profileId) throw new Error('查询页面所属 Chrome 档案已改变，无法确认关闭。');
    // When cancellation races tab creation, the page id can be unknown. The
    // upstream protocol resolves this close only inside this random session.
    await this.#command('tabs', { op: 'close', ...(lease.page ? { page: lease.page } : {}) }, AbortSignal.timeout(Math.min(3000, this.timeoutMs)), lease.session);
    this.adapterLeases.delete(lease.session);
  }

  async executeAdapter(input, { signal, policy: suppliedPolicy, siteOrigins = {} } = {}) {
    const args = validateOpenCliQuery(input), policy = browserQueryPolicy(args.site, args.command);
    if (!policy || (suppliedPolicy && (suppliedPolicy.site !== args.site || suppliedPolicy.command !== args.command))) throw new Error('此浏览器查询未开放。');
    const configuredOrigins = normalizeSiteOrigins(siteOrigins);
    validateBrowserQueryUrl(args, configuredOrigins);
    const origins = browserAdapterOrigins(policy, configuredOrigins);
    checkAbort(signal);
    if (this.closed) throw new Error('浏览器工具已关闭');
    if (this.busy) throw new Error('另一项浏览器操作正在进行');
    if (this.adapterLeases.size) throw new Error('上次查询页面尚未确认关闭，请先断开浏览器连接。');
    this.busy = true;
    const controller = new AbortController(); this.controller = controller;
    const taskSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])]);
    const lease = { session: `petpal-query-${randomUUID()}`, profileId: this.selectedProfileId, page: null };
    let complete, cleanupError, failure;
    this.adapterOperation = new Promise(resolve => { complete = resolve; });
    const deadline = Date.now() + this.timeoutMs;
    try {
      // Verify the selected profile and daemon before recording a lease. No
      // automatic connect, profile selection, default session or tab discovery.
      const raw = await this.#rawStatus(); checkAbort(taskSignal);
      if (!this.#attached(raw)) throw new Error('小伴浏览器桥已断开；请手动重新连接');
      if (!lease.profileId || !raw.profiles?.some(profile => profile.contextId === lease.profileId && profileCompatible(profile))) throw new Error('请先显式选择已连接且扩展兼容的 Chrome 配置');
      const bundle = await this.#bundle();
      if (!bundle) throw new Error('未安装内置 OpenCLI');
      const { buildEvaluateExpression } = await import(pathToFileURL(path.join(bundle.root, 'dist/src/browser/utils.js')).href);
      const evaluate = async (input, ...values) => {
        checkAbort(taskSignal);
        const expression = buildEvaluateExpression(input, values);
        if (expression.length > 100000) throw new Error('固定浏览器脚本过大。');
        const rules = browserAdapterNetworkRules(args.site), remaining = Math.max(1, deadline - Date.now());
        const guarded = `(async () => {
          const safeErrors = ${JSON.stringify(BROWSER_ADAPTER_ERRORS)};
          try {
          if (${JSON.stringify(policy.loginOrigins || [])}.includes(location.origin)) throw new Error('网站已转到登录页；请先在所选 Chrome 档案手动登录，再重新查询。');
          if (${JSON.stringify(policy.verificationOrigins || [])}.includes(location.origin)) throw new Error('网站要求手动安全验证；请在所选 Chrome 档案完成后重新查询。');
          if (!${JSON.stringify(origins)}.includes(location.origin)) throw new Error('PetPal origin rejected：页面已跳转到查询范围外，请检查网站登录或验证状态。');
          const networkRules = ${JSON.stringify(rules)}, nativeFetch = globalThis.fetch.bind(globalThis);
          const fetch = async (input, init = {}) => {
            if (!(typeof input === 'string' || input instanceof URL)) throw new Error('PetPal API request rejected');
            const url = new URL(input,location.href), method = String(init.method || 'GET').toUpperCase();
            if (url.protocol !== 'https:' || url.username || url.password || url.port || !networkRules.some(rule => rule.origin === url.origin && rule.methods.includes(method) && rule.paths.includes(url.pathname))) throw new Error('PetPal API request rejected');
            const headers = new Headers(init.headers);
            if (['authorization','cookie','proxy-authorization'].some(name => headers.has(name))) throw new Error('PetPal credential header rejected');
            const networkSignal = AbortSignal.timeout(${remaining}); let response;
            try { response = await nativeFetch(url.href,{...init,headers,redirect:'error',signal:networkSignal}); }
            catch { if (networkSignal.aborted) throw new Error('PetPal API deadline exceeded'); throw new Error('网站 API 请求失败，请检查网络与登录。'); }
            if (!response.ok) {
              await response.body?.cancel();
              throw new Error(response.status === 429 ? '网站 API 暂时限流，请稍后重新查询。' : [401,403].includes(response.status) ? '网站 API 拒绝访问，请先在所选 Chrome 档案检查登录或安全验证。' : '网站 API 暂不可用或需要登录。');
            }
            const reader = response.body?.getReader(); if (!reader) return response;
            const chunks = []; let bytes = 0;
            try { for (;;) { const {value,done} = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 2097152) { await reader.cancel(); throw new Error('PetPal API response too large'); } chunks.push(value); } }
            finally { reader.releaseLock(); }
            const blob = new Blob(chunks);
            if (url.origin === 'https://api.bilibili.com') {
              let payload; try { payload = JSON.parse(await blob.text()); } catch { throw new Error('B站 API 返回格式无效。'); }
              if (!payload || payload.code !== 0) throw new Error('B站 API 拒绝请求，请检查登录、网络和访问限制。');
            }
            return new Response(blob,{status:response.status,statusText:response.statusText,headers:response.headers});
          };
          return await (${expression});
          } catch (error) {
            const index = safeErrors.indexOf(error?.message);
            if (index >= 0) return {__petpalAdapterError:index};
            throw error;
          }
        })()`;
        const result = await this.#command('exec', { page: lease.page, code: guarded }, taskSignal, lease.session);
        if (result.data && !Array.isArray(result.data) && Object.hasOwn(result.data,'__petpalAdapterError')) {
          const index = result.data.__petpalAdapterError;
          if (!Number.isInteger(index) || index < 0 || index >= BROWSER_ADAPTER_ERRORS.length) throw new Error('浏览器查询错误响应格式无效。');
          throw new Error(BROWSER_ADAPTER_ERRORS[index]);
        }
        return result.data;
      };
      const wait = async seconds => {
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 5) throw new Error('固定浏览器等待超出范围。');
        checkAbort(taskSignal);
        await new Promise((resolve, reject) => {
          const aborted = () => { clearTimeout(timer); taskSignal.removeEventListener('abort', aborted); reject(abortError()); };
          const timer = setTimeout(() => { taskSignal.removeEventListener('abort', aborted); resolve(); }, seconds * 1000);
          taskSignal.addEventListener('abort', aborted, { once: true });
        });
        checkAbort(taskSignal);
      };
      const page = Object.freeze({
        evaluate, wait,
        goto: async (url, options = {}) => {
          const target = assertBrowserAdapterUrl(url, origins);
          const result = await this.#command('navigate', { page: lease.page, url: target }, taskSignal, lease.session);
          if (result.page && result.page !== lease.page) throw new Error('查询页面身份已改变，停止操作。');
          if (options.waitUntil !== 'none') { await wait(0.15); await evaluate(`(async () => { const deadline = Date.now() + 1000; while (!document.body && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve,50)); return Boolean(document.body); })()`); }
        },
      });
      this.adapterLeases.set(lease.session, lease);
      const opened = await this.#command('tabs', { op: 'new', url: `${origins[0]}/` }, taskSignal, lease.session);
      if (typeof opened.page !== 'string' || !/^[\w.:-]{1,128}$/.test(opened.page)) throw new Error('浏览器未返回查询页面身份。');
      lease.page = opened.page;
      let abortListener;
      const aborted = new Promise((_, reject) => {
        abortListener = () => reject(abortError());
        taskSignal.addEventListener('abort', abortListener, { once: true });
        if (taskSignal.aborted) abortListener();
      });
      let rows;
      try { rows = await Promise.race([runBrowserAdapter({ args, policy, page, bundleRoot: bundle.root, siteOrigins: configuredOrigins }), aborted]); }
      finally { taskSignal.removeEventListener('abort', abortListener); }
      const output = { site: args.site, command: args.command, version: VERSION, rows, count: rows.length };
      if (Buffer.byteLength(JSON.stringify(output)) > 128 * 1024) throw new Error('网站查询响应超过 128 KiB。');
      return output;
    } catch (error) {
      failure = error;
      if (taskSignal.aborted || Date.now() >= deadline || error?.message === 'PetPal API deadline exceeded') {
        if (signal?.aborted || controller.signal.aborted) throw abortError();
        throw Object.assign(new Error('浏览器网站查询超时；已停止，不会自动重试。'), { status: 504, code: 'timeout' });
      }
      let message = cleanText(error?.message || '浏览器网站查询失败。', 400);
      for (const value of [args.arguments.passcode, args.arguments.url]) if (typeof value === 'string' && value) message = message.split(value).join('[已隐藏]');
      throw Object.assign(new Error(message), { ...(error?.status ? { status: error.status } : {}), ...(error?.code ? { code: error.code } : {}) });
    } finally {
      controller.abort();
      if (this.adapterLeases.has(lease.session)) try { await this.#closeAdapterLease(lease); } catch { cleanupError = new Error('查询页面未确认关闭；请先断开浏览器连接后检查，不会自动重试查询。'); }
      if (this.controller === controller) this.controller = null;
      this.adapterOperation = null; this.busy = false; complete();
      if (cleanupError && !failure) throw cleanupError;
    }
  }

  async execute(input, { signal } = {}) {
    const args = validateBrowserAction(input);
    checkAbort(signal);
    if (this.closed) throw new Error('浏览器工具已关闭');
    if (this.busy) throw new Error('另一项浏览器操作正在进行');
    this.busy = true;
    const previousChild = this.child;
    const previousSharedPid = this.sharedPid;
    const controller = new AbortController(); this.controller = controller;
    const taskSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      if (args.action === 'connect') return await this.#connect(args, taskSignal);
      if (args.profileId && args.profileId !== this.selectedProfileId) throw new Error('操作的 Chrome 配置与显式选择不一致');
      if (args.action === 'tabs') {
        const tabs = await this.#list(taskSignal);
        return { action: 'tabs', selectedProfileId: this.selectedProfileId, tabs: tabs.map((tab) => this.#publicTab(tab)) };
      }
      if (args.action === 'close' && !args.tabId) {
        const failed = [];
        try {
          for (const lease of [...this.adapterLeases.values()]) {
            try { await this.#closeAdapterLease(lease); } catch { failed.push(lease.session); }
          }
          // A failed page must not prevent the other independent leases from
          // being released. Cancellation still prevents further dispatches.
          for (const [tabId, record] of [...this.tabs]) {
            checkAbort(taskSignal);
            try { await this.#command('tabs', { op: 'close', page: tabId }, taskSignal, record.session); this.tabs.delete(tabId); }
            catch (error) { checkAbort(taskSignal); failed.push(tabId); }
          }
        } finally {
          // A query lease must keep its exact daemon/profile identity until a
          // later explicit close confirms release. Clearing that identity here
          // would make the retained lease impossible to close or reconnect.
          if (!this.adapterLeases.size) await this.#stopChild();
        }
        if (failed.length) throw new Error(`浏览器连接已断开，但有 ${failed.length} 个小伴网页未确认关闭；请在浏览器中检查并手动关闭`);
        return { action: 'close', closed: true };
      }
      if (args.action === 'open') {
        if (this.tabs.size >= 8) throw new Error('最多保留 8 个小伴网页标签页，请先关闭不用的页面');
        const session = `petpal-${randomUUID()}`;
        const result = await this.#command('tabs', { op: 'new', url: args.url }, taskSignal, session);
        if (typeof result.page !== 'string' || !/^[\w.:-]{1,128}$/.test(result.page)) throw new Error('浏览器未返回新建标签页身份');
        this.tabs.set(result.page, { snapshotAt: 0, refs: new Set(), session });
        const tab = await this.#checkTab(result.page, taskSignal, true);
        return { action: 'open', tab: this.#publicTab(tab) };
      }
      if (args.action === 'close') {
        // Closing an owned lease is also allowed while its first page is blank.
        await this.#ownedTab(args.tabId, taskSignal);
        await this.#command('tabs', { op: 'close', page: args.tabId }, taskSignal, this.tabs.get(args.tabId).session);
        this.tabs.delete(args.tabId);
        return { action: 'close', tabId: args.tabId, closed: true };
      }
      const checkedTab = await this.#checkTab(args.tabId, taskSignal);
      const record = this.tabs.get(args.tabId);
      if (['click', 'fill', 'key'].includes(args.action) && record.snapshotUrl && record.snapshotUrl !== checkedTab.url) {
        record.snapshotAt = 0; record.refs.clear();
        throw new Error('页面已跳转，请重新读取快照');
      }
      if (['click', 'fill', 'key'].includes(args.action) && Date.now() - record.snapshotAt > 60000) throw new Error('请先读取页面快照；控件编号在 60 秒后过期');
      if (args.action === 'snapshot') {
        record.snapshotAt = 0; record.refs.clear();
        record.documentId = randomUUID();
      }
      const page = await this.#page(args.tabId, taskSignal, checkedTab.url, record.documentId, args.action === 'snapshot');
      if (args.action === 'snapshot') {
        const text = await page.snapshot({ maxDepth: 20, maxTextLength: 120 });
        const tab = await this.#checkTab(args.tabId, taskSignal);
        if (tab.url !== checkedTab.url) { record.snapshotAt = 0; record.refs.clear(); throw new Error('页面在读取过程中已跳转，请重新读取快照'); }
        // A same-URL reload also creates a new document and invalidates refs.
        await page.evaluate('true');
        record.snapshotAt = Date.now();
        record.snapshotUrl = tab.url;
        // Upstream snapshots include input values without quotes; remove the
        // remainder of any such tag, rather than risk returning typed secrets.
        const snapshot = cleanText(String(text).replace(/\bvalue=[^>\n]*/g, 'value=[已隐藏]'));
        record.refs = new Set([...snapshot.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
        return { action: 'snapshot', tab: this.#publicTab(tab), snapshot, truncated: String(text).length > 16000 };
      }
      if (['click', 'fill'].includes(args.action) && !record.refs.has(args.target)) throw new Error('控件编号不在最近返回的页面快照中');
      // Refs cannot be reused after a mutation, including a failed/cancelled one.
      record.snapshotAt = 0;
      if (args.action === 'click') await page.click(String(args.target));
      if (args.action === 'fill') {
        const result = await page.fillText(String(args.target), args.text);
        if (!result.verified) throw new Error('页面没有确认输入内容，请刷新快照后检查');
      }
      if (args.action === 'key') await page.pressKey(args.key === 'Space' ? ' ' : args.key);
      const tab = await this.#checkTab(args.tabId, taskSignal);
      return { action: args.action, tab: this.#publicTab(tab), completed: true };
    } catch (error) {
      if (taskSignal.aborted) {
        if (args.action === 'connect' && this.child !== previousChild) await this.#stopChild();
        if (args.action === 'connect' && this.sharedPid !== previousSharedPid) this.sharedPid = this.closed ? null : previousSharedPid;
        throw abortError();
      }
      // Upstream errors may echo field values, cookies or page content.
      if (error?.name === 'TimeoutError') throw new Error('浏览器操作超时，结果可能未知；请刷新页面状态，不要自动重试');
      throw new Error(cleanText(error?.message || '浏览器操作失败', 400));
    } finally { if (this.controller === controller) this.controller = null; this.busy = false; }
  }

  async #stopChild() {
    if (this.stopping) return this.stopping;
    const child = this.child;
    this.sharedPid = null;
    this.selectedProfileId = null;
    this.tabs.clear();
    if (!child) return;
    const stopping = new Promise((resolve, reject) => {
      let timer;
      const finish = (error) => {
        clearTimeout(timer);
        child.removeListener('close', closed);
        if (error) reject(error);
        else { if (this.child === child) this.child = null; resolve(); }
      };
      const closed = () => finish();
      child.once('close', closed);
      // Wait for 'close', not just kill() or 'exit': the child and its pipes
      // must finish. Signals are sent only through our retained ChildProcess.
      timer = setTimeout(() => {
        timer = setTimeout(() => finish(new Error('小伴自有 OpenCLI 进程未在时限内退出，请检查本机进程状态')), this.shutdownTimeoutMs);
        if (child.exitCode === null && !child.signalCode) {
          try { child.kill('SIGKILL'); } catch { /* bounded close wait reports failure */ }
        }
      }, this.shutdownTimeoutMs);
      if (!child.killed && child.exitCode === null && !child.signalCode) {
        try { child.kill('SIGTERM'); } catch { /* retry only this owned child at timeout */ }
      }
    });
    this.stopping = stopping;
    try { await stopping; }
    finally { if (this.stopping === stopping) this.stopping = null; }
  }
  async close() {
    this.closed = true; this.controller?.abort();
    await this.adapterOperation;
    let failed = false;
    for (const lease of [...this.adapterLeases.values()]) try { await this.#closeAdapterLease(lease); } catch { failed = true; }
    if (failed) throw new Error('查询页面未确认关闭，请在所选 Chrome 档案检查小伴页面。');
    await this.#stopChild();
  }
}
