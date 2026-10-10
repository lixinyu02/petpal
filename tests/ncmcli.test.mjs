import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {NcmCliManager,NCMCLI_PACKAGE,NCMCLI_VERSION,validateNcmCliCall,ncmCliEnvironment,redactNcmCliOutput,resolveNcmCli,runNcmCliProcess} from '../server/ncmcli.mjs';

const exec=promisify(execFile);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const runArgs=['search','song','--keyword','xxx','--userInput','搜索xxx歌曲'];
async function fixture(t,options={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'petpal-ncmcli-'));
  const manager=new NcmCliManager({dataDir:directory,env:{PATH:''},...options});
  t.after(async()=>{await manager.close();assert.equal(path.dirname(directory),os.tmpdir());assert.match(path.basename(directory),/^petpal-ncmcli-/);await rm(directory,{recursive:true,force:true});});
  return{directory,manager};
}
async function runtime(directory,metadata={}){
  const root=path.join(directory,'node_modules','@music163','ncm-cli');await mkdir(path.join(root,'dist'),{recursive:true});
  const packageJsonPath=path.join(root,'package.json'),entry=path.join(root,'dist','index.js');
  await writeFile(packageJsonPath,JSON.stringify({name:NCMCLI_PACKAGE,version:NCMCLI_VERSION,bin:{'ncm-cli':'dist/index.js'},...metadata}));
  await writeFile(entry,"console.log(JSON.stringify({args:process.argv.slice(2),home:process.env.HOME}));\n");
  return{entry,packageJsonPath,version:NCMCLI_VERSION};
}
function childFixture({delayed=false}={}){
  const child=Object.assign(new EventEmitter(),{pid:2147483000,exitCode:null,stdout:new PassThrough(),stderr:new PassThrough(),signals:[]});
  child.finish=code=>{if(child.exitCode!==null)return;child.exitCode=code;child.emit('close',code);};
  child.kill=signal=>{child.signals.push(signal);child.emit('kill',signal);if(!delayed)child.finish(1);return true;};
  return child;
}
const waitSignal=(child,signal)=>child.signals.includes(signal)?Promise.resolve():new Promise(resolve=>{const listener=value=>{if(value===signal){child.removeListener('kill',listener);resolve();}};child.on('kill',listener);});

test('command boundary rejects credentials, uploads, native playback and unverified roots',()=>{
  assert.deepEqual(validateNcmCliCall({action:'status'}),{action:'status'});
  assert.deepEqual(validateNcmCliCall({action:'prepare'}),{action:'prepare'});
  assert.deepEqual(validateNcmCliCall({action:'run',args:runArgs}),{action:'run',args:runArgs});
  for(const args of [['--version'],['--help'],['commands'],['commands','--help'],['help','search'],['playlist','--help'],['login','--check'],['playlist','create','--name','xxx','--userInput','创建xxx歌单']])assert.doesNotThrow(()=>validateNcmCliCall({action:'run',args}));
  for(const command of ['play','pause','resume','stop','next','prev','seek','volume','queue','state','daemon','config','configure','logout','upgrade','diag','cloudupload','cloud','user','unknown'])assert.throws(()=>validateNcmCliCall({action:'run',args:[command]}),error=>error.code==='unsupported_command');
  for(const args of [['login'],['login','--background'],['commands','--url','https://example.test'],['--version','extra'],['help','diag'],['search','song','--keyword','xxx'],['search','song','--privateKey','synthetic','--userInput','搜索歌曲'],['playlist','create','--file','C:\\private','--userInput','创建歌单'],['playlist','cover_image_upload','--userInput','更新歌单']])assert.throws(()=>validateNcmCliCall({action:'run',args}));
  assert.doesNotThrow(()=>validateNcmCliCall({action:'run',args:['search','song','--keyword','file','--userInput','搜索file']}));
  assert.doesNotThrow(()=>validateNcmCliCall({action:'run',args:['search','song','--keyword=cover image','--userInput','搜索cover image']}));
  assert.doesNotThrow(()=>validateNcmCliCall({action:'run',args:['search','song','--keyword','cover','--userInput','搜索cover']}));
  for(const flag of ['--coverImg','--cover_image_upload','--imgUrl','--imageFile','--uploadFilePath','--audio_file'])assert.throws(()=>validateNcmCliCall({action:'run',args:['playlist','create',flag,'synthetic-path','--userInput','创建歌单']}),error=>error.code==='file_arguments');
  for(const command of [['playlist','updateCover'],['playlist','manage','uploadFile']])assert.throws(()=>validateNcmCliCall({action:'run',args:[...command,'--userInput','更新歌单']}),error=>error.code==='file_arguments');
  for(const value of [{action:'status',args:[]},{action:'run',args:[]},{action:'run',args:['search','bad\nline']},{action:'run',args:['--version'],extra:true},{action:'run',args:['search',...Array(40).fill('a')]},null])assert.throws(()=>validateNcmCliCall(value));
});

