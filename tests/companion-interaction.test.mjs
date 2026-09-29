import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionGestures, bindCompanionGestures, portraitCoordinates, portraitContains } from '../src/pet/interaction.mjs';

function fixture(initialAction = 'idle') {
  let time = 0, sequence = 0, action = initialAction;
  const timers = new Map(), emitted = [];
  const gestures = createCompanionGestures({
    now: () => time, getAction: () => action,
    emit: next => { emitted.push(next); action = next === 'wake' ? 'idle' : next; },
    schedule: (callback, delay) => { const id = ++sequence; timers.set(id, {callback,at:time+delay}); return id; },
    unschedule: id => timers.delete(id),
  });
  const advance = duration => {
    const end = time + duration;
    while (true) {
      const next = [...timers].filter(([,timer]) => timer.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
      if (!next) break; time = next[1].at; timers.delete(next[0]); next[1].callback();
    }
    time = end;
  };
  const point = (overrides = {}) => ({id:1,x:40,y:40,pointerType:'mouse',hit:true,button:0,isPrimary:true,...overrides});
  const tap = overrides => { gestures.down(point(overrides)); advance(30); gestures.up(point(overrides)); };
  return {gestures,advance,point,tap,emitted,timers};
}

test('a single tap emits once, while a double tap produces only the greeting', () => {
  const one = fixture(); one.tap(); one.advance(299); assert.deepEqual(one.emitted, []); one.advance(1); assert.deepEqual(one.emitted, ['pet']);
  const two = fixture(); two.tap(); two.advance(100); two.tap(); two.advance(1000); assert.deepEqual(two.emitted, ['jump']);
});

test('a touch wakes a sleeping companion immediately and leaves no queued action', () => {
  const f = fixture('sleep'); f.tap({pointerType:'touch'}); assert.deepEqual(f.emitted,['wake']); f.advance(1000); assert.deepEqual(f.emitted,['wake']);
});

test('stationary long press rests once and release is not interpreted as a tap', () => {
  const f = fixture(); f.gestures.down(f.point()); f.advance(699); assert.deepEqual(f.emitted,[]);
  f.advance(1); assert.deepEqual(f.emitted,['sleep']); f.advance(900); f.gestures.up(f.point()); f.advance(1000); assert.deepEqual(f.emitted,['sleep']);
});

test('mouse strokes are throttled and cannot trigger a long press or release tap', () => {
  const f = fixture(); f.gestures.down(f.point()); f.advance(80); f.gestures.move(f.point({x:60}));
  f.advance(500); f.gestures.move(f.point({x:70})); assert.deepEqual(f.emitted,['pet']);
  f.advance(300); f.gestures.move(f.point({x:45})); f.gestures.move(f.point({x:75}));
  f.gestures.up(f.point({x:75})); f.advance(1000); assert.deepEqual(f.emitted,['pet','pet']);
});

test('vertical touch movement, pointer cancellation and leaving never rest or tap', () => {
  for (const cancel of ['scroll','cancel','leave']) {
    const f = fixture(); f.gestures.down(f.point({pointerType:'touch'})); f.advance(100);
    if(cancel === 'scroll') f.gestures.move(f.point({pointerType:'touch',y:62})); else f.gestures[cancel]();
    f.advance(1000); f.gestures.up(f.point({pointerType:'touch',y:62})); f.advance(1000); assert.deepEqual(f.emitted,[],cancel);
  }
});

test('horizontal touch can gently stroke while an off-character release is ignored', () => {
  const f = fixture(); f.gestures.down(f.point({pointerType:'touch'})); f.gestures.move(f.point({pointerType:'touch',x:65,y:43})); f.gestures.up(f.point({pointerType:'touch',x:65,y:43})); f.advance(1000); assert.deepEqual(f.emitted,['pet']);
  const off = fixture(); off.gestures.down(off.point()); off.gestures.up(off.point({hit:false})); off.advance(1000); assert.deepEqual(off.emitted,[]);
});

test('empty stage, secondary mouse buttons and multi-touch do not produce gestures', () => {
  for (const overrides of [{hit:false},{button:2},{isPrimary:false,pointerType:'touch'}]) {
    const f = fixture(); f.tap(overrides); f.advance(1000); assert.deepEqual(f.emitted,[]);
  }
  const multi = fixture(); multi.gestures.down(multi.point({pointerType:'touch'})); multi.advance(100);
  multi.gestures.down(multi.point({pointerType:'touch',id:2,isPrimary:false})); multi.advance(1000);
  multi.gestures.up(multi.point({pointerType:'touch',id:2})); multi.gestures.up(multi.point({pointerType:'touch'})); multi.advance(1000); assert.deepEqual(multi.emitted,[]);
  multi.tap(); multi.advance(400); assert.deepEqual(multi.emitted,['pet']);
});

test('blur or cancellation also cancels a delayed single tap', () => {
  const f = fixture(); f.tap(); f.gestures.cancel(); f.advance(2000); assert.deepEqual(f.emitted,[]); assert.equal(f.timers.size,0);
});

test('keyboard activation, held key and assistive click provide equivalents without repeats', () => {
  const f = fixture(); f.gestures.keyDown('Enter'); f.gestures.keyDown('Enter',true); f.gestures.keyUp('Enter'); f.advance(400); assert.deepEqual(f.emitted,['pet']);
  f.gestures.keyDown(' '); f.advance(710); f.gestures.keyUp(' '); f.advance(400); assert.deepEqual(f.emitted,['pet','sleep']);
  f.gestures.activate(); assert.deepEqual(f.emitted,['pet','sleep','wake']);
  f.gestures.keyDown('Escape'); f.gestures.keyUp('Escape'); f.advance(1000); assert.equal(f.emitted.length,3);
});

test('wide and narrow layouts hit the same portrait and exclude transparent margins', () => {
  for (const rect of [{left:10,top:20,width:900,height:450},{left:0,top:0,width:280,height:410}]) {
    const center = portraitCoordinates(rect,rect.left+rect.width/2,rect.top+rect.height/2);
    assert.deepEqual(center,{x:.5,y:.5}); assert.equal(portraitContains(center),true);
    assert.equal(portraitContains(portraitCoordinates(rect,rect.left+1,rect.top+1)),false);
  }
  assert.equal(portraitContains({x:.5,y:.25}),true); assert.equal(portraitContains({x:.03,y:.2}),false);
  const data = new Uint8ClampedArray(16); data[3]=255;
  assert.equal(portraitContains({x:.4,y:.25},{width:2,height:2,data}),true);
  assert.equal(portraitContains({x:.6,y:.25},{width:2,height:2,data}),false);
});

test('DOM binding cleans up global listeners and disabled surfaces ignore assistive clicks', t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis,'window'), previousDocument = Object.getOwnPropertyDescriptor(globalThis,'document');
  const win = new EventTarget(), doc = new EventTarget(); doc.hidden = false;
  Object.defineProperty(globalThis,'window',{configurable:true,value:win}); Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
  t.after(() => { if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete globalThis.window; if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);else delete globalThis.document; });
  const surface = new EventTarget(); surface.style = {}; surface.contains = target => target === surface;
  let enabled = false, leaves = 0; const emitted = [];
  const unbind = bindCompanionGestures(surface,{hitTest:()=>true,emit:action=>emitted.push(action),getAction:()=> 'idle',enabled:()=>enabled,onLeave:()=>leaves++});
  const click = () => { const event = new Event('click'); Object.defineProperty(event,'detail',{value:0}); surface.dispatchEvent(event); };
  click(); assert.deepEqual(emitted,[]); enabled = true; click(); assert.deepEqual(emitted,['pet']);
  unbind(); const cleaned = leaves; click(); win.dispatchEvent(new Event('blur')); doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(emitted,['pet']); assert.equal(leaves,cleaned);
});
