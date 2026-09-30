import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, chmod, lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { normalizeComputerUseContent } from './dynamic-tool-output.mjs';
import { COMPUTER_USE_MCP_VERSION, COMPUTER_USE_PROFILES, COMPUTER_USE_PROFILE_TOOLS, COMPUTER_USE_TOOL_NAMES } from './computer-use-tool-names.mjs';

export { COMPUTER_USE_MCP_VERSION, COMPUTER_USE_PROFILES, COMPUTER_USE_PROFILE_TOOLS, COMPUTER_USE_TOOL_NAMES };
const failure = (status, message, code = 'computer_use_error') => Object.assign(new Error(message), { status, code });
const aborted = () => Object.assign(failure(499, '电脑操作已停止；已发生的操作不会撤销。', 'cancelled'), { name: 'AbortError' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_ARGUMENT_BYTES = 16 * 1024, MAX_SCHEMA_BYTES = 32 * 1024, MAX_LIST_BYTES = 1024 * 1024, MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const forbidden = new Set(['__proto__', 'constructor', 'prototype', 'approval_token']);
const configFields = ['revision', 'enabled', 'profile'];
const defaultConfig = () => ({ revision: randomUUID(), enabled: false, profile: 'full' });
const packageRoot = fileURLToPath(new URL('../node_modules/@zavora-ai/computer-use-mcp/', import.meta.url)).replace(/\.asar([\\/])/i, '.asar.unpacked$1');
const entryPoint = path.join(packageRoot, 'dist', 'server.js');
const sourceCommit = 'cfbb6af0e704da17c43df6c668225a2f84aca762';
const compatibilityRoot = fileURLToPath(new URL('./native/computer-use/', import.meta.url)).replace(/\.asar([\\/])/i, '.asar.unpacked$1');
const geometryPatch = Object.freeze({ file: 'linux-x11-window-geometry.patch', sha256: 'ad05d1b466c94d2ca90f009630ece9d8dcc0d52aa2b571a09a974d4b6f51ad71', baseCommit: sourceCommit });
const processExists = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'ESRCH' ? false : undefined; } };
const adapterActionFields = ['type', 'action', 'text', 'key', 'keys', 'x', 'y', 'coordinate', 'coordinates', 'pos', 'position', 'button', 'path', 'start_coordinate', 'start', 'end', 'scroll_x', 'scroll_y', 'dx', 'dy', 'direction', 'amount', 'clear', 'press_enter', 'virtual', 'native_overlay', 'show_agent_pointer', 'duration', 'seconds', 'time'];
let compatibilityMapper;

function boundedArguments(value, depth = 0) {
  if (depth > 8) throw failure(400, '电脑工具参数嵌套过深。', 'invalid_arguments');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { if (Buffer.byteLength(value) > 8192 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw failure(400, '电脑工具文本过长或含无效字符。', 'invalid_arguments'); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw failure(400, '电脑工具数值无效。', 'invalid_arguments'); return; }
  if (Array.isArray(value)) { if (value.length > 100) throw failure(400, '电脑工具列表最多 100 项。', 'invalid_arguments'); for (const item of value) boundedArguments(item, depth + 1); return; }
  if (!object(value) || Object.keys(value).length > 64 || Object.keys(value).some(key => forbidden.has(key))) throw failure(400, '电脑工具参数含未允许的字段。', 'invalid_arguments');
  for (const item of Object.values(value)) boundedArguments(item, depth + 1);
}

export function validateComputerUseCall(body) {
  if (!object(body) || Object.keys(body).some(key => !['tool', 'arguments'].includes(key)) || !COMPUTER_USE_TOOL_NAMES.includes(body.tool)) throw failure(400, '此电脑工具不在固定允许清单内。', 'unknown_tool');
  if (!object(body.arguments)) throw failure(400, '电脑工具 arguments 须为对象。', 'invalid_arguments');
  boundedArguments(body.arguments);
  if (Buffer.byteLength(JSON.stringify(body.arguments)) > MAX_ARGUMENT_BYTES) throw failure(400, '电脑工具参数最多 16 KiB。', 'invalid_arguments');
  return { tool: body.tool, arguments: JSON.parse(JSON.stringify(body.arguments)) };
}
export function validateComputerUseTools(body = {}) {
  if (!object(body) || Object.keys(body).some(key => key !== 'tool') || (body.tool !== undefined && !COMPUTER_USE_TOOL_NAMES.includes(body.tool))) throw failure(400, '电脑工具查询参数无效。', 'unknown_tool');
  return body.tool === undefined ? {} : { tool: body.tool };
}
function validateConfig(value) {
  if (!object(value) || Object.keys(value).length !== configFields.length || Object.keys(value).some(key => !configFields.includes(key)) || !uuid.test(value.revision) || typeof value.enabled !== 'boolean' || !COMPUTER_USE_PROFILES.includes(value.profile)) throw failure(400, '电脑操作配置格式无效。', 'invalid_config');
  return value;
}

/** Keep the real login/desktop context; never pass model, account or proxy credentials. */
export function isolatedComputerUseEnvironment(source, { profile, auditLog, nativeModulePath, electron = Boolean(process.versions.electron) } = {}) {
  const allowed = /^(?:path|systemroot|windir|systemdrive|comspec|pathext|programfiles(?:\(x86\))?|programw6432|programdata|appdata|localappdata|home|userprofile|homedrive|homepath|username|user|logname|shell|temp|tmp|tmpdir|lang|lc_[a-z_]+|display|wayland_display|xauthority|xdg_runtime_dir|xdg_session_type|xdg_current_desktop|xdg_session_desktop|dbus_session_bus_address|at_spi_bus_address)$/i;
  const env = Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.test(key) && typeof value === 'string' && !value.startsWith('()')));
  env.COMPUTER_USE_PROFILE = profile; env.COMPUTER_USE_ACTIVE_PROFILE = profile;
  env.COMPUTER_USE_AUDIT_LOG = auditLog;
  // PetPal authorizes each call before sending it. No model-supplied policy token
  // or MCP elicitation can create an independent permission path.
  env.COMPUTER_USE_REQUIRE_APPROVAL = 'false'; env.COMPUTER_USE_DESTRUCTIVE_REQUIRES_APPROVAL = 'false';
  env.COMPUTER_USE_BROWSER_DOM = 'false';
  if (nativeModulePath) env.COMPUTER_USE_NATIVE_PATH = nativeModulePath;
  if (electron) env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

