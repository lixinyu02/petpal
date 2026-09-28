import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDevicePreferences, createDevicePreferences, reconcileDevicePreferences } from '../src/media/device-preferences.mjs';

const defaults = { microphoneId: '', cameraId: '', speakerId: '' };
const store = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const scope = (instance, user) => JSON.stringify([instance, user]);

test('media preferences whitelist opaque device IDs and reject oversized or malformed values', () => {
  assert.deepEqual(normalizeDevicePreferences(null), defaults);
  const input = { microphoneId: 'microphone-hash', cameraId: 'camera-hash', speakerId: 'speaker-hash', token: 'secret', label: 'Personal hardware name' };
  assert.deepEqual(normalizeDevicePreferences(input), { microphoneId: 'microphone-hash', cameraId: 'camera-hash', speakerId: 'speaker-hash' });
  for (const invalid of [null, true, 0, {}, [], 'x'.repeat(1025), 'a\nb', 'a\0b']) assert.equal(normalizeDevicePreferences({ microphoneId: invalid }).microphoneId, '');
  assert.deepEqual(normalizeDevicePreferences(Object.create(input)), defaults);
  assert.equal(normalizeDevicePreferences({ cameraId: 'x'.repeat(1024) }).cameraId.length, 1024);
});

test('storage remains per-instance and per-account; no labels, tokens or legacy values are imported', () => {
  const storage = store();
  storage.setItem('petpal.mediaDevices', JSON.stringify({ cameraId: 'legacy-camera' }));
  const alice = createDevicePreferences(storage, scope('server-a', 'alice'));
  const bob = createDevicePreferences(storage, scope('server-a', 'bob'));
  const otherServer = createDevicePreferences(storage, scope('server-b', 'alice'));
  alice.write({ microphoneId: 'alice-mic', label: 'Hardware label', token: 'secret' });
  bob.write({ cameraId: 'bob-camera' });
  assert.deepEqual(otherServer.read(), defaults);
  assert.deepEqual(createDevicePreferences(storage, scope('server-a', 'alice')).read(), { ...defaults, microphoneId: 'alice-mic' });
  assert.deepEqual(bob.read(), { ...defaults, cameraId: 'bob-camera' });
  const aliceRecord = storage.getItem(`petpal.mediaDevices:${encodeURIComponent(scope('server-a', 'alice'))}`);
  assert.equal(aliceRecord.includes('secret'), false); assert.equal(aliceRecord.includes('Hardware'), false);
  alice.clear(); assert.deepEqual(alice.read(), defaults);
  assert.deepEqual(createDevicePreferences(storage, scope('server-a', 'alice')).read(), defaults);
  assert.deepEqual(createDevicePreferences(storage, scope('server-a', 'bob')).read(), bob.read());
  for (const invalid of [undefined, null, '', ' ', 1, 'x'.repeat(2049)]) assert.throws(() => createDevicePreferences(storage, invalid), /account scope/);
});

test('denied/full storage and malformed records preserve usable in-memory preferences', () => {
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
  const controller = createDevicePreferences(storage, 'local-account');
  assert.deepEqual(controller.read(), defaults);
  controller.write({ microphoneId: 'mic' }); controller.write({ cameraId: 'camera' });
  assert.deepEqual(controller.read(), { ...defaults, microphoneId: 'mic', cameraId: 'camera' });
  controller.clear(); assert.deepEqual(controller.read(), defaults);
  for (const raw of ['invalid-json', 'null', '[]', '{}', 'x'.repeat(8193)]) assert.deepEqual(createDevicePreferences({ ...storage, getItem: () => raw }, 'local-account').read(), defaults);
  assert.equal(createDevicePreferences(undefined, 'local-account').write({ speakerId: 'default' }).speakerId, 'default');
});

test('snapshots cannot mutate the controller and a disposed old-account controller cannot write', () => {
  const storage = store(), controller = createDevicePreferences(storage, 'alice');
  const result = controller.write({ microphoneId: 'mic' }); result.microphoneId = 'mutated';
  const snapshot = controller.read(); snapshot.cameraId = 'mutated';
  assert.deepEqual(controller.read(), { ...defaults, microphoneId: 'mic' });
  controller.dispose(); controller.write({ cameraId: 'late-result' }); controller.clear();
  assert.deepEqual(controller.read(), defaults);
  assert.deepEqual(createDevicePreferences(storage, 'alice').read(), { ...defaults, microphoneId: 'mic' });
});

test('permission-limited enumeration cannot erase selected devices, even for other visible device kinds', () => {
  const preferences = { microphoneId: 'saved-mic', cameraId: 'saved-camera', speakerId: 'saved-speaker' };
  for (const devices of [[], [{ kind: 'audioinput', deviceId: '', label: 'Microphone' }], [{ kind: 'audioinput', deviceId: 'other-mic', label: '' }]]) {
    assert.deepEqual(reconcileDevicePreferences(preferences, devices), { preferences, missing: [] });
    assert.deepEqual(reconcileDevicePreferences(preferences, devices, { labelsAvailable: true }), { preferences, missing: [] });
  }
  const devices = [{ kind: 'audioinput', deviceId: 'other-mic', label: 'Microphone' }, { kind: 'videoinput', deviceId: 'other-camera', label: '' }];
  assert.deepEqual(reconcileDevicePreferences(preferences, devices, { labelsAvailable: false }), { preferences, missing: [] });
  assert.deepEqual(reconcileDevicePreferences(preferences, devices), { preferences: { ...preferences, microphoneId: '' }, missing: ['microphoneId'] });
  assert.equal(preferences.microphoneId, 'saved-mic');
});

test('known stale devices fall back independently to system defaults and preserve visible selections', () => {
  const preferences = { microphoneId: 'old-mic', cameraId: 'camera', speakerId: 'old-speaker' };
  const devices = [
    { kind: 'audioinput', deviceId: 'new-mic', label: 'Microphone' },
    { kind: 'videoinput', deviceId: 'camera', label: 'Camera' },
    { kind: 'audiooutput', deviceId: 'new-speaker', label: 'Speaker' },
  ];
  assert.deepEqual(reconcileDevicePreferences(preferences, devices), { preferences: { ...defaults, cameraId: 'camera' }, missing: ['microphoneId', 'speakerId'] });
  assert.deepEqual(reconcileDevicePreferences(defaults, devices), { preferences: defaults, missing: [] });
});
