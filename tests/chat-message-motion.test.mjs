import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceMessageMotion,attachMessageMotion,canAnimateMessageMotion,createMessageMotionTracker,MESSAGE_MOTION_ID_LIMIT} from '../src/chat-message-motion.mjs';

test('initial history stays static, while each newly committed message enters only once',()=>{
  const tracker=createMessageMotionTracker();
  assert.deepEqual(advanceMessageMotion(tracker,'chat-one',['history-a','history-b'],true),[]);
  assert.deepEqual(advanceMessageMotion(tracker,'chat-one',['history-a','history-b','user-c','assistant-d'],true),['user-c','assistant-d']);
  for(let chunk=0;chunk<40;chunk++)assert.deepEqual(advanceMessageMotion(tracker,'chat-one',['history-a','history-b','user-c','assistant-d'],true),[],`content or speech update ${chunk} cannot repeat entrance`);
});

test('deletion, reorder, empty list and reinsert do not replay an existing message ID',()=>{
  const tracker=createMessageMotionTracker();
  advanceMessageMotion(tracker,'chat-one',['history'],true);
  assert.deepEqual(advanceMessageMotion(tracker,'chat-one',['history','new'],true),['new']);
  assert.deepEqual(advanceMessageMotion(tracker,'chat-one',[],true),[]);
  assert.deepEqual(advanceMessageMotion(tracker,'chat-one',['new','history'],true),[]);
  assert.deepEqual(advanceMessageMotion(tracker,'chat-one',['other','new','history'],true),['other']);
});

test('optimistic user and assistant placeholders wait for canonical server IDs and cannot create a second entrance',()=>{
  const tracker=createMessageMotionTracker(),history=['already-loaded'];
  advanceMessageMotion(tracker,'chat',history,true);
  assert.deepEqual(advanceMessageMotion(tracker,'chat',[...history,'user-1791080000123','pending-1791080000124'],true),[]);
  assert.deepEqual(advanceMessageMotion(tracker,'chat',[...history,'user-1791080000123','pending-1791080000124'],true),[], 'placeholder content or streaming refresh stays static');
  const canonical=[...history,'3beb0c64-0157-45dc-9169-3b18c037914b','d308c2e0-a77a-4221-bb62-63fdfc1b1d92'];
  assert.deepEqual(advanceMessageMotion(tracker,'chat',canonical,true),canonical.slice(1));
  for(let chunk=0;chunk<12;chunk++)assert.deepEqual(advanceMessageMotion(tracker,'chat',canonical,true),[]);
  assert.deepEqual(advanceMessageMotion(tracker,'chat',[...history,'user-1791080000123','pending-1791080000124'],true),[], 'late optimistic restoration must remain consumed');
  assert.deepEqual(advanceMessageMotion(tracker,'chat',canonical,true),[], 'canonical replacement cannot replay either');
});

test('optimistic exclusion matches only complete numeric user/pending IDs and leaves unrelated server IDs eligible',()=>{
  const tracker=createMessageMotionTracker();
  advanceMessageMotion(tracker,'chat',['user-history','pending-history'],true);
  assert.deepEqual(advanceMessageMotion(tracker,'chat',['user-history','pending-history','user-more','pending-more','user-123-extra','pending-123-extra','prefix-user-123',' user-123','user-123 '],true),['user-more','pending-more','user-123-extra','pending-123-extra','prefix-user-123',' user-123','user-123 ']);
  assert.deepEqual(advanceMessageMotion(tracker,'chat',['user-history','pending-history'],true),[]);
});

test('conversation change consumes loaded history and releases the previous conversation tracking',()=>{
  const tracker=createMessageMotionTracker();
  advanceMessageMotion(tracker,'chat-one',['old'],true);
  advanceMessageMotion(tracker,'chat-one',['old','arrived'],true);
  assert.deepEqual(advanceMessageMotion(tracker,'chat-two',['arrived','loaded'],true),[]);
  assert.deepEqual([...tracker.seen],['arrived','loaded']);
  assert.deepEqual(advanceMessageMotion(tracker,'chat-two',['arrived','loaded','new'],true),['new']);
  assert.deepEqual(advanceMessageMotion(tracker,'chat-one',['old','arrived'],true),[], 'reopening history cannot animate it');
});

