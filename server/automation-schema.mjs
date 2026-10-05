import { randomUUID as cryptoRevision } from 'node:crypto';
import { normalizeAgentPermissions } from './agent-permissions.mjs';
import { normalizeProjectDirectory, validateStoredProjectDirectory } from './project-directory.mjs';

export const AUTOMATION_LIMIT = 50, AUTOMATION_RUN_LIMIT = 30, AUTOMATION_REQUEST_LIMIT = 500;
export const ACTIVE_AUTOMATION_STATUSES = Object.freeze(['claiming', 'queued', 'running']);
export const BLOCKING_AUTOMATION_STATUSES = Object.freeze([...ACTIVE_AUTOMATION_STATUSES, 'unknown']);
export const AUTOMATION_STATUSES = Object.freeze([...ACTIVE_AUTOMATION_STATUSES, 'completed', 'error', 'skipped', 'unknown', 'cancelled']);
export const automationFailure = (status, message) => Object.assign(new Error(message), { status });
export const automationObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const automationUUID = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fields = (value, allowed) => automationObject(value) && Object.keys(value).every(key => allowed.includes(key));
export const emptyAutomations = () => ({ version: 1, accounts: [], jobs: [], requests: [] });

/** Require an unambiguous instant and reject Date.parse's calendar normalization. */
export function automationInstant(value) {
  if (typeof value !== 'string') throw automationFailure(400, '自动化时间必须是带时区的 ISO 时间。');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw automationFailure(400, '自动化时间必须是带时区的 ISO 时间。');
  const [, y, m, d, h, minute, second, fraction, zone] = match;
  const calendar = new Date(0); calendar.setUTCFullYear(+y, +m - 1, +d); calendar.setUTCHours(+h, +minute, +second, +(fraction ?? '').padEnd(3, '0'));
  if (calendar.getUTCFullYear() !== +y || calendar.getUTCMonth() !== +m - 1 || calendar.getUTCDate() !== +d || +h > 23 || +minute > 59 || +second > 59) throw automationFailure(400, '自动化日期或时间无效。');
  let offset = 0;
  if (zone !== 'Z') {
    const hours = +zone.slice(1, 3), minutes = +zone.slice(4, 6);
    if (hours > 23 || minutes > 59) throw automationFailure(400, '自动化时区偏移无效。');
    offset = (hours * 60 + minutes) * (zone[0] === '+' ? 1 : -1);
  }
  const timestamp = calendar.getTime() - offset * 60000;
  if (!Number.isFinite(timestamp)) throw automationFailure(400, '自动化时间超出范围。');
  return timestamp;
}

