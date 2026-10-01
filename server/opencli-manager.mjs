import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenCliRunner, openCliEnvironment, validateBrowserAction } from './opencli.mjs';
import { describeOpenCliSites, loadOpenCliCatalog, resolveOpenCliQueryBundle, validateOpenCliQuery } from './opencli-sites.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const failure = (status, message, code) => Object.assign(new Error(message), { status, code });
const abortError = () => Object.assign(failure(499, 'OpenCLI 网站查询已取消。', 'cancelled'), { name: 'AbortError' });
const cleanText = value => String(value ?? '').replace(/\b(sk-[\w-]{8,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[已隐藏]').replace(/(Bearer\s+)[^\s"']+/gi, '$1[已隐藏]').replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|authorization)\s*[=:]\s*["']?)[^\s"',;&]+/gi, '$1[已隐藏]').replace(/([?&#](?:token|key|code|session|auth)[^=&#]*=)[^&#\s"']+/gi, '$1[已隐藏]');
const sanitize = value => Array.isArray(value) ? value.map(sanitize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:__proto__|constructor|prototype)$/.test(key)).map(([key, item]) => [key, sanitize(item)])) : typeof value === 'string' ? cleanText(value) : value;
const validConfig = value => object(value) && Object.keys(value).length === 2 && uuid.test(value.revision) && typeof value.enabled === 'boolean';
const workerPath = fileURLToPath(new URL('./opencli-worker.mjs', import.meta.url)).replace(/\.asar([\\/])/i, '.asar.unpacked$1');

