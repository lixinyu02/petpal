import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import vm from 'node:vm';
import * as tar from 'tar';
import ts from 'typescript';

const root=fileURLToPath(new URL('../',import.meta.url));
const run=promisify(execFile);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const vendorFiles=[
  'server/native/music-mcp/netease/server.py',
  'server/native/music-mcp/netease/LICENSE',
  'server/native/music-mcp/netease/pyproject.toml',
  'server/native/music-mcp/netease/PROVENANCE.json',
  'server/native/music-mcp/qqmusic/login.py',
  'server/native/music-mcp/qqmusic/LICENSE',
  'server/native/music-mcp/qqmusic/pyproject.toml',
  'server/native/music-mcp/qqmusic/PROVENANCE.json',
  'server/native/music-mcp/qqmusic/src/mcp_qqmusic/__init__.py',
  'server/native/music-mcp/qqmusic/src/mcp_qqmusic/__main__.py',
  'server/native/music-mcp/qqmusic/src/mcp_qqmusic/server.py',
  'server/native/music-mcp/qqmusic/src/mcp_qqmusic/format.py',
];

async function requiredSource(script){
  const source=await readFile(path.join(root,'scripts',script),'utf8');
  const parsed=ts.createSourceFile(script,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const statements=parsed.statements.filter(statement=>
    ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(item=>item.name.getText(parsed)==='requiredApplicationSource')
    ||ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(parsed)==='requiredApplicationSource.push');
  return [...vm.runInNewContext(`${statements.map(statement=>statement.getText(parsed)).join('\n')}\nrequiredApplicationSource;`)];
}

test('Linux package and independent verifier require the complete pinned music MCP sources',async()=>{
  const packagePolicy=await requiredSource('linux-package.mjs'),verifyPolicy=await requiredSource('linux-verify.mjs');
  for(const file of [...vendorFiles,'server/music-mcp.mjs','server/music-mcp-routes.mjs','desktop/startup-diagnostics.cjs']){
    assert.ok(packagePolicy.includes(file),`Builder does not require ${file}`);
    assert.ok(verifyPolicy.includes(file),`Verifier does not require ${file}`);
  }
  assert.deepEqual([...packagePolicy].sort(),[...verifyPolicy].sort());
});

test('Linux archive audit rejects every missing or modified music MCP vendor member',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'petpal-linux-mcp-'));
  t.after(async()=>{
    const absolute=path.resolve(directory),temporaryRoot=path.resolve(os.tmpdir())+path.sep;
    assert.ok(absolute.startsWith(temporaryRoot),'Cleanup must stay in the owned temporary directory');
    await rm(absolute,{recursive:true,force:true});
  });
  const payload=path.join(directory,'payload'),name='PetPal-fixture-Ubuntu-x64',archive=path.join(directory,`${name}.tar.gz`);
  const app=path.join(payload,'resources','app'),bytes=new Map();
  async function put(relative,value){
    const file=path.join(payload,...relative.split('/'));
    await mkdir(path.dirname(file),{recursive:true});await writeFile(file,value);
  }
  const sourceReceipt=[];
  for(const file of await requiredSource('linux-verify.mjs')){
    const content=await readFile(path.join(root,file));bytes.set(file,content);
    await put(`resources/app/${file}`,content);sourceReceipt.push({path:file,sha256:hash(content)});
  }
  for(const texture of ['idle','blink','talk','round','curious','warm','sad','pout']){
    const file=`dist/avatars/akari/${texture}.webp`,content=Buffer.from(`fixture ${texture}`);
    await put(`resources/app/${file}`,content);sourceReceipt.push({path:file,sha256:hash(content)});
  }
  // Synthetic ELF headers let the existing archive verifier run its native
  // checks without building, downloading, or executing a Linux runtime.
  const elf=Buffer.alloc(64);elf.set([0x7f,0x45,0x4c,0x46,2,1]);elf.writeUInt16LE(62,18);
  await put('petpal',elf);
  for(const native of ['codex','helper-one','helper-two','helper-three','helper-four'])await put(`resources/app/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/${native}`,elf);
  const prefix='node_modules/@jackwener/opencli';
  const pkg={name:'@jackwener/opencli',version:'1.8.8',license:'Apache-2.0',engines:{node:'>=22'}};
  const opencliFiles=[];
  for(const file of ['package.json','LICENSE','cli-manifest.json','dist/src/main.js','dist/src/daemon.js','dist/src/browser/base-page.js']){
    const content=Buffer.from(file==='package.json'?JSON.stringify(pkg):`fixture ${file}`);
    await put(`resources/app/${prefix}/${file}`,content);opencliFiles.push({path:`${prefix}/${file}`,sha256:hash(content)});
  }
  for(const launcher of ['start-petpal.sh','codex.sh','opencli.sh'])await put(launcher,launcher==='opencli.sh'?'#!/bin/sh\nELECTRON_RUN_AS_NODE=1 ./petpal resources/app/node_modules/@jackwener/opencli/dist/src/main.js\n':'#!/bin/sh\n./petpal\n');
  const manifest={app:'fixture',platform:'linux',arch:'x64',sourceReceipt,electron:{sha256:hash(elf)},codex:{sha256:hash(elf),helpers:[]},opencliVersion:pkg.version,
    opencli:{version:pkg.version,files:opencliFiles,packages:[{...pkg,path:`${prefix}/package.json`,sha256:opencliFiles[0].sha256,licenseFiles:[opencliFiles[1]]}],edges:[],optionalAbsent:[]}};
  await put('BUILD-MANIFEST.json',JSON.stringify(manifest));
  async function verify(){
    await tar.c({cwd:payload,prefix:name,file:archive,gzip:true,portable:true,onWriteEntry:entry=>{entry.stat.mode=entry.type==='Directory'||/(?:^|\/)petpal$/.test(entry.path)||entry.path.endsWith('.sh')||entry.path.includes('/@openai/codex-linux-x64/vendor/')?0o755:0o644;}},['.']);
    try{const result=await run(process.execPath,[path.join(root,'scripts','linux-verify.mjs'),archive],{cwd:root,maxBuffer:2*1024*1024});return {code:0,...JSON.parse(result.stdout)};}
    catch(error){assert.equal(error.code,1,error.stderr);return {code:error.code,...JSON.parse(error.stdout)};}
  }
  const baseline=await verify();assert.equal(baseline.ok,true,baseline.failures.join('\n'));
  for(const file of vendorFiles){
    await t.test(`missing ${file}`,async()=>{
      await rm(path.join(app,file));
      try{const result=await verify();assert.equal(result.ok,false);assert.ok(result.failures.includes(`Required application source missing: ${file}`));}
      finally{await put(`resources/app/${file}`,bytes.get(file));}
    });
    await t.test(`modified ${file}`,async()=>{
      await put(`resources/app/${file}`,Buffer.concat([bytes.get(file),Buffer.from('\nmodified fixture\n')]));
      try{const result=await verify();assert.equal(result.ok,false);assert.ok(result.failures.includes(`App payload hash mismatch: ${file}`));}
      finally{await put(`resources/app/${file}`,bytes.get(file));}
    });
  }
  await t.test('private credential files are outside the vendor distribution inventory',async()=>{
    const file='server/native/music-mcp/qqmusic/credential.json';await put(`resources/app/${file}`,'{"private":"fixture"}');
    const result=await verify();assert.equal(result.ok,false);assert.ok(result.failures.includes(`Unexpected packaged music MCP member: ${file}`));
  });
});
