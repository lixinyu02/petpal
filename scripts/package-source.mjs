// Explicit allowlist source distribution. --check inventories and scans without writing a ZIP.
import { readFile, readdir, stat, lstat, mkdir, writeFile, rename, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { inspectSourceEntry } from './audit-public-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const yauzl = require('yauzl'); // Already locked through the Electron build dependencies.
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error('A stable numeric project version is required.');
const versionSeries = metadata.version.split('.').slice(0, 2).join('.');
const folderName = `PetPal-${metadata.version}-source`;
const archive = path.join(root, 'releases', `${folderName}.zip`);
const checkOnly = process.argv.includes('--check');
const sourceRoots = ['src', 'server', 'desktop', 'public', 'artwork', 'tests', 'scripts', 'docs', 'vendor/cubism-web-framework', 'outputs/avatars/akari-cubism'];
// Recursive source/public/artwork roots include published textures and original artwork.
const requiredCompanionRoots = ['src/avatar', 'public/avatars', 'artwork/akari', 'vendor/cubism-web-framework', 'outputs/avatars/akari-cubism'];
const topFiles = ['.gitattributes', '.gitignore', 'package.json', 'package-lock.json', 'index.html', 'README.md', 'tsconfig.json', 'vite.config.ts', 'capacitor.config.ts', 'LICENSE', 'NOTICE'];
const androidFiles = [
  'android/.gitignore', 'android/build.gradle', 'android/settings.gradle', 'android/variables.gradle', 'android/gradle.properties',
  'android/gradlew', 'android/gradlew.bat', 'android/capacitor.settings.gradle', 'android/verify-apk.ps1',
  'android/gradle/wrapper/gradle-wrapper.jar', 'android/gradle/wrapper/gradle-wrapper.properties',
  'android/app/.gitignore', 'android/app/build.gradle', 'android/app/capacitor.build.gradle', 'android/app/proguard-rules.pro',
  'android/app/src/main/AndroidManifest.xml', 'android/app/src/main/assets/capacitor.config.json', 'android/app/src/main/assets/capacitor.plugins.json',
  'android/capacitor-cordova-android-plugins/build.gradle', 'android/capacitor-cordova-android-plugins/cordova.variables.gradle',
  'android/capacitor-cordova-android-plugins/src/main/AndroidManifest.xml',
];
const androidRoots = ['android/app/src/main/java', 'android/app/src/main/res', 'android/app/src/test', 'android/app/src/androidTest'];
// Preserve the 0.1 art provenance only; the supported companion is the anime character.
const outputFiles = ['source-sprites-magenta.png', 'render-pet-animations.mjs', 'render-receipt.json', 'prompt-receipt.md'].map(name => `outputs/animations/${name}`);
const evidenceFiles = [
  `test-results-${versionSeries}.json`, `web-build-${versionSeries}.json`, `expressive-avatar-acceptance-${versionSeries}.json`,
  `user-voice-acceptance-${versionSeries}.json`, `media-settings-${versionSeries}.png`, `media-settings-mobile-${versionSeries}.png`,
  `native/v${versionSeries.replace('.', '')}-account-media-source.json`,
  `native/android-${versionSeries}-extra-verification.json`,
  `native/windows-${versionSeries}-asar-verification.json`,
  `native/windows-${versionSeries}-final-verification.json`,
  'avatar-research.json',
  'codex-live.json', 'linux-capability.json',
  `linux-verify-allfiles-${versionSeries}.mjs`,
  ...['x64', 'arm64'].map(arch => `linux-package-${arch}-allfiles-${versionSeries}.json`),
].map(name => `evidence/${name}`);
if (versionSeries === '0.5') evidenceFiles.push(...[
  'desktop-assistant-acceptance-0.5.json', 'desktop-assistant-0.5.png', 'desktop-assistant-mobile-0.5.png',
  'opencli-intake-0.5.json', 'npm-audit-0.5.json', 'music-native-status-0.5.json', 'codex-api-live-0.5.json',
  'backend-0.5-acceptance.json', 'backend-0.5-acceptance.md',
  'native/windows-0.5-frozen-inputs.json', 'native/windows-v05-final.json',
  'linux-package-audit-0.5.md', 'linux-package-freeze-0.5.json',
  ...['x64', 'arm64'].flatMap(arch => [`linux-package-${arch}-0.5.0.json`, `linux-package-${arch}-independent-0.5.0.json`]),
].map(name => `evidence/${name}`));
const releaseEvidenceGroups = [
  { receipt: 'native/windows-final.json', files: versionSeries === '0.5'
    ? ['native/windows-final.json', 'native/windows-v05-final']
    : versionSeries === '0.6'
    ? ['native/windows-final.json', 'native/windows-v06-final']
    : versionSeries === '0.4'
    ? ['native/windows-final.json', ...['result.json', 'main.png', 'pet.png', 'cat-main.png', 'cat-pet.png', 'app-singlechunk-response.png', 'app-sleep-quiet.png'].map(name => `native/windows-v04-final/${name}`)]
    : ['native/windows-final.json', 'native/windows-final/result.json', 'native/windows-final/main.png', 'native/windows-final/pet.png', ...['warm', 'curious', 'thoughtful', 'surprised', 'shy', 'mobile'].map(name => `native/windows-final/anime-${name}.png`), 'native/windows-final/anime-system-speech.png', 'native/windows-final/app-singlechunk-response.png', 'native/windows-final/app-sleep-quiet.png'] },
  { receipt: 'native/android-final.json', files: ['native/android-final.json', 'native/android-avatar-policy.json'] },
  ...['x64', 'arm64'].flatMap(arch => [
    { receipt: `linux-package-${arch}.json`, files: [`linux-package-${arch}.json`] },
    { receipt: `linux-package-${arch}-independent.json`, files: [`linux-package-${arch}-independent.json`] },
  ]),
];
const skippedReleaseEvidence = [];
for (const group of releaseEvidenceGroups) {
  const raw = await readFile(path.join(root, 'evidence', group.receipt), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const receipt = raw ? JSON.parse(raw) : null;
  const current = receipt && (receipt.version === metadata.version || (!receipt.version && [receipt.archive, receipt.executable, receipt.apk].some(value => typeof value === 'string' && value.includes(`PetPal-${metadata.version}-`))));
  if (current) evidenceFiles.push(...group.files.map(name => `evidence/${name}`));
  else skippedReleaseEvidence.push({ receipt: `evidence/${group.receipt}`, reason: raw ? 'different release version' : 'not yet produced' });
}
// Old source-window screenshots are evidence only for the release that captured them.
if (versionSeries === '0.3') evidenceFiles.push('evidence/native/windows-v03-source/result.json', 'evidence/native/windows-v03-source/README.md');
const linuxAudit = await readFile(path.join(root, 'evidence/linux-package-audit.md'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
if ([metadata.version, versionSeries].some(version => linuxAudit.split('\n', 1)[0].includes(` ${version} `))) evidenceFiles.push('evidence/linux-package-audit.md');
const blockedSegments = new Set(['node_modules', 'build', '.gradle', '.data', '.tools', 'releases', 'private', '.git', 'dist']);
const excluded = []; const selected = new Set(); const sanitized = [];
function allowed(relative) {
  const parts = relative.split('/');
  return !parts.some(part => blockedSegments.has(part)) && !/(?:^|\/)(?:\.env(?:\..*)?|local\.properties|auth\.json|token(?:\..*)?|.*\.log|draft-alpha-atlas\.png|kitten-atlas-v2\.png)$/i.test(relative)
    && !/\.(?:jks|keystore|p12|pfx|pem|apk|exe|dll|tar|tgz|zip)$/i.test(relative);
}
async function add(relative, required = false) {
  if (!allowed(relative)) { excluded.push(relative); return; }
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error(`Out-of-root source entry: ${relative}`);
  const info = await lstat(absolute).catch(error => { if (!required && error.code === 'ENOENT') return null; throw error; });
  if (!info) return;
  if (info.isSymbolicLink()) throw new Error(`Source symlinks are not allowed: ${relative}`);
  if (info.isDirectory()) {
    for (const entry of (await readdir(absolute)).sort()) await add(`${relative}/${entry}`, true);
  } else if (info.isFile()) {
    if (info.size > 128 * 1024 * 1024) throw new Error(`Unexpected source file size: ${relative}`);
    selected.add(relative);
  }
}
for (const name of [...sourceRoots, ...androidRoots]) await add(name, true);
for (const name of [...topFiles, ...androidFiles, ...outputFiles, ...evidenceFiles]) await add(name);
if (!checkOnly && versionSeries === '0.5') {
  const pending = skippedReleaseEvidence.filter(item => !item.receipt.endsWith('android-final.json'));
  if (pending.length) throw new Error(`Desktop release evidence is not current: ${pending.map(item => item.receipt).join(', ')}`);
  for (const file of [
    'evidence/test-results-0.5.json', 'evidence/web-build-0.5.json', 'evidence/desktop-assistant-acceptance-0.5.json',
    'evidence/codex-api-live-0.5.json', 'evidence/opencli-intake-0.5.json', 'evidence/native/windows-0.5-asar-verification.json',
    'evidence/desktop-assistant-0.5.png', 'evidence/desktop-assistant-mobile-0.5.png', 'docs/acceptance-0.5.md',
  ]) if (!selected.has(file)) throw new Error(`Current desktop acceptance evidence missing: ${file}`);
}

const textExtensions = new Set(['.mjs', '.cjs', '.js', '.ts', '.tsx', '.css', '.html', '.svg', '.json', '.md', '.txt', '.yml', '.yaml', '.xml', '.java', '.gradle', '.properties', '.pro', '.ps1', '.sh', '.bat']);
const hash = contents => createHash('sha256').update(contents).digest('hex');
function sanitizeString(value) {
  const normalized = value.replaceAll('\\', '/');
  const normalizedRoot = root.replaceAll('\\', '/');
  if (normalized.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) return normalized.slice(normalizedRoot.length + 1);
  if (/^[A-Za-z]:\//.test(normalized) || /^\/(?:Users|home)\//.test(normalized)) return `[local-path-redacted]/${path.posix.basename(normalized)}`;
  return value;
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|password|authorization|cookie|credentials|threadId|sessionId|registeredDistributions)$/i.test(key))
    .map(([key, item]) => [key, redact(item)]));
  return typeof value === 'string' ? sanitizeString(value) : value;
}
const entries = [];
for (const relative of [...selected].sort()) {
  let content = await readFile(path.join(root, relative));
  const originalHash = hash(content);
  const textFile = textExtensions.has(path.extname(relative).toLowerCase()) || relative.endsWith('/gradlew') || relative === '.gitignore';
  if (textFile) {
    let text = content.toString('utf8').replace(/^\uFEFF/, '');
    if ((relative.startsWith('evidence/') || relative === 'outputs/animations/render-receipt.json') && relative.endsWith('.json')) {
      const receipt = redact(JSON.parse(text));
      if (relative === 'evidence/codex-live.json') receipt.evidenceReuse = {
        sourceVersion: '0.1.0', scope: `Previously observed real CLI backend protocol response; reused in ${metadata.version}.`,
        limits: `Not a new ${metadata.version} execution, renderer test, cancellation test, or target device acceptance.`,
      };
      text = `${JSON.stringify(receipt, null, 2)}\n`;
    }
    if (relative === 'scripts/render-pet-animations.mjs' || relative === 'outputs/animations/render-pet-animations.mjs') {
      text = text.replace(/^const originalSource = ['"][^'"\r\n]+['"];$/m, 'const originalSource = sourceCopy; // Use the packaged provenance image, never a host user profile.');
    }
    content = Buffer.from(text);
  }
  // The ZIP allowlist explicitly permits sanitized historical receipts. Reuse
  // the public Git scanner as the single content/fixture policy (including binary/escaped key markers),
  // while retaining this packager's independently checked source path policy.
  const contentIssues = inspectSourceEntry({ path: relative, mode: '100644' }, content)
    .filter(issue => issue.reason !== 'runtime, credentials, or generated artifact path');
  if (contentIssues.length) throw new Error(`Source content rejected ${relative}: ${contentIssues.map(issue => issue.reason).join(', ')}`);
  const transformed = originalHash !== hash(content);
  if (transformed) sanitized.push(relative);
  entries.push({ path: relative, content, sha256: hash(content), bytes: content.length, transformed, mode: /\.sh$|(?:^|\/)gradlew$/.test(relative) ? 0o755 : 0o644 });
}
const requiredFiles = [
  'src/App.tsx', 'src/pet/types.ts', 'src/pet/behavior.mjs', 'src/pet/behavior.d.mts',
  'src/AccountsSettings.tsx', 'src/VoiceSettings.tsx', 'src/MediaDevicesSettings.tsx',
  'src/auth/request-scope.mjs', 'src/auth/request-scope.d.mts', 'src/media/device-preferences.mjs', 'src/media/device-preferences.d.mts', 'src/media/devices.ts',
  'server/app.mjs', 'server/codex.mjs', 'server/auth.mjs', 'server/store.mjs', 'server/voice.mjs', 'server/cosyvoice.mjs', 'server/asr.mjs',
  'desktop/main.cjs', 'desktop/window-layout.cjs', 'desktop/media-permissions.cjs', 'desktop/service-settings.cjs', 'package-lock.json', 'android/gradle/wrapper/gradle-wrapper.jar',
  'android/app/src/main/AndroidManifest.xml', 'android/app/src/main/java/com/petpal/app/MainActivity.java', 'android/app/src/main/java/com/petpal/app/LocalMediaChromeClient.java',
  'android/app/src/main/java/com/petpal/app/BackNavigationPolicy.java', 'android/app/src/test/java/com/petpal/app/BackNavigationPolicyTest.java',
  'android/app/src/main/java/com/petpal/app/PetOverlayService.java', 'android/app/src/main/java/com/petpal/app/PetOverlayWebView.java',
  'android/app/src/main/java/com/petpal/app/OverlayAssetPolicy.java', 'android/app/src/test/java/com/petpal/app/OverlayAssetPolicyTest.java',
  'tests/auth-race.test.mjs', 'tests/native-media-permissions.test.mjs',
  'src/DesktopAssistantSettings.tsx', 'src/desktop-settings.mjs', 'src/desktop-settings.d.mts', 'src/desktop-assistant.css',
  'server/codex-config.mjs', 'server/codex-transport.mjs', 'server/desktop-tools.mjs', 'server/music.mjs', 'server/native/music-windows.ps1', 'server/opencli.mjs',
  'tests/music.test.mjs', 'tests/desktop-tools.test.mjs', 'tests/opencli.test.mjs', 'NOTICE',
];
requiredFiles.push('desktop/executor.mjs', 'server/executors.mjs', 'server/remote-codex.mjs', 'server/executor-relay.mjs', 'server/response-message-segments.mjs', 'server/project-directory.mjs');
requiredFiles.push('server/native/codex-review/models-0.143.0.json', 'server/native/codex-review/LICENSE', 'server/native/codex-review/PROVENANCE.json', 'server/native/codex-review/SHA256SUMS');
requiredFiles.push('server/approval-review.mjs', 'server/system-controls.mjs', 'server/native/system-windows.ps1');
for (const required of requiredFiles) if (!selected.has(required)) throw new Error(`Required source entry missing: ${required}`);
const pendingCompanionRoots = requiredCompanionRoots.filter(directory => ![...selected].some(file => file.startsWith(`${directory}/`)));
if (!checkOnly && pendingCompanionRoots.length) throw new Error(`Required companion source/assets missing: ${pendingCompanionRoots.join(', ')}`);
const plan = {
  version: metadata.version, archive: path.relative(root, archive).replaceAll('\\', '/'), checkedAt: new Date().toISOString(),
  checkOnly, files: entries.map(({ content, ...entry }) => entry), totalInputBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
  sanitized, excluded, skippedReleaseEvidence, boundaryScan: 'pass', requiredCompanionRoots, pendingCompanionRoots,
  notes: ['The supported companion is the anime-style character with a Cubism model and a 2D fallback; it shares chat and Codex history.', 'All files under src/avatar, public/avatars and artwork/akari are included through recursive roots; final archive creation requires all listed companion roots to be populated.', 'The outputs/animations provenance and legacy public sprite are retained only as historical 0.1 artwork, not current product or current release acceptance.', `codex-live.json is reused 0.1 real CLI backend protocol evidence, not a new ${metadata.version} model call or native renderer acceptance.`, 'Only explicitly selected evidence is included; JSON local paths and identity/credential fields are removed.', 'Fixture credentials in source are fixed synthetic test strings, never live credentials.', 'Generated Android web assets are rebuilt by npm run android:sync; native sources, asset-policy tests and Gradle wrapper are included.', 'No draft atlas, frame intermediates, runtime state, build output, tools, dependency tree, or logs are included.'],
};
await mkdir(path.join(root, 'evidence'), { recursive: true });
await writeFile(path.join(root, 'evidence', 'source-package-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
if (checkOnly) {
  console.log(JSON.stringify({ checkOnly: true, fileCount: entries.length, totalInputBytes: plan.totalInputBytes, sanitized, excludedCount: excluded.length, boundaryScan: 'pass', pendingCompanionRoots, plan: 'evidence/source-package-plan.json' }, null, 2));
} else {
  // ZIP32 with UTF-8 paths and POSIX permissions, using only Node's built-in zlib.
  const crcTable = Array.from({ length: 256 }, (_, value) => { for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
  const crc32 = buffer => { let crc = 0xffffffff; for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; };
  const manifest = Buffer.from(`${JSON.stringify({ ...plan, checkedAt: undefined, checkOnly: undefined }, null, 2)}\n`);
  entries.push({ path: 'SOURCE-PACKAGE-MANIFEST.json', content: manifest, sha256: hash(manifest), bytes: manifest.length, mode: 0o644 });
  if (entries.length > 65535) throw new Error('ZIP32 file count exceeded.');
  await mkdir(path.dirname(archive), { recursive: true });
  const temporary = `${archive}.partial`;
  const output = await open(temporary, 'w');
  const central = []; let offset = 0;
  const write = async buffer => {
    let written = 0;
    while (written < buffer.length) { const { bytesWritten } = await output.write(buffer, written, buffer.length - written, offset + written); if (!bytesWritten) throw new Error('ZIP output write stalled.'); written += bytesWritten; }
    offset += buffer.length; if (offset > 0xffffffff) throw new Error('ZIP32 size exceeded.');
  };
  try {
  for (const entry of entries) {
    const name = Buffer.from(`${folderName}/${entry.path}`); const compressed = deflateRawSync(entry.content, { level: 6 }); const crc = crc32(entry.content);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(entry.bytes, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x314, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(entry.bytes, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(((0o100000 | entry.mode) << 16) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    central.push(directory, name); await write(header); await write(name); await write(compressed);
  }
  const centralOffset = offset; for (const block of central) await write(block); const centralSize = offset - centralOffset;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(centralOffset, 16); await write(end);
  await output.sync();
  } finally { await output.close(); }
  // Read every actual ZIP entry through an independent existing ZIP implementation.
  const expected = new Map(entries.map(entry => [`${folderName}/${entry.path}`, entry.sha256])); const verified = new Set();
  await new Promise((resolve, reject) => yauzl.open(temporary, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
    if (error) return reject(error);
    zip.on('error', reject); zip.on('end', resolve);
    zip.on('entry', entry => {
      if (!expected.has(entry.fileName) || verified.has(entry.fileName)) { zip.close(); return reject(new Error(`Unexpected ZIP entry: ${entry.fileName}`)); }
      zip.openReadStream(entry, (error, stream) => {
        if (error) return reject(error); const sha = createHash('sha256');
        stream.on('data', chunk => sha.update(chunk)); stream.on('error', reject);
        stream.on('end', () => { if (sha.digest('hex') !== expected.get(entry.fileName)) return reject(new Error(`ZIP payload mismatch: ${entry.fileName}`)); verified.add(entry.fileName); zip.readEntry(); });
      });
    }); zip.readEntry();
  }));
  if (verified.size !== entries.length) throw new Error('ZIP entry count mismatch.');
  await rename(temporary, archive);
  const digest = createHash('sha256'); for await (const chunk of createReadStream(archive)) digest.update(chunk);
  const receipt = { version: metadata.version, archive: path.relative(root, archive).replaceAll('\\', '/'), bytes: (await stat(archive)).size, sha256: digest.digest('hex'), entries: verified.size, boundaryScan: 'pass', zipReadback: 'pass', sanitized };
  await writeFile(`${archive}.sha256`, `${receipt.sha256}  ${path.basename(archive)}\n`);
  await writeFile(path.join(root, 'evidence', 'source-package.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
}
