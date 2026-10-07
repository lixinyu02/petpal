import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopTools } from '../server/desktop-tools.mjs';

const computerUseMcp = { status: async()=>({enabled:false}), close:async()=>{} };
const fixture = (overrides,musicMcp={status:async()=>({servers:[]}),close:async()=>{}}) => createDesktopTools({dataDir:'.unused-fixture',computerUseMcp,musicMcp,music:{status:async()=>({players:[]}),execute:async()=>({ok:true}),...overrides},opencli:{status:async()=>({ready:false}),execute:async()=>({ok:true}),close:async()=>{}}});
test('registry validates parameters before producing reviewable approvals',()=>{
  const tools=fixture();assert.equal(tools.describe('petpal_music_status',{}).approvalRequired,false);
  assert.match(tools.describe('petpal_music_command',{player:'qqmusic',action:'pause'}).description,/QQ 音乐.*暂停/);
  assert.throws(()=>tools.describe('arbitrary_shell',{command:'evil'}));assert.throws(()=>tools.describe('petpal_music_status',{command:'evil'}));
  assert.throws(()=>tools.describe('petpal_music_command',{player:'qqmusic',action:'open',path:'arbitrary'}));
});

test('universal website approvals hide typed text and sensitive URL query values',()=>{
  const tools=fixture();
  const fill=tools.describe('petpal_browser',{action:'fill',tabId:'page-1',target:7,text:'private-password'});
  assert.equal(fill.approvalRequired,true);assert.match(fill.description,/填写页面文本.*控件 7/);
  assert.doesNotMatch(fill.description,/private-password/);
  const open=tools.describe('petpal_browser',{action:'open',url:'https://soutxt8.com/?token=private-token&code=private-code'});
  assert.equal(open.approvalRequired,true);assert.match(open.description,/soutxt8.com/);
  assert.doesNotMatch(open.description,/private-token|private-code/);
});

test('MCP discovery and calls use the injected local manager and require reviewable full-access actions',async()=>{
  const calls=[], manager={connect:async(...args)=>calls.push(args),status:async()=>({servers:[{id:'qqmusic',connected:true,tools:[{name:'search',inputSchema:{type:'object'}}]}]}),call:async args=>{calls.push(args);return {ok:false,message:'查询失败'};},close:async()=>{}};
  const tools=fixture({},manager);
  assert.equal(tools.describe('petpal_music_mcp_tools',{player:'qqmusic'}).approvalRequired,true);
  assert.equal(tools.describe('petpal_music_mcp_call',{player:'qqmusic',tool:'url',arguments:{mid:'song'}}).approvalRequired,true);
  assert.throws(()=>tools.describe('petpal_music_mcp_tools',{player:'qqmusic',command:'evil'}));
  assert.throws(()=>tools.describe('petpal_music_mcp_call',{player:'netease',tool:'control_netease',arguments:{action:'next'}}));
  const listed=await tools.execute('petpal_music_mcp_tools',{player:'qqmusic'});
  assert.equal(listed.connected,true);assert.equal(listed.tools[0].name,'search');
  const result=await tools.execute('petpal_music_mcp_call',{player:'qqmusic',tool:'search',arguments:{keyword:'晴天'}});
  assert.equal(result.ok,false);assert.equal(calls.at(-1).tool,'search');await tools.close();
});

test('central MCP missing conversation identity never falls back to owner credentials',async()=>{
  let calls=0;
  const tools=createDesktopTools({dataDir:'.unused-fixture',computerUseMcp,scopeForConversation:()=>null,musicMcp:{connect:async()=>{calls++;},close:async()=>{}},music:{},opencli:{close:async()=>{}}});
  await assert.rejects(tools.execute('petpal_music_mcp_tools',{player:'qqmusic'},{conversationId:'missing'}),/所属账号/);
  assert.equal(calls,0);await tools.close();
});

test('OpenCLI discovery and queries use the scoped manager and missing identity cannot access owner browser',async()=>{
  let queries=0,browsers=0;
  const manager={sites:async()=>({sites:[]}),query:async()=>{queries++;return {ok:true,rows:[]};},executeBrowser:async()=>{browsers++;return {ok:true};},status:async()=>({ready:false}),close:async()=>{}};
  const tools=createDesktopTools({dataDir:'.unused-fixture',computerUseMcp,musicMcp:{close:async()=>{}},music:{},opencliManager:manager,musicMcpScope:'owner',scopeForConversation:id=>id==='owned-conversation'?'owner':null});
  assert.equal(tools.describe('petpal_opencli_sites',{}).approvalRequired,false);
  assert.equal(tools.describe('petpal_opencli_query',{site:'npm',command:'package',arguments:{name:'react'}}).approvalRequired,true);
  await tools.execute('petpal_opencli_query',{site:'npm',command:'package',arguments:{name:'react'}},{conversationId:'owned-conversation'});
  for(const conversationId of [undefined,'missing']){
    await assert.rejects(tools.execute('petpal_opencli_query',{site:'npm',command:'package',arguments:{name:'react'}},{conversationId}),/所属账号/);
    await assert.rejects(tools.execute('petpal_browser',{action:'connect'},{conversationId}),/所属账号/);
  }
  assert.equal(queries,1);assert.equal(browsers,0);await tools.close();
});

test('reviewable OpenCLI share approvals retain site and command but hide full URLs and extraction codes', async()=>{
  const calls=[],manager={sites:async()=>({sites:[]}),query:async args=>{calls.push(args);return {ok:true,rows:[]};},close:async()=>{}};
  const tools=createDesktopTools({dataDir:'.unused-fixture',computerUseMcp,musicMcp:{close:async()=>{}},music:{},opencliManager:manager});
  const urls={'baidu-pan':'https://pan.baidu.com/s/1abcdeFGH',quark:'https://pan.quark.cn/s/abcdef12','xunlei-pan':'https://pan.xunlei.com/s/abcdef12'};
  for(const [site,url] of Object.entries(urls)){
    const args={site,command:'share-tree',arguments:{url:`${url}?pwd=Y7gX`,passcode:'S9pQ',limit:3}};
    const approval=tools.describe('petpal_opencli_query',args);
    assert.equal(approval.approvalRequired,true);assert.match(approval.description,new RegExp(`${site}/share-tree`));
    assert.doesNotMatch(approval.description,/https:|Y7gX|S9pQ|abcdef12|1abcdeFGH/);assert.match(approval.description,/已隐藏/);
    await tools.execute('petpal_opencli_query',args);
    assert.equal(calls.at(-1).arguments.passcode,'S9pQ');assert.equal(calls.at(-1).arguments.url,`${url}?pwd=Y7gX`);
  }
  const status=tools.describe('petpal_opencli_query',{site:'fire-exam',command:'status',arguments:{url:'https://xfhyjd.119.gov.cn/status?application=private'}});
  assert.doesNotMatch(status.description,/application|https:|private/);
  assert.throws(()=>tools.describe('petpal_opencli_query',{site:'bilibili',command:'like',arguments:{bvid:'BV1xx411c7mD'}}));
  await tools.close();
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
