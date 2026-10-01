import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(root, 'public/avatars/akari-cubism-v2');
const readBytes = name => {
  const bytes = fs.readFileSync(path.join(bundle, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'akari.model3.json'), 'utf8'));
const authoredGroups = ['Idle', 'Nod', 'Shake', 'TapHead', 'Greet'];
let framework, actualParameters, previousCore;

before(async () => {
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, Buffer, setTimeout, clearTimeout, atob });
  vm.runInContext(fs.readFileSync(path.join(root, 'public/vendor/live2d/live2dcubismcore.min.js'), 'utf8'), context, { timeout: 10000 });
  const core = context.Live2DCubismCore;
  const deadline = Date.now() + 10000;
  while (true) {
    try { assert(core.Version.csmGetVersion() > 0); break; } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  previousCore = globalThis.Live2DCubismCore;
  globalThis.Live2DCubismCore = core;
  framework = await import('../public/avatars/cubism-runtime/framework.mjs');
  assert.equal(framework.CubismFramework.startUp(), true);
  framework.CubismFramework.initialize(32 * 1024 * 1024);
  const moc = core.Moc.fromArrayBuffer(readBytes(manifest.FileReferences.Moc));
  const model = core.Model.fromMoc(moc);
  try {
    actualParameters = new Map(Array.from(model.parameters.ids, (id, index) => [id, {
      min: model.parameters.minimumValues[index], max: model.parameters.maximumValues[index],
      default: model.parameters.defaultValues[index],
    }]));
    assert.equal(actualParameters.size, 20, 'Validate against actual published rig, not virtual Framework IDs');
  } finally { model.release(); moc._release(); }
});

after(() => {
  framework?.CubismFramework.dispose();
  framework?.CubismFramework.cleanUp();
  if (previousCore === undefined) delete globalThis.Live2DCubismCore;
  else globalThis.Live2DCubismCore = previousCore;
});

function parseCurve(curve, duration) {
  assert.equal(curve.Target, 'Parameter');
  const range = actualParameters.get(curve.Id);
  assert(range, `Motion must use a real MOC parameter: ${curve.Id}`);
  const data = curve.Segments;
  assert(Array.isArray(data) && data.length >= 5 && data.every(Number.isFinite));
  assert.equal(data[0], 0);
  const within = value => assert(value >= range.min && value <= range.max, `${curve.Id} exceeds actual range`);
  within(data[1]);
  let time = data[0], segmentCount = 0, pointCount = 1;
  const points = [[time, data[1]]];
  for (let index = 2; index < data.length;) {
    const type = data[index++];
    assert([0, 1, 2, 3].includes(type));
    const count = type === 1 ? 3 : 1;
    let lastTime = time;
    for (let point = 0; point < count; point++) {
      assert(index + 1 < data.length, 'Truncated motion segment');
      const nextTime = data[index++], value = data[index++];
      assert(nextTime >= lastTime && nextTime <= duration, 'Non-monotonic curve time');
      within(value);
      points.push([nextTime, value]);
      lastTime = nextTime;
    }
    assert(lastTime > time, 'Curve must advance time');
    time = lastTime;
    segmentCount++;
    pointCount += count;
  }
  assert.equal(time, duration, 'Every curve must include the final pose');
  return { points, segmentCount, pointCount };
}

