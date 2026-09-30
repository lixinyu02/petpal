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
  }, timer);
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
  }, timer);
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
