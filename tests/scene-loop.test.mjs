import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisibleSceneLoop, updateSceneDataset } from '../src/avatar/scene-loop.mjs';
import { createAvatarPerformance } from '../src/avatar/performance.mjs';
import { createPetBehavior } from '../src/pet/behavior.mjs';

function clock() {
  let sequence = 0;
  const pending = new Map(), cancelled = [];
  return {
    pending, cancelled,
    request(callback) { const id = sequence++; pending.set(id, callback); return id; },
    cancel(id) { cancelled.push(id); pending.delete(id); },
    step(now) {
      const [id, callback] = pending.entries().next().value || [];
      assert.equal(typeof callback, 'function');
      pending.delete(id); callback(now);
    },
  };
}

test('a 30 FPS limit retains its cadence across 60, 90, 120 and 144 Hz displays', () => {
  for (const refreshHz of [60, 90, 120, 144]) {
    const timer = clock(), frames = [];
    const loop = createVisibleSceneLoop(now => frames.push(now), { ...timer, maxFps: 30 });
    loop.setActive(true);
    for (let index = 1; index <= refreshHz * 10; index++) {
      timer.step(index * 1000 / refreshHz);
      assert.equal(timer.pending.size, 1, 'only one RAF is pending, including skipped slots');
    }
    assert.equal(frames.length, 300, `${refreshHz} Hz delivers 30 FPS for ten seconds`);
    const refreshPeriod = 1000 / refreshHz;
    for (let index = 1; index < frames.length; index++) {
      const interval = frames[index] - frames[index - 1];
      assert.ok(interval >= 1000 / 30 - refreshPeriod - .001);
      assert.ok(interval <= 1000 / 30 + refreshPeriod + .001, 'the cadence has no extra dropped slot');
    }
    loop.dispose(); assert.equal(timer.pending.size, 0);
  }
});

test('the default loop remains uncapped at high display refresh rates', () => {
  const timer = clock(), frames = [];
  const loop = createVisibleSceneLoop(now => frames.push(now), timer);
  loop.setActive(true);
  for (let index = 0; index < 1440; index++) timer.step(index * 1000 / 144);
  assert.equal(frames.length, 1440);
  loop.dispose();
});

test('a zero RAF timestamp and floating-point boundary do not disable the frame limit', () => {
  const timer = clock(), frames = [];
  const loop = createVisibleSceneLoop(now => frames.push(now), { ...timer, maxFps: 30 });
  loop.setActive(true);
  for (const now of [0, 1, 1000 / 60, 1000 / 30 - 1e-10, 1000 / 30, 2000 / 30]) timer.step(now);
  assert.deepEqual(frames, [0, 1000 / 30 - 1e-10, 2000 / 30]);
  loop.dispose();
});

test('long frame gaps skip old slots without a catch-up burst or clamping delivered time', () => {
  const timer = clock(), frames = [], elapsed = [];
  let last = null;
  const loop = createVisibleSceneLoop(now => {
    frames.push(now); elapsed.push(last === null ? 0 : (now - last) / 1000); last = now;
  }, { ...timer, maxFps: 30 });
  loop.setActive(true);
  for (const now of [0, 100000, 100000, 100001, 100016, 100034]) timer.step(now);
  assert.deepEqual(frames, [0, 100000, 100034]);
  assert.deepEqual(elapsed, [0, 100, .034]);
  assert.equal(timer.pending.size, 1);
  loop.dispose();
});

test('a limited loop resets its deadline on resume and ignores cancelled or disposed callbacks', () => {
  const timer = clock(), frames = [];
  const loop = createVisibleSceneLoop(now => frames.push(now), { ...timer, maxFps: 30 });
  loop.setActive(true); timer.step(0); timer.step(16);
  const cancelled = [...timer.pending.values()][0];
  loop.setActive(false); assert.equal(timer.pending.size, 0);
  loop.setActive(true);
  cancelled(100000); assert.equal(timer.pending.size, 1); assert.deepEqual(frames, [0]);
  timer.step(100000); timer.step(100001); timer.step(100034);
  assert.deepEqual(frames, [0, 100000, 100034]);
  const disposed = [...timer.pending.values()][0];
  loop.dispose(); disposed(100100); loop.setActive(true);
  assert.deepEqual(frames, [0, 100000, 100034]); assert.equal(timer.pending.size, 0);
});