const formatters = new Map();
function formatter(timezone) {
  if (typeof timezone !== 'string' || timezone.length > 100 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(timezone)) throw automationFailure(400, '请选择有效的 IANA 时区。');
  if (!formatters.has(timezone)) {
    let value;
    try { value = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
    catch { throw automationFailure(400, '请选择有效的 IANA 时区。'); }
    if (formatters.size >= 128) formatters.delete(formatters.keys().next().value);
    formatters.set(timezone, value);
  }
  return formatters.get(timezone);
}
function localParts(timestamp, timezone) {
  const values = Object.fromEntries(formatter(timezone).formatToParts(timestamp).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

export function normalizeAutomationSchedule(value) {
  if (!automationObject(value)) throw automationFailure(400, '自动化计划无效。');
  if (value.kind === 'once') {
    if (!fields(value, ['kind', 'at'])) throw automationFailure(400, '一次性计划字段无效。');
    return { kind: 'once', at: new Date(automationInstant(value.at)).toISOString() };
  }
  if (value.kind === 'interval') {
    if (!fields(value, ['kind', 'minutes']) || !Number.isInteger(value.minutes) || value.minutes < 5 || value.minutes > 10080) throw automationFailure(400, '间隔须为 5 到 10080 的整数分钟。');
    return { kind: 'interval', minutes: value.minutes };
  }
  if (!['daily', 'weekly'].includes(value.kind) || !fields(value, ['kind', 'time', 'timezone', ...(value.kind === 'weekly' ? ['weekdays'] : [])]) || typeof value.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)) throw automationFailure(400, '每日或每周计划需要 HH:mm 时间。');
  formatter(value.timezone);
  const result = { kind: value.kind, time: value.time, timezone: value.timezone };
  if (value.kind === 'weekly') {
    if (!Array.isArray(value.weekdays) || !value.weekdays.length || value.weekdays.length > 7 || value.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(value.weekdays).size !== value.weekdays.length) throw automationFailure(400, '每周计划需要不重复的星期 0 到 6。');
    result.weekdays = [...value.weekdays].sort((a, b) => a - b);
  }
  return result;
}

/** Resolve a civil minute by actual zone offsets; missing minutes have no instant.
 * A repeated minute selects its first instant, even when that instant has passed. */
function civilInstant(date, hour, minute, timezone) {
  const naive = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
  const offsets = new Set();
  for (let delta = -36; delta <= 36; delta += 6) {
    const sample = naive + delta * 3600000, p = localParts(sample, timezone);
    offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - sample);
  }
  const matches = [];
  for (const offset of offsets) {
    const instant = naive - offset, p = localParts(instant, timezone);
    if (p.year === date.getUTCFullYear() && p.month === date.getUTCMonth() + 1 && p.day === date.getUTCDate() && p.hour === hour && p.minute === minute && p.second === 0) matches.push(instant);
  }
  return matches.length ? Math.min(...matches) : null;
}

export function nextAutomationRun(schedule, after, anchor = after) {
  schedule = normalizeAutomationSchedule(schedule);
  const timestamp = typeof after === 'string' ? automationInstant(after) : Number(after);
  if (!Number.isFinite(timestamp)) throw automationFailure(400, '计划计算时间无效。');
  if (schedule.kind === 'once') return automationInstant(schedule.at) > timestamp ? schedule.at : null;
  if (schedule.kind === 'interval') {
    const origin = typeof anchor === 'string' ? automationInstant(anchor) : Number(anchor), period = schedule.minutes * 60000;
    if (!Number.isFinite(origin)) throw automationFailure(400, '计划间隔起点无效。');
    return new Date(origin + Math.max(1, Math.floor((timestamp - origin) / period) + 1) * period).toISOString();
  }
  const p = localParts(timestamp, schedule.timezone), date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const [hour, minute] = schedule.time.split(':').map(Number);
  for (let day = 0; day < 370; day++, date.setUTCDate(date.getUTCDate() + 1)) {
    if (schedule.kind === 'weekly' && !schedule.weekdays.includes(date.getUTCDay())) continue;
    const instant = civilInstant(date, hour, minute, schedule.timezone);
    if (instant !== null && instant > timestamp) return new Date(instant).toISOString();
  }
  throw automationFailure(400, '无法计算下一次自动化时间。');
}

export function normalizeAutomationSpec(input) {
  if (!fields(input, ['prompt', 'hostId', 'providerId', 'projectDirectory', 'permissions']) || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 32000 || input.hostId !== 'central' && !automationUUID(input.hostId) || input.providerId !== null && (typeof input.providerId !== 'string' || !input.providerId || input.providerId.length > 128)) throw automationFailure(400, '自动化指令、电脑或模型无效。');
  let projectDirectory = input.projectDirectory === undefined ? '' : input.projectDirectory;
  if (projectDirectory !== '') {
    validateStoredProjectDirectory(projectDirectory);
    projectDirectory = normalizeProjectDirectory(projectDirectory, /^[a-zA-Z]:[\\/]/.test(projectDirectory) ? 'win32' : 'linux');
  }
  if (projectDirectory !== '' && typeof projectDirectory !== 'string') throw automationFailure(400, '自动化项目目录无效。');
  return { prompt: input.prompt.trim(), hostId: input.hostId, providerId: input.providerId, projectDirectory, permissions: normalizeAgentPermissions(input.permissions) };
}

export function publicAutomationRun(run) {
  return Object.fromEntries(['id', 'status', 'trigger', 'scheduledFor', 'startedAt', 'finishedAt', 'conversationId', 'message'].filter(key => run[key] !== undefined).map(key => [key, structuredClone(run[key])]));
}
export function publicAutomation(job) {
  const result = Object.fromEntries(['id', 'title', 'prompt', 'hostId', 'providerId', 'projectDirectory', 'permissions', 'schedule', 'enabled', 'revision', 'createdBy', 'sourceConversationId', 'createdAt', 'updatedAt', 'nextRunAt', 'hostName', 'providerName'].filter(key => job[key] !== undefined).map(key => [key, structuredClone(job[key])]));
  result.runs = job.runs.map(publicAutomationRun); return result;
}

/** Validate without clearing corrupt records or replaying interrupted work. */
export function validateStoredAutomations(state, { restore = true, clock = Date.now } = {}) {
  if (state.automations === undefined) { state.automations = emptyAutomations(); return true; }
  const data = state.automations, users = new Set(state.users.map(user => user.id));
  const invalid = () => { throw new Error('本地自动化数据无效，请保留数据并检查备份。'); };
  if (!fields(data, ['version', 'accounts', 'jobs', 'requests']) || data.version !== 1 || !Array.isArray(data.accounts) || !Array.isArray(data.jobs) || !Array.isArray(data.requests)) invalid();
  const accounts = new Set(), ids = new Set(), runIds = new Set(), grants = new Set(), requestIds = new Set(); let changed = false;
  const stamp = value => { try { automationInstant(value); return true; } catch { return false; } };
  const storedSpec = value => {
    const normalized = normalizeAutomationSpec(value);
    if (typeof value.projectDirectory !== 'string' || !fields(value.permissions, ['access', 'approval']) || value.permissions.access !== normalized.permissions.access || value.permissions.approval !== normalized.permissions.approval) invalid();
  };
  for (const account of data.accounts) {
    if (!fields(account, ['userId', 'allowAgentCreate']) || !users.has(account.userId) || accounts.has(account.userId) || typeof account.allowAgentCreate !== 'boolean') invalid();
    accounts.add(account.userId);
  }
  for (const job of data.jobs) {
    if (!fields(job, ['id', 'userId', 'title', 'prompt', 'hostId', 'providerId', 'projectDirectory', 'permissions', 'schedule', 'enabled', 'revision', 'createdBy', 'sourceConversationId', 'sourceRunId', 'createdAt', 'updatedAt', 'nextRunAt', 'runs', 'hostName', 'providerName']) || !automationUUID(job.id) || ids.has(job.id) || !users.has(job.userId) || typeof job.title !== 'string' || !job.title.trim() || job.title.length > 120 || typeof job.enabled !== 'boolean' || !automationUUID(job.revision) || !['user', 'agent'].includes(job.createdBy) || job.sourceConversationId !== undefined && !automationUUID(job.sourceConversationId) || job.sourceRunId !== undefined && !automationUUID(job.sourceRunId) || !stamp(job.createdAt) || !stamp(job.updatedAt) || job.nextRunAt !== null && !stamp(job.nextRunAt) || !Array.isArray(job.runs) || job.runs.length > AUTOMATION_RUN_LIMIT || job.hostName !== undefined && (typeof job.hostName !== 'string' || job.hostName.length > 200) || job.providerName !== undefined && (typeof job.providerName !== 'string' || job.providerName.length > 200)) invalid();
    ids.add(job.id);
    try {
      storedSpec({ prompt: job.prompt, hostId: job.hostId, providerId: job.providerId, projectDirectory: job.projectDirectory, permissions: job.permissions }); normalizeAutomationSchedule(job.schedule);
      if (job.hostId !== 'central' && !state.executionHosts.some(host => host.id === job.hostId && host.userId === job.userId)) invalid();
      if (job.sourceConversationId && state.conversations.some(item => item.id === job.sourceConversationId && item.userId !== job.userId)) invalid();
    } catch { invalid(); }
    let blockingCount = 0;
    for (const run of job.runs) {
      if (!fields(run, ['id', 'grantId', 'snapshot', 'status', 'trigger', 'scheduledFor', 'startedAt', 'finishedAt', 'conversationId', 'message', 'acknowledgedAt']) || !automationUUID(run.id) || runIds.has(run.id) || !automationUUID(run.grantId) || grants.has(run.grantId) || !AUTOMATION_STATUSES.includes(run.status) || !['scheduled', 'manual'].includes(run.trigger) || !stamp(run.scheduledFor) || !stamp(run.startedAt) || run.finishedAt !== undefined && !stamp(run.finishedAt) || run.acknowledgedAt !== undefined && (!stamp(run.acknowledgedAt) || run.status !== 'cancelled') || run.conversationId !== undefined && !automationUUID(run.conversationId) || run.message !== undefined && (typeof run.message !== 'string' || run.message.length > 500)) invalid();
      try { storedSpec(run.snapshot); } catch { invalid(); }
      if (run.conversationId) {
        const conversation = state.conversations.find(item => item.id === run.conversationId);
        if (conversation && (conversation.userId !== job.userId || conversation.automationId !== job.id || conversation.automationRunId !== undefined && conversation.automationRunId !== run.id)) invalid();
      }
      runIds.add(run.id); grants.add(run.grantId);
      if (BLOCKING_AUTOMATION_STATUSES.includes(run.status)) blockingCount++;
      if (ACTIVE_AUTOMATION_STATUSES.includes(run.status)) {
        if (restore) {
          run.status = 'unknown'; run.finishedAt = new Date(clock()).toISOString(); run.message = '服务已重启，先前任务状态未知，不会自动重试。';
          job.enabled = false; job.nextRunAt = null; job.revision = cryptoRevision(); job.updatedAt = run.finishedAt; changed = true;
        }
      }
    }
    if (blockingCount > 1) invalid();
  }
  for (const userId of users) if (data.jobs.filter(job => job.userId === userId).length > AUTOMATION_LIMIT || data.requests.filter(request => request.userId === userId).length > AUTOMATION_REQUEST_LIMIT) invalid();
  for (const request of data.requests) {
    const key = `${request.userId}:${request.kind}:${request.requestId}`;
    if (!fields(request, ['userId', 'kind', 'requestId', 'fingerprint', 'jobId', 'runId', 'sourceRunId', 'createdAt']) || !users.has(request.userId) || !['create', 'run'].includes(request.kind) || !automationUUID(request.requestId) || requestIds.has(key) || !/^[a-f0-9]{64}$/.test(request.fingerprint) || !automationUUID(request.jobId) || request.kind === 'run' && !automationUUID(request.runId) || request.kind === 'create' && request.runId !== undefined || request.sourceRunId !== undefined && !automationUUID(request.sourceRunId) || !stamp(request.createdAt)) invalid();
    requestIds.add(key);
    const job = data.jobs.find(item => item.id === request.jobId);
    if (job && job.userId !== request.userId) invalid();
  }
  return changed;
}
