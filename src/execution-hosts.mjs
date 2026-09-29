const prefix = 'petpal.agent-host.';
const hostId = value => typeof value === 'string' && value.length > 0 && value.length <= 160 ? value : '';

export function readExecutionHost(storage, scope) {
  if (!scope) return '';
  try { return hostId(storage.getItem(prefix + encodeURIComponent(scope))); } catch { return ''; }
}
export function saveExecutionHost(storage, scope, value) {
  if (!scope || !hostId(value)) return;
  try { storage.setItem(prefix + encodeURIComponent(scope), value); } catch { /* A private browser can still choose a host for this page. */ }
}
export function executionPlatform(platform) {
  return ({ win32: 'Windows', windows: 'Windows', linux: 'Ubuntu / Linux', darwin: 'macOS' })[platform] || '电脑';
}
/** Keep an offline or missing selection visible; never silently route to another computer. */
export function resolveExecutionHostId({ requestedId = '', lockedId = '', localHostId = '', defaultHostId = '' } = {}) {
  return hostId(lockedId) || hostId(requestedId) || hostId(localHostId) || hostId(defaultHostId);
}
export function executionHostLock(agent, pending) {
  if (pending?.payload?.hostId) return hostId(pending.payload.hostId);
  if (['running', 'stopping', 'unknown'].includes(agent?.run?.status)) return hostId(agent.run.hostId) || 'central';
  return agent?.queue?.length ? hostId(agent.queue[0].hostId) || 'central' : '';
}
