const fail = (status, message) => Object.assign(new Error(message), { status });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const latest = (...values) => values.filter(stamp).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
export const PROJECT_LIMIT = 50;
export const organizationText = (value, label, limit) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit || /[\x00-\x1f\x7f]/.test(value)) throw fail(400, `${label}需要 1 到 ${limit} 个字符，不能含控制字符。`);
  return value.trim();
};
export const visibleProject = project => ({ id: project.id, name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt });
export function organizationPatch(input) {
  if (!object(input) || !Object.keys(input).length || Object.keys(input).some(key => !['title', 'projectId', 'archived'].includes(key))) throw fail(400, '对话整理只接受 title、projectId 和 archived 字段。');
  const patch = {};
  if (Object.hasOwn(input, 'title')) patch.customTitle = organizationText(input.title, '对话名称', 100);
  if (Object.hasOwn(input, 'projectId')) { if (input.projectId !== null && !uuid(input.projectId)) throw fail(400, '项目标识无效。'); patch.projectId = input.projectId; }
  if (Object.hasOwn(input, 'archived')) { if (typeof input.archived !== 'boolean') throw fail(400, '归档状态须为 boolean。'); patch.archived = input.archived; }
  return patch;
}

/** Additive migration keeps organization separate from execution directories. */
export function validateStoredOrganization(state) {
  let changed = false;
  if (state.projects === undefined) { state.projects = []; changed = true; }
  if (!Array.isArray(state.projects)) throw new Error('本地项目分类格式无效，请保留文件并检查备份。');
  const ids = new Set(), counts = new Map(), users = new Set(state.users.map(user => user.id));
  for (const project of state.projects) {
    if (!object(project) || Object.keys(project).some(key => !['id', 'userId', 'name', 'createdAt', 'updatedAt'].includes(key)) || !uuid(project.id) || ids.has(project.id) || !users.has(project.userId) || !stamp(project.createdAt) || !stamp(project.updatedAt)) throw new Error('本地项目记录或归属无效。');
    try { if (organizationText(project.name, '项目名称', 60) !== project.name) throw new Error(); } catch { throw new Error('本地项目名称无效。'); }
    ids.add(project.id); const count = (counts.get(project.userId) ?? 0) + 1; counts.set(project.userId, count);
    if (count > PROJECT_LIMIT) throw new Error('本地账号项目数量超出限制。');
  }
  for (const conversation of state.conversations) {
    if (conversation.projectId === undefined) { conversation.projectId = null; changed = true; }
    if (conversation.archivedAt === undefined) { conversation.archivedAt = null; changed = true; }
    if (conversation.projectId !== null && !state.projects.some(project => project.id === conversation.projectId && project.userId === conversation.userId)) throw new Error('本地对话项目归属无效。');
    if (conversation.archivedAt !== null && !stamp(conversation.archivedAt)) throw new Error('本地对话归档时间无效。');
    if (conversation.customTitle !== undefined) { try { if (organizationText(conversation.customTitle, '对话名称', 100) !== conversation.customTitle) throw new Error(); } catch { throw new Error('本地对话名称无效。'); } }
  }
  return changed;
}

