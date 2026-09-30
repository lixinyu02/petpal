import { spawn as spawnProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, copyFile, lstat, mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

const failure = (status, message, code = 'music_mcp_error') => Object.assign(new Error(message), { status, code });
const aborted = () => Object.assign(failure(499, '音乐 MCP 操作已停止。', 'cancelled'), { name: 'AbortError' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const CONFIG_FIELDS = ['revision', 'pythonExecutable', 'cloudmusicExecutable', 'cdpPort', 'neteaseEnabled', 'qqmusicEnabled'];
const MAX_ARGUMENT_BYTES = 32768, MAX_OUTPUT_BYTES = 262144, MAX_SCHEMA_BYTES = 32768;
const LOCK_BYTES = 4096, noncePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ownerProcessExists = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'ESRCH' ? false : undefined; } };
export const MUSIC_MCP_REQUIREMENTS = Object.freeze(['mcp==1.27.2', 'websocket-client==1.9.0', 'qqmusic-api-python==0.6.1']);
// --target does not process .pth files via PYTHONPATH alone (notably pywin32).
// Code is fixed; all paths/module names are fixed argv values, never code interpolation.
export const MUSIC_MCP_BOOTSTRAP = 'import runpy,site,sys; site.addsitedir(sys.argv[1]); entry=sys.argv[2]; sys.argv=[entry]; runpy.run_path(entry,run_name="__main__")';
export const MUSIC_MCP_MODULE_BOOTSTRAP = 'import runpy,site,sys; site.addsitedir(sys.argv[1]); entry=sys.argv[2]; sys.argv=[entry]; runpy.run_module(entry,run_name="__main__")';
const VERIFY_DEPENDENCIES = 'import site,sys; site.addsitedir(sys.argv[1]); import mcp.server.fastmcp,websocket,qqmusic_api; print("MUSIC_MCP_DEPS_OK")';
export const MUSIC_MCP_SERVERS = Object.freeze({
  netease: Object.freeze({ name: '网易云音乐桌面 MCP', repository: 'Seraph310/cloudmusic-desktop-mcp', url: 'https://github.com/Seraph310/cloudmusic-desktop-mcp', windowsOnly: true,
    tools: Object.freeze(['get_netease_status', 'launch_netease_music', 'search_music', 'search_and_play', 'play_netease_item', 'get_netease_queue', 'set_netease_queue', 'clear_netease_queue', 'search_and_set_netease_queue', 'add_to_netease_queue', 'set_netease_play_mode', 'set_netease_volume', 'set_desktop_lyrics', 'set_desktop_lyrics_theme']) }),
  qqmusic: Object.freeze({ name: 'QQ 音乐查询 MCP', repository: 'Sina5byg5L2z/mcp-qqmusic', url: 'https://github.com/Sina5byg5L2z/mcp-qqmusic', windowsOnly: false,
    tools: Object.freeze(['search', 'detail', 'lyric', 'url', 'recommend', 'mv', 'similar', 'producer', 'hot_comments']) }),
});
const vendorRoot = fileURLToPath(new URL('./native/music-mcp/', import.meta.url)).replace(/\.asar([\\/])/i, '.asar.unpacked$1');
const defaultConfig = () => ({ revision: randomUUID(), pythonExecutable: '', cloudmusicExecutable: '', cdpPort: 9223, neteaseEnabled: false, qqmusicEnabled: false });
export const MUSIC_MCP_TOOLS = Object.freeze(Object.fromEntries(Object.entries(MUSIC_MCP_SERVERS).map(([player, value]) => [player, value.tools])));
export function musicMcpReadOnly(player, tool) { return player === 'qqmusic' ? MUSIC_MCP_TOOLS.qqmusic.includes(tool) : player === 'netease' && ['get_netease_status', 'search_music', 'get_netease_queue'].includes(tool); }
export function validateMusicMcpCall(body) {
  if (!object(body) || Object.keys(body).some(key => !['player', 'tool', 'arguments'].includes(key)) || !Object.hasOwn(MUSIC_MCP_SERVERS, body.player)) throw failure(400, '音乐 MCP 调用参数无效。', 'invalid_arguments');
  if (!MUSIC_MCP_TOOLS[body.player].includes(body.tool)) throw failure(400, '此音乐 MCP 工具不在允许范围内。', 'unknown_tool');
  if (!object(body.arguments)) throw failure(400, '音乐工具 arguments 须为对象。', 'invalid_arguments');
  boundedValue(body.arguments);
  if (Buffer.byteLength(JSON.stringify(body.arguments)) > MAX_ARGUMENT_BYTES) throw failure(400, '音乐工具参数过大。', 'invalid_arguments');
  return { player: body.player, tool: body.tool, arguments: JSON.parse(JSON.stringify(body.arguments)) };
}

function validateConfig(value) {
  if (!object(value) || Object.keys(value).some(key => !CONFIG_FIELDS.includes(key)) || CONFIG_FIELDS.some(key => !Object.hasOwn(value, key)) || !/^[a-f0-9-]{36}$/.test(value.revision)) throw failure(400, '音乐 MCP 配置格式无效。', 'invalid_config');
  for (const field of ['pythonExecutable', 'cloudmusicExecutable']) {
    if (typeof value[field] !== 'string' || value[field].length > 4096 || /[\x00-\x1f\x7f]/.test(value[field]) || (value[field] && !path.isAbsolute(value[field]))) throw failure(400, '运行程序须为本机绝对路径。', 'invalid_path');
  }
  if (value.cloudmusicExecutable && !/\.exe$/i.test(value.cloudmusicExecutable)) throw failure(400, '网易云客户端路径须指向 .exe 文件。', 'invalid_path');
  if (!Number.isInteger(value.cdpPort) || value.cdpPort < 1024 || value.cdpPort > 65535) throw failure(400, 'CDP 端口须为 1024 到 65535 的整数；连接固定使用本机回环地址。', 'invalid_port');
  if (typeof value.neteaseEnabled !== 'boolean' || typeof value.qqmusicEnabled !== 'boolean') throw failure(400, '音乐 MCP 启用状态须为布尔值。', 'invalid_config');
  return value;
}

function boundedValue(value, depth = 0) {
  if (depth > 6) throw failure(400, '音乐工具参数嵌套过深。', 'invalid_arguments');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { if (value.length > 8192 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw failure(400, '音乐工具文本过长或含无效字符。', 'invalid_arguments'); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw failure(400, '音乐工具数值无效。', 'invalid_arguments'); return; }
  if (Array.isArray(value)) { if (value.length > 100) throw failure(400, '音乐工具列表最多 100 项。', 'invalid_arguments'); for (const item of value) boundedValue(item, depth + 1); return; }
  if (!object(value) || Object.keys(value).length > 64 || Object.keys(value).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw failure(400, '音乐工具参数格式无效。', 'invalid_arguments');
  for (const item of Object.values(value)) boundedValue(item, depth + 1);
}

/** No API tokens, proxies, global Python modules, or central account environment reach Python. */
export function isolatedMusicMcpEnvironment(source, { profile, dependenciesDirectory, qqSourceDirectory, config, player }) {
  const allowed = /^(?:path|systemroot|windir|systemdrive|comspec|pathext|programfiles(?:\(x86\))?|programdata|lang|lc_[a-z_]+)$/i;
  const env = Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.test(key) && typeof value === 'string'));
  env.HOME = profile; env.USERPROFILE = profile;
  env.APPDATA = path.join(profile, 'AppData', 'Roaming'); env.LOCALAPPDATA = path.join(profile, 'AppData', 'Local');
  env.XDG_CONFIG_HOME = path.join(profile, '.config'); env.XDG_DATA_HOME = path.join(profile, '.local', 'share');
  env.TEMP = path.join(profile, 'tmp'); env.TMP = env.TEMP; env.TMPDIR = env.TEMP;
  env.PYTHONPATH = [dependenciesDirectory, ...(player === 'qqmusic' ? [qqSourceDirectory] : [])].join(path.delimiter);
  // NetEase invokes Windows tasklist with text=True, which needs its OEM/ANSI
  // locale decoder. MCP stdio itself remains explicitly UTF-8 in both clients.
  env.PYTHONNOUSERSITE = '1'; env.PYTHONUTF8 = player === 'netease' ? '0' : '1'; env.PYTHONIOENCODING = 'utf-8'; env.PYTHONUNBUFFERED = '1'; env.PYTHONDONTWRITEBYTECODE = '1';
  env.PIP_CONFIG_FILE = process.platform === 'win32' ? 'NUL' : '/dev/null';
  if (player === 'netease') { env.CLOUDMUSIC_CDP_PORT = String(config.cdpPort); if (config.cloudmusicExecutable) env.CLOUDMUSIC_EXE = config.cloudmusicExecutable; }
  return env;
}

/** Fixed upstream stdio clients. Reading configuration/status never starts either client. */
export class MusicMcpManager {
  constructor({ dataDir, scope = 'local', platform = process.platform, env = process.env, spawn = spawnProcess, renameDirectory = rename, processExists = ownerProcessExists,
    transportFactory = options => new StdioClientTransport(options), clientFactory = () => new Client({ name: 'petpal-music', version: '1.0.0' }),
    connectTimeoutMs = 20000, callTimeoutMs = 30000, prepareTimeoutMs = 600000, processTimeoutMs = 8000, closeTimeoutMs = 5500 } = {}) {
    if (typeof dataDir !== 'string' || !dataDir || typeof scope !== 'string' || !scope || scope.length > 1024) throw new Error('MusicMcpManager 需要本机数据目录与有效作用域。');
    this.dataDir = path.resolve(dataDir); this.platform = platform; this.env = env; this.spawn = spawn; this.renameDirectory = renameDirectory; this.processExists = processExists;
    this.transportFactory = transportFactory; this.clientFactory = clientFactory;
    this.connectTimeoutMs = connectTimeoutMs; this.callTimeoutMs = callTimeoutMs; this.prepareTimeoutMs = prepareTimeoutMs; this.processTimeoutMs = processTimeoutMs; this.closeTimeoutMs = closeTimeoutMs;
    this.configFile = path.join(this.dataDir, 'music-mcp.json');
    this.scopeHash = createHash('sha256').update(scope).digest('hex').slice(0, 32);
    this.profileRoot = path.join(this.dataDir, 'music-mcp', this.scopeHash);
    this.sessions = new Map(); this.operations = new Set(); this.closing = new Set(); this.children = new Set(); this.messages = new Map(); this.closed = false; this.revision = null;
    this.schemaValidator = new AjvJsonSchemaValidator();
  }
  get busy() { return this.operations.size > 0; }
  _live() { if (this.closed) throw failure(503, '音乐 MCP 管理器正在退出。', 'closed'); }
  _player(player) { if (!Object.hasOwn(MUSIC_MCP_SERVERS, player)) throw failure(400, '请选择网易云音乐或 QQ 音乐。', 'invalid_player'); return MUSIC_MCP_SERVERS[player]; }
  _supported(player) { return !this._player(player).windowsOnly || this.platform === 'win32'; }
  _paths(player) { const profile = path.join(this.profileRoot, player); return { profile, dependenciesDirectory: path.join(profile, 'dependencies'), qqSourceDirectory: path.join(vendorRoot, 'qqmusic', 'src'), loginDirectory: profile, loginScript: path.join(profile, 'login.py') }; }
  async _directories(player) {
    const paths = this._paths(player);
    // Reads or another connection must never recreate the active dependencies
    // directory between the two promotion renames.
    for (const directory of [this.dataDir, path.join(this.dataDir, 'music-mcp'), this.profileRoot, paths.profile, path.join(paths.profile, 'tmp'), path.join(paths.profile, 'AppData', 'Roaming'), path.join(paths.profile, 'AppData', 'Local'), path.join(paths.profile, '.config'), path.join(paths.profile, '.local', 'share')]) { await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700); }
    return paths;
  }
  async _renameDependencies(source, target, signal) {
    // Windows may briefly retain a DLL/antivirus handle after import validation
    // exits. Retry only this exact filesystem rename, never installation or an MCP call.
    const delays = [50, 100, 200, 400, 800, 1000, 1000];
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw signal.reason || aborted();
      try { await this.renameDirectory(source, target); return; }
      catch (error) {
        if (this.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= delays.length) throw error;
        // An unexpected destination is a competing mutation, not a transient
        // lock. Preserve it and let the transaction restore its old directory.
        try { await stat(target); throw failure(409, '依赖目录在准备期间发生变化，请停止另一实例后重试。', 'dependencies_changed'); } catch (check) { if (check.code !== 'ENOENT') throw check; }
        await new Promise((resolve, reject) => {
          const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(signal.reason || aborted()); };
          const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, delays[attempt]);
          signal?.addEventListener('abort', stop, { once: true });
          if (signal?.aborted) stop();
        });
      }
    }
  }
  _lockInfo(kind, player) {
    const file = kind === 'config' ? `${this.configFile}.lock` : path.join(this._paths(player).profile, 'prepare.lock');
    const canonical = this.platform === 'win32' ? file.toLowerCase() : file;
    return { file, kind, player, key: createHash('sha256').update(canonical).digest('hex') };
  }
  _newLockReceipt(kind, player) {
    const info = this._lockInfo(kind, player);
    return { version: 1, kind, ownerPid: process.pid, nonce: randomUUID(), key: info.key,
      ...(kind === 'prepare' ? { scope: this.scopeHash, player, phase: 'claimed', hadPrevious: false } : {}) };
  }
  _unknownLock(info, detail = '锁内容缺失、损坏或属于旧版本', recoveryFile) {
    const preserve = info.kind === 'prepare' ? '保留 dependencies.*.previous、credential.json 与 login.py；检查旧依赖备份后重新准备。' : '配置文件 music-mcp.json 会保留；备份锁后重新保存配置。';
    return failure(409, `${detail}，未自动解锁。请停止使用此目录的所有 PetPal 进程，将 ${recoveryFile || info.file} 改名备份，再重试。${preserve}`, 'unknown_lock');
  }
  async _readLockJson(file) {
    const initial = await lstat(file);
    if (!initial.isFile() || initial.isSymbolicLink() || initial.size < 1 || initial.size > LOCK_BYTES) throw new Error('Invalid lock receipt file');
    const handle = await open(file, 'r');
    try {
      const current = await handle.stat(); if (!current.isFile() || current.size < 1 || current.size > LOCK_BYTES) throw new Error('Invalid lock receipt size');
      const buffer = Buffer.alloc(LOCK_BYTES + 1); let length = 0;
      while (length < buffer.length) { const result = await handle.read(buffer, length, buffer.length - length, length); if (!result.bytesRead) break; length += result.bytesRead; }
      if (!length || length > LOCK_BYTES) throw new Error('Oversized lock receipt');
      return JSON.parse(buffer.subarray(0, length).toString('utf8'));
    } finally { await handle.close(); }
  }
  async _readLock(info) {
    let value; try { value = await this._readLockJson(info.file); } catch (error) { if (error.code === 'ENOENT') throw error; throw this._unknownLock(info); }
    const fields = ['version', 'kind', 'ownerPid', 'nonce', 'key', ...(info.kind === 'prepare' ? ['scope', 'player', 'phase', 'hadPrevious'] : [])];
    if (!object(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(field => !fields.includes(field)) || value.version !== 1 || value.kind !== info.kind || !Number.isInteger(value.ownerPid) || value.ownerPid < 1 || value.ownerPid > 0x7fffffff || !noncePattern.test(value.nonce) || value.key !== info.key ||
      (info.kind === 'prepare' && (value.scope !== this.scopeHash || value.player !== info.player || !['claimed', 'installing', 'promoting', 'committed'].includes(value.phase) || typeof value.hadPrevious !== 'boolean'))) throw this._unknownLock(info);
    return value;
  }
  async _writeLockReceipt(info, receipt, { initial = false } = {}) {
    const temporary = `${info.file}.${receipt.nonce}.journal.tmp`, file = initial ? info.file : temporary;
    if (!initial) { const current = await this._readLock(info); if (current.nonce !== receipt.nonce || current.ownerPid !== receipt.ownerPid) throw this._unknownLock(info, '锁所有者发生变化'); }
    let handle, created = false;
    try {
      handle = await open(file, 'wx', 0o600); created = true; await handle.writeFile(`${JSON.stringify(receipt)}\n`); await handle.sync(); await handle.close(); handle = null;
      if (!initial) await rename(temporary, info.file);
    } catch (error) { await handle?.close().catch(() => {}); if (initial && created) await unlink(file).catch(() => {}); throw error; }
    finally { if (!initial) await unlink(temporary).catch(() => {}); }
  }
  async _releaseLock(info, receipt) {
    let current; try { current = await this._readLock(info); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (current.nonce !== receipt.nonce || current.ownerPid !== receipt.ownerPid) throw this._unknownLock(info, '锁所有者发生变化');
    await unlink(info.file);
  }
  async _directoryState(directory, info) {
    try { const value = await lstat(directory); if (!value.isDirectory() || value.isSymbolicLink()) throw this._unknownLock(info, '依赖恢复路径不是固定的普通目录'); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  _dependencyTransactionPaths(player, nonce) {
    if (!noncePattern.test(nonce)) throw new Error('Invalid internal transaction nonce');
    const paths = this._paths(player);
    return { ...paths, staging: path.join(paths.profile, `dependencies.${nonce}.preparing`), previous: path.join(paths.profile, `dependencies.${nonce}.previous`), temporaryLogin: `${paths.loginScript}.${nonce}.tmp` };
  }
  async _removeDependencies(directory, player) {
    const profile = path.resolve(this._paths(player).profile), target = path.resolve(directory);
    if (path.dirname(target) !== profile || !/^dependencies(?:\.[a-f0-9-]{36}\.(?:preparing|previous))?$/.test(path.basename(target))) throw new Error('Invalid internal dependency cleanup path');
    await rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  }
  async _recoverDeadLock(info, receipt) {
    const recoveryFile = `${info.file}.${receipt.nonce}.recovering`, guard = { version: 1, kind: 'recovery', ownerPid: process.pid, nonce: randomUUID(), key: info.key, originalNonce: receipt.nonce };
    let handle, guarded = false;
    try {
      try { handle = await open(recoveryFile, 'wx', 0o600); guarded = true; await handle.writeFile(`${JSON.stringify(guard)}\n`); await handle.sync(); await handle.close(); handle = null; }
      catch (error) { if (error.code === 'EEXIST') throw this._unknownLock(info, '另一恢复操作仍在进行或留下了恢复凭据', recoveryFile); throw error; }
      const confirmed = await this._readLock(info);
      if (confirmed.nonce !== receipt.nonce || confirmed.ownerPid !== receipt.ownerPid) throw failure(409, '恢复期间出现了新的锁所有者，请等待其完成后重试。', info.kind === 'prepare' ? 'prepare_busy' : 'config_busy');
      if (this.processExists(receipt.ownerPid) !== false) throw failure(409, '锁的原进程仍存在或无法确认退出，未进行恢复。', info.kind === 'prepare' ? 'prepare_busy' : 'config_busy');
      if (info.kind === 'prepare') {
        const paths = this._dependencyTransactionPaths(info.player, receipt.nonce);
        const [active, staging, previous] = await Promise.all([paths.dependenciesDirectory, paths.staging, paths.previous].map(directory => this._directoryState(directory, info)));
        const uncertain = () => { throw this._unknownLock(info, '准备阶段与依赖目录不一致，已保留全部可恢复资产'); };
        if (receipt.phase === 'claimed') { if (staging || previous) uncertain(); }
        else if (receipt.phase === 'installing') { if (previous || active !== receipt.hadPrevious) uncertain(); }
        else if (receipt.phase === 'promoting') {
          // Promoting is recorded only after full imports passed. Never move
          // preparing into active here: restore the known previous set instead.
          if (receipt.hadPrevious) {
            if (previous) {
              if (active) { if (staging) uncertain(); await this._renameDependencies(paths.dependenciesDirectory, paths.staging); }
              await this._renameDependencies(paths.previous, paths.dependenciesDirectory);
            } else if (!active) uncertain();
          } else if (previous || (active && staging)) uncertain();
        } else if (receipt.phase === 'committed') { if (!active || staging || (previous && !receipt.hadPrevious)) uncertain(); }
        if (receipt.phase !== 'claimed') await this._removeDependencies(paths.staging, info.player);
        if (receipt.phase === 'committed' && previous) await this._removeDependencies(paths.previous, info.player);
        await unlink(paths.temporaryLogin).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      const latest = await this._readLock(info);
      if (latest.nonce !== receipt.nonce || latest.ownerPid !== receipt.ownerPid || this.processExists(receipt.ownerPid) !== false) throw this._unknownLock(info, '恢复时锁所有者发生变化');
      await unlink(`${info.file}.${receipt.nonce}.journal.tmp`).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await this._releaseLock(info, receipt);
    } finally {
      await handle?.close().catch(() => {});
      if (guarded) {
        // Same-nonce recovery contenders cannot interleave removal/recreation
        // of the original lock. Unknown or another owner's guard is preserved.
        let current; try { current = await this._readLockJson(recoveryFile); } catch { /* leave unreadable receipt for manual recovery */ }
        if (current?.nonce === guard.nonce && current?.ownerPid === guard.ownerPid && current?.originalNonce === receipt.nonce) await unlink(recoveryFile).catch(() => {});
      }
    }
  }
  async _acquireLock(kind, player) {
    const info = this._lockInfo(kind, player), deadline = Date.now() + 2500;
    for (;;) {
      const receipt = this._newLockReceipt(kind, player);
      try { await this._writeLockReceipt(info, receipt, { initial: true }); return { info, receipt }; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let previous; try { previous = await this._readLock(info); } catch (readError) { if (readError.code === 'ENOENT') continue; throw readError; }
        if (this.processExists(previous.ownerPid) === false) { await this._recoverDeadLock(info, previous); continue; }
        if (kind === 'prepare' || Date.now() >= deadline) throw failure(409, kind === 'prepare' ? '此本机作用域的依赖正在准备，锁的进程仍存在或无法确认退出。' : '音乐 MCP 配置正在保存，锁的进程仍存在或无法确认退出。', kind === 'prepare' ? 'prepare_busy' : 'config_busy');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  }
  async _lock(fn) {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const { info, receipt } = await this._acquireLock('config');
    try { return await fn(); } finally { await this._releaseLock(info, receipt); }
  }
  async _write(config) {
    const temporary = `${this.configFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      const handle = await open(temporary, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, this.configFile); await chmod(this.configFile, 0o600);
    } finally { await unlink(temporary).catch(() => {}); }
  }
  async _read() {
    try { if ((await stat(this.configFile)).size > 65536) throw new Error(); return validateConfig(JSON.parse(await readFile(this.configFile, 'utf8'))); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw failure(500, '本机音乐 MCP 配置无效，请保留数据并检查配置文件。', 'invalid_stored_config');
    }
  }
  async _refresh() {
    let config = await this._read();
    if (!config) config = await this._lock(async () => { const existing = await this._read(); if (existing) return existing; const initial = defaultConfig(); await this._write(initial); return initial; });
    const changed = this.revision !== null && this.revision !== config.revision;
    if (changed) { for (const operation of this.operations) operation.controller.abort(failure(409, '音乐 MCP 配置已变化，请重新连接。', 'config_changed')); await Promise.allSettled([...this.sessions.keys()].map(player => this._disconnectSession(player))); }
    this.revision = config.revision;
    return { config, changed };
  }
  async config() { this._live(); return { ...(await this._refresh()).config }; }
  async configure(body) {
    this._live();
    if (!object(body) || Object.keys(body).some(key => !CONFIG_FIELDS.includes(key)) || typeof body.revision !== 'string') throw failure(400, '音乐 MCP 配置包含不支持的字段或缺少版本。', 'invalid_config');
    const result = await this._lock(async () => {
      const current = await this._read() || defaultConfig();
      if (body.revision !== current.revision) throw failure(409, '音乐 MCP 配置已变化，请刷新后重试。', 'config_changed');
      const next = validateConfig({ ...current, ...body });
      for (const field of ['pythonExecutable', 'cloudmusicExecutable']) if (next[field]) { try { if (!(await stat(next[field])).isFile()) throw new Error(); } catch { throw failure(400, '配置的运行程序不存在或不是文件。', 'invalid_path'); } }
      if (CONFIG_FIELDS.filter(key => key !== 'revision').every(key => next[key] === current[key])) return current;
      next.revision = randomUUID(); await this._write(next); return next;
    });
    if (result.revision !== this.revision) { const operations = [...this.operations]; for (const operation of operations) operation.controller.abort(failure(409, '音乐 MCP 配置已变化，请重新连接。', 'config_changed')); await Promise.allSettled([...this.sessions.keys()].map(player => this._disconnectSession(player))); await Promise.allSettled(operations.map(operation => operation.done)); }
    this.revision = result.revision; return { ...result };
  }
  async status() {
    const config = await this.config();
    const servers = await Promise.all(Object.entries(MUSIC_MCP_SERVERS).map(async ([id, metadata]) => {
      const session = this.sessions.get(id), paths = this._paths(id); let credentialConfigured = false;
      if (id === 'qqmusic') { try { const info = await stat(path.join(paths.profile, 'credential.json')); credentialConfigured = info.isFile() && info.size > 0 && info.size <= 65536; } catch { /* no private credential */ } }
      return { id, name: metadata.name, repository: metadata.repository, url: metadata.url, platformSupported: this._supported(id), enabled: config[`${id}Enabled`], connected: Boolean(session?.ready), tools: session?.ready ? session.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) : [],
        message: !this._supported(id) ? '此上游网易云桌面 MCP 仅支持 Windows；Ubuntu 请使用桌面媒体控制。' : this.messages.get(id) || (session?.ready ? (id === 'qqmusic' ? '已连接查询服务；返回播放链接不会启动桌面播放。' : '已连接本机网易云桌面 MCP。') : '尚未连接；请准备 Python 依赖后测试连接。'),
        credentialConfigured, ...(id === 'qqmusic' ? { loginDirectory: paths.loginDirectory, loginScript: paths.loginScript } : {}), prepare: { requirements: [...MUSIC_MCP_REQUIREMENTS], dependenciesDirectory: paths.dependenciesDirectory } };
    }));
    return { config, servers, busy: this.busy };
  }
  async _operation(player, signal, timeoutMs, fn) {
    this._live(); if (signal?.aborted) throw aborted();
    if ([...this.operations].some(operation => operation.player === player)) throw failure(409, '此音乐 MCP 正在处理请求，请稍后再试。', 'busy');
    const controller = new AbortController(); let completed;
    const operation = { player, controller, done: new Promise(resolve => { completed = resolve; }) }; this.operations.add(operation);
    const forward = () => controller.abort(aborted()); signal?.addEventListener('abort', forward, { once: true });
    const timeout = setTimeout(() => controller.abort(failure(504, '音乐 MCP 响应超时；未自动重试操作。', 'timeout')), timeoutMs);
    let rejectAbort; const stopped = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason || aborted()); controller.signal.addEventListener('abort', rejectAbort, { once: true }); });
    const work = Promise.resolve().then(() => fn(controller.signal));
    try { return await Promise.race([work, stopped]); }
    catch (error) {
      await this._disconnectSession(player); this.messages.set(player, error.status ? error.message : '音乐 MCP 连接已中断，请检查本机 Python 与依赖后重新连接。');
      if (error.status || error.name === 'AbortError') throw error;
      throw failure(502, '音乐 MCP 未能完成请求；未自动重试操作。', 'upstream_error');
    } finally {
      clearTimeout(timeout); signal?.removeEventListener('abort', forward); controller.signal.removeEventListener('abort', rejectAbort);
      let cleanupTimeout;
      try { await Promise.race([work.catch(() => {}), new Promise(resolve => { cleanupTimeout = setTimeout(resolve, this.closeTimeoutMs); })]); }
      finally { clearTimeout(cleanupTimeout); this.operations.delete(operation); completed(); }
    }
  }
  async _process(command, args, { signal, env, cwd, timeoutMs = this.processTimeoutMs } = {}) {
    if (signal?.aborted) throw signal.reason || aborted();
    return new Promise((resolve, reject) => {
      let child, done = false, bytes = 0, output = '', reason, killTimer, killDeadline;
      const finish = (code, error) => { if (done) return; done = true; clearTimeout(timeout); clearTimeout(killTimer); clearTimeout(killDeadline); signal?.removeEventListener('abort', stop); if (reason || error || code !== 0) reject(reason || failure(502, '本机 Python 运行或固定依赖准备失败。', 'runtime_error')); else resolve(output.trim()); };
      const kill = () => {
        try { child?.kill(); } catch { /* bounded escalation below */ }
        if (!killTimer) killTimer = setTimeout(() => { try { child?.kill('SIGKILL'); } catch { /* deadline bounds shutdown */ } }, 1000);
        if (!killDeadline) killDeadline = setTimeout(() => finish(null), 2500);
      };
      const stop = () => { reason = signal.reason || aborted(); kill(); if (!child) finish(null); };
      const timeout = setTimeout(() => { reason = failure(504, '本机 Python 操作超时。', 'runtime_timeout'); kill(); }, timeoutMs);
      signal?.addEventListener('abort', stop, { once: true });
      try { child = this.spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env, cwd }); }
      catch (error) { finish(null, error); return; }
      this.children.add(child);
      child.stdout?.on('data', data => { bytes += data.length; if (bytes > MAX_OUTPUT_BYTES) { reason = failure(502, '本机 Python 返回内容过大。', 'output_limit'); kill(); } else output += data.toString('utf8'); });
      // Never expose dependency logs, credentials, or upstream stderr to a caller.
      child.stderr?.on('data', data => { bytes += data.length; if (bytes > MAX_OUTPUT_BYTES) { reason = failure(502, '本机 Python 返回内容过大。', 'output_limit'); kill(); } });
      child.once('error', error => { this.children.delete(child); finish(null, error); }); child.once('close', code => { this.children.delete(child); finish(code); });
    });
  }
  async _python(config, player, env, cwd, signal) {
    const names = this.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python'];
    const candidates = config.pythonExecutable ? [config.pythonExecutable] : (this.env.PATH || this.env.Path || '').split(path.delimiter).filter(Boolean).flatMap(directory => names.map(name => path.resolve(directory, name)));
    for (const command of [...new Set(candidates)]) {
      if (signal.aborted) throw signal.reason || aborted();
      try {
        if (!(await stat(command)).isFile()) continue;
        await access(command, this.platform === 'win32' ? 0 : 1);
        const output = await this._process(command, ['--version'], { signal, env, cwd });
        const version = output.match(/^Python (\d+)\.(\d+)\.\d+(?:\s|$)/);
        if (version && (+version[1] > 3 || (+version[1] === 3 && +version[2] >= (player === 'netease' ? 11 : 10)))) return command;
      } catch (error) { if (signal.aborted) throw signal.reason || aborted(); if (config.pythonExecutable) throw failure(400, '配置的 Python 无法运行或版本不符合要求。', 'python_unavailable'); }
    }
    throw failure(409, `未找到可用 Python；${player === 'netease' ? '网易云需要 Python 3.11 或以上' : 'QQ 音乐需要 Python 3.10 或以上'}。`, 'python_unavailable');
  }
  async prepare(body, { signal } = {}) {
    if (!object(body) || Object.keys(body).some(key => key !== 'player')) throw failure(400, '依赖准备参数无效。', 'invalid_arguments');
    const { player } = body; this._player(player);
    if (!this._supported(player)) throw failure(400, '此网易云桌面 MCP 上游仅支持 Windows。', 'unsupported_platform');
    const { config } = await this._refresh();
    return this._operation(player, signal, this.prepareTimeoutMs, async operationSignal => {
      await this._disconnectSession(player);
      const paths = await this._directories(player), env = isolatedMusicMcpEnvironment(this.env, { ...paths, config, player });
      const pythonExecutable = await this._python(config, player, env, paths.profile, operationSignal);
      let lock, transaction, replacedOld = false, replacedNew = false, committed = false;
      const current = async () => { if (operationSignal.aborted) throw operationSignal.reason || aborted(); if ((await this._read())?.revision !== config.revision) throw failure(409, '音乐 MCP 配置已变化，请重新准备。', 'config_changed'); };
      const journal = async patch => { const next = { ...lock.receipt, ...patch }; await this._writeLockReceipt(lock.info, next); lock.receipt = next; };
      try {
        lock = await this._acquireLock('prepare', player); transaction = this._dependencyTransactionPaths(player, lock.receipt.nonce);
        const { staging, previous, temporaryLogin } = transaction;
        await current(); await journal({ phase: 'installing', hadPrevious: await this._directoryState(paths.dependenciesDirectory, lock.info) });
        await mkdir(staging, { mode: 0o700 }); await chmod(staging, 0o700);
        const stagingEnv = isolatedMusicMcpEnvironment(this.env, { ...paths, dependenciesDirectory: staging, config, player });
        await this._process(pythonExecutable, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--index-url', 'https://pypi.org/simple', '--timeout', '20', '--retries', '2', '--target', staging, ...MUSIC_MCP_REQUIREMENTS], { signal: operationSignal, env: stagingEnv, cwd: paths.profile, timeoutMs: this.prepareTimeoutMs });
        const verified = await this._process(pythonExecutable, ['-S', '-c', VERIFY_DEPENDENCIES, staging], { signal: operationSignal, env: stagingEnv, cwd: paths.profile });
        if (verified !== 'MUSIC_MCP_DEPS_OK') throw failure(502, '固定 Python 依赖未通过导入验证；保留原有依赖。', 'dependencies_unavailable');
        if (player === 'qqmusic') { await copyFile(path.join(vendorRoot, 'qqmusic', 'login.py'), temporaryLogin); await chmod(temporaryLogin, 0o600); }
        await current();
        // Only a complete, verified fresh install may replace the active set.
        // Retain the previous directory until promotion and final revision check succeed.
        await journal({ phase: 'promoting' });
        if (lock.receipt.hadPrevious) { await this._renameDependencies(paths.dependenciesDirectory, previous, operationSignal); replacedOld = true; }
        await current(); await this._renameDependencies(staging, paths.dependenciesDirectory, operationSignal); replacedNew = true;
        await current();
        if (player === 'qqmusic') await rename(temporaryLogin, paths.loginScript);
        await journal({ phase: 'committed' });
        committed = true;
        this.messages.set(player, '固定 Python 依赖准备完成，可以测试连接。');
        return { ok: true, player, pythonExecutable, requirements: [...MUSIC_MCP_REQUIREMENTS], dependenciesDirectory: paths.dependenciesDirectory, ...(player === 'qqmusic' ? { loginDirectory: paths.loginDirectory, loginScript: paths.loginScript, loginCommand: { command: pythonExecutable, args: ['-S', '-u', '-c', MUSIC_MCP_BOOTSTRAP, paths.dependenciesDirectory, paths.loginScript], cwd: paths.loginDirectory } } : {}) };
      } finally {
        if (lock) {
          let cleaned = false;
          try {
            if (transaction) {
              if (!committed && replacedOld) { if (replacedNew) await this._removeDependencies(paths.dependenciesDirectory, player); await this._renameDependencies(transaction.previous, paths.dependenciesDirectory); replacedOld = false; }
              await this._removeDependencies(transaction.staging, player);
              if (committed && replacedOld) await this._removeDependencies(transaction.previous, player);
              await unlink(transaction.temporaryLogin).catch(error => { if (error.code !== 'ENOENT') throw error; });
            }
            cleaned = true;
          } finally { if (cleaned) await this._releaseLock(lock.info, lock.receipt); }
        }
      }
    });
  }
  async connect(player, { signal } = {}) {
    this._player(player); const { config } = await this._refresh();
    if (!this._supported(player)) throw failure(400, '此网易云桌面 MCP 上游仅支持 Windows。', 'unsupported_platform');
    if (!config[`${player}Enabled`]) throw failure(409, '请先在本机启用此音乐 MCP。', 'disabled');
    if (this.sessions.get(player)?.ready) return (await this.status()).servers.find(server => server.id === player);
    return this._operation(player, signal, this.connectTimeoutMs, async operationSignal => {
      const paths = await this._directories(player), env = isolatedMusicMcpEnvironment(this.env, { ...paths, config, player });
      const info = this._lockInfo('prepare', player);
      try { const receipt = await this._readLock(info); if (this.processExists(receipt.ownerPid) === false) await this._recoverDeadLock(info, receipt); else throw failure(409, '此本机作用域的依赖正在准备，锁的进程仍存在或无法确认退出。', 'prepare_busy'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const command = await this._python(config, player, env, paths.profile, operationSignal);
      if (operationSignal.aborted) throw operationSignal.reason || aborted();
      const args = player === 'netease' ? ['-S', '-u', '-c', MUSIC_MCP_BOOTSTRAP, paths.dependenciesDirectory, path.join(vendorRoot, 'netease', 'server.py')] : ['-S', '-u', '-c', MUSIC_MCP_MODULE_BOOTSTRAP, paths.dependenciesDirectory, 'mcp_qqmusic'];
      const transport = this.transportFactory({ command, args, env, cwd: paths.profile, stderr: 'pipe', maxBufferSize: MAX_OUTPUT_BYTES + 8192 });
      // SDK initialization also closes on failure. Share its close promise so
      // concurrent cancellation cannot report closed while that child still exits.
      const closeTransport = transport.close.bind(transport); let transportClosing;
      transport.close = () => transportClosing ||= Promise.resolve().then(closeTransport);
      const client = this.clientFactory({ player, command, args, env, cwd: paths.profile });
      const session = { client, transport, revision: config.revision, tools: [], validators: new Map(), ready: false }; this.sessions.set(player, session);
      let stderrBytes = 0;
      transport.stderr?.on('data', data => { stderrBytes += data.length; if (stderrBytes > MAX_OUTPUT_BYTES && this.sessions.get(player) === session) { for (const operation of this.operations) if (operation.player === player) operation.controller.abort(failure(502, '音乐 MCP 诊断输出过大。', 'output_limit')); void this._disconnectSession(player); } });
      const ended = () => { session.ready = false; if (this.sessions.get(player) === session) { this.sessions.delete(player); this.messages.set(player, '音乐 MCP 子进程已退出，请重新连接。'); } };
      client.onclose = ended; client.onerror = () => { if (this.sessions.get(player) === session) this.messages.set(player, '音乐 MCP 传输发生错误，请重新连接。'); };
      await client.connect(transport, { signal: operationSignal, timeout: this.connectTimeoutMs });
      const discovered = await client.listTools({}, { signal: operationSignal, timeout: this.connectTimeoutMs });
      if (!Array.isArray(discovered.tools) || discovered.tools.length > 64 || Buffer.byteLength(JSON.stringify(discovered)) > MAX_OUTPUT_BYTES) throw failure(502, '音乐 MCP 工具清单无效或过大。', 'output_limit');
      for (const tool of discovered.tools) {
        if (!MUSIC_MCP_SERVERS[player].tools.includes(tool.name)) continue;
        if (session.validators.has(tool.name) || typeof tool.description !== 'string' || tool.description.length > 8192 || !object(tool.inputSchema) || tool.inputSchema.type !== 'object' || Buffer.byteLength(JSON.stringify(tool.inputSchema)) > MAX_SCHEMA_BYTES) throw failure(502, '音乐 MCP 工具 schema 无效。', 'invalid_schema');
        const schema = { ...tool.inputSchema, additionalProperties: false };
        session.validators.set(tool.name, this.schemaValidator.getValidator(schema));
        session.tools.push({ name: tool.name, description: tool.description, inputSchema: schema });
      }
      if (!session.tools.length) throw failure(502, '上游未提供受支持的音乐工具。', 'missing_tools');
      if (operationSignal.aborted || this.sessions.get(player) !== session || (await this._read())?.revision !== config.revision) throw operationSignal.reason || failure(409, '音乐 MCP 配置或连接已变化，请重新连接。', 'config_changed');
      session.ready = true; this.messages.delete(player);
      return (await this.status()).servers.find(server => server.id === player);
    });
  }
  async call(body, { signal } = {}) {
    body = validateMusicMcpCall(body);
    const { player, tool } = body;
    if (signal?.aborted) throw aborted();
    const { changed } = await this._refresh(); if (changed) throw failure(409, '音乐 MCP 配置已变化，请重新连接后重试。', 'config_changed');
    if (!this.sessions.get(player)?.ready) await this.connect(player, { signal });
    const session = this.sessions.get(player), validator = session?.validators.get(tool);
    if (!validator) throw failure(400, '当前上游未提供此工具。', 'unknown_tool');
    const validation = validator(body.arguments); if (!validation.valid) throw failure(400, '音乐工具参数不符合上游 schema。', 'invalid_arguments');
    return this._operation(player, signal, this.callTimeoutMs, async operationSignal => {
      if ((await this._read())?.revision !== session.revision || !session.ready) throw failure(409, '音乐 MCP 配置或连接已变化，请重新连接。', 'config_changed');
      const result = await session.client.callTool({ name: tool, arguments: body.arguments }, undefined, { signal: operationSignal, timeout: this.callTimeoutMs });
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_OUTPUT_BYTES) throw failure(502, '音乐 MCP 返回内容过大。', 'output_limit');
      if ((await this._read())?.revision !== session.revision) throw failure(409, '音乐 MCP 配置已变化，请重新连接。', 'config_changed');
      const content = Array.isArray(result.content) ? result.content : [], texts = content.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text);
      const structuredContent = result.structuredContent;
      const jsonFailure = texts.some(text => { try { const value = JSON.parse(text); return object(value) && (value.success === false || value.ok === false); } catch { return false; } });
      const ok = result.isError !== true && !jsonFailure && !(object(structuredContent) && (structuredContent.success === false || structuredContent.ok === false)) && !(player === 'qqmusic' && texts.some(text => /^错误:/u.test(text.trimStart())));
      const response = { ok, player, tool, content, ...(structuredContent !== undefined ? { structuredContent } : {}) };
      if (player === 'qqmusic') {
        response.playbackStarted = false;
        if (ok && ['url', 'mv'].includes(tool)) { const match = texts.join('\n').match(/https?:\/\/[^\s<>"'\]\)]+/i); if (match) { try { const url = new URL(match[0]); if (!url.username && !url.password) response.url = url.href; } catch { /* preserve text only */ } } }
      }
      return response;
    });
  }
  async disconnect(player) {
    this._player(player);
    const operations = [...this.operations].filter(operation => operation.player === player);
    for (const operation of operations) operation.controller.abort(aborted());
    const result = await this._disconnectSession(player);
    await Promise.allSettled(operations.map(operation => operation.done));
    return result;
  }
  async _disconnectSession(player) {
    this._player(player); const session = this.sessions.get(player); if (!session) return { ok: true, player, connected: false };
    this.sessions.delete(player); session.ready = false;
    const closing = Promise.allSettled([Promise.resolve().then(() => session.client.close()), Promise.resolve().then(() => session.transport.close())]); this.closing.add(closing);
    let timeout;
    try { await Promise.race([closing, new Promise(resolve => { timeout = setTimeout(resolve, this.closeTimeoutMs); })]); }
    finally { clearTimeout(timeout); closing.finally(() => this.closing.delete(closing)); }
    return { ok: true, player, connected: false };
  }
  async close() {
    if (this.closed) return; this.closed = true;
    const operations = [...this.operations]; for (const operation of operations) operation.controller.abort(aborted());
    await Promise.allSettled([...this.sessions.keys()].map(player => this._disconnectSession(player)));
    await Promise.allSettled(operations.map(operation => operation.done));
    for (const child of this.children) { try { child.kill('SIGKILL'); } catch { /* lifecycle remains bounded */ } }
    let timeout; try { await Promise.race([Promise.allSettled([...this.closing]), new Promise(resolve => { timeout = setTimeout(resolve, this.closeTimeoutMs); })]); } finally { clearTimeout(timeout); }
  }
}
