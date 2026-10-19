import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tokenHash, secureEqual } from './auth.mjs';
import { createExecutorRelayRedactor } from './executor-relay.mjs';
import { MODEL_REQUEST_BYTES } from './model-request-limits.mjs';
import { normalizeProjectDirectory } from './project-directory.mjs';
import { describeAutomationTool, validateAutomationTool } from './automation-tools.mjs';
import { approvalReviewCapability, validApprovalReview } from './approval-review.mjs';
import { canAccessExecutionHost } from './user-roles.mjs';
import { normalizeUserInputQuestions, normalizeUserInputAnswer, userInputAnswerSecrets } from './user-input.mjs';

const failure = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const unknown = () => failure(409, '执行电脑已断开，任务执行状态未知；队列已暂停，不会自动重试。', 'execution_unknown');
// Keep the existing message-only event compatible with old strict central servers.
// Only the fixed, sanitized desktop marker enables the optional repair hint.
const missingContext = 'CLI 会话上下文已丢失，请保留聊天记录并重置 Agent 上下文。';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const text = (value, maximum = 256) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
const contentText = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = () => new Date().toISOString();
const userInputUnsupported = () => failure(409, '这台执行电脑尚不支持用户提问，请升级桌面客户端。', 'user_input_unsupported');
const inputTimes = data => typeof data.requestedAt === 'string' && data.requestedAt.length <= 40 && typeof data.expiresAt === 'string' && data.expiresAt.length <= 40 && Number.isFinite(Date.parse(data.requestedAt)) && Number.isFinite(Date.parse(data.expiresAt)) && Date.parse(data.expiresAt) > Date.parse(data.requestedAt) && Date.parse(data.expiresAt) - Date.parse(data.requestedAt) <= 10 * 60 * 1000;

export function validateExecutionHosts(state) {
  if (state.executionHosts === undefined) { state.executionHosts = []; return true; }
  if (!Array.isArray(state.executionHosts) || state.executionHosts.length > state.users.length * 32) throw new Error('执行电脑索引无效。');
  const ids = new Set(), devices = new Set();
  for (const host of state.executionHosts) {
    const device = `${host?.userId}:${host?.deviceId}`;
    if (!fields(host, ['id','userId','deviceId','kind','name','platform','arch','createdAt','lastSeenAt']) || host.kind!==undefined&&!['desktop','docker'].includes(host.kind) || host.kind==='docker'&&(host.platform!=='linux'||host.deviceId!==host.id) || !uuid(host.id) || !uuid(host.deviceId) || !state.users.some(user => user.id === host.userId) || !text(host.name, 120) || !['win32','linux','darwin'].includes(host.platform) || !text(host.arch, 32) || !text(host.createdAt, 40) || !text(host.lastSeenAt, 40) || ids.has(host.id) || devices.has(device)) throw new Error('执行电脑归属或数据无效。');
    ids.add(host.id); devices.add(device);
  }
  return false;
}