test('hidden, reduced and disabled arrivals are consumed and cannot replay after motion resumes',()=>{
  for(const mode of ['hidden','reduced','off']){
    const tracker=createMessageMotionTracker();
    advanceMessageMotion(tracker,'chat',['history'],true);
    assert.deepEqual(advanceMessageMotion(tracker,'chat',['history',mode],false),[]);
    assert.deepEqual(advanceMessageMotion(tracker,'chat',['history',mode],true),[]);
    assert.deepEqual(advanceMessageMotion(tracker,'chat',['history',mode,'visible-new'],true),['visible-new']);
  }
});

test('duplicate and invalid IDs are static and do not trigger a later duplicate resolution entrance',()=>{
  const tracker=createMessageMotionTracker();
  advanceMessageMotion(tracker,'chat',[],true);
  assert.deepEqual(advanceMessageMotion(tracker,'chat',['duplicate','duplicate','',null,undefined,7,'__proto__'],true),['__proto__']);
  assert.deepEqual(advanceMessageMotion(tracker,'chat',['duplicate','__proto__'],true),[]);
  assert.deepEqual([...tracker.seen],['duplicate','__proto__']);
});

test('long-lived conversations have a bounded budget and fail static instead of evicting IDs that could replay',()=>{
  const tracker=createMessageMotionTracker();
  advanceMessageMotion(tracker,'chat',[],true);
  for(let i=0;i<MESSAGE_MOTION_ID_LIMIT;i++)assert.deepEqual(advanceMessageMotion(tracker,'chat',[String(i)],true),[String(i)]);
  assert.equal(tracker.seen.size,MESSAGE_MOTION_ID_LIMIT);
  assert.deepEqual(advanceMessageMotion(tracker,'chat',['over-budget'],true),[]);
  assert.equal(tracker.seen.size,0);assert.equal(tracker.saturated,true);
  assert.deepEqual(advanceMessageMotion(tracker,'chat',['0','anything-new'],true),[]);
  assert.deepEqual(advanceMessageMotion(tracker,'next-chat',['loaded'],true),[]);
  assert.equal(tracker.saturated,false);assert.deepEqual([...tracker.seen],['loaded']);
  assert.deepEqual(advanceMessageMotion(tracker,'next-chat',['loaded','new'],true),['new']);
});

function fixture(){
  class CountedTarget extends EventTarget{
    listeners=new Map();
    addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);super.addEventListener(type,handler);}
    removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);super.removeEventListener(type,handler);}
    listenerCount(){return [...this.listeners.values()].reduce((sum,items)=>sum+items.size,0);}
  }
  const document=new CountedTarget(),window=new CountedTarget(),list=new CountedTarget();
  document.defaultView=window;
  document.visibilityState='visible';document.documentElement={dataset:{uiMotion:'full'}};list.children=[];
  function row(id){const classes=new Set(['message']);const element={dataset:{messageId:id},parentElement:list,setAttribute(name,value){assert.equal(name,'data-ui-enter');this.dataset.uiEnter=value;},removeAttribute(name){assert.equal(name,'data-ui-enter');delete this.dataset.uiEnter;},classList:{add(name){classes.add(name);},remove(name){classes.delete(name);},contains(name){return classes.has(name);}}};list.children.push(element);return element;}
  function animation(type,target,name='ui-message-enter'){const event=new Event(type);Object.defineProperties(event,{target:{value:target},animationName:{value:name}});list.dispatchEvent(event);}
  function policy(motion='full',visibility='visible'){document.documentElement.dataset.uiMotion=motion;document.visibilityState=visibility;if(visibility==='hidden')document.dispatchEvent(new Event('visibilitychange'));else window.dispatchEvent(new Event('petpal:ui-motion-change'));}
  return{document,window,list,row,animation,policy};
}

test('motion policy requires visible document and explicit full motion; unknown defaults stay static',()=>{
  const f=fixture();assert.equal(canAnimateMessageMotion(f.document),true);
  for(const mode of ['reduced','off','unknown',undefined]){f.document.documentElement.dataset.uiMotion=mode;assert.equal(canAnimateMessageMotion(f.document),false);}
  f.document.documentElement.dataset.uiMotion='full';f.document.visibilityState='hidden';assert.equal(canAnimateMessageMotion(f.document),false);
});