/** Only committed metadata is merged into old background-save snapshots. */
export function createOrganizationPersistence(store) {
  let projects = structuredClone(store.state.projects);
  let metadata = new Map(store.state.conversations.map(item => [item.id, { userId: item.userId, projectId: item.projectId, archivedAt: item.archivedAt, ...(item.customTitle !== undefined ? { customTitle: item.customTitle } : {}) }]));
  const createdBodies = new Map();
  const removed = new Set(), prepared = new WeakMap();
  const lookup = (snapshot, action) => {
    const item = snapshot.conversations.find(item => item.id === action.id && item.userId === action.userId);
    if (!item || !store.state.conversations.some(item => item.id === action.id && item.userId === action.userId)) throw fail(404, '会话不存在。');
    if (item.backgroundParentId) throw fail(409, '请通过所属聊天管理后台任务，不能独立整理或删除其任务记录。');
    return item;
  };
  const project = (data, userId, id) => {
    const item = data.find(item => item.id === id && item.userId === userId);
    if (!item) throw fail(404, '项目不存在。'); return item;
  };
  const check = action => {
    if (!action) return;
    if (!object(action) || typeof action.userId !== 'string' || typeof action.authorize !== 'function' || action.validateLive !== undefined && typeof action.validateLive !== 'function') throw fail(400, '对话整理持久化操作无效。');
    action.authorize();
    if (!store.state.users.some(user => user.id === action.userId && !user.disabled)) throw fail(401, '账号已失效。');
    action.validateLive?.();
  };
  return {
    prepare(snapshot, action) {
      check(action);
      snapshot.projects = structuredClone(projects);
      snapshot.conversations = snapshot.conversations.filter(item => !removed.has(item.id));
      // Saves captured before creation precede every save with the new body.
      // Retain the committed creation body without copying live streaming data.
      for (const live of store.state.conversations) if (createdBodies.has(live.id) && !removed.has(live.id) && !snapshot.conversations.some(item => item.id === live.id)) snapshot.conversations.push(structuredClone(createdBodies.get(live.id)));
      for (const item of snapshot.conversations) {
        const committed = metadata.get(item.id);
        if (committed && committed.userId !== item.userId) throw fail(500, '对话整理归属发生变化。');
        Object.assign(item, committed ?? { projectId: item.projectId ?? null, archivedAt: item.archivedAt ?? null });
        if (committed && committed.customTitle === undefined) delete item.customTitle;
        if (committed?.touchedAt) item.updatedAt = latest(item.updatedAt, committed.touchedAt);
        delete item.touchedAt;
        if (item.projectId !== null && !snapshot.projects.some(project => project.id === item.projectId && project.userId === item.userId)) item.projectId = null;
      }
      const deleted = [];
      if (action) {
        const at = new Date().toISOString();
        if (action.kind === 'project-create') {
          if (snapshot.projects.filter(item => item.userId === action.userId).length >= PROJECT_LIMIT) throw fail(400, `每个账号最多创建 ${PROJECT_LIMIT} 个项目。`);
          snapshot.projects.unshift({ id: action.id, userId: action.userId, name: organizationText(action.name, '项目名称', 60), createdAt: at, updatedAt: at });
        } else if (action.kind === 'project-rename') {
          Object.assign(project(snapshot.projects, action.userId, action.id), { name: organizationText(action.name, '项目名称', 60), updatedAt: at });
        } else if (action.kind === 'project-delete') {
          project(snapshot.projects, action.userId, action.id);
          snapshot.projects = snapshot.projects.filter(item => item.id !== action.id);
          for (const item of snapshot.conversations) if (item.userId === action.userId && item.projectId === action.id) { item.projectId = null; item.updatedAt = latest(item.updatedAt, at); }
        } else if (action.kind === 'conversation-create') {
          const item = structuredClone(action.conversation);
          if (!item || item.userId !== action.userId || removed.has(item.id) || snapshot.conversations.some(existing => existing.id === item.id)) throw fail(409, '会话创建记录无效。');
          if (item.projectId !== null) project(snapshot.projects, action.userId, item.projectId);
          snapshot.conversations.unshift(item);
        } else if (action.kind === 'conversation-update') {
          const item = lookup(snapshot, action), patch = action.patch;
          if (!object(patch)) throw fail(400, '对话整理操作无效。');
          if (Object.hasOwn(patch, 'projectId') && patch.projectId !== null) project(snapshot.projects, action.userId, patch.projectId);
          if (Object.hasOwn(patch, 'customTitle')) item.customTitle = organizationText(patch.customTitle, '对话名称', 100);
          if (Object.hasOwn(patch, 'projectId')) item.projectId = patch.projectId;
          if (Object.hasOwn(patch, 'archived')) item.archivedAt = patch.archived ? item.archivedAt ?? at : null;
          item.updatedAt = latest(item.updatedAt, at);
        } else if (action.kind === 'conversation-delete') {
          lookup(snapshot, action);
          for (const item of snapshot.conversations) if (item.userId === action.userId && (item.id === action.id || item.backgroundParentId === action.id)) deleted.push(item.id);
          snapshot.conversations = snapshot.conversations.filter(item => !deleted.includes(item.id));
        } else throw fail(400, '对话整理持久化操作无效。');
      }
      validateStoredOrganization(snapshot);
      prepared.set(snapshot, { deleted, action });
    },
    beforeCommit(snapshot) { check(prepared.get(snapshot)?.action); },
    commit(snapshot) {
      const { deleted, action } = prepared.get(snapshot) ?? { deleted: [] };
      for (const id of deleted) { removed.add(id); metadata.delete(id); createdBodies.delete(id); }
      projects = structuredClone(snapshot.projects); store.state.projects = structuredClone(projects);
      for (const item of snapshot.conversations) {
        if (action?.kind === 'conversation-create' && action.conversation.id === item.id) createdBodies.set(item.id, structuredClone(item));
        const before = metadata.get(item.id), touched = before && (before.projectId !== item.projectId || before.archivedAt !== item.archivedAt || before.customTitle !== item.customTitle);
        const next = { userId: item.userId, projectId: item.projectId, archivedAt: item.archivedAt, ...(item.customTitle !== undefined ? { customTitle: item.customTitle } : {}), ...(touched || action?.kind === 'conversation-update' && action.id === item.id ? { touchedAt: item.updatedAt } : before?.touchedAt ? { touchedAt: before.touchedAt } : {}) };
        metadata.set(item.id, next);
        const live = store.state.conversations.find(live => live.id === item.id && live.userId === item.userId);
        if (live) { Object.assign(live, next); if (next.touchedAt) live.updatedAt = latest(live.updatedAt, next.touchedAt); delete live.touchedAt; }
        else if (action?.kind === 'conversation-create' && action.conversation.id === item.id) store.state.conversations.unshift(structuredClone(item));
      }
      store.state.conversations = store.state.conversations.filter(item => !removed.has(item.id));
      prepared.delete(snapshot);
    },
  };
}
