import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { officialRequestBody, flatBindings, streamFilter } from '../desktop/official-account.mjs';
import { createExecutorRelayRedactor } from './executor-relay.mjs';
import { MODEL_REQUEST_BYTES } from './model-request-limits.mjs';

const failure = (status, message) => Object.assign(new Error(message), { status });
const unavailable = () => failure(409, '手机官方模型已离线或授权已改变，请重新连接手机。');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const text = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
const safeError = '手机官方模型请求未完成，请检查手机网络或重新登录官方账号。';
const OUTPUT_BYTES = 24 * 1024 * 1024, CHUNK_BYTES = 48 * 1024;
const terminalFrame = frame => {
  const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  try { return ['response.completed', 'response.failed', 'response.incomplete', 'error'].includes(JSON.parse(data).type); } catch { return false; }
};
function modelId(userId, deviceId, revision, model) {
  const bytes = createHash('sha256').update(JSON.stringify(['mobile-official', userId, deviceId, revision, model])).digest().subarray(0, 16);
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = bytes.toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function catalog(body, userId) {
  if (!fields(body, ['deviceId', 'revision', 'models']) || !uuid(body.deviceId) || !uuid(body.revision) || !Array.isArray(body.models) || !body.models.length || body.models.length > 256) throw failure(400, '手机官方模型登记字段无效。');
  const seen = new Set();
  return body.models.map(item => {
    if (!fields(item, ['model', 'displayName', 'supportsImages']) || !text(item.model, 160) || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(item.model) || !text(item.displayName, 320) || typeof item.supportsImages !== 'boolean' || seen.has(item.model)) throw failure(400, '手机官方模型目录无效。');
    seen.add(item.model); return { id: modelId(userId, body.deviceId, body.revision, item.model), model: item.model, displayName: item.displayName, supportsImages: item.supportsImages };
  });
}
async function bodyJson(request, maximum, signal) {
  if (Number(request.headers['content-length']) > maximum) throw failure(413, '手机官方模型请求超过大小限制。');
  let size = 0; const parts = [];
  for await (const part of request) { signal.throwIfAborted(); size += part.length; if (size > maximum) throw failure(413, '手机官方模型请求超过大小限制。'); parts.push(part); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); } catch { throw failure(400, '手机官方模型请求格式无效。'); }
}
function waitDrain(response, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { response.off('drain', ready); response.off('close', stopped); signal.removeEventListener('abort', stopped); };
    const ready = () => { cleanup(); resolve(); }, stopped = () => { cleanup(); reject(unavailable()); };
    response.once('drain', ready); response.once('close', stopped); signal.addEventListener('abort', stopped, { once: true });
    if (signal.aborted || response.destroyed) stopped();
  });
}

/** Phone OAuth never crosses this boundary. Only short-lived process-local
 * capabilities and catalog metadata are kept here; nothing enters JsonStore. */
