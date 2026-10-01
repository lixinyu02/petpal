const prefix = 'petpal.agent-project.';
const maximumHosts = 12;
const hostId = value => typeof value === 'string' && value.length > 0 && value.length <= 160 ? value : '';
export const projectDirectoryValue = value => typeof value === 'string' && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : '';

function entries(storage, scope) {
  if (!scope) return [];
  try {
    const value = JSON.parse(storage?.getItem(prefix + encodeURIComponent(scope)) || 'null');
    return Array.isArray(value) ? value.slice(0, maximumHosts).filter(item => hostId(item?.hostId) && typeof item?.directory === 'string' && projectDirectoryValue(item.directory) === item.directory) : [];
  } catch { return []; }
}
/** A directory preference belongs to one service instance, account and execution computer. */
export function readProjectDirectory(storage, scope, selectedHost) {
  return hostId(selectedHost) ? entries(storage, scope).find(item => item.hostId === selectedHost)?.directory || '' : '';
}
export function saveProjectDirectory(storage, scope, selectedHost, directory) {
  if (!scope || !hostId(selectedHost)) return;
  const normalized = projectDirectoryValue(directory);
  if (typeof directory !== 'string' || directory.length>4096 || /[\x00-\x1f\x7f]/.test(directory) || normalized !== directory.trim()) return;
  try {
    const value = [{ hostId: selectedHost, directory: normalized }, ...entries(storage, scope).filter(item => item.hostId !== selectedHost)].slice(0, maximumHosts);
    storage?.setItem(prefix + encodeURIComponent(scope), JSON.stringify(value));
  } catch { /* Preferences remain usable in memory when browser storage is unavailable. */ }
}
export function projectDirectoryIssue(directory, host) {
  if (!directory) return '';
  if (typeof directory !== 'string' || directory.length > 4096 || /[\x00-\x1f\x7f]/.test(directory)) return '项目目录格式无效，请输入不含换行的绝对路径。';
  if (!host?.codex?.projectDirectory) return '这台电脑尚不支持自定义项目目录。请更新桌面客户端，或明确恢复默认工作区。';
  const value = directory.trim();
  const windows = ['win32', 'windows'].includes(host.platform);
  if (windows ? !/^[a-zA-Z]:[\\/]/.test(value) : !value.startsWith('/')) return windows ? '请输入这台 Windows 电脑上的绝对路径，例如 C:\\Projects\\demo。' : '请输入这台电脑上的绝对路径，例如 /home/me/projects/demo。';
  return '';
}
/** Running, queued and uncertain submissions keep their original directory, including the default. */
export function executionProjectDirectory(agent, pending) {
  if (pending?.payload) return pending.payload.projectDirectory || '';
  if (['running', 'stopping', 'unknown'].includes(agent?.run?.status)) return agent.run.projectDirectory || '';
  if (agent?.queue?.length) return agent.queue[0].projectDirectory || '';
  return undefined;
}
