import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,rmdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import vm from 'node:vm';
import * as tar from 'tar';
import ts from 'typescript';

const root=fileURLToPath(new URL('../',import.meta.url));
const run=promisify(execFile);
const require=createRequire(import.meta.url),asar=require('@electron/asar');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const centralFiles=['desktop/central-server.cjs','desktop/central-server-ipc.cjs','desktop/central-server-smoke.cjs'];
const ncmCliFiles=['server/ncmcli.mjs','server/agent-skills.mjs',
  'server/native/skills/petpal-ncmcli/SKILL.md','server/native/skills/petpal-ncmcli/LICENSE','server/native/skills/petpal-ncmcli/PROVENANCE.json'];
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
async function requiredOpencliRuntime(){
  const source=await readFile(path.join(root,'scripts/linux-verify.mjs'),'utf8');
  const parsed=ts.createSourceFile('linux-verify.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const declaration=parsed.statements.find(statement=>ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(item=>item.name.getText(parsed)==='requiredOpencliFiles'));
  return [...vm.runInNewContext(`${declaration.getText(parsed)}\nrequiredOpencliFiles;`)];
}

test('Linux package and independent verifier require the complete pinned music MCP sources',async()=>{
  const packagePolicy=await requiredSource('linux-package.mjs'),verifyPolicy=await requiredSource('linux-verify.mjs');
  for(const file of [...vendorFiles,...centralFiles,...ncmCliFiles,'server/music-mcp.mjs','server/music-mcp-routes.mjs','desktop/startup-diagnostics.cjs']){
    assert.ok(packagePolicy.includes(file),`Builder does not require ${file}`);
    assert.ok(verifyPolicy.includes(file),`Verifier does not require ${file}`);
  }
  assert.deepEqual([...packagePolicy].sort(),[...verifyPolicy].sort());
});

async function packagingPolicy(script){
  const source=await readFile(path.join(root,'scripts',script),'utf8'),parsed=ts.createSourceFile(script,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const variables=new Set(['ncmSkillDirectory','ncmSkillMembers']),functions=new Set(['assertNoOptionalNcmCliDependency','auditNcmcliPackaging','auditNcmCliSkillDirectory']);
  const statements=parsed.statements.filter(statement=>ts.isFunctionDeclaration(statement)&&functions.has(statement.name?.getText(parsed))
    ||ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(item=>variables.has(item.name.getText(parsed))));
  const digest=async file=>hash(await readFile(file));
  const context={assert,path,readdir,readFile,digest,hash:digest};
  return vm.runInNewContext(`${statements.map(statement=>statement.getText(parsed)).join('\n')}\n({dependency:assertNoOptionalNcmCliDependency,assets:typeof auditNcmcliPackaging==='function'?auditNcmcliPackaging:auditNcmCliSkillDirectory});`,context);
}

test('Linux staging and Windows readback reject optional CLI dependencies and unknown skill members',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'petpal-skill-policy-'));
  t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(directory,{recursive:true,force:true});});
  const skillDirectory=path.join(directory,'server/native/skills/petpal-ncmcli');
  await mkdir(skillDirectory,{recursive:true});
  for(const name of ['SKILL.md','LICENSE','PROVENANCE.json'])await writeFile(path.join(skillDirectory,name),await readFile(path.join(root,'server/native/skills/petpal-ncmcli',name)));
  for(const script of ['linux-package.mjs','windows-native-verify.mjs']){
    const policy=await packagingPolicy(script);
    await policy.assets(directory,[]);
    for(const metadata of [
      {name:'@music163/ncm-cli'},
      {dependencies:{'@music163/ncm-cli':'0.1.7'}},
      {optionalDependencies:{'@music163/ncm-cli':'0.1.7'}},
      {peerDependencies:{music:'npm:@music163/ncm-cli@0.1.7'}},
    ])assert.throws(()=>policy.dependency(metadata,'fixture'),/Optional ncm-cli/);
    policy.dependency({dependencies:{'@jackwener/opencli':'1.8.8'},devDependencies:{'@music163/ncm-cli':'0.1.7'}},'fixture');
    for(const member of ['credential.json','privateKey.txt','notes']){
      const file=path.join(skillDirectory,member);await writeFile(file,'fixture');
      try{await assert.rejects(()=>policy.assets(directory,[]),/skill/);}finally{await rm(file);}
    }
    const extraDirectory=path.join(directory,'server/native/skills/unknown');await mkdir(extraDirectory);
    try{await assert.rejects(()=>policy.assets(directory,[]),/skill/);}finally{await rmdir(extraDirectory);}
    const content=await readFile(path.join(skillDirectory,'SKILL.md'));
    await writeFile(path.join(skillDirectory,'SKILL.md'),Buffer.concat([content,Buffer.from('\nmodified fixture\n')]));
    try{await assert.rejects(()=>policy.assets(directory,[]),/provenance hash mismatch/);}finally{await writeFile(path.join(skillDirectory,'SKILL.md'),content);}
  }
});

