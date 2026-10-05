import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const yauzl = require('yauzl'), crc32 = require('buffer-crc32');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
class AuditError extends Error {}
const ensure = (condition, message) => { if (!condition) throw new AuditError(message); };
const REQUIRED_PERMISSIONS = ['INTERNET', 'ACCESS_NETWORK_STATE', 'POST_NOTIFICATIONS', 'FOREGROUND_SERVICE_SPECIAL_USE', 'RECORD_AUDIO', 'CAMERA'];
const FORBIDDEN_PERMISSIONS = ['FOREGROUND_SERVICE_DATA_SYNC', 'RECEIVE_BOOT_COMPLETED', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', 'WAKE_LOCK', 'QUERY_ALL_PACKAGES'];
const FORBIDDEN_PRIVATE = /(?:^|\/)(?:\.env(?:\.|$)|\.data(?:\/|$)|(?:notification|background-settings)-runtime-[^/]*\.json$)|\.(?:jks|keystore|pem|key|p12|pfx)$/i;
const FORBIDDEN_RUNTIME = /(?:^|\/)(?:node_modules|\.codex|codex|opencli|runtime|executor|server)(?:\/|\.(?:exe|mjs|cjs|js|cmd|bat)$)|\.(?:exe|dll|node|ps1|bat|cmd|sh|tar|tgz|zip)$/i;
const CREDENTIAL_LITERAL = /(?:Bearer\s+|["'](?:apiKey|api_key|sessionToken|accessToken|password|secretKey)["']\s*:\s*["'])([A-Za-z0-9_-]{24,})/;

export function packageIdentity(text) {
  const name = text.match(/package:\s+name='([^']+)'/)?.[1], version = text.match(/\bversionName='([^']+)'/)?.[1];
  const versionCode = Number(text.match(/\bversionCode='(\d+)'/)?.[1]);
  ensure(name && version && Number.isSafeInteger(versionCode) && versionCode > 0, 'APK package identity is missing or invalid.');
  return { name, version, versionCode, minSdk: Number(text.match(/(?:minSdkVersion|sdkVersion):'(\d+)'/)?.[1]), targetSdk: Number(text.match(/targetSdkVersion:'(\d+)'/)?.[1]) };
}

export function signerCertificates(text) {
  const certificates = [...text.matchAll(/^Signer #(\d+) certificate SHA-256 digest: ([a-f\d]{64})\s*$/gmi)].map(item => item[2].toLowerCase());
  ensure(certificates.length && new Set(certificates).size === certificates.length, 'APK signing certificate set is missing or duplicated.');
  return certificates.sort();
}

export function verifyIdentity(candidate, expected, signers, previous, previousSigners) {
  ensure(candidate.name === expected.applicationId && candidate.version === expected.version && candidate.versionCode === expected.versionCode, 'APK package/version/code differs from the expected release.');
  ensure(candidate.minSdk === expected.minSdk && candidate.targetSdk === expected.targetSdk, 'APK SDK contract differs from the Android build configuration.');
  if (previous) {
    ensure(previous.name === candidate.name && previous.versionCode < candidate.versionCode, 'Previous APK is not an older version of the same application.');
    ensure(JSON.stringify(signers) === JSON.stringify(previousSigners), 'APK signer set differs from the previous client; in-place updates would fail.');
  }
}

export function dexClassNames(bytes) {
  ensure(bytes.length >= 112 && /^dex\n0(?:35|37|38|39|40)\0$/.test(bytes.subarray(0, 8).toString('latin1'))
    && bytes.readUInt32LE(32) === bytes.length && bytes.readUInt32LE(36) === 112 && bytes.readUInt32LE(40) === 0x12345678, 'APK contains an unsupported or invalid DEX header.');
  const table = (countAt, offsetAt, entryBytes) => {
    const count = bytes.readUInt32LE(countAt), offset = bytes.readUInt32LE(offsetAt);
    ensure((count === 0 || offset >= 112) && offset + count * entryBytes <= bytes.length, 'DEX class tables exceed the file bounds.');
    return { count, offset };
  };
  const strings = table(56, 60, 4), types = table(64, 68, 4), definitions = table(96, 100, 32), classes = new Set();
  for (let index = 0; index < definitions.count; index++) {
    const typeIndex = bytes.readUInt32LE(definitions.offset + index * 32); ensure(typeIndex < types.count, 'DEX class type index is invalid.');
    const stringIndex = bytes.readUInt32LE(types.offset + typeIndex * 4); ensure(stringIndex < strings.count, 'DEX class descriptor index is invalid.');
    let cursor = bytes.readUInt32LE(strings.offset + stringIndex * 4), lengthBytes = 0, next;
    do { ensure(cursor < bytes.length && lengthBytes++ < 5, 'DEX class descriptor length is invalid.'); next = bytes[cursor++]; } while (next & 0x80);
    const end = bytes.indexOf(0, cursor); ensure(end >= cursor, 'DEX class descriptor is not terminated.');
    const name = bytes.subarray(cursor, end).toString('utf8');
    ensure(/^L[^;]+;$/.test(name) && !classes.has(name), 'DEX class definition is invalid or duplicated.'); classes.add(name);
  }
  return classes;
}

export async function readApkArchive(apk, { maxBytes = 512 * 1024 * 1024 } = {}) {
  const files = new Map(), names = new Set(); let bytesRead = 0, archiveEntries = 0;
  await new Promise((resolve, reject) => yauzl.open(apk, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error);
    let failed = false;
    const fail = error => { if (!failed) { failed = true; zip.close(); reject(error); } };
    zip.on('error', fail); zip.on('end', resolve);
    zip.on('entry', entry => {
      const name = entry.fileName;
      if (names.has(name) || name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)
          || name.split('/').some(part => part === '..' || part === '.') || (entry.externalFileAttributes >>> 16 & 0xf000) === 0xa000)
        return fail(new AuditError('APK contains a duplicate, unsafe or symbolic-link entry.'));
      names.add(name); archiveEntries++;
      if (archiveEntries > 20000 || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > maxBytes - bytesRead)
        return fail(new AuditError('APK archive exceeds the audit size limit.'));
      if (name.endsWith('/')) { if (entry.uncompressedSize !== 0 || entry.crc32 !== 0) return fail(new AuditError('APK directory entry contains unexpected data.')); zip.readEntry(); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error) return fail(error);
        const chunks = []; let length = 0;
        stream.on('data', chunk => {
          length += chunk.length;
          if (length > entry.uncompressedSize || length > maxBytes - bytesRead) { stream.destroy(); fail(new AuditError('APK resource exceeds the declared size.')); }
          else chunks.push(chunk);
        });
        stream.on('error', fail);
        stream.on('end', () => {
          if (failed) return;
          const bytes = Buffer.concat(chunks);
          if (bytes.length !== entry.uncompressedSize || crc32.unsigned(bytes) !== entry.crc32) return fail(new AuditError('APK resource size or CRC mismatch.'));
          bytesRead += bytes.length; files.set(name, bytes); zip.readEntry();
        });
      });
    }); zip.readEntry();
  }));
  return { files, archiveEntries, bytesRead };
}