test('isolated environment excludes inherited model keys, music variables, loaders and proxies',()=>{
  const profile=path.resolve('synthetic-profile');
  const env=ncmCliEnvironment(profile,{PATH:'safe-path',SystemRoot:'C:\\Windows',HOME:'host-home',TEMP:'host-temp',OPENAI_API_KEY:'synthetic',NCM_DAEMON:'1',NCM_LEGACY_PLAY:'1',NCM_BG_UPLOAD_TASK_ID:'synthetic',NODE_OPTIONS:'--require synthetic',NODE_PATH:'host-modules',HTTP_PROXY:'http://example.test',DISPLAY:':1'});
  assert.equal(env.PATH,'safe-path');assert.equal(env.HOME,profile);assert.equal(env.USERPROFILE,profile);assert.equal(env.TEMP,path.join(profile,'tmp'));assert.equal(env.DISPLAY,':1');assert.equal(env.ELECTRON_RUN_AS_NODE,'1');
  for(const key of ['OPENAI_API_KEY','NCM_DAEMON','NCM_LEGACY_PLAY','NCM_BG_UPLOAD_TASK_ID','NODE_OPTIONS','NODE_PATH','HTTP_PROXY'])assert.equal(env[key],undefined);
});

test('output sanitizes nested credentials, raw headers, key blocks and URL parameters',()=>{
  const output=redactNcmCliOutput(JSON.stringify({rows:[{name:'title',privateKey:'synthetic-key',token:'synthetic-token',url:'https://example.test/song?token=synthetic-url&name=ok'}],cookie:{MUSIC_U:'synthetic-cookie'}}));
  assert.match(output,/title/);for(const secret of ['synthetic-key','synthetic-token','synthetic-url','synthetic-cookie'])assert.ok(!output.includes(secret));
  const text=redactNcmCliOutput('\x1b[31mAuthorization: Bearer synthetic-header\x1b[0m\nprivateKey=synthetic-key\n-----BEGIN RSA PRIVATE KEY-----\nsynthetic-material\n-----END RSA PRIVATE KEY-----\nhttps://example.test/?code=synthetic-code');
  for(const secret of ['synthetic-header','synthetic-key','synthetic-material','synthetic-code','\x1b'])assert.ok(!text.includes(secret));assert.ok(redactNcmCliOutput('x'.repeat(70000)).length<=48000);
});

