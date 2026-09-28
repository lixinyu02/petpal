import { createHash, randomUUID } from 'node:crypto';
import { normalizeAgentPermissions } from './agent-permissions.mjs';
import { normalizeAttachmentIds } from './attachments.mjs';

const failure = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const now = () => new Date().toISOString();
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
const empty = () => ({ revision: 0, paused: false, queue: [], run: null, submissions: [] });
const content = (value, images = []) => {
  if ((value !== undefined && typeof value !== 'string') || (value?.length ?? 0) > 32000 || (!value?.trim() && !images.length)) throw failure(400, 'Agent 消息需要文字或图片，文字最多 32000 个字符。');
  return value?.trim() ?? '';
};
const attachments = normalizeAttachmentIds;
const publicEntry = entry => ({ id: entry.id, submissionId: entry.submissionId, revision: entry.revision, content: entry.content, attachmentIds: [...entry.attachmentIds], permissions: { ...entry.permissions }, providerId: entry.providerId, model: entry.model, effort: entry.effort, createdAt: entry.createdAt });
const receipt = entry => ({ submissionId: entry.submissionId, entryId: entry.entryId, status: entry.status, ...(entry.error ? { error: entry.error } : {}) });
const publicRun = run => run ? Object.fromEntries(['id', 'submissionId', 'status', 'turnId', 'permissions', 'providerId', 'model', 'effort', 'startedAt', 'finishedAt', 'message', 'error'].filter(key => run[key] !== undefined).map(key => [key, structuredClone(run[key])])) : null;

/** A restart is an explicit pause boundary, never permission to replay work. */
export function restoreAgentState(conversation) {
  const agent = conversation.agent;
  if (agent === undefined) return false;
  if (conversation.mode !== 'codex' || !object(agent) || !Number.isSafeInteger(agent.revision) || agent.revision < 0 || typeof agent.paused !== 'boolean' || !Array.isArray(agent.queue) || agent.queue.length > 5 || !Array.isArray(agent.submissions) || agent.submissions.length > 500) throw new Error('本地 Agent 队列格式无效，请保留数据并检查备份。');
  const ids = new Set(), queueIds = new Set(), receiptIds = new Set();
  let changed = false;
  for (const entry of agent.queue) {
    if (!object(entry) || !identifier(entry.id) || queueIds.has(entry.id) || !identifier(entry.submissionId) || entry.conversationId !== conversation.id || !Number.isSafeInteger(entry.revision) || entry.revision < 1 || !object(entry.auth) || entry.auth.userId !== conversation.userId || typeof entry.auth.sessionHash !== 'string' || typeof entry.auth.bootstrap !== 'boolean' || !Number.isSafeInteger(entry.auth.generation) || entry.auth.generation < 0) throw new Error('本地 Agent 任务归属无效。');
    content(entry.content, attachments(entry.attachmentIds)); normalizeAgentPermissions(entry.permissions);
    queueIds.add(entry.id); if (entry.auth.generation !== 0) { entry.auth.generation = 0; changed = true; }
  }
  for (const item of agent.submissions) {
    if (!object(item) || !identifier(item.submissionId) || ids.has(item.submissionId) || !identifier(item.entryId) || receiptIds.has(item.entryId) || !/^[a-f0-9]{64}$/.test(item.fingerprint) || !['queued', 'running', 'completed', 'cancelled', 'error', 'steered', 'dispatching', 'uncertain'].includes(item.status)) throw new Error('本地 Agent 提交记录无效。');
    content(item.content, attachments(item.attachmentIds)); ids.add(item.submissionId); receiptIds.add(item.entryId);
  }
  for (const entry of agent.queue) if (!agent.submissions.some(item => item.submissionId === entry.submissionId && item.entryId === entry.id && item.status === 'queued')) throw new Error('本地 Agent 队列与提交记录不一致。');
  for (const item of agent.submissions) if (item.status === 'queued' && !agent.queue.some(entry => entry.id === item.entryId && entry.submissionId === item.submissionId)) throw new Error('本地 Agent 提交记录缺少队列任务。');
  if (agent.run !== null && (!object(agent.run) || !identifier(agent.run.id) || !['running', 'stopping', 'completed', 'cancelled', 'error'].includes(agent.run.status) || !agent.submissions.some(item => item.entryId === agent.run.id && item.submissionId === agent.run.submissionId))) throw new Error('本地 Agent 运行记录无效。');
  if (agent.run) normalizeAgentPermissions(agent.run.permissions);
  if (agent.queue.length && !agent.paused) { agent.paused = true; changed = true; }
  if (agent.run && ['running', 'stopping'].includes(agent.run.status)) {
    Object.assign(agent.run, { status: 'error', finishedAt: now(), error: '服务已重启，先前任务不会自动重试。' });
    agent.paused = true; changed = true;
  }
  for (const item of agent.submissions) {
    if (item.status === 'running') { item.status = 'error'; changed = true; }
    if (item.status === 'dispatching') { item.status = 'uncertain'; agent.paused = true; changed = true; }
  }
  if (changed) agent.revision++;
  return changed;
}

