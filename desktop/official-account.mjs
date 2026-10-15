import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { MODEL_REQUEST_BYTES } from '../server/model-request-limits.mjs';

const MODELS_URL = 'https://api.openai.com/v1/models';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DIRECTORY_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 256;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit = 256) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
const safeFailure = Symbol('official-safe-failure');
const failure = (message, status = 400) => Object.assign(new Error(message), { status, [safeFailure]: true });
const abortFailure = () => Object.assign(new Error('官方模型请求已停止。'), { name: 'AbortError' });
const safeError = error => error?.name === 'AbortError' ? '官方模型请求已停止。' : '官方模型连接失败，请检查网络或重新登录。';
const emptyUsage = () => ({ state: 'unverified', checkedAt: null, lastModel: null, completedRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
const sharingErrors = Object.freeze({
  subscription_sharing_usage_limit_exceeded: { state: 'limit-reached', status: 429, message: 'ChatGPT 套餐或本应用的使用限额已达到，请到官方用量页面查看。' },
  subscription_sharing_usage_unavailable: { state: 'temporarily-unavailable', status: 503, message: '暂时无法检查 ChatGPT 用量，请稍后再试。' },
  subscription_sharing_user_unavailable: { state: 'temporarily-unavailable', status: 503, message: '官方账号或工作区信息暂时不可用，请稍后再试。' },
  subscription_sharing_user_not_eligible: { state: 'not-eligible', status: 403, message: '此官方账号或工作区暂不具备 ChatGPT 套餐共享资格。' },
  subscription_sharing_unsupported_capability: { status: 400, message: '当前官方请求包含尚不支持的模型能力，请调整后重试。' },
  subscription_sharing_route_not_supported: { status: 403, message: '官方套餐不支持当前请求路径，请检查客户端配置。' },
  subscription_sharing_invalid_user: { status: 401, message: '官方账号身份校验失败，请检查授权或重新登录。' },
  chatpass_v2_scope_not_authorized: { status: 403, message: '官方授权范围不允许此操作，请检查账号授权。' },
  chatpass_v2_invalid_authorization_context: { status: 403, message: '官方授权上下文无效，请检查账号授权。' },
});
function sharingError(value) {
  const error = object(value?.error) ? value.error : object(value?.response?.error) ? value.response.error : value;
  const code = Object.hasOwn(sharingErrors, error?.code) ? error.code : 'official_request_failed';
  return { code, message: sharingErrors[code]?.message || '官方模型请求未完成，请重试或检查官方账号。', ...(sharingErrors[code]?.state ? { state: sharingErrors[code].state } : {}) };
}
const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const addCount = (left, right) => Math.min(Number.MAX_SAFE_INTEGER, left + right);

/** Report only protocol categories. Raw headers/body may contain credentials,
 * user text or admission diagnostics and never belong in this error message. */
async function nonStreamDiagnostic(response, signal) {
  const mime = response.headers.get('content-type') || '';
  const category = !mime.trim() ? 'empty' : /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(mime) ? 'json' : /^text\/html(?:\s*;|$)/i.test(mime) ? 'html' : /^text\/plain(?:\s*;|$)/i.test(mime) ? 'plain' : 'other';
  const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 502;
  const parts = [`上游 HTTP ${status}`, `内容类型 ${category}`];
  if (!response.body) return parts.concat('响应形态 empty-body').join('；');
  const controller = new AbortController(), stopped = () => controller.abort();
  signal?.addEventListener('abort', stopped, { once: true }); if (signal?.aborted) controller.abort();
  const timer = setTimeout(stopped, 1500); timer.unref?.();
  const reader = response.body.getReader(), chunks = []; let size = 0, complete = false, shape = 'other-prefix';
  try {
    for (;;) {
      const next = await abortable(reader.read(), controller.signal);
      if (next.done) { complete = true; break; }
      size += next.value.byteLength;
      if (size > 65536) { shape = 'size-limit'; break; }
      chunks.push(Buffer.from(next.value));
      const prefix = Buffer.concat(chunks, size).toString('utf8');
      if (/(?:^|\r?\n)(?:event:|data:)/.test(prefix.replace(/^\uFEFF/, ''))) { shape = 'sse-prefix'; break; }
      if (prefix.length >= 16 && category !== 'json' && !/^\s*[\[{]/.test(prefix)) break;
    }
    if (complete) {
      const bytes = Buffer.concat(chunks, size), source = bytes.toString('utf8');
      if (!source.trim()) shape = 'empty-body';
      else {
        let value; try { value = JSON.parse(source); } catch {}
        if (object(value)) {
          shape = 'json-object';
          if (['queued', 'in_progress', 'completed', 'failed', 'incomplete', 'cancelled'].includes(value.status)) parts.push(`status=${value.status}`);
          const type = ['response', 'error', 'message', 'function_call', 'custom_tool_call', 'list', 'response.completed', 'response.failed', 'response.incomplete'].includes(value.type) ? value.type : ['response', 'error', 'list'].includes(value.object) ? value.object : null;
          if (type) parts.push(`type=${type}`);
          parts.push(`output=${Array.isArray(value.output) || Array.isArray(value.response?.output) ? 'present' : 'absent'}`);
          const known = sharingError(value); if (Object.hasOwn(sharingErrors, known.code)) parts.push(`error=${known.code}`);
        } else if (Array.isArray(value)) shape = 'json-array';
        else if (category === 'json') shape = 'json-invalid';
      }
    }
  } catch { shape = 'unreadable'; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', stopped); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return parts.concat(`响应形态 ${shape}`).join('；');
}

/** Some direct-route responses omit Content-Type even though the body is SSE.
 * Inspect a bounded complete frame, then replay every byte through the normal
 * filter. A declared non-SSE MIME type never uses this compatibility path. */
async function peekMissingMimeSse(reader, signal, status) {
  const chunks = [], decoder = new TextDecoder('utf-8', { fatal: true });
  const controller = new AbortController(), stop = () => controller.abort();
  const timer = setTimeout(stop, 15000); timer.unref?.();
  signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) controller.abort();
  let size = 0, pending = '', event = '', data = [];
  const invalid = shape => failure(`官方模型没有返回流式响应（上游 HTTP ${Number.isInteger(status) && status >= 100 && status <= 599 ? status : 502}；内容类型 empty；响应形态 ${shape}）。`, 502);
  const inspect = text => {
    pending += text; let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, ''); pending = pending.slice(newline + 1);
      if (!line) {
        if (data.length) {
          let value; try { value = JSON.parse(data.join('\n')); } catch { throw invalid('invalid-sse-frame'); }
          const type = event || value?.type;
          if (!object(value) || !/^(?:response\.[A-Za-z][A-Za-z0-9_.]*|error|ping)$/.test(type || '') || event && value.type && event !== value.type) throw invalid('invalid-sse-frame');
          return true;
        }
        event = ''; data = []; continue;
      }
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) { event = line.slice(6).replace(/^ /, ''); continue; }
      if (line.startsWith('data:')) { data.push(line.slice(5).replace(/^ /, '')); continue; }
      if (line.startsWith('id:') || line.startsWith('retry:')) continue;
      throw invalid(/^\s*[\[{]/.test(line) ? 'json-prefix' : /^\s*</.test(line) ? 'html-prefix' : 'other-prefix');
    }
    const trimmed = pending.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) throw invalid('json-prefix');
    if (trimmed.startsWith('<')) throw invalid('html-prefix');
    return false;
  };
  try {
    for (;;) {
      const next = await abortable(reader.read(), controller.signal);
      if (next.done) { inspect(decoder.decode()); throw invalid('incomplete-sse-prefix'); }
      // Inspect at most one normal frame's byte allowance. A transport chunk
      // may also contain later frames, so preserve it whole for normal replay.
      const prefix = next.value.subarray(0, DIRECTORY_BYTES - size); size += prefix.byteLength;
      chunks.push(next.value);
      if (inspect(decoder.decode(prefix, { stream: true }))) return chunks;
      if (size >= DIRECTORY_BYTES) throw invalid('prefix-size-limit');
    }
  } catch (error) {
    if (signal.aborted) throw abortFailure();
    if (error?.[safeFailure]) throw error;
    throw invalid(controller.signal.aborted ? 'prefix-timeout' : 'invalid-sse-prefix');
  } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
}

function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const stopped = () => { cleanup(); reject(abortFailure()); }, cleanup = () => signal.removeEventListener('abort', stopped);
    if (signal.aborted) { stopped(); return; }
    signal.addEventListener('abort', stopped, { once: true });
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

function stableId(userId, profileId, slug) {
  const bytes = createHash('sha256').update(JSON.stringify([userId, profileId, slug])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function jsonBody(body, headers, maxBytes, signal) {
  if (Number(headers?.get?.('content-length')) > maxBytes || Number(headers?.['content-length']) > maxBytes) throw failure('官方模型请求超过大小限制。', 413);
  if (!body) throw failure('官方模型返回空响应。', 502);
  let size = 0, done = false; const chunks = [], iterator = body[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await abortable(iterator.next(), signal); if (next.done) { done = true; break; }
      const buffer = Buffer.from(next.value); size += buffer.byteLength;
      if (size > maxBytes) throw failure('官方模型请求超过大小限制。', 413);
      chunks.push(buffer);
    }
  } finally { if (!done) Promise.resolve(iterator.return?.()).catch(() => {}); }
  signal?.throwIfAborted();
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw failure('官方模型没有返回有效 JSON。', 502); }
}

function activeProfile(status) {
  if (!['signed-in', 'signing-in'].includes(status?.state) || !text(status.activeProfileId)) return null;
  const profile = status.profiles?.find(item => item?.id === status.activeProfileId && item.signedIn === true);
  return profile && status.planUsageEnabled === true && profile.planUsageEnabled !== false ? profile : null;
}

function publicAuth(status) {
  return {
    state: ['signed-out', 'signing-in', 'signed-in'].includes(status?.state) ? status.state : 'signed-out',
    activeProfileId: text(status?.activeProfileId) ? status.activeProfileId : null,
    planUsageEnabled: status?.planUsageEnabled === true,
    profiles: Array.isArray(status?.profiles) ? status.profiles.slice(0, 64).filter(item => text(item?.id)).map(item => ({
      id: item.id, ...(text(item.email, 320) ? { email: item.email } : {}), ...(text(item.label, 160) ? { label: item.label } : {}),
      signedIn: item.signedIn === true, planUsageEnabled: item.planUsageEnabled === true,
    })) : [],
  };
}

function directory(data, userId, profileId) {
  if (!object(data) || !Array.isArray(data.models) || data.models.length > 4096) throw failure('官方模型目录格式无效。', 502);
  const seen = new Set(), models = [];
  for (const item of data.models) {
    if (!object(item) || item.visibility !== 'list' || item.hidden === true || !text(item.slug, 160) || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(item.slug) || seen.has(item.slug)) continue;
    seen.add(item.slug);
    const modalities = item.input_modalities ?? item.inputModalities;
    models.push({ id: stableId(userId, profileId, item.slug), model: item.slug, displayName: text(item.display_name, 160) ? item.display_name : item.slug, supportsImages: Array.isArray(modalities) && modalities.includes('image') });
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

function toolName(value) { return text(value, 128) && /^[A-Za-z0-9_.-]+$/.test(value); }
const NAMESPACE_DESCRIPTION = 'PetPal 中已经由用户授权的本地函数和工具。';
function toolsFor(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 256) throw failure('官方模型工具格式无效。');
  const namespaces = [], flat = [], names = new Set();
  const check = item => {
    if (!object(item) || !['function', 'custom'].includes(item.type) || !toolName(item.name)) throw failure('官方模型仅支持已授权的函数与自定义工具。');
    if (names.has(item.name)) throw failure('官方模型工具名称重复。'); names.add(item.name);
    if (names.size > 256) throw failure('官方模型工具超过数量限制。');
    return item;
  };
  for (const item of value) {
    if (item?.type !== 'namespace') { flat.push(check(item)); continue; }
    if (!toolName(item.name) || !Array.isArray(item.tools) || item.tools.length > 256 || namespaces.some(namespace => namespace.name === item.name)) throw failure('官方模型工具命名空间格式无效。');
    namespaces.push({ ...item, description: text(item.description, 32768) ? item.description : NAMESPACE_DESCRIPTION, tools: item.tools.map(check) });
  }
  if (flat.length) {
    let name = 'petpal'; while (namespaces.some(item => item.name === name)) name += '_';
    namespaces.push({ type: 'namespace', name, description: NAMESPACE_DESCRIPTION, tools: flat });
  }
  return namespaces;
}

/** Existing clients declare flat tools. The official endpoint requires a
 * namespace; project only that synthetic wrapper, never a caller-owned one. */
function flatBindings(original, normalized) {
  const bindings = new Map();
  for (const tool of original || []) {
    if (!['function', 'custom'].includes(tool?.type)) continue;
    const namespace = normalized?.find(item => item.tools.includes(tool));
    if (namespace) bindings.set(`${tool.type === 'function' ? 'function_call' : 'custom_tool_call'}:${tool.name}`, namespace.name);
  }
  return bindings;
}
function namespaceInput(item, bindings) {
  const namespace = bindings.get(`${item.type}:${item.name}`);
  return namespace && (item.namespace === undefined || item.namespace === null) ? { ...item, namespace } : item;
}
function clientToolItem(item, bindings) {
  if (!object(item) || item.namespace !== bindings.get(`${item.type}:${item.name}`) || item.namespace === undefined) return item;
  const projected = { ...item }; delete projected.namespace; return projected;
}

/** Normalize only documented SIWC Responses fields. Credentials and destination
 * are deliberately not configurable through this private transport. */
export function officialRequestBody(value, models) {
  if (!object(value) || !text(value.model, 160) || !models.some(item => item.model === value.model) || !Array.isArray(value.input) || value.input.some(item => !object(item))) throw failure('请选择当前官方账号可用的模型，并提供完整输入。');
  if (['userId', 'user_id', 'uid', 'profileId', 'profile_id', 'accessToken', 'access_token', 'apiKey', 'api_key', 'baseUrl', 'base_url', 'url', 'endpoint', 'token'].some(key => Object.hasOwn(value, key))) throw failure('官方模型请求包含不允许的身份或地址字段。');
  const body = { model: value.model, input: value.input.map(item => object(item) && item.role === 'system' ? { ...item, role: 'developer' } : item), store: false, stream: true };
  for (const key of ['instructions', 'reasoning', 'text', 'include', 'tool_choice', 'parallel_tool_calls']) if (value[key] !== undefined) body[key] = value[key];
  const tools = toolsFor(value.tools); if (tools !== undefined) body.tools = tools;
  const bindings = flatBindings(value.tools, tools);
  body.input = body.input.map(item => namespaceInput(item, bindings));
  // A hosted-tool tool_choice cannot smuggle a tool absent from the allowlist.
  if (typeof body.tool_choice === 'string' && !['auto', 'none', 'required'].includes(body.tool_choice)) throw failure('官方模型工具选择无效。');
  if (object(body.tool_choice)) {
    const choice = body.tool_choice, known = new Set((tools || []).flatMap(namespace => namespace.tools.map(tool => tool.name)));
    const valid = item => object(item) && ['function', 'custom'].includes(item.type) && toolName(item.name) && known.has(item.name);
    if (choice.type === 'allowed_tools') {
      if (!['auto', 'required'].includes(choice.mode) || !Array.isArray(choice.tools) || !choice.tools.length || choice.tools.length > 256 || choice.tools.some(item => !valid(item))) throw failure('官方模型工具选择无效。');
    } else if (!valid(choice)) throw failure('官方模型工具选择无效。');
  } else if (body.tool_choice !== undefined && typeof body.tool_choice !== 'string') throw failure('官方模型工具选择无效。');
  return body;
}

function waitDrain(response, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { response.removeListener('drain', drained); response.removeListener('close', stopped); signal.removeEventListener('abort', stopped); };
    const drained = () => { cleanup(); resolve(); }, stopped = () => { cleanup(); reject(abortFailure()); };
    response.once('drain', drained); response.once('close', stopped); signal.addEventListener('abort', stopped, { once: true });
    if (signal.aborted || response.destroyed) stopped();
  });
}

/** Bound one SSE frame, project only our synthetic tool namespace, and replace
 * upstream failure details. OAuth secrets can straddle transport chunks. */
function streamFilter(secrets, bindings = new Map(), observe = () => {}) {
  const decoder = new TextDecoder(), encoder = new TextEncoder(); let buffer = '';
  const redact = value => secrets.reduce((result, secret) => secret ? result.split(secret).join('[redacted]') : result, value);
  const frame = value => {
    const lines = value.split(/\r?\n/), event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || '';
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    let parsed; try { parsed = JSON.parse(data); } catch {}
    const type = typeof parsed?.type === 'string' ? parsed.type : event;
    if (['error', 'response.error', 'response.failed', 'response.incomplete'].includes(type) || parsed?.error || parsed?.response?.error) {
      const safeType = ['response.error', 'response.failed', 'response.incomplete'].includes(type) ? type : 'error';
      const known = sharingError(parsed), error = { code: known.code, message: known.message };
      observe({ type: 'failure', error: known });
      return `event: ${safeType}\ndata: ${JSON.stringify({ type: safeType, error, ...(safeType.startsWith('response.') ? { response: { status: safeType === 'response.incomplete' ? 'incomplete' : 'failed', error, output: [] } } : {}) })}\n\n`;
    }
    if (type === 'response.completed' && parsed?.response?.status === 'completed') observe({ type: 'completed', usage: parsed.response.usage });
    if (object(parsed) && bindings.size) {
      let changed = false;
      if (object(parsed.item)) { const item = clientToolItem(parsed.item, bindings); if (item !== parsed.item) { parsed.item = item; changed = true; } }
      if (Array.isArray(parsed.response?.output)) {
        const output = parsed.response.output.map(item => { const projected = clientToolItem(item, bindings); if (projected !== item) changed = true; return projected; });
        if (changed) parsed.response = { ...parsed.response, output };
      }
      if (changed) return redact(`event: ${type}\ndata: ${JSON.stringify(parsed)}\n\n`);
    }
    return redact(value);
  };
  return {
    push(chunk, final = false) {
      buffer += decoder.decode(chunk, { stream: !final }); const output = []; let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const end = boundary.index + boundary[0].length;
        if (Buffer.byteLength(buffer.slice(0, end)) > DIRECTORY_BYTES) throw failure('官方模型流事件超过大小限制。', 502);
        output.push(frame(buffer.slice(0, end))); buffer = buffer.slice(end);
      }
      if (Buffer.byteLength(buffer) > DIRECTORY_BYTES) throw failure('官方模型流事件超过大小限制。', 502);
      if (final && buffer) { output.push(frame(buffer)); buffer = ''; }
      return encoder.encode(output.join(''));
    },
  };
}