test('missing runtime status reads offline and prepare emits manual installers without launching',async t=>{
  let runs=0;const f=await fixture(t,{run:async()=>{runs++;throw Error('must not run');}});
  const status=await f.manager.status();assert.equal(status.available,false);assert.equal(status.loginVerified,false);assert.equal(status.playbackSupported,false);assert.deepEqual(await readdir(f.directory),[]);
  const prepared=await f.manager.prepare();assert.equal(prepared.prepared,true);assert.equal(prepared.installed,false);assert.equal(runs,0);
  const install=await readFile(prepared.launchers.install,'utf8');assert.match(install,/npm install --prefix/);assert.match(install,/--ignore-scripts --save-exact --registry=https:\/\/registry\.npmjs\.org @music163\/ncm-cli@0\.1\.7/);
  for(const name of ['configure','login'])assert.match(await readFile(prepared.launchers[name],'utf8'),/launch\.mjs/);
  const launcher=await readFile(path.join(f.manager.root,'launch.mjs'),'utf8');assert.ok(!launcher.includes('OPENAI_API_KEY'));assert.match(launcher,/shell:false/);
  await assert.rejects(exec(process.execPath,[path.join(f.manager.root,'launch.mjs'),'configure']),error=>error.code===1&&error.stderr.includes('install'));
  await assert.rejects(f.manager.execute({action:'run',args:['--version']}),error=>error.code==='runtime_missing');
});

test('account roots are stable and separate; status reports credential presence without returning it',async t=>{
  const f=await fixture(t,{scope:'server:user-a'});const other=new NcmCliManager({dataDir:f.directory,scope:'server:user-b',env:{PATH:''}});t.after(()=>other.close());
  assert.notEqual(f.manager.profile,other.profile);const repeat=new NcmCliManager({dataDir:f.directory,scope:'server:user-a',env:{PATH:''}});t.after(()=>repeat.close());assert.equal(f.manager.profile,repeat.profile);
  await f.manager.prepare();const secret='synthetic-account-cookie';await writeFile(path.join(f.manager.profile,'.config','ncm-cli','credentials.enc.json'),secret);
  const status=await repeat.status();assert.equal(status.credentialsPresent,true);assert.equal(status.loginVerified,false);assert.ok(!JSON.stringify(status).includes(secret));assert.equal((await other.status()).credentialsPresent,false);
});

test('runtime resolution verifies name/version/bin, prefers account installation and never executes PATH cmd',async t=>{
  const f=await fixture(t);const local=await runtime(f.manager.runtimeDirectory),global=await runtime(path.join(f.directory,'global'));
  assert.equal((await resolveNcmCli({runtimeDirectory:f.manager.runtimeDirectory,globalPackageJsonPath:global.packageJsonPath,env:{PATH:''}})).entry,local.entry);
  await writeFile(local.packageJsonPath,JSON.stringify({name:NCMCLI_PACKAGE,version:'9.9.9',bin:{'ncm-cli':'dist/index.js'}}));await assert.rejects(resolveNcmCli({runtimeDirectory:f.manager.runtimeDirectory,env:{PATH:''}}),error=>error.code==='invalid_runtime');
  const fakePath=path.join(f.directory,'empty-bin');await mkdir(fakePath);await writeFile(path.join(fakePath,'ncm-cli.cmd'),'@echo should-not-run');assert.equal(await resolveNcmCli({env:{PATH:fakePath}}),null);
  await writeFile(global.packageJsonPath,JSON.stringify({name:'impostor',version:NCMCLI_VERSION,bin:{'ncm-cli':'dist/index.js'}}));await assert.rejects(resolveNcmCli({globalPackageJsonPath:global.packageJsonPath,env:{PATH:''}}),error=>error.code==='invalid_runtime');
});

test('global official package may be reused with isolated account home',async t=>{
  const f=await fixture(t),global=await runtime(path.join(f.directory,'global'));
  const manager=new NcmCliManager({dataDir:f.directory,scope:'global-runtime-account',env:{PATH:''},globalPackageJsonPath:global.packageJsonPath});t.after(()=>manager.close());
  const status=await manager.status();assert.equal(status.available,true);assert.equal(status.version,'0.1.7');const result=await manager.execute({action:'run',args:runArgs});assert.equal(result.ok,true);
  const output=JSON.parse(result.stdout);assert.deepEqual(output.args,runArgs);assert.equal(output.home,manager.profile);assert.equal(result.playbackVerified,false);
});

