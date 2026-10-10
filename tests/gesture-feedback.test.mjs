import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionFeedback } from '../src/pet/gesture-feedback.mjs';

function fixture(t, reduced = false) {
  const timers = new Map(); let sequence = 0;
  const doc = {hidden:false,createElement:()=>({dataset:{},style:{},attributes:{},isConnected:false,setAttribute(name,value){this.attributes[name]=value;},remove(){this.isConnected=false;container.children=container.children.filter(child=>child!==this);}})};
  const container = {ownerDocument:doc,children:[],appendChild(element){this.children.push(element);element.isConnected=true;},getBoundingClientRect:()=>({left:10,top:20,width:240,height:360})};
  const listeners = new Set();
  const motionQuery = {matches:reduced,addEventListener(type,fn){assert.equal(type,'change');listeners.add(fn);},removeEventListener(type,fn){assert.equal(type,'change');listeners.delete(fn);}};
  const feedback = createCompanionFeedback(container,{motionQuery,schedule:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,delay});return id;},unschedule:id=>timers.delete(id)});
  t.after(()=>feedback.dispose());
  const element=container.children[0], surface={}, other={};
  const update=(value={},target=surface)=>feedback.update({phase:'hover',x:100,y:140,pointerType:'mouse',hit:true,...value},target);
  const changeMotion=matches=>{motionQuery.matches=matches;for(const listener of listeners)listener();};
  return {feedback,container,doc,element,surface,other,update,timers,listeners,changeMotion};
}

test('one decorative hand follows the contact point and mirrors away from the right edge', t => {
  const f=fixture(t); assert.equal(f.container.children.length,1); assert.equal(f.element.hidden,true);
  assert.equal(f.element.attributes['aria-hidden'],'true'); assert.equal(f.element.attributes.role,'presentation');
  assert.equal(f.update(),true); assert.equal(f.element.style.transform,'translate3d(90px,120px,0)'); assert.equal(f.element.dataset.side,'right');
  assert.equal(f.element.dataset.vertical,'above');
  f.update({x:230}); assert.equal(f.element.dataset.side,'left'); assert.equal(f.element.style.transform,'translate3d(220px,120px,0)');
  f.update({x:230,y:40}); assert.equal(f.element.dataset.side,'left'); assert.equal(f.element.dataset.vertical,'below'); assert.equal(f.element.style.transform,'translate3d(220px,20px,0)');
  assert.equal(f.container.children.length,1);
});

test('one feedback element switches regional styling and cancellation removes stale region state', t => {
  const f=fixture(t);
  for(const region of ['head','hand','body']){
    assert.equal(f.update({region}),true);assert.equal(f.element.dataset.region,region);assert.equal(f.container.children.length,1);
  }
  f.update({phase:'cancel'});assert.equal(f.element.dataset.region,undefined);assert.equal(f.element.hidden,true);
  f.update();assert.equal(f.element.dataset.region,'default');
});

test('a motionless stroke becomes static after 220 ms and render refreshes cannot restart it', t => {
  const f=fixture(t); f.update({phase:'press'}); f.update({phase:'stroke',x:120});
  assert.equal(f.element.dataset.phase,'stroke'); const [id,timer]=[...f.timers][0]; assert.equal(timer.delay,220);
  for(let frame=0;frame<20;frame++)f.update({phase:'stroke',x:120});
  assert.equal(f.timers.size,1); assert.equal(f.timers.get(id),timer);
  f.timers.delete(id); timer.fn(); assert.equal(f.element.dataset.phase,'press');
  for(let frame=0;frame<20;frame++)f.update({phase:'stroke',x:120});
  assert.equal(f.element.dataset.phase,'press'); assert.equal(f.timers.size,0);
  f.update({phase:'stroke',x:125}); assert.equal(f.element.dataset.phase,'stroke'); assert.equal(f.timers.size,1);
  f.update({phase:'release'}); assert.equal(f.element.dataset.phase,'hover'); assert.equal(f.timers.size,0);
});

test('only actual motion renews a stroke timer; reduce, cancel and disposal cancel it', t => {
  const f=fixture(t); f.update({phase:'stroke'}); const original=[...f.timers.keys()][0];
  f.update({phase:'stroke',y:144}); assert.equal(f.timers.has(original),false); assert.equal(f.timers.size,1);
  f.changeMotion(true); assert.equal(f.timers.size,0); assert.equal(f.element.dataset.phase,'press');
  f.changeMotion(false); f.update({phase:'stroke',y:144}); assert.equal(f.element.dataset.phase,'press'); assert.equal(f.timers.size,0);
  f.update({phase:'stroke',y:146}); assert.equal(f.element.dataset.phase,'stroke'); f.update({phase:'cancel'}); assert.equal(f.timers.size,0);
  f.update({phase:'stroke'}); f.feedback.dispose(); assert.equal(f.timers.size,0); assert.equal(f.element.hidden,true);
});

