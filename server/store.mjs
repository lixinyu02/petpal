import { mkdir, readFile, rename, writeFile, chmod, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { defaultVoiceSettings } from './voice.mjs';
import { normalizeReasoningEffort, normalizeSupportsImages } from './providers.mjs';
import { validateStoredAttachments, normalizeAttachmentIds } from './attachments.mjs';
import { restoreAgentState } from './agent-tasks.mjs';
import { validateExecutionHosts } from './executors.mjs';
import { restoreAssistantTasks } from './chat-assistant.mjs';
import { validateStoredNotifications } from './notifications.mjs';
import { validateStoredAutomations } from './automation-schema.mjs';
import { validateStoredOrganization, createOrganizationPersistence } from './conversation-organization.mjs';

export const isCompanionKind = value => value === 'anime' || value === 'cat';
const isChatAssistantHostId = value => value === null || typeof value === 'string' && (value === 'central' || /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value));

export const defaultSettings = () => ({ petName: '小伴', companionKind: 'anime', persona: '你是小伴，一位温柔、好奇的个人 AI 伙伴。用自然简洁的中文陪伴用户，诚实回答问题，不假装已经执行没有执行的操作。', defaultProviderId: null, chatAssistantHostId: null });
const owner = () => ({ id: randomUUID(), username: 'owner', displayName: '主机管理员', role: 'admin', agentAccess: 'full', disabled: false, providerIds: [], password: null, voice: defaultVoiceSettings(), createdAt: new Date().toISOString() });
const initialState = () => {
  const user = owner();
  // Keep the owner's legacy top-level profile and history layout for lossless migration.
  return { version: 2, instanceId: randomUUID(), ownerId: user.id, users: [user], sessions: [], settings: defaultSettings(), providers: [], conversations: [] };
};

export class JsonStore {
  #chatAssistantHosts = null;

