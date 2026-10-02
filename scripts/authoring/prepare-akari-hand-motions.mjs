/** Add restrained joined-hand motions to the real V8 rig; never rewrite V7. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const baseline = path.join(root, 'public/avatars/akari-cubism-v7');
const bundle = path.join(root, 'public/avatars/akari-cubism-v8');
const HANDS = ['ParamHandsLift', 'ParamHandsSway', 'ParamSleeveEase'];
const rounded = value => Math.round(value * 1e6) / 1e6;

// Restricted cubic Beziers: matching flat tangents at each authored key keep
// both the gentle hold and the return smooth, including the looping Idle seam.
function curve(id, keys) {
  const segments = [...keys[0]];
  for (let index = 1; index < keys.length; index++) {
    const [start, from] = keys[index - 1], [end, to] = keys[index];
    if (!(end > start)) throw new Error(`Non-increasing native key: ${id}`);
    segments.push(1, rounded(start + (end - start) / 3), from, rounded(end - (end - start) / 3), to, end, to);
  }
  return { Target: 'Parameter', Id: id, Segments: segments };
}

function recount(motion) {
  let segments = 0, points = 0;
  for (const item of motion.Curves) {
    points++;
    for (let index = 2; index < item.Segments.length;) {
      const kind = item.Segments[index++], count = kind === 1 ? 3 : [0, 2, 3].includes(kind) ? 1 : 0;
      if (!count || index + count * 2 > item.Segments.length) throw new Error(`Invalid native curve: ${item.Id}`);
      for (let point = 0; point < count; point++) {
        const time = item.Segments[index++], value = item.Segments[index++];
        if (!Number.isFinite(time) || !Number.isFinite(value) || time < 0 || time > motion.Meta.Duration) throw new Error(`Invalid native key: ${item.Id}`);
        if (HANDS.includes(item.Id) && (value > 1 || value < (item.Id === 'ParamHandsSway' ? -1 : 0))) throw new Error(`Hand key exceeds real rig range: ${item.Id}`);
        points++;
      }
      segments++;
    }
  }
  Object.assign(motion.Meta, { CurveCount: motion.Curves.length, TotalSegmentCount: segments, TotalPointCount: points });
  return motion;
}

function appendHands(motion, hands) {
  const result = structuredClone(motion);
  result.Curves = result.Curves.filter(item => !HANDS.includes(item.Id));
  for (const [index, keys] of hands.entries()) result.Curves.push(curve(HANDS[index], keys));
  return recount(result);
}

function gesture(duration, curves) {
  const fadeIn = .24, fadeOut = .42;
  return recount({ Version: 3, Meta: { Duration: duration, Fps: 30, Loop: false, AreBeziersRestricted: true, CurveCount: 0, TotalSegmentCount: 0, TotalPointCount: 0, UserDataCount: 0, TotalUserDataSize: 0 }, FadeInTime: fadeIn, FadeOutTime: fadeOut, Curves: Object.entries(curves).map(([id, keys]) => curve(id, keys)) });
}

/** Pure construction is exported for provenance and real-Framework tests. */
export function buildHandMotions(originals) {
  const result = new Map([...originals].map(([group, motion]) => [group, structuredClone(motion)]));
  for (const group of ['Idle', 'Blink', 'Nod', 'Shake', 'TapHead', 'Greet']) if (!result.has(group)) throw new Error(`Missing reviewed V7 group: ${group}`);
  result.set('Idle', appendHands(result.get('Idle'), [
    [[0, 0], [1.5, .018], [3, 0], [4.5, .018], [6, 0]],
    [[0, 0], [1.5, .018], [3, 0], [4.5, -.018], [6, 0]],
    [[0, 0], [1.7, .014], [3, 0], [4.7, .014], [6, 0]],
  ]));
  result.set('Greet', appendHands(result.get('Greet'), [
    [[0, 0], [.55, .58], [1.05, .5], [1.5, .22], [2.15, 0]],
    [[0, 0], [.6, .16], [1.1, -.12], [1.55, .08], [2.15, 0]],
    [[0, 0], [.66, .28], [1.2, .24], [1.65, .1], [2.15, 0]],
  ]));
  result.set('TapHead', appendHands(result.get('TapHead'), [
    [[0, 0], [.7, .38], [1.4, .3], [2, .12], [2.65, 0]],
    [[0, 0], [.8, -.12], [1.55, .08], [2.65, 0]],
    [[0, 0], [.82, .18], [1.5, .15], [2.65, 0]],
  ]));
  result.set('Shy', gesture(2.6, {
    ParamHandsLift: [[0, 0], [.7, .72], [1.45, .66], [2.6, 0]],
    ParamHandsSway: [[0, 0], [.85, -.24], [1.55, -.18], [2.6, 0]],
    ParamSleeveEase: [[0, 0], [.85, .4], [1.65, .32], [2.6, 0]],
    ParamAngleZ: [[0, 0], [.8, -1.8], [1.5, -1.4], [2.6, 0]],
    ParamAngleY: [[0, 0], [.8, -1.6], [1.5, -1.2], [2.6, 0]],
    ParamBodyAngleX: [[0, 0], [.8, -.8], [1.5, -.6], [2.6, 0]],
  }));
  result.set('Sway', gesture(2.8, {
    ParamHandsLift: [[0, 0], [.65, .3], [1.8, .25], [2.8, 0]],
    ParamHandsSway: [[0, 0], [.6, .45], [1.35, -.45], [2.1, .24], [2.8, 0]],
    ParamSleeveEase: [[0, 0], [.75, .18], [1.5, .15], [2.8, 0]],
    ParamAngleZ: [[0, 0], [.6, 1], [1.35, -1], [2.1, .5], [2.8, 0]],
    ParamBodyAngleZ: [[0, 0], [.6, .65], [1.35, -.65], [2.1, .3], [2.8, 0]],
  }));
  result.set('Bow', gesture(2.45, {
    ParamHandsLift: [[0, 0], [.7, .35], [1.2, .35], [2.45, 0]],
    ParamHandsSway: [[0, 0], [2.45, 0]],
    ParamSleeveEase: [[0, 0], [.82, .25], [1.4, .2], [2.45, 0]],
    ParamAngleY: [[0, 0], [.7, -3.2], [1.2, -3.2], [2.45, 0]],
    ParamBodyAngleY: [[0, 0], [.7, -.65], [1.2, -.65], [2.45, 0]],
  }));
  return result;
}

