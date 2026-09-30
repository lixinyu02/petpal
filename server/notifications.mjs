import { randomBytes, randomUUID } from 'node:crypto';
import { tokenHash, SESSION_LIFETIME } from './auth.mjs';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 500, MAX_DEVICES = 16;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
const deviceId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const cursor = value => Number.isSafeInteger(value) && value >= 0;
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const fail = (status, message) => Object.assign(new Error(message), { status });
const empty = () => ({ version: 1, accounts: [], devices: [], runs: [] });
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const eventFields = ['seq', 'id', 'conversationId', 'agentConversationId', 'runId', 'status', 'source', 'createdAt'];

/** Stored credentials are hashes only. Loading never replays restored task states. */
export function validateStoredNotifications(state) {
  let changed = false;
  if (state.notifications === undefined) { state.notifications = empty(); changed = true; }
  const data = state.notifications;
  const users = new Set(state.users.map(user => user.id));
  const invalid = () => { throw new Error('本地任务通知数据无效，请保留数据并检查备份。'); };
  if (!fields(data, ['version', 'accounts', 'devices', 'runs']) || data.version !== 1 || !Array.isArray(data.accounts) || !Array.isArray(data.devices) || !Array.isArray(data.runs)) invalid();
  const accounts = new Set(), devices = new Set(), tokens = new Set(), runs = new Set();
  for (const account of data.accounts) {
    if (!fields(account, ['userId', 'highWater', 'events']) || !users.has(account.userId) || accounts.has(account.userId) || !cursor(account.highWater) || !Array.isArray(account.events) || account.events.length > MAX_EVENTS) invalid();
    accounts.add(account.userId); let previous = 0; const ids = new Set(), runIds = new Set();
    for (const event of account.events) {
      if (!fields(event, eventFields) || Object.keys(event).length !== eventFields.length || !cursor(event.seq) || event.seq <= previous || event.seq > account.highWater || !id(event.id) || ids.has(event.id) || !id(event.conversationId) || !id(event.agentConversationId) || !id(event.runId) || runIds.has(event.runId) || !['completed', 'error'].includes(event.status) || !['agent', 'chat-agent'].includes(event.source) || !stamp(event.createdAt)) invalid();
      previous = event.seq; ids.add(event.id); runIds.add(event.runId);
    }
  }
  for (const device of data.devices) {
    const key = `${device.userId}:${device.deviceId}`;
    if (!fields(device, ['deviceId', 'tokenHash', 'instanceId', 'userId', 'sessionHash', 'bootstrap', 'sourceCreatedAt', 'createdAt', 'expiresAt', 'cursor']) || !deviceId(device.deviceId) || !hash(device.tokenHash) || tokens.has(device.tokenHash) || device.instanceId !== state.instanceId || !users.has(device.userId) || devices.has(key) || !hash(device.sessionHash) || typeof device.bootstrap !== 'boolean' || !cursor(device.sourceCreatedAt) || !stamp(device.createdAt) || !Number.isFinite(device.expiresAt) || !cursor(device.cursor) || device.cursor > (data.accounts.find(account => account.userId === device.userId)?.highWater ?? 0)) invalid();
    tokens.add(device.tokenHash); devices.add(key);
  }
  if (data.devices.length > state.users.length * MAX_DEVICES) invalid();
  for (const run of data.runs) {
    if (!fields(run, ['conversationId', 'userId', 'runId']) || !id(run.conversationId) || !id(run.runId) || !users.has(run.userId) || runs.has(run.conversationId)) invalid();
    runs.add(run.conversationId);
  }
  // Include runs repaired by restoreAgentState. A restart failure is not a new
  // task completion; terminal events already committed remain in the feed.
  const baseline = state.conversations.filter(item => item.mode === 'codex' && item.agent?.run).map(item => ({ conversationId: item.id, userId: item.userId, runId: item.agent.run.id }));
  if (JSON.stringify(data.runs) !== JSON.stringify(baseline)) { data.runs = baseline; changed = true; }
  return changed;
}

