import path from 'node:path';

export const AGENT_ACCESS = Object.freeze(['read-only', 'workspace-write', 'full-access']);
export const AGENT_APPROVAL = Object.freeze(['ask', 'auto', 'review']);
export const defaultAgentPermissions = () => ({ access: 'read-only', approval: 'ask' });

/** Validate a permission selection; the service separately authorizes its actor. */
export function normalizeAgentPermissions(value) {
  if (value === undefined) return defaultAgentPermissions();
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['access', 'approval'].includes(key)) ||
      (value.access !== undefined && !AGENT_ACCESS.includes(value.access)) ||
      (value.approval !== undefined && !AGENT_APPROVAL.includes(value.approval))) {
    throw Object.assign(new Error('Agent 权限设置无效。'), { status: 400 });
  }
  return { access: value.access ?? 'read-only', approval: value.approval ?? 'ask' };
}

/** Native app-server 0.143 thread/turn fields. Never infer permission from API auth. */
export function codexPermissionParams(value, workspaceRoot) {
  const permissions = normalizeAgentPermissions(value);
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) throw new Error('Agent 工作目录必须是绝对路径。');
  const sandbox = permissions.access === 'full-access' ? 'danger-full-access' : permissions.access;
  const sandboxPolicy = permissions.access === 'full-access' ? { type: 'dangerFullAccess' }
    : permissions.access === 'workspace-write'
      ? { type: 'workspaceWrite', writableRoots: [workspaceRoot], networkAccess: false, excludeSlashTmp: true, excludeTmpdirEnvVar: true }
      : { type: 'readOnly', networkAccess: false };
  return { sandbox, sandboxPolicy, approvalPolicy: permissions.approval === 'auto' ? 'never' : 'on-request',
    approvalsReviewer: permissions.approval === 'review' ? 'auto_review' : 'user' };
}
