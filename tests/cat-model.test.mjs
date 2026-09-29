import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createPetBehavior } from '../src/pet/behavior.mjs';

// Exercise the production rig in Three.js without needing a GPU or copying its pose equations.
const source = await readFile(new URL('../src/pet/CatModel.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/from ['"]three['"]/, `from ${JSON.stringify(import.meta.resolve('three'))}`);
const { createCatModel } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const idle = { action: 'idle', lookX: 0, lookY: 0, speed: 0 };
function makeCat(t) {
  const cat = createCatModel();
  t.after(() => cat.dispose());
  return { cat, rig: cat.group.getObjectByName('character motion root') };
}
function assertFinitePose(cat) {
  cat.group.updateMatrixWorld(true);
  cat.group.traverse(object => {
    for (const number of [...object.position, ...object.scale, ...object.quaternion, ...object.matrixWorld.elements]) {
      assert.ok(Number.isFinite(number), `${object.name || object.type} has a non-finite pose`);
    }
    assert.ok(object.scale.x > 0 && object.scale.y > 0 && object.scale.z > 0);
  });
}
function pose(cat) {
  const values = [];
  cat.group.traverse(object => values.push(...object.position, ...object.scale, ...object.quaternion));
  return values;
}

for (const fps of [30, 60]) {
  test(`controller-driven jump completes its full arc without snapping at ${fps} fps`, t => {
    const { cat, rig } = makeCat(t);
    const behavior = createPetBehavior({ random: () => 0 });
    behavior.interact('jump');
    const samples = [{ action: 'jump', y: 0 }];
    for (let frame = 1; frame <= fps; frame++) {
      const state = behavior.step(1 / fps);
      cat.update(frame / fps, state);
      samples.push({ action: state.action, y: rig.position.y });
      assertFinitePose(cat);
    }
    const heights = samples.map(sample => sample.y);
    assert.ok(Math.max(...heights) > 0.52, 'the cat visibly leaves the floor');
    assert.ok(Math.min(...heights) >= 0, 'the cat never falls below the floor');
    const landedIndex = samples.findIndex(sample => sample.action === 'idle');
    assert.ok(landedIndex > 0, 'the controller ends its jump');
    assert.ok(samples[landedIndex - 1].y < 0.012, 'the rig is already near the floor before action completion');
    assert.equal(samples[landedIndex].y, 0, 'the rig is on the floor when the controller completes');
    assert.equal(heights.at(-1), 0, 'there is no second independent jump cycle');
    for (let i = 1; i < heights.length; i++) {
      assert.ok(Math.abs(heights[i] - heights[i - 1]) <= 2.1 / fps + 1e-9, 'each vertical step remains bounded');
    }
  });
}

test('interrupting or repeating a jump lands smoothly instead of resetting the airborne rig', t => {
  const { cat, rig } = makeCat(t);
  const behavior = createPetBehavior({ random: () => 0 });
  let time = 0;
  function step() {
    time += 1 / 60;
    cat.update(time, behavior.step(1 / 60));
    assertFinitePose(cat);
    return rig.position.y;
  }
  for (const interrupt of ['pet', 'jump', 'sleep']) {
    behavior.wake();
    behavior.interact('jump');
    for (let i = 0; i < 24; i++) step();
    const airborne = rig.position.y;
    assert.ok(airborne > 0.5);
    behavior.interact(interrupt);
    assert.ok(step() > airborne - 0.036, `${interrupt} must not teleport to the floor`);
    let lastHeight = rig.position.y;
    for (let i = 0; i < 75; i++) {
      const height = step();
      assert.ok(Math.abs(height - lastHeight) <= 0.035000001);
      lastHeight = height;
    }
    assert.equal(rig.position.y, 0, `${interrupt} eventually settles`);
  }
});

test('rapid interaction, invalid numeric inputs and resumed clocks cannot corrupt the rig', t => {
  const { cat } = makeCat(t);
  const behavior = createPetBehavior();
  for (let frame = 1; frame <= 240; frame++) {
    if (frame % 2) behavior.interact('pet');
    else if (frame % 4 === 0) behavior.interact('jump');
    else behavior.interact('eat');
    cat.update(frame / 60, behavior.step(1 / 60));
    assertFinitePose(cat);
  }
  for (const time of [NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE, 6, 7]) {
    cat.update(time, { ...idle, action: 'jump', lookX: NaN, lookY: Infinity, speed: -Infinity, actionProgress: NaN, jumpHeight: Infinity });
    assertFinitePose(cat);
  }
  cat.update(8, { ...idle, action: '__proto__' });
  assertFinitePose(cat);
});

test('reduced motion keeps touch expressions while stopping displacement and periodic movements', t => {
  for (const action of ['idle', 'pet', 'eat', 'sleep', 'jump']) {
    const { cat, rig } = makeCat(t);
    const state = { ...idle, action, actionProgress: 0.5, jumpHeight: 1, reducedMotion: true };
    for (let frame = 1; frame <= 240; frame++) cat.update(frame / 60, state);
    assert.equal(rig.position.y, 0, `${action} must not lift the cat`);
    const before = pose(cat);
    for (let frame = 241; frame <= 360; frame++) cat.update(frame / 60, state);
    const after = pose(cat);
    for (let i = 0; i < before.length; i++) assert.ok(Math.abs(after[i] - before[i]) < 1e-9, `${action} has residual periodic motion`);
    if (action === 'pet') assert.ok(cat.group.getObjectByName('left eye opening').scale.y < 0.2, 'touch still produces a relaxed expression');
    assertFinitePose(cat);
  }
});

test('stroking has a restrained head response and phase-continuous tail after a long idle', t => {
  const { cat } = makeCat(t);
  const head = cat.group.getObjectByName('head and facial expression rig');
  const tail = cat.group.getObjectByName('continuous skinned tail').children.find(object => object.isSkinnedMesh);
  const dt = 1 / 30;
  for (let frame = 1; frame <= 1800; frame++) cat.update(frame * dt, idle);
  let previous = tail.skeleton.bones.map(bone => bone.rotation.z);
  for (let frame = 1801; frame <= 1950; frame++) {
    cat.update(frame * dt, { ...idle, action: frame % 3 ? 'pet' : 'idle' });
    assert.ok(Math.abs(head.rotation.z) < 0.045, 'head tilt stays gentle');
    const next = tail.skeleton.bones.map(bone => bone.rotation.z);
    for (let i = 0; i < next.length; i++) assert.ok(Math.abs(next[i] - previous[i]) < 0.01, 'tail phase must not jump when pet intensity changes');
    previous = next;
  }
});
