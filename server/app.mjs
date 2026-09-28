import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { JsonStore, publicProvider, isCompanionKind, defaultSettings } from './store.mjs';
import { normalizeBaseUrl, normalizeReasoningEffort, streamProvider, testProvider } from './providers.mjs';
import { CodexBridge } from './codex.mjs';
import { tokenHash, secureEqual, username, hashPassword, verifyPassword, newSession, publicUser, createLoginLimiter } from './auth.mjs';
import { defaultVoiceSettings, publicVoiceSettings, patchVoiceSettings } from './voice.mjs';
import { defaultCodexConfig, publicCodexConfig, patchCodexConfig, validateStoredCodexConfig, parseCodexHttpOrigins, CODEX_TOOL_VERSION } from './codex-config.mjs';
import { createDesktopTools } from './desktop-tools.mjs';
import { createUpdateService } from './updates.mjs';
import { createCosyVoiceService, safeCosyVoiceError, REFERENCE_LIMIT } from './cosyvoice.mjs';
import { createAgentTasks } from './agent-tasks.mjs';
import { normalizeAgentPermissions } from './agent-permissions.mjs';

const VERSION = '0.6.1';
const now = () => new Date().toISOString();
const failure = (status, message) => Object.assign(new Error(message), { status });

function string(value, label, maximum, { optional = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw failure(400, `${label}不能为空，且不能超过 ${maximum} 个字符。`);
  return value.trim();
}

function safeCodexStatus(value) {
  return value && typeof value === 'object' ? value : { available: false, error: 'Codex 状态不可用。' };
}

export async function createPetServer({ dataDir = process.env.PETPAL_DATA_DIR || path.resolve('.data'), token, staticDir, allowedOrigins = [], workspaceRoot = process.cwd(), codex, codexFactory, desktopTools, updatesOptions, cosyvoiceOptions, codexHttpOrigins = process.env.PETPAL_CODEX_HTTP_ORIGINS } = {}) {
  const codexPolicy = { allowedHttpOrigins: parseCodexHttpOrigins(codexHttpOrigins) };
  const store = await new JsonStore(dataDir).init();
  const accessToken = await store.token(token ?? process.env.PETPAL_TOKEN);
  const ownerTokenHash = tokenHash(accessToken);
  const state = store.state;
  const legacyCodex = !state.codexConfig;
  state.codexConfig ??= defaultCodexConfig();
  validateStoredCodexConfig(state.codexConfig, codexPolicy);
  if (state.codexConfig.reasoningEffort === undefined) state.codexConfig.reasoningEffort = '';
  if (state.codexConfig.toolVersion !== CODEX_TOOL_VERSION) Object.assign(state.codexConfig, { toolVersion: CODEX_TOOL_VERSION, revision: randomUUID() });
  if (legacyCodex) for (const conversation of state.conversations) if (conversation.mode === 'codex') conversation.codexRevision = state.codexConfig.revision;
  const updates = createUpdateService({ ...updatesOptions, store });
  const cosyvoice = await createCosyVoiceService({ ...cosyvoiceOptions, store, dataDir });
  await store.save();
  const localTools = desktopTools ?? createDesktopTools({ dataDir });
  const createBridge = config => (codexFactory ?? (options => new CodexBridge(options)))({ workspaceRoot, dataDir, config, desktopTools: localTools });
  let bridge = codex ?? createBridge(state.codexConfig);
  let configChanging = false, configSwap = null, codexReaders = 0;
  const readCodexStatus = async () => {
    if (configChanging) throw failure(409, 'Codex 配置正在切换，请稍后重试。');
    codexReaders++;
    try { return safeCodexStatus(await bridge.status()); } finally { codexReaders--; }
  };
  const redactCodex = value => {
    if (typeof value === 'string') return state.codexConfig.apiKey ? value.split(state.codexConfig.apiKey).join('[已隐藏]') : value;
    if (Array.isArray(value)) return value.map(redactCodex);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactCodex(item)]));
    return value;
  };
  const active = new Map();
  const probes = new Set();
  const approvals = new Map();
  const limitLogin = createLoginLimiter();
  let shuttingDown = false;
  const app = express();
  app.disable('x-powered-by');
  const origins = new Set(allowedOrigins.map(value => {
    const url = new URL(value); if (!['http:', 'https:', 'capacitor:'].includes(url.protocol)) throw new Error('允许来源协议无效。'); return url.origin === 'null' ? value.replace(/\/$/, '') : url.origin;
  }));
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...Object.values(networkInterfaces()).flat().filter(Boolean).map(item => item.address.includes(':') ? `[${item.address}]` : item.address)]);
  for (const origin of origins) localHosts.add(new URL(origin).hostname);

  app.use((req, res, next) => {
    if (shuttingDown) return res.status(503).json({ error: '服务正在退出。' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    let host;
    try { host = new URL(`http://${req.headers.host}`).hostname; } catch { return res.status(400).json({ error: '无效 Host。' }); }
    if (!localHosts.has(host)) return res.status(403).json({ error: '此主机名未被允许，请配置服务来源名单。' });
    const origin = req.headers.origin;
    if (origin) {
      const sameOrigin = origin === `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
      if (!sameOrigin && !origins.has(origin)) return res.status(403).json({ error: '此来源未被允许。' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION }));
  app.use('/api', express.json({ limit: '128kb', strict: true }));
  app.use('/api', (req, res, next) => {
    if (req.body !== undefined && (Array.isArray(req.body) || !req.body || typeof req.body !== 'object')) return next(failure(400, '请求正文必须是 JSON 对象。'));
    req.body ??= {};
    next();
  });
  const isOwner = user => user.id === state.ownerId;
  const settingsFor = user => isOwner(user) ? state.settings : user.settings;
  const canUseProvider = (user, id) => isOwner(user) || user.providerIds.includes(id);
  const visibleProvider = (provider, user) => ({ ...publicProvider(provider), editable: isOwner(user), testable: true });
  const visibleUser = user => publicUser(user, state.ownerId);
  const managedUser = user => ({ ...visibleUser(user), disabled: user.disabled, providerIds: isOwner(user) ? state.providers.map(provider => provider.id) : [...user.providerIds], hasPassword: Boolean(user.password), createdAt: user.createdAt });
  const requireAdmin = user => { if (!isOwner(user)) throw failure(403, '仅管理员可管理账号和模型。'); };
  const requireCodex = user => { if (!visibleUser(user).canUseCodex) throw failure(403, '此账号尚未获管理员授权使用 Agent。'); };
  const normalizeAgentAccess = value => { if (!['none', 'workspace', 'full'].includes(value)) throw failure(400, 'Agent 授权须为 none、workspace 或 full。'); return value; };
  const requirePermissions = (user, value) => {
    requireCodex(user); const permissions = normalizeAgentPermissions(value);
    if (visibleUser(user).agentAccess !== 'full' && permissions.access === 'full-access') throw failure(403, '此账号未获完整主机权限。');
    return permissions;
  };
  const requireCurrentAuth = req => {
    if (req.user.disabled || (!req.bootstrap && !state.sessions.some(session => session.tokenHash === req.sessionHash && session.userId === req.user.id && session.expiresAt > Date.now()))) throw failure(401, '登录凭据已过期或已撤销。');
  };
  // Only the native final handoff may recheck an existing owner session after
  // backend.close(); no HTTP route accepts the allowClosing option.
  updates.assertOwnerSession = (value, { allowClosing = false } = {}) => {
    if (typeof value !== 'string' || !value || value.length > 4096) throw failure(401, '登录凭据无效或已撤销。');
    const sessionHash = tokenHash(value), bootstrap = secureEqual(sessionHash, ownerTokenHash);
    const session = bootstrap ? null : state.sessions.find(item => item.tokenHash === sessionHash && item.expiresAt > Date.now());
    const user = state.users.find(item => item.id === (bootstrap ? state.ownerId : session?.userId));
    if (!user || user.disabled) throw failure(401, '登录凭据无效或已撤销。');
    if (!isOwner(user)) throw failure(403, '仅主机 owner 可以安装桌面更新。');
    if (shuttingDown && allowClosing !== true) throw failure(503, '服务正在退出。');
    return { userId: user.id, sessionHash, bootstrap };
  };
  const conversationById = (id, user) => { const result = state.conversations.find(item => item.id === id && item.userId === user.id); if (!result) throw failure(404, '会话不存在。'); return result; };
  const providerById = (id, user) => { const result = state.providers.find(item => item.id === id && canUseProvider(user, item.id)); if (!result) throw failure(404, '模型连接不存在或未获授权。'); return result; };
  const eligibleProviders = user => state.providers.filter(provider => canUseProvider(user, provider.id) && state.codexConfig.mode === 'api' && state.codexConfig.baseUrl && provider.protocol === 'responses' && normalizeBaseUrl(provider.baseUrl, 'responses') === normalizeBaseUrl(state.codexConfig.baseUrl, 'responses')).map(provider => provider.id);
  const userCodexStatus = async user => {
    if (!visibleUser(user).canUseCodex) return { available: false, running: false, disabled: true, eligibleProviderIds: [], message: '此账号尚未获管理员授权使用 Agent。' };
    const status = redactCodex(await readCodexStatus());
    return { ...(isOwner(user) ? status : { available: status.available, running: status.running, authenticated: status.authenticated, configured: status.configured, error: status.error, message: status.message }), ...publicCodexConfig(state.codexConfig), eligibleProviderIds: eligibleProviders(user) };
  };
  const visibleConversation = conversation => ({ id: conversation.id, title: conversation.title, mode: conversation.mode, providerId: conversation.providerId, messages: conversation.messages, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, ...(conversation.threadId ? { threadId: conversation.threadId } : {}), ...(conversation.mode === 'codex' ? { codexRevision: conversation.codexRevision, codexConfigChanged: conversation.codexRevision !== state.codexConfig.revision, agent: agentTasks.snapshot(conversation) } : {}) });
  const publicState = async user => ({ instanceId: state.instanceId, user: visibleUser(user), settings: settingsFor(user), providers: state.providers.filter(provider => canUseProvider(user, provider.id)).map(provider => visibleProvider(provider, user)), conversations: state.conversations.filter(item => item.userId === user.id).map(visibleConversation), codex: await userCodexStatus(user) });
  const assertIdle = id => { if (active.has(id)) throw failure(409, '这个会话正在回复，请先停止。'); };
  const stopTasks = async predicate => {
    const agentStopped = agentTasks.revoke(predicate);
    const stoppedProbes = [...probes].filter(predicate);
    for (const probe of stoppedProbes) probe.controller.abort(new DOMException('账号权限已变更。', 'AbortError'));
    const tasks = [...active.values()].filter(predicate);
    for (const task of tasks) task.controller.abort(new DOMException('登录或模型权限已撤销。', 'AbortError'));
    await Promise.all([agentStopped, ...[...tasks, ...stoppedProbes].map(task => task.done)]);
  };
  const resolveAgentModel = (userId, providerId) => {
    const user = state.users.find(item => item.id === userId); if (!user) throw failure(401, '账号不可用。');
    if (configChanging) throw failure(409, 'Agent 配置正在切换。');
    const config = state.codexConfig;
    if (providerId === null) return { model: config.model || '', effort: config.reasoningEffort || '', codexRevision: config.revision };
    const provider = providerById(providerId, user);
    if (!eligibleProviders(user).includes(provider.id)) throw failure(400, 'Agent 模型必须来自当前同一 Responses 服务；其他连接仍可用于 Chat。');
    return { model: provider.model, effort: provider.reasoningEffort || '', codexRevision: config.revision };
  };
  const agentTasks = createAgentTasks({ store, active, approvals, getBridge: () => bridge, redact: redactCodex, resolveModel: resolveAgentModel,
    authorize: entry => {
      const user = state.users.find(item => item.id === entry.auth.userId);
      const session = state.sessions.find(item => item.userId === user?.id && item.tokenHash === entry.auth.sessionHash && item.expiresAt > Date.now());
      const bootstrap = entry.auth.bootstrap && secureEqual(entry.auth.sessionHash, ownerTokenHash) && isOwner(user ?? {});
      if (!user || user.disabled || (!bootstrap && !session)) throw failure(401, 'Agent 提交所属账号或登录已失效。');
      requirePermissions(user, entry.permissions);
      const conversation = state.conversations.find(item => item.id === entry.conversationId && item.userId === user.id);
      if (!conversation || conversation.mode !== 'codex' || conversation.codexRevision !== state.codexConfig.revision) throw failure(409, 'Agent 会话已删除或配置已变化，请新建会话。');
      const current = resolveAgentModel(user.id, entry.providerId);
      if (entry.codexRevision !== current.codexRevision || entry.model !== current.model || entry.effort !== current.effort) throw failure(409, 'Agent 模型配置已变化，请重新提交。');
      return bootstrap ? undefined : session.expiresAt;
    },
  });
  const providerIds = value => {
    if (!Array.isArray(value) || value.length > 32 || value.some(id => typeof id !== 'string' || !state.providers.some(provider => provider.id === id))) throw failure(400, '模型授权列表无效。');
    return [...new Set(value)];
  };

  app.post('/api/auth/login', async (req, res) => {
    const name = typeof req.body?.username === 'string' ? req.body.username.toLowerCase().slice(0, 80) : '';
    limitLogin(req.socket.remoteAddress || 'unknown', name);
    const user = state.users.find(item => item.username === name);
    const savedPassword = user?.password;
    const verified = await verifyPassword(req.body?.password, savedPassword);
    if (!verified || !user || user.disabled || user.password !== savedPassword) throw failure(401, '账号或密码无效。');
    const { token: sessionToken, session } = newSession(user.id);
    state.sessions = state.sessions.filter(item => item.expiresAt > Date.now());
    const previous = state.sessions.filter(item => item.userId === user.id);
    const expired = new Set(previous.slice(0, Math.max(0, previous.length - 7)).map(item => item.tokenHash));
    if (expired.size) {
      state.sessions = state.sessions.filter(item => !expired.has(item.tokenHash));
    }
    state.sessions.push(session); await store.save();
    if (expired.size) await stopTasks(task => expired.has(task.sessionHash));
    if (user.disabled || user.password !== savedPassword || !state.sessions.includes(session)) throw failure(401, '登录凭据已撤销，请重新登录。');
    res.json({ token: sessionToken, user: visibleUser(user) });
  });
  app.use('/api', (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ') || auth.length > 4103) return res.status(401).json({ error: '登录凭据无效或未填写。' });
    const hash = tokenHash(auth.slice(7));
    const bootstrap = secureEqual(hash, ownerTokenHash);
    const session = bootstrap ? null : state.sessions.find(item => item.tokenHash === hash && item.expiresAt > Date.now());
    const user = state.users.find(item => item.id === (bootstrap ? state.ownerId : session?.userId));
    if (!user || user.disabled) return res.status(401).json({ error: '登录凭据无效、已过期或账号已停用。' });
    req.user = user; req.sessionHash = hash; req.bootstrap = bootstrap; next();
  });
  app.get('/api/auth/me', (req, res) => res.json({ instanceId: state.instanceId, user: visibleUser(req.user) }));
  app.post('/api/auth/logout', async (req, res) => {
    state.sessions = state.sessions.filter(item => item.tokenHash !== req.sessionHash);
    await stopTasks(task => task.userId === req.user.id && task.sessionHash === req.sessionHash);
    await store.save(); res.json({ ok: true, pairingTokenUnchanged: req.bootstrap });
  });

  app.get('/api/admin/users', (req, res) => { requireAdmin(req.user); res.json({ users: state.users.map(managedUser) }); });
  app.post('/api/admin/users', async (req, res) => {
    requireAdmin(req.user);
    if (req.body.role !== undefined || req.body.isOwner !== undefined || req.body.canUseCodex !== undefined) throw failure(400, '新账号只能是普通成员。');
    const name = username(req.body.username), displayName = string(req.body.displayName ?? name, '显示名称', 64);
    const grants = providerIds(req.body.providerIds ?? []), agentAccess = normalizeAgentAccess(req.body.agentAccess ?? 'none'), password = await hashPassword(req.body.password);
    requireCurrentAuth(req); providerIds(grants);
    if (state.users.length >= 100) throw failure(400, '最多保存 100 个账号。');
    if (state.users.some(user => user.username === name)) throw failure(409, '这个账号名称已被使用。');
    const user = { id: randomUUID(), username: name, displayName, role: 'member', agentAccess, disabled: false, providerIds: grants, password, settings: defaultSettings(), voice: defaultVoiceSettings(), createdAt: now() };
    state.users.push(user); await store.save(); res.status(201).json({ user: managedUser(user) });
  });
  app.patch('/api/admin/users/:id', async (req, res) => {
    requireAdmin(req.user);
    const user = state.users.find(item => item.id === req.params.id); if (!user) throw failure(404, '账号不存在。');
    if (req.body.role !== undefined || req.body.username !== undefined || req.body.isOwner !== undefined || req.body.canUseCodex !== undefined) throw failure(400, '账号角色和身份不可修改。');
    const patch = {};
    if (req.body.displayName !== undefined) patch.displayName = string(req.body.displayName, '显示名称', 64);
    if (req.body.disabled !== undefined) {
      if (typeof req.body.disabled !== 'boolean') throw failure(400, '账号停用状态无效。');
      if (isOwner(user) && req.body.disabled) throw failure(400, '不能停用主机 owner。');
      patch.disabled = req.body.disabled;
    }
    if (req.body.providerIds !== undefined) { const grants = providerIds(req.body.providerIds); if (!isOwner(user)) patch.providerIds = grants; }
    if (req.body.agentAccess !== undefined) { patch.agentAccess = normalizeAgentAccess(req.body.agentAccess); if (isOwner(user) && patch.agentAccess !== 'full') throw failure(400, '主机 owner 的 Agent 权限不可降级。'); }
    if (req.body.password !== undefined) patch.password = await hashPassword(req.body.password);
    requireCurrentAuth(req);
    if (patch.providerIds !== undefined) providerIds(patch.providerIds);
    const rank = { none: 0, workspace: 1, full: 2 };
    const revoked = patch.password !== undefined || patch.disabled === true || (patch.agentAccess !== undefined && rank[patch.agentAccess] < rank[user.agentAccess]) || (patch.providerIds !== undefined && user.providerIds.some(id => !patch.providerIds.includes(id)));
    Object.assign(user, patch);
    const settings = settingsFor(user);
    if (settings.defaultProviderId && !canUseProvider(user, settings.defaultProviderId)) settings.defaultProviderId = null;
    if (revoked) state.sessions = state.sessions.filter(session => session.userId !== user.id);
    if (revoked) await stopTasks(task => task.userId === user.id);
    await store.save(); res.json({ user: managedUser(user) });
  });
  app.get('/api/voice', (req, res) => res.json(publicVoiceSettings(req.user.voice)));
  app.patch('/api/voice', async (req, res) => {
    patchVoiceSettings(req.user.voice, req.body);
    await stopTasks(task => task.mode === 'voice' && task.userId === req.user.id);
    requireCurrentAuth(req);
    const updated = patchVoiceSettings(req.user.voice, req.body);
    req.user.voice = updated; await store.save(); res.json(publicVoiceSettings(updated));
  });
  app.get('/api/voice/cosyvoice', (req, res) => res.json(cosyvoice.publicConfig(isOwner(req.user))));
  app.patch('/api/voice/cosyvoice', async (req, res) => {
    requireAdmin(req.user);
    try { const value = await cosyvoice.configure(req.body, { authorize: () => requireCurrentAuth(req) }); requireCurrentAuth(req); res.json(value); }
    catch (error) { const safe = safeCosyVoiceError(error); res.status(safe.status).json({ error: safe.message }); }
  });
  app.post('/api/voice/cosyvoice/reference', (req, res, next) => {
    requireAdmin(req.user);
    if (req.headers['content-type']?.toLowerCase() !== 'audio/wav') throw failure(415, '参考音频上传只接受 audio/wav。');
    next();
  }, express.raw({ type: 'audio/wav', limit: REFERENCE_LIMIT, inflate: false }), async (req, res) => {
    const controller = new AbortController(); let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const probe = { controller, done, userId: req.user.id, sessionHash: req.sessionHash, mode: 'voice' }; probes.add(probe);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const authorize = () => { requireCurrentAuth(req); controller.signal.throwIfAborted(); };
    try { authorize(); const value = await cosyvoice.setReference(req.body, { authorize }); authorize(); res.json(value); }
    catch (error) { const safe = safeCosyVoiceError(error); if (!res.destroyed) res.status(safe.status).json({ error: safe.message }); }
    finally { probes.delete(probe); finish(); }
  });
  app.post('/api/voice/synthesize', async (req, res) => {
    if (Object.keys(req.body).some(key => key !== 'text') || typeof req.body.text !== 'string') throw failure(400, '语音合成只接受 text 字段。');
    if (req.user.voice.tts.mode !== 'cosyvoice') throw failure(409, '请先为当前账号选择并保存 CosyVoice 朗读。');
    const controller = new AbortController(); let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const probe = { controller, done, userId: req.user.id, sessionHash: req.sessionHash, mode: 'voice' }; probes.add(probe);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      requireCurrentAuth(req);
      const audio = await cosyvoice.synthesize({ userId: req.user.id, text: req.body.text, speed: req.user.voice.tts.speed, signal: controller.signal });
      requireCurrentAuth(req); controller.signal.throwIfAborted();
      res.status(200).set({ 'Content-Type': 'audio/wav', 'Content-Length': String(audio.length), 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="speech.wav"' }).send(audio);
    } catch (error) { const safe = safeCosyVoiceError(error); if (!res.destroyed) res.status(safe.status).json({ error: safe.message }); }
    finally { probes.delete(probe); finish(); }
  });

  app.get('/api/updates/config', (req, res) => res.json(updates.statusConfig()));
  app.patch('/api/updates/config', async (req, res) => {
    requireAdmin(req.user);
    const result = await updates.configure(req.body);
    requireCurrentAuth(req); res.json(result);
  });
  app.post('/api/updates/check', async (req, res) => {
    if (Object.keys(req.body).some(key => !['target', 'currentVersion'].includes(key))) throw failure(400, '更新检查只接受平台和当前版本。');
    const controller = new AbortController();
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const probe = { controller, done, userId: req.user.id, sessionHash: req.sessionHash, mode: 'updates' }; probes.add(probe);
    res.on('close', () => { if (!res.writableEnded) controller.abort(new DOMException('更新检查已取消。', 'AbortError')); });
    try {
      requireCurrentAuth(req);
      const result = await updates.check({ ...req.body, signal: controller.signal });
      requireCurrentAuth(req); controller.signal.throwIfAborted(); res.json(result);
    } catch (error) {
      if (!res.destroyed) res.status(error.status ?? (controller.signal.aborted ? 409 : 502)).json({ error: controller.signal.aborted ? '更新检查已停止。' : String(error.message).slice(0, 300) });
    } finally { probes.delete(probe); finish(); }
  });

  app.get('/api/state', async (req, res) => { const value = await publicState(req.user); requireCurrentAuth(req); res.json(value); });
  app.patch('/api/settings', async (req, res) => {
    const patch = {};
    if (req.body?.petName !== undefined) patch.petName = string(req.body.petName, '桌宠名字', 64);
    if (req.body?.persona !== undefined) patch.persona = string(req.body.persona, '陪伴设定', 16000);
    if (req.body?.companionKind !== undefined) {
      if (!isCompanionKind(req.body.companionKind)) throw failure(400, '陪伴形象必须是 anime 或 cat。');
      patch.companionKind = req.body.companionKind;
    }
    if (req.body?.defaultProviderId !== undefined) {
      const id = req.body.defaultProviderId === null || req.body.defaultProviderId === '' ? null : string(req.body.defaultProviderId, '默认模型', 128);
      if (id) providerById(id, req.user);
      patch.defaultProviderId = id;
    }
    Object.assign(settingsFor(req.user), patch); await store.save(); res.json(settingsFor(req.user));
  });
  app.post('/api/providers', async (req, res) => {
    requireAdmin(req.user);
    const body = req.body ?? {};
    const existing = body.id === undefined ? undefined : providerById(string(body.id, '连接 ID', 128), req.user);
    if (!existing && state.providers.length >= 32) throw failure(400, '最多保存 32 个模型连接。');
    const protocol = body.protocol ?? existing?.protocol;
    if (!['chat-completions', 'responses'].includes(protocol)) throw failure(400, '协议必须是 chat-completions 或 responses。');
    let baseUrl, reasoningEffort;
    try {
      baseUrl = normalizeBaseUrl(string(body.baseUrl ?? existing?.baseUrl, '服务地址', 2048), protocol);
      reasoningEffort = normalizeReasoningEffort(body.reasoningEffort === undefined ? existing?.reasoningEffort : body.reasoningEffort);
    } catch (error) { throw failure(400, error.message); }
    if (body.apiKey !== undefined && (typeof body.apiKey !== 'string' || body.apiKey.length > 8192 || /[\r\n]/.test(body.apiKey))) throw failure(400, 'API Key 格式无效。');
    // A key is tied to the endpoint it was entered for. Do not silently forward it to a new URL.
    if (existing?.apiKey && baseUrl !== existing.baseUrl && !body.apiKey?.trim()) throw failure(400, '服务地址变化时请重新填写 API Key，避免将原密钥发送给另一服务。');
    const provider = { id: existing?.id ?? randomUUID(), name: string(body.name ?? existing?.name, '连接名称', 80), protocol, baseUrl, model: string(body.model ?? existing?.model, '模型 ID', 160), reasoningEffort, apiKey: body.apiKey?.trim() || existing?.apiKey || '' };
    if (existing) state.providers.splice(state.providers.indexOf(existing), 1, provider); else state.providers.push(provider);
    await store.save(); res.json(visibleProvider(provider, req.user));
  });
  app.delete('/api/providers/:id', async (req, res) => {
    requireAdmin(req.user);
    const provider = providerById(req.params.id, req.user);
    if ([...active.values()].some(task => task.providerId === provider.id)) throw failure(409, '此模型正在回复，请先停止。');
    state.providers.splice(state.providers.indexOf(provider), 1);
    const affected = new Set(state.users.filter(user => !isOwner(user) && user.providerIds.includes(provider.id)).map(user => user.id));
    for (const user of state.users) {
      user.providerIds = user.providerIds.filter(id => id !== provider.id);
      if (settingsFor(user).defaultProviderId === provider.id) settingsFor(user).defaultProviderId = null;
    }
    state.sessions = state.sessions.filter(session => !affected.has(session.userId));
    await stopTasks(task => affected.has(task.userId));
    await store.save(); res.json({ ok: true });
  });
  app.post('/api/providers/:id/test', async (req, res) => {
    const provider = providerById(req.params.id, req.user); const controller = new AbortController();
    const probe = { controller, userId: req.user.id, sessionHash: req.sessionHash, providerId: provider.id }; probes.add(probe);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try { res.json(await testProvider(provider, controller.signal)); }
    catch (error) { if (!res.destroyed) res.status(502).json({ ok: false, message: error.message }); }
    finally { probes.delete(probe); }
  });
  app.post('/api/conversations', async (req, res) => {
    const { mode = 'chat' } = req.body ?? {};
    const providerId = req.body?.providerId ?? settingsFor(req.user).defaultProviderId;
    if (!['chat', 'codex'].includes(mode)) throw failure(400, '会话模式无效。');
    if (mode === 'codex') { requireCodex(req.user); if (configChanging) throw failure(409, 'Codex 配置正在切换，请稍后重试。'); }
    if (state.conversations.filter(item => item.userId === req.user.id).length >= 200) throw failure(400, '最多保存 200 个会话，请先删除旧会话。');
    if (mode === 'chat' && providerId !== undefined && providerId !== null && providerId !== '') providerById(providerId, req.user);
    const conversation = { id: randomUUID(), userId: req.user.id, title: mode === 'codex' ? '新的工作会话' : '新的聊天', mode, providerId: mode === 'chat' ? providerId || null : null, messages: [], createdAt: now(), updatedAt: now(), ...(mode === 'codex' ? { codexRevision: state.codexConfig.revision } : {}) };
    state.conversations.unshift(conversation); await store.save(); res.status(201).json(visibleConversation(conversation));
  });
  app.get('/api/conversations/:id', (req, res) => res.json(visibleConversation(conversationById(req.params.id, req.user))));
  app.patch('/api/conversations/:id', async (req, res) => {
    const conversation = conversationById(req.params.id, req.user); assertIdle(conversation.id);
    if (conversation.mode !== 'chat') throw failure(400, 'Codex 工作会话不能切换聊天模型。');
    if (Object.keys(req.body).some(key => key !== 'providerId')) throw failure(400, '会话更新只接受 providerId 字段。');
    const provider = providerById(string(req.body.providerId, '模型连接', 128), req.user);
    conversation.providerId = provider.id; conversation.updatedAt = now();
    await store.save(); res.json(visibleConversation(conversation));
  });
  app.delete('/api/conversations/:id', async (req, res) => {
    const conversation = conversationById(req.params.id, req.user); assertIdle(conversation.id);
    if (conversation.mode === 'codex') await agentTasks.stop(conversation, { clear: true });
    state.conversations.splice(state.conversations.indexOf(conversation), 1); await store.save(); res.json({ ok: true });
  });
  app.post('/api/conversations/:id/stop', async (req, res) => {
    const conversation = conversationById(req.params.id, req.user); const task = active.get(req.params.id);
    if (conversation.mode === 'codex') { await agentTasks.stop(conversation); res.json({ ok: true, stopped: Boolean(task), conversation: visibleConversation(conversation) }); return; }
    task?.controller.abort(new DOMException('用户已停止生成。', 'AbortError'));
    if (task) await task.done;
    res.json({ ok: true, stopped: Boolean(task) });
  });
  app.get('/api/codex/config', (req, res) => { requireCodex(req.user); res.json(publicCodexConfig(state.codexConfig)); });
  app.patch('/api/codex/config', async (req, res) => {
    requireAdmin(req.user);
    if (configChanging || codexReaders || agentTasks.hasPending() || [...active.values()].some(task => task.mode === 'codex')) throw failure(409, 'Codex 正在工作或队列未清空，请先停止任务后再修改配置。');
    const previous = state.codexConfig, next = patchCodexConfig(previous, req.body, codexPolicy);
    if (next.revision === previous.revision) return res.json(publicCodexConfig(previous));
    configChanging = true;
    configSwap = (async () => {
      let replacement;
      try {
        await bridge.close();
        requireCurrentAuth(req);
        if (shuttingDown) throw failure(503, '服务正在退出。');
        replacement = createBridge(next);
        state.codexConfig = next;
        await store.save();
        bridge = replacement;
      } catch (error) {
        state.codexConfig = previous;
        await replacement?.close();
        if (!shuttingDown) bridge = createBridge(previous);
        throw error;
      } finally { configChanging = false; }
    })();
    await configSwap;
    requireCurrentAuth(req);
    res.json(publicCodexConfig(state.codexConfig));
  });
  app.get('/api/codex/status', async (req, res) => { requireCodex(req.user); const value = await userCodexStatus(req.user); requireCurrentAuth(req); requireCodex(req.user); res.json(value); });
  app.get('/api/desktop-tools/status', async (req, res) => { requireAdmin(req.user); const value = await localTools.status(); requireCurrentAuth(req); res.json(redactCodex(value)); });
  app.post('/api/desktop-tools/action', async (req, res) => {
    requireAdmin(req.user);
    if (Object.keys(req.body).some(key => !['tool', 'arguments'].includes(key)) || typeof req.body.tool !== 'string' || !req.body.arguments || typeof req.body.arguments !== 'object' || Array.isArray(req.body.arguments)) throw failure(400, '桌面工具请求格式无效。');
    try { localTools.describe(req.body.tool, req.body.arguments); } catch (error) { throw failure(400, redactCodex(error.message)); }
    const controller = new AbortController();
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const probe = { controller, done, userId: req.user.id, sessionHash: req.sessionHash, mode: 'desktop' }; probes.add(probe);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      requireCurrentAuth(req); controller.signal.throwIfAborted();
      const value = await localTools.execute(req.body.tool, req.body.arguments, { signal: controller.signal });
      requireCurrentAuth(req); controller.signal.throwIfAborted();
      res.json(redactCodex(value));
    } catch (error) {
      if (!res.destroyed) res.status(error.status ?? 502).json({ error: redactCodex(controller.signal.aborted ? '操作已停止。' : String(error.message)).slice(0, 500) });
    } finally { probes.delete(probe); finish(); }
  });
  app.post('/api/codex/approvals/:id', async (req, res) => {
    requireCodex(req.user);
    const approval = approvals.get(req.params.id);
    if (!approval || approval.userId !== req.user.id || active.get(approval.conversationId) !== approval.task || approval.task.controller.signal.aborted) throw failure(404, '审批请求不存在或已过期。');
    if (!['accept', 'decline'].includes(req.body?.decision)) throw failure(400, '审批决定无效。');
    try { const result = await bridge.approve(req.params.id, req.body.decision); approvals.delete(req.params.id); res.json(result); }
    catch (error) { throw failure(409, error.message); }
  });

  const agentConversation = req => {
    requireCurrentAuth(req); requireCodex(req.user);
    const conversation = conversationById(req.params.id, req.user);
    if (conversation.mode !== 'codex') throw failure(400, '只有 Agent 会话可使用任务队列。');
    if (conversation.codexRevision !== state.codexConfig.revision) throw failure(409, 'Agent 配置已变化，请新建会话。');
    return conversation;
  };
  const agentAuth = req => ({ userId: req.user.id, sessionHash: req.sessionHash, bootstrap: req.bootstrap });
  for (const kind of ['submit', 'steer']) app.post(`/api/conversations/:id/agent/${kind}`, async (req, res) => {
    const conversation = agentConversation(req);
    const submission = await agentTasks.submit(conversation, req.body, agentAuth(req), kind);
    requireCurrentAuth(req); requireCodex(req.user);
    res.status(200).json({ conversation: visibleConversation(conversation), submission });
  });
  for (const method of ['patch', 'delete']) app[method]('/api/conversations/:id/agent/queue/:entryId', async (req, res) => {
    const conversation = agentConversation(req);
    await agentTasks.edit(conversation, req.params.entryId, req.body, agentAuth(req), method === 'delete');
    requireCurrentAuth(req); res.json({ conversation: visibleConversation(conversation) });
  });
  app.post('/api/conversations/:id/agent/queue/resume', async (req, res) => {
    const conversation = agentConversation(req);
    if (Object.keys(req.body).length) throw failure(400, '恢复队列不接受权限或内容覆盖。');
    await agentTasks.resume(conversation, agentAuth(req)); requireCurrentAuth(req);
    res.json({ conversation: visibleConversation(conversation) });
  });

  app.post('/api/conversations/:id/messages', async (req, res) => {
    const conversation = conversationById(req.params.id, req.user); assertIdle(conversation.id);
    if (conversation.mode === 'codex') {
      requireCodex(req.user);
      if (configChanging) throw failure(409, 'Codex 配置正在切换，请稍后重试。');
      if (conversation.codexRevision !== state.codexConfig.revision) throw failure(409, 'Codex 配置已变化；为避免跨接口或凭据恢复旧任务，请新建工作会话。');
    }
    const content = string(req.body?.content, '消息', 32000);
    if (conversation.messages.length >= 500) throw failure(400, '这个会话已达到 500 条消息，请创建新会话。');
    const provider = conversation.mode === 'chat' ? providerById(conversation.providerId, req.user) : null;
    const history = conversation.messages.filter(message => message.role === 'user' || message.status === 'complete');
    if (history.reduce((total, message) => total + message.content.length, content.length) > 300000) throw failure(400, '这个会话上下文过长，请创建新会话。');
    const controller = new AbortController();
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const task = { controller, done, mode: conversation.mode, userId: req.user.id, sessionHash: req.sessionHash, providerId: provider?.id ?? null, approvalIds: new Set() };
    active.set(conversation.id, task);
    const user = { id: randomUUID(), role: 'user', content, status: 'complete', createdAt: now() };
    const assistant = { id: randomUUID(), role: 'assistant', content: '', status: 'streaming', createdAt: now(), ...(provider ? { model: provider.model } : {}) };
    if (!conversation.messages.length) conversation.title = content.slice(0, 32);
    conversation.messages.push(user, assistant); conversation.updatedAt = now();
    let heartbeat;
    let persistedChars = 0; let persistedAt = Date.now(); let persistenceError;
    const send = (event, data) => {
      if (!res.destroyed && !res.writableEnded) {
        // A paused client must not grow server memory without bound.
        if (res.writableLength > 2 * 1024 * 1024) { controller.abort(new Error('客户端读取过慢，已停止生成。')); return; }
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };
    const onEvent = (event, data) => {
      if (controller.signal.aborted) return;
      if (event === 'thread') { conversation.threadId = data.threadId; return; }
      if (event === 'approval' && typeof data?.id === 'string') {
        approvals.set(data.id, { userId: req.user.id, conversationId: conversation.id, task, kind: data.kind, description: data.description }); task.approvalIds.add(data.id);
      }
      if (event === 'delta') {
        if (typeof data?.text !== 'string') return;
        if (assistant.content.length + data.text.length > 2 * 1024 * 1024) { controller.abort(new Error('回复超过 2 MiB 限制。')); return; }
        assistant.content += data.text;
        if (assistant.content.length - persistedChars > 16000 || Date.now() - persistedAt > 1500) {
          persistedChars = assistant.content.length; persistedAt = Date.now();
          store.save().catch(error => { persistenceError = error; controller.abort(new Error('保存会话失败，已停止生成。')); });
        }
      }
      if (['delta', 'status', 'approval'].includes(event)) send(event, data);
    };
    res.on('close', () => { if (!res.writableEnded) controller.abort(new DOMException('客户端已断开连接。', 'AbortError')); });
    try {
      await store.save();
      if (controller.signal.aborted) throw controller.signal.reason;
      res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders(); send('meta', { conversationId: conversation.id });
      heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000); heartbeat.unref();
      const result = conversation.mode === 'codex'
        ? await bridge.run({ conversationId: conversation.id, permissions: requirePermissions(req.user), prompt: content, threadId: conversation.threadId, signal: controller.signal, onEvent })
        : await streamProvider({ provider, messages: [...history, user], persona: settingsFor(req.user).persona, signal: controller.signal, onEvent });
      controller.signal.throwIfAborted();
      if (result.threadId) conversation.threadId = result.threadId;
      if (!assistant.content && result.text) { assistant.content = result.text; send('delta', { text: result.text }); }
      assistant.status = 'complete'; conversation.updatedAt = now();
      await store.save(); send('done', { conversation: visibleConversation(conversation) });
    } catch (error) {
      assistant.status = controller.signal.aborted && controller.signal.reason?.name === 'AbortError' ? 'cancelled' : 'error';
      assistant.error = persistenceError ? '保存会话失败，请检查数据目录和磁盘空间。' : String(error?.message ?? '回复失败。').slice(0, 500);
      if (provider?.apiKey) assistant.error = assistant.error.split(provider.apiKey).join('[redacted]');
      assistant.error = redactCodex(assistant.error);
      conversation.updatedAt = now();
      try { await store.save(); } catch { assistant.error = '会话保存失败，请检查数据目录和磁盘空间。'; }
      if (res.headersSent) send('error', { message: assistant.error, conversation: visibleConversation(conversation) });
      else if (!res.destroyed) res.status(500).json({ error: assistant.error });
    } finally {
      clearInterval(heartbeat); active.delete(conversation.id); finish();
      for (const id of task.approvalIds) if (approvals.get(id)?.task === task) approvals.delete(id);
      if (!res.writableEnded) res.end();
      if (conversation.mode === 'codex') agentTasks.kick(conversation);
    }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在。' }));
  if (staticDir) {
    const directory = path.resolve(staticDir);
    app.use(express.static(directory, { dotfiles: 'deny', index: 'index.html' }));
    app.get('/{*splat}', (req, res, next) => { res.sendFile(path.join(directory, 'index.html'), error => error && next(error)); });
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status ?? (error.type === 'entity.too.large' ? 413 : 500);
    res.status(status).json({ error: status >= 500 ? '服务暂时无法完成请求，请检查后台和数据目录。' : error.type === 'entity.parse.failed' ? '请求 JSON 格式无效。' : error.message });
  });
  const server = http.createServer(app);
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  let closing;
  const close = () => closing ??= (async () => {
    shuttingDown = true;
    const httpClosed = server.listening ? new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections();
    }) : Promise.resolve();
    for (const probe of probes) probe.controller.abort(new DOMException('服务正在退出。', 'AbortError'));
    for (const task of active.values()) task.controller.abort(new DOMException('服务正在退出。', 'AbortError'));
    if (configSwap) await configSwap.catch(() => {});
    const results = await Promise.allSettled([agentTasks.close(), bridge.close(), localTools.close(), updates.close(), cosyvoice.close(), ...[...active.values(), ...probes].map(task => task.done)]);
    let saveError;
    try { await store.queue; } catch (error) { saveError = error; }
    finally { server.closeAllConnections(); await httpClosed; }
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    if (saveError) throw saveError;
  })();
  return { server, token: accessToken, close, updates };
}