test('one delegated lifecycle marks only arriving direct rows, then releases their animation on completion',()=>{
  const f=fixture(),history=f.row('old'),added=f.row('new'),motion=attachMessageMotion(f.list,f.document);
  motion.enter(['new']);assert.equal(history.classList.contains('ui-message-enter'),false);assert.equal(history.dataset.uiEnter,undefined);assert.equal(added.classList.contains('ui-message-enter'),true);assert.equal(added.dataset.uiEnter,'true');
  f.animation('animationend',{parentElement:added,classList:{remove(){assert.fail('nested Markdown node must not be touched');}}});
  assert.equal(added.classList.contains('ui-message-enter'),true);
  f.animation('animationend',added,'another-animation');assert.equal(added.classList.contains('ui-message-enter'),true);
  assert.equal(added.dataset.uiEnter,'true');
  f.animation('animationend',added);assert.equal(added.classList.contains('ui-message-enter'),false);assert.equal(added.dataset.uiEnter,undefined);
  motion.dispose();assert.equal(f.list.listenerCount(),0);assert.equal(f.document.listenerCount(),0);assert.equal(f.window.listenerCount(),0);
});

test('policy switches and visibility immediately cancel in-flight entrance so returning to full cannot replay it',()=>{
  for(const [mode,visibility]of[['full','hidden'],['reduced','visible'],['off','visible']]){
    const f=fixture(),row=f.row('new'),motion=attachMessageMotion(f.list,f.document);
    motion.enter(['new']);assert.equal(row.classList.contains('ui-message-enter'),true);
    f.policy(mode,visibility);assert.equal(row.classList.contains('ui-message-enter'),false);assert.equal(row.dataset.uiEnter,undefined);
    motion.enter(['new']);assert.equal(row.classList.contains('ui-message-enter'),false);
    f.policy('full','visible');assert.equal(row.classList.contains('ui-message-enter'),false);
    motion.dispose();
  }
});

test('native animation cancellation clears the class even before a preference-change notification',()=>{
  const f=fixture(),row=f.row('new'),motion=attachMessageMotion(f.list,f.document);
  motion.enter(['new']);f.animation('animationcancel',row);assert.equal(row.classList.contains('ui-message-enter'),false);assert.equal(row.dataset.uiEnter,undefined);motion.dispose();
});

test('StrictMode-style setup, cleanup, setup retains consumption, removes listeners and schedules no extra work',()=>{
  const f=fixture(),row=f.row('new'),tracker=createMessageMotionTracker();
  advanceMessageMotion(tracker,'chat',[],true);
  const first=attachMessageMotion(f.list,f.document);
  first.enter(advanceMessageMotion(tracker,'chat',['new'],true));assert.equal(row.classList.contains('ui-message-enter'),true);
  first.dispose();first.dispose();assert.equal(row.classList.contains('ui-message-enter'),false);assert.equal(row.dataset.uiEnter,undefined);
  assert.equal(f.document.listenerCount(),0);assert.equal(f.list.listenerCount(),0);assert.equal(f.window.listenerCount(),0);
  const second=attachMessageMotion(f.list,f.document);
  second.enter(advanceMessageMotion(tracker,'chat',['new'],true));assert.equal(row.classList.contains('ui-message-enter'),false);
  assert.equal(f.list.listenerCount(),2);assert.equal(f.document.listenerCount(),1);assert.equal(f.window.listenerCount(),1);
  second.dispose();first.enter(['new']);assert.equal(row.classList.contains('ui-message-enter'),false);
  assert.equal(f.document.listenerCount(),0);assert.equal(f.list.listenerCount(),0);assert.equal(f.window.listenerCount(),0);
});

test('arrival and cancellation lifecycle needs no timer, animation frame or observer',()=>{
  const timer=globalThis.setTimeout,interval=globalThis.setInterval,frame=globalThis.requestAnimationFrame,observer=globalThis.MutationObserver;
  const unexpected=()=>assert.fail('message entrance must not schedule work');
  try{
    globalThis.setTimeout=unexpected;globalThis.setInterval=unexpected;globalThis.requestAnimationFrame=unexpected;globalThis.MutationObserver=unexpected;
    const f=fixture(),row=f.row('new'),tracker=createMessageMotionTracker(),motion=attachMessageMotion(f.list,f.document);
    advanceMessageMotion(tracker,'chat',[],true);
    motion.enter(advanceMessageMotion(tracker,'chat',['new'],true));assert.equal(row.classList.contains('ui-message-enter'),true);
    f.policy('off');assert.equal(row.classList.contains('ui-message-enter'),false);motion.dispose();
  }finally{
    globalThis.setTimeout=timer;globalThis.setInterval=interval;
    if(frame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=frame;
    if(observer===undefined)delete globalThis.MutationObserver;else globalThis.MutationObserver=observer;
  }
});
