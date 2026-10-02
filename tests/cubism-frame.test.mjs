import test from 'node:test';
import assert from 'node:assert/strict';
import { createCubismFrameController } from '../src/avatar/cubism/runtime.mjs';
import { createCubismParameterBridge, cubismParameterTargets } from '../src/avatar/cubism/parameters.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);
const parameterNames = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeBallForm', 'ParamBrowLY', 'ParamBrowRY', 'ParamCheek', 'ParamTear', 'ParamBreath', 'ParamMouthForm', 'ParamMouthOpenY', 'ParamMouthA', 'ParamMouthO', 'ParamWarm', 'ParamSad', 'ParamPout'];

// This double models the public Framework queue boundary, including overlapping
// outgoing motions and the pinned stopAllMotions splice bug. Rendering/MOC
// geometry is covered separately by the official Core acceptance script.
function rig({ motions = {}, expressions = {}, physics, pose, deformationProfile = 'standard' } = {}) {
  const indices = new Map(parameterNames.map((name, index) => [name, index]));
  const values = parameterNames.map(name => /Eye[LR]Open/u.test(name) ? 1 : 0);
  let saved = [...values];
  const model = {
    getParameterCount: () => values.length,
    getParameterIndex: name => indices.get(name) ?? values.length + 20,
    getParameterMinimumValue: index => /Angle/u.test(parameterNames[index]) ? -30 : /Open|Cheek|Tear|Breath|BallForm/u.test(parameterNames[index]) ? 0 : -1,
    getParameterMaximumValue: index => /Angle/u.test(parameterNames[index]) ? 30 : 1,
    getParameterValueByIndex: index => values[index],
    setParameterValueByIndex: (index, value) => { values[index] = value; },
    saveParameters: () => { saved = [...values]; },
    loadParameters: () => { for (let index = 0; index < values.length; index++) values[index] = saved[index]; },
    update: () => {},
  };
  const get = name => model.getParameterValueByIndex(indices.get(name));
  const set = (name, value) => model.setParameterValueByIndex(indices.get(name), value);
  const queue = () => ({
    entries: [], starts: [], stops: 0,
    isFinished() { return this.entries.length === 0; },
    getCubismMotionQueueEntries() { return this.entries; },
    stopAllMotions() { this.stops++; for (let index = 0; index < this.entries.length; index++) this.entries.splice(index, 1); },
    startMotion(motion) { this.starts.push(motion); this.entries.push({ getCubismMotion: () => motion }); },
    startMotionPriority(motion) { this.startMotion(motion); },
    updateMotion() {
      for (const entry of this.entries) {
        const motion = entry.getCubismMotion();
        if (motion.apply) motion.apply({ get, set });
        else for (const [name, value] of Object.entries(motion.values)) set(name, value);
      }
    },
  });
  const motionManager = queue(), expressionManager = queue();
  const avatar = { _motionManager: motionManager, _expressionManager: expressionManager, ...(physics ? { _physics: { evaluate: () => physics({ get, set }) } } : {}), ...(pose ? { _pose: { updateParameters: () => pose({ get, set }) } } : {}) };
  const records = input => new Map(Object.entries(input).map(([name, value]) => {
    const motion = value.apply ? value : { values: value };
    return [name, { motion, parameters: new Set(value.parameters || Object.keys(value)) }];
  }));
  const bridge = createCubismParameterBridge(model, { getId: name => name });
  const controller = createCubismFrameController({ model, avatar, bridge, motions: records(motions), expressions: records(expressions), deformationProfile });
  return { controller, model, bridge, motionManager, expressionManager, get, set };
}

test('Cubism native interaction keeps authored face curves, independent blink and gaze without a second semantic gesture', () => {
  const result = rig({ motions: {
    Idle_0: { ParamBreath: .75 },
    TapHead_0: { ParamAngleZ: -3, ParamBodyAngleX: 2, ParamEyeLOpen: .3, ParamEyeROpen: .3, ParamCheek: .5, ParamBrowLY: .14, ParamBrowRY: .14, ParamMouthForm: .42 },
    Nod_0: { ParamAngleY: -4 },
  } });
  result.controller.update(.1, {}, {});
  result.controller.react('pet');
  result.controller.update(.1, { gesture: 'nod', headNod: .7, bodyTurn: .8, browRaise: .1, blush: .4, blinkRight: .5 }, { headX: .4, headTilt: .6, bodyXPercent: .4, breath: -.8, breathScale: 1 });
  assert.equal(result.controller.motionGroup, 'TapHead');
  assert.equal(result.motionManager.starts.length, 2);
  assert.equal(result.motionManager.stops, 0);
  near(result.get('ParamAngleX'), 4.8);
  near(result.get('ParamAngleZ'), -3);
  near(result.get('ParamBodyAngleX'), 2);
  near(result.get('ParamEyeLOpen'), .3);
  near(result.get('ParamEyeROpen'), .15);
  near(result.get('ParamCheek'), .5);
  near(result.get('ParamBrowLY'), .14);
  near(result.get('ParamBreath'), .75);
  assert.ok(result.get('ParamMouthForm') > .38 && result.get('ParamMouthForm') < .42);
  assert.equal(result.get('ParamMouthOpenY'), 0);
});