export class OfficialAccounts {
  constructor({ auth, fetchImpl = fetch, onChange = () => {}, maxBytes = MODEL_REQUEST_BYTES, requestTimeoutMs = 600000 } = {}) {
    if (!auth || typeof auth.status !== 'function' || typeof auth.access !== 'function') throw new TypeError('Official auth is required');
    this.auth = auth; this.fetch = fetchImpl; this.onChange = onChange; this.maxBytes = maxBytes; this.requestTimeoutMs = requestTimeoutMs;
    this.users = new Map(); this.secrets = new Map(); this.pending = new Set(); this.closed = false; this.server = null; this.baseUrl = ''; this.initializing = null;
  }
  async init() {
    if (this.closed) throw failure('官方模型连接已关闭。', 503);
    if (this.initializing) return this.initializing;
    if (this.server) return this;
    this.initializing = this._init();
    try { return await this.initializing; } finally { this.initializing = null; }
  }
  async _init() {
    await this.auth.init?.();
    if (this.closed) throw failure('官方模型连接已关闭。', 503);
    this.server = http.createServer((request, response) => void this._request(request, response));
    this.server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
    this.server.headersTimeout = 15000; this.server.requestTimeout = 30000;
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', () => { this.server.removeListener('error', reject); resolve(); }); });
    this.baseUrl = `http://127.0.0.1:${this.server.address().port}/v1`; this.server.unref(); return this;
  }
  _scope(userId) {
    if (!text(userId, 160)) throw failure('请先登录小伴账号。', 401);
    let scope = this.users.get(userId);
    if (!scope) { scope = { userId, generation: 0, profileId: null, revision: null, secret: null, models: [], providers: [], grantProviders: new Map(), grantedIds: new Set(), usage: emptyUsage(), requests: new Set(), refresh: null, initialized: false, error: '', checkedAt: null }; this.users.set(userId, scope); }
    return scope;
  }
  _revoke(scope) {
    scope.generation++; if (scope.secret) this.secrets.delete(scope.secret);
    scope.models = []; scope.providers = []; scope.grantProviders.clear(); scope.grantedIds.clear(); scope.usage = emptyUsage(); scope.profileId = null; scope.revision = null; scope.secret = null; scope.initialized = false; scope.refresh = null;
    for (const controller of scope.requests) controller.abort(abortFailure()); scope.requests.clear();
  }
  providers(userId) {
    if (this.closed) return [];
    return this.users.get(userId)?.providers.map(provider => ({ ...provider })) || [];
  }
  /** Private continuation lookup. New selections must use providers(), which
   * reflects the current catalog; only already-bound work may use this grant. */
  providerFor(userId, id) {
    if (this.closed) return undefined;
    const provider = this.users.get(userId)?.grantProviders.get(id);
    return provider ? { ...provider } : undefined;
  }
  async status(userId) {
    const scope = this._scope(userId);
    if (this.closed) return { ...publicAuth(null), usage: emptyUsage(), models: [], modelsLoading: false, modelsError: '官方模型连接已关闭。', modelsCheckedAt: scope.checkedAt };
    let state;
    try { state = await this.auth.status(userId); }
    catch { return { ...publicAuth(null), usage: emptyUsage(), models: [], modelsLoading: false, modelsError: '无法读取官方账号状态，请重试。', modelsCheckedAt: scope.checkedAt }; }
    if (!this.closed && (!scope.initialized || activeProfile(state)?.id !== scope.profileId)) await this._refresh(userId, false).catch(() => {});
    try { state = await this.auth.status(userId); } catch { state = null; }
    const matches = activeProfile(state)?.id === scope.profileId && (!state?.revision || state.revision === scope.revision);
    return { ...publicAuth(state), usage: matches ? { ...scope.usage } : emptyUsage(), models: matches ? scope.models.map(model => ({ ...model })) : [], modelsLoading: !!scope.refresh, modelsError: scope.error || '', modelsCheckedAt: scope.checkedAt };
  }
  async refresh(userId) { await this._refresh(userId, true).catch(() => {}); return this.status(userId); }
  async resumeUsage(userId, { authorize } = {}) {
    await authorize?.();
    if (this.closed) throw failure('官方模型连接已关闭。', 503);
    const scope = this._scope(userId), state = await this.auth.status(userId);
    await authorize?.();
    if (!activeProfile(state) || activeProfile(state).id !== scope.profileId || state.revision && state.revision !== scope.revision) throw failure('请先登录当前官方账号。', 401);
    // This is an explicit retry choice, never evidence that allowance reset.
    scope.usage = { ...scope.usage, state: 'unverified' }; this._notify(userId); return this.status(userId);
  }
  _observeUsage(scope, model, observation) {
    const observed = observation.type === 'completed' ? 'available' : observation.error?.state;
    if (!observed) return;
    // A request admitted before another request hit a limit can finish later.
    // Its real token usage counts, but only a user action may clear the pause.
    const paused = ['limit-reached', 'not-eligible'];
    const state = paused.includes(scope.usage.state) && !paused.includes(observed) ? scope.usage.state : observed;
    scope.usage = { ...scope.usage, state, checkedAt: new Date().toISOString(), lastModel: model };
    if (observation.type === 'completed') {
      const usage = observation.usage;
      scope.usage.completedRequests = addCount(scope.usage.completedRequests, 1);
      scope.usage.inputTokens = addCount(scope.usage.inputTokens, tokenCount(usage?.input_tokens));
      scope.usage.outputTokens = addCount(scope.usage.outputTokens, tokenCount(usage?.output_tokens));
      scope.usage.totalTokens = addCount(scope.usage.totalTokens, tokenCount(usage?.total_tokens));
    }
    this._notify(scope.userId);
  }
  /** Auth invokes this only for profile/consent/login identity transitions, not
   * ordinary token renewal. Revoke synchronously before any async work. */
  changed(userId, snapshot) {
    const scope = this._scope(userId), profile = snapshot && activeProfile(snapshot);
    if (snapshot && (profile?.id || null) === scope.profileId && (snapshot.revision || null) === scope.revision) { this._notify(userId); return Promise.resolve(); }
    const previousProviderIds = [...scope.grantedIds]; this._revoke(scope); this._notify(userId, { identityChanged: true, previousProviderIds });
    if (this.closed) return Promise.resolve();
    return this._refresh(userId, true).catch(() => {});
  }
  _notify(userId, change = { identityChanged: false }) { try { Promise.resolve(this.onChange(userId, change)).catch(() => {}); } catch {} }
  async _refresh(userId, force) {
    if (this.closed) throw failure('官方模型连接已关闭。', 503);
    await this.init(); const scope = this._scope(userId);
    if (scope.refresh) return scope.refresh;
    if (scope.initialized && !force) return;
    const generation = scope.generation, controller = new AbortController(); scope.requests.add(controller); this.pending.add(controller);
    const timer = setTimeout(() => controller.abort(abortFailure()), Math.min(this.requestTimeoutMs, 30000)); timer.unref?.();
    const current = () => !this.closed && generation === scope.generation && !controller.signal.aborted;
    const run = (async () => {
      try {
        const state = await this.auth.status(userId), profile = activeProfile(state);
        if (!current()) return;
        if (!profile) { const previousProviderIds = [...scope.grantedIds], identityChanged = !!scope.profileId; this._revoke(scope); scope.initialized = true; scope.error = state?.state === 'signed-in' ? '此官方账号尚未授权使用 ChatGPT 套餐。' : ''; this._notify(userId, { identityChanged, ...(identityChanged ? { previousProviderIds } : {}) }); return; }
        let access = await this.auth.access(userId, { signal: controller.signal });
        if (!current()) return;
        if (!access || access.profileId !== profile.id || !text(access.revision, 512) || !text(access.accessToken, 32768)) throw failure('官方账号授权已改变，请重新读取。', 401);
        const headers = () => ({ Authorization: `Bearer ${access.accessToken}`, Accept: 'application/json' });
        let response = await this.fetch(MODELS_URL, { method: 'GET', headers: headers(), redirect: 'error', signal: controller.signal });
        if (response.status === 401) {
          await response.body?.cancel().catch(() => {}); access = await this.auth.access(userId, { signal: controller.signal, forceRefresh: true });
          if (!current()) return;
          if (access.profileId !== profile.id || !text(access.accessToken, 32768) || !text(access.revision, 512)) throw failure('官方账号授权已改变，请重新读取。', 401);
          response = await this.fetch(MODELS_URL, { method: 'GET', headers: headers(), redirect: 'error', signal: controller.signal });
        }
        if (!response.ok) { await response.body?.cancel().catch(() => {}); throw failure(`官方模型目录暂不可用（HTTP ${Number(response.status) || 502}）。`, 502); }
        const models = directory(await jsonBody(response.body, response.headers, DIRECTORY_BYTES, controller.signal), userId, profile.id);
        if (!current()) return;
        const same = scope.profileId === profile.id && scope.revision === access.revision;
        if (!same) {
          const previousProviderIds = [...scope.grantedIds], identityChanged = !!scope.profileId;
          if (scope.secret) this.secrets.delete(scope.secret);
          for (const active of scope.requests) if (active !== controller) active.abort(abortFailure());
          scope.grantedIds.clear(); scope.grantProviders.clear(); scope.usage = emptyUsage(); scope.profileId = profile.id; scope.revision = access.revision;
          if (identityChanged) this._notify(userId, { identityChanged: true, previousProviderIds });
        }
        const secret = same && scope.secret || randomBytes(32).toString('base64url'); scope.secret = secret;
        scope.models = models; scope.providers = models.map(model => ({ id: model.id, name: `ChatGPT · ${model.displayName}`, protocol: 'responses', baseUrl: this.baseUrl, model: model.model, apiKey: secret, reasoningEffort: '', source: 'official-account', supportsImages: model.supportsImages, officialProfileId: profile.id }));
        for (const provider of scope.providers) { scope.grantedIds.add(provider.id); scope.grantProviders.set(provider.id, { ...provider }); }
        this.secrets.set(secret, scope);
        scope.initialized = true; scope.error = models.length ? '' : '官方账号暂未返回可用模型。'; scope.checkedAt = new Date().toISOString(); this._notify(userId);
      } catch (error) {
        if (current()) {
          // A failed refresh cannot advertise a stale model grant. Ordinary
          // refresh does not abort an already authorized inference stream.
          scope.models = []; scope.providers = []; scope.initialized = true;
          scope.error = error?.[safeFailure] ? error.message : safeError(error); scope.checkedAt = new Date().toISOString(); this._notify(userId);
        }
        throw error;
      } finally { clearTimeout(timer); scope.requests.delete(controller); this.pending.delete(controller); }
    })();
    scope.refresh = run; try { await run; } finally { if (scope.refresh === run) scope.refresh = null; }
  }
  async _request(request, response) {
    const controller = new AbortController(); this.pending.add(controller);
    const disconnected = () => { if (!response.writableEnded) controller.abort(abortFailure()); };
    response.on('close', disconnected); request.on('aborted', disconnected);
    const timer = setTimeout(() => controller.abort(abortFailure()), this.requestTimeoutMs); timer.unref?.();
    let scope, reader;
    try {
      const host = new URL(this.baseUrl).host;
      if (this.closed || request.headers.host !== host || request.headers.origin !== undefined || request.method !== 'POST' || request.url !== '/v1/responses') throw failure('不允许的官方模型请求。', 403);
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization || '');
      scope = match && this.secrets.get(match[1]);
      if (!scope) throw failure('官方模型授权已失效，请重新选择模型。', 401);
      scope.requests.add(controller); const generation = scope.generation, profileId = scope.profileId, revision = scope.revision;
      const assertCurrent = () => { controller.signal.throwIfAborted(); if (this.closed || generation !== scope.generation || scope.profileId !== profileId || scope.revision !== revision || this.secrets.get(match[1]) !== scope) throw failure('官方模型授权已改变，请重新选择模型。', 401); };
      const value = await jsonBody(request, request.headers, this.maxBytes, controller.signal); assertCurrent();
      const normalized = officialRequestBody(value, [...scope.grantProviders.values()]), bindings = flatBindings(value.tools, normalized.tools);
      const body = JSON.stringify(normalized);
      if (['limit-reached', 'not-eligible'].includes(scope.usage.state)) {
        const code = scope.usage.state === 'limit-reached' ? 'subscription_sharing_usage_limit_exceeded' : 'subscription_sharing_user_not_eligible', info = sharingErrors[code];
        throw Object.assign(failure(info.message, info.status), { officialCode: code });
      }
      let access = await this.auth.access(scope.userId, { signal: controller.signal }); assertCurrent(); const credentials = [match[1], access?.accessToken];
      const checkAccess = () => { if (access?.profileId !== profileId || access?.revision !== revision || !text(access.accessToken, 32768)) throw failure('官方模型授权已改变，请重新选择模型。', 401); };
      checkAccess();
      const run = () => this.fetch(RESPONSES_URL, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${access.accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body, signal: controller.signal });
      let upstream = await run(); assertCurrent();
      if (upstream.status === 401) { await upstream.body?.cancel().catch(() => {}); access = await this.auth.access(scope.userId, { signal: controller.signal, forceRefresh: true }); assertCurrent(); checkAccess(); credentials.push(access.accessToken); upstream = await run(); assertCurrent(); }
      if (!upstream.ok) {
        let data; try { data = await jsonBody(upstream.body, upstream.headers, 65536, controller.signal); } catch {}
        assertCurrent(); const known = sharingError(data); this._observeUsage(scope, normalized.model, { type: 'failure', error: known });
        const status = Number.isInteger(upstream.status) && upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
        throw Object.assign(failure(known.code === 'official_request_failed' ? `官方模型请求未完成（HTTP ${status}）。` : known.message, status), { officialCode: known.code });
      }
      const contentType = upstream.headers.get('content-type') || ''; let peeked = [];
      if (!upstream.body || contentType.trim() && !/^text\/event-stream(?:\s*;|$)/i.test(contentType)) { const diagnostic = await nonStreamDiagnostic(upstream, controller.signal); assertCurrent(); throw failure(`官方模型没有返回流式响应（${diagnostic}）。`, 502); }
      if (!contentType.trim()) { reader = upstream.body.getReader(); peeked = await peekMissingMimeSse(reader, controller.signal, upstream.status); assertCurrent(); }
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' }); response.flushHeaders();
      let terminalObserved = false;
      reader ??= upstream.body.getReader(); const filter = streamFilter(credentials, bindings, observation => { if (!terminalObserved) { assertCurrent(); terminalObserved = true; this._observeUsage(scope, normalized.model, observation); } });
      const stopReader = () => { void reader?.cancel().catch(() => {}); }; controller.signal.addEventListener('abort', stopReader, { once: true });
      try {
        for (const chunk of peeked) { assertCurrent(); const filtered = filter.push(chunk); if (filtered.byteLength && !response.write(Buffer.from(filtered))) await waitDrain(response, controller.signal); }
        while (true) { assertCurrent(); const { value: chunk, done } = await abortable(reader.read(), controller.signal); assertCurrent(); const filtered = filter.push(chunk, done); if (filtered.byteLength && !response.write(Buffer.from(filtered))) await waitDrain(response, controller.signal); if (done) break; }
        assertCurrent(); response.end();
      } finally { controller.signal.removeEventListener('abort', stopReader); }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) { const status = error?.[safeFailure] ? error.status : controller.signal.aborted ? 499 : 502; response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ error: { message: error?.[safeFailure] ? error.message : safeError(error), ...(Object.hasOwn(sharingErrors, error?.officialCode) ? { code: error.officialCode } : {}) } })); }
      else response.destroy();
    } finally { clearTimeout(timer); scope?.requests.delete(controller); this.pending.delete(controller); response.removeListener('close', disconnected); request.removeListener('aborted', disconnected); if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
  }
  async close() {
    if (this.closed) return; this.closed = true;
    for (const scope of this.users.values()) this._revoke(scope);
    for (const controller of this.pending) controller.abort(abortFailure()); this.pending.clear(); this.secrets.clear();
    const server = this.server; this.server = null;
    if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
    await this.auth.close?.();
  }
}