/** Central coordinator. Sessions are credentials; client type is never authorization. */
export function createExecutors({ store, authorizeSession, authorizeEntry, readAttachment, getConfig, getConfigForUser, getReviewConfig, automationTool, redact = value => value,
  fetchImpl = fetch, leaseMs = 30000, pollMs = 20000, commandMs = 20000, stopMs = 10000, clock = Date.now } = {}) {
  const connections = new Map(), current = new Map();
  const userConfig = userId => typeof getConfigForUser === 'function' ? getConfigForUser(userId) : getConfig();
  let closed = false, registration = Promise.resolve();
  const localHost = { id: 'central', name: '中央服务器', kind: 'central', platform: process.platform, online: true };
  const hostFor = (userId, id) => {
    if (!canAccessExecutionHost(store.state, userId, id)) throw failure(403, id === 'central' ? '中央服务器仅管理员可以执行，请选择自己登录的 PC 客户端。' : '无权访问这台执行电脑，请选择自己登录的 PC 客户端。', 'executor_forbidden');
    if (id === 'central') return localHost;
    const host = store.state.executionHosts.find(item => item.id === id);
    if (!host) throw failure(404, '执行电脑不存在或不属于当前账号。');
    return host;
  };
  const live = connection => {
    if (closed || !connection || current.get(connection.host.id) !== connection.id || connection.expiresAt <= clock()) throw failure(409, '执行电脑连接已过期，请重新登录客户端。', 'executor_offline');
    authorizeSession(connection.auth);
    return connection;
  };
  const verify = (id, auth) => {
    const connection = connections.get(id);
    if (!connection || connection.auth.userId !== auth.userId || connection.auth.sessionHash !== auth.sessionHash) throw failure(404, '执行电脑连接不存在。');
    return live(connection);
  };
  const wake = connection => { connection.waiter?.(); };
  const scrubRun = (run, value) => {
    const secrets = [...run.secrets].sort((a, b) => b.length - a.length);
    let mask = '[已隐藏]';
    if (secrets.some(secret => [...mask].some(character => secret.includes(character)))) { let point = 0xe000; while (secrets.some(secret => secret.includes(String.fromCodePoint(point)))) point++; mask = String.fromCodePoint(point).repeat(3); }
    if (typeof value === 'string') { for (const secret of secrets) value = value.split(secret).join(mask); return value; }
    if (Array.isArray(value)) return value.map(item => scrubRun(run, item));
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubRun(run, item)]));
    return value;
  };
  const emitDelta = (run, value, finish = false) => {
    const text = (run.deltaTail || '') + value; let tail = 0;
    if (!finish) for (const secret of run.secrets) for (let size = Math.min(secret.length - 1, text.length); size > tail; size--) { if (text.endsWith(secret.slice(0, size))) { tail = size; break; } }
    run.deltaTail = tail ? text.slice(-tail) : '';
    const ready = text.slice(0, text.length - tail);
    if (ready && !run.stopping) run.args.onEvent?.('delta', { text: scrubRun(run, redact(ready)) });
  };
  const closeInputs = run => {
    for (const [id, input] of run.userInputs) {
      clearTimeout(input.timer);
      if (!['resolved', 'expired'].includes(input.state)) run.args.onEvent?.('user-input-resolved', { id });
      input.state = 'resolved';
    }
  };
  const settle = (run, error, result) => {
    if (run.settled) return;
    run.settled = true; clearTimeout(run.ackTimer); clearTimeout(run.stopTimer); clearTimeout(run.expiryTimer);
    closeInputs(run); run.secrets.clear(); run.approvalMetadata.clear();
    run.args.signal?.removeEventListener('abort', run.abort);
    for (const request of run.relays) request.abort();
    for (const command of run.pending.values()) { clearTimeout(command.timer); command.reject(error ?? failure(409, '任务已结束。')); }
    run.pending.clear(); run.connection.commands = run.connection.commands.filter(command => command.runId !== run.id);
    if (run.connection.run === run) run.connection.run = null;
    run.tokenHash = ''; run.attachments.clear(); delete run.reviewConfig;
    if (error) run.reject(error); else run.resolve(result);
  };
  const offline = connection => {
    if (!connection) return;
    connection.host.lastSeenAt = connection.lastSeenAt;
    if (current.get(connection.host.id) === connection.id) current.delete(connection.host.id);
    if (connection.run) settle(connection.run, unknown());
    connection.commands = []; wake(connection);
    connections.delete(connection.id);
    // Persist once at disconnect, not for every heartbeat. A metadata write
    // failure does not authorize reconnect/replay; live state remains offline.
    void store.save().catch(() => {});
  };
  const checkRun = (run, { stopping = false } = {}) => {
    live(run.connection); authorizeEntry(run.entry);
    if (run.settled || (!stopping && run.stopping) || run.expiresAt <= clock()) throw failure(409, '执行凭据已失效。');
    if (getConfig(run.entry)?.revision !== run.entry.codexRevision) throw failure(409, '模型配置已变化。');
  };
  const sweep = () => { for (const connection of connections.values()) { try { live(connection); } catch { offline(connection); } } };
  const timer = setInterval(sweep, Math.min(1000, leaseMs)); timer.unref();
  const list = userId => {
    sweep();
    const config = userConfig(userId);
    return [...(canAccessExecutionHost(store.state, userId, 'central') ? [localHost] : []), ...store.state.executionHosts.filter(host => host.kind!=='docker'&&canAccessExecutionHost(store.state, userId, host.id)).map(host => ({ id: host.id, name: host.name, platform: host.platform, kind: 'desktop', online: current.has(host.id), isOwn: host.userId === userId, owner: Object.fromEntries(['id', 'username', 'displayName'].map(key => [key, store.state.users.find(user => user.id === host.userId)[key]])), lastSeenAt: current.has(host.id) ? connections.get(current.get(host.id)).lastSeenAt : host.lastSeenAt,
      codex: { available: current.has(host.id), authenticated: current.has(host.id), configured: config?.mode === 'api' && Boolean(config.model), supportsSteer: true, userInput: current.has(host.id) && connections.get(current.get(host.id)).capabilities.userInput === true, approvalReview: approvalReviewCapability(true, current.has(host.id) && connections.get(current.get(host.id)).capabilities.approvalReview === true, current.has(host.id) && connections.get(current.get(host.id)).capabilities.independentReviewModel === true), projectDirectory: current.has(host.id) && connections.get(current.get(host.id)).capabilities.projectDirectory === true, automations: Boolean(automationTool) && current.has(host.id) && connections.get(current.get(host.id)).capabilities.automations === true, mode: 'api', model: config?.model, executionMode: 'remote-cli' } }))];
  };
  const target = (userId, id = 'central', projectDirectory, permissions, entry) => {
    const host = hostFor(userId, id);
    const directory = normalizeProjectDirectory(projectDirectory, host.platform);
    if (id !== 'central') {
      const connection = live(connections.get(current.get(id)));
      if (entry && (entry.auth?.userId !== userId || entry.hostId !== id)) throw failure(403, '任务执行电脑或账号不匹配。');
      const config = entry ? getConfig(entry) : userConfig(userId);
      if (config?.mode !== 'api' || !config.model) throw failure(409, '远程电脑执行需要可用的 Responses API 或本机官方账号模型。');
      if (directory && connection.capabilities.projectDirectory !== true) throw failure(409, '这台执行电脑尚不支持项目目录，请升级桌面客户端或使用默认目录。', 'executor_project_directory_unsupported');
      if (permissions?.approval === 'review' && connection.capabilities.approvalReview !== true) throw failure(409, '这台执行电脑尚不支持新版替我审批，请升级客户端或改为需要时询问。', 'executor_approval_review_unsupported');
      if (permissions?.approval === 'review' && permissions.reviewProviderId && connection.capabilities.independentReviewModel !== true) throw failure(409, '这台执行电脑尚不支持独立命令审查模型，请升级客户端。', 'executor_review_model_unsupported');
    }
    return { hostId: host.id, hostName: host.name };
  };
  const isBusy = (userId, id) => { hostFor(userId, id); if (id === 'central') return false; return Boolean(live(connections.get(current.get(id))).run); };
  async function register(auth, body) {
    if (!fields(body, ['deviceId','name','platform','arch','capabilities']) || !uuid(body.deviceId) || !text(body.name, 120) || !['win32','linux','darwin'].includes(body.platform) || !text(body.arch, 32) ||
        body.capabilities !== undefined && (!fields(body.capabilities, ['projectDirectory', 'automations', 'approvalReview', 'independentReviewModel', 'userInput']) || body.capabilities.projectDirectory !== true || ['automations', 'approvalReview', 'independentReviewModel', 'userInput'].some(key => body.capabilities[key] !== undefined && body.capabilities[key] !== true) || body.capabilities.independentReviewModel === true && body.capabilities.approvalReview !== true)) throw failure(400, '执行电脑注册字段无效。');
    const metadata = Object.fromEntries(['deviceId','name','platform','arch'].map(key => [key, body[key]]));
    const capabilities = { projectDirectory: body.capabilities?.projectDirectory === true, automations: body.capabilities?.automations === true, approvalReview: body.capabilities?.approvalReview === true, independentReviewModel: body.capabilities?.independentReviewModel === true, userInput: body.capabilities?.userInput === true };
    const work = registration.catch(() => {}).then(async () => {
      authorizeSession(auth); if (closed) throw failure(503, '执行服务正在退出。');
      let host = store.state.executionHosts.find(item => item.userId === auth.userId && item.deviceId === body.deviceId);
      if (!host) {
        if (store.state.executionHosts.filter(item => item.userId === auth.userId).length >= 32) throw failure(409, '每个账号最多登记 32 台执行电脑。');
        host = { id: randomUUID(), userId: auth.userId, ...metadata, createdAt: stamp(), lastSeenAt: stamp() }; store.state.executionHosts.push(host);
      } else Object.assign(host, metadata, { lastSeenAt: stamp() });
      // Superseding a connection is a stop boundary, never permission to replay.
      offline(connections.get(current.get(host.id)));
      host.lastSeenAt = stamp();
      await store.save(); authorizeSession(auth); if (closed) throw failure(503, '执行服务正在退出。');
      const connection = { id: randomUUID(), host, capabilities, auth: { ...auth }, expiresAt: clock()+leaseMs, lastSeenAt: stamp(), commands: [], run: null, recent: new Map(), waiter: null, polling: false };
      connections.set(connection.id, connection); current.set(host.id, connection.id);
      return { hostId: host.id, connectionId: connection.id, leaseMs, pollMs, ...((capabilities.automations && automationTool || capabilities.approvalReview || capabilities.userInput) ? { capabilities: { ...(capabilities.automations && automationTool ? { automations: true } : {}), ...(capabilities.approvalReview ? { approvalReview: true } : {}), ...(capabilities.independentReviewModel ? { independentReviewModel: true } : {}), ...(capabilities.userInput ? { userInput: true } : {}) } } : {}) };
    }); registration = work; return work;
  }
  const heartbeat = (id, auth) => { const connection = verify(id, auth); connection.expiresAt = clock()+leaseMs; connection.lastSeenAt = stamp(); return { ok: true, leaseMs }; };
  async function poll(id, auth, signal) {
    const connection = verify(id, auth);
    if (connection.polling) throw failure(409, '此执行连接已有取件请求。');
    connection.polling = true;
    try {
      if (!connection.commands.length) await new Promise(resolve => {
        let waitTimer;
        const finish = () => { clearTimeout(waitTimer); signal?.removeEventListener('abort', finish); if (connection.waiter === finish) connection.waiter = null; resolve(); };
        connection.waiter = finish; waitTimer = setTimeout(finish, pollMs); signal?.addEventListener('abort', finish, { once: true }); if (signal?.aborted) finish();
      });
      verify(id, auth); signal?.throwIfAborted();
      const command = connection.commands.shift();
      if (command?.type === 'run' && connection.run?.id === command.runId) connection.run.dispatched = true;
      return { commands: command ? [command] : [] };
    } finally { connection.polling = false; }
  }
  const disconnect = (id, auth) => { const connection = verify(id, auth); offline(connection); return { ok: true }; };
  const descriptors = async (run, ids) => {
    const result = [];
    for (const id of ids) {
      const { record, bytes } = await readAttachment(run.entry.auth.userId, id);
      checkRun(run); const item = { id, mimeType: record.mimeType, size: bytes.length, sha256: hash(bytes) };
      run.attachments.set(id, item); result.push(item);
    }
    return result;
  };
  const enqueue = (run, command) => {
    live(run.connection);
    if (run.connection.commands.length >= 8) throw failure(429, '执行电脑命令队列已满。');
    run.connection.commands.push(command); wake(run.connection);
  };
  const rpc = (run, type, data) => {
    checkRun(run); const id = randomUUID();
    return new Promise((resolve, reject) => {
      const pending = { type, resolve, reject, timer: setTimeout(() => { run.pending.delete(id); run.connection.commands = run.connection.commands.filter(command => command.id !== id); reject(failure(409, '无法确认命令是否已送达，不会自动重试。', 'command_delivery_uncertain')); }, commandMs) };
      run.pending.set(id, pending);
      try { enqueue(run, { id, type, runId: run.id, ...data }); } catch (error) { clearTimeout(pending.timer); run.pending.delete(id); reject(error); }
    });
  };
  function bind(entry) {
    target(entry.auth.userId, entry.hostId, entry.projectDirectory, entry.permissions, entry);
    const connection = live(connections.get(current.get(entry.hostId)));
    const projectDirectory = normalizeProjectDirectory(entry.projectDirectory, connection.host.platform);
    if (projectDirectory && !['full', 'workspace'].includes(entry.projectAccess)) throw failure(400, '项目目录授权无效。', 'project_directory_invalid');
    let boundRun;
    return {
      hostId: entry.hostId, connectionId: connection.id,
      async run(args) {
        live(connection); authorizeEntry(entry);
        target(entry.auth.userId, entry.hostId, projectDirectory, args.permissions ?? entry.permissions, entry);
        if (args.projectDirectory !== undefined && normalizeProjectDirectory(args.projectDirectory, connection.host.platform) !== projectDirectory ||
            args.projectAccess !== undefined && args.projectAccess !== entry.projectAccess) throw failure(409, '任务项目目录或授权已变化，请重新提交。');
        if (connection.run) throw failure(409, '这台电脑正在执行其他任务，请稍后重试。');
        const independentReview = entry.permissions?.approval === 'review' && entry.permissions.reviewProviderId;
        const reviewConfig = independentReview && typeof getReviewConfig === 'function' ? getReviewConfig(entry) : undefined;
        if (independentReview && (!reviewConfig || !text(reviewConfig.model, 160) || reviewConfig.model !== entry.reviewModel)) throw failure(409, '命令审查模型配置不可用，请重新提交。');
        let resolve, reject; const done = new Promise((yes, no) => { resolve = yes; reject = no; }); done.catch(() => {});
        const token = randomBytes(32).toString('base64url');
        const run = boundRun = { id: entry.id, connection, entry, args, resolve, reject, done, ...(reviewConfig ? { reviewConfig: Object.freeze({ ...reviewConfig }) } : {}), tokenHash: tokenHash(token), expiresAt: clock()+60*60*1000, attachments: new Map(), relays: new Set(), automationCalls: new Map(), automationApprovalCalls: new Map(), automationApprovals: new Map(), automationGrants: new Map(), pending: new Map(), approvals: new Map(), approvalMetadata: new Map(), userInputs: new Map(), secrets: new Set(), sequence: 0, eventHash: '', started: false, dispatched: false, stopping: false, settled: false };
        connection.run = run; connection.recent.set(run.id, run); while (connection.recent.size > 32) connection.recent.delete(connection.recent.keys().next().value);
        run.abort = () => {
          if (run.settled || run.stopping) return; run.stopping = true; closeInputs(run);
          for (const request of run.relays) request.abort();
          if (!run.dispatched) { settle(run, Object.assign(new Error('任务派发前已停止。'), { name: 'AbortError' })); return; }
          try { enqueue(run, { id: randomUUID(), type: 'stop', runId: run.id }); } catch { settle(run, unknown()); return; }
          run.stopTimer = setTimeout(() => settle(run, unknown()), stopMs);
        };
        args.signal?.addEventListener('abort', run.abort, { once: true });
        run.expiryTimer = setTimeout(run.abort, 60*60*1000);
        try {
          checkRun(run); args.signal?.throwIfAborted();
          const attachments = await descriptors(run, entry.attachmentIds);
          checkRun(run); args.signal?.throwIfAborted();
          enqueue(run, { id: randomUUID(), type: 'run', runId: run.id, conversationId: args.conversationId, prompt: args.prompt, ...(args.threadId ? { threadId: args.threadId } : {}), ...(projectDirectory ? { projectDirectory, projectAccess: entry.projectAccess } : {}), ...(connection.capabilities.automations && automationTool ? { automationTools: true } : {}), permissions: args.permissions, model: entry.model, ...(reviewConfig ? { reviewModel: reviewConfig.model } : {}), effort: entry.effort, codexRevision: entry.codexRevision, relayToken: token, attachments });
          run.ackTimer = setTimeout(() => settle(run, run.dispatched ? unknown() : failure(409, '执行电脑未领取任务；任务未自动重试。')), commandMs);
        } catch (error) { settle(run, error); }
        return done;
      },
      async steer({ expectedTurnId, content, attachmentIds = [] }) {
        const run = boundRun; if (!run || run.settled) throw failure(409, '此任务已结束。', 'turn_not_active');
        checkRun(run); const attachments = await descriptors(run, attachmentIds); return rpc(run, 'steer', { expectedTurnId, content, attachments });
      },
      async approve(id, decision) {
        const run = boundRun, approvalId = run?.approvals.get(id);
        if (!approvalId) throw failure(404, '审批请求已失效。');
        if (!['accept', 'decline'].includes(decision)) throw failure(400, '审批决定无效。');
        const metadata = run.approvalMetadata.get(id);
        if (metadata?.expiresAt && Date.parse(metadata.expiresAt) <= clock()) throw failure(404, '审批请求已过期。');
        if (decision === 'accept' && metadata?.canAccept === false) throw failure(400, '该审批请求不能允许，只能拒绝。');
        const automation = run.automationApprovals.get(id);
        if (automation) {
          checkRun(run);
          run.automationGrants.set(automation.callId, { fingerprint: automation.fingerprint, decision, used: false });
          run.automationApprovals.delete(id);
        }
        const result = rpc(run, 'approve', { approvalId, decision });
        // One decision attempt consumes the central approval. An uncertain
        // acknowledgement must not leave a button that resends the operation.
        run.approvals.delete(id); run.approvalMetadata.delete(id); run.args.onEvent?.('approval-resolved', { id });
        return result;
      },
      async replyUserInput(id, body) {
        const run = boundRun;
        if (!connection.capabilities.userInput) throw userInputUnsupported();
        if (!run) throw failure(404, '用户提问已结束。');
        checkRun(run);
        const input = run.userInputs.get(id);
        if (!input) throw failure(404, '用户提问不存在或已过期。');
        const answer = normalizeUserInputAnswer(input.questions, body), fingerprint = hash(JSON.stringify(answer));
        if (input.fingerprint) {
          if (input.fingerprint !== fingerprint) throw failure(409, '这条提问已提交另一份回答。', 'user_input_conflict');
          return input.promise;
        }
        if (input.state !== 'pending' || Date.parse(input.expiresAt) <= clock()) throw failure(404, '用户提问不存在或已过期。', 'user_input_expired');
        for (const secret of userInputAnswerSecrets(input.questions, answer)) run.secrets.add(secret);
        input.fingerprint = fingerprint; input.state = 'sending';
        input.promise = rpc(run, 'user-input', { inputId: input.remoteId, answer: body.skip === true ? { skip: true } : answer }).then(result => {
          if (!['resolved', 'expired'].includes(input.state)) { input.state = 'resolved'; clearTimeout(input.timer); run.args.onEvent?.('user-input-resolved', { id }); }
          return result;
        });
        return input.promise;
      },
    };
  }
  function events(id, auth, body) {
    const connection = verify(id, auth);
    if (!fields(body, ['runId','sequence','event','data']) || !uuid(body.runId) || !Number.isSafeInteger(body.sequence) || body.sequence < 1 || !text(body.event, 40) || !object(body.data) || JSON.stringify(body).length > 65536) throw failure(400, '执行事件格式无效。');
    const run = connection.recent.get(body.runId);
    if (!run) throw failure(404, '执行任务不存在。');
    const digest = hash(JSON.stringify(body));
    if (body.sequence === run.sequence && digest === run.eventHash) return { ok: true };
    if (run.settled || body.sequence !== run.sequence+1) throw failure(409, '执行事件序号无效或任务已经结束。');
    const { event, data } = body; let questions;
    if (!run.started && event !== 'started' && event !== 'error' && event !== 'stopped') throw failure(409, '执行器必须先确认领取任务。');
    if (!run.stopping) checkRun(run);
    const emit = (name, value) => { if (!run.stopping) run.args.onEvent?.(name, scrubRun(run, redact(value))); };
    // Validate every variant before applying its sequence or touching callbacks.
    if (event === 'started') { if (run.started || Object.keys(data).length) throw failure(400, '任务领取回执无效。'); }
    else if (event === 'thread' || event === 'turn') { const key = event+'Id'; if (!fields(data,[key]) || !text(data[key],200)) throw failure(400,'执行标识无效。'); }
    else if (event === 'delta') { if (!fields(data,['text']) || typeof data.text !== 'string' || data.text.length > 32000) throw failure(400,'执行文本无效。'); }
    else if (event === 'status') { if (!fields(data,['message','text','state','approvalReview']) || ['message','text','state'].some(key => data[key] !== undefined && (typeof data[key] !== 'string' || data[key].length > 1000)) || data.approvalReview !== undefined && (!connection.capabilities.approvalReview || !validApprovalReview(data.approvalReview))) throw failure(400,'执行状态无效。'); }
    else if (event === 'approval') {
      if (!fields(data, ['id','kind','description','requestedAt','expiresAt','canAccept', ...(data.kind === 'automation' ? ['automation'] : [])]) || !text(data.id,200) || !text(data.kind,80) || !contentText(data.description,8000) ||
          (['requestedAt','expiresAt','canAccept'].some(key => Object.hasOwn(data,key)) && (!connection.capabilities.userInput || !inputTimes(data) || typeof data.canAccept !== 'boolean'))) throw failure(400,'执行审批无效。');
      if (data.kind === 'automation') {
        if (!automationTool || !connection.capabilities.automations || !fields(data.automation, ['callId','name','arguments']) || !text(data.automation.callId,256) || !object(data.automation.arguments) || JSON.stringify(data.automation.arguments).length > 16384) throw failure(400, '自动化审批必须包含本轮工具完整参数。');
        validateAutomationTool(data.automation.name, data.automation.arguments);
        const description = describeAutomationTool(data.automation.name, data.automation.arguments, run.entry);
        if (!description.approvalRequired || run.automationApprovalCalls.has(data.automation.callId) || run.automationApprovalCalls.size >= 128) throw failure(409, '自动化审批 callId 已处理或超过本轮上限。');
      }
    }
    else if (event === 'user-input') {
      if (!connection.capabilities.userInput) throw userInputUnsupported();
      if (!fields(data, ['id','questions','requestedAt','expiresAt']) || !text(data.id,200) || !inputTimes(data) || Date.parse(data.expiresAt) > clock() + 600000) throw failure(400,'用户提问事件无效。');
      questions = normalizeUserInputQuestions(data.questions);
      if (run.userInputs.size >= 128 || [...run.userInputs.values()].some(input => input.remoteId === data.id)) throw failure(409,'用户提问标识重复或超过上限。');
    }
    else if (event === 'user-input-resolved') { if (!connection.capabilities.userInput || !fields(data,['id']) || !text(data.id,200)) throw failure(400,'用户提问回执无效。'); }
    else if (event === 'approval-resolved') { if (!fields(data,['id']) || !text(data.id,200)) throw failure(400,'执行审批回执无效。'); }
    else if (event === 'complete') { if (!fields(data,['threadId','text']) || (data.threadId !== undefined && !text(data.threadId,200)) || (data.text !== undefined && (typeof data.text !== 'string' || data.text.length > 32000))) throw failure(400,'完成回执无效。'); }
    else if (event === 'error') { if (!fields(data,['message']) || !contentText(data.message,500)) throw failure(400,'失败回执无效。'); }
    else if (event === 'stopped') { if (Object.keys(data).length) throw failure(400,'停止回执无效。'); }
    else if (event === 'command-result') { if (!fields(data,['commandId','ok','code','message','turnId']) || !uuid(data.commandId) || typeof data.ok !== 'boolean' || (data.code !== undefined && !text(data.code,80)) || (data.message !== undefined && !text(data.message,500)) || (data.turnId !== undefined && !text(data.turnId,200))) throw failure(400,'命令回执无效。'); }
    else throw failure(400,'不支持的执行事件。');
    run.sequence = body.sequence; run.eventHash = digest;
    if (['complete','error','stopped'].includes(event)) emitDelta(run, '', true);
    if (event === 'started') { run.started = true; clearTimeout(run.ackTimer); }
    else if (event === 'complete') settle(run, run.stopping ? Object.assign(new Error('任务已停止。'),{name:'AbortError'}) : null, scrubRun(run, redact(data)));
    else if (event === 'error') settle(run, failure(data.message === missingContext ? 409 : 502, String(scrubRun(run, redact(data.message))).slice(0,500), data.message === missingContext ? 'thread_context_missing' : undefined));
    else if (event === 'stopped') settle(run, Object.assign(new Error('执行电脑已确认任务停止。'),{name:'AbortError'}));
    else if (event === 'command-result') {
      const pending = run.pending.get(data.commandId);
      if (pending) { clearTimeout(pending.timer); run.pending.delete(data.commandId); if (data.ok) pending.resolve({ok:true,...(pending.type !== 'user-input' && data.turnId ? {turnId:data.turnId} : {})}); else pending.reject(failure(409, '执行命令未完成。', data.code === 'turn_not_active' || pending.type === 'steer' && data.code === 'steer_unsupported' || pending.type === 'user-input' && ['user_input_expired','user_input_conflict','user_input_unsupported','user_input_invalid'].includes(data.code) ? data.code : 'command_delivery_uncertain')); }
    } else if (event === 'approval') {
      if (run.approvals.size >= 128 || [...run.approvals.values()].includes(data.id)) { settle(run, unknown()); throw failure(409,'审批标识重复或超过上限。'); }
      const approval = randomUUID(); run.approvals.set(approval,data.id);
      if (Object.hasOwn(data,'canAccept')) run.approvalMetadata.set(approval, { requestedAt:data.requestedAt, expiresAt:data.expiresAt, canAccept:data.canAccept });
      if (data.kind === 'automation') {
        const request = data.automation, fingerprint = hash(JSON.stringify({ name: request.name, arguments: request.arguments }));
        run.automationApprovalCalls.set(request.callId, fingerprint);
        run.automationApprovals.set(approval, { callId: request.callId, fingerprint });
        // The central account sees a description recomputed from the fixed run
        // scope and complete parameters, never a client-provided review summary.
        emit(event, { id: approval, kind: 'automation', description: describeAutomationTool(request.name, request.arguments, run.entry).description, ...(run.approvalMetadata.get(approval) ?? {}) });
      } else emit(event,{...data,id:approval});
    } else if (event === 'approval-resolved') { const approval = [...run.approvals].find(([,remote]) => remote === data.id)?.[0]; if (approval) { run.approvals.delete(approval); run.approvalMetadata.delete(approval); emit(event,{id:approval}); } }
    else if (event === 'user-input' && !run.stopping) {
      const id = randomUUID(), input = { remoteId:data.id, questions, requestedAt:data.requestedAt, expiresAt:data.expiresAt, state:'pending' };
      run.userInputs.set(id,input);
      emit(event,{ id, questions, requestedAt:input.requestedAt, expiresAt:input.expiresAt });
      input.timer = setTimeout(() => {
        if (!['resolved','expired'].includes(input.state)) {
          input.state='expired'; emit('user-input-resolved',{id});
          emit('status',{state:'stopping',message:'等待回答已超时，正在请求执行电脑停止任务。'});
          // A host with a slow clock may still be awaiting input. Request the
          // existing stop protocol; only its real receipt can prove it stopped.
          run.abort();
        }
      }, Math.max(0,Date.parse(input.expiresAt)-clock())); input.timer.unref?.();
    }
    else if (event === 'user-input-resolved') { const id = [...run.userInputs].find(([,input]) => input.remoteId === data.id)?.[0]; if (id) { const input=run.userInputs.get(id); clearTimeout(input.timer); if (!['resolved','expired'].includes(input.state)) { input.state='resolved'; emit(event,{id}); } } }
    else if (event === 'delta') emitDelta(run,data.text);
    else emit(event,data);
    return { ok: true };
  }
  const bearerRun = (connectionId, runId, authorization) => {
    const run = connections.get(connectionId)?.run;
    if (!run || run.id !== runId || typeof authorization !== 'string' || !authorization.startsWith('Bearer ') || authorization.length > 200 || !secureEqual(tokenHash(authorization.slice(7)),run.tokenHash)) throw failure(401,'执行凭据无效或已过期。');
    checkRun(run); return run;
  };
  async function automation(connectionId, runId, authorization, body) {
    const run = bearerRun(connectionId, runId, authorization);
    if (!automationTool || !run.connection.capabilities.automations || !run.started || !run.dispatched) throw failure(409, '当前执行电脑尚不支持自动化工具，请升级客户端。');
    if (!fields(body, ['callId', 'name', 'arguments']) || !text(body.callId, 256) || !object(body.arguments) || JSON.stringify(body).length > 20000) throw failure(400, '自动化工具回调格式无效。');
    validateAutomationTool(body.name, body.arguments);
    const fingerprint = hash(JSON.stringify({ name: body.name, arguments: body.arguments }));
    const previous = run.automationCalls.get(body.callId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw failure(409, '工具 callId 已用于另一份请求。');
      const result = await previous.promise; checkRun(run); return result;
    }
    if (body.name !== 'petpal_automation_list' && run.entry.permissions.approval !== 'auto') {
      const grant = run.automationGrants.get(body.callId);
      if (!grant || grant.decision !== 'accept' || grant.used || grant.fingerprint !== fingerprint) throw failure(403, '自动化写操作需要当前账号确认完整参数，缺少本轮有效审批。');
      grant.used = true;
    }
    if (run.automationCalls.size >= 128) throw failure(429, '本轮自动化工具请求超过上限。');
    const controller = new AbortController(); run.relays.add(controller);
    // Reserve the exact call before crossing the async mutation boundary. A
    // missing reply never authorizes a second mutation under the same callId.
    const promise = Promise.resolve().then(async () => {
      checkRun(run); controller.signal.throwIfAborted();
      const result = await automationTool(body.name, body.arguments, { entry: run.entry, callId: body.callId, signal: controller.signal, guard: () => { checkRun(run); controller.signal.throwIfAborted(); } });
      checkRun(run); controller.signal.throwIfAborted(); return result;
    }).finally(() => { run.relays.delete(controller); });
    run.automationCalls.set(body.callId, { fingerprint, promise });
    return promise;
  }
  async function attachment(connectionId, runId, id, authorization) {
    const run = bearerRun(connectionId,runId,authorization), expected = run.attachments.get(id);
    if (!expected) throw failure(404,'图片不属于当前任务。');
    const value = await readAttachment(run.entry.auth.userId,id); checkRun(run);
    if (hash(value.bytes) !== expected.sha256) throw failure(409,'图片已变化。'); return value;
  }
  async function relay(req,res,{review = false} = {}) {
    const run = bearerRun(req.params.connectionId,req.params.runId,req.headers.authorization);
    if (!Buffer.isBuffer(req.body) || req.body.length > MODEL_REQUEST_BYTES || req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw failure(400,'模型请求格式无效。');
    let body; try { body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(req.body)); } catch { throw failure(400,'模型请求格式无效。'); }
    const config=review ? run.reviewConfig : getConfig(run.entry);
    if (review && (!config || run.entry.permissions?.approval !== 'review' || !run.entry.permissions.reviewProviderId)) throw failure(403,'此任务没有独立审查模型授权。');
    if (!object(body) || body.stream !== true || body.model !== (review ? run.entry.reviewModel : run.entry.model) || run.relays.size >= 2) throw failure(400,'模型请求不属于当前任务。');
    if(!config || !review && config.mode!=='api') throw failure(409,'中央 API 模型不可用。');
    if (review) {
      const reasoning = object(body.reasoning) ? { ...body.reasoning } : {};
      delete reasoning.effort;
      if (config.reasoningEffort) reasoning.effort = config.reasoningEffort;
      if (Object.keys(reasoning).length) body.reasoning = reasoning; else delete body.reasoning;
    }
    const controller=new AbortController(), signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);run.relays.add(controller);
    const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnected);
    let idle=setTimeout(()=>controller.abort(),30000), output=0, safeOutput=0;
    const reset=()=>{clearTimeout(idle);idle=setTimeout(()=>controller.abort(),30000);};
    const secrets = [...new Set([config.apiKey, ...run.secrets].filter(Boolean))].sort((a,b)=>b.length-a.length);
    if (!secrets.length) secrets.push('');
    // Each stage preserves SSE and buffers partial text prefixes. Only the first
    // stage adapts cumulative model deltas; later stages solely remove secrets.
    const redactors=secrets.map((secret,index)=>createExecutorRelayRedactor({secret,model:index===0?(review ? run.entry.reviewModel : run.entry.model):''}));
    const filtered=(frames,start)=>{for(let index=start;index<redactors.length;index++)frames=frames.flatMap(frame=>redactors[index].push(Buffer.from(frame)));return frames;};
    const write=async frame=>{
      checkRun(run);signal.throwIfAborted();safeOutput+=Buffer.byteLength(frame);if(safeOutput>24*1024*1024)throw failure(502,'模型响应超过限制。');
      if(!res.write(frame))await new Promise((resolve,reject)=>{const cleanup=()=>{res.off('drain',ready);signal.removeEventListener('abort',cancel);};const ready=()=>{cleanup();resolve();};const cancel=()=>{cleanup();reject(new Error('模型请求停止。'));};res.once('drain',ready);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
    };
    try {
      const response=await fetchImpl(`${config.baseUrl.replace(/\/$/,'')}/responses`,{method:'POST',redirect:'manual',credentials:'omit',signal,headers:{'Content-Type':'application/json',Accept:'text/event-stream','Accept-Encoding':'identity',...(config.apiKey?{Authorization:`Bearer ${config.apiKey}`}:{})},body:JSON.stringify(body)});
      checkRun(run);reset();
      if(response.status!==200||response.redirected||!response.body||!/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw failure(502,'中央模型服务没有返回有效流。');}
      res.status(200).set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
      for await(const chunk of response.body){checkRun(run);signal.throwIfAborted();reset();output+=chunk.length;if(output>24*1024*1024)throw failure(502,'模型响应超过限制。');for(const frame of filtered(redactors[0].push(chunk),1))await write(frame);}
      for(let index=0;index<redactors.length;index++)for(const frame of filtered(redactors[index].finish(),index+1))await write(frame);
      checkRun(run);res.end();
    }catch{if(!res.headersSent)res.status(502).json({error:'中央模型请求未完成。'});else res.destroy();}
    finally{clearTimeout(idle);controller.abort();res.off('close',disconnected);run.relays.delete(controller);}
  }
  const revoke = predicate => { for (const connection of [...connections.values()]) if (predicate(connection.auth)) offline(connection); };
  const close = async () => { closed=true;clearInterval(timer);for(const connection of [...connections.values()])offline(connection);await registration.catch(()=>{}); };
  return { register,heartbeat,poll,disconnect,events,list,target,isBusy,bind,attachment,relay,automation,revoke,close,hostFor };
}
