const prefix = 'petpal.chat-assistant.';
const hostId = value => typeof value === 'string' && value.length <= 160 ? value : '';
const providerId = value => typeof value === 'string' && value.length <= 160 ? value : '';

/** Remember the user's target, never permission to run tasks. */
export function readChatAssistantPreferences(storage, scope) {
  if (!scope) return {hostId:'',providerId:''};
  try {
    const value=JSON.parse(storage?.getItem(prefix+encodeURIComponent(scope))||'null');
    return {hostId:hostId(value?.hostId),providerId:providerId(value?.providerId)};
  } catch { return {hostId:'',providerId:''}; }
}
export function saveChatAssistantPreferences(storage, scope, value) {
  if (!scope) return;
  try { storage?.setItem(prefix+encodeURIComponent(scope),JSON.stringify({hostId:hostId(value.hostId),providerId:providerId(value.providerId)})); } catch {}
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
export function snapshotChatAssistant(value, allowed) {
  if (!allowed||!value.enabled||!hostId(value.hostId)) return undefined;
  return {enabled:true,hostId:hostId(value.hostId),providerId:providerId(value.providerId)||null,permissions:{access:value.permissions.access,approval:value.permissions.approval}};
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
  return {...before,assistantTasks,messages:replacing?updated.messages:before.messages};
}