test('PATH metadata without an npm bin and developer node_modules residue do not imply installation',async t=>{
  const f=await fixture(t);await runtime(f.directory);
  assert.equal(await resolveNcmCli({env:{PATH:f.directory},platform:'win32'}),null);
  assert.equal(await resolveNcmCli({env:{PATH:path.resolve('.')},platform:'win32'}),null);
  await writeFile(path.join(f.directory,'ncm-cli.cmd'),'@echo off\r\nrem npm fixture marker, never executed');
  const resolved=await resolveNcmCli({env:{PATH:f.directory},platform:'win32'});assert.ok(resolved?.entry.endsWith(path.join('dist','index.js')));
});

test('linked account ancestors and launchers are refused before writing outside scope',async t=>{
  const f=await fixture(t),outside=path.join(f.directory,'outside');await mkdir(outside);await symlink(outside,path.join(f.directory,'ncmcli'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(f.manager.prepare(),error=>error.code==='invalid_path');assert.deepEqual(await readdir(outside),[]);
  const g=await fixture(t);await g.manager.prepare();const install=path.join(g.manager.root,'install'+(process.platform==='win32'?'.cmd':'.sh'));await rm(install);const victim=path.join(g.directory,'victim');await writeFile(victim,'preserved');
  try{await symlink(victim,install,'file');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.diagnostic('file symlink permission unavailable; ancestor junction case verified');return;}throw error;}
  await assert.rejects(g.manager.prepare(),error=>error.code==='invalid_path');assert.equal(await readFile(victim,'utf8'),'preserved');
});

test('absent global metadata under unrelated junction does not block optional setup',async t=>{
  const f=await fixture(t),outside=path.join(f.directory,'external');await mkdir(outside);const link=path.join(f.directory,'bin-link');await symlink(outside,link,process.platform==='win32'?'junction':'dir');
  assert.equal(await resolveNcmCli({env:{PATH:link},platform:'win32'}),null);
  const local=await runtime(outside);const globalMetadata=path.join(link,'node_modules','@music163','ncm-cli','package.json');assert.ok(local.entry);await assert.rejects(resolveNcmCli({globalPackageJsonPath:globalMetadata,env:{PATH:''}}),error=>error.code==='invalid_path');
});

test('prepare/run reserve before resolver awaits; cancellation cannot launch a late child',async t=>{
  const gate=deferred();let runs=0;const f=await fixture(t,{resolve:()=>gate.promise,run:async()=>{runs++;return{exitCode:0,stdout:'ok',stderr:''};}});
  const controller=new AbortController();const preparing=f.manager.prepare({signal:controller.signal}).catch(error=>error);
  assert.notEqual(f.manager.active,null);await assert.rejects(f.manager.execute({action:'run',args:['--version']}),error=>error.code==='busy');controller.abort();gate.resolve(null);assert.equal((await preparing).name,'AbortError');assert.equal(runs,0);assert.deepEqual(await readdir(f.directory),[]);assert.equal(f.manager.active,null);
});

test('close aborts preparation while runtime discovery is pending and prevents later writes',async t=>{
  const gate=deferred();const f=await fixture(t,{resolve:()=>gate.promise});const pending=f.manager.prepare().catch(error=>error);let closed=false;const closing=f.manager.close().then(()=>{closed=true;});
  await Promise.resolve();assert.equal(closed,false);gate.resolve(null);assert.equal((await pending).name,'AbortError');await closing;assert.equal(closed,true);assert.deepEqual(await readdir(f.directory),[]);await assert.rejects(f.manager.status(),error=>error.name==='AbortError');
});

test('run uses isolated profile and argv, redacts failures and preserves credentials',async t=>{
  const calls=[];const f=await fixture(t,{env:{PATH:'safe',OPENAI_API_KEY:'model-secret',NODE_OPTIONS:'--require unsafe',NCM_DAEMON:'1'},resolve:async()=>({entry:path.resolve('fixture.js'),version:NCMCLI_VERSION}),run:async(file,args,options)=>{calls.push({file,args,options});return{exitCode:1,stdout:'请先登录',stderr:'privateKey=synthetic-secret'};}});
  await f.manager.prepare();const credential=path.join(f.manager.profile,'.config','ncm-cli','credentials.enc.json');await writeFile(credential,'preserved-credential');
  const result=await f.manager.execute({action:'run',args:runArgs});assert.equal(result.ok,false);assert.equal(result.requiresUserSetup,true);assert.ok(!result.stderr.includes('synthetic-secret'));assert.equal(calls.length,1);assert.deepEqual(calls[0].args.slice(1),runArgs);assert.equal(calls[0].options.cwd,f.manager.profile);assert.equal(calls[0].options.env.OPENAI_API_KEY,undefined);assert.equal(calls[0].options.env.NODE_OPTIONS,undefined);assert.equal(calls[0].options.env.NCM_DAEMON,undefined);assert.equal(await readFile(credential,'utf8'),'preserved-credential');
});

test('process timeout/cancel waits for actual close rather than trusting kill return',async()=>{
  const child=childFixture({delayed:true}),calls=[];const pending=runNcmCliProcess(process.execPath,['fixture'],{platform:'linux',timeoutMs:10,shutdownTimeoutMs:100,spawnProcess:(file,args,options)=>{calls.push({file,args,options});return child;}}).catch(error=>error);
  await waitSignal(child,'SIGTERM');let settled=false;pending.then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);child.finish(1);assert.equal((await pending).code,'timeout');assert.equal(calls[0].options.shell,false);assert.equal(calls[0].options.windowsHide,true);
  const cancelledChild=childFixture({delayed:true}),controller=new AbortController();const cancelled=runNcmCliProcess(process.execPath,[],{platform:'linux',signal:controller.signal,shutdownTimeoutMs:100,spawnProcess:()=>cancelledChild}).catch(error=>error);controller.abort();await waitSignal(cancelledChild,'SIGTERM');cancelledChild.finish(1);assert.equal((await cancelled).name,'AbortError');
});