/** Persistent receipts and short per-conversation locks own task lifetime, not HTTP. */
export function createAgentTasks({ store, active, approvals, getBridge, authorize, resolveModel, resolveImages = async () => [], redact = value => value }) {
  const locks = new Map(), generations = new Map(), removed = new Set();
  let closed = false;
  const data = conversation => conversation.agent ??= empty();
  const bump = conversation => { data(conversation).revision++; conversation.updatedAt = now(); };
  const lock = (conversation, work) => {
    const previous = locks.get(conversation.id) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(work);
    locks.set(conversation.id, result);
    void result.finally(() => { if (locks.get(conversation.id) === result) locks.delete(conversation.id); }).catch(() => {});
    return result;
  };
  const epoch = auth => generations.get(auth.sessionHash) ?? 0;
  const check = entry => {
    if (closed) throw failure(503, 'Agent 服务正在退出。');
    if (removed.has(entry.conversationId) || !store.state.conversations.some(item => item.id === entry.conversationId && item.userId === entry.auth.userId)) throw failure(404, 'Agent 会话已删除。');
    if (entry.auth.generation !== epoch(entry.auth)) throw failure(401, '这次提交所属登录已结束。');
    return authorize(entry);
  };
  const save = async conversation => {
    try { await store.save(); }
    catch { data(conversation).paused = true; throw failure(500, '保存 Agent 队列失败，已暂停自动执行。'); }
  };
  const projection = conversation => {
    const agent = conversation.agent ?? empty();
    return { revision: agent.revision, paused: agent.paused, queue: agent.queue.map(publicEntry), run: publicRun(agent.run),
      submissions: agent.submissions.slice(-10).map(item => ({ ...receipt(item), content: item.content, attachmentIds: [...(item.attachmentIds ?? [])], createdAt: item.createdAt })),
      approvals: [...approvals].filter(([, value]) => value.conversationId === conversation.id && !value.task.controller.signal.aborted).map(([id, value]) => ({ id, kind: value.kind || '操作请求', description: value.description || 'Agent 请求确认。' })) };
  };
  const request = (body, kind) => {
    const allowed = ['submissionId', 'content', 'attachmentIds', 'permissions', 'providerId', ...(kind === 'steer' ? ['expectedTurnId'] : [])];
    if (!object(body) || Object.keys(body).some(key => !allowed.includes(key)) || !identifier(body.submissionId)) throw failure(400, 'Agent 提交字段或 submissionId 无效。');
    if (kind === 'steer' && (typeof body.expectedTurnId !== 'string' || !body.expectedTurnId || body.expectedTurnId.length > 200)) throw failure(400, '插入指令需要有效的 expectedTurnId。');
    const attachmentIds = attachments(body.attachmentIds);
    const value = { kind, content: content(body.content, attachmentIds), attachmentIds, permissions: body.permissions === undefined ? null : normalizeAgentPermissions(body.permissions), providerId: body.providerId === undefined ? null : body.providerId,
      ...(kind === 'steer' ? { expectedTurnId: body.expectedTurnId, inheritProvider: body.providerId === undefined } : {}) };
    const fingerprint = createHash('sha256').update(JSON.stringify(value)).digest('hex');
    return { value, fingerprint };
  };
  const normalize = (conversation, body, auth, kind, value) => {
    const running = active.get(conversation.id)?.agentEntry ?? data(conversation).run;
    const permissions = value.permissions ?? normalizeAgentPermissions(kind === 'steer' ? running?.permissions : undefined);
    const providerId = body.providerId === undefined ? (kind === 'steer' ? running?.providerId ?? null : null) : body.providerId;
    if (providerId !== null && (typeof providerId !== 'string' || !providerId || providerId.length > 128)) throw failure(400, 'Agent 模型连接无效。');
    const entry = { id: randomUUID(), conversationId: conversation.id, submissionId: body.submissionId, revision: 1, content: value.content, attachmentIds: value.attachmentIds, permissions, providerId,
      ...resolveModel(auth.userId, providerId), auth: { ...auth, generation: epoch(auth) }, createdAt: now() };
    check(entry);
    return entry;
  };
  const existing = (agent, submissionId, fingerprint) => {
    const previous = agent.submissions.find(item => item.submissionId === submissionId);
    if (previous && previous.fingerprint !== fingerprint) throw failure(409, 'submissionId 已用于另一份内容，请重新提交。');
    return previous;
  };
  const enqueue = (conversation, entry, record) => {
    const agent = data(conversation);
    if (agent.queue.length >= 5) throw failure(409, 'Agent 待执行队列最多保留 5 条。');
    agent.queue.push(entry); record.status = 'queued'; bump(conversation);
  };
  const reserve = (agent, entry, fingerprint) => {
    if (agent.submissions.length >= 500) throw failure(409, '这个会话已达到 500 次 Agent 提交，请创建新会话。');
    const record = { submissionId: entry.submissionId, entryId: entry.id, fingerprint, status: 'dispatching', content: entry.content, attachmentIds: [...entry.attachmentIds], createdAt: entry.createdAt };
    agent.submissions.push(record); return record;
  };
  const clearApprovals = task => { for (const id of task.approvalIds) if (approvals.get(id)?.task === task) approvals.delete(id); };

  async function execute(conversation, entry, task, userMessage, assistant) {
    const agent = data(conversation), record = agent.submissions.find(item => item.entryId === entry.id);
    let savedAt = Date.now(), savedChars = 0, persistenceError = false, expiry;
    const persistEvent = () => {
      savedAt = Date.now(); savedChars = assistant.content.length;
      void save(conversation).catch(error => { persistenceError = true; task.controller.abort(error); });
    };
    const onEvent = (event, value) => {
      if (task.controller.signal.aborted || active.get(conversation.id) !== task) return;
      const safe = redact(value);
      if (event === 'thread' && typeof safe.threadId === 'string') { conversation.threadId = safe.threadId; persistEvent(); }
      if (event === 'turn' && typeof safe.turnId === 'string') { agent.run.turnId = safe.turnId; bump(conversation); persistEvent(); }
      if (event === 'status') { agent.run.message = String(safe.message || safe.text || safe.state || '').slice(0, 500); bump(conversation); }
      if (event === 'approval' && typeof safe.id === 'string') { approvals.set(safe.id, { userId: entry.auth.userId, conversationId: conversation.id, task, kind: safe.kind, description: safe.description }); task.approvalIds.add(safe.id); bump(conversation); }
      if (event === 'approval-resolved' && typeof safe.id === 'string' && approvals.get(safe.id)?.task === task) { approvals.delete(safe.id); task.approvalIds.delete(safe.id); bump(conversation); }
      if (event === 'delta' && typeof safe.text === 'string') {
        if (assistant.content.length + safe.text.length > 2 * 1024 * 1024) { task.controller.abort(failure(502, 'Agent 回复超过长度限制。')); return; }
        assistant.content += safe.text; bump(conversation);
        if (assistant.content.length - savedChars >= 16000 || Date.now() - savedAt >= 1500) persistEvent();
      }
    };
    let result, error;
    try {
      const expiresAt = check(entry); task.controller.signal.throwIfAborted();
      if (Number.isFinite(expiresAt)) expiry = setTimeout(() => { void revoke(value => value.sessionHash === entry.auth.sessionHash).catch(() => {}); }, Math.max(0, expiresAt - Date.now()));
      const images = await resolveImages(entry.auth.userId, entry.attachmentIds); check(entry); task.controller.signal.throwIfAborted();
      result = await getBridge().run({ conversationId: conversation.id, prompt: entry.content, threadId: conversation.threadId, permissions: entry.permissions, images, ...(entry.model ? { model: entry.model } : {}), ...(entry.effort ? { effort: entry.effort } : {}), signal: task.controller.signal, onEvent });
      check(entry); task.controller.signal.throwIfAborted();
    } catch (caught) { error = caught; }
    clearTimeout(expiry);
    await lock(conversation, async () => {
      try {
        if (error) {
          const cancelled = task.controller.signal.aborted;
          assistant.status = cancelled ? 'cancelled' : 'error';
          assistant.error = persistenceError ? '保存回复失败，队列已暂停。' : String(redact(error.message || 'Agent 任务失败。')).slice(0, 500);
          Object.assign(agent.run, { status: assistant.status, error: assistant.error }); agent.paused = true;
        } else {
          if (result?.threadId) conversation.threadId = result.threadId;
          if (!assistant.content && result?.text) assistant.content = String(redact(result.text)).slice(0, 2 * 1024 * 1024);
          assistant.status = 'complete'; agent.run.status = 'completed';
        }
        record.status = agent.run.status; agent.run.finishedAt = now(); clearApprovals(task); bump(conversation);
        await save(conversation);
      } finally { if (active.get(conversation.id) === task) active.delete(conversation.id); }
    }).catch(() => { agent.paused = true; }).finally(() => task.finish());
    kick(conversation);
  }

  function kick(conversation) {
    if (closed) return;
    void lock(conversation, async () => {
      const agent = data(conversation);
      if (closed || agent.paused || !agent.queue.length || active.has(conversation.id)) return;
      const entry = agent.queue[0], record = agent.submissions.find(item => item.entryId === entry.id);
      try { check(entry); }
      catch (error) { agent.paused = true; agent.queue.shift(); record.status = 'cancelled'; bump(conversation); await save(conversation); return; }
      if (conversation.messages.length > 498) { agent.paused = true; await save(conversation); return; }
      const controller = new AbortController(); let finish;
      const done = new Promise(resolve => { finish = resolve; });
      const task = { controller, done, finish, mode: 'codex', userId: entry.auth.userId, sessionHash: entry.auth.sessionHash, providerId: entry.providerId, approvalIds: new Set(), agentEntry: entry };
      active.set(conversation.id, task); agent.queue.shift(); record.status = 'running';
      agent.run = { id: entry.id, submissionId: entry.submissionId, status: 'running', turnId: null, permissions: { ...entry.permissions }, providerId: entry.providerId, model: entry.model, effort: entry.effort, startedAt: now() };
      const userMessage = { id: randomUUID(), role: 'user', content: entry.content, ...(entry.attachmentIds.length ? { attachmentIds: [...entry.attachmentIds] } : {}), status: 'complete', createdAt: now(), agentSubmissionId: entry.submissionId };
      const assistant = { id: randomUUID(), role: 'assistant', content: '', status: 'streaming', createdAt: now(), model: entry.model, agentRunId: entry.id };
      if (!conversation.messages.length) conversation.title = entry.content.slice(0, 32) || '图片任务';
      conversation.messages.push(userMessage, assistant); bump(conversation);
      try { await save(conversation); check(entry); controller.signal.throwIfAborted(); }
      catch (error) {
        agent.paused = true; record.status = 'error'; assistant.status = 'error'; Object.assign(agent.run, { status: 'error', error: '任务启动前已停止或无法保存。', finishedAt: now() });
        active.delete(conversation.id); finish(); await save(conversation); return;
      }
      void execute(conversation, entry, task, userMessage, assistant);
    }).catch(() => { data(conversation).paused = true; });
  }

  async function submit(conversation, body, auth, kind = 'submit') {
    const result = await lock(conversation, async () => {
      const { value, fingerprint } = request(body, kind), agent = data(conversation);
      const previous = existing(agent, body.submissionId, fingerprint);
      if (previous) { await save(conversation); return receipt(previous); }
      const entry = normalize(conversation, body, auth, kind, value);
      const task = active.get(conversation.id);
      if (kind === 'steer' && !task && agent.run?.turnId !== body.expectedTurnId) throw failure(409, '当前运行已变化，请刷新后再插入指令。', 'turn_not_active');
      if (kind === 'steer' && task) {
        if (!task.agentEntry || !agent.run?.turnId || agent.run.turnId !== body.expectedTurnId) throw failure(409, '当前运行已变化，请刷新后再插入指令。', 'turn_not_active');
        if (JSON.stringify(entry.permissions) !== JSON.stringify(task.agentEntry.permissions) || entry.providerId !== task.agentEntry.providerId || entry.model !== task.agentEntry.model || entry.effort !== task.agentEntry.effort) throw failure(409, '运行中不能修改模型或权限，请加入下一条任务。');
        if (conversation.messages.length >= 500) throw failure(409, '会话消息已达上限，请新建会话。');
        const record = reserve(agent, entry, fingerprint); bump(conversation); await save(conversation);
        let images;
        try { images = await resolveImages(entry.auth.userId, entry.attachmentIds); check(entry); task.controller.signal.throwIfAborted(); }
        catch (error) { record.status = 'cancelled'; agent.paused = true; bump(conversation); await save(conversation); throw error; }
        try {
          await getBridge().steer({ conversationId: conversation.id, expectedTurnId: body.expectedTurnId, content: entry.content, images });
          // Delivered means exactly that, even if a revocation arrived during the RPC.
          record.status = 'steered';
          conversation.messages.push({ id: randomUUID(), role: 'user', content: entry.content, ...(entry.attachmentIds.length ? { attachmentIds: [...entry.attachmentIds] } : {}), status: 'complete', createdAt: now(), agentSubmissionId: entry.submissionId, agentRunId: task.agentEntry.id, steered: true });
        } catch (error) {
          if (error.code === 'turn_not_active') {
            try { check(entry); enqueue(conversation, entry, record); }
            catch (fallbackError) { record.status = fallbackError.status === 401 || task.controller.signal.aborted ? 'cancelled' : 'error'; record.error = String(redact(fallbackError.message)).slice(0, 500); agent.paused = true; }
          }
          else { record.status = 'uncertain'; agent.paused = true; }
        }
        bump(conversation); await save(conversation); return receipt(record);
      }
      if (agent.queue.length >= 5) throw failure(409, 'Agent 待执行队列最多保留 5 条。');
      const record = reserve(agent, entry, fingerprint); enqueue(conversation, entry, record);
      await save(conversation);
      try { check(entry); }
      catch (error) { agent.queue = agent.queue.filter(item => item.id !== entry.id); record.status = 'cancelled'; agent.paused = true; bump(conversation); await save(conversation); throw error; }
      return receipt(record);
    });
    kick(conversation); return result;
  }

  async function edit(conversation, id, body, auth, remove = false) {
    return lock(conversation, async () => {
      if (!object(body) || Object.keys(body).some(key => !(remove ? ['revision'] : ['revision', 'content', 'attachmentIds']).includes(key))) throw failure(400, '队列修改只接受 revision 和内容字段。');
      const agent = data(conversation), entry = agent.queue.find(item => item.id === id);
      if (!entry) throw failure(404, '待执行任务不存在。');
      if (!Number.isSafeInteger(body.revision) || body.revision !== entry.revision) throw failure(409, '队列内容已变化，请刷新后重试。');
      check({ ...entry, auth: { ...auth, generation: epoch(auth) } });
      if (remove) { agent.queue = agent.queue.filter(item => item !== entry); agent.submissions.find(item => item.entryId === id).status = 'cancelled'; }
      else { const images = attachments(body.attachmentIds), next = content(body.content, images); check({ ...entry, content: next, attachmentIds: images, auth: { ...auth, generation: epoch(auth) } }); entry.content = next; entry.attachmentIds = images; entry.revision++; }
      bump(conversation); await save(conversation);
    });
  }
  async function resume(conversation, auth) {
    await lock(conversation, async () => {
      const agent = data(conversation);
      for (const entry of agent.queue) { check({ ...entry, auth: { ...auth, generation: epoch(auth) } }); check(entry); }
      if (active.has(conversation.id)) throw failure(409, '请等待当前任务结束后再恢复队列。');
      agent.paused = false; bump(conversation); await save(conversation);
    });
    kick(conversation);
  }
  async function stop(conversation, { clear = false } = {}) {
    if (clear) removed.add(conversation.id);
    const agent = data(conversation); agent.paused = true;
    if (clear) { for (const entry of agent.queue) agent.submissions.find(item => item.entryId === entry.id).status = 'cancelled'; agent.queue = []; }
    const task = active.get(conversation.id);
    if (task) { if (task.agentEntry && agent.run) agent.run.status = 'stopping'; task.controller.abort(new DOMException('用户已停止 Agent。', 'AbortError')); clearApprovals(task); }
    bump(conversation); await save(conversation); if (task) await task.done;
  }
  async function revoke(predicate) {
    const waiting = [];
    for (const conversation of store.state.conversations) {
      if (!conversation.agent) continue;
      const agent = conversation.agent, entries = agent.queue.filter(entry => predicate({ ...entry.auth, providerId: entry.providerId, mode: 'codex' }));
      for (const entry of entries) {
        generations.set(entry.auth.sessionHash, epoch(entry.auth) + 1);
        agent.submissions.find(item => item.entryId === entry.id).status = 'cancelled';
      }
      if (entries.length) { agent.queue = agent.queue.filter(entry => !entries.includes(entry)); agent.paused = true; bump(conversation); }
      const task = active.get(conversation.id);
      if (task?.agentEntry && predicate(task)) {
        generations.set(task.sessionHash, epoch(task.agentEntry.auth) + 1);
        agent.paused = true; agent.run.status = 'stopping'; task.controller.abort(new DOMException('Agent 授权已撤销。', 'AbortError')); clearApprovals(task); waiting.push(task.done); bump(conversation);
      }
    }
    await store.save(); await Promise.all(waiting);
  }
  async function close() {
    closed = true;
    for (const conversation of store.state.conversations) if (conversation.agent && !conversation.agent.paused && (conversation.agent.queue.length || ['running', 'stopping'].includes(conversation.agent.run?.status))) { conversation.agent.paused = true; bump(conversation); }
    await Promise.allSettled([...locks.values()]); await store.save();
  }
  return { snapshot: projection, submit, edit, resume, stop, revoke, kick, close, hasPending: () => store.state.conversations.some(conversation => conversation.agent?.queue.length) };
}
