import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompositionGuard,composerKeyAction} from '../src/composer-keyboard.mjs';
import {createComposerLayout} from '../src/composer-layout.mjs';

const enter=extra=>({key:'Enter',isComposing:false,keyCode:13,defaultPrevented:false,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,...extra});
function frames(){let id=0;const pending=new Map();return{pending,schedule:fn=>{pending.set(++id,fn);return id;},cancel:key=>pending.delete(key),flush(){const jobs=[...pending.values()];pending.clear();jobs.forEach(fn=>fn());}};}

test('IME locks cover native flags, a missing native flag and WebKit compositionend-before-Enter without a timed cooldown',()=>{
  const f=frames(),guard=createCompositionGuard(f);
  assert.equal(composerKeyAction(enter({isComposing:true})), 'none');
  assert.equal(composerKeyAction(enter({keyCode:229})), 'none');
  guard.start();
  for(const key of ['Enter','Escape','ArrowDown'])assert.equal(guard.blocks(enter({key})),true);
  assert.equal(composerKeyAction(enter(),{composition:guard}),'none');
  guard.end();assert.equal(f.pending.size,1);
  assert.equal(composerKeyAction(enter(),{composition:guard}),'none');
  guard.keyUp({key:'Enter'});assert.equal(f.pending.size,0);
  assert.equal(composerKeyAction(enter(),{composition:guard}),'send','the next deliberate Enter works immediately after keyup');
  guard.start();guard.end();f.flush();
  assert.equal(composerKeyAction(enter(),{composition:guard}),'send','pointer-committed text cannot leave a stale block');
  guard.start();guard.end();guard.reset();assert.equal(f.pending.size,0);
  assert.equal(composerKeyAction(enter(),{composition:guard}),'send','blur or scope change clears all IME state');
});

test('ordinary desktop, modifier and touch Enter semantics are unchanged after IME commits',()=>{
  const guard=createCompositionGuard(frames());
  for(const options of [{},{touch:true}]){
    assert.equal(composerKeyAction(enter({shiftKey:true}),{...options,composition:guard}),'newline');
    assert.equal(composerKeyAction(enter({altKey:true}),{...options,composition:guard}),'newline');
    assert.equal(composerKeyAction(enter({ctrlKey:true}),{...options,composition:guard}),'send');
    assert.equal(composerKeyAction(enter({metaKey:true}),{...options,composition:guard}),'send');
    assert.equal(composerKeyAction(enter({defaultPrevented:true}),{...options,composition:guard}),'none');
  }
  assert.equal(composerKeyAction(enter(),{composition:guard}),'send');
  assert.equal(composerKeyAction(enter(),{touch:true,composition:guard}),'newline');
});

function layoutFixture(){
  const f=frames(),window=new EventTarget(),viewport=new EventTarget(),fonts=new EventTarget(),observers=[];
  const state={content:24,width:300,areaHeight:620,controlHeight:80,chrome:52};
  Object.assign(window,{innerHeight:960,visualViewport:Object.assign(viewport,{height:960,offsetTop:0}),requestAnimationFrame:f.schedule,cancelAnimationFrame:f.cancel});
  const document={defaultView:window,fonts};
  const controls={getBoundingClientRect:()=>({height:state.controlHeight})};
  const area={getBoundingClientRect:()=>({top:64,bottom:64+state.areaHeight,height:state.areaHeight}),querySelector:()=>controls};
  const input={isConnected:true,ownerDocument:document,style:{height:'88px',overflowY:'scroll'},getBoundingClientRect:()=>({width:state.width,height:Math.max(44,Number.parseFloat(input.style.height)||44)}),closest:selector=>selector==='.chat-area'?area:composer,get scrollHeight(){return state.content+20;}};
  const composer={get scrollHeight(){return state.chrome+input.getBoundingClientRect().height;}};
  window.getComputedStyle=()=>({minHeight:'44px',maxHeight:'180px',paddingTop:'10px',paddingBottom:'10px',borderTopWidth:'1px',borderBottomWidth:'1px',boxSizing:'border-box'});
  class Observer{constructor(callback){this.callback=callback;this.targets=[];this.connected=true;observers.push(this);}observe(target){this.targets.push(target);}disconnect(){this.connected=false;}notify(target,width=state.width,height=44){this.callback([{target,contentRect:{width,height}}]);}}
  window.ResizeObserver=Observer;
  const mount=()=>createComposerLayout(input);
  return{...f,window,viewport,fonts,state,input,area,controls,composer,observers,mount};
}

test('composer grows, clamps and shrinks after pasted text or clearing a draft while coalescing repeated work',()=>{
  const f=layoutFixture(),layout=f.mount();
  assert.equal(f.input.style.height,'46px');
  f.state.content=420;layout.schedule();layout.schedule();f.window.dispatchEvent(new Event('resize'));
  assert.equal(f.pending.size,1);f.flush();
  assert.equal(f.input.style.height,'180px');assert.equal(f.input.style.overflowY,'auto');
  f.state.content=24;layout.schedule();f.flush();
  assert.equal(f.input.style.height,'46px');assert.equal(f.input.style.overflowY,'hidden');
  layout.dispose();assert.equal(f.input.style.height,'88px');assert.equal(f.input.style.overflowY,'scroll');
});

test('software-keyboard viewport and live chrome changes reserve reading space instead of expanding a long draft',()=>{
  const f=layoutFixture(),layout=f.mount();f.state.content=420;
  f.viewport.height=300;f.state.controlHeight=60;f.state.chrome=40;
  f.viewport.dispatchEvent(new Event('resize'));f.flush();
  assert.equal(f.input.style.height,'92px');assert.equal(f.input.style.overflowY,'auto');
  f.state.chrome=70;f.observers[0].notify(f.composer);f.flush();
  assert.equal(f.input.style.height,'62px');
  f.viewport.height=960;f.viewport.dispatchEvent(new Event('resize'));f.flush();
  assert.equal(f.input.style.height,'180px');layout.dispose();
});

test('ResizeObserver ignores own height-only feedback, width changes remeasure, and StrictMode-style remounts release all work',()=>{
  const f=layoutFixture(),first=f.mount(),observer=f.observers[0];
  observer.notify(f.input,300,46);f.flush();observer.notify(f.input,300,180);assert.equal(f.pending.size,0);
  observer.notify(f.input,260,180);assert.equal(f.pending.size,1);
  first.dispose();assert.equal(f.pending.size,0);assert.equal(observer.connected,false);
  f.window.dispatchEvent(new Event('resize'));f.viewport.dispatchEvent(new Event('scroll'));f.fonts.dispatchEvent(new Event('loadingdone'));assert.equal(f.pending.size,0);
  const second=f.mount();assert.equal(f.observers.at(-1).connected,true);
  second.schedule();second.dispose();second.dispose();assert.equal(f.pending.size,0);
  assert.equal(f.observers.every(item=>!item.connected),true);
  assert.equal(f.input.style.height,'88px');
});