test('real ASAR roundtrip unpacks skills and Electron materializes them from its default ASAR source',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'petpal-ncm-asar-'));
  t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  const source=path.join(directory,'source'),archive=path.join(directory,'app.asar'),skill='server/native/skills/petpal-ncmcli';
  await mkdir(path.join(source,skill),{recursive:true});
  await writeFile(path.join(source,'package.json'),'{"type":"module"}');
  await writeFile(path.join(source,'server/agent-skills.mjs'),await readFile(path.join(root,'server/agent-skills.mjs')));
  for(const name of ['SKILL.md','LICENSE','PROVENANCE.json'])await writeFile(path.join(source,skill,name),await readFile(path.join(root,skill,name)));
  await asar.createPackageWithOptions(source,archive,{unpackDir:path.join('server','native')});
  for(const name of ['server/native/skills',skill])assert.ok(asar.statFile(archive,path.normalize(name)).files,'ASAR directory entries must be recognized by files');
  const ncmAssetPaths=['SKILL.md','LICENSE','PROVENANCE.json'].map(name=>`${skill}/${name}`);
  for(const file of ncmAssetPaths){assert.equal(asar.statFile(archive,path.normalize(file)).unpacked,true);assert.deepEqual(asar.extractFile(archive,path.normalize(file)),await readFile(path.join(`${archive}.unpacked`,file)));}
  const runner=path.join(directory,'materialize.mjs'),home=path.join(directory,'private-codex-home');
  await writeFile(runner,'const {materializeAgentSkills}=await import(process.argv[2]); const receipt=await materializeAgentSkills(process.argv[3]); process.stdout.write(JSON.stringify({receipt,electron:process.versions.electron}));');
  const environment={...process.env,ELECTRON_RUN_AS_NODE:'1',HOME:directory,USERPROFILE:directory,APPDATA:directory,LOCALAPPDATA:directory,XDG_CONFIG_HOME:directory,XDG_CACHE_HOME:directory};
  const result=await run(require('electron'),[runner,pathToFileURL(path.join(archive,'server/agent-skills.mjs')).href,home],{cwd:directory,env:environment,windowsHide:true,timeout:15000,maxBuffer:1024*1024});
  const receipt=JSON.parse(result.stdout);assert.ok(receipt.electron,'Actual Electron ASAR module loading is required');assert.equal(receipt.receipt.directory,path.join(home,'skills','petpal-ncmcli'));
  for(const file of ncmAssetPaths)assert.deepEqual(await readFile(path.join(receipt.receipt.directory,path.posix.basename(file))),await readFile(path.join(root,file)));
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
  const appPackage={name:'petpal',version:'fixture',dependencies:{'@jackwener/opencli':'1.8.8'}};
  await put('resources/app/package.json',JSON.stringify(appPackage));
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
  for(const member of await requiredOpencliRuntime()){
    const file=member.slice(prefix.length+1);
    const content=Buffer.from(file==='package.json'?JSON.stringify(pkg):`fixture ${file}`);
    await put(`resources/app/${prefix}/${file}`,content);opencliFiles.push({path:`${prefix}/${file}`,sha256:hash(content)});
  }
  for(const launcher of ['start-petpal.sh','codex.sh','opencli.sh'])await put(launcher,launcher==='opencli.sh'?'#!/bin/sh\nELECTRON_RUN_AS_NODE=1 ./petpal resources/app/node_modules/@jackwener/opencli/dist/src/main.js\n':'#!/bin/sh\n./petpal\n');
  const manifest={app:'fixture',platform:'linux',arch:'x64',sourceReceipt,electron:{sha256:hash(elf)},codex:{sha256:hash(elf),helpers:[]},opencliVersion:pkg.version,
    opencli:{version:pkg.version,files:opencliFiles,packages:[{...pkg,path:`${prefix}/package.json`,sha256:opencliFiles[0].sha256,licenseFiles:[opencliFiles[1]]}],edges:[],optionalAbsent:[]}};
  const computerPrefix='node_modules/@zavora-ai/computer-use-mcp',computerFiles=[];
  for(const file of ['package.json','LICENSE','dist/server.js','dist/native.js','dist/session/openai-compat.js','libexec/linux-atspi.py','computer-use-napi.linux-x64.node']){
    const content=file.endsWith('.node')?elf:Buffer.from(file==='package.json'?JSON.stringify({name:'@zavora-ai/computer-use-mcp',version:'7.4.0',license:'MIT'}):`fixture ${file}`);
    await put(`resources/app/${computerPrefix}/${file}`,content);computerFiles.push({path:`${computerPrefix}/${file}`,sha256:hash(content)});
  }
  manifest.computerUse={version:'7.4.0',arch:'x64',files:computerFiles,native:{sha256:hash(elf)}};
  await put('BUILD-MANIFEST.json',JSON.stringify(manifest));
  async function verify(){
    await tar.c({cwd:payload,prefix:name,file:archive,gzip:true,portable:true,onWriteEntry:entry=>{entry.stat.mode=entry.type==='Directory'||/(?:^|\/)petpal$/.test(entry.path)||entry.path.endsWith('.sh')||entry.path.includes('/@openai/codex-linux-x64/vendor/')?0o755:0o644;}},['.']);
    try{const result=await run(process.execPath,[path.join(root,'scripts','linux-verify.mjs'),archive],{cwd:root,maxBuffer:2*1024*1024});return {code:0,...JSON.parse(result.stdout)};}
    catch(error){assert.equal(error.code,1,error.stderr);return {code:error.code,...JSON.parse(error.stdout)};}
  }
  const baseline=await verify();assert.equal(baseline.ok,true,baseline.failures.join('\n'));
  for(const file of [...vendorFiles,...centralFiles,...ncmCliFiles,'server/native/computer-use/patches/linux-x11-window-geometry.patch','server/opencli-manager.mjs','server/opencli-sites.mjs','server/opencli-worker.mjs','server/opencli-routes.mjs']){
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
  for(const file of ['dist/src/registry.js','clis/arxiv/utils.js'])await t.test(`missing OpenCLI query dependency ${file}`,async()=>{
    await rm(path.join(app,prefix,file));
    try{const result=await verify();assert.equal(result.ok,false);assert.ok(result.failures.includes(`OpenCLI required runtime/license absent: ${prefix}/${file}`));}
    finally{await put(`resources/app/${prefix}/${file}`,Buffer.from(`fixture ${file}`));}
  });
  await t.test('private credential files are outside the vendor distribution inventory',async()=>{
    const file='server/native/music-mcp/qqmusic/credential.json';await put(`resources/app/${file}`,'{"private":"fixture"}');
    try{const result=await verify();assert.equal(result.ok,false);assert.ok(result.failures.includes(`Unexpected packaged music MCP member: ${file}`));}finally{await rm(path.join(app,file));}
  });
  for(const file of ['server/native/skills/petpal-ncmcli/credential.json','server/native/skills/petpal-ncmcli/privateKey.txt','server/native/skills/another/SKILL.md'])await t.test(`unknown skill member ${file}`,async()=>{
    await put(`resources/app/${file}`,'private fixture');
    try{const result=await verify();assert.equal(result.ok,false);assert.ok(result.failures.includes(`Unexpected packaged agent skill member: ${file}`));}finally{await rm(path.join(app,file));if(file.includes('/another/'))await rmdir(path.dirname(path.join(app,file)));}
  });
  await t.test('unknown empty skill directory',async()=>{
    const file='server/native/skills/petpal-ncmcli/private-config';await mkdir(path.join(app,file));
    try{const result=await verify();assert.equal(result.ok,false);assert.ok(result.failures.some(failure=>failure.startsWith(`Unexpected packaged agent skill member: ${file}`)));}finally{await rmdir(path.join(app,file));}
  });
  await t.test('official optional ncm-cli runtime entered archive',async()=>{
    const file='node_modules/@music163/ncm-cli/package.json';await put(`resources/app/${file}`,JSON.stringify({name:'@music163/ncm-cli',version:'0.1.7'}));
    try{const result=await verify();assert.equal(result.ok,false);assert.ok(result.failures.some(failure=>failure.includes('Optional ncm-cli runtime must not be distributed:')));}finally{await rm(path.join(app,file));await rmdir(path.dirname(path.join(app,file)));await rmdir(path.join(app,'node_modules/@music163'));}
  });
  await t.test('renamed official runtime package cannot bypass archive exclusion',async()=>{
    const file='node_modules/aliased-music/package.json';await put(`resources/app/${file}`,JSON.stringify({name:'@music163/ncm-cli',version:'0.1.7'}));
    try{const result=await verify();assert.equal(result.ok,false);assert.ok(result.failures.includes(`Optional ncm-cli runtime must not be distributed: ${file}`));}finally{await rm(path.join(app,file));await rmdir(path.dirname(path.join(app,file)));}
  });
  for(const section of ['dependencies','optionalDependencies','peerDependencies'])await t.test(`optional official CLI is forbidden in production ${section}`,async()=>{
    await put('resources/app/package.json',JSON.stringify({...appPackage,[section]:{...appPackage[section],music:'npm:@music163/ncm-cli@0.1.7'}}));
    try{const result=await verify();assert.equal(result.ok,false);assert.ok(result.failures.includes('Optional ncm-cli runtime must not be a production dependency: package.json'));}finally{await put('resources/app/package.json',JSON.stringify(appPackage));}
  });
  assert.equal((await verify()).ok,true,'All mutation fixtures must restore the accepted baseline');
});
