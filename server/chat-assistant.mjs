import { createHash, randomUUID } from 'node:crypto';
import { normalizeAgentPermissions } from './agent-permissions.mjs';
import { normalizeAttachmentIds } from './attachments.mjs';

const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
const stamp = () => new Date().toISOString();
const terminal = new Set(['completed', 'cancelled', 'error', 'unknown']);
const statuses = new Set(['deciding', 'queued', 'running', ...terminal]);
const short = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, 500);
const content = (value, attachments = []) => {
  if (typeof value !== 'string' || value.length > 32000 || (!value.trim() && !attachments.length)) throw fail(400, '后台任务需要文字或图片，文字最多 32000 个字符。');
  return value.trim();
};

/** Execution settings come from the user's selection, never model arguments. */
export function normalizeChatAssistant(value, submissionId) {
  if (value === undefined) return null;
  if (!object(value) || Object.keys(value).some(key => !['enabled', 'hostId', 'providerId', 'permissions'].includes(key)) || typeof value.enabled !== 'boolean') throw fail(400, '聊天协作设置无效。');
  if (!value.enabled) return null;
  if (!uuid(submissionId) || value.hostId !== 'central' && !uuid(value.hostId) || value.providerId !== undefined && value.providerId !== null && (typeof value.providerId !== 'string' || !value.providerId || value.providerId.length > 128)) throw fail(400, '请预选执行电脑、Agent 模型和有效的提交编号。');
  return Object.freeze({ hostId: value.hostId, providerId: value.providerId ?? null, permissions: Object.freeze(normalizeAgentPermissions(value.permissions)), submissionId });
}

export const publicAssistantTask = task => Object.fromEntries(['id', 'conversationId', 'hostId', 'hostName', 'status', 'message', 'createdAt', 'finishedAt'].filter(key => task[key] !== undefined).map(key => [key, task[key]]));
export const assistantTasksSnapshot = conversation => (conversation.assistantTasks ?? []).filter(task => task.conversationId || task.status !== 'completed').map(publicAssistantTask);

/** A restart cannot authorize a second model decision or a second Agent submission. */
export function restoreAssistantTasks(conversation, hosts, conversations = []) {
  if (conversation.backgroundParentId !== undefined) {
    const parent = conversations.find(item => item.id === conversation.backgroundParentId);
    if (conversation.mode !== 'codex' || !parent || parent.mode !== 'chat' || parent.userId !== conversation.userId || !parent.assistantTasks?.some(task => task.conversationId === conversation.id)) throw new Error('本地后台 Agent 与聊天归属无效。');
  }
  if (conversation.assistantTasks === undefined) return false;
  if (conversation.mode !== 'chat' || !Array.isArray(conversation.assistantTasks) || conversation.assistantTasks.length > 250) throw new Error('本地聊天协作任务格式无效。');
  let changed = false;
  const ids = new Set(), submissions = new Set(), children = new Set();
  for (const task of conversation.assistantTasks) {
    if (!object(task) || !uuid(task.id) || !uuid(task.submissionId) || ids.has(task.id) || submissions.has(task.submissionId) || !statuses.has(task.status) || !/^[a-f\d]{64}$/.test(task.fingerprint) || !uuid(task.codexRevision) || typeof task.createdAt !== 'string' || typeof task.message !== 'string' || task.message.length > 500 || typeof task.hostName !== 'string' || task.hostName.length > 120 || task.providerId !== null && (typeof task.providerId !== 'string' || !task.providerId || task.providerId.length > 128) ||
      task.hostId !== 'central' && !hosts.some(host => host.id === task.hostId && host.userId === conversation.userId) || !object(task.permissions) || !Array.isArray(task.attachmentIds) || task.finishedAt !== undefined && typeof task.finishedAt !== 'string' || task.resultMessageId !== undefined && !conversation.messages?.some(message => message.id === task.resultMessageId && message.role === 'assistant' && message.assistantTaskId === task.id)) throw new Error('本地聊天协作回执或电脑归属无效。');
    normalizeAgentPermissions(task.permissions); normalizeAttachmentIds(task.attachmentIds);
    if (task.conversationId !== undefined) {
      const child = conversations.find(item => item.id === task.conversationId);
      if (!uuid(task.conversationId) || children.has(task.conversationId) || !child || child.mode !== 'codex' || child.userId !== conversation.userId || child.backgroundParentId !== conversation.id) throw new Error('本地聊天协作子会话归属无效。');
      children.add(task.conversationId);
    } else if (['queued','running'].includes(task.status)) throw new Error('本地聊天协作缺少 Agent 子会话。');
    ids.add(task.id); submissions.add(task.submissionId);
    if (task.status === 'deciding') {
      task.status = 'unknown'; task.message = '服务曾中断，本轮是否派发任务无法确认；不会自动重试。'; task.finishedAt = stamp(); changed = true;
    }
  }
  return changed;
}