test('output overflow stops child; pre-aborted operations never spawn',async()=>{
  const child=childFixture();const pending=runNcmCliProcess(process.execPath,[],{platform:'linux',maxOutputBytes:10,spawnProcess:()=>child});child.stdout.write('x'.repeat(20));await assert.rejects(pending,error=>error.code==='output_limit');assert.deepEqual(child.signals,['SIGTERM']);
  const controller=new AbortController();controller.abort();await assert.rejects(runNcmCliProcess(process.execPath,[],{signal:controller.signal,spawnProcess:()=>{throw Error('must not spawn');}}),error=>error.name==='AbortError');
});

test('unconfirmed shutdown has finite failure and keeps manager occupied until owned close',async t=>{
  const child=childFixture({delayed:true});const f=await fixture(t,{platform:'linux',timeoutMs:10,shutdownTimeoutMs:10,resolve:async()=>({entry:path.resolve('fixture.js'),version:NCMCLI_VERSION}),run:(file,args,options)=>runNcmCliProcess(file,args,{...options,spawnProcess:()=>child})});
  const pending=f.manager.execute({action:'run',args:['--version']}).catch(error=>error);assert.equal((await pending).code,'shutdown_failed');assert.ok(f.manager.active?.retained);await assert.rejects(f.manager.execute({action:'run',args:['--version']}),error=>error.code==='busy');
  await assert.rejects(f.manager.cancel(),error=>error.code==='shutdown_failed');child.finish(1);await Promise.resolve();await Promise.resolve();assert.equal(f.manager.active,null);
});