test('authored motions use actual rig ranges, valid Cubism counts, explicit fades and settled endings', () => {
  for (const group of authoredGroups) {
    const entries = manifest.FileReferences.Motions[group];
    assert.equal(entries.length, 1);
    const motion = JSON.parse(fs.readFileSync(path.join(bundle, entries[0].File), 'utf8'));
    assert.equal(motion.Version, 3);
    assert.equal(motion.Meta.Loop, group === 'Idle');
    assert.equal(motion.Meta.AreBeziersRestricted, true);
    assert(motion.Meta.Duration >= 1 && motion.Meta.Duration <= 10);
    assert(motion.FadeInTime > 0 && motion.FadeInTime < 1);
    assert(motion.FadeOutTime > 0 && motion.FadeOutTime < 1);
    assert.equal(entries[0].FadeInTime, motion.FadeInTime);
    assert.equal(entries[0].FadeOutTime, motion.FadeOutTime);
    assert.equal(motion.Meta.CurveCount, motion.Curves.length);
    const ids = new Set();
    let segments = 0, points = 0;
    for (const curve of motion.Curves) {
      assert(!ids.has(curve.Id), 'A motion cannot apply a parameter twice'); ids.add(curve.Id);
      assert(!['ParamMouthOpenY', 'ParamHairBack', 'ParamHairFront', 'ParamTear'].includes(curve.Id), 'Motions must not own TTS, physics or tears');
      const parsed = parseCurve(curve, motion.Meta.Duration);
      segments += parsed.segmentCount; points += parsed.pointCount;
      const first = curve.Segments[1], last = parsed.points.at(-1)[1];
      assert.equal(last, group === 'Idle' ? first : actualParameters.get(curve.Id).default, 'Loop seam or final resting pose is discontinuous');
      if (group === 'Idle') assert(!curve.Id.startsWith('ParamEye'), 'Idle must not double-drive automatic blink');
      if (group === 'Idle' && curve.Id.startsWith('ParamAngle')) assert(parsed.points.every(point => Math.abs(point[1]) <= 1.25), 'Idle must remain subtle');
    }
    assert.equal(motion.Meta.TotalSegmentCount, segments);
    assert.equal(motion.Meta.TotalPointCount, points);
  }
});

function createAvatar() {
  const avatar = new framework.CubismUserModel();
  avatar.loadModel(readBytes(manifest.FileReferences.Moc), true);
  const physics = readBytes(manifest.FileReferences.Physics);
  avatar.loadPhysics(physics, physics.byteLength);
  const model = avatar.getModel();
  assert(model);
  return { avatar, model };
}
function setDefaults(model) {
  for (let index = 0; index < model.getParameterCount(); index++) model.setParameterValueByIndex(index, model.getParameterDefaultValue(index));
  model.saveParameters();
}
function geometrySnapshot(model) {
  return Array.from({ length: model.getDrawableCount() }, (_, index) => Array.from(model.getDrawableVertices(index)));
}

test('official Framework and Core play all authored curves with finite changing mesh and unpinned hair', () => {
  const settingBytes = readBytes('akari.model3.json');
  const setting = new framework.CubismModelSettingJson(settingBytes, settingBytes.byteLength);
  try {
    for (const group of authoredGroups) {
      const { avatar, model } = createAvatar();
      try {
        setDefaults(model); model.update();
        const initial = geometrySnapshot(model);
        const entry = manifest.FileReferences.Motions[group][0], bytes = readBytes(entry.File);
        const authored = JSON.parse(Buffer.from(bytes).toString('utf8'));
        const motion = avatar.loadMotion(bytes, bytes.byteLength, group, undefined, undefined, setting, group, 0, true);
        assert(motion, `Official motion consistency failed: ${group}`);
        motion.setEffectIds([], []);
        avatar._motionManager.startMotionPriority(motion, false, 3);
        let changed = false, hairChanged = false, hairPeak = 0, headPeak = 0;
        const hair = ['ParamHairFront', 'ParamHairBack'].map(id => model.getParameterIndex(framework.CubismFramework.getIdManager().getId(id)));
        for (let frame = 0; frame < Math.ceil((authored.Meta.Duration + 1) * 60); frame++) {
          model.loadParameters();
          avatar._motionManager.updateMotion(model, 1 / 60);
          model.saveParameters();
          headPeak = Math.max(headPeak, ...['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'].map(id => Math.abs(model.getParameterValueById(framework.CubismFramework.getIdManager().getId(id)))));
          avatar._physics.evaluate(model, 1 / 60);
          for (let index = 0; index < model.getParameterCount(); index++) {
            const value = model.getParameterValueByIndex(index);
            assert(Number.isFinite(value) && value >= model.getParameterMinimumValue(index) - 1e-6 && value <= model.getParameterMaximumValue(index) + 1e-6, `${group} produced invalid real parameter`);
          }
          for (const index of hair) {
            const value = model.getParameterValueByIndex(index);
            assert(Math.abs(value) < .98, `${group} hair is pinned to its range limit`);
            hairChanged ||= Math.abs(value) > .0001;
            hairPeak = Math.max(hairPeak, Math.abs(value));
          }
          model.update();
          const current = geometrySnapshot(model);
          for (let drawable = 0; drawable < current.length; drawable++) for (let point = 0; point < current[drawable].length; point++) {
            assert(Number.isFinite(current[drawable][point]) && Math.abs(current[drawable][point]) < 10, `${group} produced exploded mesh`);
            changed ||= Math.abs(current[drawable][point] - initial[drawable][point]) > .00001;
          }
        }
        assert(changed, `${group} must affect actual geometry`);
        // The existing hair rig reacts to yaw/roll, not a pure pitch-only Nod.
        if (group !== 'Nod') assert(hairChanged, `${group} must retain light actual hair movement (hair ${hairPeak}, head ${headPeak})`);
        if (group !== 'Idle') assert.equal(avatar._motionManager.isFinished(), true);
      } finally { avatar.release(); }
    }
  } finally { setting.release(); }
});

