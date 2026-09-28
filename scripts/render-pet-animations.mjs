import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Run from the PetPal project root. This is chroma-key compositing and frame assembly only.
const root = path.resolve(process.env.PETPAL_PROJECT_ROOT || process.cwd());
const out = path.join(root, 'outputs', 'animations');
const frames = path.join(out, 'frames');
const atlas = path.join(root, 'public', 'pets', 'kitten-sprites.png');
const publicPreview = path.join(root, 'public', 'animations', 'kitten-motions.gif');
const sourceCopy = path.join(out, 'source-sprites-magenta.png');
const originalSource = sourceCopy; // Use the local provenance image or an explicit CLI argument.
const reuseAtlas = process.argv.includes('--reuse-atlas');
const sourceArgument = process.argv.slice(2).find(argument => argument !== '--reuse-atlas');
const source = sourceArgument || await access(sourceCopy).then(() => sourceCopy).catch(() => originalSource);
const ffmpeg = process.env.FFMPEG_PATH || (process.platform === 'win32' ? 'C:/Program Files/ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe' : 'ffmpeg');
const ffprobe = process.env.FFPROBE_PATH || (process.platform === 'win32' ? path.join(path.dirname(ffmpeg), 'ffprobe.exe') : 'ffprobe');
const font = process.env.PETPAL_FONT || (process.platform === 'win32' ? 'C:/Windows/Fonts/msyh.ttc' : '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc');
const actions = [
  { name: 'wave', label: '招招手', sequence: [0,0,0,1,2,1,2,1,2,3,3,3] },
  { name: 'jump', label: '蹦一下', sequence: [0,0,0,1,2,2,3,3,0,0,0,0] },
  { name: 'cuddle', label: '贴贴你', sequence: [0,0,1,1,2,2,2,3,3,3,0,0] },
  { name: 'sleep', label: '打个盹', sequence: [0,0,1,1,2,2,2,2,3,3,3,1] },
];
const commands = [];
const FPS = 5;
const duration = actions[0].sequence.length / FPS;
const cream = '0xF7F3E9';
const quoteFilterPath = value => `'${value.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''")}'`;
function exec(binary, args, { binaryOutput = false } = {}) {
  commands.push({ executable: path.basename(binary), args });
  const result = spawnSync(binary, args, { cwd: root, windowsHide: true, shell: false, timeout: 30_000,
    encoding: binaryOutput ? undefined : 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(binary)} failed (${result.status}): ${String(result.stderr).slice(-5000)}`);
  return result.stdout;
}
function encode(args) { return exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]); }
async function hash(file) { return createHash('sha256').update(await readFile(file)).digest('hex'); }
function probe(file) {
  return JSON.parse(exec(ffprobe, ['-v', 'error', '-count_frames', '-show_entries',
    'stream=codec_name,width,height,pix_fmt,nb_read_frames,r_frame_rate:format=duration', '-of', 'json', file]));
}
function audit(file, cellAnimation = false) {
  const raw = exec(ffmpeg, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { binaryOutput: true });
  let transparent = 0, partialAlpha = 0, visibleMagenta = 0, topPaddingOpaquePixels = 0;
  for (let i = 0; i < raw.length; i += 4) {
    const [r, g, b, a] = raw.subarray(i, i + 4);
    if (a === 0) transparent++;
    else if (a < 255) partialAlpha++;
    if (a > 24 && r > g + 25 && b > g + 25) visibleMagenta++;
    if (cellAnimation && (i / 4) % (320 * 320) < 320 * 6 && a !== 0) topPaddingOpaquePixels++;
  }
  return { decodedPixels: raw.length / 4, transparentPixels: transparent, partialAlphaPixels: partialAlpha, visibleMagentaPixels: visibleMagenta,
    ...(cellAnimation ? { topPaddingRows: 6, topPaddingOpaquePixels } : {}) };
}

await mkdir(frames, { recursive: true });
await mkdir(path.dirname(atlas), { recursive: true });
if (path.resolve(source) !== sourceCopy) await copyFile(source, sourceCopy);
const originalAtlasHash = reuseAtlas ? await hash(atlas) : null;

// RGB chroma key; suppress only the common red+blue excess of the magenta matte.
// Original poses, proportions, and their interior warm colors are not repainted or interpolated.
const keyFilter = "format=rgba,colorkey=0xFF00FF:0.22:0.12,"
  + "geq=r='r(X,Y)-max(0,min(r(X,Y),b(X,Y))-g(X,Y))':g='g(X,Y)':"
  + "b='b(X,Y)-max(0,min(r(X,Y),b(X,Y))-g(X,Y))':a='alpha(X,Y)',"
  + 'format=rgba,scale=1280:1280:flags=lanczos,format=rgba';
if (!reuseAtlas) encode(['-i', sourceCopy, '-vf', keyFilter, '-frames:v', '1', atlas]);

for (let row = 0; row < actions.length; row++) {
  const action = actions[row];
  for (let column = 0; column < 4; column++) {
    // Drop the first six cell rows, then restore transparent padding at the same coordinates.
    // This removes neighboring-pose pixels crossing a row boundary without changing the atlas.
    encode(['-i', atlas, '-vf', `format=rgba,crop=320:314:${column * 320}:${row * 320 + 6},pad=320:320:0:6:color=black@0,format=rgba`, '-frames:v', '1', path.join(frames, `${action.name}-pose-${column}.png`)]);
  }
  for (let i = 0; i < action.sequence.length; i++) {
    await copyFile(path.join(frames, `${action.name}-pose-${action.sequence[i]}.png`), path.join(frames, `${action.name}-${String(i).padStart(2, '0')}.png`));
  }
  // GIF has binary transparency; alpha remains continuous in the PNG atlas.
  encode(['-framerate', String(FPS), '-i', path.join(frames, `${action.name}-%02d.png`),
    '-filter_complex', '[0:v]split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a:alpha_threshold=128',
    '-loop', '0', path.join(out, `${action.name}.gif`)]);
}

const previewInputs = actions.flatMap(action => ['-framerate', String(FPS), '-i', path.join(frames, `${action.name}-%02d.png`)]);
const panels = actions.map((action, index) => {
  const escapedFont = quoteFilterPath(font);
  return `color=c=${cream}:s=360x380:r=${FPS}:d=${duration}[bg${index}];`
    + `[bg${index}][${index}:v]overlay=20:18:shortest=1:format=auto,`
    + `drawtext=fontfile=${escapedFont}:text='${action.label}':fontsize=22:fontcolor=0x35524A:x=(w-tw)/2:y=342[panel${index}]`;
}).join(';');
const previewComposition = `${panels};[panel0][panel1][panel2][panel3]xstack=inputs=4:layout=0_0|360_0|0_380|360_380:fill=${cream}[all]`;
encode([...previewInputs, '-filter_complex', `${previewComposition};[all]split[a][b];[a]palettegen=stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0', path.join(out, 'kitten-motions.gif')]);
await mkdir(path.dirname(publicPreview), { recursive: true });
await copyFile(path.join(out, 'kitten-motions.gif'), publicPreview);
encode(['-i', path.join(out, 'kitten-motions.gif'), '-frames:v', '1', path.join(out, 'kitten-motions-preview.png')]);
encode(['-f', 'lavfi', '-i', `color=c=${cream}:s=1280x1280`, '-i', atlas, '-filter_complex', '[0:v][1:v]overlay=shortest=1:format=auto', '-frames:v', '1', path.join(out, 'atlas-on-cream.png')]);

const artifacts = [];
for (const file of [atlas, ...actions.map(action => path.join(out, `${action.name}.gif`)), path.join(out, 'kitten-motions.gif')]) {
  const cellAnimation = actions.some(action => path.basename(file) === `${action.name}.gif`);
  const result = { path: path.relative(root, file).replace(/\\/g, '/'), sha256: await hash(file), probe: probe(file), alphaAndColorAudit: audit(file, cellAnimation) };
  if (result.alphaAndColorAudit.visibleMagentaPixels) throw new Error(`Visible magenta matte remains in ${result.path}`);
  if (result.alphaAndColorAudit.topPaddingOpaquePixels) throw new Error(`Nontransparent sprite boundary in ${result.path}`);
  artifacts.push(result);
}
const atlasProbe = artifacts[0].probe.streams[0];
if (atlasProbe.width !== 1280 || atlasProbe.height !== 1280 || atlasProbe.pix_fmt !== 'rgba' || !artifacts[0].alphaAndColorAudit.partialAlphaPixels) {
  throw new Error('Atlas dimension/RGBA/soft-alpha verification failed');
}
for (const artifact of artifacts.slice(1)) {
  if (Number(artifact.probe.streams[0].nb_read_frames) !== 12) throw new Error(`Animation frame count mismatch: ${artifact.path}`);
}
if (reuseAtlas && await hash(atlas) !== originalAtlasHash) throw new Error('Preserved atlas bytes changed');

await writeFile(path.join(out, 'render-receipt.json'), JSON.stringify({
  createdAt: new Date().toISOString(), ffmpegVersion: exec(ffmpeg, ['-version']).split('\n')[0],
  source: { original: originalSource, localCopy: 'source-sprites-magenta.png', sha256: await hash(sourceCopy), dimensions: '1254x1254' },
  atlas: { width: 1280, height: 1280, columns: 4, rows: 4, cellWidth: 320, cellHeight: 320, alpha: 'continuous RGBA' },
  fps: FPS, durationSeconds: duration, actions, compositing: { keyFilter, previewBackground: '#F7F3E9', frameInterpolation: false,
    cellTopPaddingRows: 6, atlasPreserved: reuseAtlas, preexistingAtlasSha256: originalAtlasHash },
  publicPreview: { path: 'public/animations/kitten-motions.gif', sha256: await hash(publicPreview) },
  artifacts, commands,
}, null, 2) + '\n');
await copyFile(path.join(root, 'scripts', 'render-pet-animations.mjs'), path.join(out, 'render-pet-animations.mjs'));
for (const name of ['atlas-key-test.png', 'key-preview-test.png']) await unlink(path.join(out, name)).catch(() => {});
console.log(JSON.stringify({ atlas, frames: 12, fps: FPS, durationSeconds: duration, outputs: artifacts.map(artifact => artifact.path), allVisibleMagentaPixels: 0 }, null, 2));