async function listFiles(directory, relative = '') {
  const names = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) names.push(...await listFiles(path.join(directory, entry.name), name));
    else { ensure(entry.isFile(), 'Frozen web input contains a non-regular file.'); names.push(name); }
  }
  return names.sort();
}

export async function verifyFrozenWeb(files, web, bridgeDirectory) {
  const names = new Set(await listFiles(web)), assets = [], bridges = [];
  ensure(names.has('index.html'), 'Frozen web entry point is missing.');
  for (const [name, bytes] of files) {
    if (!name.startsWith('assets/public/')) continue;
    const relative = name.slice('assets/public/'.length);
    if (['cordova.js', 'cordova_plugins.js'].includes(relative)) {
      ensure(digest(bytes) === digest(await fs.readFile(path.join(bridgeDirectory, relative))), 'Generated Capacitor bridge differs from the synchronized source.'); bridges.push(relative);
    } else {
      ensure(names.delete(relative), 'APK contains a web resource outside the frozen build.');
      const expected = await fs.readFile(path.join(web, relative));
      ensure(bytes.length === expected.length && digest(bytes) === digest(expected), 'APK web resource differs from the frozen build.');
      assets.push({ file: relative, bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  ensure(names.size === 0, 'APK omits frozen web resources.'); ensure(bridges.length === 2, 'APK omits the generated Capacitor bridges.');
  return { assets: assets.sort((a, b) => a.file.localeCompare(b.file)), bridges };
}

async function privateNeedles(root) {
  const values = new Set(); let sources = 0;
  const collect = (value, key = '') => {
    if (typeof value === 'string' && value.length >= 12 && /api[_-]?key|token|password|secret|authorization/i.test(key)) values.add(value.replace(/^Bearer /, ''));
    if (Array.isArray(value)) value.forEach(item => collect(item, key));
    else if (value && typeof value === 'object') for (const [field, item] of Object.entries(value)) collect(item, field);
  };
  for (const file of ['.data/state.json', '.data/provider-import.json', '.data/cliproxy-provider-import.json']) {
    try { collect(JSON.parse(await fs.readFile(path.join(root, file), 'utf8'))); sources++; }
    catch (error) { if (error.code !== 'ENOENT') throw new AuditError('Private-value scan source is unavailable.'); }
  }
  try { const token = (await fs.readFile(path.join(root, '.data/token'), 'utf8')).trim(); if (token.length >= 12) values.add(token); sources++; }
  catch (error) { if (error.code !== 'ENOENT') throw new AuditError('Private-value scan source is unavailable.'); }
  return { needles: [...values].map(value => Buffer.from(value)), sources };
}

function elementBlock(manifest, type, name) {
  const lines = manifest.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const element = lines[index].match(new RegExp(`^(\\s+)E: ${type} `)); if (!element) continue;
    let end = index + 1;
    while (end < lines.length && (!/^\s*E:/.test(lines[end]) || lines[end].match(/^\s*/)[0].length > element[1].length)) end++;
    const block = lines.slice(index, end).join('\n');
    if (block.includes(`".${name}"`) || block.includes(`"com.petpal.app.${name}"`)) return block;
  }
  return '';
}

export function manifestNumber(block, name) {
  const value = block.match(new RegExp(`android:${name}[^\\n]*=\\s*(0x[0-9a-f]+|[0-9]+)\\b`, 'i'))?.[1];
  return value === undefined ? NaN : Number(value);
}

async function verifyCubism(files, js, defaultModel) {
  ensure(/^\/avatars\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.model3\.json$/.test(defaultModel), 'Expected Cubism model URL is invalid.');
  const escaped = defaultModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = js.match(new RegExp(`\\b([A-Za-z_$][A-Za-z0-9_$]*)=["']${escaped}["']`));
  ensure(declaration, 'Compiled default Cubism model declaration is missing.');
  const variable = declaration[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  ensure(new RegExp(`modelUrl:[A-Za-z_$][A-Za-z0-9_$]*=${variable}(?:[,}])`).test(js), 'Avatar factory does not use the expected default model.');
  ensure(new RegExp(`modelUrl:[A-Za-z_$][A-Za-z0-9_$]*=["']${escaped}["']`).test(js), 'Rendered companion does not use the expected default model.');
  const modelPath = `assets/public${defaultModel}`, prefix = modelPath.slice(0, modelPath.lastIndexOf('/') + 1);
  ensure(files.has(modelPath), 'Default Cubism manifest is missing.');
  const references = JSON.parse(files.get(modelPath).toString('utf8')).FileReferences;
  ensure(references?.Moc && Array.isArray(references.Textures) && references.Textures.length > 0, 'Cubism native model references are incomplete.');
  const resources = [references.Moc, ...references.Textures, references.Physics, references.DisplayInfo, references.Pose, references.UserData,
    ...Object.values(references.Motions || {}).flat().flatMap(item => [item.File, item.Sound]), ...(references.Expressions || []).map(item => item.File)].filter(Boolean);
  for (const resource of resources) ensure(typeof resource === 'string' && resource.split('/').every(part => part && part !== '.' && part !== '..')
    && !resource.includes('\\') && !resource.startsWith('/') && files.has(prefix + resource), 'Cubism model resource closure is incomplete.');
  const coreBytes = files.get('assets/public/vendor/live2d/live2dcubismcore.min.js'); ensure(coreBytes, 'Packaged Cubism Core is missing.');
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, Buffer, setTimeout, clearTimeout, atob });
  vm.runInContext(coreBytes.toString('utf8'), context, { filename: 'apk-cubism-core.js', timeout: 10000 });
  const core = context.Live2DCubismCore; let coreVersion;
  for (let attempt = 0; attempt < 400; attempt++) { try { coreVersion = core.Version.csmGetVersion(); break; } catch { await new Promise(resolve => setTimeout(resolve, 25)); } }
  ensure(coreVersion > 0, 'Packaged Cubism Core did not initialize.');
  const mocBytes = files.get(prefix + references.Moc), mocBuffer = mocBytes.buffer.slice(mocBytes.byteOffset, mocBytes.byteOffset + mocBytes.length);
  ensure(Object.create(core.Moc.prototype).hasMocConsistency(mocBuffer) === 1, 'Packaged Core rejected the native MOC.');
  const moc = core.Moc.fromArrayBuffer(mocBuffer); ensure(moc, 'Packaged MOC could not be opened.'); let model;
  try {
    model = core.Model.fromMoc(moc); ensure(model, 'Packaged MOC could not instantiate a native model.'); model.update();
    const parameters = Array.from(model.parameters.ids), masks = Array.from(model.drawables.maskCounts).reduce((a, b) => a + b, 0);
    ensure(model.drawables.count > 0 && masks >= 2, 'Native model is missing the iris clipping masks.');
    for (const id of ['ParamBrowLAngle', 'ParamBrowRAngle', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeLOpen', 'ParamEyeROpen']) ensure(parameters.includes(id), 'Native model is missing a facial animation parameter.');
    ensure(Array.from(model.drawables.vertexPositions).every(points => Array.from(points).every(Number.isFinite)), 'Native model contains invalid vertices.');
    return { defaultModel, resourcesVerified: resources.length, mocSha256: digest(mocBytes), textures: references.Textures.map(name => ({ path: name, sha256: digest(files.get(prefix + name)) })),
      coreSha256: digest(coreBytes), coreVersion: `${coreVersion >>> 24}.${(coreVersion >>> 16) & 255}.${coreVersion & 65535}`,
      officialCoreExecutedFromApk: true, mocConsistency: true, parameters: model.parameters.count, drawables: model.drawables.count, vertices: Array.from(model.drawables.vertexCounts).reduce((a,b)=>a+b,0), realIrisMasks: masks };
  } finally { model?.release(); moc._release(); }
}

export async function verifyAndroidApk(options) {
  const root = path.resolve(options.root || path.dirname(fileURLToPath(import.meta.url)), options.root ? '.' : '..');
  const project = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const gradle = await fs.readFile(path.join(root, 'android/app/build.gradle'), 'utf8'), variables = await fs.readFile(path.join(root, 'android/variables.gradle'), 'utf8');
  const version = options.version || project.version, versionCode = Number(options.versionCode || gradle.match(/\bversionCode\s+(\d+)/)?.[1]);
  const applicationId = options.applicationId || gradle.match(/\bapplicationId\s+"([^"]+)"/)?.[1];
  ensure(/^\d+\.\d+\.\d+$/.test(version) && Number.isSafeInteger(versionCode) && versionCode > 0, 'Expected Android release version/code is invalid.');
  const resolvePath = value => path.resolve(root, value), apk = resolvePath(options.apk || `releases/android/PetPal-${version}-Android-debug.apk`), web = resolvePath(options.webDirectory || 'dist');
  const evidence = resolvePath(options.evidenceDirectory || `evidence/android-apk-${version}`), sdk = path.resolve(options.sdk || process.env.ANDROID_HOME || 'E:/Android/Sdk');
  const jdk = path.resolve(options.jdk || process.env.JAVA_HOME || path.join(root, '.tools/jdk-21'));
  const tools = path.join(sdk, 'build-tools', gradle.match(/buildToolsVersion\s+'([^']+)'/)?.[1] || '36.1.0');
  const expected = { applicationId, version, versionCode, minSdk: Number(variables.match(/\bminSdkVersion\s*=\s*(\d+)/)?.[1]), targetSdk: Number(variables.match(/\btargetSdkVersion\s*=\s*(\d+)/)?.[1]) };
  await fs.mkdir(evidence, { recursive: true });
  const log = async (name, value) => { await fs.writeFile(path.join(evidence, name), value); return value; };
  // Never leave a previous successful receipt usable after a failed new audit.
  await log('android-apk-audit.json', `${JSON.stringify({ verifiedAt: new Date().toISOString(), passed: false, status: 'verification-incomplete', deviceRuntimeVerified: false }, null, 2)}\n`);
  const tool = (file, args) => { try { return execFileSync(file, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 }); } catch { throw new AuditError(`Android ${path.basename(file)} audit command failed.`); } };
  const exe = name => path.join(tools, process.platform === 'win32' ? `${name}.exe` : name), java = path.join(jdk, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const signing = file => tool(java, ['-jar', path.join(tools, 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', file]);
  const badging = await log('android-apk-badging.log', tool(exe('aapt2'), ['dump', 'badging', apk]));
  const permissions = await log('android-apk-permissions.log', tool(exe('aapt2'), ['dump', 'permissions', apk]));
  const manifest = await log('android-apk-manifest.log', tool(exe('aapt2'), ['dump', 'xmltree', apk, '--file', 'AndroidManifest.xml']));
  const candidateSigning = await log('android-apk-signature.log', signing(apk)), signers = signerCertificates(candidateSigning);
  ensure(/Verified using v1 scheme[^\n]*true/.test(candidateSigning) && /Verified using v2 scheme[^\n]*true/.test(candidateSigning), 'APK must pass both v1 and v2 signature verification.');
  await log('android-apk-zipalign.log', tool(exe('zipalign'), ['-c', '-v', '-P', '16', '4', apk]));
  const candidate = packageIdentity(badging); let previous, previousSigners;
  if (options.previousApk) {
    const previousApk = resolvePath(options.previousApk);
    previous = packageIdentity(await log('android-previous-badging.log', tool(exe('aapt2'), ['dump', 'badging', previousApk])));
    previousSigners = signerCertificates(await log('android-previous-signature.log', signing(previousApk)));
  }
  verifyIdentity(candidate, expected, signers, previous, previousSigners);
  for (const permission of REQUIRED_PERMISSIONS) ensure(permissions.includes(`android.permission.${permission}`), 'Required Android permission is missing.');
  for (const permission of FORBIDDEN_PERMISSIONS) ensure(!permissions.includes(`android.permission.${permission}`), 'Unexpected background/device-wide permission is packaged.');
  ensure(/android:allowBackup[^\n]*=false\b/.test(manifest) && /android:usesCleartextTraffic[^\n]*=false\b/.test(manifest), 'Android backup/HTTPS-only policy differs from the release contract.');
  for (const [type, name] of [['service', 'PetTaskNotificationService'], ['service', 'PetOverlayService'], ['provider', 'PetUpdateFileProvider']]) {
    const block = elementBlock(manifest, type, name); ensure(block && /android:exported[^\n]*=false\b/.test(block), 'A private Android component is missing or exported.');
    if (type === 'service') ensure(manifestNumber(block, 'foregroundServiceType') === 0x40000000, 'Android service lost its special-use foreground type.');
  }
  const activity = elementBlock(manifest, 'activity', 'MainActivity');
  ensure(activity && manifestNumber(activity, 'launchMode') === 2 && manifestNumber(activity, 'windowSoftInputMode') === 0x10, 'Main activity lost singleTask or adjustResize behavior.');
  for (const action of ['VIEW_ADVANCED_POWER_USAGE_DETAIL', 'IGNORE_BATTERY_OPTIMIZATION_SETTINGS', 'APP_NOTIFICATION_SETTINGS', 'APPLICATION_DETAILS_SETTINGS', 'SETTINGS'])
    ensure(manifest.includes(`android.settings.${action}`), 'An Android background-settings route is missing.');
  for (const pkg of ['com.miui.securitycenter', 'com.miui.powerkeeper', 'com.huawei.systemmanager', 'com.coloros.safecenter', 'com.oppo.safe', 'com.vivo.permissionmanager', 'com.iqoo.secure', 'com.samsung.android.lool', 'com.meizu.safe', 'com.asus.mobilemanager'])
    ensure(manifest.includes(pkg), 'A supported OEM background-settings query is missing.');
  const { files, archiveEntries, bytesRead } = await readApkArchive(apk), { needles, sources } = await privateNeedles(root), nativeDefinitions = new Set();
  for (const [name, bytes] of files) {
    ensure(!FORBIDDEN_PRIVATE.test(name) && !FORBIDDEN_RUNTIME.test(name), 'Private file or desktop CLI/server runtime is packaged.');
    ensure(!needles.some(value => bytes.includes(value)), 'A known private credential is packaged.');
    if (/\.(?:json|js|html|txt|xml)$/.test(name)) ensure(!CREDENTIAL_LITERAL.test(bytes.toString('utf8')), 'A hardcoded credential is packaged.');
    if (/^classes\d*\.dex$/.test(name)) for (const descriptor of dexClassNames(bytes)) {
      ensure(!nativeDefinitions.has(descriptor), 'APK contains duplicate class definitions across DEX files.'); nativeDefinitions.add(descriptor);
    }
  }
  const frozen = await verifyFrozenWeb(files, web, path.join(root, 'android/app/src/main/assets/public'));
  const nativeNames = (await fs.readdir(path.join(root, 'android/app/src/main/java/com/petpal/app'))).filter(name => name.endsWith('.java')).map(name => name.slice(0, -5)).sort();
  for (const name of nativeNames) ensure(nativeDefinitions.has(`Lcom/petpal/app/${name};`), `Android native entry/helper closure is incomplete: ${name}.`);
  ensure(![...nativeDefinitions].some(name => /^Lcom\/petpal\/app\/(?:[^;]*Test|CatView);$/.test(name)) && ![...files.keys()].some(name => /androidTest|runtime-test|test-results/.test(name)), 'Retired classes or native runtime tests are packaged.');
  const capacitor = JSON.parse(files.get('assets/capacitor.config.json')?.toString('utf8') || '{}');
  ensure(capacitor.appId === applicationId && capacitor.server?.androidScheme === 'https' && capacitor.android?.allowMixedContent === false && !capacitor.server?.url, 'Capacitor local-only HTTPS bridge configuration is invalid.');
  ensure(JSON.parse(files.get('assets/public/version.json')?.toString('utf8') || '{}').version === version, 'Frozen web version differs from the APK version.');
  const js = [...files].filter(([name]) => /^assets\/public\/assets\/.*\.js$/.test(name)).map(([, bytes]) => bytes.toString('utf8')).join('\n');
  const scene = await fs.readFile(path.join(root, 'src/avatar/cubism/CubismScene.tsx'), 'utf8'), defaultModel = options.defaultModel || scene.match(/modelUrl\s*=\s*'([^']+\.model3\.json)'/)?.[1];
  const cubism = await verifyCubism(files, js, defaultModel), apkBytes = await fs.readFile(apk);
  const report = { verifiedAt: new Date().toISOString(), passed: true,
    app: { file: path.relative(root, apk).replaceAll('\\', '/'), bytes: apkBytes.length, sha256: digest(apkBytes), ...candidate }, webDirectory: web, evidenceDirectory: evidence,
    signing: { developmentSigning: /CN=Android Debug/.test(candidateSigning), schemes: ['v1', 'v2'], certificateSha256: signers,
      previousApkCompared: !!previous, ...(previous ? { previousVersion: previous.version, previousVersionCode: previous.versionCode, sameSignerSet: true } : {}) },
    zipalignVerified: true, fullArchiveEntriesRead: archiveEntries, crcVerifiedEntries: files.size, uncompressedBytesRead: bytesRead,
    frozenWebAssetsCompared: frozen.assets.length, generatedCapacitorBridgesCompared: frozen.bridges.length, assetDigests: frozen.assets,
    nativeClassesVerified: nativeNames, nativeSourceInputs: await Promise.all(nativeNames.map(async name => ({ path: `android/app/src/main/java/com/petpal/app/${name}.java`, sha256: digest(await fs.readFile(path.join(root, `android/app/src/main/java/com/petpal/app/${name}.java`))) }))),
    cubism, notificationService: { present: true, exported: false, type: 'specialUse' }, noDesktopCliOrServerRuntime: true, noRuntimeTestFixtures: true, noRemotePageOverride: true,
    knownPrivateValuesChecked: needles.length, privateScanSourcesAvailable: sources, noKnownPrivateValues: true, credentialsPersistedOrPrinted: false,
    deviceRuntimeVerified: false, androidDeviceAcceptance: { performed: false, reason: 'Package audit only; no device installation, restart or physical-board operation was performed.' } };
  await log('android-apk-audit.json', `${JSON.stringify(report, null, 2)}\n`); await log('SHA256SUMS.txt', `${report.app.sha256}  ${path.basename(apk)}\n`); return report;
}

function argumentsFrom(argv) {
  const names = { '--root': 'root', '--apk': 'apk', '--web-directory': 'webDirectory', '--evidence-directory': 'evidenceDirectory', '--previous-apk': 'previousApk', '--sdk': 'sdk', '--jdk': 'jdk', '--version': 'version', '--version-code': 'versionCode', '--application-id': 'applicationId', '--default-model': 'defaultModel' }, options = {};
  for (let index = 0; index < argv.length; index += 2) {
    ensure(names[argv[index]] && argv[index + 1] && !argv[index + 1].startsWith('--'), 'Unknown or incomplete APK audit argument.');
    ensure(options[names[argv[index]]] === undefined, 'Duplicate APK audit argument.'); options[names[argv[index]]] = argv[index + 1];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await verifyAndroidApk(argumentsFrom(process.argv.slice(2)));
    console.log(JSON.stringify({ passed: true, app: report.app, webAssets: report.frozenWebAssetsCompared, nativeClasses: report.nativeClassesVerified.length,
      sameSignerSetAsPrevious: report.signing.sameSignerSet ?? null, zipalignVerified: true, evidenceDirectory: report.evidenceDirectory, deviceAcceptance: false }, null, 2));
  } catch (error) { console.error('Android APK verification failed:', error instanceof AuditError ? error.message : 'Diagnostic content withheld to avoid exposing private configuration.'); process.exitCode = 1; }
}
