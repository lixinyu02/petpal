import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { APP_PROXY_PRODUCTION_DEPENDENCIES, readMihomoClientPolicy, verifyMihomoClientRecords, auditMihomoClientPayload,
  parseLinuxPackageArguments, assertLinuxPackageTargetsAvailable, publishLinuxPackageArchive } from '../scripts/client-payload.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const policy = await readMihomoClientPolicy(root);
const proxyFiles = ['desktop/app-proxy.mjs', 'desktop/app-proxy-network.mjs', 'desktop/app-proxy-download.mjs', 'desktop/app-proxy-ipc.cjs', 'desktop/app-proxy-smoke.cjs',
  'desktop/native/mihomo/manifest.json', 'desktop/native/mihomo/LICENSE', 'desktop/native/mihomo/PROVENANCE.json', 'desktop/native/mihomo/SOURCE-NOTICE.txt',
  'server/app-proxy-network.mjs', 'server/app-proxy-context.mjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
test('Linux output option preserves defaults, accepts a private destination and rejects ambiguous/unsafe inputs', () => {
  assert.deepEqual(parseLinuxPackageArguments([], root), { architectures: ['x64', 'arm64'], outputRoot: path.join(root, 'releases', 'ubuntu'), customOutput: false });
  for (const flag of ['--out-dir', '--output-root']) {
    assert.deepEqual(parseLinuxPackageArguments(['arm64', flag, 'releases/review/ubuntu', '--dir-only'], root),
      { architectures: ['arm64'], outputRoot: path.join(root, 'releases', 'review', 'ubuntu'), customOutput: true });
  }
  for (const args of [['--out-dir'], ['--out-dir', '--dir-only'], ['x64', 'x64'], ['riscv64'], ['--unknown'],
    ['--out-dir', 'one', '--output-root', 'two'], ['--out-dir', '.'], ['--out-dir', '..'], ['--out-dir', path.parse(root).root]]) assert.throws(() => parseLinuxPackageArguments(args, root));
});

test('existing package, checksum and partial outputs are refused; publication cannot overwrite prior bytes', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-linux-output-'));
  t.after(async () => { assert.equal(path.dirname(directory), os.tmpdir()); assert.match(path.basename(directory), /^petpal-linux-output-/); await rm(directory, { recursive: true, force: true }); });
  const archive = path.join(directory, 'PetPal-0.0.0-Ubuntu-x64.tar.gz');
  await assertLinuxPackageTargetsAvailable(directory, '0.0.0', ['x64', 'arm64']);
  for (const suffix of ['', '.partial', '.sha256']) {
    await writeFile(archive + suffix, 'retained');
    await assert.rejects(assertLinuxPackageTargetsAvailable(directory, '0.0.0', ['x64']), /Refusing to overwrite/);
    assert.equal(await readFile(archive + suffix, 'utf8'), 'retained'); await rm(archive + suffix);
  }
  await writeFile(archive + '.partial', 'new'); await writeFile(archive, 'old');
  await assert.rejects(publishLinuxPackageArchive(archive + '.partial', archive), error => error.code === 'EEXIST');
  assert.equal(await readFile(archive, 'utf8'), 'old'); assert.equal(await readFile(archive + '.partial', 'utf8'), 'new');
  await rm(archive); await publishLinuxPackageArchive(archive + '.partial', archive);
  assert.equal(await readFile(archive, 'utf8'), 'new'); await assert.rejects(readFile(archive + '.partial'), error => error.code === 'ENOENT');
});
function records(arch) {
  const { manifest, metadata } = policy, target = manifest.targets[`linux-${arch}`];
  // Header/hash records stand in for tar's streaming reader, without downloading
  // or allocating the real 60 MB executable in a unit test.
  const header = Buffer.alloc(64); header.write('ELF', 1); header[0] = 0x7f; header[4] = 2; header[5] = 1; header[6] = 1;
  header.writeUInt16LE(2, 16); header.writeUInt16LE(target.executable.machine, 18); header.writeBigUInt64LE(64n, 32);
  header.writeUInt16LE(64, 52); header.writeUInt16LE(56, 54); header.writeUInt16LE(1, 56);
  const result = new Map([...metadata].map(([name, value]) => [name, { ...value }]));
  result.set(target.executable.name, { bytes: target.executable.bytes, sha256: target.executable.sha256, header, mode: 0o755 });
  for (const source of manifest.sources) result.set(`source/${source.name}`, { bytes: source.bytes, sha256: source.sha256 });
  const data = Buffer.from(JSON.stringify({
    schemaVersion: 1, version: manifest.version, platform: 'linux', arch, executable: target.executable.name,
    sha256: target.executable.sha256, bytes: target.executable.bytes, sourceCommit: manifest.sourceCommit,
    archive: { name: target.archive.name, url: target.archive.url, sha256: target.archive.sha256, bytes: target.archive.bytes },
    native: { format: 'ELF', machine: target.executable.machine },
    sources: manifest.sources.map(source => ({ name: `source/${source.name}`, bytes: source.bytes, sha256: source.sha256, url: source.url })),
    license: { name: 'LICENSE', bytes: manifest.license.bytes, sha256: manifest.license.sha256 },
  }));
  result.set('audit.json', { data, bytes: data.length, sha256: sha(data) });
  return result;
}
const cloned = input => new Map([...input].map(([name, value]) => [name, { ...value, ...(value.header ? { header: Buffer.from(value.header) } : {}) }]));
for (const arch of ['x64', 'arm64']) {
  test(`Linux ${arch} core inventory includes exactly pinned ELF, GPL attribution, full source and vendor`, () => {
    const verified = verifyMihomoClientRecords(records(arch), policy, { arch });
    assert.equal(verified.arch, arch); assert.equal(verified.version, '1.19.32');
    assert.equal(verified.native.machine, arch === 'x64' ? 62 : 183); assert.equal(verified.files.length, 8);
    assert.ok(verified.files.some(file => file.path.endsWith('/source/vendor.tar.gz')));
    assert.ok(verified.files.some(file => file.path.endsWith(`/source/mihomo-${policy.manifest.sourceCommit}.tar.gz`)));
    assert.ok(verified.files.some(file => file.path === 'resources/mihomo/LICENSE'));
  });
  test(`Linux ${arch} rejects omitted or changed raw/source/license members even when receipts omit them`, () => {
    const complete = records(arch);
    for (const name of complete.keys()) {
      const missing = cloned(complete); missing.delete(name);
      assert.throws(() => verifyMihomoClientRecords(missing, policy, { arch }), /inventory mismatch/);
      if (name !== 'audit.json') {
        const modified = cloned(complete); modified.get(name).sha256 = '0'.repeat(64);
        assert.throws(() => verifyMihomoClientRecords(modified, policy, { arch }), /integrity mismatch/);
      }
    }
    const extra = cloned(complete); extra.set('config.yaml', { bytes: 1, sha256: sha('x') });
    assert.throws(() => verifyMihomoClientRecords(extra, policy, { arch }), /inventory mismatch/);
  });
  test(`Linux ${arch} rejects wrong ELF, removed executable bits and forged audit`, () => {
    for (const [offset, value] of [[0, 0], [4, 1], [5, 2], [18, arch === 'x64' ? 183 : 62], [54, 0], [56, 0]]) {
      const changed = records(arch); changed.get('mihomo').header[offset] = value;
      assert.throws(() => verifyMihomoClientRecords(changed, policy, { arch }), /ELF64 target/);
    }
    const noExec = records(arch); noExec.get('mihomo').mode = 0o644;
    assert.throws(() => verifyMihomoClientRecords(noExec, policy, { arch }), /executable mode/);
    const forged = records(arch), audit = JSON.parse(forged.get('audit.json').data);
    audit.sources = []; forged.get('audit.json').data = Buffer.from(JSON.stringify(audit));
    assert.throws(() => verifyMihomoClientRecords(forged, policy, { arch }), /audit differs/);
    assert.throws(() => verifyMihomoClientRecords(records(arch), policy, { arch: arch === 'x64' ? 'arm64' : 'x64' }), /integrity mismatch/);
  });
}

