import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskNotificationController,notificationServerUrl,notificationNavigation} from '../src/platform/task-notification-controller.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const deviceId='6ca1c789-714c-4a3a-b461-708741f4961e';
const token='t'.repeat(43);
const navigation={conversationId:'agent-conversation',agentConversationId:'agent-conversation',runId:'agent-run',eventId:'event-id',source:'agent'};
function harness(overrides={}){
  let scope={epoch:3,url:'https://pet.example',token:'foreground-only-secret',instanceId:'instance-one',userId:'user-one'},visible=true;
  let status={enabled:false,running:false,permission:'prompt',connection:'stopped'};
  let pending=null;
  const calls=[];
  const native={
    installation:async()=>{calls.push('installation');return{deviceId};},
    status:async()=>{calls.push('status');return{...status};},
    start:async input=>{calls.push(['start',input]);status={enabled:true,running:true,permission:'granted',connection:'connected',...input};delete status.token;return{...status};},
    stop:async()=>{calls.push('stop');status={enabled:false,running:false,permission:'granted',connection:'stopped'};return status;},
    clearScope:async()=>{calls.push('clearScope');status={enabled:false,running:false,permission:'granted',connection:'stopped'};pending=null;return status;},
    consumeNavigation:async input=>{calls.push(['consume',input]);const result=pending;pending=null;return{navigation:result};},
    ...overrides.native,
  };
  const dependencies={native,session:()=>scope,foreground:()=>visible,
    register:async(id,signal)=>{calls.push(['register',id,signal]);return{deviceId:id,token,instanceId:scope.instanceId,userId:scope.userId,cursor:12,expiresAt:new Date(Date.now()+3600000).toISOString()};},
    revoke:async id=>{calls.push(['revoke',id]);},
    refreshState:async signal=>{calls.push(['state',signal]);return{instanceId:scope.instanceId,user:{id:scope.userId},conversations:[{id:navigation.conversationId,mode:'codex'}]};},
    fetchConversation:async(id,signal)=>{calls.push(['conversation',id,signal]);return{id,mode:'codex',messages:[]};},
    ...overrides,
  };
  dependencies.native=native;
  const controller=createTaskNotificationController(dependencies);
  return{controller,calls,native,get scope(){return scope;},set scope(value){scope=value;},set status(value){status=value;},set pending(value){pending=value;},set visible(value){visible=value;}};
}

test('initial recovery restores a matching native listener without re-registering or stopping',async()=>{
  const h=harness();h.status={enabled:true,running:true,permission:'granted',connection:'connected',url:h.scope.url,instanceId:h.scope.instanceId,userId:h.scope.userId,deviceId};
  await h.controller.reconcile();
  assert.equal(h.controller.snapshot().status.running,true);
  assert.equal(h.calls.some(call=>call==='clearScope'||call==='stop'||Array.isArray(call)&&['register','start'].includes(call[0])),false);
});

test('matching identity on a different restored server clears the old native scope',async()=>{
  const h=harness();h.status={enabled:true,running:true,url:'https://other.example',instanceId:h.scope.instanceId,userId:h.scope.userId};
  await h.controller.reconcile();assert.equal(h.calls.includes('clearScope'),true);assert.equal(h.controller.snapshot().status.enabled,false);
});

test('a different verified account invalidates the old native listener before consuming taps',async()=>{
  const h=harness();h.status={enabled:true,running:true,url:h.scope.url,instanceId:h.scope.instanceId,userId:'other-user'};
  await h.controller.reconcile();
  assert.ok(h.calls.indexOf('clearScope')<h.calls.findIndex(call=>Array.isArray(call)&&call[0]==='consume'));
});

test('enable requires login, HTTPS and a visible application before registering a device',async()=>{
  for(const kind of ['login','http','background']){
    const h=harness();if(kind==='login')h.scope=null;if(kind==='http')h.scope={...h.scope,url:'http://pet.example'};if(kind==='background')h.visible=false;
    await assert.rejects(h.controller.enable());assert.deepEqual(h.calls,[]);
  }
  for(const url of ['https://name:secret@pet.example','https://pet.example?token=secret','https://pet.example#target','file:///app'])assert.throws(()=>notificationServerUrl(url));
});