/** Filesystem-only executable check; never runs a health or input command. */
const executableOnFilesystem = async file => { try { await access(file, fsConstants.X_OK); return (await stat(file)).isFile(); } catch { return false; } };
export async function linuxInputPreflight(tool, args, env, { isExecutable = executableOnFilesystem } = {}) {
  const wayland = env.XDG_SESSION_TYPE === 'wayland';
  const physicalType = ['type', 'multi_edit'].includes(tool);
  const keyboard = ['key', 'hold_key'].includes(tool);
  if (!physicalType && !keyboard) return;
  if (!wayland && !env.DISPLAY) throw failure(400, '此 Linux 输入路径需要 X11 DISPLAY；Wayland 请在真实桌面会话设置 XDG_SESSION_TYPE=wayland。', 'desktop_unavailable');
  const required = physicalType ? (wayland ? 'ydotool' : 'xdotool') : wayland ? 'ydotool' : null;
  if (!required) return; // X11 keys use the native XTest path, not a CLI.
  const directories = (env.PATH || '').split(':').filter(directory => path.posix.isAbsolute(directory));
  const available = async name => { for (const directory of directories) if (await isExecutable(path.posix.join(directory, name))) return true; return false; };
  if (!await available(required)) throw failure(400, `此 Linux 输入需要可执行的 ${required}；未发送桌面操作。`, 'linux_dependency_missing');
  // Longer/multiline type uses a clipboard paste path in upstream. Verify only
  // required binaries; daemon/display success still needs actual text readback.
  if (tool === 'type' && typeof args.text === 'string' && (args.text.length > 100 || args.text.includes('\n'))) {
    const clipboardReady = wayland ? await available('wl-copy') && await available('wl-paste') : await available('xclip') || await available('xsel');
    if (!clipboardReady) throw failure(400, `长文本输入需要 ${wayland ? 'wl-copy / wl-paste' : 'xclip 或 xsel'}；请优先用 Accessibility set_value，未发送桌面操作。`, 'linux_dependency_missing');
  }
}

function strictSchema(source, toolName) {
  const schema = JSON.parse(JSON.stringify(source));
  if (toolName === 'openai_computer') {
    // The upstream envelope declares action records open-ended. Expose only the
    // keys its fixed mapper consumes, then validate each translated action with
    // that canonical tool's live schema before dispatching the whole batch.
    const action = { type: 'object', properties: Object.fromEntries(adapterActionFields.map(key => [key, ['type', 'action', 'text', 'key'].includes(key) ? { type: 'string' } : {}])), additionalProperties: false };
    schema.properties.action = action;
    schema.properties.actions = { type: 'array', items: action, minItems: 1, maxItems: 20 };
    schema.oneOf = [{ required: ['action'], not: { required: ['actions'] } }, { required: ['actions'], not: { required: ['action'] } }];
  }
  // The SDK may advertise draft-2020 metadata for schemas using only common
  // object/array constraints. A fixed draft-07 compiler validates those fields.
  delete schema.$schema; delete schema.$id;
  const walk = (node, depth = 0) => {
    if (depth > 32) throw failure(502, '上游电脑工具 schema 嵌套过深。', 'invalid_schema');
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    if (node.$ref && (typeof node.$ref !== 'string' || !node.$ref.startsWith('#/'))) throw failure(502, '电脑工具 schema 含外部引用。', 'invalid_schema');
    if (node.type === 'object' || node.properties) {
      node.additionalProperties = false;
      if (node.properties) delete node.properties.approval_token;
      if (Array.isArray(node.required)) node.required = node.required.filter(key => key !== 'approval_token');
    }
    for (const [key, item] of Object.entries(node)) if (!['default', 'examples', 'enum', 'const'].includes(key)) walk(item, depth + 1);
  };
  walk(schema); return schema;
}
const versionAtLeast = (actual, minimum) => {
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(String(actual))) return false;
  const a = actual.split('.').map(Number), b = minimum.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
  return true;
};