export class OpenCliManager {
  constructor({ dataDir, scope = 'local', browser, packageJsonPath, runtime = process.execPath, launch = spawn, openLock = open, env = process.env, timeoutMs = 30000, shutdownTimeoutMs = 2000, maxOutputBytes = 128 * 1024 } = {}) {
    if (typeof dataDir !== 'string' || !dataDir || typeof scope !== 'string' || !scope || scope.length > 512 || /[\x00-\x1f]/.test(scope)) throw new Error('OpenCLI 需要有效的独立数据目录和账号范围。');
    this.dataDir = path.resolve(dataDir); this.scopeHash = createHash('sha256').update(scope).digest('hex');
    this.scopeDir = path.join(this.dataDir, 'opencli-scopes', this.scopeHash);
    this.configFile = path.join(this.scopeDir, 'config.json'); this.lockFile = path.join(this.scopeDir, 'config.lock');
    const digest = createHash('sha256').update(`petpal-opencli-default:${this.scopeHash}`).digest('hex');
    this.defaultConfig = { revision: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`, enabled: true };
    this.browserFactory = browser ? null : () => new OpenCliRunner({ dataDir: this.scopeDir, packageJsonPath, runtime });
    this.browser = browser || this.browserFactory();
    this.packageJsonPath = packageJsonPath; this.runtime = runtime; this.launch = launch; this.env = env;
    this.openLock = openLock; this.failedLock = null; this.browserRecovery = null;
    this.timeoutMs = timeoutMs; this.shutdownTimeoutMs = shutdownTimeoutMs; this.maxOutputBytes = maxOutputBytes;
    this.operation = null; this.closed = false; this.configuring = false;
  }
  _live() { if (this.closed) throw failure(409, 'OpenCLI 连接已关闭。', 'closed'); }
  async _safeDirectory(create = false) {
    if (create) { await this._safeDirectory(); await mkdir(this.scopeDir, { recursive: true, mode: 0o700 }); }
    for (const directory of [path.join(this.dataDir, 'opencli-scopes'), this.scopeDir]) {
      let info; try { info = await lstat(directory); } catch (error) { if (error.code === 'ENOENT' && !create) return; throw error; }
      const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
      if (!info.isDirectory() || info.isSymbolicLink() || canonical(await realpath(directory)) !== canonical(directory)) throw failure(409, 'OpenCLI 配置目录不可经过链接或未知路径。', 'invalid_config_path');
    }
  }
  async _readConfig() {
    await this._safeDirectory();
    let info; try { info = await lstat(this.configFile); } catch (error) { if (error.code === 'ENOENT') return { ...this.defaultConfig }; throw error; }
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096 || info.size < 1) throw failure(409, 'OpenCLI 配置文件未知，请备份后检查。', 'invalid_config');
    let value; try { value = JSON.parse(await readFile(this.configFile, 'utf8')); } catch { throw failure(409, 'OpenCLI 配置文件格式无效。', 'invalid_config'); }
    if (!validConfig(value)) throw failure(409, 'OpenCLI 配置文件字段无效。', 'invalid_config');
    return { ...value };
  }
  async config() { this._live(); return this._readConfig(); }
  _recoverBrowser() {
    const recovery = this.browserRecovery; if (!recovery) return;
    if (!recovery.confirmed || !this.browserFactory) throw failure(409, 'OpenCLI 浏览器关闭失败，尚未确认自有进程退出；当前保持停用，请检查本机进程或重启客户端。', 'browser_shutdown_pending');
    recovery.child?.removeListener('close', recovery.onClose);
    this.browser = this.browserFactory(); this.browserRecovery = null;
  }
  async _shutdownBrowser() {
    const runner = this.browser, child = runner.child;
    this.browserRecovery?.child?.removeListener('close', this.browserRecovery.onClose);
    const recovery = { runner, child, confirmed: false, onClose: null };
    recovery.onClose = () => { recovery.confirmed = true; };
    // Only the retained owned ChildProcess can provide exit confirmation. A
    // shared daemon PID is never a cleanup or recovery target.
    child?.once('close', recovery.onClose);
    try {
      await runner.close(); child?.removeListener('close', recovery.onClose);
      this.browserRecovery = null;
      if (this.browserFactory) this.browser = this.browserFactory();
    } catch {
      this.browserRecovery = recovery;
      if (recovery.confirmed && this.browserFactory) this._recoverBrowser();
      throw failure(502, 'OpenCLI 已停用，但浏览器进程关闭未完成；已保留自有进程，请检查本机状态。', 'browser_shutdown_failed');
    }
  }
  async _releaseLock(receipt) {
    let closeError;
    // One bounded retry handles a transient FileHandle.close failure. Unknown
    // closure keeps both the handle and lock owned; never remove another lock.
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await receipt.handle.close(); closeError = null; break; } catch (error) { closeError = error; }
    }
    if (closeError) { this.failedLock = receipt; throw failure(503, 'OpenCLI 配置锁未能释放；已保留句柄，请重试或重启客户端。', 'config_lock_cleanup_failed'); }
    if (this.failedLock === receipt) this.failedLock = null;
    try {
      const current = await lstat(this.lockFile);
      if (receipt.identity && current.isFile() && !current.isSymbolicLink() && current.dev === receipt.identity.dev && current.ino === receipt.identity.ino) await unlink(this.lockFile);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async configure(body) {
    this._live();
    if (!validConfig(body)) throw failure(400, 'OpenCLI 配置需要 revision 与 enabled。', 'invalid_config');
    if (this.configuring) throw failure(409, 'OpenCLI 配置正在修改。', 'config_busy');
    this.configuring = true;
    try {
    if (this.failedLock) await this._releaseLock(this.failedLock);
    if (this.browserRecovery) this._recoverBrowser();
    await this._safeDirectory(true);
    let lock; try { lock = await this.openLock(this.lockFile, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw failure(409, 'OpenCLI 配置正在修改，请刷新后重试。', 'config_busy'); throw error; }
    const receipt = { handle: lock, identity: null };
    let result;
    try {
      receipt.identity = await lock.stat();
      await lock.writeFile(JSON.stringify({ ownerPid: process.pid, nonce: randomUUID() }));
      const current = await this._readConfig();
      if (body.revision !== current.revision) throw failure(409, 'OpenCLI 配置已变化，请刷新后重试。', 'config_changed');
      if (body.enabled === current.enabled) result = current;
      else {
        result = { revision: randomUUID(), enabled: body.enabled };
        const temporary = path.join(this.scopeDir, `config-${randomUUID()}.tmp`);
        let handle;
        try { handle = await open(temporary, 'wx', 0o600); await handle.writeFile(JSON.stringify(result)); await handle.sync(); await handle.close(); handle = null; await rename(temporary, this.configFile); await chmod(this.configFile, 0o600); }
        finally { await handle?.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
      }
    } finally { await this._releaseLock(receipt); }
    if (!result.enabled) { await this._stopQuery(abortError()); await this._shutdownBrowser(); }
    return result;
    } finally { this.configuring = false; }
  }
  async status() {
    const config = await this.config();
    const [browser, catalog] = await Promise.all([this.browser.status(), loadOpenCliCatalog(this.packageJsonPath).catch(() => null)]);
    return { ...browser, config, catalog: catalog?.summary || null, queryReady: Boolean(config.enabled && catalog), queryBusy: Boolean(this.operation), ...(config.enabled ? {} : { ready: false, queryReady: false, message: this.browserRecovery && !this.browserRecovery.confirmed ? 'OpenCLI 已停用；自有浏览器进程尚未确认退出，请检查本机进程。' : 'OpenCLI 已关闭；网站清单仍可查看。' }) };
  }
  async sites(args = {}) { this._live(); return describeOpenCliSites(args, this.packageJsonPath); }
  async _enabled() { const config = await this.config(); if (!config.enabled) throw failure(403, 'OpenCLI 已关闭，请在设置中启用。', 'disabled'); return config; }
  async executeBrowser(args, { signal } = {}) {
    this._live(); const input = validateBrowserAction(args);
    if (signal?.aborted) throw abortError();
    if (this.operation || this.configuring) throw failure(409, '此账号正在处理 OpenCLI 请求，请稍后重试。', 'busy');
    const controller = new AbortController(), browser = this.browser; let complete;
    const operation = { error: null, stop: error => { operation.error ||= error; controller.abort(error); }, stopped: new Promise(resolve => { complete = resolve; }) }; this.operation = operation;
    const onAbort = () => operation.stop(abortError()); signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await this._enabled(); if (operation.error) throw operation.error; this._live();
      if (this.configuring) throw failure(409, 'OpenCLI 配置正在修改，请稍后重试。', 'config_busy');
      if (signal?.aborted) onAbort(); if (operation.error) throw operation.error;
      return await browser.execute(input, { signal: controller.signal });
    } finally { signal?.removeEventListener('abort', onAbort); if (this.operation === operation) this.operation = null; complete(); }
  }
  async query(body, { signal } = {}) {
    this._live(); const args = validateOpenCliQuery(body);
    if (signal?.aborted) throw abortError();
    if (this.operation || this.configuring) throw failure(409, '此账号正在处理 OpenCLI 请求，请稍后重试。', 'busy');
    const operation = { child: null, error: null }; let complete;
    operation.stopped = new Promise(resolve => { complete = resolve; }); this.operation = operation;
    let timer, killTimer, exitTimer, resultPromise, rejectShutdown;
    operation.stop = error => {
      operation.error ||= error;
      if (operation.child && !operation.closeReceived && !killTimer) {
        operation.child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          operation.child.kill('SIGKILL');
          exitTimer = setTimeout(() => {
            if (!operation.closeReceived) {
              operation.retained = true;
              rejectShutdown?.(failure(502, 'OpenCLI 查询进程未确认退出；已保留占用，请检查本机进程后重试。', 'shutdown_failed'));
            }
          }, this.shutdownTimeoutMs);
        }, this.shutdownTimeoutMs);
      }
    };
    const onAbort = () => operation.stop(abortError()); signal?.addEventListener('abort', onAbort, { once: true });
    const check = () => { if (operation.error) throw operation.error; this._live(); if (this.configuring) throw failure(409, 'OpenCLI 配置正在修改，请稍后重试。', 'config_busy'); };
    try {
      await this._enabled(); check();
      await resolveOpenCliQueryBundle(this.packageJsonPath); check(); await this._safeDirectory(true); check();
      const env = openCliEnvironment(this.scopeDir, this.env);
      await mkdir(env.HOME, { recursive: true, mode: 0o700 }); check();
      // No model/account credentials, NODE_OPTIONS, OpenCLI settings or proxies are inherited.
      const child = this.launch(this.runtime, [workerPath], { cwd: this.scopeDir, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); operation.child = child;
      const stdout = [], stderr = []; let outputBytes = 0, errorBytes = 0;
      const finished = new Promise((resolve, reject) => {
      rejectShutdown = reject;
      child.stdout?.on('data', chunk => { outputBytes += chunk.length; if (outputBytes > this.maxOutputBytes) stop(failure(502, 'OpenCLI 网站响应超出长度限制。', 'output_limit')); else stdout.push(Buffer.from(chunk)); });
      child.stderr?.on('data', chunk => { errorBytes += chunk.length; if (errorBytes > 8192) stop(failure(502, 'OpenCLI 错误响应超出长度限制。', 'output_limit')); else stderr.push(Buffer.from(chunk)); });
      child.on('error', error => { operation.error ||= failure(502, '内置 OpenCLI 查询进程无法启动。', 'launch_failed'); });
      child.on('close', code => {
        operation.closeReceived = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(exitTimer);
        if (operation.retained && this.operation === operation) this.operation = null;
        if (operation.error) return reject(operation.error);
        if (code !== 0) return reject(failure(502, cleanText(Buffer.concat(stderr).toString('utf8')).trim().slice(0, 1200) || 'OpenCLI 网站查询失败，未自动重试。', 'upstream_error'));
        try {
          const value = JSON.parse(Buffer.concat(stdout).toString('utf8'));
          if (!object(value) || value.site !== args.site || value.command !== args.command || value.version !== '1.8.8' || !Array.isArray(value.rows) || value.rows.length > 200 || value.count !== value.rows.length) throw new Error();
          const warnings = cleanText(Buffer.concat(stderr).toString('utf8')).trim().slice(0, 1200);
          resolve({ ...sanitize(value), ...(warnings ? { warnings } : {}) });
        } catch { reject(failure(502, 'OpenCLI 网站响应格式无效。', 'invalid_response')); }
      });
      });
      const stop = operation.stop;
      resultPromise = finished; timer = setTimeout(() => stop(failure(504, 'OpenCLI 网站查询超时，未自动重试。', 'timeout')), this.timeoutMs);
      if (signal?.aborted) onAbort(); else { child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(args)); }
      return await finished;
    } finally { await resultPromise?.catch(() => {}); clearTimeout(timer); clearTimeout(killTimer); clearTimeout(exitTimer); signal?.removeEventListener('abort', onAbort); if (this.operation === operation && !operation.retained) this.operation = null; complete(); }
  }
  async _stopQuery(error) { const operation = this.operation; if (!operation) return; operation.stop(error); await operation.stopped; if (operation.retained && !operation.closeReceived) throw failure(502, 'OpenCLI 查询进程尚未确认退出。', 'shutdown_failed'); }
  async close() {
    if (this.closing) return this.closing;
    if (this.closed && !this.browserRecovery && !this.failedLock && !this.operation) return;
    this.closed = true;
    this.closing = (async () => {
      await this._stopQuery(abortError());
      if (this.failedLock) await this._releaseLock(this.failedLock);
      if (this.browserRecovery?.confirmed && this.browserFactory) this._recoverBrowser();
      await this._shutdownBrowser();
    })();
    try { await this.closing; } finally { this.closing = null; }
  }
}
