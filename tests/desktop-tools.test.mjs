import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopTools } from '../server/desktop-tools.mjs';

const fixture = overrides => createDesktopTools({dataDir:'.unused-fixture',music:{status:async()=>({players:[]}),execute:async()=>({ok:true}),...overrides},opencli:{status:async()=>({ready:false}),execute:async()=>({ok:true}),close:async()=>{}}});
test('registry validates parameters before producing reviewable approvals',()=>{
  const tools=fixture();assert.equal(tools.describe('petpal_music_status',{}).approvalRequired,false);
  assert.match(tools.describe('petpal_music_command',{player:'qqmusic',action:'pause'}).description,/QQ 音乐.*暂停/);
  assert.throws(()=>tools.describe('arbitrary_shell',{command:'evil'}));assert.throws(()=>tools.describe('petpal_music_status',{command:'evil'}));
  assert.throws(()=>tools.describe('petpal_music_command',{player:'qqmusic',action:'open',path:'arbitrary'}));
});
test('registry serializes side effects and releases busy state on failure',async()=>{
  let release;const tools=fixture({execute:()=>new Promise(resolve=>{release=resolve;})});
  const first=tools.execute('petpal_music_command',{player:'netease',action:'play'});
  await assert.rejects(tools.execute('petpal_music_command',{player:'qqmusic',action:'pause'}),{status:409});
  release({ok:true});await first;assert.equal((await tools.status()).busy,false);
});
test('closing registry aborts in-flight action and rejects later dispatch',async()=>{
  let aborted=false;const tools=fixture({execute:(_,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(new Error('stop'),{name:'AbortError'}));},{once:true}))});
  const action=tools.execute('petpal_music_command',{player:'netease',action:'play'});const check=assert.rejects(action,{name:'AbortError'});await tools.close();await check;assert.equal(aborted,true);
  await assert.rejects(tools.execute('petpal_music_status',{}),{name:'AbortError'});
});
