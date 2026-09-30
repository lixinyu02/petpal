import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectComputerUseElf } from '../scripts/computer-use-native-verify.mjs';

const native = await readFile(new URL('../node_modules/@zavora-ai/computer-use-mcp/computer-use-napi.linux-x64.node', import.meta.url));

test('Shipped x64 native is receipt-matched and supports the Ubuntu 22.04 glibc baseline', async () => {
  const base = new URL('../server/native/computer-use/linux-x64/', import.meta.url);
  const receipt = JSON.parse(await readFile(new URL('PROVENANCE.json', base), 'utf8'));
  const bytes = await readFile(new URL('computer-use-napi.linux-x64.node', base));
  const result = inspectComputerUseElf(bytes, { arch: 'x64', maximumGlibc: '2.35', sha256: receipt.sha256 });
  assert.equal(result.bytes, receipt.bytes);
  assert.equal(result.requiredGlibc, receipt.requiredGlibc);
  assert.equal(receipt.version, '7.4.0');
  assert.equal(receipt.sourceCommit, 'cfbb6af0e704da17c43df6c668225a2f84aca762');
  assert.equal(receipt.source.modifiedTrackedSource, true);
  const patch = await readFile(new URL('../server/native/computer-use/patches/linux-x11-window-geometry.patch', import.meta.url));
  assert.equal(receipt.source.patch.file, 'linux-x11-window-geometry.patch');
  assert.equal(receipt.source.patch.baseCommit, receipt.sourceCommit);
  assert.equal(createHash('sha256').update(patch).digest('hex'), receipt.source.patch.sha256);
  assert.equal(receipt.source.cargoLocked, true);
  assert.equal(receipt.minimumGlibc, '2.35');
  assert.equal(receipt.acceptance.ubuntu22NativeLoad, true);
  assert.deepEqual(result.needed, receipt.needed);
});

test('Zavora published Linux native is accurately identified as requiring glibc 2.39', () => {
  const result = inspectComputerUseElf(native, { arch: 'x64', maximumGlibc: '2.39', sha256: '3ae5c991d2f06edaaf0902fb734a11ecf8b3afe9eed79e6f7d22b9b836e460da' });
  assert.equal(result.requiredGlibc, '2.39'); assert.equal(result.machine, 62); assert.ok(result.needed.includes('libX11.so.6')); assert.ok(result.needed.includes('libXtst.so.6'));
  assert.throws(() => inspectComputerUseElf(native, { arch: 'x64', maximumGlibc: '2.35' }), /newer than 2.35/);
});

test('Shipped ARM64 native matches its receipt and makes no physical desktop acceptance claim', async () => {
  const base = new URL('../server/native/computer-use/linux-arm64/', import.meta.url);
  const receipt = JSON.parse(await readFile(new URL('PROVENANCE.json', base), 'utf8'));
  const bytes = await readFile(new URL('computer-use-napi.linux-arm64.node', base));
  const result = inspectComputerUseElf(bytes, { arch: 'arm64', maximumGlibc: '2.35', sha256: receipt.sha256 });
  assert.equal(result.machine, 183);
  assert.equal(result.bytes, receipt.bytes);
  assert.equal(result.requiredGlibc, receipt.requiredGlibc);
  assert.deepEqual(result.needed, receipt.needed);
  assert.equal(receipt.source.patch.sha256, 'ad05d1b466c94d2ca90f009630ece9d8dcc0d52aa2b571a09a974d4b6f51ad71');
  assert.equal(receipt.acceptance.physicalArm64, false);
  assert.equal(receipt.acceptance.physicalDesktop, false);
  assert.equal(receipt.acceptance.containerGui, 'not-tested');
});

test('Computer Use ELF validation rejects wrong architecture, tampered bytes and malformed section tables', () => {
  assert.throws(() => inspectComputerUseElf(native, { arch: 'arm64', maximumGlibc: '2.39' }), /invalid/);
  assert.throws(() => inspectComputerUseElf(native, { arch: 'x64', maximumGlibc: 'latest' }), /invalid/);
  const changed = Buffer.from(native); changed[100] ^= 1;
  assert.throws(() => inspectComputerUseElf(changed, { arch: 'x64', maximumGlibc: '2.39', sha256: '3ae5c991d2f06edaaf0902fb734a11ecf8b3afe9eed79e6f7d22b9b836e460da' }), /invalid/);
  for (const mutate of [value => { value[0] = 0; }, value => { value[5] = 2; }, value => value.writeBigUInt64LE(0xffffffffffffffffn, 40), value => value.writeUInt16LE(1, 58), value => value.writeUInt16LE(0xffff, 62)]) {
    const bytes = Buffer.from(native); mutate(bytes); assert.throws(() => inspectComputerUseElf(bytes, { arch: 'x64', maximumGlibc: '2.39' }), /invalid/);
  }
  assert.throws(() => inspectComputerUseElf(native.subarray(0, 64), { arch: 'x64', maximumGlibc: '2.39' }), /invalid/);
});
