import { spawn } from 'node:child_process';
import { access, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { createRequire } from 'node:module';
import { prepareCodexRuntime, publicCodexConfig } from './codex-config.mjs';
import { createCodexTransport } from './codex-transport.mjs';
import { AGENT_ACCESS, AGENT_APPROVAL, defaultAgentPermissions, normalizeAgentPermissions, codexPermissionParams } from './agent-permissions.mjs';
import { normalizeReasoningEffort } from './providers.mjs';
import { dynamicToolContentItems } from './dynamic-tool-output.mjs';

const require = createRequire(import.meta.url);

const RPC_TIMEOUT = 30_000;
const MAX_LINE = 8 * 1024 * 1024;
const APPROVAL_METHODS = new Map([
  ['item/commandExecution/requestApproval', 'command'],
  ['item/fileChange/requestApproval', 'fileChange'],
]);

const abortError = () => Object.assign(new Error('Codex 任务已停止'), { name: 'AbortError' });
const turnInactive = () => Object.assign(new Error('要引导的 Agent 任务已结束或已切换。'), { code: 'turn_not_active', status: 409 });
const steerUncertain = () => Object.assign(new Error('无法确认引导是否已送达，请检查当前任务后再试；不会自动重复发送。'), { code: 'steer_delivery_uncertain', status: 409 });

// Paths are resolved from authorized uploads by the service, never from raw HTTP
// input. This final protocol boundary still rejects remote URLs and malformed paths.
function userInput(content, images = []) {
  if (typeof content !== 'string' || content.length > 32000 || !Array.isArray(images) || images.length > 4) throw new Error('Agent 消息或图片格式无效。');
  const input = content.trim() ? [{ type: 'text', text: content }] : [];
  for (const image of images) {
    if (!image || typeof image !== 'object' || Array.isArray(image) || Object.keys(image).some(key => key !== 'path') ||
        typeof image.path !== 'string' || image.path.length > 4096 || /[\x00-\x1f\x7f]/.test(image.path) || !path.isAbsolute(image.path)) throw new Error('Agent 图片必须来自已验证的本地上传。');
    input.push({ type: 'localImage', path: image.path });
  }
  if (!input.length) throw new Error('请输入 Codex 任务或添加图片。');
  return input;
}
const safeText = (value) => String(value ?? '')
  .replace(/\b(sk-[\w-]{8,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[已隐藏]')
  .replace(/(Bearer\s+)[^\s"']+/gi, '$1[已隐藏]')
  .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*["']?)[^\s"',;]+/gi, '$1[已隐藏]');

function protocolError(method, error, apiMode = false) {
  const source = String(error?.message ?? '');
  const info = error?.codexErrorInfo;
  const httpStatus = error?.httpStatusCode ?? info?.httpStatusCode ?? info?.httpConnectionFailed?.httpStatusCode ?? info?.responseStreamConnectionFailed?.httpStatusCode ?? info?.responseStreamDisconnected?.httpStatusCode;
  const disconnected = info && typeof info === 'object' && ['responseStreamDisconnected', 'responseStreamConnectionFailed', 'responseTooManyFailedAttempts'].some(key => Object.hasOwn(info, key));
  let message = `Codex ${method} 失败`;
  if (/no route to host|network (?:is )?unreachable|\b(?:EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN)\b|no such host|(?:DNS|name resolution|lookup address).*(?:fail|error)/i.test(source)) message += '：模型服务网络不可达，请检查网关到上游的连接';
  else if (info === 'unauthorized' || /\b(?:auth|authentication|login|unauthorized|unauthenticated|401)\b/i.test(source)) message += apiMode ? '：请检查桌面助手的 API Key 与 Responses 服务配置' : '：请在这台电脑运行 codex login 完成登录';
  else if (info === 'usageLimitExceeded' || /rate.limit|quota|429/i.test(source)) message += '：额度或速率受限，请稍后重试';
  else if (info === 'serverOverloaded' || info === 'internalServerError' || (Number.isInteger(httpStatus) && httpStatus >= 500 && httpStatus <= 599) || /\b(?:HTTP(?:\/[\d.]+)?|status(?:\s+code)?)\s*[:=]?\s*5\d{2}\b/i.test(source)) message += '：模型上游服务暂时异常，请稍后重试或检查网关';
  else if (disconnected || /\b(?:ECONNRESET|ECONNABORTED|EPIPE|ETIMEDOUT)\b|connection (?:reset|closed|aborted)|stream (?:disconnected|interrupted)|(?:unexpected|premature) (?:EOF|end of (?:file|stream))|timed? out|request timeout/i.test(source)) message += '：模型连接中断，请检查网络后重新提交';
  else if (/model.*(?:not|invalid|support)/i.test(source)) message += '：当前模型不可用，请检查 Codex 模型配置';
  else if (/sandbox/i.test(source)) message += '：所选沙箱不可用，请检查执行主机的 Codex 沙箱设置';
  else if (typeof error?.code === 'number') message += `（代码 ${error.code}）`;
  // Never return raw RPC diagnostics: provider errors can contain request headers.
  return new Error(message);
}

async function isFile(file) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

async function npmEntrypoint(candidate) {
  const resolved = await realpath(candidate).catch(() => candidate);
  const roots = /\.[cm]?js$/i.test(resolved)
    ? [path.resolve(path.dirname(resolved), '..')]
    : [path.join(path.dirname(candidate), 'node_modules', '@openai', 'codex')];
  for (const root of roots) {
    const metadata = await readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (metadata?.name !== '@openai/codex') continue;
    const target = process.platform === 'win32'
      ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
      : process.platform === 'linux'
        ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`
        : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
    const platformPackage = `codex-${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
    const vendors = [
      path.join(root, 'node_modules', '@openai', platformPackage, 'vendor'),
      path.join(path.dirname(root), platformPackage, 'vendor'),
      path.join(root, 'vendor'),
    ];
    for (const vendor of vendors) {
      for (const folder of ['bin', 'codex']) {
        const binary = path.join(vendor, target, folder, binaryName);
        if (await isFile(binary)) return { file: binary, args: [] };
      }
    }
    const entry = path.join(root, 'bin', 'codex.js');
    if (await isFile(entry)) return { file: process.execPath, args: [entry] };
  }
  return null;
}

/** Electron native executables must live outside app.asar. No shell wrapper is used. */
export async function resolveBundledCodex(packageJsonPath) {
  if (!packageJsonPath) {
    try { packageJsonPath = require.resolve('@openai/codex/package.json'); }
    catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') return null;
      throw new Error('无法定位内置 Codex CLI 安装');
    }
  }
  const diskPackageJson = packageJsonPath.replace(/\.asar([\\/])/i, '.asar.unpacked$1');
  const root = path.dirname(diskPackageJson);
  const executable = await npmEntrypoint(path.join(root, 'bin', 'codex.js'));
  if (!executable || executable.args.length) {
    throw new Error(`内置 Codex CLI 缺少 ${process.platform}/${process.arch} 可执行文件，请重新安装完整桌面包`);
  }
  return executable;
}

/** Resolve executable paths without interpreting shell text or executing .cmd files. */
export async function resolveCodexCommand(command) {
  if (!command) {
    const bundled = await resolveBundledCodex();
    if (bundled) return bundled;
  }
  const parts = Array.isArray(command) ? command : [command || 'codex'];
  if (!parts.length || parts.some((value) => typeof value !== 'string' || value.includes('\0')) || !parts[0].trim()) {
    throw new Error('Codex command 必须是可执行文件路径，或由路径和参数构成的数组');
  }
  const [name, ...args] = parts;
  const explicitPath = path.isAbsolute(name) || /[\\/]/.test(name);
  const directories = explicitPath ? [''] : (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32' && !path.extname(name) ? ['.exe', '.cmd', '', '.ps1'] : [''];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = explicitPath ? path.resolve(name) : path.join(directory.replace(/^"|"$/g, ''), name + extension);
      if (!(await isFile(candidate))) continue;
      const npm = /^codex(?:\.(?:exe|cmd|bat|ps1|[cm]?js))?$/i.test(path.basename(candidate))
        ? await npmEntrypoint(candidate) : null;
      if (npm) return { file: npm.file, args: [...npm.args, ...args] };
      if (/\.(?:cmd|bat|ps1)$/i.test(candidate)) continue;
      const resolved = await realpath(candidate).catch(() => candidate);
      if (/\.[cm]?js$/i.test(resolved)) return { file: process.execPath, args: [resolved, ...args] };
      if (process.platform !== 'win32') {
        try { await access(candidate, constants.X_OK); } catch { continue; }
      }
      return { file: candidate, args };
    }
  }
  throw new Error('未找到可直接运行的 Codex CLI。请安装 @openai/codex 并运行 codex login；自定义 command 需指向可执行文件或 JavaScript 入口');
}

/** Owns one real Codex app-server process and its bounded dynamic-tool callbacks. */
export class CodexBridge {
  constructor({ workspaceRoot, command, config, dataDir, desktopTools } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot || path.join(homedir(), '.petpal', 'workspace'));
    this.command = command;
    this.config = config ? { ...config } : null;
    this.apiMode = config?.mode === 'api';
    this.dataDir = dataDir;
    if (this.apiMode && !dataDir) throw new Error('API Codex 必须指定独立数据目录。');
    if (this.apiMode) this.workspaceRoot = path.resolve(dataDir, 'codex', config.revision, 'workspace');
    this.desktopTools = desktopTools;
    this.toolNames = new Set((desktopTools?.specs ?? []).filter(spec => spec.type === 'function').map(spec => spec.name));
    this.dynamicTasks = new Set();
    this.child = null;
    this.transport = null;
    this.initializing = null;
    this.closed = false;
    this.closing = null;
    this.childClosures = new WeakMap();
    this.transportClosures = new WeakMap();
    this.pending = new Map();
    this.runs = new Map();
    this.resuming = new Set();
    this.conversations = new Set();
    this.approvals = new Map();
    this.sequence = 0;
    this.lastError = null;
    this.identity = null;
    this.terminations = new Set();
  }

  async status() {
    const base = {
      workspaceRoot: this.workspaceRoot, sandbox: 'read-only', approvalPolicy: 'on-request',
      permissions: defaultAgentPermissions(), permissionControls: { access: [...AGENT_ACCESS], approval: [...AGENT_APPROVAL] }, supportsSteer: true,
      activeRuns: this.runs.size, pendingApprovals: this.approvals.size,
      ...(this.config ? { ...publicCodexConfig(this.config), credentialConfigured: Boolean(this.config.apiKey), apiVerified: false, executionMode: 'sandboxed-cli' } : {}),
    };
    try {
      await this._ensureStarted();
      const account = await this._readAccount();
      return { ...base, available: true, running: true, ...account };
    } catch (error) {
      return { ...base, available: false, running: Boolean(this.child), authenticated: false,
        requiresOpenaiAuth: null, authType: null, error: error.message };
    }
  }

  async _readAccount() {
    if (this.apiMode) return { authenticated: Boolean(this.config.baseUrl && this.config.model), requiresOpenaiAuth: false, authType: 'api-key' };
    const result = await this._rpc('account/read', { refreshToken: false });
    return {
      authenticated: Boolean(result.account) || result.requiresOpenaiAuth === false,
      requiresOpenaiAuth: result.requiresOpenaiAuth !== false,
      authType: result.account?.type ?? null,
    };
  }

  async _ensureStarted() {
    if (this.closed) throw new Error('Codex 后台已关闭');
    if (this.initializing) return this.initializing;
    if (this.child && this.identity) return;
    this.initializing = this._start();
    try { await this.initializing; } finally { this.initializing = null; }
  }

  async _start() {
    // A failed child may still be closing its HTTP response or private listener.
    // Finish that generation before publishing another CLI/runtime configuration.
    await Promise.all(this.terminations);
    await Promise.allSettled([...this.dynamicTasks]);
    if (this.closed) throw new Error('Codex 后台已关闭');
    const executable = await resolveCodexCommand(this.command);
    if (this.closed) throw new Error('Codex 后台已关闭');
    let transport;
    let runtime;
    let child;
    try {
      if (this.apiMode) {
        transport = await createCodexTransport({ config: this.config, authorizeModel: model =>
          [...this.runs.values()].some(run => run.model === model && run.child === this.child && !run.aborted && !run.settled && !run.finishing) });
        if (this.closed) throw new Error('Codex 后台已关闭');
        this.transport = transport;
        // Only the loopback credential reaches Codex. Preserve this.config for
        // public status and redaction of the actual upstream credential.
        runtime = await prepareCodexRuntime({ ...this.config, baseUrl: transport.baseUrl, apiKey: transport.apiKey }, this.dataDir);
      }
      if (runtime) this.workspaceRoot = runtime.workspaceRoot;
      await mkdir(this.workspaceRoot, { recursive: true });
      if (this.closed) throw new Error('Codex 后台已关闭');
      child = spawn(executable.file, [...executable.args,
        'app-server', '--listen', 'stdio://',
        '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="on-request"', '-c', 'approvals_reviewer="user"',
        ...(this.apiMode ? ['-c', 'features.shell_tool=true', '-c', 'features.unified_exec=true'] : []),
      ], {
        cwd: this.workspaceRoot, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
        windowsHide: true, detached: process.platform !== 'win32',
        env: runtime?.env ?? { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      this.child = child;
      // Register immediately: exit/taskkill completion can precede stdio closure on Windows.
      this.childClosures.set(child, new Promise(resolve => child.once('close', resolve)));
      this.lastError = null;
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      child.stdout.on('data', (chunk) => {
        buffer += decoder.write(chunk);
        if (buffer.length > MAX_LINE) return this._fail(new Error('Codex 返回的数据超过安全长度限制'), child);
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try { this._message(JSON.parse(line)); }
          catch { this._fail(new Error('Codex 返回了无效的协议数据'), child); break; }
        }
      });
      // Drain stderr so the process cannot deadlock; never persist provider/config secrets from it.
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => this._fail(new Error('Codex 后台输入通道已关闭'), child));
      child.on('error', () => this._fail(new Error('无法启动 Codex CLI，请检查安装与可执行文件权限'), child));
      child.on('exit', (code) => this._fail(new Error(`Codex 后台已退出${Number.isInteger(code) ? `（代码 ${code}）` : ''}`), child));
      this.identity = await this._rpc('initialize', { clientInfo: { name: 'petpal', title: '小伴 PetPal', version: '0.5.0' }, capabilities: { experimentalApi: true } });
      this._send({ method: 'initialized', params: {} });
    } catch (error) {
      if (child && child === this.child) this._fail(error, child);
      if (transport) {
        if (this.transport === transport) this.transport = null;
        await this._disposeTransport(transport);
      }
      await Promise.all(this.terminations);
      throw error;
    }
  }

  _send(message) {
    if (!this.child?.stdin.writable || this.child.killed) throw new Error('Codex 后台连接不可用');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timeout = setTimeout(() => {
        this._fail(new Error(`Codex ${method} 响应超时，后台已停止以避免遗留任务`));
      }, RPC_TIMEOUT);
      this.pending.set(id, { resolve, reject, timeout, method });
      try { this._send({ id, method, params }); }
      catch (error) { clearTimeout(timeout); this.pending.delete(id); reject(error); }
    });
  }

  _message(message) {
    if (!message || typeof message !== 'object') return;
    if ('id' in message && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error) pending.reject(protocolError(pending.method, message.error, this.apiMode));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (message.method && 'id' in message) return this._serverRequest(message);
    const params = message.params ?? {};
    const run = this.runs.get(params.threadId);
    if (!run) return;
    const eventTurn = params.turnId ?? params.turn?.id;
    if (run.turnId && eventTurn && eventTurn !== run.turnId) return;
    switch (message.method) {
      case 'turn/started':
        this._recordTurn(run, params.turn.id);
        this._emit(run, 'status', { state: 'working', message: 'Codex 正在处理' });
        if (run.aborted) this._interrupt(run);
        break;
      case 'item/agentMessage/delta':
        if (typeof params.delta === 'string') {
          this._appendText(run, params.delta);
          if (params.itemId) run.streamedItems.add(params.itemId);
        }
        break;
      case 'item/started':
      case 'item/completed': {
        const item = params.item;
        if (!item) break;
        if (item.id) run.items.set(item.id, item);
        if (message.method === 'item/completed' && item.type === 'agentMessage' && !run.streamedItems.has(item.id) && item.text) {
          this._appendText(run, item.text);
          run.streamedItems.add(item.id);
        } else if (message.method === 'item/started' && ['commandExecution', 'fileChange', 'mcpToolCall'].includes(item.type)) {
          this._emit(run, 'status', { state: 'working', message: item.type === 'commandExecution' ? 'Codex 正在执行操作' : item.type === 'fileChange' ? 'Codex 正在准备文件变更' : 'Codex 正在调用工具' });
        }
        break;
      }
      case 'serverRequest/resolved':
        for (const [id, approval] of this.approvals) {
          if (approval.rpcId === params.requestId) { this.approvals.delete(id); this._emit(run, 'approval-resolved', { id }); }
        }
        this._emit(run, 'status', { state: 'working', message: '审批请求已处理' });
        break;
      case 'error':
        if (params.willRetry) this._emit(run, 'status', { state: 'retrying', message: 'Codex 连接暂时异常，正在重试' });
        else run.failure = protocolError('turn', params.error, this.apiMode);
        break;
      case 'turn/completed':
        if (params.turn?.status === 'interrupted' || run.aborted) this._finish(run, abortError());
        else if (params.turn?.status !== 'completed' || run.failure) this._finish(run, run.failure || protocolError('turn', params.turn?.error, this.apiMode));
        else this._finish(run);
        break;
    }
  }

  _serverRequest(message) {
    const params = message.params ?? {};
    const run = this.runs.get(params.threadId);
    const kind = APPROVAL_METHODS.get(message.method);
    if (!run || run.settled || run.aborted || (run.turnId && params.turnId !== run.turnId)) {
      this._send({ id: message.id, error: { code: -32000, message: 'No active PetPal turn for this request' } });
      return;
    }
    if (message.method === 'item/tool/call') { this._dynamicTool(message, run); return; }
    if (kind && run.permissions.approval === 'auto') {
      this._send({ id: message.id, result: { decision: 'decline' } });
      this._emit(run, 'status', { state: 'blocked', message: '自动运行不会额外提权，已拒绝超出当前授权范围的请求' });
      return;
    }
    if (!kind) {
      // Unsupported permission/tool forms are never implicitly accepted.
      if (message.method === 'item/permissions/requestApproval') this._send({ id: message.id, result: { permissions: {}, scope: 'turn' } });
      else this._send({ id: message.id, error: { code: -32601, message: 'This client does not support this interactive request' } });
      this._emit(run, 'status', { state: 'blocked', message: 'Codex 请求了当前界面不支持的交互，已拒绝；可停止后调整任务' });
      return;
    }
    const item = run.items.get(params.itemId);
    const reviewable = kind === 'command'
      ? Boolean(params.command || item?.command || params.networkApprovalContext?.host)
      : Boolean(params.grantRoot || (Array.isArray(item?.changes) && item.changes.length));
    if (!reviewable) {
      this._send({ id: message.id, result: { decision: 'decline' } });
      this._emit(run, 'status', { state: 'blocked', message: 'Codex 未提供可供确认的操作内容，已拒绝本次请求' });
      return;
    }
    const details = [params.reason];
    if (params.networkApprovalContext) details.push(`网络访问：${params.networkApprovalContext.protocol || ''}://${params.networkApprovalContext.host || ''}`);
    if (params.command || item?.command) details.push(`命令：${params.command || item.command}`);
    if (params.cwd) details.push(`目录：${params.cwd}`);
    if (params.grantRoot) details.push(`写入范围：${params.grantRoot}`);
    if (Array.isArray(item?.changes)) {
      for (const change of item.changes) details.push(`${change.path || ''}\n${change.diff || ''}`);
    }
    const description = safeText(details.filter(Boolean).join('\n') || (kind === 'command' ? 'Codex 请求执行一项操作' : 'Codex 请求修改文件'));
    const id = randomUUID();
    this.approvals.set(id, { rpcId: message.id, run });
    this._emit(run, 'approval', { id, kind, description });
  }

  _redact(value) {
    const text = String(value ?? '');
    return this.config?.apiKey ? text.split(this.config.apiKey).join('[已隐藏]') : text;
  }

  _appendText(run, value = '', flush = false) {
    // Retain a suffix so a provider cannot leak its key by splitting it across
    // stream events. Host mode keeps the original zero-buffer streaming behavior.
    const key = this.config?.apiKey;
    const pending = this._redact((run.pendingText || '') + value);
    const length = flush || !key ? pending.length : Math.max(0, pending.length - key.length + 1);
    const text = pending.slice(0, length);
    run.pendingText = pending.slice(length);
    if (text) { run.text += text; this._emit(run, 'delta', { text }); }
  }

  _redactValue(value) {
    if (typeof value === 'string') return this._redact(value);
    if (Array.isArray(value)) return value.map(item => this._redactValue(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this._redactValue(item)]));
    return value;
  }

  _dynamicTool(message, run) {
    const p = message.params;
    const reject = text => this._send({ id: message.id, result: { success: false, contentItems: [{ type: 'inputText', text }] } });
    if (!run.turnId || p.turnId !== run.turnId || (p.namespace !== null && p.namespace !== undefined) || typeof p.callId !== 'string' || !p.callId || p.callId.length > 256 || !this.toolNames.has(p.tool)) {
      reject('PetPal 拒绝了不属于当前任务或未注册的工具请求。'); return;
    }
    if (run.dynamicCalls.has(p.callId)) { reject('工具 callId 已处理，禁止重复执行。'); return; }
    if (run.dynamicCalls.size >= 128) { reject('本轮工具调用数量达到上限。'); return; }
    if (!p.arguments || typeof p.arguments !== 'object' || Array.isArray(p.arguments) || JSON.stringify(p.arguments).length > 16_384) { reject('工具参数必须是大小受限的 JSON 对象。'); return; }
    const call = { rpcId: message.id, run, name: p.tool, arguments: structuredClone(p.arguments), controller: new AbortController(), replied: false, started: false };
    run.dynamicCalls.set(p.callId, call);
    let description;
    try {
      description = this.desktopTools.describe(call.name, call.arguments);
      if (!description || typeof description.description !== 'string' || !description.description.trim() || typeof description.approvalRequired !== 'boolean') throw new Error('工具未提供可审阅的描述。');
    } catch (error) { this._replyDynamic(call, false, { error: safeText(this._redact(error.message)) }); return; }
    if (description.approvalRequired && run.permissions.access !== 'full-access') {
      this._replyDynamic(call, false, { error: '主机音乐、浏览器与 Computer Use 操作需要完全访问权限；当前只允许查询状态。' }); return;
    }
    if (description.approvalRequired && run.permissions.approval !== 'auto') {
      const id = randomUUID();
      this.approvals.set(id, { rpcId: message.id, run, dynamic: call });
      this._emit(run, 'approval', { id, kind: 'desktopTool', description: safeText(this._redact(description.description)).slice(0, 8000) });
    } else this._executeDynamic(call);
  }

  _replyDynamic(call, success, value) {
    if (call.replied) return;
    call.replied = true;
    let contentItems;
    try { contentItems = dynamicToolContentItems(value, text => safeText(this._redact(text))); }
    catch (error) {
      const text = error?.code === 'output_limit' ? 'Computer Use 工具返回内容超过大小限制。'
        : error?.code === 'invalid_output' ? 'Computer Use 工具返回的文字或图片格式无效。'
        : error?.code === 'dynamic_output_limit' ? '工具返回内容超过大小限制。' : '工具返回了不可序列化的数据。';
      contentItems = [{ type: 'inputText', text }];
      success = false;
    }
    if (call.run.child !== this.child) return;
    try { this._send({ id: call.rpcId, result: { success: success && value?.ok !== false, contentItems } }); } catch {}
  }

  _executeDynamic(call) {
    if (call.started || call.replied) return;
    call.started = true;
    const { run } = call;
    const task = Promise.resolve().then(async () => {
      if (run.settled || run.aborted || call.controller.signal.aborted) throw abortError();
      this._emit(run, 'status', { state: 'working', message: '正在执行已授权的桌面工具' });
      call.controller.signal.throwIfAborted();
      const result = await this.desktopTools.execute(call.name, call.arguments, { signal: call.controller.signal, conversationId:run.conversationId });
      call.controller.signal.throwIfAborted();
      this._replyDynamic(call, result?.ok !== false, result ?? {});
    }).catch(error => {
      this._replyDynamic(call, false, { error: call.controller.signal.aborted || run.aborted ? '操作已停止。' : safeText(this._redact(error.message)) });
    }).finally(() => { run.toolTasks.delete(task); this.dynamicTasks.delete(task); });
    run.toolTasks.add(task); this.dynamicTasks.add(task);
  }

  approve(id, decision) {
    if (!['accept', 'decline'].includes(decision)) throw new Error('审批结果只能是 accept 或 decline');
    const approval = this.approvals.get(id);
    if (!approval || approval.run.settled || approval.run.aborted) throw new Error('审批请求不存在或已过期');
    this.approvals.delete(id);
    if (approval.dynamic) {
      if (decision === 'accept') this._executeDynamic(approval.dynamic);
      else this._replyDynamic(approval.dynamic, false, { error: '用户拒绝了本次操作。' });
    } else this._send({ id: approval.rpcId, result: { decision } });
    this._emit(approval.run, 'status', { state: 'working', message: decision === 'accept' ? '已允许本次操作' : '已拒绝本次操作' });
    return { ok: true };
  }

  _emit(run, type, data) {
    if (run.settled) return;
    try { run.onEvent?.(type, this._redactValue(data)); } catch {
      run.aborted = true;
      this._interrupt(run);
    }
  }

  _recordTurn(run, turnId) {
    if (typeof turnId !== 'string' || !turnId || run.settled || run.turnId === turnId) return;
    if (run.turnId) throw new Error('Codex 返回了与当前任务不一致的任务 ID');
    run.turnId = turnId;
    this._emit(run, 'turn', { turnId });
  }

  async steer({ conversationId, expectedTurnId, content, images } = {}) {
    const input = userInput(content, images);
    if (typeof conversationId !== 'string' || !conversationId || typeof expectedTurnId !== 'string' || !expectedTurnId) throw turnInactive();
    const run = [...this.runs.values()].find(item => item.conversationId === conversationId);
    if (!run || run.settled || run.aborted || run.turnId !== expectedTurnId || run.child !== this.child) throw turnInactive();
    // Only this preflight is known not to have delivered. Every error after the
    // write is uncertain, so callers must never retry it as a queued prompt.
    let result;
    try { result = await this._rpc('turn/steer', { threadId: run.threadId, expectedTurnId, input }); }
    catch { throw steerUncertain(); }
    if (result.turnId !== expectedTurnId) throw steerUncertain();
    return { turnId: result.turnId };
  }

  async run({ prompt = '', threadId, conversationId, model, effort, permissions, images, signal, onEvent } = {}) {
    const input = userInput(prompt, images);
    permissions = normalizeAgentPermissions(permissions);
    if (model !== undefined && (typeof model !== 'string' || !model.trim() || model.length > 160 || /[\x00-\x1f\x7f]/.test(model))) throw new Error('Agent 模型 ID 无效。');
    if (effort !== undefined) effort = normalizeReasoningEffort(effort);
    if (conversationId !== undefined && (typeof conversationId !== 'string' || !conversationId || conversationId.length > 160)) throw new Error('Agent 会话 ID 无效。');
    if (threadId && (this.runs.has(threadId) || this.resuming.has(threadId))) throw new Error('此 Codex 会话已有运行中的任务');
    if (conversationId && this.conversations.has(conversationId)) throw new Error('此 Codex 会话已有运行中的任务');
    if (signal?.aborted) throw abortError();
    if (threadId) this.resuming.add(threadId);
    if (conversationId) this.conversations.add(conversationId);
    let run;
    try {
      await this._ensureStarted();
      const auth = await this._readAccount();
      if (!auth.authenticated) throw new Error('Codex 尚未登录。请在这台电脑运行 codex login，然后重试');
      if (signal?.aborted) throw abortError();
      model ??= this.apiMode ? this.config.model : undefined;
      effort = effort || (this.apiMode ? this.config.reasoningEffort : '');
      const { sandboxPolicy, ...threadPermissions } = codexPermissionParams(permissions, this.workspaceRoot);
      const threadParams = { cwd: this.workspaceRoot, ...threadPermissions, ...(model ? { model } : {}), developerInstructions: '根据本轮访问范围执行任务。音乐优先使用 PetPal 桌面工具；搜索、队列、音量、歌词先通过 petpal_music_mcp_tools 获取本机真实工具与参数，再用 petpal_music_mcp_call。网易云 MCP 仅支持 Windows；播放/暂停/上一首/下一首使用 petpal_music_command 的指定客户端媒体会话，不使用全局热键。QQ MCP 只提供查询和播放链接，返回 URL 不代表桌面已经播放；排行榜用 detail(type=top)。未启用时提示用户在该电脑的电脑助手设置中准备 MCP，不自行安装或更改配置。网页查询先调用 petpal_opencli_sites 获取选中执行电脑的可调用命令与参数，再调用 petpal_opencli_query；这是包内 OpenCLI，公开查询不需要 Chrome 扩展。库存存在不等于可调用或已联网验收，不执行未开放命令，不用 shell/npx/自建HTTP脚本替代。OpenCLI 关闭时提示在该执行电脑的电脑助手设置启用，不自行改配置。音乐网页操作使用 petpal_browser，需要扩展与显式Chrome档案。桌面操作使用 petpal_computer_use_tools 发现当前执行电脑的真实工具与 schema，再调用 petpal_computer_use_call。先发现应用和窗口，再检查 Accessibility；需要视觉信息时获取目标窗口截图，根据最近的 Accessibility/截图执行鼠标键盘或窗口操作，操作后重新读取状态验证结果。过时的窗口、控件和坐标不可复用；截图失败时不得凭猜测点击。Computer Use 未启用时提示配置，不运行 npx 安装，不修改 MCP 启动参数或环境。受限权限不允许操作主机软件。失败时如实说明，不得声称已完成。', ...(this.apiMode ? { modelProvider: 'petpal' } : {}) };
      const result = await this._rpc(threadId ? 'thread/resume' : 'thread/start', { ...threadParams, ...(threadId ? { threadId } : { dynamicTools: this.desktopTools?.specs ?? [] }) });
      const actualId = result.thread?.id;
      if (typeof actualId !== 'string' || !actualId) throw new Error('Codex 未返回有效会话 ID');
      if (this.runs.has(actualId)) throw new Error('此 Codex 会话已有运行中的任务');
      if (signal?.aborted) throw abortError();
      let resolve, reject;
      const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
      // A notification can finish a turn before the turn/start response arrives.
      completion.catch(() => {});
      run = { threadId: actualId, conversationId, model, permissions, turnId: null, text: '', onEvent, resolve, reject, completion, signal,
        aborted: false, settled: false, interrupting: false, items: new Map(), streamedItems: new Set(), dynamicCalls: new Map(), toolTasks: new Set(), child: this.child };
      run.onAbort = () => { run.aborted = true; this._interrupt(run); };
      signal?.addEventListener('abort', run.onAbort, { once: true });
      this.runs.set(actualId, run);
      this._emit(run, 'thread', { threadId: actualId });
      this._emit(run, 'status', { state: 'starting', message: '正在启动 Codex 任务' });
      if (signal?.aborted || run.aborted) throw abortError();
      const started = await this._rpc('turn/start', {
        threadId: actualId, input, cwd: this.workspaceRoot,
        approvalPolicy: threadPermissions.approvalPolicy, approvalsReviewer: threadPermissions.approvalsReviewer, sandboxPolicy,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
      });
      this._recordTurn(run, started.turn?.id);
      if (!run.turnId && !run.settled) throw new Error('Codex 未返回有效任务 ID');
      if (run.aborted && !run.settled) this._interrupt(run);
      return await completion;
    } catch (error) {
      if (run && !run.settled) this._finish(run, error);
      if (run) await run.completion.catch(() => {});
      throw error;
    } finally {
      if (threadId) this.resuming.delete(threadId);
      if (conversationId) this.conversations.delete(conversationId);
    }
  }

  async _interrupt(run) {
    if (run.interrupting || run.settled) return;
    // Resolve pending approval callbacks before interrupting so no modal can strand a turn.
    for (const [id, approval] of this.approvals) {
      if (approval.run !== run) continue;
      if (approval.dynamic) this._replyDynamic(approval.dynamic, false, { error: '操作已停止。' });
      else { try { this._send({ id: approval.rpcId, result: { decision: 'decline' } }); } catch {} }
      this.approvals.delete(id);
    }
    for (const call of run.dynamicCalls.values()) {
      call.controller.abort();
      this._replyDynamic(call, false, { error: '操作已停止。' });
    }
    // Approval notifications can precede the turn/start acknowledgement. Decline them
    // immediately even while waiting for the turn ID needed by turn/interrupt.
    if (!run.turnId) return;
    run.interrupting = true;
    try {
      await this._rpc('turn/interrupt', { threadId: run.threadId, turnId: run.turnId });
      if (!run.settled) {
        run.interruptTimeout = setTimeout(() => this._fail(new Error('Codex 停止确认超时，后台已终止')), 5000);
      }
    } catch { this._fail(new Error('Codex 无法确认停止，后台已终止')); }
  }

  _finish(run, error) {
    if (run.settled || run.finishing) return;
    run.finishing = true;
    this._appendText(run, '', true);
    if (!error && !run.aborted && this.apiMode && !run.text.trim()) {
      error = new Error('Codex Responses 服务未返回可显示的回复，请检查服务的流式响应兼容性后重试。');
    }
    run.settled = true;
    clearTimeout(run.interruptTimeout);
    run.signal?.removeEventListener('abort', run.onAbort);
    for (const call of run.dynamicCalls.values()) {
      call.controller.abort();
      this._replyDynamic(call, false, { error: '任务已结束。' });
    }
    for (const [id, approval] of this.approvals) if (approval.run === run) this.approvals.delete(id);
    // Stop is complete only after owned tool processes have actually exited.
    Promise.allSettled([...run.toolTasks, ...(run.child !== this.child ? [this.childClosures.get(run.child)] : [])]).then(() => {
      if (this.runs.get(run.threadId) === run) this.runs.delete(run.threadId);
      if (error || run.aborted) run.reject(run.aborted ? abortError() : error);
      else run.resolve({ threadId: run.threadId, text: run.text });
    });
  }

  _fail(error, child = this.child) {
    if (child !== this.child) return;
    this.lastError = error.message;
    this.child = null;
    this.identity = null;
    const transport = this.transport;
    this.transport = null;
    if (transport) this._disposeTransport(transport);
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    this.pending.clear();
    for (const run of this.runs.values()) this._finish(run, error);
    this.approvals.clear();
    if (child) {
      const termination = this._terminate(child).catch(() => {});
      this.terminations.add(termination);
      termination.finally(() => this.terminations.delete(termination));
    }
  }

  _disposeTransport(transport) {
    const existing = this.transportClosures.get(transport);
    if (existing) return existing;
    const cleanup = Promise.resolve().then(async () => {
      try { await transport.cancelAll(); }
      finally { await transport.close(); }
    }).catch(() => {});
    this.transportClosures.set(transport, cleanup);
    this.terminations.add(cleanup);
    cleanup.finally(() => this.terminations.delete(cleanup));
    return cleanup;
  }

  async _terminate(child) {
    const closed = this.childClosures.get(child);
    if (!child.pid) { await closed; return; }
    if (process.platform === 'win32') {
      // /T only targets this owned process tree. The argument is an integer PID, never shell text.
      await new Promise((resolve) => {
        const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
        const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
        killer.once('error', () => { child.kill(); resolve(); });
        killer.once('close', (code) => { if (code !== 0) child.kill(); resolve(); });
      });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill(); } catch {} }
      // Kill the whole owned group even if its leader exited before a tool descendant.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    // The owned process must actually close before its workspace can be released.
    await closed;
  }

  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    const child = this.child;
    this._fail(new Error('Codex 后台已关闭'), child);
    this.closing = (async () => {
      if (this.initializing) await this.initializing.catch(() => {});
      await Promise.all(this.terminations);
      await Promise.allSettled([...this.dynamicTasks]);
    })();
    return this.closing;
  }
}
