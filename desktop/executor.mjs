import path from 'node:path';
import { hostname } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { CodexBridge, resolveCodexCommand } from '../server/codex.mjs';
import { createDesktopTools } from '../server/desktop-tools.mjs';
import { withAutomationTools } from '../server/automation-tools.mjs';
import { normalizeAgentPermissions } from '../server/agent-permissions.mjs';
import { inspectImage, IMAGE_LIMIT } from '../server/attachments.mjs';
import { normalizeReasoningEffort } from '../server/providers.mjs';
import { validateBrowserAction } from '../server/opencli.mjs';
import { normalizeSiteOrigins } from '../server/opencli-browser-policies.mjs';
import { normalizeProjectDirectory } from '../server/project-directory.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const stopped = () => Object.assign(new Error('执行电脑连接已结束。'), { name: 'AbortError' });
const invalid = () => Object.assign(new Error('执行电脑协议数据无效。'), { code: 'executor_protocol_invalid' });
const retryable = (error, registered) => error?.retryable === true || [408, 425, 429].includes(error?.status) || error?.status >= 500 && error?.status <= 599 || registered && [404, 409].includes(error?.status);
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
const imageExtensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const DELTA_CHARS = 8000; // Even all-control-character JSON stays under the central 64 KiB character bound.
const delay = (ms, signal) => new Promise(resolve => {
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms); timer.unref?.(); signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done();
});

