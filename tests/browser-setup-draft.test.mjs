import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSetupDraft } from '../src/browser-setup-draft.mjs';

const ready = { connected: true, canUseCodex: true, host: { id: 'chosen-computer', online: true, platform: 'linux' }, busy: false };
test('browser preparation preserves the exact execution host and creates only reviewable text', () => {
  const input = structuredClone(ready), before = structuredClone(input);
  const value = createBrowserSetupDraft(input);
  assert.deepEqual(input, before);
  assert.equal(value.hostId, ready.host.id);
  assert.deepEqual(Object.keys(value).sort(), ['content', 'hostId']);
  assert.match(value.content, /petpal_opencli_setup/);
  assert.match(value.content, /prepared 不能当作已安装/);
});
test('logout, access revocation, active work and unsent content never create an installation task', () => {
  for (const patch of [{ connected: false }, { canUseCodex: false }, { busy: true }, { draft: '已有内容' }, { attachmentCount: 1 }, { host: { id: 'offline', online: false } }, { host: undefined }]) assert.throws(() => createBrowserSetupDraft({ ...ready, ...patch }));
});
test('unsupported hosts are reported without switching to another online computer', () => {
  assert.throws(() => createBrowserSetupDraft({ ...ready, host: { id: 'mac-host', online: true, platform: 'darwin' } }), /Windows 和 Ubuntu/);
});
