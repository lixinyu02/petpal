import test from 'node:test';
import assert from 'node:assert/strict';
import { createPetBehavior, createSeededRandom, MAX_STEP_SECONDS } from '../src/pet/behavior.mjs';

function advance(pet, seconds, dt = 1 / 60) {
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) pet.step(dt);
  return pet.snapshot();
}

test('same seed and input timeline produce identical behavior', () => {
  const first = createPetBehavior({ seed: 123 }); const second = createPetBehavior({ seed: 123 });
  const seen = new Set();
  for (let frame = 0; frame < 3000; frame++) {
    if (frame === 200) { first.interact('pet'); second.interact('pet'); }
    if (frame === 700) { first.setPointer(0.7, -0.4); second.setPointer(0.7, -0.4); }
    const a = first.step(1 / 60); const b = second.step(1 / 60);
    assert.deepEqual(a, b); seen.add(a.action);
  }
  assert.ok(seen.has('idle')); assert.ok(seen.has('walk')); assert.ok(seen.has('pet'));
  const random = createSeededRandom(42);
  for (let i = 0; i < 100; i++) { const value = random(); assert.ok(value >= 0 && value < 1); }
});

test('user interaction immediately interrupts autonomous walk and resumes after a calm idle', () => {
  const pet = createPetBehavior({ random: () => 0 });
  advance(pet, 3.1); assert.equal(pet.snapshot().action, 'walk');
  const x = pet.snapshot().x;
  const pressed = pet.interact('pet'); assert.equal(pressed.action, 'pet'); assert.equal(pressed.autonomous, false); assert.equal(pressed.actionTime, 0);
  advance(pet, 1); assert.equal(pet.snapshot().x, x); assert.equal(pet.snapshot().speed, 0);
  advance(pet, 1.2); assert.equal(pet.snapshot().action, 'idle');
  advance(pet, 1); assert.equal(pet.snapshot().action, 'idle');
  pet.interact('eat'); advance(pet, 0.8); pet.interact('jump');
  assert.equal(pet.snapshot().action, 'jump'); assert.equal(pet.snapshot().actionTime, 0);
});

test('sleep persists through time, pointer input and other actions until explicit wake', () => {
  const pet = createPetBehavior({ random: () => 0 });
  pet.interact('sleep'); pet.setPointer(1, 1); advance(pet, 120);
  for (const action of ['pet', 'eat', 'jump', 'sleep']) assert.equal(pet.interact(action).action, 'sleep');
  assert.equal(pet.snapshot().x, 0); assert.equal(pet.snapshot().speed, 0);
  assert.equal(pet.snapshot().actionProgress, 1);
  assert.equal(pet.interact('wake').action, 'idle');
  pet.interact('sleep'); assert.equal(pet.wake().action, 'idle');
});

test('hidden pages freeze all action time, position and pointer smoothing', () => {
  const pet = createPetBehavior(); pet.interact('jump'); pet.step(0.04); pet.setPointer(1, -1);
  pet.setVisible(false); const before = pet.snapshot();
  for (let i = 0; i < 100; i++) assert.deepEqual(pet.step(60), before);
  assert.equal(before.paused, true); assert.equal(before.autonomyPaused, true);
  pet.setVisible(true); const after = pet.step(600);
  assert.ok(Math.abs(after.actionTime - before.actionTime - MAX_STEP_SECONDS) < 1e-10);
  assert.equal(after.paused, false); assert.ok(after.jumpHeight <= 1);
});