export class MobileOfficialAccounts {
  constructor({ authorize, onChange = () => {}, clock = Date.now, leaseMs = 45000, pollMs = 25000, requestTimeoutMs = 600000 } = {}) {
    if (typeof authorize !== 'function') throw new TypeError('Mobile official authorization is required');
    if (!(leaseMs > 0 && leaseMs <= 45000 && pollMs > 0 && pollMs < leaseMs && requestTimeoutMs > 0 && requestTimeoutMs <= 600000)) throw new TypeError('Invalid mobile official timeouts');
    Object.assign(this, { authorize, onChange, clock, leaseMs, pollMs, requestTimeoutMs });
    this.connections = new Map(); this.capabilities = new Map(); this.requests = new Map(); this.incoming = new Set(); this.pendingChanges = new Set(); this.closed = false; this.server = null; this.baseUrl = ''; this.initializing = null;
  }
  async init() {
    if (this.closed) throw unavailable();
    if (this.initializing) return this.initializing;
    if (this.server) return this;
    this.initializing = this._init();
    try { return await this.initializing; } finally { this.initializing = null; }
  }
  async _init() {
    this.server = http.createServer((req, res) => { void this._request(req, res); });
    this.server.headersTimeout = 15000; this.server.requestTimeout = 30000;
    this.server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
    this.server.on('connect', (_req, socket) => socket.destroy()); this.server.on('upgrade', (_req, socket) => socket.destroy());
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', () => { this.server.off('error', reject); resolve(); }); });
    this.baseUrl = `http://127.0.0.1:${this.server.address().port}/v1`; this.server.unref();
    this.timer = setInterval(() => this._sweep(), Math.min(1000, this.leaseMs)); this.timer.unref(); return this;
  }
  _live(connection) {
    if (this.closed || !connection || this.connections.get(connection.id) !== connection || connection.expiresAt <= this.clock()) throw unavailable();
    this.authorize(connection.auth); return connection;
  }
  _verify(id, auth) {
    const connection = this.connections.get(id);
    if (!connection || connection.auth.userId !== auth.userId || connection.auth.sessionHash !== auth.sessionHash || auth.bootstrap) throw failure(404, '手机模型连接不存在。');
    try { return this._live(connection); } catch (error) { this._drop(connection); throw error; }
  }
  _change(connection) {
    let pending;
    pending = Promise.resolve().then(() => this.onChange(connection.auth.userId, { identityChanged: true, previousProviderIds: connection.models.map(item => item.id) })).catch(() => {}).finally(() => this.pendingChanges.delete(pending));
    this.pendingChanges.add(pending);
  }
  _drop(connection) {
    if (!connection || this.connections.get(connection.id) !== connection) return;
    this.connections.delete(connection.id); this.capabilities.delete(connection.secret); connection.wake?.();
    for (const controller of connection.incoming) controller.abort();
    for (const run of [...connection.requests.values()]) this._settle(run, unavailable());
    connection.commands = []; this._change(connection);
  }
  _sweep() { for (const connection of this.connections.values()) { try { this._live(connection); } catch { this._drop(connection); } } }
  providers(userId) {
    this._sweep(); const result = [];
    for (const connection of this.connections.values()) if (connection.auth.userId === userId) result.push(...connection.models.map(item => ({ id: item.id, name: `ChatGPT · ${item.displayName}（手机）`, protocol: 'responses', baseUrl: this.baseUrl, model: item.model, apiKey: connection.secret, reasoningEffort: '', source: 'official-account', supportsImages: item.supportsImages, officialProfileId: connection.revision })));
    return result;
  }
  providerFor(userId, id) { return this.providers(userId).find(item => item.id === id); }
  connect(auth, body) {
    if (auth.bootstrap) throw failure(403, '手机官方模型需要使用小伴账号密码登录。');
    this.authorize(auth); if (this.closed) throw unavailable(); this._sweep();
    const models = catalog(body, auth.userId);
    const existing = [...this.connections.values()].find(item => item.auth.userId === auth.userId && item.deviceId === body.deviceId);
    if (existing && existing.auth.sessionHash === auth.sessionHash && existing.revision === body.revision && JSON.stringify(existing.models) === JSON.stringify(models)) { existing.expiresAt = this.clock() + this.leaseMs; return this._public(existing); }
    if (!existing && [...this.connections.values()].filter(item => item.auth.userId === auth.userId).length >= 8) throw failure(409, '每个账号最多连接 8 台手机官方模型。');
    this._drop(existing);
    const connection = { id: randomUUID(), auth: { ...auth }, deviceId: body.deviceId, revision: body.revision, models, secret: randomBytes(32).toString('base64url'), expiresAt: this.clock() + this.leaseMs, commands: [], requests: new Map(), incoming: new Set(), polling: false, wake: null };
    this.connections.set(connection.id, connection); this.capabilities.set(connection.secret, connection); return this._public(connection);
  }
  _public(connection) { return { relayId: connection.id, models: connection.models.map(item => ({ ...item })), pollMs: this.pollMs }; }
  async poll(id, auth, signal) {
    const connection = this._verify(id, auth); if (connection.polling) throw failure(409, '手机模型连接已有取件请求。');
    connection.polling = true; connection.expiresAt = this.clock() + this.leaseMs;
    try {
      if (!connection.commands.length) await new Promise(resolve => {
        let timer; const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); if (connection.wake === finish) connection.wake = null; resolve(); };
        connection.wake = finish; timer = setTimeout(finish, this.pollMs); signal?.addEventListener('abort', finish, { once: true }); if (signal?.aborted) finish();
      });
      this._verify(id, auth); signal?.throwIfAborted(); connection.expiresAt = this.clock() + this.leaseMs;
      const command = connection.commands.shift(); if (command?.type === 'request') { const run = connection.requests.get(command.id); if (run) run.dispatched = true; } return { commands: command ? [command] : [] };
    } finally { connection.polling = false; }
  }
  disconnect(id, auth) { const connection = this._verify(id, auth); this._drop(connection); return { ok: true }; }
  revoke(predicate) { for (const connection of [...this.connections.values()]) if (predicate(connection.auth)) this._drop(connection); }
  _settle(run, error) {
    if (run.settled) return; run.settled = true; clearTimeout(run.timer); run.controller.abort();
    run.connection.requests.delete(run.id); this.requests.delete(run.id);
    run.connection.commands = run.connection.commands.filter(item => item.id !== run.id);
    if (error && run.dispatched && this.connections.has(run.connection.id)) { run.connection.commands.push({ type: 'cancel', id: run.id }); if (run.connection.commands.length > 32) run.connection.commands.shift(); run.connection.wake?.(); }
    if (error && !run.response.destroyed && !run.response.writableEnded) {
      if (!run.response.headersSent) run.response.writeHead(error.status || 502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      run.response.end(run.response.headersSent && run.started ? `event: error\ndata: ${JSON.stringify({ type: 'error', error: { code: 'mobile_official_unavailable', message: safeError } })}\n\n` : JSON.stringify({ error: { message: safeError } }));
    }
    run.finish();
  }
  async _frames(run, frames, final = false) {
    for (const frame of frames) {
      // Native completion is an explicit acknowledgement. Holding the terminal
      // until done prevents a Chat consumer from cancelling the phone transport
      // as soon as it sees response.completed, before the reply POST finishes.
      if (!final && (run.terminal.length || terminalFrame(frame))) { run.terminal.push(frame); continue; }
      if (!run.response.write(frame)) await waitDrain(run.response, run.controller.signal);
      this._live(run.connection); run.controller.signal.throwIfAborted();
    }
  }
  async reply(id, auth, body) {
    const connection = this._verify(id, auth), run = connection.requests.get(body?.id);
    if (!run) throw failure(404, '手机模型请求不存在或已结束。');
    if (run.writing || !fields(body, ['id', 'sequence', 'chunk', 'status', 'done', 'error']) || !Number.isSafeInteger(body.sequence) || body.sequence !== run.sequence || body.status !== undefined && (body.status !== 200 || body.sequence !== 0) || body.chunk !== undefined && (typeof body.chunk !== 'string' || !body.chunk || Buffer.byteLength(body.chunk) > CHUNK_BYTES) || body.done !== undefined && body.done !== true || body.error !== undefined && (!text(body.error, 320) || body.chunk !== undefined || body.done !== undefined || body.status !== undefined) || body.chunk === undefined && body.done === undefined && body.error === undefined && body.status === undefined) {
      this._settle(run, failure(502, safeError)); throw failure(409, '手机模型回复顺序或格式无效。');
    }
    run.writing = true;
    try {
      this._live(connection); run.controller.signal.throwIfAborted(); connection.expiresAt = this.clock() + this.leaseMs; run.sequence++;
      if (body.error !== undefined) { this._settle(run, failure(502, safeError)); return { ok: true }; }
      if (!run.started) { run.response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' }); run.response.flushHeaders(); run.started = true; }
      if (body.chunk !== undefined) {
        run.output += Buffer.byteLength(body.chunk); if (run.output > OUTPUT_BYTES) throw failure(502, safeError);
        const filtered = run.filter.push(Buffer.from(body.chunk));
        if (filtered.length) await this._frames(run, run.redactor.push(filtered));
      }
      if (body.done) {
        const tail = run.filter.push(undefined, true); if (tail.length) await this._frames(run, run.redactor.push(tail));
        await this._frames(run, run.redactor.finish());
        await this._frames(run, run.terminal, true); run.terminal = [];
        this._live(connection); run.response.end(); this._settle(run);
      }
      return { ok: true };
    } catch (error) { this._settle(run, failure(502, safeError)); throw failure(409, '手机模型流未完成，已停止本次请求。'); }
    finally { run.writing = false; }
  }
  async _request(req, res) {
    const controller = new AbortController(); let run, reading;
    const abortRead = () => { if (reading) req.destroy(); }; controller.signal.addEventListener('abort', abortRead);
    const stopped = () => { if (!res.writableEnded) { controller.abort(); if (run) this._settle(run, unavailable()); } }; res.once('close', stopped); req.once('aborted', stopped);
    try {
      if (this.closed || req.headers.host !== new URL(this.baseUrl).host || req.headers.origin !== undefined || req.method !== 'POST' || req.url !== '/v1/responses' || req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw failure(403, '不允许的手机模型请求。');
      const secret = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1], connection = this._live(this.capabilities.get(secret));
      if (connection.requests.size + connection.incoming.size >= 2 || this.requests.size + this.incoming.size >= 16) throw failure(429, '手机官方模型正在处理其它请求，请稍后重试。');
      reading = connection; connection.incoming.add(controller); this.incoming.add(controller);
      const original = await bodyJson(req, MODEL_REQUEST_BYTES, controller.signal); this._live(connection);
      const normalized = officialRequestBody(original, connection.models), bindings = flatBindings(original.tools, normalized.tools);
      if (Buffer.byteLength(JSON.stringify(normalized)) > MODEL_REQUEST_BYTES) throw failure(413, '手机官方模型请求超过大小限制。');
      connection.incoming.delete(controller); this.incoming.delete(controller); reading = null;
      let finish; const done = new Promise(resolve => { finish = resolve; });
      run = { id: randomUUID(), connection, response: res, controller, finish, sequence: 0, output: 0, writing: false, started: false, settled: false, terminal: [], filter: streamFilter([secret], bindings), redactor: createExecutorRelayRedactor({ secret }), timer: null };
      run.timer = setTimeout(() => this._settle(run, failure(504, safeError)), this.requestTimeoutMs); run.timer.unref();
      connection.requests.set(run.id, run); this.requests.set(run.id, run); connection.commands.push({ type: 'request', id: run.id, body: normalized }); connection.wake?.(); await done;
    } catch (error) {
      if (run) this._settle(run, failure(502, safeError));
      else if (!res.destroyed && !res.headersSent) { res.writeHead(error.status || 502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: { message: safeError } })); }
    } finally { reading?.incoming.delete(controller); this.incoming.delete(controller); controller.signal.removeEventListener('abort', abortRead); res.off('close', stopped); req.off('aborted', stopped); }
  }
  async close() {
    if (this.closed) return; this.closed = true; clearInterval(this.timer);
    for (const connection of [...this.connections.values()]) this._drop(connection);
    await Promise.allSettled([...this.pendingChanges]);
    if (this.server) { this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve)); }
  }
}

export function combineOfficialAccounts(...accounts) {
  const sources = accounts.filter(Boolean);
  return { providers: userId => sources.flatMap(source => source.providers(userId)), providerFor: (userId, id) => sources.map(source => source.providerFor?.(userId, id)).find(Boolean) };
}