export function validateExecutorConnection(value) {
  if (!object(value) || Object.keys(value).some(key => !['url', 'token', 'instanceId', 'userId'].includes(key)) ||
      typeof value.url !== 'string' || value.url.length > 2048 || /[\x00-\x20\x7f\\?#]/.test(value.url) ||
      typeof value.token !== 'string' || !value.token || value.token.length > 4096 || /[\x00-\x20\x7f]/.test(value.token) ||
      !identifier(value.instanceId) || !identifier(value.userId)) throw new Error('执行电脑连接参数无效。');
  let url;
  try { url = new URL(value.url); } catch { throw new Error('执行电脑需要完整的服务地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('执行电脑连接需要 HTTPS；本机回环地址除外。');
  return { url: url.href.replace(/\/+$/, ''), token: value.token, instanceId: value.instanceId, userId: value.userId };
}

async function durableJson(file, value) {
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}

export async function loadExecutorDeviceId(dataDir) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'device.json');
  try { await durableJson(file, { version: 1, deviceId: randomUUID() }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (value?.version !== 1 || !uuid(value.deviceId)) throw new Error('执行电脑标识文件无效，请保留文件并检查。');
  return value.deviceId;
}

async function readBytes(response, limit, signal) {
  if (!response.body) return Buffer.alloc(0);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) { await response.body.cancel(); throw invalid(); }
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw stopped();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength; if (bytes > limit) throw invalid(); chunks.push(Buffer.from(value));
    }
    if (signal?.aborted) throw stopped();
    return Buffer.concat(chunks, bytes);
  } finally { signal?.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createExecutorHandlers(executor, isAllowed) {
  return Object.fromEntries(['connect', 'disconnect', 'status'].map(action => [`petpal:executor:${action}`, (event, input) => {
    if (!isAllowed(event)) throw new Error('执行电脑连接仅允许可信主窗口管理。');
    return action === 'connect' ? executor.connect(input) : executor[action]();
  }]));
}

export function createMusicMcpHandlers(executor, isAllowed) {
  return Object.fromEntries(['config', 'status', 'configure', 'prepare', 'connect', 'disconnect', 'cancel'].map(action =>
    [`petpal:music-mcp:${action}`, (event, body) => {
      if (!isAllowed(event)) throw new Error('音乐 MCP 仅允许可信主窗口管理。');
      return executor.manageMusicMcp(action, body);
    }]));
}
export function createComputerUseMcpHandlers(executor,isAllowed) {
  return Object.fromEntries(['config','status','configure','connect','disconnect','cancel'].map(action=>
    [`petpal:computer-use:${action}`,(event,body)=>{if(!isAllowed(event))throw new Error('Computer Use 仅允许可信主窗口管理。');return executor.manageComputerUseMcp(action,body);}]));
}
export function createOpenCliHandlers(executor, isAllowed) {
  return Object.fromEntries(['config', 'status', 'configure', 'action', 'sites', 'cancel'].map(action =>
    [`petpal:opencli:${action}`, (event, body) => {
      if (!isAllowed(event)) throw new Error('OpenCLI 仅允许可信主窗口管理。');
      return executor.manageOpenCli(action, body);
    }]));
}

/** One outbound executor belongs to a verified central login, never a renderer request. */
export class DesktopExecutor {
  constructor({ dataDir, musicMcpDataDir = path.join(dataDir || '.', 'music'), fetchImpl = globalThis.fetch, bridgeFactory = options => new CodexBridge(options),
    toolsFactory = options => createDesktopTools(options), resolveCommand = resolveCodexCommand,
    name = hostname(), platform = process.platform, arch = process.arch, retryWait = delay } = {}) {
    if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('执行电脑数据目录必须是绝对路径。');
    if (typeof musicMcpDataDir !== 'string' || !path.isAbsolute(musicMcpDataDir)) throw new Error('音乐 MCP 数据目录必须是绝对路径。');
    this.dataDir = dataDir; this.fetch = fetchImpl; this.bridgeFactory = bridgeFactory;
    this.musicMcpDataDir = musicMcpDataDir;
    this.toolsFactory = toolsFactory; this.resolveCommand = resolveCommand;
    this.metadata = { name: String(name).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 120) || 'PetPal PC', platform, arch };
    this.current = null; this.generation = 0; this.transition = Promise.resolve(); this.closed = false;
    this.desired = null; this.recovery = null; this.blocked = null; this.retryWait = retryWait;
    this.visible = { state: 'disconnected', ...this.metadata };
  }

  status() { return { ...this.visible }; }
  _tools(ctx) {
    this._assert(ctx);
    return ctx.tools ??= this.toolsFactory({ dataDir: path.join(ctx.directory, 'tools'),
      musicMcpDataDir: this.musicMcpDataDir, opencliDataDir: this.musicMcpDataDir,
      musicMcpScope: `${ctx.connection.instanceId}:${ctx.connection.userId}` });
  }

  async _musicIdentity(ctx) {
    this._assert(ctx);
    const identity = await this._json(ctx, '/api/auth/me'); this._assert(ctx);
    if (identity.instanceId !== ctx.connection.instanceId || identity.user?.id !== ctx.connection.userId ||
        !identity.user?.canUseCodex || (!identity.user?.isOwner && identity.user?.agentAccess !== 'full')) {
      throw new Error('音乐 MCP 设置需要当前账号的完整 Agent 权限。');
    }
    ctx.account = identity.user;
  }

  async manageMusicMcp(action, body) {
    if (!['config', 'status', 'configure', 'prepare', 'connect', 'disconnect', 'cancel'].includes(action)) throw invalid();
    if (['config', 'status', 'cancel'].includes(action) && body !== undefined) throw invalid();
    if (['prepare', 'connect', 'disconnect'].includes(action) && (!object(body) || Object.keys(body).length !== 1 || !['netease', 'qqmusic'].includes(body.player))) throw invalid();
    const ctx = this.current;
    if (!ctx || this.visible.state !== 'online') throw new Error('请先登录并连接这台执行电脑。');
    // Reserve before awaiting identity, so concurrent IPC requests cannot race.
    if (action === 'cancel') {
      await this._musicIdentity(ctx);
      const pending = ctx.musicOperation; pending?.controller.abort(); await pending?.done;
      await this._musicIdentity(ctx);
      const result = await this._tools(ctx).musicMcp.status();
      await this._musicIdentity(ctx); return result;
    }
    if (ctx.musicOperation) throw new Error('音乐 MCP 正在处理请求，请等待或停止。');
    if (ctx.run && !['config', 'status'].includes(action)) throw new Error('请等当前 Agent 任务结束后再修改音乐 MCP。');
    const controller = new AbortController(), abort = () => controller.abort();
    let finish; const operation = { controller, done: new Promise(resolve => { finish = resolve; }) };
    ctx.musicOperation = operation; ctx.controller.signal.addEventListener('abort', abort, { once: true });
    try {
      await this._musicIdentity(ctx); controller.signal.throwIfAborted();
      const manager = this._tools(ctx).musicMcp;
      let result;
      if (action === 'configure') result = await manager.configure(body);
      else if (['config', 'status'].includes(action)) result = await manager[action]();
      else {
        if (action === 'prepare') await manager.prepare(body, { signal: controller.signal });
        else await manager[action](body.player, { signal: controller.signal });
        result = await manager.status();
      }
      controller.signal.throwIfAborted(); await this._musicIdentity(ctx); return result;
    } finally {
      ctx.controller.signal.removeEventListener('abort', abort);
      if (ctx.musicOperation === operation) ctx.musicOperation = null; finish();
    }
  }
  async manageComputerUseMcp(action,body) {
    if(!['config','status','configure','connect','disconnect','cancel'].includes(action))throw invalid();
    if(action!=='configure'&&body!==undefined)throw invalid();
    const ctx=this.current;
    if(!ctx||this.visible.state!=='online')throw new Error('请先登录并连接这台执行电脑。');
    if(action==='cancel'){
      await this._musicIdentity(ctx);
      const pending=ctx.computerUseOperation;pending?.controller.abort();await pending?.done;
      await this._musicIdentity(ctx);const result=await this._tools(ctx).computerUseMcp.status();await this._musicIdentity(ctx);return result;
    }
    if(ctx.computerUseOperation)throw new Error('Computer Use 正在处理请求，请等待或停止。');
    if(ctx.run&&!['config','status'].includes(action))throw new Error('请等当前 Agent 任务结束后再修改 Computer Use。');
    const controller=new AbortController(),abort=()=>controller.abort();let finish;
    const operation={controller,done:new Promise(resolve=>{finish=resolve;})};ctx.computerUseOperation=operation;
    ctx.controller.signal.addEventListener('abort',abort,{once:true});
    try{
      await this._musicIdentity(ctx);controller.signal.throwIfAborted();const manager=this._tools(ctx).computerUseMcp;
      let result;
      if(action==='configure')result=await manager.configure(body);
      else if(['config','status'].includes(action))result=await manager[action]();
      else{await manager[action]({signal:controller.signal});controller.signal.throwIfAborted();await this._musicIdentity(ctx);result=await manager.status();}
      controller.signal.throwIfAborted();await this._musicIdentity(ctx);return result;
    }finally{ctx.controller.signal.removeEventListener('abort',abort);if(ctx.computerUseOperation===operation)ctx.computerUseOperation=null;finish();}
  }
  async manageOpenCli(action, body) {
    if (!['config', 'status', 'configure', 'action', 'sites', 'cancel'].includes(action)) throw invalid();
    if (['config', 'status', 'cancel'].includes(action) && body !== undefined) throw invalid();
    if (action === 'configure') {
      if (!object(body) || Object.keys(body).some(key => !['revision', 'enabled', 'siteOrigins'].includes(key)) || !uuid(body.revision) || typeof body.enabled !== 'boolean') throw invalid();
      try { normalizeSiteOrigins(body.siteOrigins); } catch { throw invalid(); }
    }
    if (action === 'sites') {
      if (body === undefined) body = {};
      if (!object(body) || Object.keys(body).some(key => !['site', 'command'].includes(key)) ||
          Object.values(body).some(value => typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,95}$/.test(value))) throw invalid();
    }
    if (action === 'action') body = validateBrowserAction(body);
    const ctx = this.current;
    if (!ctx || this.visible.state !== 'online') throw new Error('请先登录并连接这台执行电脑。');
    const identity = async () => {
      try { await this._musicIdentity(ctx); }
      catch (error) {
        if (error.message === '音乐 MCP 设置需要当前账号的完整 Agent 权限。') throw new Error('OpenCLI 设置需要当前账号的完整 Agent 权限。');
        throw error;
      }
    };
    if (action === 'cancel') {
      if (ctx.openCliCancellation) throw new Error('OpenCLI 正在停止请求，请等待。');
      const pending = ctx.openCliOperation, controller = new AbortController(), abort = () => controller.abort();
      let finish;
      const cancellation = { controller, done: new Promise(resolve => { finish = resolve; }) };
      ctx.openCliCancellation = cancellation; ctx.controller.signal.addEventListener('abort', abort, { once: true });
      try {
        await identity(); controller.signal.throwIfAborted();
        pending?.controller.abort(); await pending?.done;
        controller.signal.throwIfAborted(); await identity();
        const result = await this._tools(ctx).opencliManager.status();
        controller.signal.throwIfAborted(); await identity(); return result;
      } finally {
        ctx.controller.signal.removeEventListener('abort', abort);
        if (ctx.openCliCancellation === cancellation) ctx.openCliCancellation = null; finish();
      }
    }
    if (ctx.openCliOperation || ctx.openCliCancellation) throw new Error('OpenCLI 正在处理请求，请等待或停止。');
    const modifies = ['configure', 'action'].includes(action);
    if (ctx.run && modifies) throw new Error('请等当前 Agent 任务结束后再修改 OpenCLI 或操作浏览器。');
    const controller = new AbortController(), abort = () => controller.abort(); let finish;
    const operation = { controller, done: new Promise(resolve => { finish = resolve; }) };
    ctx.openCliOperation = operation; ctx.controller.signal.addEventListener('abort', abort, { once: true });
    try {
      await identity(); controller.signal.throwIfAborted();
      if (ctx.run && modifies) throw new Error('请等当前 Agent 任务结束后再修改 OpenCLI 或操作浏览器。');
      const manager = this._tools(ctx).opencliManager;
      let result;
      if (action === 'configure') result = await manager.configure(body);
      else if (action === 'action') result = await manager.executeBrowser(body, { signal: controller.signal });
      else if (action === 'sites') result = await manager.sites(body);
      else result = await manager[action]();
      controller.signal.throwIfAborted(); await identity(); return result;
    } finally {
      ctx.controller.signal.removeEventListener('abort', abort);
      if (ctx.openCliOperation === operation) ctx.openCliOperation = null; finish();
    }
  }
  _queue(work) { const result = this.transition.catch(() => {}).then(work); this.transition = result.catch(() => {}); return result; }
  _assert(ctx) { if (this.closed || this.current !== ctx || ctx.generation !== this.generation || ctx.controller.signal.aborted) throw stopped(); }
  _invalidate() {
    const old = this.current || this.recovery?.ctx;
    this.recovery?.controller.abort(); this.recovery = null;
    if (old) { old.controller.abort(); old.run?.controller.abort(); void old.run?.bridge?.close().catch(() => {}); }
    return old;
  }

  connect(input) {
    let connection;
    try { connection = validateExecutorConnection(input); } catch (error) { return Promise.reject(error); }
    if (this.closed) return Promise.reject(stopped());
    const same = other => other && Object.keys(connection).every(key => connection[key] === other[key]);
    if (same(this.desired?.connection)) return this.current?.ready ?? Promise.resolve(this.status());
    // A rejected credential/permission or invalid installation needs an explicit
    // new login. Repeated renderer identity refreshes must not retry it forever.
    if (same(this.blocked)) return Promise.resolve(this.status());
    const generation = ++this.generation, old = this._invalidate();
    if (this.desired) this.desired.connection.token = '';
    if (this.blocked) this.blocked.token = '';
    this.blocked = null;
    const desired = { generation, connection, failures: 0 }; this.desired = desired;
    return this._begin(desired, old);
  }

  _begin(desired, old) {
    const { generation } = desired, connection = { ...desired.connection };
    this.visible = { state: 'connecting', ...this.metadata };
    const ctx = { generation, connection, desired, controller: new AbortController(), run: null, loops: [], eventTail: Promise.resolve(), retired: false };
    this.current = ctx;
    ctx.ready = this._queue(async () => {
      await this._retire(old); this._assert(ctx);
      try {
        const identity = await this._json(ctx, '/api/auth/me'); this._assert(ctx);
        if (identity.instanceId !== connection.instanceId || identity.user?.id !== connection.userId || !identity.user?.canUseCodex) throw new Error('当前账号身份或 Agent 授权无效，请重新登录。');
        ctx.account = identity.user;
        ctx.deviceId = await loadExecutorDeviceId(this.dataDir); this._assert(ctx);
        ctx.directory = path.join(this.dataDir, 'accounts', hash(`${connection.url}\n${connection.instanceId}\n${connection.userId}`));
        await mkdir(path.join(ctx.directory, 'receipts'), { recursive: true, mode: 0o700 }); this._assert(ctx);
        await this.resolveCommand(); this._assert(ctx);
        await this._register(ctx); this._assert(ctx);
        ctx.onlineAt = Date.now();
        this.visible = { state: 'online', hostId: ctx.hostId, ...this.metadata };
        this._start(ctx);
        return this.status();
      } catch (error) {
        this._failed(ctx, error);
        await this._retire(ctx);
        throw ctx.controller.signal.aborted && generation !== this.generation ? stopped() : new Error('执行电脑连接失败，请检查网络、Agent 权限与桌面安装。');
      }
    });
    return ctx.ready;
  }

  disconnect() {
    ++this.generation; const old = this._invalidate(); this.current = null;
    if (this.desired) this.desired.connection.token = '';
    if (this.blocked) this.blocked.token = '';
    this.desired = this.blocked = null;
    this.visible = { state: 'disconnected', ...this.metadata };
    return this._queue(() => this._retire(old));
  }
  close() { this.closed = true; return this.disconnect(); }

  async _json(ctx, route, body, { timeout = 15000, token = ctx.connection.token, signal = ctx.controller.signal, limit = 1024 * 1024, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, timeout); timer.unref?.();
    try {
      let response, bytes;
      try {
        response = await this.fetch(`${ctx.connection.url}${route}`, { method,
          headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
        bytes = await readBytes(response, limit, controller.signal);
      } catch (error) {
        if (signal?.aborted) throw stopped();
        if (error.code === 'executor_protocol_invalid') throw error;
        throw Object.assign(new Error('执行电脑网络暂时不可用。'), { retryable: true });
      }
      if (!response.ok) throw Object.assign(new Error('执行电脑服务请求失败。'), { status: response.status });
      let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { throw invalid(); }
      if (!object(value)) throw invalid(); return value;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  async _register(ctx) {
    const body = { deviceId: ctx.deviceId, ...this.metadata };
    let registration;
    try { registration = await this._json(ctx, '/api/agent/executors/register', { ...body, capabilities: { projectDirectory: true, automations: true, approvalReview: true } }); }
    catch (error) {
      // Older servers reject unknown registration fields before creating a
      // connection. Only that negotiation boundary may fall back; never runs.
      this._assert(ctx);
      if (error.status !== 400 || ctx.connectionId) throw error;
      try { registration = await this._json(ctx, '/api/agent/executors/register', { ...body, capabilities: { projectDirectory: true, automations: true } }); }
      catch (legacyError) {
        this._assert(ctx);
        if (legacyError.status !== 400 || ctx.connectionId) throw legacyError;
        try { registration = await this._json(ctx, '/api/agent/executors/register', { ...body, capabilities: { projectDirectory: true } }); }
        catch (oldestError) {
          this._assert(ctx);
          if (oldestError.status !== 400 || ctx.connectionId) throw oldestError;
          registration = await this._json(ctx, '/api/agent/executors/register', body);
        }
      }
    }
    if (!identifier(registration.hostId) || !identifier(registration.connectionId) ||
        !Number.isSafeInteger(registration.leaseMs) || registration.leaseMs < 3000 || registration.leaseMs > 120000 ||
        !Number.isSafeInteger(registration.pollMs) || registration.pollMs < 1000 || registration.pollMs > 60000) throw invalid();
    ctx.hostId = registration.hostId; ctx.connectionId = registration.connectionId;
    ctx.automationTools = registration.capabilities?.automations === true;
    ctx.approvalReview = registration.capabilities?.approvalReview === true;
    ctx.leaseMs = registration.leaseMs; ctx.pollMs = registration.pollMs;
    ctx.route = `/api/agent/executors/${ctx.connectionId}`;
  }
  _unregister(ctx) { return this._json(ctx, ctx.route, undefined, { method: 'DELETE', signal: null, timeout: 3000 }); }

  _start(ctx) {
    const poll = (async () => {
      while (!ctx.controller.signal.aborted) {
        const response = await this._json(ctx, `${ctx.route}/poll`, undefined, { timeout: ctx.pollMs + 10000 }); this._assert(ctx);
        if (!Array.isArray(response.commands) || response.commands.length > 1) throw invalid();
        for (const command of response.commands) { this._assert(ctx); await this._command(ctx, command); }
        if (!response.commands.length) await delay(100, ctx.controller.signal);
      }
    })();
    const heartbeat = (async () => {
      while (!ctx.controller.signal.aborted) {
        await delay(Math.floor(ctx.leaseMs / 3), ctx.controller.signal); if (ctx.controller.signal.aborted) return;
        const response = await this._json(ctx, `${ctx.route}/heartbeat`, {}, { timeout: Math.floor(ctx.leaseMs / 3) }); this._assert(ctx);
        if (response.ok !== true) throw invalid();
      }
    })();
    ctx.loops = [poll, heartbeat];
    for (const loop of ctx.loops) void loop.catch(error => this._failed(ctx, error));
  }

  async _receipt(ctx, command) {
    const fingerprint = hash(JSON.stringify(command)), file = path.join(ctx.directory, 'receipts', `${hash(`${ctx.connectionId}:${command.id}`)}.json`);
    try { await durableJson(file, { version: 1, connectionId: ctx.connectionId, commandId: command.id, runId: command.runId, type: command.type, fingerprint }); return true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = JSON.parse(await readFile(file, 'utf8'));
      if (previous.fingerprint !== fingerprint || previous.connectionId !== ctx.connectionId || previous.runId !== command.runId) throw invalid();
      return false;
    }
  }

  _validateCommand(command) {
    if (!object(command) || !identifier(command.id) || !identifier(command.runId)) throw invalid();
    const allowed = {
      run: ['id', 'type', 'runId', 'conversationId', 'prompt', 'threadId', 'projectDirectory', 'projectAccess', 'automationTools', 'permissions', 'model', 'effort', 'codexRevision', 'relayToken', 'attachments'],
      steer: ['id', 'type', 'runId', 'expectedTurnId', 'content', 'attachments'],
      approve: ['id', 'type', 'runId', 'approvalId', 'decision'], stop: ['id', 'type', 'runId'],
    }[command.type];
    if (!allowed || Object.keys(command).some(key => !allowed.includes(key))) throw invalid();
    if (command.type === 'run') {
      if (!identifier(command.conversationId) || typeof command.prompt !== 'string' || command.prompt.length > 32000 ||
          command.threadId !== undefined && !identifier(command.threadId) || !uuid(command.codexRevision) ||
          typeof command.model !== 'string' || !command.model.trim() || command.model.length > 160 || /[\x00-\x1f\x7f]/.test(command.model) ||
          typeof command.relayToken !== 'string' || !command.relayToken || command.relayToken.length > 4096 || /[\x00-\x20\x7f]/.test(command.relayToken)) throw invalid();
      normalizeAgentPermissions(command.permissions); normalizeReasoningEffort(command.effort);
      if (command.automationTools !== undefined && command.automationTools !== true) throw invalid();
      if (Object.hasOwn(command, 'projectDirectory') !== Object.hasOwn(command, 'projectAccess')) throw invalid();
      if (Object.hasOwn(command, 'projectDirectory')) {
        if (typeof command.projectDirectory !== 'string' || !command.projectDirectory.trim() || !['full', 'workspace'].includes(command.projectAccess)) throw invalid();
        normalizeProjectDirectory(command.projectDirectory, this.metadata.platform);
      }
    }
    if (command.type === 'steer' && (!identifier(command.expectedTurnId) || typeof command.content !== 'string' || command.content.length > 32000)) throw invalid();
    if (command.type === 'approve' && (!identifier(command.approvalId) || !['accept', 'decline'].includes(command.decision))) throw invalid();
    if (['run', 'steer'].includes(command.type)) {
      if (!Array.isArray(command.attachments) || command.attachments.length > 4) throw invalid();
      for (const item of command.attachments) {
        if (!object(item) || Object.keys(item).some(key => !['id', 'mimeType', 'size', 'sha256'].includes(key)) || !identifier(item.id) ||
            !imageExtensions[item.mimeType] || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > IMAGE_LIMIT || !/^[a-f0-9]{64}$/.test(item.sha256)) throw invalid();
      }
    }
  }

  async _command(ctx, command) {
    this._validateCommand(command);
    if (!await this._receipt(ctx, command)) return;
    this._assert(ctx);
    if (command.type === 'run') {
      // An incoming task waits for this computer's settings operation to finish;
      // neither UI configuration nor browser probes may race with Agent tools.
      while (ctx.openCliOperation || ctx.openCliCancellation) {
        await Promise.all([ctx.openCliOperation?.done, ctx.openCliCancellation?.done]); this._assert(ctx);
      }
      if (ctx.run) throw invalid();
      if (command.automationTools && !ctx.automationTools) throw invalid();
      const permissions = normalizeAgentPermissions(command.permissions);
      if (permissions.access === 'full-access' && ctx.account.agentAccess !== 'full' && !ctx.account.isOwner) throw invalid();
      const run = { id: command.runId, commandId: command.id, sequence: 0, pendingBytes: 0, outputBytes: 0, files: new Map(),
        controller: new AbortController(), bridge: null, conversationId: command.conversationId, relayToken: command.relayToken, events: Promise.resolve(), stopping: false };
      ctx.run = run;
      run.done = this._run(ctx, run, command).catch(error => this._failed(ctx, error));
      return;
    }
    const run = ctx.run;
    if (!run || run.id !== command.runId) throw invalid();
    if (command.type === 'stop') {
      run.stopping = true; run.controller.abort(); await run.bridge?.close(); await run.done; return;
    }
    let result;
    try {
      if (!run.bridge || run.stopping || run.controller.signal.aborted) throw Object.assign(new Error('任务已停止。'), { code: 'turn_not_active' });
      if (command.type === 'approve') result = await run.bridge.approve(command.approvalId, command.decision);
      else {
        const images = await this._images(ctx, run, command.attachments); this._assert(ctx); run.controller.signal.throwIfAborted();
        result = await run.bridge.steer({ conversationId: run.conversationId, expectedTurnId: command.expectedTurnId, content: command.content, images });
      }
      await this._event(ctx, run, 'command-result', { commandId: command.id, ok: true, ...(result?.turnId ? { turnId: result.turnId } : {}) });
    } catch (error) {
      await this._event(ctx, run, 'command-result', { commandId: command.id, ok: false,
        ...(error.code === 'turn_not_active' ? { code: 'turn_not_active' } : {}), message: error.code === 'turn_not_active' ? '当前运行已结束。' : '无法确认操作已送达，请检查任务；不会自动重试。' });
    }
  }

  _event(ctx, run, event, data) {
    this._assert(ctx);
    const payload = { runId: run.id, sequence: run.sequence + 1, event, data }, encoded = JSON.stringify(payload), bytes = Buffer.byteLength(encoded);
    if (encoded.length > 65536 || bytes > 120000 || run.pendingBytes + bytes > 4 * 1024 * 1024) throw invalid();
    run.sequence = payload.sequence;
    run.pendingBytes += bytes;
    const send = run.events.then(async () => {
      this._assert(ctx); const response = await this._json(ctx, `${ctx.route}/events`, payload);
      if (response.ok !== true) throw invalid();
    }).finally(() => { run.pendingBytes -= bytes; });
    run.events = send; void send.catch(error => this._failed(ctx, error)); return send;
  }

  async _images(ctx, run, attachments) {
    const images = [];
    for (const item of attachments) {
      this._assert(ctx); run.controller.signal.throwIfAborted();
      const existing = run.files.get(item.id);
      if (existing) { if (existing.sha256 !== item.sha256) throw invalid(); images.push({ path: existing.path }); continue; }
      const route = `${ctx.route}/runs/${run.id}/attachments/${item.id}`;
      const controller = new AbortController(), abort = () => controller.abort();
      ctx.controller.signal.addEventListener('abort', abort, { once: true }); run.controller.signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 15000); timer.unref?.();
      try {
        const response = await this.fetch(`${ctx.connection.url}${route}`, { headers: { Authorization: `Bearer ${run.relayToken}` }, signal: controller.signal,
          redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== item.mimeType) { await response.body?.cancel(); throw invalid(); }
        const bytes = await readBytes(response, item.size, controller.signal);
        if (bytes.length !== item.size || hash(bytes) !== item.sha256) throw invalid(); inspectImage(bytes, item.mimeType);
        this._assert(ctx); run.controller.signal.throwIfAborted();
        const folder = path.join(ctx.directory, 'attachments', hash(run.id)); await mkdir(folder, { recursive: true, mode: 0o700 });
        const file = path.join(folder, `${hash(item.id)}.${imageExtensions[item.mimeType]}`), handle = await open(file, 'wx', 0o600);
        try { await handle.writeFile(bytes); } finally { await handle.close(); }
        run.files.set(item.id, { path: file, sha256: item.sha256 }); images.push({ path: file });
      } finally { clearTimeout(timer); ctx.controller.signal.removeEventListener('abort', abort); run.controller.signal.removeEventListener('abort', abort); }
    }
    return images;
  }

  async _run(ctx, run, command) {
    let result, failure;
    try {
      await this._event(ctx, run, 'started', {});
      const images = await this._images(ctx, run, command.attachments); this._assert(ctx); run.controller.signal.throwIfAborted();
      this._tools(ctx);
      const config = { mode: 'api', revision: command.codexRevision, baseUrl: `${ctx.connection.url}${ctx.route}/runs/${run.id}/model`,
        apiKey: run.relayToken, model: command.model, reasoningEffort: command.effort || '' };
      const desktopTools = command.automationTools ? withAutomationTools(ctx.tools, {
        resolveContext: () => {
          this._assert(ctx);
          if (ctx.run !== run || run.stopping || run.controller.signal.aborted || !run.relayToken) throw stopped();
          return { hostId: ctx.hostId, hostName: this.metadata.name, model: command.model, permissions: command.permissions, projectDirectory: command.projectDirectory };
        },
        execute: async (name, args, call) => {
          if (typeof call.callId !== 'string' || !call.callId || call.callId.length > 256 || /[\x00-\x1f\x7f]/.test(call.callId)) throw invalid();
          // A tool mutation is sent once. _json has no retry loop; marking the
          // error nonretryable also prevents callers treating it as a reconnect.
          try { return await this._json(ctx, `${ctx.route}/runs/${run.id}/automations/tools`, { name, arguments: args, callId: call.callId }, { token: run.relayToken, signal: AbortSignal.any([ctx.controller.signal, run.controller.signal, call.signal]), limit: 256 * 1024 }); }
          catch (error) { error.retryable = false; throw error; }
        },
      }) : ctx.tools;
      run.bridge = this.bridgeFactory({ dataDir: ctx.directory, workspaceRoot: path.join(ctx.directory, 'workspace'), config, desktopTools });
      this._assert(ctx); run.controller.signal.throwIfAborted();
      result = await run.bridge.run({ conversationId: command.conversationId, prompt: command.prompt, threadId: command.threadId,
        ...(command.projectDirectory ? { projectDirectory: command.projectDirectory, projectAccess: command.projectAccess } : {}),
        model: command.model, effort: command.effort || '', permissions: command.permissions, images, signal: run.controller.signal,
        onEvent: (event, data) => {
          if (ctx.controller.signal.aborted || run.controller.signal.aborted) return;
          if (!['thread', 'turn', 'status', 'delta', 'approval', 'approval-resolved'].includes(event)) throw invalid();
          if (event === 'approval' && typeof data?.description === 'string' && data.description.length > 8000) {
            // Never offer an approval card with its review details silently truncated.
            void Promise.resolve(run.bridge.approve(data.id, 'decline')).catch(() => { run.controller.abort(); });
            void this._event(ctx, run, 'status', { state: 'blocked', message: '操作详情超过远程审批长度，已拒绝本次操作；请拆分任务后重试。' }); return;
          }
          if (event === 'delta') {
            if (typeof data?.text !== 'string') throw invalid();
            run.outputBytes += Buffer.byteLength(data.text); if (run.outputBytes > 2 * 1024 * 1024) throw invalid();
            for (let offset = 0; offset < data.text.length; offset += DELTA_CHARS) void this._event(ctx, run, event, { text: data.text.slice(offset, offset + DELTA_CHARS) });
          } else {
            if (event === 'status' && data.approvalReview && !ctx.approvalReview) { const { approvalReview, ...legacy } = data; data = legacy; }
            void this._event(ctx, run, event, data);
          }
        } });
    } catch (error) { failure = error; }
    finally {
      await run.bridge?.close();
      await Promise.allSettled([...run.files.values()].map(file => unlink(file.path)));
    }
    if (ctx.controller.signal.aborted) { run.relayToken = ''; return; }
    if (run.stopping || run.controller.signal.aborted) await this._event(ctx, run, 'stopped', {});
    else if (failure) await this._event(ctx, run, 'error', { message: /^project_directory_(?:invalid|unavailable|forbidden)$/.test(failure.code || '')
      ? '项目目录不可用或超出账号工作区权限，请在执行电脑确认现有目录与访问授权；本次任务未自动改用其他目录。'
      : '执行电脑未能完成任务，请检查该电脑的 Codex 与网络状态。' });
    else {
      if (!identifier(result?.threadId)) throw invalid();
      if (!run.outputBytes && result.text) {
        if (typeof result.text !== 'string' || Buffer.byteLength(result.text) > 2 * 1024 * 1024) throw invalid();
        for (let offset = 0; offset < result.text.length; offset += DELTA_CHARS) await this._event(ctx, run, 'delta', { text: result.text.slice(offset, offset + DELTA_CHARS) });
      }
      // Deltas already carry the answer; avoid a second multi-megabyte completion frame.
      await this._event(ctx, run, 'complete', { threadId: result.threadId, text: '' });
    }
    run.relayToken = ''; if (ctx.run === run) ctx.run = null;
  }

  async _retire(ctx) {
    if (!ctx) return;
    if (ctx.retiring) return ctx.retiring;
    ctx.retired = true; ctx.controller.abort(); ctx.run?.controller.abort();
    ctx.retiring = (async () => {
      await Promise.allSettled([ctx.run?.bridge?.close(), ctx.tools?.close()]);
      await Promise.allSettled([ctx.run?.done, ctx.musicOperation?.done, ctx.computerUseOperation?.done, ctx.openCliOperation?.done, ctx.openCliCancellation?.done, ...ctx.loops]);
      if (ctx.connectionId) await this._unregister(ctx).catch(() => {});
      ctx.connection.token = ''; ctx.run = null;
    })();
    return ctx.retiring;
  }

  _failed(ctx, error) {
    if (this.current !== ctx || ctx.controller.signal.aborted) return;
    this.current = null;
    const desired = this.desired;
    if (!desired || !retryable(error, Boolean(ctx.connectionId))) {
      this.blocked = desired ? { ...desired.connection } : null;
      if (desired) desired.connection.token = '';
      this.desired = null;
      this.visible = { state: 'error', retryable: false, ...this.metadata, error: '执行电脑已离线，请检查账号权限与桌面安装后重新登录；原任务不会重试。' };
      const retirement = { ctx, controller: new AbortController() }; this.recovery = retirement;
      void this._retire(ctx).catch(() => {}).finally(() => { if (this.recovery === retirement) this.recovery = null; }); return;
    }
    if (ctx.onlineAt && Date.now() - ctx.onlineAt >= 30000) desired.failures = 0;
    const pause = RETRY_DELAYS[Math.min(desired.failures++, RETRY_DELAYS.length - 1)];
    const recovery = { ctx, desired, controller: new AbortController() }; this.recovery = recovery;
    this.visible = { state: 'reconnecting', retryable: true, ...this.metadata,
      error: '网络中断，正在重新连接执行电脑；原任务保持暂停，不会自动重试。' };
    // Keep retry scheduling outside run/loop promises: retirement waits for them.
    // A new connection only starts after the previous owned process has closed.
    void (async () => {
      await this._retire(ctx);
      if (recovery.controller.signal.aborted || this.recovery !== recovery) return;
      this.visible = { ...this.visible, retryAt: Date.now() + pause };
      await this.retryWait(pause, recovery.controller.signal);
      if (recovery.controller.signal.aborted || this.closed || this.recovery !== recovery || this.desired !== desired || desired.generation !== this.generation) return;
      this.recovery = null;
      await this._begin(desired, null).catch(() => {});
    })().catch(() => {});
  }
}
