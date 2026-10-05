import {projectDirectoryIssue,projectDirectoryValue,readProjectDirectory,saveProjectDirectory} from './project-directory-preferences.mjs';
const prefix = 'petpal.chat-assistant.';
const hostId = value => typeof value === 'string' && value.length <= 160 ? value : '';
const providerId = value => typeof value === 'string' && value.length <= 160 ? value : '';

/** Remember the user's target, never permission to run tasks. */
export function readChatAssistantPreferences(storage, scope) {
  if (!scope) return {hostId:'',providerId:''};
  try {
    const value=JSON.parse(storage?.getItem(prefix+encodeURIComponent(scope))||'null');
    const selectedHost=hostId(value?.hostId),directory=readProjectDirectory(storage,scope,selectedHost);
    return {hostId:selectedHost,providerId:providerId(value?.providerId),...(directory?{projectDirectory:directory}:{})};
  } catch { return {hostId:'',providerId:''}; }
}
export function saveChatAssistantPreferences(storage, scope, value) {
  if (!scope) return;
  try { storage?.setItem(prefix+encodeURIComponent(scope),JSON.stringify({hostId:hostId(value.hostId),providerId:providerId(value.providerId)})); } catch {}
  saveProjectDirectory(storage,scope,hostId(value.hostId),value.projectDirectory||'');
}
export function restoreChatAssistantPreferences(storage, scope, defaultHostId) {
  const value=readChatAssistantPreferences(storage,scope),saved=hostId(defaultHostId);
  return saved?chatAssistantForHost(value,saved,storage,scope):value;
}
export function chatAssistantDefaultIssue(value, defaultHostId) {
  if(!value.hostId)return '请先选择默认执行电脑。';
  return value.hostId===defaultHostId?'':'请先将这台电脑保存为账号的默认执行电脑。';
}
export function chatAssistantTargetIssue(value, hosts, providers=[], owner=false) {
  const selected=hosts.find(host=>host.id===value.hostId);
  if (!value.hostId) return '先选择一台执行电脑。';
  if (!selected?.online) return '所选电脑已离线，聊天照常继续；请在该电脑登录小伴。';
  if (selected.codex?.available===false) return '这台电脑的 Agent 暂不可用，请检查桌面客户端和 Codex 连接。';
  if (!value.providerId&&!owner) return '请选择管理员分配的 Agent 模型。';
  if (value.providerId&&!providers.some(item=>item.id===value.providerId)) return '此前选择的 Agent 模型已不可用，请重新选择。';
  return '';
}
export function snapshotChatAssistant(value, allowed, hosts, defaultHostId) {
  if (!allowed||!value.enabled) return undefined;
  if (!hostId(value.hostId)) throw new Error('请先选择默认执行电脑，再启用 Chat + Agent。');
  if(defaultHostId!==undefined){const issue=chatAssistantDefaultIssue(value,defaultHostId);if(issue)throw new Error(issue);}
  const directory=projectDirectoryValue(value.projectDirectory);
  if(value.projectDirectory&&(typeof value.projectDirectory!=='string'||value.projectDirectory.length>4096||/[\x00-\x1f\x7f]/.test(value.projectDirectory)||directory!==value.projectDirectory.trim()))throw new Error('项目目录格式无效，请重新设置。');
  if(directory&&hosts){const issue=projectDirectoryIssue(directory,hosts.find(host=>host.id===value.hostId));if(issue)throw new Error(issue);}
  return {enabled:true,hostId:hostId(value.hostId),providerId:providerId(value.providerId)||null,permissions:{access:value.permissions.access,approval:value.permissions.approval},...(directory?{projectDirectory:directory}:{})};
}
export function chatAssistantForHost(value, selectedHost, storage, scope) {
  return {...value,hostId:hostId(selectedHost),projectDirectory:readProjectDirectory(storage,scope,hostId(selectedHost))};
}
export function mergeAssistantTask(tasks, task) {
  if (!task||typeof task.id!=='string'||!task.id||!['deciding','queued','running','completed','cancelled','error','unknown'].includes(task.status)) return tasks;
  const previous=tasks.find(item=>item.id===task.id);
  // An older running event must not overwrite an already terminal result.
  if (previous&&['completed','cancelled','error','unknown'].includes(previous.status)&&['deciding','queued','running'].includes(task.status)) return tasks;
  if (previous?.status==='running'&&['deciding','queued'].includes(task.status)) return tasks;
  if (previous?.status==='queued'&&task.status==='deciding') return tasks;
  return previous?tasks.map(item=>item.id===task.id?{...item,...task}:item):[...tasks,task];
}
export function mergeChatAssistantConversation(before,updated,activeId,busy) {
  const assistantTasks=(updated.assistantTasks||[]).reduce(mergeAssistantTask,before.assistantTasks||[]);
  // A parent poll can have started before the next Chat reply began or completed.
  const replacing=(!busy||activeId!==before.id)&&updated.messages.length>=before.messages.length&&!updated.messages.some(message=>message.status==='streaming');
  // Durable background reports may arrive while the foreground reply is streaming.
  // Merge only new reports; an older stream snapshot must never replace local text.
  const ids=new Set(before.messages.map(message=>message.id));
  const reports=updated.messages.filter(message=>message.role==='assistant'&&message.assistantTaskId&&message.status==='complete'&&!ids.has(message.id));
  return {...before,assistantTasks,messages:replacing?updated.messages:reports.length?[...before.messages,...reports]:before.messages};
}

/** Timer-delivered task reports can follow the current Chat reply in the same snapshot. */
export function foregroundAssistantMessage(conversation, messageId) {
  const ordinary=message=>message.role==='assistant'&&!message.assistantTaskId&&!message.assistantTaskReport;
  return messageId?conversation?.messages?.find(message=>message.id===messageId&&ordinary(message)):conversation?.messages?.findLast(ordinary);
}