test('Cubism outgoing motion retains its parameter ownership until the official queue removes it', () => {
  const result = rig({ motions: { TapHead_0: { ParamCheek: .6 }, Greet_0: { ParamAngleY: 3 } } });
  result.controller.react('pet'); result.controller.update(.1, { blush: .1 });
  result.controller.react('greet'); result.controller.update(.1, { blush: .1 });
  assert.equal(result.motionManager.entries.length, 2);
  near(result.get('ParamCheek'), .6);
  result.motionManager.entries.shift();
  result.controller.update(.1, { blush: .1 });
  near(result.get('ParamCheek'), .1);
  assert.equal(result.motionManager.stops, 0);
});

test('Cubism neutral baseline prevents recursive fading and interrupted sparse parameter residue', () => {
  const result = rig({ motions: {
    Idle_0: { ParamBreath: .4 },
    TapHead_0: { parameters: ['ParamAngleX', 'ParamCheek'], apply: ({ get, set }) => { set('ParamAngleX', get('ParamAngleX') + 2); set('ParamCheek', .5); } },
  } });
  result.controller.react('pet');
  for (let frame = 0; frame < 8; frame++) { result.controller.update(.05); near(result.get('ParamAngleX'), 2); }
  result.motionManager.entries.length = 0;
  result.controller.update(.05);
  near(result.get('ParamAngleX'), 0); near(result.get('ParamCheek'), 0);
});

test('Cubism expressions crossfade through the queue and unknown names resolve once to neutral', () => {
  const result = rig({ expressions: { neutral: {}, happy: { ParamCheek: .7, ParamBrowLY: .25, ParamMouthOpenY: .9 } } });
  result.controller.update(.1, { expression: 'happy', blush: .4, browRaise: .1 });
  near(result.get('ParamCheek'), .7); near(result.get('ParamBrowLY'), .25);
  assert.equal(result.get('ParamMouthOpenY'), 0);
  result.controller.update(.1, { expression: 'unknown' });
  result.controller.update(.1, { expression: 'another-unknown' });
  assert.equal(result.expressionManager.starts.length, 2);
  assert.equal(result.expressionManager.entries.length, 2);
  assert.equal(result.expressionManager.stops, 0);
  near(result.get('ParamCheek'), .7);
  result.expressionManager.entries.shift();
  result.controller.update(.1, { expression: 'neutral' });
  near(result.get('ParamCheek'), 0);
});

test('Cubism articulation has the final mouth authority after gesture, expression, physics and pose', () => {
  const result = rig({ motions: { TapHead_0: { ParamMouthForm: .8, ParamMouthOpenY: .95 } }, expressions: { neutral: {}, happy: { ParamMouthOpenY: 1 } }, physics: ({ set }) => set('ParamMouthOpenY', .9), pose: ({ set }) => set('ParamMouthOpenY', .8) });
  result.controller.react('pet');
  result.controller.update(.1, { expression: 'happy', speaking: true, mouthOpen: .6, mouthShape: 'O' });
  near(result.get('ParamMouthOpenY'), .6);
  assert.ok(result.get('ParamMouthForm') < -.6);
  result.controller.update(0, { expression: 'happy', speaking: false });
  assert.equal(result.get('ParamMouthOpenY'), 0);
});

