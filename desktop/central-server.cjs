'use strict';

const path = require('node:path');
const nativeFs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

const DEFAULTS = Object.freeze({ version: 1, enabled: false, port: 4319, publicUrl: '' });
const MAX_BYTES = 8192;
// Keep a central address usable by Chromium and the Android WebView.
const RESTRICTED_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6697, 10080]);
const centralError = (message, suffix = 'SETTINGS') => Object.assign(new Error(message), { code: `PETPAL_CENTRAL_SERVER_${suffix}` });
const object = value => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

function normalizePublicUrl(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20\x7f\\%]/.test(value) || !/^https:\/\/[^/?#]+\/?$/i.test(value))
    throw centralError('公开地址须为完整 HTTPS 来源，不可包含路径、凭据或查询参数。');
  let url;
  try { url = new URL(value); } catch { throw centralError('公开地址须为完整 HTTPS 来源。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || !url.hostname || url.origin === 'null' || url.hostname.includes('*'))
    throw centralError('公开地址须为完整 HTTPS 来源，不可包含路径、凭据或查询参数。');
  return url.origin;
}

function validateCentralServerPatch(value) {
  if (!object(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !['enabled', 'port', 'publicUrl'].includes(key)))
    throw centralError('中央服务器设置包含不支持的选项。');
  const patch = {};
  if (Object.hasOwn(value, 'enabled')) {
    if (typeof value.enabled !== 'boolean') throw centralError('中央服务器开关须为布尔值。');
    patch.enabled = value.enabled;
  }
  if (Object.hasOwn(value, 'port')) {
    if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 || RESTRICTED_PORTS.has(value.port))
      throw centralError('端口须为 1024 至 65535 之间的浏览器可访问端口。');
    patch.port = value.port;
  }
  if (Object.hasOwn(value, 'publicUrl')) patch.publicUrl = normalizePublicUrl(value.publicUrl);
  return patch;
}

function storedSettings(value) {
  if (!object(value) || Reflect.ownKeys(value).length !== 4 || value.version !== 1 ||
      !['version', 'enabled', 'port', 'publicUrl'].every(key => Object.hasOwn(value, key)))
    throw centralError('中央服务器配置无效。');
  return { version: 1, ...validateCentralServerPatch({ enabled: value.enabled, port: value.port, publicUrl: value.publicUrl }) };
}

function createCentralServer({ userData, hosting, platform = process.platform, fs = nativeFs,
  networkInterfaces = os.networkInterfaces, createListener = options => hosting.createListener(options),
  updateListener = (listener, options) => hosting.updateListener(listener, options), reservedPorts = [] } = {}) {
  if (typeof userData !== 'string' || !path.isAbsolute(userData) || !hosting ||
      typeof hosting.status !== 'function' || typeof createListener !== 'function')
    throw centralError('无法初始化中央服务器。');
  const file = path.join(userData, 'central-server.json'), supported = ['win32', 'linux'].includes(platform);
  let settings = { ...DEFAULTS }, listener = null, reason = '', closing = false, loaded = false, pending = Promise.resolve();
  const failedListeners = new WeakSet();
  const reserved = new Set(reservedPorts);
  const queue = work => { const task = pending.then(work); pending = task.catch(() => {}); return task; };
  const missing = error => error?.code === 'ENOENT';

  async function ownerHasPassword() {
    try { return (await hosting.status())?.ownerHasPassword === true; }
    catch { throw centralError('无法核对本机管理员账号，请重新启动小伴。', 'IDENTITY'); }
  }

  async function readFile() {
    let info;
    try { info = await fs.lstat(file); } catch (error) { if (missing(error)) return null; throw error; }
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw centralError('中央服务器配置文件无效。');
    let handle;
    try {
      handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size > MAX_BYTES)
        throw centralError('中央服务器配置文件已变化。');
      const bytes = Buffer.alloc(MAX_BYTES + 1); let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > MAX_BYTES) throw centralError('中央服务器配置文件过大。');
      return bytes.subarray(0, length);
    } finally { if (handle) await handle.close(); }
  }

  async function atomicWrite(bytes, authorize) {
    await fs.mkdir(userData, { recursive: true, mode: 0o700 });
    const directory = await fs.lstat(userData);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw centralError('中央服务器设置目录无效。');
    const previous = await readFile();
    const temporary = path.join(userData, `.central-server-${randomUUID()}.tmp`);
    let handle, renamed = false;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      if (platform !== 'win32') await handle.chmod(0o600);
      await handle.sync(); await handle.close(); handle = null;
      await authorize();
      await fs.rename(temporary, file); renamed = true;
      return previous;
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (!renamed) await fs.unlink(temporary).catch(() => {});
    }
  }

  const persist = (next, authorize) => atomicWrite(Buffer.from(JSON.stringify(next, null, 2) + '\n'), authorize);

  async function stop(server) {
    if (!server) return;
    // Only this extra listener is stopped. The local backend and Agent remain alive.
    await new Promise((resolve, reject) => {
      try {
        server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
      } catch (error) { if (error.code === 'ERR_SERVER_NOT_RUNNING') resolve(); else reject(error); }
    });
  }

  async function bind(next) {
    // Windows can allow wildcard and specific-address sockets to share a port.
    // Never rely on EADDRINUSE to protect our authenticated loopback origin.
    if (reserved.has(next.port)) throw centralError('此端口用于小伴本机服务，请选择其他端口。', 'RESERVED_PORT');
    let server;
    try {
      server = createListener({ publicUrl: next.publicUrl });
      if (!server || typeof server.listen !== 'function') throw new Error('Invalid listener');
      server.on('error', () => {
        failedListeners.add(server);
        if (server === listener) reason = '中央服务器监听发生错误，请关闭后重新开启；本机功能可继续使用。';
        void stop(server).catch(() => {});
      });
      await new Promise((resolve, reject) => {
        const clean = () => { server.off('error', failed); server.off('listening', ready); };
        const failed = error => { clean(); reject(error); };
        const ready = () => { clean(); resolve(); };
        server.once('error', failed); server.once('listening', ready);
        try { server.listen(next.port, '0.0.0.0'); } catch (error) { failed(error); }
      });
      return server;
    } catch (error) {
      if (server) await stop(server).catch(() => {});
      if (error?.code === 'EADDRINUSE') throw centralError('此端口已被占用，请更换端口后重试。', 'PORT_IN_USE');
      if (['EACCES', 'EPERM'].includes(error?.code)) throw centralError('系统未允许监听此端口，请检查本机权限。', 'PORT_DENIED');
      throw centralError('中央服务器未能启动，请检查本机网络后重试。', 'LISTEN');
    }
  }

  async function statusNow() {
    const password = await ownerHasPassword(), listening = listener?.listening === true && !failedListeners.has(listener);
    const urls = [];
    if (listening) {
      try {
        for (const item of Object.values(networkInterfaces()).flat().filter(Boolean)) {
          if (item.internal || !['IPv4', 4].includes(item.family) || typeof item.address !== 'string' ||
              !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(item.address) || item.address.startsWith('169.254.')) continue;
          const url = `http://${item.address}:${settings.port}`;
          if (!urls.includes(url)) urls.push(url);
        }
      } catch { /* The actual listener remains independently observable. */ }
    }
    const explanation = !supported ? '此系统暂不支持作为中央服务器。' : reason;
    return { supported, platform, enabled: settings.enabled, listening, port: settings.port,
      urls: urls.sort(), publicUrl: settings.publicUrl, ownerHasPassword: password, ...(explanation ? { reason: explanation } : {}) };
  }

  async function loadNow() {
    if (loaded) return statusNow();
    loaded = true;
    reason = '';
    try {
      const bytes = await readFile();
      if (bytes) settings = storedSettings(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch { settings = { ...DEFAULTS }; reason = '中央服务器配置暂不可读取，已保持关闭；原文件保留。'; }
    if (settings.enabled && supported && !closing) {
      let candidate;
      try {
        if (!await ownerHasPassword()) reason = '请先为本机管理员设置登录密码，再开启中央服务器。';
        else {
          candidate = await bind(settings);
          if (closing || !await ownerHasPassword()) { await stop(candidate); reason = '管理员密码尚未就绪，中央服务器保持关闭。'; }
          else { listener = candidate; candidate = null; }
        }
      } catch (error) { if (candidate) await stop(candidate).catch(() => {});
        reason = /^PETPAL_CENTRAL_SERVER_/.test(error?.code || '') ? error.message : '中央服务器未能恢复，本机功能可继续使用。'; }
    }
    try { return await statusNow(); }
    catch { reason = '无法核对管理员账号，中央服务器保持关闭；本机功能可继续使用。'; await stop(listener).catch(() => {}); listener = null;
      return { supported, platform, enabled: settings.enabled, listening: false, port: settings.port, urls: [], publicUrl: settings.publicUrl, ownerHasPassword: false, reason }; }
  }

  async function updateNow(value, { authorize } = {}) {
    const patch = validateCentralServerPatch(value), next = { ...settings, ...patch };
    if (!supported) throw centralError('此系统暂不支持作为中央服务器。', 'UNSUPPORTED');
    const guard = async () => {
      if (closing) throw centralError('客户端正在退出，中央服务器设置未保存。', 'CLOSING');
      if (typeof authorize !== 'function') throw centralError('请先登录本机管理员账号。', 'AUTHORIZATION');
      await authorize();
      if (closing) throw centralError('客户端正在退出，中央服务器设置未保存。', 'CLOSING');
      if (next.enabled && !await ownerHasPassword()) throw centralError('请先为本机管理员设置登录密码。', 'PASSWORD');
      if (closing) throw centralError('客户端正在退出，中央服务器设置未保存。', 'CLOSING');
    };
    await guard();
    const before = settings, old = listener;
    const oldReady = old?.listening === true && !failedListeners.has(old);
    let candidate = null, persisted = false, previousBytes, policyAttempted = false;
    const candidateReady = () => {
      if (candidate && (!candidate.listening || failedListeners.has(candidate)))
        throw centralError('中央服务器监听已中断，设置未保存，请重试。', 'LISTEN');
    };
    try {
      if (next.enabled && (!oldReady || next.port !== before.port)) candidate = await bind(next);
      await guard();
      candidateReady();
      previousBytes = await persist(next, guard); persisted = true;
      // rename is asynchronous: logout, revocation or application shutdown can
      // happen while it is in flight. Commit remains retractable until this gate.
      await guard(); candidateReady();
      if (next.enabled && old?.listening && !candidate && next.publicUrl !== before.publicUrl) {
        policyAttempted = true;
        try { updateListener(old, { publicUrl: next.publicUrl }); }
        catch {
          throw centralError('公开地址未能更新，变更已撤销，请重试。', 'POLICY');
        }
      }
      await guard(); candidateReady();
    } catch (error) {
      let restored = true;
      if (policyAttempted) { try { updateListener(old, { publicUrl: before.publicUrl }); } catch { restored = false; } }
      if (persisted) {
        try {
          if (previousBytes) await atomicWrite(previousBytes, async () => {});
          else await fs.unlink(file);
        } catch { restored = false; }
      }
      if (candidate) { try { await stop(candidate); } catch { restored = false; } }
      if (!restored) throw centralError('中央服务器变更失败且回滚未完成，请重新启动小伴并核对设置。', 'ROLLBACK');
      if (/^PETPAL_CENTRAL_SERVER_/.test(error?.code || '')) throw error;
      // IPC authorization errors must retain their controlled account-change code.
      if (/^PETPAL_CENTRAL_IPC_/.test(error?.code || '')) throw error;
      throw centralError('中央服务器设置未能保存，变更已撤销；请检查本机权限或空间。', 'SAVE');
    }
    settings = next; listener = next.enabled ? candidate || old : null; reason = '';
    if (old && old !== listener) {
      try { await stop(old); }
      catch { reason = '新设置已保存，但旧端口未能完全关闭，请重新启动小伴。'; }
    }
    return statusNow();
  }

  return { load: () => queue(loadNow), status: () => queue(statusNow),
    update: (patch, options) => closing ? Promise.reject(centralError('客户端正在退出，无法更改中央服务器。', 'CLOSING')) : queue(() => updateNow(patch, options)),
    close: () => { closing = true; return queue(async () => { const current = listener; listener = null; await stop(current); }); } };
}

module.exports = { createCentralServer, normalizePublicUrl, validateCentralServerPatch };