export function createChatAssistant({ store, agentTasks, authorize, resolveHost, revision, redact = value => value }) {
  const jobs = new Map(), locks = new Map(), dirty = new Set();
  let closed = false;
  const lock = (id, work) => {
    const previous = locks.get(id) ?? Promise.resolve(), result = previous.catch(() => {}).then(work); locks.set(id, result);
    void result.finally(() => { if (locks.get(id) === result) locks.delete(id); }).catch(() => {}); return result;
  };
  const assertChat = (chat, auth) => {
    if (closed) throw fail(503, '聊天协作正在退出。');
    if (!store.state.conversations.includes(chat) || chat.mode !== 'chat' || chat.userId !== auth.userId) throw fail(404, '聊天协作会话不存在。');
  };
  const fingerprint = (userContent, options, attachmentIds) => createHash('sha256').update(JSON.stringify({ content: userContent, hostId: options.hostId, providerId: options.providerId, permissions: options.permissions, attachmentIds })).digest('hex');
  const find = record => {
    const chat = store.state.conversations.find(item => item.assistantTasks?.includes(record));
    if (!chat) throw fail(404, '聊天协作回执不存在。'); return chat;
  };
  const update = chat => { chat.updatedAt = stamp(); };
  function release(record) { const job=jobs.get(record.id);if(job)clearTimeout(job.expiry);jobs.delete(record.id); }

  async function prepare(chat, auth, options, userContent, attachments = []) {
    const normalized = normalizeChatAssistant({ enabled: true, hostId: options?.hostId, providerId: options?.providerId, permissions: options?.permissions }, options?.submissionId);
    const attachmentIds = normalizeAttachmentIds(attachments), text = content(userContent, attachmentIds), digest = fingerprint(text, normalized, attachmentIds);
    return lock(chat.id, async () => {
      assertChat(chat, auth); const expiresAt=authorize(auth, normalized, chat);
      for (const candidate of store.state.conversations.filter(item => item.userId === auth.userId)) {
        const record = candidate.assistantTasks?.find(task => task.submissionId === normalized.submissionId);
        if (record) {
          if (candidate !== chat || record.fingerprint !== digest) throw fail(409, '该提交编号已用于另一份内容，请刷新后重试。');
          return { record, duplicate: true };
        }
      }
      if ((chat.assistantTasks?.length ?? 0) >= 250) throw fail(400, '本会话协作任务已达上限，请新建聊天。');
      const host = resolveHost(auth.userId, normalized.hostId, { requireOnline: false }), codexRevision=revision();
      if (!uuid(codexRevision)) throw fail(409, '后台 Agent 配置尚未就绪。');
      const record={id:randomUUID(),submissionId:normalized.submissionId,fingerprint:digest,hostId:normalized.hostId,hostName:short(host.hostName).slice(0,120),providerId:normalized.providerId,permissions:{...normalized.permissions},attachmentIds,codexRevision,status:'deciding',message:'正在判断是否需要后台 Agent。',createdAt:stamp()};
      chat.assistantTasks ??= []; chat.assistantTasks.push(record); update(chat);
      try { await store.save(); } catch(error) { chat.assistantTasks.splice(chat.assistantTasks.indexOf(record),1);throw error; }
      const job={...auth,auth:{...auth},options:normalized,record,chat,entry:{conversationId:chat.id,auth:{...auth},hostId:normalized.hostId}};jobs.set(record.id,job);
      if(Number.isFinite(expiresAt)){job.expiry=setTimeout(()=>{void revoke(value=>value===job).catch(()=>{});},Math.max(0,expiresAt-Date.now()));job.expiry.unref?.();}
      return {record,duplicate:false};
    });
  }

  async function dispatch(record, taskText) {
    const text=content(taskText,record.attachmentIds);
    if (!text) throw fail(400,'后台 Agent 指令不能为空。');
    return lock(record.id, async () => {
      const chat=find(record);
      if(record.conversationId||record.status!=='deciding')return publicAssistantTask(record);
      const job=jobs.get(record.id);if(!job)throw fail(409,'本轮登录上下文已结束，不会重新派发。');
      assertChat(chat,job.auth);authorize(job.auth,job.options,chat);resolveHost(job.auth.userId,record.hostId);
      if(revision()!==record.codexRevision)throw fail(409,'Agent 配置已变化，请重新发送。');
      if(store.state.conversations.filter(item=>item.userId===chat.userId).length>=200)throw fail(400,'最多保存 200 个会话，请先删除旧会话。');
      const child={id:randomUUID(),userId:chat.userId,title:`后台任务：${text.slice(0,24)}`,mode:'codex',providerId:null,messages:[],codexRevision:record.codexRevision,backgroundParentId:chat.id,createdAt:stamp(),updatedAt:stamp()};
      store.state.conversations.unshift(child);record.conversationId=child.id;record.message='后台 Agent 正在准备派发。';update(chat);
      try{await store.save();}catch(error){store.state.conversations.splice(store.state.conversations.indexOf(child),1);delete record.conversationId;record.status='error';record.message='保存后台任务失败，尚未派发。';record.finishedAt=stamp();release(record);throw error;}
      try{
        authorize(job.auth,job.options,chat);
        await agentTasks.submit(child,{submissionId:record.id,content:text,attachmentIds:[...record.attachmentIds],permissions:{...job.options.permissions},providerId:job.options.providerId,hostId:job.options.hostId},{...job.auth});
      }catch(error){record.status='error';record.message=short(redact(error?.message||'后台 Agent 任务未能派发。'));record.finishedAt=stamp();update(chat);await store.save();release(record);throw error;}
      await refresh(chat);return publicAssistantTask(record);
    });
  }

  async function finishDecision(record,{message,cancelled=false,error=false}={}) {
    return lock(record.id,async()=>{
      const chat=find(record);
      if(record.conversationId||record.status!=='deciding')return publicAssistantTask(record);
      record.status=error?'error':cancelled?'cancelled':'completed';record.message=short(redact(typeof error==='string'?error:message||(error?'Chat 判断失败，尚未派发电脑任务。':cancelled?'本轮后台判断已停止，尚未派发。':'本轮继续聊天，未派发电脑任务。')));record.finishedAt=stamp();update(chat);await store.save();release(record);return publicAssistantTask(record);
    });
  }

  function childOutcome(record,child) {
    const agent=agentTasks.snapshot(child),run=agent.run?.submissionId===record.id?agent.run:null;
    if(run){return {status:run.status==='stopping'?'running':run.status,message:short(run.error||(['running','stopping'].includes(run.status)?run.message:'')||({running:'后台 Agent 正在执行。',stopping:'后台 Agent 正在停止。',completed:'后台 Agent 已完成。',cancelled:'后台 Agent 已停止。',error:'后台 Agent 执行失败。',unknown:'执行状态未知；不会自动重试。'})[run.status]),run};}
    if(agent.queue?.some(item=>item.submissionId===record.id))return {status:'queued',message:agent.paused?'后台 Agent 队列已暂停。':'后台 Agent 等待执行。'};
    const submission=agent.submissions?.find(item=>item.submissionId===record.id);
    if(submission)return {status:submission.status==='uncertain'||submission.status==='dispatching'?'unknown':submission.status,message:short(submission.error||'后台 Agent 任务已更新。')};
    return {status:record.status,message:record.message};
  }

  async function refresh(chat) {
    return lock(chat.id,async()=>{
      if(!store.state.conversations.includes(chat))throw fail(404,'聊天会话已删除。');
      let changed=false;
      for(const record of chat.assistantTasks??[]){
        if(!record.conversationId)continue;
        const child=store.state.conversations.find(item=>item.id===record.conversationId&&item.userId===chat.userId&&item.backgroundParentId===chat.id);
        if(!child)throw fail(409,'后台 Agent 子会话不存在。');
        const outcome=childOutcome(record,child);
        if(!statuses.has(outcome.status))continue;
        if(record.status!==outcome.status||record.message!==outcome.message){record.status=outcome.status;record.message=outcome.message;changed=true;}
        if(terminal.has(record.status)){
          if(!record.finishedAt){record.finishedAt=outcome.run?.finishedAt||stamp();changed=true;}
          if(!record.resultMessageId){
            const answer=outcome.run?child.messages.findLast(message=>message.agentRunId===outcome.run.id&&message.role==='assistant')?.content:'';
            const full=String(redact(answer||record.message)),result=full.length>16000?`${full.slice(0,16000)}\n\n（结果较长，完整内容可打开后台任务查看。）`:full;
            record.resultMessageId=randomUUID();chat.messages.push({id:record.resultMessageId,role:'assistant',model:'后台 Agent',content:`${record.hostName}：${result}`,status:'complete',createdAt:stamp(),assistantTaskId:record.id});changed=true;
          }
        }
      }
      if(changed){update(chat);dirty.add(chat.id);}
      if(dirty.has(chat.id)){await store.save();dirty.delete(chat.id);}
      for(const record of chat.assistantTasks??[])if(terminal.has(record.status))release(record);
      return assistantTasksSnapshot(chat);
    });
  }

  async function stop(chat,id) {
    const record=chat.assistantTasks?.find(task=>task.id===id);if(!record)throw fail(404,'聊天协作任务不存在。');
    return lock(record.id,async()=>{
      if(record.conversationId){const child=store.state.conversations.find(item=>item.id===record.conversationId&&item.userId===chat.userId);if(!child)throw fail(404,'后台任务不存在。');await agentTasks.stop(child,{clear:true});await refresh(chat);}
      else if(!terminal.has(record.status)){record.status='cancelled';record.message='后台任务已停止，尚未派发。';record.finishedAt=stamp();update(chat);await store.save();release(record);}
      if(terminal.has(record.status))release(record);
      return publicAssistantTask(record);
    });
  }
  async function revoke(predicate) {const matching=[...jobs.values()].filter(predicate);await Promise.all(matching.map(job=>stop(job.chat,job.record.id)));}
  async function close(){closed=true;await revoke(()=>true);await Promise.allSettled([...locks.values()]);}
  return {prepare,dispatch,finishDecision,refresh,stop,revoke,close,snapshot:assistantTasksSnapshot};
}
