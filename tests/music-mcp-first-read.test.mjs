import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MusicMcpManager } from '../server/music-mcp.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function fixture(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'petpal-music-first-read-'));let launches=0;
  const manager=new MusicMcpManager({dataDir:directory,platform:'win32',spawn:()=>{launches++;throw Error('passive reads must not launch Python');},transportFactory:()=>{launches++;throw Error('passive reads must not connect MCP');}});
  t.after(async()=>{await manager.close();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('petpal-music-first-read-'));await rm(directory,{recursive:true,force:true});});
  return{manager,directory,launches:()=>launches};
}

function stageInitialReceipt(manager){
  const staged=deferred(),release=deferred(),readers=deferred();let claims=0,waiting=false,reads=0;
  const writeReceipt=manager._writeLockReceipt.bind(manager),read=manager._read.bind(manager);
  manager._writeLockReceipt=async(info,receipt,options)=>{
    if(info.kind!=='config'||!options?.initial)return writeReceipt(info,receipt,options);
    claims++;
    if(claims!==1)return writeReceipt(info,receipt,options);
    const handle=await open(info.file,'wx',0o600);waiting=true;staged.resolve();
    try{await release.promise;await handle.writeFile(`${JSON.stringify(receipt)}\n`);await handle.sync();}
    finally{waiting=false;await handle.close();}
  };
  manager._read=async()=>{const result=await read();if(waiting&&!result&&++reads===2)readers.resolve();return result;};
  return{staged:staged.promise,readers:readers.promise,release:release.resolve,claims:()=>claims};
}

test('same-manager first config and status readers share one initialization while its lock receipt is still empty',async t=>{
  const f=await fixture(t),held=stageInitialReceipt(f.manager);t.after(held.release);
  const first=f.manager.config();await held.staged;assert.equal((await stat(`${f.manager.configFile}.lock`)).size,0);
  const together=Promise.allSettled([first,f.manager.config(),f.manager.status()]);
  try{
    await held.readers;await new Promise(resolve=>setImmediate(resolve));assert.equal(held.claims(),1);
    held.release();const results=await together;assert.equal(results.every(result=>result.status==='fulfilled'),true);
    const [initial,parallel,status]=results.map(result=>result.value);assert.deepEqual(parallel,initial);assert.deepEqual(status.config,initial);
    assert.deepEqual(JSON.parse(await readFile(f.manager.configFile,'utf8')),initial);assert.equal(f.manager.revision,initial.revision);
    assert.equal(status.servers.every(server=>!server.connected&&server.tools.length===0),true);assert.equal(f.launches(),0);
    await assert.rejects(stat(`${f.manager.configFile}.lock`),{code:'ENOENT'});
    for(const server of status.servers)await assert.rejects(stat(server.prepare.dependenciesDirectory),{code:'ENOENT'});
  }finally{held.release();await together;}
});

test('another manager still refuses the unresolved empty receipt rather than treating it as its own initialization',async t=>{
  const f=await fixture(t),held=stageInitialReceipt(f.manager);t.after(held.release);
  const first=f.manager.config(),settled=Promise.allSettled([first]);await held.staged;
  const other=new MusicMcpManager({dataDir:f.directory,platform:'win32',spawn:()=>{throw Error('must not launch');}});t.after(()=>other.close());
  try{
    await assert.rejects(other.config(),{code:'unknown_lock'});assert.equal((await stat(`${f.manager.configFile}.lock`)).size,0);
    held.release();const initial=await first;assert.deepEqual(await other.config(),initial);assert.equal(f.launches(),0);
  }finally{held.release();await settled;}
});

test('preexisting empty lock remains fail-closed for concurrent first readers and a rejected initialization is not cached forever',async t=>{
  const f=await fixture(t),lock=`${f.manager.configFile}.lock`;await writeFile(lock,'');
  const results=await Promise.allSettled([f.manager.config(),f.manager.status()]);
  assert.equal(results.every(result=>result.status==='rejected'&&result.reason.code==='unknown_lock'),true);
  assert.equal((await stat(lock)).size,0);await assert.rejects(stat(f.manager.configFile),{code:'ENOENT'});assert.equal(f.launches(),0);
  // Simulate the prescribed manual recovery only inside this disposable fixture.
  await unlink(lock);const config=await f.manager.config();assert.deepEqual((await f.manager.status()).config,config);assert.equal(f.launches(),0);
});