/** Fixed stdio child; status does not launch it or invoke native diagnostics. */
export class ComputerUseMcpManager {
  constructor({ dataDir, scope = 'local', platform = process.platform, arch = process.arch, env = process.env, versions = process.versions,
    glibcVersion = process.platform === 'linux' ? process.report?.getReport()?.header?.glibcVersionRuntime : undefined,
    nativeModulePath, nativeCompatibility, processExists: pidExists = processExists, executableProbe,
    transportFactory = options => new StdioClientTransport(options), clientFactory = () => new Client({ name: 'petpal-computer-use', version: '1.0.0' }),
    connectTimeoutMs = 20000, callTimeoutMs = 45000, closeTimeoutMs = 5500 } = {}) {
    if (typeof dataDir !== 'string' || !dataDir || typeof scope !== 'string' || !scope || scope.length > 1024) throw new Error('ComputerUseMcpManager 需要本机目录与明确账号作用域。');
    if (nativeModulePath !== undefined && (typeof nativeModulePath !== 'string' || !path.isAbsolute(nativeModulePath))) throw new Error('电脑 native 模块必须使用可信的绝对路径。');
    this.dataDir = path.resolve(dataDir); this.scopeHash = createHash('sha256').update(scope).digest('hex').slice(0, 32);
    this.privateDir = path.join(this.dataDir, 'computer-use-mcp', this.scopeHash); this.configFile = path.join(this.privateDir, 'config.json'); this.lockFile = `${this.configFile}.lock`;
    this.platform = platform; this.arch = arch; this.env = env; this.versions = versions; this.glibcVersion = glibcVersion;
    this.nativeModulePath = nativeModulePath; this.nativeCompatibility = nativeCompatibility; this.processExists = pidExists; this.executableProbe = executableProbe;
    this.nativeCache = null; this.verifiedNative = null;
    this.transportFactory = transportFactory; this.clientFactory = clientFactory; this.connectTimeoutMs = connectTimeoutMs; this.callTimeoutMs = callTimeoutMs; this.closeTimeoutMs = closeTimeoutMs;
    this.ajv = new Ajv({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true, validateFormats: false });
    this.operation = null; this.session = null; this.closing = new Set(); this.closed = false; this.revision = null; this.message = ''; this.initializingConfig = null;
  }
  get busy() { return this.operation !== null; }
  _live() { if (this.closed) throw failure(503, '电脑操作管理器正在退出。', 'closed'); }
  _check(signal) { this._live(); if (signal?.aborted) throw signal.reason || aborted(); }
  async _directories() {
    for (const directory of [this.dataDir, path.join(this.dataDir, 'computer-use-mcp'), this.privateDir]) { await mkdir(directory, { recursive: true, mode: 0o700 }); const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw failure(409, '电脑操作配置目录不是固定的普通目录。', 'invalid_config'); await chmod(directory, 0o700); }
  }
  async _read() {
    let info; try { info = await lstat(this.configFile); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 4096) throw failure(409, '电脑操作配置文件无效；未覆盖现有文件。', 'invalid_config');
    try { return validateConfig(JSON.parse(await readFile(this.configFile, 'utf8'))); } catch (error) { if (error.code === 'ENOENT') return null; throw failure(409, '电脑操作配置文件无效；请恢复私有配置后重试。', 'invalid_config'); }
  }
  async _write(value) {
    const temporary = `${this.configFile}.${randomUUID()}.tmp`; let handle;
    try { handle = await open(temporary, 'wx', 0o600); await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); await handle.close(); handle = null; await rename(temporary, this.configFile); await chmod(this.configFile, 0o600); }
    finally { await handle?.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
  }
  async _lock(fn) {
    await this._directories();
    const receipt = { version: 1, ownerPid: process.pid, nonce: randomUUID(), scope: this.scopeHash }; let handle, claimed = false;
    for (let attempt = 0; ; attempt++) {
      try { handle = await open(this.lockFile, 'wx', 0o600); claimed = true; await handle.writeFile(JSON.stringify(receipt)); await handle.sync(); await handle.close(); handle = null; break; }
      catch (error) {
        await handle?.close().catch(() => {}); handle = null;
        if (claimed) { await unlink(this.lockFile).catch(() => {}); throw error; }
        if (error.code !== 'EEXIST') throw error;
        let previous;
        try { const info = await lstat(this.lockFile); if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 4096) throw new Error(); previous = JSON.parse(await readFile(this.lockFile, 'utf8')); if (!object(previous) || Object.keys(previous).length !== 4 || previous.version !== 1 || !Number.isInteger(previous.ownerPid) || previous.ownerPid < 1 || !uuid.test(previous.nonce) || previous.scope !== this.scopeHash) throw new Error(); }
        catch { throw failure(409, '电脑操作配置锁未知；请停止旧进程并备份锁文件后重试。', 'unknown_lock'); }
        if (this.processExists(previous.ownerPid) !== false || attempt > 0) throw failure(409, '此账号电脑配置正在由另一进程修改。', 'config_busy');
        const current = await readFile(this.lockFile, 'utf8'); if (current !== JSON.stringify(previous)) throw failure(409, '电脑配置锁已变化。', 'config_busy');
        await unlink(this.lockFile);
      }
    }
    try { return await fn(); }
    finally { try { const current = JSON.parse(await readFile(this.lockFile, 'utf8')); if (current.nonce === receipt.nonce && current.ownerPid === receipt.ownerPid) await unlink(this.lockFile); } catch { /* Never remove another owner's or unknown lock. */ } }
  }
  async _refresh() {
    this._live(); let config = await this._read();
    if (!config) {
      // Multiple settings panels may request status at the same instant. Share
      // this instance's first creation; independent processes still use CAS lock.
      this.initializingConfig ||= this._lock(async () => { this._live(); const current = await this._read(); if (current) return current; const initial = defaultConfig(); await this._write(initial); return initial; }).finally(() => { this.initializingConfig = null; });
      config = await this.initializingConfig;
    }
    const changed = this.revision !== null && this.revision !== config.revision;
    if (changed) { this.operation?.controller.abort(failure(409, '电脑操作配置已变化，请重新连接。', 'config_changed')); await this._disconnectSession(); }
    this.revision = config.revision; return { config, changed };
  }
  async config() { return { ...(await this._refresh()).config }; }
  async configure(body) {
    this._live();
    if (!object(body) || Object.keys(body).some(key => !configFields.includes(key)) || !uuid.test(body.revision) || (Object.hasOwn(body, 'enabled') && typeof body.enabled !== 'boolean') || (Object.hasOwn(body, 'profile') && !COMPUTER_USE_PROFILES.includes(body.profile))) throw failure(400, '电脑操作配置包含未支持的字段或缺少版本。', 'invalid_config');
    return this._operation(undefined, this.connectTimeoutMs, async signal => {
      const result = await this._lock(async () => {
        this._check(signal); const current = await this._read(); if (!current || body.revision !== current.revision) throw failure(409, '电脑操作配置已变化，请刷新后重试。', 'config_changed');
        const next = validateConfig({ ...current, ...body }); if (next.enabled === current.enabled && next.profile === current.profile) return current;
        next.revision = randomUUID(); await this._write(next); return next;
      });
      if (result.revision !== this.revision) await this._disconnectSession(); this.revision = result.revision; return { ...result };
    }, { disconnectOnError: false });
  }
  async _compatibleNative() {
    this.verifiedNative = null;
    if (this.platform !== 'linux') return null;
    const file = this.nativeModulePath || path.join(compatibilityRoot, `linux-${this.arch}`, `computer-use-napi.linux-${this.arch}.node`);
    const receiptFile = path.join(path.dirname(file), 'PROVENANCE.json'); let info, receiptInfo;
    try { info = await lstat(file); receiptInfo = await lstat(receiptFile); }
    catch (error) { if (error.code === 'ENOENT' && !this.nativeModulePath) return null; throw failure(400, 'Ubuntu 兼容 native 模块或来源记录缺失。', 'native_incompatible'); }
    if (!info.isFile() || info.isSymbolicLink() || info.size < 64 || info.size > 32 * 1024 * 1024 || !receiptInfo.isFile() || receiptInfo.isSymbolicLink() || receiptInfo.size < 1 || receiptInfo.size > 32768) throw failure(400, 'Ubuntu 兼容 native 文件或来源记录无效。', 'native_incompatible');
    const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (canonical(await realpath(file)) !== canonical(file) || canonical(await realpath(receiptFile)) !== canonical(receiptFile)) throw failure(400, 'Ubuntu 兼容 native 路径不可经过符号链接。', 'native_incompatible');
    const key = `${file}:${info.size}:${info.mtimeMs}:${receiptInfo.size}:${receiptInfo.mtimeMs}`;
    let receipt; try { receipt = JSON.parse(await readFile(receiptFile, 'utf8')); } catch { throw failure(400, 'Ubuntu 兼容 native 来源记录无效。', 'native_incompatible'); }
    if (!object(receipt) || receipt.version !== COMPUTER_USE_MCP_VERSION || receipt.platform !== 'linux' || receipt.arch !== this.arch || receipt.sourceCommit !== sourceCommit || receipt.nativeFile !== `computer-use-napi.linux-${this.arch}.node` || path.basename(file) !== receipt.nativeFile || receipt.bytes !== info.size || !/^[a-f0-9]{64}$/.test(receipt.sha256 || '') || receipt.minimumGlibc !== '2.35' || !versionAtLeast(receipt.minimumGlibc, receipt.requiredGlibc) || (this.nativeCompatibility && (this.nativeCompatibility.version !== receipt.version || this.nativeCompatibility.minimumGlibc !== receipt.minimumGlibc))) throw failure(400, 'Ubuntu native 来源、版本、架构或 glibc 记录不匹配。', 'native_incompatible');
    if (!object(receipt.source) || receipt.source.repository !== 'https://github.com/zavora-ai/computer-use-mcp' || receipt.source.commit !== sourceCommit || receipt.source.cargoLocked !== true || typeof receipt.source.modifiedTrackedSource !== 'boolean') throw failure(400, 'Ubuntu native 源码来源与固定构建记录不匹配。', 'native_incompatible');
    if (receipt.source.modifiedTrackedSource) {
      const patch = receipt.source.patch;
      if (!object(patch) || Object.keys(patch).length !== 3 || patch.file !== geometryPatch.file || patch.sha256 !== geometryPatch.sha256 || patch.baseCommit !== geometryPatch.baseCommit) throw failure(400, 'Ubuntu native 只接受已审计的固定窗口几何补丁。', 'native_incompatible');
      const patchPath = path.join(compatibilityRoot, 'patches', geometryPatch.file); let patchInfo;
      try { patchInfo = await lstat(patchPath); } catch { throw failure(400, 'Ubuntu native 固定补丁文件缺失。', 'native_incompatible'); }
      if (!patchInfo.isFile() || patchInfo.isSymbolicLink() || patchInfo.size < 1 || patchInfo.size > 32768 || canonical(await realpath(patchPath)) !== canonical(patchPath) || createHash('sha256').update(await readFile(patchPath)).digest('hex') !== geometryPatch.sha256) throw failure(400, 'Ubuntu native 固定补丁文件校验失败。', 'native_incompatible');
    } else if (receipt.source.patch !== undefined) throw failure(400, 'Ubuntu native 补丁记录与源码状态不匹配。', 'native_incompatible');
    if (this.nativeCache?.key === key) { this.verifiedNative = this.nativeCache.value; return this.verifiedNative; }
    const binary = await readFile(file);
    if (binary.length !== receipt.bytes || createHash('sha256').update(binary).digest('hex') !== receipt.sha256 || binary.subarray(0, 4).toString('hex') !== '7f454c46' || binary[4] !== 2 || binary[5] !== 1 || binary.readUInt16LE(18) !== (this.arch === 'x64' ? 62 : this.arch === 'arm64' ? 183 : -1)) throw failure(400, 'Ubuntu 兼容 native ELF 或 SHA-256 校验失败。', 'native_incompatible');
    this.verifiedNative = { path: file, minimumGlibc: receipt.minimumGlibc, sha256: receipt.sha256 }; this.nativeCache = { key, value: this.verifiedNative }; return this.verifiedNative;
  }
  async _runtimeReadiness() {
    const supported = ['win32', 'linux', 'darwin'].includes(this.platform) && ['x64', 'arm64'].includes(this.arch);
    const runtimeCompatible = Number(this.versions.napi) >= 9 && versionAtLeast(this.versions.node, '20.0');
    let native, nativeError; try { native = await this._compatibleNative(); } catch (error) { nativeError = error.message; }
    const minimumGlibc = native?.minimumGlibc || '2.39';
    const nativeCompatible = !nativeError && runtimeCompatible && (this.platform !== 'linux' || versionAtLeast(this.glibcVersion, minimumGlibc));
    const interactiveDesktop = this.platform !== 'linux' || Boolean(this.env.DISPLAY || this.env.WAYLAND_DISPLAY);
    const message = !supported ? '当前平台或架构无内置 native 模块。' : !runtimeCompatible ? '需要 Node 20+ 与 N-API 9+。' : nativeError || (!nativeCompatible ? `此 native 模块要求 glibc ${minimumGlibc}+；当前为 ${this.glibcVersion || '未知'}。Ubuntu 22.04 需兼容构建。` : !interactiveDesktop ? '请从当前用户的图形桌面登录会话启动客户端；没有 DISPLAY / WAYLAND_DISPLAY。' : '静态运行条件满足；系统权限和图形依赖需实际调用验证。');
    return { supported, nativeCompatible, interactiveDesktop, ready: supported && nativeCompatible && interactiveDesktop, ...(this.platform === 'linux' ? { glibcVersion: this.glibcVersion || null, minimumGlibc } : {}), message };
  }
  async status() {
    const config = await this.config(), readiness = await this._runtimeReadiness();
    let bundled = false; try { await access(entryPoint); bundled = true; } catch { /* Passive existence check only. */ }
    return { config, platform: this.platform, arch: this.arch, version: COMPUTER_USE_MCP_VERSION, connected: Boolean(this.session?.ready), toolsCount: this.session?.ready ? this.session.tools.length : 0, busy: this.busy, bundled, readiness, message: this.message || (this.session?.ready ? '已连接这台电脑的 stdio MCP。' : !config.enabled ? '电脑操作默认关闭。' : readiness.message) };
  }
  async _operation(signal, timeoutMs, fn, { disconnectOnError = true } = {}) {
    this._check(signal); if (this.busy) throw failure(409, '这台电脑正在处理此账号的 MCP 请求，请稍后再试。', 'busy');
    const controller = new AbortController(); let completed, rejectAbort;
    const operation = { controller, done: new Promise(resolve => { completed = resolve; }) }; this.operation = operation;
    const forward = () => controller.abort(aborted()); signal?.addEventListener('abort', forward, { once: true });
    if (signal?.aborted) forward();
    const timeout = setTimeout(() => controller.abort(failure(504, '电脑工具响应超时；未自动重试，已发生的操作不会撤销。', 'timeout')), timeoutMs);
    const stopped = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason || aborted()); controller.signal.addEventListener('abort', rejectAbort, { once: true }); if (controller.signal.aborted) rejectAbort(); });
    const work = Promise.resolve().then(() => { this._check(controller.signal); return fn(controller.signal); });
    try { return await Promise.race([work, stopped]); }
    catch (error) { if (disconnectOnError || controller.signal.aborted) await this._disconnectSession(); this.message = error.status ? error.message : '电脑操作连接失败；请检查 native 与系统权限后重连。'; if (error.status || error.name === 'AbortError') throw error; throw failure(502, '电脑 MCP 未能完成请求；未自动重试。', 'upstream_error'); }
    finally {
      clearTimeout(timeout); signal?.removeEventListener('abort', forward); controller.signal.removeEventListener('abort', rejectAbort);
      let deadline; try { await Promise.race([work.catch(() => {}), new Promise(resolve => { deadline = setTimeout(resolve, this.closeTimeoutMs); })]); } finally { clearTimeout(deadline); if (this.operation === operation) this.operation = null; completed(); }
    }
  }
  async _connect(signal) {
    this._check(signal); const { config, changed } = await this._refresh(); this._check(signal);
    if (changed) throw failure(409, '电脑操作配置已变化，请重新连接。', 'config_changed');
    if (!config.enabled) throw failure(409, '请先启用这台电脑的 Computer Use。', 'disabled');
    const readiness = await this._runtimeReadiness(); if (!readiness.ready) throw failure(400, readiness.message, !readiness.supported ? 'unsupported_platform' : !readiness.nativeCompatible ? 'native_incompatible' : 'desktop_unavailable');
    if (this.session?.ready && this.session.revision === config.revision) return this.session;
    await this._directories(); this._check(signal);
    const env = isolatedComputerUseEnvironment(this.env, { profile: config.profile, auditLog: path.join(this.privateDir, 'audit.jsonl'), nativeModulePath: this.verifiedNative?.path, electron: Boolean(this.versions.electron) });
    const options = { command: process.execPath, args: [entryPoint], env, cwd: this.privateDir, stderr: 'pipe', maxBufferSize: MAX_RESPONSE_BYTES + 8192 };
    const transport = this.transportFactory(options), closeTransport = transport.close.bind(transport); let transportClosing;
    transport.close = () => transportClosing ||= Promise.resolve().then(closeTransport);
    const client = this.clientFactory(options), session = { client, transport, revision: config.revision, tools: [], validators: new Map(), ready: false }; this.session = session;
    let stderrBytes = 0;
    transport.stderr?.on('data', data => { stderrBytes += data.length; if (stderrBytes > 256 * 1024 && this.session === session) { this.operation?.controller.abort(failure(502, '电脑 MCP 诊断输出过大。', 'output_limit')); void this._disconnectSession(); } });
    client.onclose = () => { session.ready = false; if (this.session === session) { this.session = null; this.message = '电脑 MCP 子进程已退出，请重新连接。'; } };
    client.onerror = () => { if (this.session === session) this.message = '电脑 MCP 传输发生错误，请重新连接。'; };
    await client.connect(transport, { signal, timeout: this.connectTimeoutMs }); this._check(signal);
    const discovered = await client.listTools({}, { signal, timeout: this.connectTimeoutMs }); this._check(signal);
    if (!Array.isArray(discovered.tools) || discovered.tools.length > 70 || Buffer.byteLength(JSON.stringify(discovered)) > MAX_LIST_BYTES) throw failure(502, '电脑 MCP 工具清单无效或过大。', 'output_limit');
    for (const tool of discovered.tools) {
      if (!COMPUTER_USE_PROFILE_TOOLS[config.profile].includes(tool.name)) continue;
      if (session.validators.has(tool.name) || typeof tool.description !== 'string' || Buffer.byteLength(tool.description) > 8192 || !object(tool.inputSchema) || tool.inputSchema.type !== 'object' || Buffer.byteLength(JSON.stringify(tool.inputSchema)) > MAX_SCHEMA_BYTES) throw failure(502, '电脑 MCP 工具 schema 无效。', 'invalid_schema');
      const inputSchema = strictSchema(tool.inputSchema, tool.name); let validator;
      try { validator = this.ajv.compile(inputSchema); } catch { throw failure(502, '电脑 MCP 工具 schema 无法严格验证。', 'invalid_schema'); }
      session.validators.set(tool.name, validator); session.tools.push({ name: tool.name, description: tool.description, inputSchema });
    }
    if (!session.tools.length) throw failure(502, '上游未提供此配置中的电脑工具。', 'missing_tools');
    this._check(signal); if (this.session !== session || (await this._read())?.revision !== config.revision) throw failure(409, '电脑 MCP 配置或连接已变化，请重新连接。', 'config_changed');
    session.ready = true; this.message = ''; return session;
  }
  async connect({ signal } = {}) { return this._operation(signal, this.connectTimeoutMs, async operationSignal => { await this._connect(operationSignal); return this.status(); }); }
  async tools(body = {}, { signal } = {}) {
    body = validateComputerUseTools(body);
    return this._operation(signal, this.connectTimeoutMs, async operationSignal => {
      const session = await this._connect(operationSignal);
      if (body.tool) { const tool = session.tools.find(tool => tool.name === body.tool); if (!tool) throw failure(400, '当前 MCP profile 未提供此工具。', 'unknown_tool'); return { kind: 'computer-use-mcp-tools', version: COMPUTER_USE_MCP_VERSION, profile: (await this._read()).profile, tool: JSON.parse(JSON.stringify(tool)) }; }
      return { kind: 'computer-use-mcp-tools', version: COMPUTER_USE_MCP_VERSION, profile: (await this._read()).profile, tools: session.tools.map(({ name, description }) => ({ name, description: description.slice(0, 650) })) };
    });
  }
  _callArguments(body, session) {
    const tool = session.tools.find(item => item.name === body.tool), validator = session.validators.get(body.tool);
    if (!tool || !validator) throw failure(400, '当前 MCP profile 未提供此工具。', 'unknown_tool');
    const args = body.arguments;
    if (tool.inputSchema.properties?.focus_strategy) args.focus_strategy = 'strict';
    if (['screenshot', 'openai_computer'].includes(body.tool)) {
      if (args.width !== undefined && (!Number.isInteger(args.width) || args.width < 1 || args.width > 1280)) throw failure(400, '截图宽度须为 1 到 1280 像素。', 'invalid_arguments');
      if (args.quality !== undefined && (!Number.isInteger(args.quality) || args.quality < 0 || args.quality > 80)) throw failure(400, '截图质量须为 0 到 80。', 'invalid_arguments');
      args.width ??= 1024; args.quality ??= 80;
      const capture = body.tool === 'screenshot' || args.return_screenshot === true || [args.action, ...(Array.isArray(args.actions) ? args.actions : [])].some(action => object(action) && String(action.type ?? action.action).toLowerCase() === 'screenshot');
      if (capture && this.platform === 'linux' && (this.env.XDG_SESSION_TYPE === 'wayland' || this.env.WAYLAND_DISPLAY) && (args.target_app !== undefined || args.target_window_id !== undefined)) throw failure(400, '此上游 Wayland 截图会忽略目标窗口；无法安全执行指定窗口截图。', 'wayland_window_capture_unavailable');
    }
    if (body.tool === 'zoom') {
      const region = args.region;
      if (!Array.isArray(region) || region.length !== 4 || region.some(value => !Number.isInteger(value)) || region[2] <= region[0] || region[3] <= region[1] || region[2] - region[0] > 1280 || region[3] - region[1] > 1280) throw failure(400, '截图区域须有效且宽高不超过 1280 像素。', 'invalid_arguments');
      if (args.quality !== undefined && (!Number.isInteger(args.quality) || args.quality < 0 || args.quality > 80)) throw failure(400, '截图质量须为 0 到 80。', 'invalid_arguments');
    }
    if (!validator(args)) throw failure(400, '电脑工具参数不符合实时上游 schema。请先查询该工具的参数。', 'invalid_arguments');
    return args;
  }
  async _adapterCalls(args, session) {
    compatibilityMapper ||= import(pathToFileURL(path.join(packageRoot, 'dist', 'session', 'openai-compat.js')).href);
    const { mapLegacyOpenAiAction } = await compatibilityMapper;
    const actions = Array.isArray(args.actions) ? args.actions : [args.action];
    const common = { ...(args.target_app === undefined ? {} : { target_app: args.target_app }), ...(args.target_window_id === undefined ? {} : { target_window_id: args.target_window_id }), focus_strategy: 'strict' };
    let mapped;
    try { mapped = actions.map(action => mapLegacyOpenAiAction(action, { common, width: args.width, quality: args.quality, ...(args.provider === undefined ? {} : { provider: args.provider }), useVirtualPointer: args.use_virtual_pointer === true })); }
    catch { throw failure(400, '兼容动作无效；未发送批次中的任何桌面操作。', 'invalid_arguments'); }
    if (args.return_screenshot === true) mapped.push({ tool: 'screenshot', args: { ...(common.target_app === undefined ? {} : { target_app: common.target_app }), ...(common.target_window_id === undefined ? {} : { target_window_id: common.target_window_id }), width: args.width, quality: args.quality, ...(args.provider === undefined ? {} : { provider: args.provider }), show_agent_pointer: args.use_virtual_pointer === true } });
    if (mapped.filter(call => call.tool === 'screenshot').length > 2) throw failure(400, '单个兼容批次最多返回两张截图；未发送任何桌面操作。', 'invalid_arguments');
    for (const call of mapped) this._callArguments({ tool: call.tool, arguments: call.args }, session);
    return mapped;
  }
  async call(body, { signal } = {}) {
    body = validateComputerUseCall(body);
    return this._operation(signal, this.connectTimeoutMs + this.callTimeoutMs, async operationSignal => {
      const session = await this._connect(operationSignal); const args = this._callArguments(body, session);
      const calls = body.tool === 'openai_computer' ? await this._adapterCalls(args, session) : [{ tool: body.tool, args }];
      if (this.platform === 'linux') for (const call of calls) await linuxInputPreflight(call.tool, call.args, this.env, { isExecutable: this.executableProbe });
      this._check(operationSignal);
      const result = await session.client.callTool({ name: body.tool, arguments: args }, undefined, { signal: operationSignal, timeout: this.callTimeoutMs });
      this._check(operationSignal); if ((await this._read())?.revision !== session.revision || this.session !== session) throw failure(409, '电脑配置或连接已变化，请重新连接。', 'config_changed');
      if (!object(result) || Buffer.byteLength(JSON.stringify(result)) > MAX_RESPONSE_BYTES) throw failure(502, '电脑 MCP 返回内容无效或过大。', 'output_limit');
      return { kind: 'computer-use-mcp', ok: result.isError !== true, tool: body.tool, content: normalizeComputerUseContent(result.content) };
    });
  }
  async _disconnectSession() {
    const session = this.session; if (!session) return { ok: true, connected: false };
    this.session = null; session.ready = false;
    const closing = Promise.allSettled([Promise.resolve().then(() => session.client.close()), Promise.resolve().then(() => session.transport.close())]); this.closing.add(closing);
    let deadline; try { await Promise.race([closing, new Promise(resolve => { deadline = setTimeout(resolve, this.closeTimeoutMs); })]); }
    finally { clearTimeout(deadline); closing.finally(() => this.closing.delete(closing)); }
    return { ok: true, connected: false };
  }
  async disconnect({ signal } = {}) {
    this._check(signal); const operation = this.operation; operation?.controller.abort(aborted());
    await this._disconnectSession(); await operation?.done; this._check(signal); return { ok: true, connected: false };
  }
  async close() {
    if (this.closed) return this.closePromise;
    this.closed = true; const operation = this.operation; operation?.controller.abort(aborted());
    this.closePromise = (async () => { await this._disconnectSession(); await operation?.done; let deadline; try { await Promise.race([Promise.allSettled([...this.closing]), new Promise(resolve => { deadline = setTimeout(resolve, this.closeTimeoutMs); })]); } finally { clearTimeout(deadline); } })();
    return this.closePromise;
  }
}