export function createNotificationService({ store, authorize, clock = Date.now }) {
  let durable = structuredClone(store.state.notifications), closed = false;
  const revoked = new Set(), waiters = new Set(), registrations = new Set();
  const account = (data, userId) => {
    let value = data.accounts.find(item => item.userId === userId);
    if (!value) { value = { userId, highWater: 0, events: [] }; data.accounts.push(value); }
    return value;
  };
  const checkSource = (device, { allowClosing = false } = {}) => {
    if (closed && !allowClosing) throw fail(503, '通知服务正在退出。');
    if (device.instanceId !== store.state.instanceId || device.expiresAt <= clock() || revoked.has(device.tokenHash)) throw fail(401, '任务通知凭据已过期或撤销。');
    const result = authorize({ userId: device.userId, sessionHash: device.sessionHash, bootstrap: device.bootstrap });
    if (Number.isFinite(result?.expiresAt) && device.expiresAt > result.expiresAt) throw fail(401, '任务通知所属登录已失效。');
    return device;
  };
  const check = value => {
    if (typeof value !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(value)) throw fail(401, '任务通知凭据无效。');
    const device = durable.devices.find(item => item.tokenHash === tokenHash(value.slice(7)));
    if (!device) throw fail(401, '任务通知凭据已过期或撤销。');
    return checkSource(device);
  };
  const wake = (predicate = () => true) => { for (const waiter of [...waiters]) if (predicate(waiter)) waiter.finish(); };
  const prune = data => {
    const threshold = clock() - RETENTION_MS;
    for (const entry of data.accounts) entry.events = entry.events.filter(event => Date.parse(event.createdAt) >= threshold).slice(-MAX_EVENTS);
  };
  const extension = {
    prepare(snapshot, operation) {
      const data = structuredClone(durable);
      prune(data);
      data.devices = data.devices.filter(device => { try { checkSource(device, { allowClosing: true }); return true; } catch { return false; } });
      if (operation?.notification) {
        const action = operation.notification;
        if (action.kind === 'register') {
          checkSource(action.device);
          const existing = data.devices.find(item => item.userId === action.device.userId && item.deviceId === action.device.deviceId);
          if (existing && existing.sessionHash !== action.device.sessionHash && existing.sourceCreatedAt >= action.device.sourceCreatedAt) throw fail(409, '此安装已由更新的登录开启任务提醒。');
          data.devices = data.devices.filter(item => item.userId !== action.device.userId || item.deviceId !== action.device.deviceId);
          if (data.devices.filter(item => item.userId === action.device.userId).length >= MAX_DEVICES) throw fail(409, '每个账号最多开启 16 台通知设备。');
          data.devices.push({ ...action.device, cursor: account(data, action.device.userId).highWater });
        } else if (action.kind === 'ack') {
          const device = data.devices.find(item => item.tokenHash === action.tokenHash);
          if (!device) throw fail(401, '任务通知凭据已撤销。');
          checkSource(device);
          if (action.cursor > account(data, device.userId).highWater) throw fail(400, '通知确认位置超出当前事件范围。');
          device.cursor = Math.max(device.cursor, action.cursor);
        } else if (action.kind === 'revoke') data.devices = data.devices.filter(item => !action.hashes.includes(item.tokenHash));
        else throw fail(400, '通知持久化操作无效。');
      }
      const previous = new Map(data.runs.map(run => [run.conversationId, run.runId]));
      const live = new Set(snapshot.conversations.map(item => item.id));
      data.runs = data.runs.filter(item => live.has(item.conversationId));
      for (const conversation of snapshot.conversations) {
        const run = conversation.mode === 'codex' ? conversation.agent?.run : null;
        if (!run || !['completed', 'error', 'cancelled', 'unknown'].includes(run.status) || previous.get(conversation.id) === run.id) continue;
        data.runs = data.runs.filter(item => item.conversationId !== conversation.id);
        data.runs.push({ conversationId: conversation.id, userId: conversation.userId, runId: run.id });
        if (!['completed', 'error'].includes(run.status)) continue;
        const parent = conversation.backgroundParentId ? snapshot.conversations.find(item => item.id === conversation.backgroundParentId && item.mode === 'chat' && item.userId === conversation.userId && item.assistantTasks?.some(task => task.conversationId === conversation.id)) : null;
        if (conversation.backgroundParentId && !parent) continue;
        const feed = account(data, conversation.userId);
        if (feed.events.some(event => event.runId === run.id)) continue;
        if (feed.highWater === Number.MAX_SAFE_INTEGER) throw fail(500, '通知序列已达到上限。');
        feed.events.push({ seq: ++feed.highWater, id: randomUUID(), conversationId: parent?.id ?? conversation.id, agentConversationId: conversation.id, runId: run.id, status: run.status, source: parent ? 'chat-agent' : 'agent', createdAt: stamp(run.finishedAt) ? run.finishedAt : new Date(clock()).toISOString() });
      }
      prune(data);
      if (operation?.notification?.kind === 'register') {
        const device = data.devices.find(item => item.tokenHash === operation.notification.device.tokenHash);
        device.cursor = account(data, device.userId).highWater;
      }
      snapshot.notifications = data;
    },
    commit(data) {
      const changedUsers = new Set(data.accounts.filter(next => {
        const before = durable.accounts.find(item => item.userId === next.userId);
        return (before?.highWater ?? 0) !== next.highWater || before?.events[0]?.seq !== next.events[0]?.seq;
      }).map(item => item.userId));
      const remaining = new Set(data.devices.map(device => device.tokenHash));
      durable = structuredClone(data);
      store.state.notifications = structuredClone(data);
      for (const value of revoked) if (!durable.devices.some(device => device.tokenHash === value) && ![...registrations].some(device => device.tokenHash === value)) revoked.delete(value);
      wake(waiter => changedUsers.has(waiter.userId) || !remaining.has(waiter.tokenHash));
    },
  };
  if (store.notificationPersistence) throw new Error('通知持久化服务已经挂载。');
  store.notificationPersistence = extension;
  const view = (device, after, limit) => {
    const data = structuredClone(durable); prune(data);
    const feed = account(data, device.userId), minCursor = feed.events[0] ? feed.events[0].seq - 1 : feed.highWater;
    const resetRequired = after < minCursor || after > feed.highWater;
    const events = resetRequired ? [] : feed.events.filter(event => event.seq > after).slice(0, limit);
    return { deviceId: device.deviceId, instanceId: device.instanceId, userId: device.userId, events, nextCursor: resetRequired ? feed.highWater : events.at(-1)?.seq ?? after, highWater: feed.highWater, minCursor, resetRequired, expiresAt: new Date(device.expiresAt).toISOString() };
  };
  const number = (value, name, fallback, maximum) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d{1,16}$/.test(value) || !cursor(Number(value)) || Number(value) > maximum) throw fail(400, `${name}无效。`);
    return Number(value);
  };
  const save = operation => store.save({ notification: operation });
  return {
    async register(auth, body) {
      if (!fields(body, ['deviceId']) || !deviceId(body.deviceId)) throw fail(400, '通知设备标识必须是安装 UUID。');
      const source = authorize(auth);
      const token = randomBytes(32).toString('base64url');
      const device = { deviceId: body.deviceId, tokenHash: tokenHash(token), instanceId: store.state.instanceId, userId: auth.userId, sessionHash: auth.sessionHash, bootstrap: auth.bootstrap, sourceCreatedAt: source?.sourceCreatedAt ?? 0, createdAt: new Date(clock()).toISOString(), expiresAt: Math.min(clock() + SESSION_LIFETIME, source?.expiresAt ?? Infinity), cursor: 0 };
      registrations.add(device);
      try {
        await save({ kind: 'register', device });
        const current = check(`Bearer ${token}`);
        return { deviceId: current.deviceId, token, instanceId: current.instanceId, userId: current.userId, cursor: current.cursor, expiresAt: new Date(current.expiresAt).toISOString() };
      } finally { registrations.delete(device); }
    },
    async feed(value, query, signal) {
      if (!fields(query, ['after', 'wait', 'limit'])) throw fail(400, '通知查询字段无效。');
      const device = check(value);
      const after = number(query.after, '事件位置', device.cursor, Number.MAX_SAFE_INTEGER), limit = number(query.limit, '事件数量', 50, 50), seconds = number(query.wait, '等待时间', 0, 25);
      if (limit < 1) throw fail(400, '事件数量至少为 1。');
      let result = view(device, after, limit);
      if (seconds && !result.events.length && !result.resetRequired) {
        if (waiters.size >= 512 || [...waiters].filter(waiter => waiter.tokenHash === device.tokenHash).length >= 2) throw fail(429, '通知等待连接过多，请稍后重连。');
        await new Promise((resolve, reject) => {
          let timer; const waiter = { userId: device.userId, tokenHash: device.tokenHash, finish: error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); waiters.delete(waiter); if (error) reject(error); else resolve(); } };
          const abort = () => waiter.finish(signal.reason ?? new DOMException('请求已取消。', 'AbortError'));
          waiters.add(waiter); signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(waiter.finish, Math.min(seconds * 1000, Math.max(0, device.expiresAt - clock()))); timer.unref?.();
          if (signal?.aborted) abort();
        });
        // Session revocation, token replacement and shutdown win over any late
        // response, including a task that committed while logout was waiting.
        result = view(check(value), after, limit);
      }
      check(value); return result;
    },
    async ack(value, body) {
      if (!fields(body, ['cursor']) || !cursor(body.cursor)) throw fail(400, '通知确认位置无效。');
      const device = check(value); await save({ kind: 'ack', tokenHash: device.tokenHash, cursor: body.cursor });
      const current = check(value); return { ok: true, cursor: current.cursor };
    },
    async remove(auth, installationId) {
      authorize(auth); if (!deviceId(installationId)) throw fail(400, '通知设备标识无效。');
      const hashes = [...durable.devices, ...registrations].filter(device => device.userId === auth.userId && device.deviceId === installationId && device.sessionHash === auth.sessionHash && device.bootstrap === auth.bootstrap).map(device => device.tokenHash);
      for (const value of hashes) revoked.add(value); wake(waiter => hashes.includes(waiter.tokenHash));
      await save({ kind: 'revoke', hashes }); authorize(auth); return { ok: true };
    },
    async removeSelf(value) {
      const device = check(value); revoked.add(device.tokenHash); wake(waiter => waiter.tokenHash === device.tokenHash);
      await save({ kind: 'revoke', hashes: [device.tokenHash] }); return { ok: true };
    },
    async revoke(predicate) {
      const hashes = [...durable.devices, ...registrations].filter(device => predicate({ mode: 'notifications', userId: device.userId, sessionHash: device.sessionHash, bootstrap: device.bootstrap })).map(device => device.tokenHash);
      if (!hashes.length) return;
      for (const value of hashes) revoked.add(value); wake(waiter => hashes.includes(waiter.tokenHash)); await save({ kind: 'revoke', hashes });
    },
    close() { closed = true; wake(); },
  };
}