  constructor(directory) { this.directory = path.resolve(directory); this.file = path.join(this.directory, 'state.json'); this.queue = Promise.resolve(); }

  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let raw;
    try {
      raw = await readFile(this.file, 'utf8');
      if (raw.length > 64 * 1024 * 1024) throw new Error('本地历史文件过大，请先备份后整理。');
      this.state = JSON.parse(raw);
      if (![1, 2].includes(this.state.version) || !Array.isArray(this.state.providers) || !Array.isArray(this.state.conversations) || !this.state.settings || typeof this.state.settings !== 'object' || Array.isArray(this.state.settings)) throw new Error('本地数据格式不受支持；请保留文件并检查备份。');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = initialState();
      await this.save();
    }
    let changed = false;
    // Validate before backing up or replacing a legacy store.
    for (const provider of this.state.providers) {
      if (!provider || typeof provider !== 'object' || Array.isArray(provider)) throw new Error('本地模型连接格式无效，请保留文件并检查备份。');
      const effort = normalizeReasoningEffort(provider.reasoningEffort);
      if (provider.reasoningEffort === undefined) { provider.reasoningEffort = effort; changed = true; }
      const supportsImages = normalizeSupportsImages(provider.supportsImages, provider.model);
      if (provider.supportsImages !== supportsImages) { provider.supportsImages = supportsImages; changed = true; }
    }
    if (this.state.settings.companionKind === undefined) { this.state.settings.companionKind = 'anime'; changed = true; }
    else if (!isCompanionKind(this.state.settings.companionKind)) throw new Error('本地 companionKind 无效，必须是 anime 或 cat；请保留文件并检查备份。');
    if (this.state.version === 1) {
      const backup = path.join(this.directory, `state.v1.backup-${createHash('sha256').update(raw).digest('hex').slice(0, 16)}.json`);
      try {
        const handle = await open(backup, 'wx', 0o600);
        try { await handle.writeFile(raw, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      }
      catch (error) { if (error.code !== 'EEXIST' || await readFile(backup, 'utf8') !== raw) throw error; }
      const migratedOwner = owner();
      Object.assign(this.state, { version: 2, instanceId: randomUUID(), ownerId: migratedOwner.id, users: [migratedOwner], sessions: [] });
      for (const conversation of this.state.conversations) conversation.userId = migratedOwner.id;
      changed = true;
    }
    const state = this.state;
    const validText = value => typeof value === 'string' && value.length > 0;
    if (!validText(state.instanceId) || !validText(state.ownerId) || !Array.isArray(state.users) || !state.users.length || !Array.isArray(state.sessions)) throw new Error('本地用户数据格式无效，请保留文件并检查备份。');
    const ids = new Set(), names = new Set();
    for (const user of state.users) {
      if (!validText(user.id) || ids.has(user.id) || !/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(user.username) || names.has(user.username) || !validText(user.displayName) || !['admin', 'member'].includes(user.role) || typeof user.disabled !== 'boolean' || !Array.isArray(user.providerIds) || user.providerIds.some(id => !validText(id))) throw new Error('本地用户记录无效，请保留文件并检查备份。');
      ids.add(user.id); names.add(user.username);
      if (user.id !== state.ownerId && user.role !== 'member') throw new Error('仅主机 owner 可拥有管理员权限。');
      if (user.agentAccess === undefined) { user.agentAccess = user.id === state.ownerId ? 'full' : 'none'; changed = true; }
      if (!['none', 'workspace', 'full'].includes(user.agentAccess) || (user.id === state.ownerId && user.agentAccess !== 'full')) throw new Error('本地 Agent 授权无效。');
      const settings = user.id === state.ownerId ? state.settings : user.settings;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('本地用户设置无效。');
      if (settings.companionKind === undefined) { settings.companionKind = 'anime'; changed = true; }
      else if (!isCompanionKind(settings.companionKind)) throw new Error('本地 companionKind 无效，必须是 anime 或 cat；请保留文件并检查备份。');
      if (settings.defaultProviderId === undefined) { settings.defaultProviderId = null; changed = true; }
      if (settings.chatAssistantHostId === undefined) { settings.chatAssistantHostId = null; changed = true; }
      else if (!isChatAssistantHostId(settings.chatAssistantHostId)) throw new Error('本地 Chat + Agent 默认执行电脑格式无效。');
      if (!user.voice) { user.voice = defaultVoiceSettings(); changed = true; }
    }
    const principal = state.users.find(user => user.id === state.ownerId);
    if (!principal || principal.disabled || principal.role !== 'admin') throw new Error('本地主机 owner 无效，不能停用或降权。');
    if (state.sessions.some(session => !ids.has(session.userId) || !/^[a-f0-9]{64}$/.test(session.tokenHash) || !Number.isFinite(session.expiresAt))) throw new Error('本地登录会话数据无效。');
    if (validateStoredAttachments(state)) changed = true;
    if (validateExecutionHosts(state)) changed = true;
    for (const user of state.users) {
      const id = (user.id === state.ownerId ? state.settings : user.settings).chatAssistantHostId;
      if (id !== null && id !== 'central' && !state.executionHosts.some(host => host.id === id && host.userId === user.id)) throw new Error('本地 Chat + Agent 默认执行电脑归属无效。');
    }
    for (const conversation of this.state.conversations) {
      if (!ids.has(conversation.userId)) throw new Error('本地会话缺少有效用户归属，已停止加载。');
      for (const hostId of [conversation.agentHostId, conversation.threadHostId, conversation.agent?.run?.hostId, ...(conversation.agent?.queue ?? []).map(entry => entry.hostId)]) {
        if (hostId !== undefined && hostId !== 'central' && !state.executionHosts.some(host => host.id === hostId && host.userId === conversation.userId)) throw new Error('本地会话执行电脑归属无效。');
      }
      if (restoreAgentState(conversation)) changed = true;
      if (restoreAssistantTasks(conversation, state.executionHosts, state.conversations)) changed = true;
      for (const entry of conversation.agent?.queue ?? []) for (const id of normalizeAttachmentIds(entry.attachmentIds)) if (!state.attachments.some(item => item.id === id && item.userId === conversation.userId)) throw new Error('本地 Agent 图片归属无效。');
      for (const entry of conversation.agent?.submissions ?? []) for (const id of normalizeAttachmentIds(entry.attachmentIds)) if (!state.attachments.some(item => item.id === id && item.userId === conversation.userId)) throw new Error('本地 Agent 回执图片归属无效。');
      for (const message of conversation.messages ?? []) {
        if (message.attachmentIds !== undefined) for (const id of normalizeAttachmentIds(message.attachmentIds)) if (!state.attachments.some(item => item.id === id && item.userId === conversation.userId)) throw new Error('本地消息图片归属无效。');
        if (message.status === 'streaming') { message.status = 'error'; message.error = '服务上次退出时回复尚未完成，可以重新发送。'; changed = true; }
      }
    }
    if (validateStoredNotifications(state)) changed = true;
    if (validateStoredAutomations(state)) changed = true;
    if (validateStoredOrganization(state)) changed = true;
    this.organizationPersistence = createOrganizationPersistence(this);
    this.#chatAssistantHosts = new Map(state.users.map(user => [user.id, (user.id === state.ownerId ? state.settings : user.settings).chatAssistantHostId]));
    if (changed) await this.save();
    return this;
  }

  #prepareChatAssistantHosts(snapshot, action) {
    for (const user of snapshot.users) {
      const settings = user.id === snapshot.ownerId ? snapshot.settings : user.settings;
      // Merge at queue execution, rather than capture time. Other saves may
      // have captured the previous target while an explicit change was queued.
      settings.chatAssistantHostId = this.#chatAssistantHosts?.has(user.id) ? this.#chatAssistantHosts.get(user.id) : settings.chatAssistantHostId ?? null;
    }
    if (action === undefined) return;
    if (!action || typeof action !== 'object' || Array.isArray(action) || Object.keys(action).some(key => !['userId', 'hostId', 'authorize'].includes(key)) || typeof action.userId !== 'string' || !isChatAssistantHostId(action.hostId) || action.authorize !== undefined && typeof action.authorize !== 'function') throw new Error('默认执行电脑持久化操作无效。');
    action.authorize?.();
    const user = snapshot.users.find(item => item.id === action.userId);
    if (!user || !this.state.users.some(item => item.id === action.userId) || action.hostId !== null && action.hostId !== 'central' && !snapshot.executionHosts.some(host => host.id === action.hostId && host.userId === action.userId)) throw new Error('默认执行电脑持久化归属无效。');
    (user.id === snapshot.ownerId ? snapshot.settings : user.settings).chatAssistantHostId = action.hostId;
  }

