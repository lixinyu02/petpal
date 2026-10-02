/** V9 is a reproducible expression-motion pack on the unchanged real V8 rig. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const baseline = path.join(root, 'public/avatars/akari-cubism-v8');
const bundle = path.join(root, 'public/avatars/akari-cubism-v9');
const previousGroups = ['Idle', 'Blink', 'Nod', 'Shake', 'TapHead', 'Greet', 'Shy', 'Sway', 'Bow'];
const round = value => Math.round(value * 1e6) / 1e6;

// Restricted Beziers with flat key tangents give a gentle hold and a smooth
// return. Eye patches use a short complete closure, never a prolonged half eye.
function curve(id, keys) {
  const segments = [...keys[0]];
  for (let index = 1; index < keys.length; index++) {
    const [start, from] = keys[index - 1], [end, to] = keys[index];
    if (!(end > start)) throw new Error(`Non-increasing curve: ${id}`);
    segments.push(1, round(start + (end - start) / 3), from, round(end - (end - start) / 3), to, end, to);
  }
  return { Target: 'Parameter', Id: id, Segments: segments };
}

function gesture(duration, curves, fadeIn = .2, fadeOut = .36) {
  const items = Object.entries(curves).map(([id, keys]) => {
    const neutral = /^ParamEye[LR]Open$/.test(id) ? 1 : 0;
    if (keys[0][0] !== 0 || keys.at(-1)[0] !== duration || keys[0][1] !== neutral || keys.at(-1)[1] !== neutral) throw new Error(`Gesture must return to neutral: ${id}`);
    for (const [time, value] of keys) {
      const min = id === 'ParamHandsSway' ? -1 : /HandsLift|SleeveEase|Eye[LR]Open/.test(id) ? 0 : -3;
      const max = /Hands|SleeveEase|Eye[LR]Open/.test(id) ? 1 : 3;
      if (!Number.isFinite(time) || time < 0 || time > duration || !Number.isFinite(value) || value < min || value > max) throw new Error(`Gesture exceeds restrained range: ${id}`);
    }
    return curve(id, keys);
  });
  const segments = Object.values(curves).reduce((sum, keys) => sum + keys.length - 1, 0);
  return { Version: 3, Meta: { Duration: duration, Fps: 30, Loop: false, AreBeziersRestricted: true, CurveCount: items.length, TotalSegmentCount: segments, TotalPointCount: items.length + 3 * segments, UserDataCount: 0, TotalUserDataSize: 0 }, FadeInTime: fadeIn, FadeOutTime: fadeOut, Curves: items };
}

export function buildExpressionMotions() {
  return new Map([
    ['Curious', gesture(1.6, {
      ParamAngleX: [[0, 0], [.48, 2], [.86, 1.8], [1.6, 0]],
      ParamAngleY: [[0, 0], [.5, .8], [.9, .65], [1.6, 0]],
      ParamAngleZ: [[0, 0], [.48, 1.7], [.94, 1.5], [1.6, 0]],
      ParamHandsLift: [[0, 0], [.6, .16], [1, .12], [1.6, 0]],
      ParamSleeveEase: [[0, 0], [.68, .08], [1.6, 0]],
    })],
    ['Think', gesture(1.6, {
      ParamAngleX: [[0, 0], [.5, -2.2], [.95, -1.8], [1.6, 0]],
      ParamAngleY: [[0, 0], [.53, -1.4], [.95, -1], [1.6, 0]],
      ParamAngleZ: [[0, 0], [.6, -1.3], [.96, -1.1], [1.6, 0]],
      ParamHandsLift: [[0, 0], [.56, .36], [.98, .3], [1.6, 0]],
      ParamHandsSway: [[0, 0], [.66, -.18], [1.05, -.12], [1.6, 0]],
      ParamSleeveEase: [[0, 0], [.68, .12], [1.6, 0]],
    })],
    ['Listen', gesture(1.9, {
      ParamAngleY: [[0, 0], [.46, -.9], [.88, -.3], [1.23, -.75], [1.9, 0]],
      ParamAngleZ: [[0, 0], [.6, .65], [1.23, .45], [1.9, 0]],
      ParamBodyAngleY: [[0, 0], [.56, .22], [1.25, .16], [1.9, 0]],
      ParamHandsLift: [[0, 0], [.55, .13], [1.28, .1], [1.9, 0]],
      ParamSleeveEase: [[0, 0], [.68, .07], [1.9, 0]],
    })],
    ['Surprise', gesture(1.25, {
      ParamAngleY: [[0, 0], [.3, 1.65], [.6, .55], [1.25, 0]],
      ParamAngleZ: [[0, 0], [.33, -.8], [.7, -.3], [1.25, 0]],
      ParamBodyAngleY: [[0, 0], [.32, -.32], [.67, -.12], [1.25, 0]],
      ParamHandsLift: [[0, 0], [.3, .55], [.62, .25], [1.25, 0]],
      ParamSleeveEase: [[0, 0], [.39, .26], [.72, .12], [1.25, 0]],
    }, .12, .3)],
    ['Reassure', gesture(1.9, {
      ParamAngleY: [[0, 0], [.53, -1.7], [1.02, -.65], [1.9, 0]],
      ParamAngleZ: [[0, 0], [.51, .65], [1.17, -.5], [1.9, 0]],
      ParamHandsLift: [[0, 0], [.62, .34], [1.2, .28], [1.9, 0]],
      ParamHandsSway: [[0, 0], [.7, .15], [1.23, -.12], [1.9, 0]],
      ParamSleeveEase: [[0, 0], [.74, .18], [1.28, .14], [1.9, 0]],
    })],
    ['Wink', gesture(1.35, {
      ParamEyeROpen: [[0, 1], [.3, 1], [.44, 0], [.6, 0], [.78, 1], [1.35, 1]],
      ParamAngleZ: [[0, 0], [.43, -1.4], [.72, -1.1], [1.35, 0]],
      ParamHandsLift: [[0, 0], [.5, .2], [.8, .12], [1.35, 0]],
      ParamSleeveEase: [[0, 0], [.61, .1], [1.35, 0]],
    }, .16, .3)],
    ['Doze', gesture(2.4, {
      ParamEyeLOpen: [[0, 1], [.48, 1], [.7, 0], [.95, 0], [1.18, 1], [2.4, 1]],
      ParamEyeROpen: [[0, 1], [.48, 1], [.7, 0], [.95, 0], [1.18, 1], [2.4, 1]],
      ParamAngleY: [[0, 0], [.85, -2], [1.15, -1.6], [1.7, .35], [2.4, 0]],
      ParamAngleZ: [[0, 0], [.8, -.8], [1.2, -.55], [2.4, 0]],
      ParamHandsLift: [[0, 0], [.86, .08], [1.25, .04], [2.4, 0]],
    }, .24, .4)],
  ]);
}

const readme = `# Akari V9 神态动作包\n\nV9 完整复用 V8 的真实 Cubism rig：11 个 ArtMesh、19 个参数、2550 个顶点。MOC、纹理、物理、显示信息、图层元数据与原有九组动作逐字节保留，没有新增绑定、重绘人物或重新导出模型。\n\n新增七组原生 motion：Curious（好奇歪头）、Think（思考）、Listen（专注倾听）、Surprise（轻微惊讶）、Reassure（安慰）、Wink（右眼短眨）、Doze（短暂困倦后恢复）。合计 16 组。所有动作从中性开始并返回中性；不写嘴型和整脸情绪覆片，以免打断朗读或叠加表情。\n\n手部仍为原有交握姿势的小幅轻抬和轻摆，不具备独立手臂、指骨或完整挥手。眼睛使用原有局部闭眼素材；没有新增连续眼睑或眼球绑定。Doze 是一次短动作，不是长期睡眠状态。\n\n生成入口：\`node scripts/authoring/prepare-akari-expression-motions.mjs\`，仅写入 V9 目录。MOC SHA-256：\`29ebb1c652f658b2033996583409b920beecd94d2c2b3667b6c67e6820694246\`。原始模型作者说明与 Editor 验收边界见 [V8 说明](../akari-cubism-v8/README.md)。\n`;

/** Pure byte plan: callers can prove determinism without rewriting assets. */
export function buildExpressionBundle(originalFiles) {
  const files = new Map([...originalFiles].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const manifest = JSON.parse(files.get('akari.model3.json'));
  if (JSON.stringify(Object.keys(manifest.FileReferences.Motions)) !== JSON.stringify(previousGroups)) throw new Error('Expected all nine reviewed V8 groups in their original order.');
  if (!files.has(manifest.FileReferences.Moc) || manifest.FileReferences.Textures.some(name => !files.has(name))) throw new Error('V8 real MOC and textures are required.');
  for (const [group, motion] of buildExpressionMotions()) {
    const filename = `akari.${group.toLowerCase()}.motion3.json`;
    if (files.has(filename)) throw new Error(`Refusing to replace reviewed source: ${filename}`);
    files.set(filename, Buffer.from(JSON.stringify(motion, null, 2) + '\n'));
    manifest.FileReferences.Motions[group] = [{ File: filename, FadeInTime: motion.FadeInTime, FadeOutTime: motion.FadeOutTime }];
  }
  if (Object.keys(manifest.FileReferences.Motions).length !== 16) throw new Error('Motion bundle exceeds the 16-group limit.');
  files.set('akari.model3.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  files.set('README.md', Buffer.from(readme));
  return files;
}

export function prepareExpressionMotions() {
  const files = new Map();
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(path.join(directory, entry.name), `${name}/`);
      else if (entry.isFile()) files.set(name, fs.readFileSync(path.join(directory, entry.name)));
      else throw new Error(`Unexpected non-regular V8 entry: ${name}`);
    }
  }
  visit(baseline);
  for (const [name, bytes] of buildExpressionBundle(files)) {
    const target = path.resolve(bundle, name);
    if (!target.startsWith(`${bundle}${path.sep}`)) throw new Error(`Output escaped V9: ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes)) fs.writeFileSync(target, bytes);
  }
  console.log('Prepared V9: seven added native gestures, 16 groups, unchanged V8 MOC/texture/rig and nine original motions.');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) prepareExpressionMotions();
