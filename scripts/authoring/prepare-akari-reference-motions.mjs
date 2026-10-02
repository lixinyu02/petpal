/** Reuse reviewed interaction curves, retaining only real parameters of the new MOC. */
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const bundle = path.join(root, 'public/avatars/akari-cubism-v7');
const baseline = path.join(root, 'public/avatars/akari-cubism-v6');
const ranges = new Map(['AngleX', 'AngleY', 'AngleZ', 'BodyAngleX', 'BodyAngleY', 'BodyAngleZ'].map(name => ['Param' + name, [-10, 10]]));
for (const [name, range] of [['AngleX', [-45, 45]], ['AngleY', [-30, 30]], ['AngleZ', [-30, 30]], ['HairFront', [-1, 1]]]) ranges.set('Param' + name, range);
for (const name of ['EyeLOpen', 'EyeROpen', 'MouthOpenY', 'Breath', 'MouthA', 'MouthO', 'Warm', 'Sad', 'Pout']) ranges.set('Param' + name, [0, 1]);
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'akari.model3.json')));
const interactions = [['TapHead', 'akari.taphead.motion3.json'], ['Greet', 'akari.greet.motion3.json']];
const candidates = Object.entries(manifest.FileReferences.Motions).filter(([group]) => !interactions.some(([name]) => name === group)).flatMap(([group, entries]) => entries.map(entry => [group, entry.File]));
for (const [group, filename] of [...candidates, ...interactions]) {
  const custom = interactions.some(([name]) => name === group);
  const motion = JSON.parse(fs.readFileSync(path.join(custom ? baseline : bundle, filename)));
  motion.Curves = motion.Curves.filter(curve => curve.Target === 'Parameter' && ranges.has(curve.Id));
  let segments = 0, points = 0;
  for (const curve of motion.Curves) {
    const [low, high] = ranges.get(curve.Id), data = curve.Segments;
    const clamp = index => { if (!Number.isFinite(data[index])) throw new Error('Invalid motion value'); data[index] = Math.min(high, Math.max(low, data[index])); };
    clamp(1); points++;
    for (let i = 2; i < data.length;) {
      const type = data[i++], count = type === 1 ? 3 : [0, 2, 3].includes(type) ? 1 : 0;
      if (!count || i + count * 2 > data.length) throw new Error('Invalid native curve');
      for (let p = 0; p < count; p++) { i++; clamp(i++); points++; }
      segments++;
    }
  }
  Object.assign(motion.Meta, { CurveCount: motion.Curves.length, TotalSegmentCount: segments, TotalPointCount: points });
  fs.writeFileSync(path.join(bundle, filename), JSON.stringify(motion, null, 2) + '\n');
  if (custom) manifest.FileReferences.Motions[group] = [{ File: filename, FadeInTime: motion.FadeInTime ?? .18, FadeOutTime: motion.FadeOutTime ?? .45 }];
}
fs.writeFileSync(path.join(bundle, 'akari.model3.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Prepared six native motions using only the 16 real V7 parameter ranges.');