test('filesystem payload auditing rejects unexpected directories and never trusts a copied file name', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-linux-proxy-'));
  t.after(async () => { assert.equal(path.dirname(directory), os.tmpdir()); assert.match(path.basename(directory), /^petpal-linux-proxy-/); await rm(directory, { recursive: true, force: true }); });
  await mkdir(path.join(directory, 'unexpected'));
  await assert.rejects(auditMihomoClientPayload(directory, policy, { arch: 'x64' }), /Unexpected Mihomo payload directory/);
  await rmdir(path.join(directory, 'unexpected')); await writeFile(path.join(directory, 'mihomo'), 'fake');
  await assert.rejects(auditMihomoClientPayload(directory, policy, { arch: 'x64' }), /member inventory mismatch/);
});

async function parsed(relative) { return ts.createSourceFile(relative, await readFile(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); }
function sourcePolicy(tree, name) {
  return vm.runInNewContext(tree.statements.filter(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => item.name.getText(tree) === name)
    || ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(tree) === `${name}.push`)
    .map(statement => statement.getText(tree)).join('\n') + `\n${name}`);
}
test('Linux build, final verifier and source ZIP independently require every new proxy runtime/attribution file', async () => {
  for (const [file, name] of [['scripts/linux-package.mjs', 'requiredApplicationSource'], ['scripts/linux-verify.mjs', 'requiredApplicationSource'], ['scripts/package-source.mjs', 'requiredFiles']]) {
    const required = sourcePolicy(await parsed(file), name);
    for (const proxyFile of proxyFiles) assert.ok(required.includes(proxyFile), `${file} omits ${proxyFile}`);
  }
  const required = sourcePolicy(await parsed('scripts/package-source.mjs'), 'requiredFiles');
  for (const file of ['scripts/mihomo-package.mjs', 'src/AppProxySettings.tsx', 'docs/app-proxy.md']) assert.ok(required.includes(file), file);
});

