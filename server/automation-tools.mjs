import { normalizeAutomationSchedule } from './automation-schema.mjs';

const failure = (status, message) => Object.assign(new Error(message), { status });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const names = new Set(['petpal_automation_list', 'petpal_automation_create', 'petpal_automation_pause']);
export const isAutomationTool = name => names.has(name);

const schedule = { oneOf: [
  { type: 'object', properties: { kind: { const: 'once' }, at: { type: 'string' } }, required: ['kind', 'at'], additionalProperties: false },
  { type: 'object', properties: { kind: { const: 'daily' }, time: { type: 'string' }, timezone: { type: 'string' } }, required: ['kind', 'time', 'timezone'], additionalProperties: false },
  { type: 'object', properties: { kind: { const: 'weekly' }, time: { type: 'string' }, timezone: { type: 'string' }, weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, minItems: 1, maxItems: 7, uniqueItems: true } }, required: ['kind', 'time', 'timezone', 'weekdays'], additionalProperties: false },
  { type: 'object', properties: { kind: { const: 'interval' }, minutes: { type: 'integer', minimum: 5, maximum: 10080 } }, required: ['kind', 'minutes'], additionalProperties: false },
] };
export const automationToolSpecs = [
  { type: 'function', name: 'petpal_automation_list', description: '查看当前账号的自动化及最新 revision。范围仅限当前账号；不执行任务。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'petpal_automation_create', description: '保存定时 Agent 任务。执行电脑、模型、项目和权限固定继承本轮实际任务，不能指定其他范围。requestId 为一次创建的 UUID v4；确认结果时保持原 requestId 和全部参数，不创建新 ID 重试。服务器或电脑离线时跳过，不补跑。每轮最多创建 10 项。', inputSchema: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 120 }, prompt: { type: 'string', minLength: 1, maxLength: 32000 }, schedule, enabled: { type: 'boolean' }, requestId: { type: 'string', format: 'uuid' } }, required: ['title', 'prompt', 'schedule', 'requestId'], additionalProperties: false } },
  { type: 'function', name: 'petpal_automation_pause', description: '暂停当前账号的一项自动化，仅停止未来计划，不取消已运行任务。先 list 读取当前 revision；不更改执行范围，也不启动任务。', inputSchema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, revision: { type: 'string', format: 'uuid' } }, required: ['id', 'revision'], additionalProperties: false } },
];

export function validateAutomationTool(name, args) {
  if (!isAutomationTool(name) || !object(args)) throw failure(400, '自动化工具名称或参数无效。');
  const allowed = name === 'petpal_automation_list' ? [] : name === 'petpal_automation_pause' ? ['id', 'revision'] : ['title', 'prompt', 'schedule', 'enabled', 'requestId'];
  if (Object.keys(args).some(key => !allowed.includes(key))) throw failure(400, '自动化工具不接受身份、电脑、模型或权限覆盖。');
  if (name === 'petpal_automation_create') {
    if (!uuid(args.requestId) || typeof args.title !== 'string' || !args.title.trim() || args.title.length > 120 || typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 32000 || !object(args.schedule) || args.enabled !== undefined && typeof args.enabled !== 'boolean') throw failure(400, '自动化创建参数或 requestId 无效。');
    const keys = { once: ['kind', 'at'], daily: ['kind', 'time', 'timezone'], weekly: ['kind', 'time', 'timezone', 'weekdays'], interval: ['kind', 'minutes'] }[args.schedule.kind];
    if (!keys || Object.keys(args.schedule).length !== keys.length || Object.keys(args.schedule).some(key => !keys.includes(key))) throw failure(400, '自动化时间规则无效。');
    normalizeAutomationSchedule(args.schedule);
  } else if (name === 'petpal_automation_pause' && (!uuid(args.id) || !uuid(args.revision))) throw failure(400, '暂停需要有效的自动化 id 和 revision。');
  return args;
}