  #commitChatAssistantHosts(snapshot) {
    this.#chatAssistantHosts = new Map(snapshot.users.map(user => [user.id, (user.id === snapshot.ownerId ? snapshot.settings : user.settings).chatAssistantHostId]));
    for (const user of this.state.users) {
      if (this.#chatAssistantHosts.has(user.id)) (user.id === this.state.ownerId ? this.state.settings : user.settings).chatAssistantHostId = this.#chatAssistantHosts.get(user.id);
    }
  }

  save(operation) {
    // Capture the state now. Serial atomic replacements prevent older writes winning.
    const captured = JSON.stringify(this.state);
    const task = this.queue.catch(() => {}).then(async () => {
      // Extensions merge against their last committed data inside this queue.
      // An unrelated concurrent save cannot capture an undurable event or
      // overwrite a newly committed feed with an older in-memory copy.
      const snapshot = JSON.parse(captured);
      this.organizationPersistence?.prepare(snapshot, operation?.organization);
      this.#prepareChatAssistantHosts(snapshot, operation?.chatAssistantDefaultHost);
      this.notificationPersistence?.prepare(snapshot, operation);
      await this.automationPersistence?.prepare(snapshot, operation);
      const contents = `${JSON.stringify(snapshot, null, 2)}\n`;
      const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(contents, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        await chmod(temporary, 0o600).catch(error => { if (process.platform !== 'win32') throw error; });
        this.organizationPersistence?.beforeCommit(snapshot);
        await rename(temporary, this.file);
        // Only an atomically replaced file can become the public default.
        this.#commitChatAssistantHosts(snapshot);
        this.organizationPersistence?.commit(snapshot);
        this.automationPersistence?.commit(snapshot.automations, snapshot);
        this.notificationPersistence?.commit(snapshot.notifications);
      } finally { await unlink(temporary).catch(() => {}); }
    });
    this.queue = task;
    return task;
  }

  async token(explicit) {
    if (explicit !== undefined) {
      if (typeof explicit !== 'string' || !explicit.trim() || explicit.length > 4096 || /[\r\n]/.test(explicit)) throw new Error('配对令牌格式无效。');
      return explicit;
    }
    const filename = path.join(this.directory, 'token');
    try {
      const value = (await readFile(filename, 'utf8')).trim();
      if (value.length < 32) throw new Error('本地配对令牌文件无效，请检查文件。');
      return value;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const value = randomBytes(32).toString('base64url');
      await writeFile(filename, `${value}\n`, { mode: 0o600, flag: 'wx' });
      return value;
    }
  }
}

export function publicProvider(provider) {
  return { id: provider.id, name: provider.name, protocol: provider.protocol, baseUrl: provider.baseUrl, model: provider.model, reasoningEffort: normalizeReasoningEffort(provider.reasoningEffort), supportsImages: normalizeSupportsImages(provider.supportsImages, provider.model), hasApiKey: Boolean(provider.apiKey) };
}
