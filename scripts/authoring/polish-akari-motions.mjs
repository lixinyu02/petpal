// Original PetPal motion overlay, 2026-10-02. No PSD2Live/compiler code is embedded.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
assert(args.length <= 1, 'Usage: node scripts/authoring/polish-akari-motions.mjs [existing-model-directory]');
const projectRoot = fs.realpathSync(path.resolve(import.meta.dirname, '../..'));
const requested = path.resolve(projectRoot, args[0] || 'public/avatars/akari-cubism-v4');
assert(fs.existsSync(requested) && fs.statSync(requested).isDirectory(), 'Target must be an existing model directory');
const root = fs.realpathSync(requested);
assert(root.startsWith(projectRoot + path.sep), 'Target must remain inside the PetPal checkout');
assert(root !== path.join(projectRoot, 'public/avatars/akari-cubism'), 'The legacy package is immutable; use the v2 package or an independent export');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function asset(relative) {
  assert(typeof relative === 'string' && relative && !relative.includes('\\') && !relative.includes(':') && !relative.includes('?') && !relative.includes('#'), 'Only local model references are accepted');
  const resolved = path.resolve(root, relative);
  assert(resolved.startsWith(root + path.sep) && fs.statSync(resolved).isFile(), 'Missing or escaping model asset');
  assert(fs.realpathSync(resolved).startsWith(root + path.sep), 'Model asset symlink escapes the package');
  return resolved;
}
const manifestPath = asset('akari.model3.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.Version, 3, 'Expected Cubism model3');
assert.equal(manifest.FileReferences.Physics, 'akari.physics3.json');
assert.equal(manifest.FileReferences.DisplayInfo, 'akari.cdi3.json');
assert.equal(manifest.FileReferences.Moc, 'akari.moc3');
assert.deepEqual(manifest.FileReferences.Textures, ['akari.2048/texture_00.png']);
const verifiedProfiles = [
  {
    name: 'classic',
    mocSha256: 'a48d4570dfd2fdb1f9d99afe94920759d78ac1cc016dfaf0f62c365ce0c307e0',
    textureSha256: 'd7d3079b151d8508607af79d12d37b2f808a9b13b0f6acafb4927f745849d84b',
  },
  {
    name: 'continuous-body',
    mocSha256: '29185d2b500ac0b2e1e15f2b053b3fd6444ba72e93a8b33a388f4da8edb04f0b',
    textureSha256: 'e1f468582ecf6a000068128deaa74c2878ec2c01a2529d3c89ef307cc9d62020',
  },
  {
    name: 'stable-portrait',
    mocSha256: 'a2d249efa9d9cccd357555aae59afcca3f5d951d619bc52bde8001eb2a46ced4',
    textureSha256: 'a1a6d18d18ee055c41eb679047cb0b8db282b347852ce5c4fb0226099feead2e',
  },
  {
    name: 'stable-portrait',
    mocSha256: 'a2dd75ed234fb45cd97c6f1e26cc156c13bb8b671a9f70b7e7a21e882349ed26',
    textureSha256: 'bdf66abcce40b3178e1383cf3dac4805675f3ec95d5c9a264fae018a896dbc6f',
  },
];
const mocSha256 = sha256(fs.readFileSync(asset(manifest.FileReferences.Moc)));
const textureSha256 = sha256(fs.readFileSync(asset(manifest.FileReferences.Textures[0])));
// A supported MOC and a supported atlas must be from the same verified export.
const profile = verifiedProfiles.find(item => item.mocSha256 === mocSha256 && item.textureSha256 === textureSha256);
assert(profile, 'Overlay requires a complete verified authoring MOC/texture pair');
const physicsPath = asset(manifest.FileReferences.Physics);
const physics = JSON.parse(fs.readFileSync(physicsPath, 'utf8'));
assert.equal(physics.Version, 3);
assert.deepEqual(physics.PhysicsSettings.map(item => item.Id), profile.name === 'stable-portrait'
  ? ['PhysicsHairBack', 'PhysicsHairFront'] : ['PhysicsHairBack', 'PhysicsHairFront', 'PhysicsEyeJelly']);
const supported = new Map([
  ['ParamAngleX', [-45, 45]], ['ParamAngleY', [-30, 30]], ['ParamAngleZ', [-30, 30]],
  ['ParamBodyAngleX', [-10, 10]], ['ParamBodyAngleY', [-10, 10]], ['ParamBodyAngleZ', [-10, 10]],
  ['ParamEyeLOpen', [0, 1]], ['ParamEyeROpen', [0, 1]], ['ParamEyeBallX', [-1, 1]], ['ParamEyeBallY', [-1, 1]], ['ParamEyeBallForm', [-1, 1]],
  ['ParamBrowLY', [-1, 1]], ['ParamBrowRY', [-1, 1]], ['ParamMouthForm', [-1, 1]], ['ParamMouthOpenY', [0, 1]], ['ParamBreath', [0, 1]],
  ['ParamHairFront', [-1, 1]], ['ParamHairBack', [-1, 1]], ['ParamCheek', [0, 1]], ['ParamTear', [0, 1]],
]);
const display = JSON.parse(fs.readFileSync(asset(manifest.FileReferences.DisplayInfo), 'utf8'));
assert.equal(display.Parameters.length, supported.size);
assert.equal(new Set(display.Parameters.map(item => item.Id)).size, supported.size);
assert(display.Parameters.every(item => supported.has(item.Id)), 'Display information does not match the verified rig');
for (const group of ['Idle', 'Nod', 'Shake']) {
  assert.equal(manifest.FileReferences.Motions[group].length, 1);
  assert.equal(manifest.FileReferences.Motions[group][0].File, 'akari.' + group.toLowerCase() + '.motion3.json');
  asset(manifest.FileReferences.Motions[group][0].File);
}
const artifacts = new Map();
function stage(name, value) {
  const target = path.join(root, name);
  if (fs.existsSync(target)) assert(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink(), 'Output must be a regular package member');
  artifacts.set(name, JSON.stringify(value, null, 2) + '\n');
}
const round = value => Number(value.toFixed(6));
function curve(id, keys) {
  const range = supported.get(id);
  assert(range && keys.length >= 2, 'Curve must use a supported real parameter');
  assert(keys.every(([time, value], index) => Number.isFinite(time) && Number.isFinite(value) && value >= range[0] && value <= range[1] && (!index || time > keys[index - 1][0])), 'Curve key range/time is invalid');
  const segments = [...keys[0]];
  for (let index = 1; index < keys.length; index++) {
    const [start, value] = keys[index - 1], [end, next] = keys[index];
    // Restricted Bezier control times give linear time and smoothstep values.
    segments.push(1, round(start + (end - start) / 3), value,
      round(end - (end - start) / 3), next, end, next);
  }
  return { Target: 'Parameter', Id: id, Segments: segments };
}
function writeMotion(name, duration, loop, fadeIn, fadeOut, keys) {
  const curves = Object.entries(keys).map(([id, points]) => curve(id, points));
  const segments = curves.reduce((total, item) => total + (item.Segments.length - 2) / 7, 0);
  const motion = {
    Version: 3,
    Meta: { Duration: duration, Fps: 30, Loop: loop, AreBeziersRestricted: true,
      CurveCount: curves.length, TotalSegmentCount: segments, TotalPointCount: segments * 3 + curves.length,
      UserDataCount: 0, TotalUserDataSize: 0,
      ...(profile.name === 'stable-portrait' ? { FadeInTime: fadeIn, FadeOutTime: fadeOut } : {}) },
    FadeInTime: fadeIn, FadeOutTime: fadeOut, Curves: curves,
  };
  stage(`akari.${name}.motion3.json`, motion);
}

writeMotion('idle', 9, true, .65, .5, {
  ParamBreath: [[0, .3], [1.125, .45], [2.25, .6], [3.375, .45], [4.5, .3], [5.625, .45], [6.75, .6], [7.875, .45], [9, .3]],
  ParamAngleX: [[0, 0], [2.25, 1.2], [4.5, .35], [6.75, -.85], [9, 0]],
  ParamAngleY: [[0, -.15], [2.25, .45], [4.5, -.15], [6.75, .35], [9, -.15]],
  ParamAngleZ: [[0, 0], [2.8, -.65], [5.8, .45], [9, 0]],
  ParamBodyAngleX: [[0, 0], [2.65, .45], [5.6, -.35], [9, 0]],
  ParamBodyAngleY: [[0, -.1], [2.4, .3], [4.5, -.1], [6.9, .3], [9, -.1]],
  ParamBodyAngleZ: [[0, 0], [3.1, -.24], [6.2, .18], [9, 0]],
});
writeMotion('nod', 1.7, false, .14, .35, {
  ParamAngleY: [[0, 0], [.45, -8.5], [.98, 2], [1.7, 0]],
  ParamBodyAngleY: [[0, 0], [.5, -1.2], [1.05, .25], [1.7, 0]],
  ParamEyeLOpen: [[0, 1], [.42, .9], [.95, 1], [1.7, 1]],
  ParamEyeROpen: [[0, 1], [.42, .9], [.95, 1], [1.7, 1]],
});
writeMotion('shake', 1.95, false, .14, .4, {
  ParamAngleX: [[0, 0], [.4, -9], [.95, 8], [1.42, -2.2], [1.95, 0]],
  ParamBodyAngleX: [[0, 0], [.48, -1.1], [1.05, .95], [1.5, -.2], [1.95, 0]],
  ParamAngleZ: [[0, 0], [.45, -.8], [1, .8], [1.48, -.2], [1.95, 0]],
});
writeMotion('taphead', 2.65, false, .16, .5, {
  ParamAngleX: [[0, 0], [.62, -1.4], [1.65, -.6], [2.65, 0]],
  ParamAngleY: [[0, 0], [.48, -2.8], [1.25, -1.6], [2.65, 0]],
  ParamAngleZ: [[0, 0], [.7, -4], [1.65, -1.7], [2.65, 0]],
  ParamBodyAngleY: [[0, 0], [.6, -.35], [1.65, -.12], [2.65, 0]],
  ParamEyeLOpen: [[0, 1], [.38, .26], [.78, .26], [1.55, .72], [2.65, 1]],
  ParamEyeROpen: [[0, 1], [.38, .26], [.78, .26], [1.55, .72], [2.65, 1]],
  ParamBrowLY: [[0, 0], [.48, .08], [1.2, .14], [2.65, 0]],
  ParamBrowRY: [[0, 0], [.48, .08], [1.2, .14], [2.65, 0]],
  ParamCheek: [[0, 0], [.8, .5], [1.5, .4], [2.65, 0]],
  ParamMouthForm: [[0, 0], [.52, .42], [1.5, .28], [2.65, 0]],
});
writeMotion('greet', 2.15, false, .18, .45, {
  ParamAngleX: [[0, 0], [.55, .9], [1.3, .4], [2.15, 0]],
  ParamAngleY: [[0, 0], [.48, -4.2], [1.05, 1], [2.15, 0]],
  ParamAngleZ: [[0, 0], [.55, 2.3], [1.3, 1], [2.15, 0]],
  ParamBodyAngleY: [[0, 0], [.55, -.55], [1.1, .1], [2.15, 0]],
  ParamEyeLOpen: [[0, 1], [.5, .76], [1.35, 1], [2.15, 1]],
  ParamEyeROpen: [[0, 1], [.5, .76], [1.35, 1], [2.15, 1]],
  ParamBrowLY: [[0, 0], [.42, .28], [1.1, .12], [2.15, 0]],
  ParamBrowRY: [[0, 0], [.42, .28], [1.1, .12], [2.15, 0]],
  ParamCheek: [[0, 0], [.7, .14], [1.3, .12], [2.15, 0]],
  ParamMouthForm: [[0, 0], [.52, .36], [1.35, .2], [2.15, 0]],
});
manifest.FileReferences.Motions.TapHead = [{ File: 'akari.taphead.motion3.json', FadeInTime: .16, FadeOutTime: .5 }];
manifest.FileReferences.Motions.Greet = [{ File: 'akari.greet.motion3.json', FadeInTime: .18, FadeOutTime: .45 }];
for (const [group, fadeIn, fadeOut] of [['Idle', .65, .5], ['Nod', .14, .35], ['Shake', .14, .4]]) {
  Object.assign(manifest.FileReferences.Motions[group][0], { FadeInTime: fadeIn, FadeOutTime: fadeOut });
}
stage('akari.model3.json', manifest);

for (const setting of physics.PhysicsSettings) {
  if (setting.Id === 'PhysicsEyeJelly') continue;
  for (const input of setting.Input) input.Weight = input.Type === 'X'
    ? input.Source.Id.startsWith('ParamBody') ? 20 : 30
    : input.Source.Id.startsWith('ParamBody') ? 24 : 36;
  const back = setting.Id === 'PhysicsHairBack';
  setting.Output[0].Scale = back ? 1.25 : .85;
  Object.assign(setting.Vertices[1], { Mobility: back ? .88 : .72, Delay: back ? .58 : .7, Acceleration: back ? 1.3 : .95 });
}
stage('akari.physics3.json', physics);
const pending = [];
try {
  // Preflight every member before writing; replace each file atomically.
  for (const [name, contents] of artifacts) {
    const target = path.join(root, name), temporary = target + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temporary, contents, { flag: 'wx' });
    pending.push({ target, temporary });
  }
  for (const item of pending) fs.renameSync(item.temporary, item.target);
} finally {
  for (const item of pending) if (fs.existsSync(item.temporary)) fs.unlinkSync(item.temporary);
}
console.log(JSON.stringify({ status: 'pass', bundle: path.relative(projectRoot, root).replaceAll(path.sep, '/'), profile: profile.name, overlay: '2026-10-02-motion-polish', files: [...artifacts.keys()] }));
