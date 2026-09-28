import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/media/devices.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { captureDevice, routeAudioOutput, createOutputTestTone } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
function environment(t, mediaDevices, secure = true) {
  for (const [key, value] of Object.entries({ window: { isSecureContext: secure }, navigator: { mediaDevices } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
}

test('capture uses the selected physical input exactly and never requests the other medium', async t => {
  const requests = [], stream = { fixture: true };
  environment(t, { getUserMedia: async constraints => { requests.push(constraints); return stream; } });
  assert.equal(await captureDevice('microphone', 'mic-selected'), stream);
  assert.equal(requests[0].video, false);
  assert.deepEqual(requests[0].audio.deviceId, { exact: 'mic-selected' });
  await captureDevice('camera', 'camera-selected');
  assert.equal(requests[1].audio, false);
  assert.deepEqual(requests[1].video.deviceId, { exact: 'camera-selected' });
  await captureDevice('microphone', '');
  assert.equal(requests[2].audio.deviceId, undefined);
});

test('missing selected hardware and permissions do not silently retry using another device', async t => {
  let calls = 0;
  const failure = Object.assign(new Error('fixture denied'), { name: 'NotAllowedError' });
  environment(t, { getUserMedia: async () => { calls++; throw failure; } });
  await assert.rejects(captureDevice('microphone', 'private-microphone'), e => e === failure);
  assert.equal(calls, 1);
});

test('insecure context refuses capture before any browser device call', async t => {
  let called = false;
  environment(t, { getUserMedia: async () => { called = true; } }, false);
  await assert.rejects(captureDevice('camera', ''), /HTTPS/);
  assert.equal(called, false);
});

test('speaker routing passes the exact sink and does not claim unsupported or denied routing succeeded', async () => {
  const sinks = [];
  await routeAudioOutput({ setSinkId: async value => sinks.push(value) }, 'speaker-selected');
  assert.deepEqual(sinks, ['speaker-selected']);
  await routeAudioOutput({}, '');
  await assert.rejects(routeAudioOutput({}, 'speaker-selected'), /系统设置/);
  await assert.rejects(routeAudioOutput({ setSinkId: async () => { throw new Error('sink denied'); } }, 'speaker-selected'), /sink denied/);
});

test('speaker self-test is a short, low-amplitude standalone PCM file without external assets', async () => {
  const blob = createOutputTestTone(), buffer = Buffer.from(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav');
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE');
  assert.equal(buffer.readUInt16LE(20), 1);
  assert.equal(buffer.readUInt16LE(22), 1);
  assert.equal(buffer.readUInt32LE(4) + 8, buffer.length);
  assert.equal(buffer.readUInt32LE(40) + 44, buffer.length);
  const duration = buffer.readUInt32LE(40) / buffer.readUInt32LE(28);
  assert.ok(duration > .1 && duration < .5);
  let maximum = 0;
  for (let i = 44; i < buffer.length; i += 2) maximum = Math.max(maximum, Math.abs(buffer.readInt16LE(i)));
  assert.ok(maximum > 100 && maximum < 32767 * .2);
});