test('Cubism reference A/O patches retain final articulation authority over all native frame layers', () => {
  const forceMouth = ({ set }) => { set('ParamMouthA', 1); set('ParamMouthO', 1); };
  const result = rig({ motions: { TapHead_0: { ParamMouthA: 1, ParamMouthO: 1 } }, expressions: { happy: { ParamMouthA: 1, ParamMouthO: 1 } }, physics: forceMouth, pose: forceMouth, deformationProfile: 'reference-layered' });
  result.controller.react('pet');
  result.controller.update(.1, { expression: 'happy', speaking: true, mouthOpen: .7, mouthShape: 'O' });
  assert.equal(result.get('ParamMouthA'), 1); assert.equal(result.get('ParamMouthO'), 1); near(result.get('ParamMouthOpenY'), .7);
  result.controller.update(.1, { expression: 'happy', speaking: true, mouthOpen: .3, mouthShape: 'E' });
  assert.equal(result.get('ParamMouthA'), 1); assert.equal(result.get('ParamMouthO'), 0); near(result.get('ParamMouthOpenY'), .3);
  result.controller.update(0, { expression: 'happy', speaking: false, voiceEnergy: 1 });
  assert.equal(result.get('ParamMouthA'), 0); assert.equal(result.get('ParamMouthO'), 0);
  for (const options of [{ hidden: true }, { sleeping: true }]) {
    result.controller.update(0, { speaking: true, mouthOpen: .7, mouthShape: 'O' }, {}, options);
    assert.equal(result.get('ParamMouthA'), 0); assert.equal(result.get('ParamMouthO'), 0);
  }
});

test('Cubism mouth form transitions soften shape boundaries without adding frame-rate drift or delaying mouth closure', () => {
  const slow = rig(), fast = rig();
  const speaking = { speaking: true, mouthOpen: .7, mouthShape: 'O' };
  slow.controller.update(.05, speaking); fast.controller.update(.025, speaking);
  assert.ok(slow.get('ParamMouthForm') < 0 && slow.get('ParamMouthForm') > -.65);
  assert.equal(slow.get('ParamMouthOpenY'), .7);
  for (let frame = 1; frame < 20; frame++) slow.controller.update(.05, speaking);
  for (let frame = 1; frame < 40; frame++) fast.controller.update(.025, speaking);
  near(slow.get('ParamMouthForm'), fast.get('ParamMouthForm'));
  slow.controller.update(0, { ...speaking, speaking: false });
  assert.equal(slow.get('ParamMouthOpenY'), 0);
});

test('Cubism hidden, sleeping and reduced-motion states clear every crossfade entry immediately and never replay an interaction', () => {
  for (const options of [{ hidden: true }, { sleeping: true }, { reducedMotion: true }]) {
    const result = rig({ motions: { TapHead_0: { ParamAngleX: 8 }, Greet_0: { ParamAngleZ: -4 }, Idle_0: { ParamBreath: .4 } }, expressions: { neutral: {}, happy: { ParamCheek: .7 } } });
    result.controller.update(.1, { expression: 'happy' });
    result.controller.react('pet'); result.controller.react('greet');
    result.controller.update(.1, { speaking: true, mouthOpen: .8, mouthShape: 'O' });
    result.controller.update(0, { speaking: true, mouthOpen: .8, mouthShape: 'O' }, {}, options);
    assert.equal(result.motionManager.entries.length, 0);
    assert.equal(result.expressionManager.entries.length, 0);
    assert.equal(result.controller.motionGroup, '');
    assert.equal(result.get('ParamMouthOpenY'), options.reducedMotion ? .8 : 0);
    assert.equal(result.get('ParamEyeLOpen'), options.sleeping ? 0 : 1);
    const starts = result.motionManager.starts.length;
    result.controller.react('pet'); assert.equal(result.motionManager.starts.length, starts);
    result.controller.update(.1, { gesture: 'none' });
    assert.equal(result.controller.motionGroup, 'Idle');
  }
});

test('Cubism real eyelid and height-only eyebrow rigs show sleepy and asymmetric micro expressions', () => {
  const tired = cubismParameterTargets({ sleepyAmount: 1, blinkLeft: 0, blinkRight: .5 });
  near(tired.ParamEyeLOpen, .62); near(tired.ParamEyeROpen, .31);
  const heightOnly = cubismParameterTargets({ browRaise: .2, browTilt: .5 }, {}, { supportedParameters: ['ParamBrowLY', 'ParamBrowRY'] });
  near(heightOnly.ParamBrowLY, .2); near(heightOnly.ParamBrowRY, .08);
  const angleRig = cubismParameterTargets({ browRaise: .2, browTilt: .5 }, {}, { supportedParameters: ['ParamBrowLY', 'ParamBrowRY', 'ParamBrowLAngle', 'ParamBrowRAngle'] });
  near(angleRig.ParamBrowLY, .14); near(angleRig.ParamBrowRY, .14);
  assert.equal(rig().bridge.read('ParamBrowLAngle'), undefined);
});