test('Linux source builder prepares the target kernel, copies final resources, records audit, and keeps executable mode', async () => {
  const source = await readFile(path.join(root, 'scripts/linux-package.mjs'), 'utf8');
  assert.match(source, /await prepareMihomo\(root, \{ platform: 'linux', arch \}\)/);
  assert.match(source, /await cp\(input\.mihomo\.payloadDirectory, mihomoDirectory, \{ recursive: true \}\)/);
  assert.match(source, /await auditMihomoClientPayload\(mihomoDirectory, mihomoPolicy, \{ arch \}\)/);
  assert.match(source, /mihomo: mihomoAudit, appProxyDependencies: APP_PROXY_PRODUCTION_DEPENDENCIES/);
  assert.match(source, /rg\|mihomo\)\$/);
  assert.match(source, /requiredApplicationSource\.filter\(file => file\.startsWith\('desktop\/'\)\)/);
});

test('proxy dependencies are explicitly pinned production roots and archive verifier checks each closure/license', async () => {
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json')));
  for (const [name, version] of Object.entries(APP_PROXY_PRODUCTION_DEPENDENCIES)) assert.equal(metadata.dependencies[name], version);
  const source = await readFile(path.join(root, 'scripts/linux-verify.mjs'), 'utf8');
  assert.match(source, /verifyDependency\(file, proxyClosure, proxyEdges, proxyOptionalAbsent\)/);
  assert.match(source, /App proxy production dependency license missing/);
  assert.match(source, /verifyMihomoClientRecords\(mihomoRecords, mihomoPolicy, \{ arch: manifest\.arch \}\)/);
  assert.match(source, /isDeepStrictEqual\(manifest\.mihomo, mihomoVerification\)/);
});