test('generated installers quote special paths and constructors reject script control characters',async t=>{
  assert.throws(()=>new NcmCliManager({dataDir:'bad\r\npath'}));assert.throws(()=>new NcmCliManager({dataDir:'bad"path',platform:'win32'}));assert.throws(()=>new NcmCliManager({dataDir:'good',node:'node.cmd'}));
  const f=await fixture(t,{platform:'linux'});const manager=new NcmCliManager({dataDir:path.join(f.directory,"with ' and $ chars"),env:{PATH:''},platform:'linux'});t.after(()=>manager.close());
  const prepared=await manager.prepare();assert.match(await readFile(prepared.launchers.install,'utf8'),/'\\''/);assert.match(await readFile(prepared.launchers.login,'utf8'),/ELECTRON_RUN_AS_NODE=1 exec/);
});

test('executor replacement cannot bypass an older same-account child awaiting confirmed close',async t=>{
  const child=childFixture({delayed:true});
  const f=await fixture(t,{platform:'linux',timeoutMs:10,shutdownTimeoutMs:10,resolve:async()=>({entry:path.resolve('fixture.js'),version:NCMCLI_VERSION}),run:(file,args,options)=>runNcmCliProcess(file,args,{...options,spawnProcess:()=>child})});
  const peer=new NcmCliManager({dataDir:f.directory,platform:'linux',env:{PATH:''},resolve:async()=>null});t.after(()=>peer.close());
  await assert.rejects(f.manager.execute({action:'run',args:['--version']}),error=>error.code==='shutdown_failed');
  await assert.rejects(f.manager.close(),error=>error.code==='shutdown_failed');
  await assert.rejects(peer.status(),error=>error.code==='busy');
  child.finish(1);await Promise.resolve();await Promise.resolve();
  assert.equal((await peer.status()).available,false);
});

test('generated configure/login launcher runs verified CLI using the invoking external Node',async t=>{
  const f=await fixture(t),installed=await runtime(f.manager.runtimeDirectory);const prepared=await f.manager.prepare();
  const launcher=path.join(f.manager.root,'launch.mjs');
  for(const command of ['configure','login']){
    const result=await exec(process.execPath,[launcher,command]);const output=JSON.parse(result.stdout);assert.deepEqual(output.args,[command]);assert.equal(output.home,f.manager.profile);
    assert.ok(!(await readFile(prepared.launchers[command],'utf8')).includes(process.execPath));
  }
  assert.ok(installed.entry);await assert.rejects(exec(process.execPath,[launcher,'diag']),error=>error.code===1&&/Choose configure or login/.test(error.stderr));await assert.rejects(exec(process.execPath,[launcher,'configure','--privateKey','synthetic']),error=>error.code===1&&/Choose one fixed setup action/.test(error.stderr));
});

test('real official 0.1.7 offline smoke: pinned version and missing-config failure',async t=>{
  const packageJsonPath=path.resolve('node_modules/@music163/ncm-cli/package.json');
  try{await readFile(packageJsonPath);}catch(error){if(error.code==='ENOENT'){t.skip('optional official runtime not installed in this developer checkout');return;}throw error;}
  const f=await fixture(t,{globalPackageJsonPath:packageJsonPath,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},timeoutMs:10000});
  const status=await f.manager.status();assert.equal(status.available,true);assert.equal(status.version,'0.1.7');assert.equal(status.loginVerified,false);
  const version=await f.manager.execute({action:'run',args:['--version']});assert.equal(version.ok,true);assert.match(version.stdout,/0\.1\.7/);
  const help=await f.manager.execute({action:'run',args:['--help']});assert.equal(help.ok,false);assert.equal(help.requiresUserSetup,true);assert.match(help.stdout+help.stderr,/API key 未设置/);assert.equal(help.playbackVerified,false);
  assert.equal((await f.manager.status()).credentialsPresent,false);
});