test('enable forwards only the restricted device token and whitelisted registration fields',async()=>{
  const h=harness({register:async()=>({deviceId,token,instanceId:'instance-one',userId:'user-one',cursor:4,expiresAt:new Date(Date.now()+3600000).toISOString(),url:'https://attacker.example',extra:'never forward'})});
  await h.controller.enable();
  const input=h.calls.find(call=>Array.isArray(call)&&call[0]==='start')[1];
  assert.equal(input.url,'https://pet.example');assert.equal(input.token,token);assert.equal(input.extra,undefined);
  assert.equal(JSON.stringify(h.controller.snapshot()).includes(token),false);assert.equal(JSON.stringify(h.controller.snapshot()).includes('foreground-only-secret'),false);
});

test('notification permission denial clears native scope and revokes the registered device',async()=>{
  const h=harness({native:{start:async()=>({enabled:false,running:false,permission:'denied',connection:'stopped'})}});
  await assert.rejects(h.controller.enable(),/允许通知权限/);
  assert.equal(h.calls.includes('clearScope'),true);assert.ok(h.calls.some(call=>Array.isArray(call)&&call[0]==='revoke'&&call[1]===deviceId));assert.equal(h.controller.snapshot().busy,false);
});
test('a configured native listener may finish asynchronous service startup after enable resolves',async()=>{
  const h=harness({native:{start:async input=>({enabled:true,running:false,permission:'granted',connection:'starting',instanceId:input.instanceId,userId:input.userId,deviceId:input.deviceId,url:input.url})}});
  await h.controller.enable();assert.equal(h.controller.snapshot().status.enabled,true);assert.equal(h.controller.snapshot().status.running,false);assert.equal(h.calls.includes('clearScope'),false);assert.equal(h.calls.some(call=>Array.isArray(call)&&call[0]==='revoke'),false);
});

test('malformed or other-account registration is never forwarded to native start',async()=>{
  for(const patch of [{userId:'other-user'},{instanceId:'other-instance'},{deviceId:'other-device'},{cursor:-1},{token:'too short'},{expiresAt:'never'}]){
    const h=harness({register:async()=>({deviceId,token,instanceId:'instance-one',userId:'user-one',cursor:1,expiresAt:new Date(Date.now()+3600000).toISOString(),...patch})});
    await assert.rejects(h.controller.enable(),/凭据响应无效/);assert.equal(h.calls.some(call=>Array.isArray(call)&&call[0]==='start'),false);
  }
});

test('logout during a late registration prevents start and invalidates native generation immediately',async()=>{
  const registered=deferred();const h=harness({register:()=>registered.promise});
  const enabled=h.controller.enable();await new Promise(resolve=>setImmediate(resolve));
  const former=h.scope;h.scope=null;await h.controller.invalidate();
  registered.resolve({deviceId,token,...former,cursor:1,expiresAt:new Date(Date.now()+3600000).toISOString()});
  await assert.rejects(enabled,{code:'SESSION_CHANGED'});
  assert.ok(h.calls.includes('clearScope'));assert.equal(h.calls.some(call=>Array.isArray(call)&&call[0]==='start'),false);
});

test('logout during native permission/start waits cannot restore frontend listener state',async()=>{
  const prompt=deferred();const h=harness({native:{start:()=>prompt.promise}});
  const enabled=h.controller.enable();await new Promise(resolve=>setImmediate(resolve));
  h.scope=null;await h.controller.invalidate();prompt.resolve({enabled:true,running:true,permission:'granted',instanceId:'instance-one',userId:'user-one'});
  await assert.rejects(enabled,{code:'SESSION_CHANGED'});assert.equal(h.controller.snapshot().status.enabled,false);
});

