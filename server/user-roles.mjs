/** Account role and executor ownership are independent from Codex sandbox choices. */
export const isAdministrator = user => user?.role === 'admin';

export function normalizeUserRole(value = 'user') {
  if (value === 'member') return 'user'; // Older clients/stores called users members.
  if (value !== 'user' && value !== 'admin') throw Object.assign(new Error('账号身份必须是用户或管理员。'), { status: 400 });
  return value;
}

export function canAccessExecutionHost(state, userId, hostId) {
  const user = state.users.find(item => item.id === userId);
  if (!user || user.disabled) return false;
  if (hostId === 'central') return isAdministrator(user);
  const host = state.executionHosts?.find(item => item.id === hostId);
  return Boolean(host && (isAdministrator(user) || host.userId === userId));
}
