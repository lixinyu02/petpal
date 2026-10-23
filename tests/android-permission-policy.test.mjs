import test from 'node:test';
import assert from 'node:assert/strict';
import {ANDROID_PERMISSION_SETTINGS,isAndroidPermissionKind,mediaPermissionPresentation,notificationChannelPresentation,permissionSettingsFeedback,createMediaPermissionProbe} from '../src/platform/android-permission-policy.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const fakeTimers=()=>{const timers=new Map();let id=0;return {setTimer(fn){timers.set(++id,fn);return id;},clearTimer(id){timers.delete(id);},fire(){for(const fn of timers.values())fn();timers.clear();},get size(){return timers.size;}};};
const stream=()=>{let stopped=0;return {value:{getTracks:()=>[{stop(){stopped++;}},{stop(){stopped++;}}]},get stopped(){return stopped;}};};

test('Android permission settings only accept the fixed route kinds',()=>{
  assert.deepEqual(ANDROID_PERMISSION_SETTINGS,['app','microphone','camera','notifications','task','companion','watch','overlay','install','battery','autostart']);
  for(const kind of ANDROID_PERMISSION_SETTINGS)assert.equal(isAndroidPermissionKind(kind),true);
  for(const kind of ['intent','package','Microphone',null,{},' app',''])assert.equal(isAndroidPermissionKind(kind),false);
  assert.throws(()=>ANDROID_PERMISSION_SETTINGS.push('intent'));
});
test('media status separates unsupported, system privacy block, runtime grant and repeatable request',()=>{
  assert.equal(mediaPermissionPresentation({state:'unsupported',supported:false,blocked:null},'camera').action,'none');
  const blocked=mediaPermissionPresentation({state:'granted',supported:true,blocked:true},'microphone');
  assert.match(blocked.label,/总开关/);assert.match(blocked.help,/快捷设置.*不能代替/);assert.equal(blocked.action,'settings');
  for(const state of ['prompt','denied'])assert.equal(mediaPermissionPresentation({state,supported:true,blocked:null},'camera').action,'request');
  assert.equal(mediaPermissionPresentation({state:'settings',supported:true,blocked:false},'camera').action,'settings');
  assert.equal(mediaPermissionPresentation({state:'granted',supported:true,blocked:null},'camera').label,'已允许');
});
test('uncreated channels are not described as granted and settings handoffs never claim permission change',()=>{
  assert.equal(notificationChannelPresentation({created:false,enabled:true}),'使用此功能时创建');
  assert.equal(notificationChannelPresentation({created:true,enabled:false}),'此通知类别已关闭');
  assert.equal(notificationChannelPresentation({created:true,enabled:true}),'已允许');
  for(const result of [{opened:true,fallback:false},{opened:true,fallback:true,route:'android-app-details'},{opened:true,fallback:true,route:'android-settings'}])assert.doesNotMatch(permissionSettingsFeedback(result),/已授权|已允许|已开启/);
  assert.match(permissionSettingsFeedback({opened:false}),/无法打开/);
});
test('media probes request only the selected microphone or camera and release every granted track immediately',async()=>{
  for(const kind of ['microphone','camera']){
    const acquired=stream(),calls=[];const probe=createMediaPermissionProbe({getUserMedia:async input=>{calls.push(input);return acquired.value;}});
    await probe.request(kind,'chosen-device');
    assert.deepEqual(calls,[kind==='microphone'?{audio:{deviceId:{exact:'chosen-device'}},video:false}:{audio:false,video:{deviceId:{exact:'chosen-device'}}}]);
    assert.equal(acquired.stopped,2);assert.equal(probe.pending(),false);probe.dispose();
  }
});
test('a media timeout retains the native prompt lock and reclaims a late granted stream',async()=>{
  const pending=deferred(),timers=fakeTimers(),acquired=stream();let calls=0,settled=0;
  const probe=createMediaPermissionProbe({getUserMedia:()=>{calls++;return pending.promise;},...timers,onSettled:()=>settled++});
  const result=probe.request('microphone');const rejection=assert.rejects(result,/等待较久/);timers.fire();await rejection;
  assert.equal(probe.pending(),true);await assert.rejects(probe.request('camera'),/仍在处理中/);assert.equal(calls,1);
  pending.resolve(acquired.value);await Promise.resolve();await Promise.resolve();
  assert.equal(acquired.stopped,2);assert.equal(probe.pending(),false);assert.equal(settled,1);probe.dispose();
});
test('cancellation and unmount release late streams without returning a successful probe',async()=>{
  for(const operation of ['abort','dispose']){
    const pending=deferred(),timers=fakeTimers(),acquired=stream(),abort=new AbortController();
    const probe=createMediaPermissionProbe({getUserMedia:()=>pending.promise,...timers});const result=probe.request('camera','',abort.signal);
    const rejection=assert.rejects(result,{name:'AbortError'});operation==='abort'?abort.abort():probe.dispose();await rejection;
    assert.equal(timers.size,0);assert.equal(probe.pending(),true);
    pending.resolve(acquired.value);await Promise.resolve();await Promise.resolve();assert.equal(acquired.stopped,2);
    if(operation==='dispose')await assert.rejects(probe.request('camera'),{name:'AbortError'});probe.dispose();
  }
});
test('synchronous failure and rejection release the request lock and timers for retry',async()=>{
  const timers=fakeTimers();let calls=0;
  const probe=createMediaPermissionProbe({getUserMedia:()=>{calls++;if(calls===1)throw new Error('sync');return Promise.reject(new Error('async'));},...timers});
  await assert.rejects(probe.request('microphone'),/sync/);assert.equal(probe.pending(),false);assert.equal(timers.size,0);
  await assert.rejects(probe.request('camera'),/async/);assert.equal(probe.pending(),false);assert.equal(timers.size,0);
  await assert.rejects(probe.request('anything'),/类型无效/);assert.equal(calls,2);probe.dispose();
});