test('notification taps stay pending while logged out or backgrounded',async()=>{
  const h=harness();h.pending=navigation;h.visible=false;await h.controller.consume();assert.deepEqual(h.calls,[]);
  h.visible=true;const scope=h.scope;h.scope=null;await h.controller.consume();assert.deepEqual(h.calls,[]);
  h.scope=scope;await h.controller.consume();assert.equal(h.controller.snapshot().navigation.conversation.id,navigation.conversationId);
});

test('validated cold-start tap refreshes owned summaries and exact conversation before navigation',async()=>{
  const h=harness();h.pending=navigation;await h.controller.consume();
  const names=h.calls.filter(Array.isArray).map(call=>call[0]);assert.deepEqual(names,['consume','state','conversation']);
  const result=h.controller.takeNavigation();assert.equal(result.epoch,3);assert.equal(result.instanceId,h.scope.instanceId);assert.equal(result.userId,h.scope.userId);assert.equal(result.conversation.id,navigation.conversationId);assert.equal(h.controller.snapshot().navigation,null);
});

test('a Chat-dispatched Agent notification navigates to its owned parent Chat',async()=>{
  const h=harness({refreshState:async()=>({instanceId:'instance-one',user:{id:'user-one'},conversations:[{id:'chat-parent',mode:'chat'}]}),fetchConversation:async()=>({id:'chat-parent',mode:'chat',messages:[]})});
  h.pending={...navigation,conversationId:'chat-parent',source:'chat-agent'};await h.controller.consume();assert.equal(h.controller.snapshot().navigation.conversation.id,'chat-parent');assert.equal(h.controller.snapshot().navigation.conversation.mode,'chat');
});

test('unowned or deleted conversations never navigate or fetch any full conversation',async()=>{
  const h=harness({refreshState:async()=>({instanceId:'instance-one',user:{id:'user-one'},conversations:[]})});h.pending=navigation;
  await h.controller.consume();assert.equal(h.controller.snapshot().navigation,null);assert.match(h.controller.snapshot().error,/不属于/);assert.equal(h.calls.some(call=>Array.isArray(call)&&call[0]==='conversation'),false);
});

test('network failure retains consumed target for foreground retry under the same account',async()=>{
  let attempt=0;const h=harness({refreshState:async()=>{if(++attempt===1)throw new Error('network unavailable');return{instanceId:'instance-one',user:{id:'user-one'},conversations:[{id:navigation.conversationId,mode:'codex'}]};}});h.pending=navigation;
  await h.controller.consume();assert.match(h.controller.snapshot().error,/network/);await h.controller.consume();
  assert.equal(h.controller.snapshot().navigation.conversation.id,navigation.conversationId);assert.equal(h.calls.filter(call=>Array.isArray(call)&&call[0]==='consume').length,1);
});

test('account/epoch changes while validating a tap abort and reject the late navigation',async()=>{
  const state=deferred();let signal;const h=harness({refreshState:nextSignal=>{signal=nextSignal;return state.promise;}});h.pending=navigation;
  const consumed=h.controller.consume();await new Promise(resolve=>setImmediate(resolve));h.scope={...h.scope,epoch:4,userId:'other-user'};await h.controller.invalidate();
  assert.equal(signal.aborted,true);state.resolve({instanceId:'instance-one',user:{id:'user-one'},conversations:[{id:navigation.conversationId,mode:'codex'}]});await consumed;
  assert.equal(h.controller.snapshot().navigation,null);assert.equal(h.calls.some(call=>Array.isArray(call)&&call[0]==='conversation'),false);
});

test('late status cannot restore a listener after invalidation; navigation IDs cannot be arbitrary URLs',async()=>{
  const late=deferred();let attempt=0;
  const h=harness({native:{status:()=>++attempt===1?late.promise:Promise.resolve({enabled:false,running:false,permission:'granted',connection:'stopped'})}});
  const refresh=h.controller.refresh();await h.controller.invalidate();late.resolve({enabled:true,running:true});await refresh;assert.equal(h.controller.snapshot().status.enabled,false);
  for(const patch of [{conversationId:'https://attacker.example'},{eventId:'../old-user'},{runId:'a'.repeat(161)},{source:'chat'}])assert.throws(()=>notificationNavigation({...navigation,...patch}));
});