test('hair physics references real rig and remains stable under pointer turns at 30, 60 and 120 fps', () => {
  const physics = JSON.parse(fs.readFileSync(path.join(bundle, manifest.FileReferences.Physics), 'utf8'));
  assert.equal(physics.Meta.PhysicsSettingCount, physics.PhysicsSettings.length);
  assert.equal(physics.Meta.TotalInputCount, physics.PhysicsSettings.reduce((sum, item) => sum + item.Input.length, 0));
  assert.equal(physics.Meta.TotalOutputCount, physics.PhysicsSettings.reduce((sum, item) => sum + item.Output.length, 0));
  assert.equal(physics.Meta.VertexCount, physics.PhysicsSettings.reduce((sum, item) => sum + item.Vertices.length, 0));
  for (const item of physics.PhysicsSettings) {
    for (const input of item.Input) assert(actualParameters.has(input.Source.Id));
    for (const output of item.Output) {
      assert(actualParameters.has(output.Destination.Id));
      assert(output.VertexIndex >= 1 && output.VertexIndex < item.Vertices.length);
    }
  }
  for (const fps of [30, 60, 120]) {
    const { avatar, model } = createAvatar();
    try {
      const ids = framework.CubismFramework.getIdManager();
      const headX = ids.getId('ParamAngleX'), headZ = ids.getId('ParamAngleZ'), bodyX = ids.getId('ParamBodyAngleX');
      const hair = ['ParamHairFront', 'ParamHairBack'].map(id => model.getParameterIndex(ids.getId(id)));
      let peak = 0;
      for (let frame = 0; frame < fps * 15; frame++) {
        const seconds = frame / fps;
        setDefaults(model);
        // Deliberately stronger than the normal independent pointer pose.
        model.setParameterValueById(headX, seconds < 7 ? Math.sin(seconds * 1.9) * 20 : 0);
        model.setParameterValueById(headZ, seconds < 7 ? Math.sin(seconds * 1.3) * 8 : 0);
        model.setParameterValueById(bodyX, seconds < 7 ? Math.sin(seconds * 1.4) * 3 : 0);
        avatar._physics.evaluate(model, 1 / fps);
        for (const index of hair) {
          const value = model.getParameterValueByIndex(index);
          assert(Number.isFinite(value) && Math.abs(value) < .98, `Physics saturates at ${fps} fps`);
          peak = Math.max(peak, Math.abs(value));
          if (seconds > 14) assert(Math.abs(value) < .025, `Hair does not settle at ${fps} fps`);
        }
      }
      assert(peak > .01, 'Damping must not remove actual hair response');
    } finally { avatar.release(); }
  }
});