export function describeAutomationTool(name, args, entry) {
  validateAutomationTool(name, args);
  let description = name === 'petpal_automation_list' ? '读取当前账号的自动化列表。' : name === 'petpal_automation_pause'
    ? `暂停自动化 ${args.id}（revision ${args.revision}），仅影响未来计划。`
    : `创建自动化：${args.title}\n时间：${JSON.stringify(args.schedule)}\n启用：${args.enabled !== false ? '是' : '否'}\n执行范围固定继承本轮，不自动提升权限或切换电脑。\n${entry ? `电脑：${entry.hostName || entry.hostId || '当前电脑'}；模型：${entry.model || '当前模型'}；项目：${entry.projectDirectory || '默认工作区'}；权限：${JSON.stringify(entry.permissions)}\n` : ''}完整任务指令：\n${args.prompt}`;
  // Both local and remote approval UIs have the same bound. Refuse oversized
  // review text instead of presenting a truncated instruction for approval.
  if (description.length > 8000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(description)) throw failure(400, '自动化操作详情超过审批长度或含无效字符，请缩短完整指令。');
  return { description, approvalRequired: name !== 'petpal_automation_list', accessRequired: 'read-only' };
}

/** The wrapper is bound before Codex caches its tool catalogue. Run context is
 * resolved internally; model arguments never select an identity or execution scope. */
export function withAutomationTools(base, { resolveContext, execute } = {}) {
  if ((base?.specs ?? []).some(spec => isAutomationTool(spec.name))) throw new Error('自动化工具重复注册。');
  return {
    ...base,
    specs: [...(base?.specs ?? []), ...automationToolSpecs],
    describe(name, args, call) {
      if (!isAutomationTool(name)) return base.describe(name, args, call);
      const context = resolveContext?.(call);
      return describeAutomationTool(name, args, context?.entry ?? context);
    },
    async execute(name, args, call) {
      if (!isAutomationTool(name)) return base.execute(name, args, call);
      validateAutomationTool(name, args); call?.signal?.throwIfAborted();
      const context = resolveContext?.(call);
      const guard = () => { call?.signal?.throwIfAborted(); resolveContext?.(call); };
      const result = await execute(name, args, { ...call, context, guard });
      call?.signal?.throwIfAborted(); resolveContext?.(call);
      return result;
    },
  };
}

export async function executeAutomationTool(service, entry, name, args, { signal, guard: authorize } = {}) {
  const guard = () => { signal?.throwIfAborted(); authorize?.(); };
  validateAutomationTool(name, args); guard();
  if (!entry?.auth?.userId || !entry.id || !entry.conversationId) throw failure(401, '自动化工具不属于当前实际任务。');
  if (name === 'petpal_automation_create') return { ok: true, automation: await service.create(entry.auth.userId, args, { source: 'agent', sourceConversationId: entry.conversationId, context: { sourceRunId: entry.id, hostId: entry.hostId ?? 'central', providerId: entry.providerId ?? null, projectDirectory: entry.projectDirectory ?? '', permissions: entry.permissions }, guard }) };
  if (name === 'petpal_automation_pause') return { ok: true, automation: await service.update(entry.auth.userId, args.id, { revision: args.revision, enabled: false }, { guard }) };
  const listing = await service.list(entry.auth.userId);
  // A compact catalogue remains useful even with 50 long task instructions.
  // Full prompts and bounded run history are available in the account UI.
  return { ok: true, allowAgentCreate: listing.allowAgentCreate, automations: listing.automations.map(({ id, title, schedule, enabled, revision, nextRunAt, hostId, hostName, providerId, providerName, projectDirectory, permissions, runs }) => ({ id, title, schedule, enabled, revision, nextRunAt, hostId, hostName, providerId, providerName, projectDirectory, permissions, ...(runs?.length ? { latestRun: runs.at(-1) } : {}) })) };
}
