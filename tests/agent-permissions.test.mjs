import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { defaultAgentPermissions, normalizeAgentPermissions, codexPermissionParams } from '../server/agent-permissions.mjs';

test('permission selection defaults conservatively and rejects unknown or malformed fields', () => {
  assert.deepEqual(normalizeAgentPermissions(), { access: 'read-only', approval: 'ask' });
  assert.deepEqual(normalizeAgentPermissions({ approval: 'auto' }), { access: 'read-only', approval: 'auto' });
  const first = defaultAgentPermissions(); first.access = 'full-access'; assert.equal(defaultAgentPermissions().access, 'read-only');
  for (const invalid of [null, [], true, 'full-access', { access: null }, { access: 'danger-full-access' }, { approval: 'never' }, { shell: true }]) {
    assert.throws(() => normalizeAgentPermissions(invalid), error => error.status === 400);
  }
});

test('access and execution strategy produce independent native thread and turn permission fields', () => {
  const cwd = path.resolve('permission-fixture');
  for (const access of ['read-only', 'workspace-write', 'full-access']) for (const approval of ['ask', 'auto', 'review']) {
    const result = codexPermissionParams({ access, approval }, cwd);
    assert.equal(result.sandbox, access === 'full-access' ? 'danger-full-access' : access);
    assert.equal(result.approvalPolicy, approval === 'auto' ? 'never' : 'on-request');
    assert.equal(result.approvalsReviewer, approval === 'review' ? 'auto_review' : 'user');
    assert.deepEqual(result.sandboxPolicy, access === 'full-access' ? { type: 'dangerFullAccess' } : access === 'workspace-write'
      ? { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false, excludeSlashTmp: true, excludeTmpdirEnvVar: true }
      : { type: 'readOnly', networkAccess: false });
  }
  assert.throws(() => codexPermissionParams(undefined, './relative'));
});