test('visible scene keeps one frame and cancels offscreen/hidden work including RAF id zero', () => {
  const timer = clock(), frames = [];
  const loop = createVisibleSceneLoop(now => frames.push(now), timer);
  assert.equal(timer.pending.size, 0);
  loop.setActive(true); loop.setActive(true);
  assert.equal(timer.pending.size, 1);
  assert.equal(timer.pending.has(0), true);
  loop.setActive(false);
  assert.deepEqual(timer.cancelled, [0]);
  assert.equal(timer.pending.size, 0);
  loop.setActive(true); timer.step(100); timer.step(133);
  assert.deepEqual(frames, [100, 133]);
  assert.equal(timer.pending.size, 1);
  loop.setActive(false); assert.equal(timer.pending.size, 0);
});

test('late cancelled frames cannot replace resumed work, and disposed scenes stay stopped', () => {
  const timer = clock(), frames = [];
  const loop = createVisibleSceneLoop(now => frames.push(now), timer);
  loop.setActive(true);
  const stale = [...timer.pending.values()][0];
  loop.setActive(false); loop.setActive(true);
  stale(40);
  assert.deepEqual(frames, []); assert.equal(timer.pending.size, 1);
  timer.step(100); assert.deepEqual(frames, [100]);
  const deliveredBeforeCleanup = [...timer.pending.values()][0];
  loop.dispose(); loop.dispose(); loop.setActive(true); deliveredBeforeCleanup(160);
  assert.deepEqual(frames, [100]); assert.equal(timer.pending.size, 0);
});

test('a scene hiding or disposing itself during a frame does not requeue', () => {
  for (const operation of ['hide', 'dispose']) {
    const timer = clock();
    const loop = createVisibleSceneLoop(() => operation === 'hide' ? loop.setActive(false) : loop.dispose(), timer);
    loop.setActive(true); timer.step(100); assert.equal(timer.pending.size, 0);
  }
});

test('resuming an avatar after hidden text consumes that text without a mouth catch-up burst', () => {
  const timer = clock(), avatar = createAvatarPerformance();
  let input = { utteranceId: 'reply', phase: 'speaking', text: 'a' }, last = 0, pose;
  const loop = createVisibleSceneLoop(now => {
    const elapsed = last ? (now-last)/1000 : 0; last = now;
    avatar.setInput(input); pose = avatar.step(elapsed);
  }, { ...timer, maxFps: 30 });
  const visible = next => {
    last = 0;
    if (!next) { avatar.setInput(input); avatar.step(0, { hidden: true }); }
    loop.setActive(next);
  };
  visible(true); timer.step(100); timer.step(135); assert.ok(pose.mouthOpen > 0);
  visible(false); input = { ...input, text: 'a还有隐藏期间收到的内容。' };
  assert.equal(timer.pending.size, 0);
  visible(true); timer.step(100000); timer.step(100035);
  assert.equal(pose.mouthOpen, 0); assert.equal(pose.speaking, false);
  input = { ...input, text: input.text+'a' }; timer.step(100070);
  assert.ok(pose.mouthOpen > 0);
  loop.dispose();
});

test('resuming a cat does not advance an action by the time spent outside the viewport', () => {
  const timer = clock(), pet = createPetBehavior();
  let last = 0;
  const loop = createVisibleSceneLoop(now => {
    const dt = last ? Math.min((now-last)/1000, .1) : 1/30; last = now;
    pet.step(dt);
  }, { ...timer, maxFps: 30 });
  const visible = next => { pet.setVisible(next); last = 0; loop.setActive(next); };
  pet.interact('jump'); visible(true); timer.step(100);
  const before = pet.snapshot().actionTime;
  visible(false); assert.equal(timer.pending.size, 0);
  visible(true); timer.step(100000);
  assert.ok(Math.abs(pet.snapshot().actionTime-before-1/30) < 1e-10);
  loop.dispose();
});

test('scene diagnostic values mutate only when changed and preserve all keys', () => {
  const storage = {}, writes = [];
  const dataset = new Proxy(storage, { set(target, key, value) { writes.push([key,value]); target[key] = value; return true; } });
  const initial = { phase: 'idle', mouthOpen: '0.000', expression: 'neutral' };
  updateSceneDataset(dataset, initial); updateSceneDataset(dataset, initial);
  assert.equal(writes.length, 3);
  updateSceneDataset(dataset, { ...initial, mouthOpen: '0.500' });
  assert.deepEqual(writes.at(-1), ['mouthOpen', '0.500']); assert.equal(writes.length, 4);
  assert.deepEqual(storage, { ...initial, mouthOpen: '0.500' });
});
