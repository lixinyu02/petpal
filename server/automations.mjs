import { createHash, randomUUID } from 'node:crypto';
import {
  ACTIVE_AUTOMATION_STATUSES, BLOCKING_AUTOMATION_STATUSES, AUTOMATION_LIMIT, AUTOMATION_REQUEST_LIMIT, AUTOMATION_RUN_LIMIT,
  automationFailure as fail, automationObject as object, automationUUID as uuid,
  emptyAutomations, nextAutomationRun, normalizeAutomationSchedule, normalizeAutomationSpec,
  publicAutomation, publicAutomationRun, validateStoredAutomations,
} from './automation-schema.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const allowed = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const active = run => ACTIVE_AUTOMATION_STATUSES.includes(run.status);
const blocking = run => BLOCKING_AUTOMATION_STATUSES.includes(run.status);
const scope = job => normalizeAutomationSpec({ prompt: job.prompt, hostId: job.hostId, providerId: job.providerId, projectDirectory: job.projectDirectory, permissions: job.permissions });
const title = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw fail(400, '自动化名称需要 1 到 120 个字符。');
  return value.trim();
};

/** Durable schedules own authorization and claims; browser sessions never do. */
export function createAutomationService({ store, authorize, dispatch, observe = () => null, onAcknowledge, clock = Date.now, redact = value => value, tickMs = 15000, maxLatenessMs = 60000, setInterval: makeTimer = globalThis.setInterval, clearInterval: clearTimer = globalThis.clearInterval }) {
  if (typeof authorize !== 'function' || typeof dispatch !== 'function' || onAcknowledge !== undefined && typeof onAcknowledge !== 'function' || !Number.isInteger(tickMs) || tickMs < 1 || !Number.isFinite(maxLatenessMs) || maxLatenessMs < 0) throw new Error('自动化服务配置无效。');
  let durable = structuredClone(store.state.automations ?? emptyAutomations()), closed = false, started = false, timer, ticking, starting;
  const pending = new Set();
  const acknowledgedSnapshots = new WeakMap();
  const stamp = () => new Date(clock()).toISOString();
  const checkUser = userId => {
    if (closed) throw fail(503, '自动化服务正在退出。');
    const user = store.state.users.find(item => item.id === userId);
    if (!user || user.disabled) throw fail(401, '自动化账号已失效。');
    if (user.agentAccess === 'none') throw fail(403, '账号没有 Agent 权限。');
    return user;
  };
  const checkScope = (userId, spec, online, dispatch = false) => {
    checkUser(userId);
    const result = authorize(userId, structuredClone(spec), { online, dispatch });
    if (result && typeof result.then === 'function') throw fail(500, '自动化授权必须同步完成。');
    return result;
  };
  const find = (data, userId, id) => {
    checkUser(userId);
    const job = data.jobs.find(item => item.id === id && item.userId === userId);
    if (!job) throw fail(404, '自动化不存在。');
    return job;
  };
  const preference = (data, userId) => data.accounts.find(item => item.userId === userId)?.allowAgentCreate ?? true;
  const revise = job => { job.revision = randomUUID(); job.updatedAt = stamp(); };
  const cas = (job, revision) => { if (!uuid(revision)) throw fail(400, '自动化 revision 无效。'); if (job.revision !== revision) throw fail(409, '自动化已变化，请刷新后重试。'); };
  const keepRun = (job, run) => {
    job.runs.push(run);
    if (job.runs.length > AUTOMATION_RUN_LIMIT) {
      const live = job.runs.filter(blocking), recent = job.runs.filter(item => !blocking(item)).slice(-(AUTOMATION_RUN_LIMIT - live.length));
      job.runs = job.runs.filter(item => live.includes(item) || recent.includes(item));
    }
  };
  const receipt = (data, userId, kind, requestId, fingerprint) => {
    const previous = data.requests.find(item => item.userId === userId && item.kind === kind && item.requestId === requestId);
    if (previous && previous.fingerprint !== fingerprint) throw fail(409, 'requestId 已用于另一份内容。');
    if (!previous && data.requests.filter(item => item.userId === userId).length >= AUTOMATION_REQUEST_LIMIT) throw fail(409, '账号的自动化请求回执已达上限，请保留数据并联系管理员整理。');
    return previous;
  };
  const persist = apply => store.save({ automation: { apply } });
  const guardedPersist = (guard, apply) => {
    if (guard !== undefined && typeof guard !== 'function') throw fail(400, '自动化内部授权检查无效。');
    return persist((data, snapshot) => {
      const result = guard?.();
      if (result && typeof result.then === 'function') throw fail(500, '自动化内部授权检查必须同步完成。');
      apply(data, snapshot);
    });
  };
  // This callback is a pure, repeatable snapshot patch. Its live projection is
  // published only after the same atomic replacement as the acknowledgement.
  const patchAcknowledgement = (job, run, snapshot) => {
    if (!onAcknowledge || !run.conversationId) return;
    const conversation = snapshot.conversations.find(item => item.id === run.conversationId && item.userId === job.userId && item.automationId === job.id && (item.automationRunId === undefined || item.automationRunId === run.id));
    if (!conversation) return;
    const callback = onAcknowledge({ job: structuredClone(job), run: structuredClone(run), phase: 'prepare' }, snapshot);
    if (callback && typeof callback.then === 'function') throw fail(500, '未知运行确认必须同步完成。');
    if (conversation.agent) {
      const patches = acknowledgedSnapshots.get(snapshot) ?? [];
      patches.push({ id: conversation.id, userId: job.userId, automationId: job.id, runId: run.id, agent: structuredClone(conversation.agent) });
      acknowledgedSnapshots.set(snapshot, patches);
    }
  };
  const extension = {
    prepare(snapshot, operation) {
      const data = structuredClone(durable);
      for (const job of data.jobs) for (const run of job.runs) if (run.acknowledgedAt) patchAcknowledgement(job, run, snapshot);
      if (operation?.automation) {
        if (!allowed(operation.automation, ['apply']) || typeof operation.automation.apply !== 'function') throw fail(400, '自动化持久化操作无效。');
        operation.automation.apply(data, snapshot);
      }
      snapshot.automations = data;
      validateStoredAutomations(snapshot, { restore: false });
    },
    commit(data, snapshot) {
      durable = structuredClone(data); store.state.automations = structuredClone(data);
      for (const patch of acknowledgedSnapshots.get(snapshot) ?? []) {
        const live = store.state.conversations.find(item => item.id === patch.id && item.userId === patch.userId && item.automationId === patch.automationId && (item.automationRunId === undefined || item.automationRunId === patch.runId));
        if (live && (!live.agent?.run || live.agent.run.submissionId === patch.runId)) live.agent = structuredClone(patch.agent);
      }
      acknowledgedSnapshots.delete(snapshot);
    },
  };
  if (store.automationPersistence) throw new Error('自动化持久化服务已经挂载。');
  store.automationPersistence = extension;

  function authorizePrincipal(auth, entry) {
    if (!object(auth) || auth.bootstrap !== false || !allowed(auth.automation, ['id', 'runId', 'grantId']) || !uuid(auth.automation?.id) || !uuid(auth.automation?.runId) || !uuid(auth.automation?.grantId) || auth.sessionHash !== `automation:${auth.automation.runId}`) throw fail(401, '自动化运行身份无效。');
    const job = find(durable, auth.userId, auth.automation.id), run = job.runs.find(item => item.id === auth.automation.runId && item.grantId === auth.automation.grantId && active(item));
    if (!run) throw fail(401, '自动化运行授权已撤销。');
    if (entry) {
      const content = entry.content ?? entry.prompt, projectDirectory = entry.projectDirectory ?? '';
      const sameAuth = !entry.auth || entry.auth.userId === auth.userId && entry.auth.sessionHash === auth.sessionHash && entry.auth.bootstrap === false && allowed(entry.auth.automation, ['id', 'runId', 'grantId']) && ['id', 'runId', 'grantId'].every(key => entry.auth.automation[key] === auth.automation[key]);
      const samePermissions = allowed(entry.permissions, ['access', 'approval']) && entry.permissions.access === run.snapshot.permissions.access && entry.permissions.approval === run.snapshot.permissions.approval;
      if (!sameAuth || content !== run.snapshot.prompt || entry.hostId !== run.snapshot.hostId || entry.providerId !== run.snapshot.providerId || projectDirectory !== run.snapshot.projectDirectory || !samePermissions || !run.conversationId || entry.conversationId !== run.conversationId) throw fail(403, '自动化任务超出持久运行授权范围。');
      const conversation = store.state.conversations.find(item => item.id === run.conversationId);
      if (!conversation || conversation.userId !== job.userId || conversation.automationId !== job.id || conversation.automationRunId !== undefined && conversation.automationRunId !== run.id) throw fail(403, '自动化结果会话归属无效。');
    }
    checkScope(job.userId, run.snapshot, true);
    return { userId: job.userId, automationId: job.id, runId: run.id, conversationId: run.conversationId, snapshot: structuredClone(run.snapshot) };
  }
  const identity = (job, run) => ({ userId: job.userId, sessionHash: `automation:${run.id}`, bootstrap: false, automation: { id: job.id, runId: run.id, grantId: run.grantId } });
  const message = error => String(redact(error?.message ?? error ?? '自动化执行失败。')).slice(0, 500);
  async function finish(userId, id, runId, outcome) {
    await persist(data => {
      const job = data.jobs.find(item => item.id === id && item.userId === userId), run = job?.runs.find(item => item.id === runId);
      if (!run || !active(run)) return;
      const state = outcome.status;
      if (!['claiming', 'queued', 'running', 'completed', 'error', 'unknown', 'cancelled'].includes(state)) throw fail(500, '自动化执行状态无效。');
      run.status = state;
      if (!active(run)) run.finishedAt = outcome.finishedAt ?? stamp();
      if (outcome.message !== undefined) run.message = message(outcome.message);
      if (['error', 'unknown'].includes(state)) { job.enabled = false; job.nextRunAt = null; }
      revise(job);
    });
  }
  async function execute(userId, id, runId) {
    const job = durable.jobs.find(item => item.id === id && item.userId === userId), run = job?.runs.find(item => item.id === runId && item.status === 'claiming');
    if (!run || closed) return;
    const auth = identity(job, run);
    try {
      authorizePrincipal(auth);
      let bound = false;
      const bindConversation = async conversationId => {
        if (!uuid(conversationId)) throw fail(400, '自动化结果会话标识无效。');
        await persist((data, snapshot) => {
          const currentJob = find(data, userId, id), current = currentJob.runs.find(item => item.id === runId && item.grantId === run.grantId && active(item));
          if (!current) throw fail(401, '自动化运行授权已撤销。');
          checkScope(userId, current.snapshot, true);
          const conversation = snapshot.conversations.find(item => item.id === conversationId);
          if (!conversation || conversation.userId !== userId || conversation.mode !== 'codex' || conversation.automationId !== id || conversation.automationRunId !== undefined && conversation.automationRunId !== runId || current.conversationId && current.conversationId !== conversationId) throw fail(403, '自动化结果会话归属无效。');
          current.conversationId = conversationId; current.status = 'queued'; revise(currentJob);
        });
        authorizePrincipal(auth); bound = true;
      };
      const outcome = await dispatch({ job: structuredClone(job), run: structuredClone(run), auth, bindConversation });
      if (!bound) throw fail(500, '自动化派发没有持久绑定结果会话。');
      if (outcome?.status && outcome.status !== 'queued') await finish(userId, id, runId, outcome);
    } catch (error) {
      // An unconfirmed executor acknowledgement can represent real work.
      await finish(userId, id, runId, { status: error?.code === 'execution_unknown' ? 'unknown' : 'error', message: message(error) });
    }
  }
  function launch(userId, id, runId) {
    if (closed) return Promise.resolve();
    const task = execute(userId, id, runId); pending.add(task);
    void task.finally(() => pending.delete(task)).catch(() => {});
    return task;
  }
  function claim(data, job, trigger, scheduledFor, skipReason) {
    const run = { id: randomUUID(), grantId: randomUUID(), snapshot: scope(job), status: skipReason ? 'skipped' : 'claiming', trigger, scheduledFor, startedAt: stamp(), ...(skipReason ? { finishedAt: stamp(), message: skipReason } : {}) };
    keepRun(job, run);
    if (trigger === 'scheduled') {
      job.nextRunAt = nextAutomationRun(job.schedule, clock(), job.nextRunAt ?? job.createdAt);
      if (job.nextRunAt === null) job.enabled = false;
    }
    revise(job); return run;
  }
  async function scheduled(id, { startup = false } = {}) {
    if (closed) return;
    let claimed;
    await persist(data => {
      if (closed) return;
      const job = data.jobs.find(item => item.id === id);
      if (!job || !job.enabled || !job.nextRunAt || Date.parse(job.nextRunAt) > clock()) return;
      const scheduledFor = job.nextRunAt;
      let reason = startup ? '服务器未运行时错过计划，已跳过，不会补跑。' : clock() - Date.parse(job.nextRunAt) > maxLatenessMs ? '计划已逾期，已跳过，不会补跑。' : job.runs.some(blocking) ? '上次任务尚未完成或状态未知，已跳过本次计划。' : null;
      if (!reason) {
        try { checkScope(job.userId, scope(job), true, true); }
        catch (error) {
          reason = message(error);
          if (!['executor_busy', 'executor_offline'].includes(error.code)) { job.enabled = false; job.nextRunAt = null; }
        }
      }
      // Revoked plans still get a skipped receipt, but retain the pause boundary.
      const paused = !job.enabled;
      const run = claim(data, job, 'scheduled', scheduledFor, reason);
      if (paused) job.nextRunAt = null;
      if (!reason) claimed = { userId: job.userId, id: job.id, runId: run.id };
    });
    if (claimed) await launch(claimed.userId, claimed.id, claimed.runId);
  }
  async function doTick() {
    if (closed) return;
    for (const job of structuredClone(durable.jobs)) {
      if (closed) return;
      for (const run of job.runs.filter(active)) {
        const current = durable.jobs.find(item => item.id === job.id)?.runs.find(item => item.id === run.id);
        if (!current || !active(current) || current.status === 'claiming') continue;
        let outcome;
        try { outcome = await observe({ ...structuredClone(current), automationId: job.id, userId: job.userId }); }
        catch (error) { outcome = { status: 'unknown', message: message(error) }; }
        if (outcome?.status && (outcome.status !== current.status || outcome.message !== undefined && message(outcome.message) !== current.message)) await finish(job.userId, job.id, run.id, outcome);
      }
      const current = durable.jobs.find(item => item.id === job.id);
      if (current?.enabled && current.nextRunAt && Date.parse(current.nextRunAt) <= clock()) await scheduled(job.id);
    }
  }
  const service = {
    list(userId) { checkUser(userId); return { allowAgentCreate: preference(durable, userId), automations: durable.jobs.filter(job => job.userId === userId).map(publicAutomation) }; },
    async create(userId, input, { source = 'user', sourceConversationId, context, guard } = {}) {
      const agent = source === 'agent';
      if (!['user', 'agent'].includes(source) || !allowed(input, ['requestId', 'title', 'prompt', 'schedule', 'enabled', ...(agent ? [] : ['hostId', 'providerId', 'projectDirectory', 'permissions'])]) || !uuid(input.requestId) || input.enabled !== undefined && typeof input.enabled !== 'boolean') throw fail(400, '自动化创建字段或 requestId 无效。');
      if (agent && (!object(context) || !uuid(context.sourceRunId) || !uuid(sourceConversationId))) throw fail(403, 'Agent 自动化缺少真实任务上下文。');
      const spec = normalizeAutomationSpec({ prompt: input.prompt, hostId: agent ? context.hostId : input.hostId, providerId: agent ? context.providerId : input.providerId, projectDirectory: agent ? context.projectDirectory ?? '' : input.projectDirectory === undefined ? '' : input.projectDirectory, permissions: agent ? context.permissions : input.permissions });
      const normalized = { title: title(input.title), ...spec, schedule: normalizeAutomationSchedule(input.schedule), enabled: input.enabled ?? true, source, ...(agent ? { sourceConversationId, sourceRunId: context.sourceRunId } : {}) };
      const fingerprint = hash(normalized); let result;
      await guardedPersist(guard, data => {
        checkUser(userId);
        const previous = receipt(data, userId, 'create', input.requestId, fingerprint);
        if (previous) {
          const existing = data.jobs.find(item => item.id === previous.jobId && item.userId === userId);
          if (!existing) throw fail(410, '该请求创建的自动化已删除，不能重复创建。');
          result = existing; return;
        }
        if (agent) {
          if (!preference(data, userId)) throw fail(403, '账号已关闭 Agent 创建自动化。');
          if (!store.state.conversations.some(item => item.id === sourceConversationId && item.userId === userId && item.mode === 'codex')) throw fail(403, 'Agent 自动化来源会话无效。');
          if (data.requests.filter(item => item.userId === userId && item.kind === 'create' && item.sourceRunId === context.sourceRunId).length >= 10) throw fail(429, '每轮 Agent 最多创建 10 个自动化。');
        }
        if (data.jobs.filter(item => item.userId === userId).length >= AUTOMATION_LIMIT) throw fail(409, '每账号最多保存 50 个自动化。');
        const names = checkScope(userId, spec, false), now = stamp(), nextRunAt = normalized.enabled ? nextAutomationRun(normalized.schedule, clock(), now) : null;
        if (normalized.enabled && !nextRunAt) throw fail(400, '一次性计划必须晚于当前时间。');
        result = { id: randomUUID(), userId, title: normalized.title, ...spec, schedule: normalized.schedule, enabled: normalized.enabled, revision: randomUUID(), createdBy: source, ...(agent ? { sourceConversationId, sourceRunId: context.sourceRunId } : {}), createdAt: now, updatedAt: now, nextRunAt, runs: [] };
        for (const key of ['hostName', 'providerName']) if (typeof names?.[key] === 'string') result[key] = names[key].slice(0, 200);
        data.jobs.push(result); data.requests.push({ userId, kind: 'create', requestId: input.requestId, fingerprint, jobId: result.id, ...(agent ? { sourceRunId: context.sourceRunId } : {}), createdAt: now });
      });
      return publicAutomation(result);
    },
    async update(userId, id, body, { guard } = {}) {
      if (!allowed(body, ['revision', 'title', 'prompt', 'hostId', 'providerId', 'projectDirectory', 'permissions', 'schedule', 'enabled']) || body.enabled !== undefined && typeof body.enabled !== 'boolean') throw fail(400, '自动化编辑字段无效。');
      let result;
      await guardedPersist(guard, data => {
        const job = find(data, userId, id); cas(job, body.revision);
        const spec = normalizeAutomationSpec({ ...scope(job), ...Object.fromEntries(['prompt', 'hostId', 'providerId', 'projectDirectory', 'permissions'].filter(key => body[key] !== undefined).map(key => [key, body[key]])) });
        const names = checkScope(userId, spec, false), schedule = body.schedule === undefined ? job.schedule : normalizeAutomationSchedule(body.schedule), enabled = body.enabled ?? job.enabled;
        if (enabled && job.runs.some(run => run.status === 'unknown')) throw fail(409, '先前执行状态未知，请先核对执行电脑并确认已停止。');
        const reset = body.schedule !== undefined || body.enabled === true && !job.enabled;
        const nextRunAt = enabled ? reset ? nextAutomationRun(schedule, clock(), stamp()) : job.nextRunAt : null;
        if (enabled && !nextRunAt) throw fail(400, '一次性计划必须晚于当前时间。');
        Object.assign(job, spec, { title: body.title === undefined ? job.title : title(body.title), schedule, enabled, nextRunAt });
        for (const key of ['hostName', 'providerName']) if (typeof names?.[key] === 'string') job[key] = names[key].slice(0, 200);
        revise(job); result = job;
      }); return publicAutomation(result);
    },
    async remove(userId, id, body, { guard } = {}) {
      if (!allowed(body, ['revision'])) throw fail(400, '自动化删除字段无效。');
      await guardedPersist(guard, data => { const job = find(data, userId, id); cas(job, body.revision); data.jobs = data.jobs.filter(item => item !== job); });
      return { ok: true };
    },
    async run(userId, id, body, { guard } = {}) {
      if (!allowed(body, ['requestId']) || !uuid(body.requestId)) throw fail(400, '立即运行需要 UUID requestId。');
      const fingerprint = hash({ id }); let result, claimed = false;
      await guardedPersist(guard, data => {
        const job = find(data, userId, id), previous = receipt(data, userId, 'run', body.requestId, fingerprint);
        if (previous) {
          result = job.runs.find(item => item.id === previous.runId);
          if (!result) throw fail(410, '该请求的运行记录已过保留期，不能重复派发。');
          return;
        }
        if (job.runs.some(blocking)) throw fail(409, '自动化已有未完成或状态未知的任务，请先确认已停止。');
        let skipReason;
        try { checkScope(userId, scope(job), true, true); }
        catch (error) { if (!['executor_busy', 'executor_offline'].includes(error.code)) throw error; skipReason = message(error); }
        result = claim(data, job, 'manual', stamp(), skipReason);
        data.requests.push({ userId, kind: 'run', requestId: body.requestId, fingerprint, jobId: id, runId: result.id, createdAt: stamp() }); claimed = !skipReason;
      });
      if (claimed) void launch(userId, id, result.id).catch(() => {});
      return publicAutomationRun(result);
    },
    async preferences(userId, body, { guard } = {}) {
      if (!allowed(body, ['allowAgentCreate']) || typeof body.allowAgentCreate !== 'boolean') throw fail(400, 'Agent 自动化偏好无效。');
      await guardedPersist(guard, data => { checkUser(userId); let account = data.accounts.find(item => item.userId === userId); if (!account) { account = { userId, allowAgentCreate: true }; data.accounts.push(account); } account.allowAgentCreate = body.allowAgentCreate; });
      return { allowAgentCreate: preference(durable, userId) };
    },
    async acknowledge(userId, id, body, { guard } = {}) {
      if (!allowed(body, ['revision', 'runId']) || !uuid(body.runId)) throw fail(400, '确认未知运行需要有效的 runId 与 revision。');
      let result;
      await guardedPersist(guard, (data, snapshot) => {
        const job = find(data, userId, id); cas(job, body.revision);
        const run = job.runs.find(item => item.id === body.runId);
        if (!run || run.status !== 'unknown') throw fail(409, '只有状态未知的运行可以确认停止。');
        run.acknowledgedAt = stamp(); patchAcknowledgement(job, run, snapshot);
        run.status = 'cancelled'; run.finishedAt = run.acknowledgedAt; run.message = '用户已确认先前执行已停止，计划保持暂停，不会自动重派。';
        job.enabled = false; job.nextRunAt = null; revise(job); result = job;
      });
      return publicAutomation(result);
    },
    authorizePrincipal,
    async start() {
      if (closed) throw fail(503, '自动化服务正在退出。');
      if (started) return starting;
      started = true;
      starting = (async () => {
        try {
          await persist(data => { const candidate = { ...store.state, automations: data }; validateStoredAutomations(candidate, { restore: true, clock }); });
          for (const job of structuredClone(durable.jobs)) await scheduled(job.id, { startup: true });
          if (!closed) { timer = makeTimer(() => { void service.tick().catch(() => {}); }, tickMs); timer?.unref?.(); }
        } catch (error) { started = false; throw error; }
        finally { starting = undefined; }
      })();
      await starting;
    },
    tick() {
      if (!ticking) { ticking = doTick(); void ticking.finally(() => { ticking = undefined; }).catch(() => {}); }
      return ticking;
    },
    async close() {
      closed = true;
      if (timer !== undefined) { clearTimer(timer); timer = undefined; }
      await Promise.allSettled([starting, ticking, ...pending].filter(Boolean));
    },
  };
  return service;
}