test('reduced motion pauses autonomy but preserves user pet/eat feedback without displacement', () => {
  const pet = createPetBehavior({ random: () => 0, reducedMotion: true });
  advance(pet, 90); assert.equal(pet.snapshot().action, 'idle'); assert.equal(pet.snapshot().actionTime, 0);
  assert.equal(pet.snapshot().paused, false); assert.equal(pet.snapshot().autonomyPaused, true);
  pet.interact('pet'); advance(pet, 0.5); assert.ok(pet.snapshot().actionProgress > 0);
  pet.interact('eat'); advance(pet, 0.5); assert.equal(pet.snapshot().action, 'eat');
  pet.interact('jump'); advance(pet, 0.2); assert.equal(pet.snapshot().jumpHeight, 0); assert.equal(pet.snapshot().x, 0);
  advance(pet, 1); pet.setReducedMotion(false); advance(pet, 3.1); assert.equal(pet.snapshot().action, 'walk');
  const x = pet.snapshot().x; pet.setReducedMotion(true); assert.equal(pet.snapshot().action, 'idle'); advance(pet, 20); assert.equal(pet.snapshot().x, x);
});

test('pointer input is normalized, smoothly followed, cleared and isolated from snapshot mutation', () => {
  const pet = createPetBehavior(); pet.setPointer(999, -999);
  let state = pet.step(0.01); assert.ok(state.lookX > 0 && state.lookX < 1); assert.ok(state.lookY < 0 && state.lookY > -1);
  advance(pet, 2); state = pet.snapshot(); assert.ok(state.lookX <= 1); assert.ok(state.lookY >= -1);
  state.x = 999; state.lookX = 123; assert.notEqual(pet.snapshot().x, 999); assert.notEqual(pet.snapshot().lookX, 123);
  pet.clearPointer(); advance(pet, 2); assert.ok(Math.abs(pet.snapshot().lookX) < 0.001);
  pet.setPointer(NaN, Infinity); advance(pet, 2); assert.ok(Number.isFinite(pet.snapshot().lookY));
});

test('walk reflects at the ground edges, including very narrow bounds, and stays a single position', () => {
  const pet = createPetBehavior({ bounds: [-0.03, 0.03], random: () => 0 });
  advance(pet, 3.05); const directions = new Set();
  for (let i = 0; i < 120; i++) {
    const state = pet.step(1 / 60); assert.ok(state.x >= -0.03 && state.x <= 0.03); assert.ok(state.speed >= 0 && state.speed <= 1);
    if (state.action === 'walk') directions.add(state.facing);
  }
  assert.deepEqual([...directions].sort(), [-1, 1]);
  const tiny = createPetBehavior({ bounds: [0, 0.00001], random: () => 0, initialX: 100 });
  assert.equal(tiny.snapshot().x, 0.00001); advance(tiny, 3.1);
  for (let i = 0; i < 100; i++) { const state = tiny.step(100); assert.ok(state.x >= 0 && state.x <= 0.00001); }
});

test('jump arc stays normalized and returns to the same floor position', () => {
  const pet = createPetBehavior({ initialX: 0.4 }); pet.interact('jump');
  let maximum = 0;
  for (let i = 0; i < 60; i++) { const state = pet.step(1 / 60); maximum = Math.max(maximum, state.jumpHeight); assert.equal(state.x, 0.4); assert.ok(state.jumpHeight >= 0 && state.jumpHeight <= 1); }
  assert.ok(maximum > 0.99); assert.equal(pet.snapshot().action, 'idle'); assert.equal(pet.snapshot().jumpHeight, 0);
});

test('invalid deltas cannot fast-forward; invalid controls fail clearly', () => {
  const pet = createPetBehavior(); pet.interact('eat'); const before = pet.snapshot();
  for (const value of [0, -1, NaN, Infinity, undefined, '1']) assert.deepEqual(pet.step(value), before);
  assert.equal(pet.step(1000).actionTime, MAX_STEP_SECONDS);
  assert.throws(() => pet.interact('walk'), /Unknown pet interaction/);
  assert.throws(() => createPetBehavior({ bounds: [1, 1] }), /bounds/);
  assert.throws(() => createPetBehavior({ walkSpeed: -1 }), /walkSpeed/);
  assert.throws(() => createSeededRandom(NaN), /finite/);
});
