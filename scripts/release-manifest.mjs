import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'releases');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = metadata.version;
const desktopOnly = process.argv.includes('--desktop-only');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A stable numeric project version is required.');
const inputs = [
  ['source', `PetPal-${version}-source.zip`, 'Source archive; rebuild using the lockfile'],
  ['windows-x64', `desktop/PetPal-${version}-Windows-x64.exe`, 'Portable application; packaged CLI and native window smoke passed'],
  ...(!desktopOnly ? [['android', `android/PetPal-${version}-Android-debug.apk`, 'Development-signed APK; device runtime not verified']] : []),
  ['ubuntu-x64', `ubuntu/PetPal-${version}-Ubuntu-x64.tar.gz`, 'Portable archive; ELF/integrity audit passed; target runtime not verified'],
  ['ubuntu-arm64', `ubuntu/PetPal-${version}-Ubuntu-arm64.tar.gz`, 'Portable archive; ELF/integrity audit passed; target runtime not verified'],
];
const artifacts = [];
for (const [platform, file, acceptance] of inputs) {
  const absolute = path.join(releaseDir, file);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(absolute)) hash.update(chunk);
  artifacts.push({ platform, file, bytes: (await stat(absolute)).size, sha256: hash.digest('hex'), acceptance });
}
for (const [file, evidencePath] of [
  [`PetPal-${version}-source.zip`, 'evidence/source-package.json'],
  [`desktop/PetPal-${version}-Windows-x64.exe`, 'evidence/native/windows-final.json'],
  ...(!desktopOnly ? [[`android/PetPal-${version}-Android-debug.apk`, 'evidence/native/android-final.json']] : []),
  [`ubuntu/PetPal-${version}-Ubuntu-x64.tar.gz`, 'evidence/linux-package-x64-independent.json'],
  [`ubuntu/PetPal-${version}-Ubuntu-arm64.tar.gz`, 'evidence/linux-package-arm64-independent.json'],
]) {
  const evidence = JSON.parse(await readFile(path.join(root, evidencePath), 'utf8'));
  const artifact = artifacts.find(item => item.file === file);
  if (evidence.version !== undefined && evidence.version !== version) {
    throw new Error(`Final acceptance evidence has a different version: ${evidencePath}`);
  }
  const evidenceFile = evidence.archive ?? evidence.executable ?? evidence.apk;
  if (typeof evidenceFile !== 'string' || path.posix.basename(evidenceFile.replaceAll('\\', '/')) !== path.posix.basename(file)) {
    throw new Error(`Final acceptance evidence names a different artifact: ${evidencePath}`);
  }
  if (artifact.sha256 !== String(evidence.sha256).toLowerCase() || (evidence.bytes !== undefined && artifact.bytes !== evidence.bytes)) {
    throw new Error(`Release bytes do not match final acceptance evidence: ${file}`);
  }
  if (artifact.platform === 'source' && (evidence.boundaryScan !== 'pass' || evidence.zipReadback !== 'pass')) throw new Error('Source boundary/readback acceptance did not pass');
  if (artifact.platform.startsWith('ubuntu-') && (evidence.ok !== true || !Array.isArray(evidence.failures) || evidence.failures.length)) throw new Error(`Linux final acceptance did not pass: ${file}`);
  if (artifact.platform.startsWith('ubuntu-')) {
    const arch = artifact.platform.slice('ubuntu-'.length), series = version.split('.').slice(0, 2).join('.');
    const complete = JSON.parse(await readFile(path.join(root, `evidence/linux-package-${arch}-allfiles-${series}.json`), 'utf8'));
    if (complete.version !== version || complete.ok !== true || !Array.isArray(complete.failures) || complete.failures.length || complete.archiveSha256 !== artifact.sha256 || complete.archiveBytes !== artifact.bytes || complete.byteIdenticalFiles !== complete.archiveFiles || complete.stagedFiles !== complete.archiveFiles || !complete.archiveFiles) throw new Error(`Linux all-file readback did not pass: ${file}`);
  }
  if (artifact.platform === 'windows-x64') {
    const smoke = evidence.portableSmoke;
    if (smoke?.uiReady !== true || smoke.health?.ok !== true || smoke.health?.version !== version || smoke.codex?.available !== true || evidence.ownedProcessesRemaining !== 0 || smoke.electronVersion !== metadata.devDependencies.electron || smoke.desktopTools?.opencli?.available !== true || smoke.desktopTools.opencli.version !== metadata.dependencies['@jackwener/opencli']) throw new Error('Windows final smoke did not pass');
    const series = version.split('.').slice(0, 2).join('.');
    const bytesReceipt = JSON.parse(await readFile(path.join(root, `evidence/native/windows-${series}-asar-verification.json`), 'utf8'));
    if (bytesReceipt.version !== version || bytesReceipt.sha256?.toLowerCase() !== artifact.sha256 || bytesReceipt.bytes !== artifact.bytes || bytesReceipt.nativeHelperCompared !== true || bytesReceipt.opencliVersion?.trim() !== metadata.dependencies['@jackwener/opencli'] || !(bytesReceipt.filesCompared > 0) || !(bytesReceipt.opencliDependencyPackages?.length > 0)) throw new Error('Windows final executable readback did not pass');
  }
}
const retainedArtifacts = [];
if (desktopOnly) {
  const previous = JSON.parse(await readFile(path.join(root, 'evidence/native/android-final.json'), 'utf8'));
  if (previous.version !== '0.4.0') throw new Error('Retained Android evidence must identify 0.4.0');
  const file = 'android/PetPal-0.4.0-Android-debug.apk';
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path.join(releaseDir, file))) digest.update(chunk);
  const sha256 = digest.digest('hex'), bytes = (await stat(path.join(releaseDir, file))).size;
  if (sha256 !== previous.sha256.toLowerCase() || bytes !== previous.bytes) throw new Error('Retained Android bytes no longer match 0.4 acceptance');
  retainedArtifacts.push({ platform: 'android', version: '0.4.0', file, bytes, sha256, acceptance: 'Retained previous APK; no 0.5 Android rebuild or device acceptance' });
}
await writeFile(path.join(releaseDir, 'release-manifest.json'), JSON.stringify({
  name: 'PetPal', version, createdAt: new Date().toISOString(),
  scope: desktopOnly ? 'desktop-and-source' : 'all-platforms',
  codexCliVersion: metadata.dependencies['@openai/codex'], opencliVersion: metadata.dependencies['@jackwener/opencli'],
  electronVersion: metadata.devDependencies.electron, artifacts, retainedArtifacts,
}, null, 2) + '\n');
await writeFile(path.join(releaseDir, 'SHA256SUMS.txt'), artifacts.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
console.log(JSON.stringify({ artifacts, manifest: 'releases/release-manifest.json', checksums: 'releases/SHA256SUMS.txt' }, null, 2));
