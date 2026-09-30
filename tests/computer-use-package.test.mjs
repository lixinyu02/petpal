import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,cp,rm,readdir,writeFile,readFile} from 'node:fs/promises';
import {filterComputerUseNative,auditComputerUsePackage,COMPUTER_USE_PACKAGE} from '../scripts/computer-use-package.mjs';
import {inspectComputerUseElf} from '../scripts/computer-use-native-verify.mjs';
const root=path.resolve('.');
async function fixture(t){const directory=await mkdtemp(path.join(tmpdir(),'petpal-computer-package-'));t.after(()=>rm(directory,{recursive:true,force:true}));await cp(path.join(root,COMPUTER_USE_PACKAGE),path.join(directory,COMPUTER_USE_PACKAGE),{recursive:true});return directory;}
test('Linux Computer Use staging removes other platforms and architectures without weakening native audit',async t=>{
  const directory=await fixture(t);await filterComputerUseNative(directory,{platform:'linux',arch:'x64'});
  assert.deepEqual((await readdir(path.join(directory,COMPUTER_USE_PACKAGE))).filter(name=>name.endsWith('.node')),['computer-use-napi.linux-x64.node']);
  const audit=await auditComputerUsePackage(directory,{platform:'linux',arch:'x64'});assert.equal(audit.native.machine,62);assert.equal(audit.native.requiredGlibc,'2.39');assert.equal(audit.version,'7.4.0');
  assert.throws(()=>inspectComputerUseElf(Buffer.from([]),{arch:'x64'}));
  await writeFile(path.join(directory,COMPUTER_USE_PACKAGE,'computer-use-napi.node'),'arbitrary');await assert.rejects(filterComputerUseNative(directory,{platform:'linux',arch:'x64'}),/Unexpected/);
});
test('Windows native and license audit rejects changed PE target, runtime bytes or package identity',async t=>{
  const directory=await fixture(t),audit=await auditComputerUsePackage(directory,{platform:'win32',arch:'x64'});assert.equal(audit.native.machine,0x8664);
  await writeFile(path.join(directory,COMPUTER_USE_PACKAGE,'LICENSE'),'changed');await assert.rejects(auditComputerUsePackage(directory,{platform:'win32',arch:'x64',expected:audit}),/changed/);
  const metadataPath=path.join(directory,COMPUTER_USE_PACKAGE,'package.json'),metadata=JSON.parse(await readFile(metadataPath,'utf8'));metadata.version='99.0.0';await writeFile(metadataPath,JSON.stringify(metadata));await assert.rejects(auditComputerUsePackage(directory,{platform:'win32',arch:'x64'}),/identity/);
});