export function prepareHandMotions() {
  // V8 authoring creates its MOC/manifest first. Refuse to turn this motion-only
  // step into an apparently complete model when that prerequisite is absent.
  const manifestPath = path.join(bundle, 'akari.model3.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  if (!fs.statSync(path.join(bundle, manifest.FileReferences.Moc)).isFile()) throw new Error('V8 real MOC is required before motion authoring.');
  const source = JSON.parse(fs.readFileSync(path.join(baseline, 'akari.model3.json')));
  const originals = new Map(Object.entries(source.FileReferences.Motions).map(([group, entries]) => {
    if (entries.length !== 1) throw new Error(`Reviewed source must contain exactly one motion: ${group}`);
    return [group, JSON.parse(fs.readFileSync(path.join(baseline, entries[0].File)))];
  }));
  const motions = buildHandMotions(originals);
  manifest.FileReferences.Motions = {};
  for (const [group, motion] of motions) {
    const filename = `akari.${group.toLowerCase()}.motion3.json`;
    fs.writeFileSync(path.join(bundle, filename), JSON.stringify(motion, null, 2) + '\n');
    manifest.FileReferences.Motions[group] = [{ File: filename, ...(motion.FadeInTime !== undefined ? { FadeInTime: motion.FadeInTime, FadeOutTime: motion.FadeOutTime } : {}) }];
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Prepared nine native V8 motion groups with three real joined-hand/sleeve parameters; V7 unchanged.');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) prepareHandMotions();