test('empty space, nonfinite coordinates, keyboard and hidden documents cannot display a hand', t => {
  const f=fixture(t);
  for(const value of [{hit:false},{x:NaN},{y:Infinity},{x:9},{y:500},{pointerType:'keyboard'}]){
    f.update(); assert.equal(f.update(value),false); assert.equal(f.element.hidden,true);
  }
  f.doc.hidden=true; assert.equal(f.update(),false); f.doc.hidden=false;
  assert.equal(f.update({pointerType:'touch'}),false); assert.equal(f.element.hidden,true);
  f.element.isConnected=false; assert.equal(f.update(),false);
});

test('touch release fades briefly, new contact cancels its timer, and mouse release stays a hover', t => {
  const f=fixture(t); f.update({phase:'press',pointerType:'touch'});
  assert.equal(f.update({phase:'release',pointerType:'touch'}),true); assert.equal(f.element.dataset.phase,'release');
  assert.equal(f.timers.size,1); const [id,timer]=[...f.timers][0]; assert.equal(timer.delay,190);
  f.timers.delete(id);timer.fn(); assert.equal(f.element.hidden,true);
  assert.equal(f.update({phase:'release',pointerType:'touch'}),false); assert.equal(f.timers.size,0);
  f.update({phase:'press',pointerType:'pen'}); f.update({phase:'release',pointerType:'pen'}); assert.equal(f.timers.size,1);
  f.update({phase:'press',pointerType:'touch'}); assert.equal(f.timers.size,0); assert.equal(f.element.dataset.phase,'press');
  f.update({phase:'release'}); assert.equal(f.element.dataset.phase,'hover'); assert.equal(f.timers.size,0); assert.equal(f.element.hidden,false);
});

test('fallback surface owns its hand and stale canvas cancellation cannot hide it', t => {
  const f=fixture(t); f.update({phase:'press'});
  f.update({phase:'hover',x:120},f.other); assert.equal(f.element.hidden,false);
  f.update({phase:'cancel'},f.surface); assert.equal(f.element.hidden,false);
  f.update({hit:false},f.surface); assert.equal(f.element.hidden,false);
  f.update({phase:'cancel'},f.other); assert.equal(f.element.hidden,true);
});

test('reduced motion is static and changing the preference cancels a pending release fade', t => {
  const f=fixture(t,true); f.update({phase:'stroke',pointerType:'touch'});
  assert.equal(f.element.dataset.reducedMotion,'true'); assert.equal(f.element.hidden,false);
  assert.equal(f.update({phase:'release',pointerType:'touch'}),false); assert.equal(f.timers.size,0);
  f.changeMotion(false); f.update({phase:'press',pointerType:'touch'}); f.update({phase:'release',pointerType:'touch'}); assert.equal(f.timers.size,1);
  f.changeMotion(true); assert.equal(f.element.hidden,true); assert.equal(f.timers.size,0);
  f.update({phase:'hover'}); f.changeMotion(false); assert.equal(f.element.hidden,false); assert.equal(f.element.dataset.reducedMotion,'false');
});

test('disposal removes the decorative element, media listener and pending timer and cannot revive it', t => {
  const f=fixture(t); f.update({phase:'press',pointerType:'touch'}); f.update({phase:'release',pointerType:'touch'});
  const timer=[...f.timers.values()][0]; assert.equal(f.listeners.size,1);
  f.feedback.dispose(); f.feedback.dispose(); assert.equal(f.listeners.size,0); assert.equal(f.timers.size,0); assert.equal(f.container.children.length,0);
  timer.fn(); assert.equal(f.update(),false); assert.equal(f.element.hidden,true); assert.equal(f.element.isConnected,false);
});

test('stationary render refreshes avoid all feedback writes but still track current container geometry', t => {
  const f=fixture(t);let writes=0,reads=0,rect={left:10,top:20,width:240,height:360};
  for(const name of ['dataset','style'])f.element[name]=new Proxy(f.element[name],{set(target,key,value){writes++;target[key]=value;return true;}});
  let hidden=f.element.hidden;Object.defineProperty(f.element,'hidden',{get:()=>hidden,set:value=>{writes++;hidden=value;}});
  f.container.getBoundingClientRect=()=>{reads++;return rect;};
  f.update({region:'head'});writes=reads=0;
  for(let frame=0;frame<300;frame++)assert.equal(f.update({region:'head'}),true);
  assert.equal(writes,0);assert.equal(reads,300);
  rect={...rect,left:30,top:40};f.update({region:'head'});
  assert.equal(f.element.style.transform,'translate3d(70px,100px,0)');assert.equal(writes,1);
  rect={...rect,left:101};assert.equal(f.update({region:'head'}),false);assert.equal(f.element.hidden,true);
});

test('browser transform serialization cannot turn a stationary refresh into another style write', t => {
  const f=fixture(t);let writes=0,serialized='';
  Object.defineProperty(f.element.style,'transform',{get:()=>serialized,set:value=>{writes++;serialized=value.replace(/,/g,', ').replace(', 0)',', 0px)');}});
  f.update();assert.equal(serialized,'translate3d(90px, 120px, 0px)');
  for(let frame=0;frame<30;frame++)f.update();assert.equal(writes,1);
  f.update({x:120});assert.equal(writes,2);
});
