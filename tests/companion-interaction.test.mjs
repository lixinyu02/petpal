import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionGestures, bindCompanionGestures, portraitCoordinates, cubismPortraitCoordinates, portraitContains, portraitRegion } from '../src/pet/interaction.mjs';

function fixture(initialAction = 'idle') {
  let time = 0, sequence = 0, action = initialAction;
  const timers = new Map(), emitted = [], feedback = [], contexts = [];
  const gestures = createCompanionGestures({
    now: () => time, getAction: () => action,
    emit: (next, context) => { emitted.push(next); contexts.push(context); action = next === 'wake' ? 'idle' : next; },
    onFeedback: next => feedback.push(next),
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
  return {gestures,advance,point,tap,emitted,timers,feedback,contexts};
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

test('reference head and joined-hand regions follow portrait coordinates on desktop and 412px screens', () => {
  assert.equal(portraitRegion({x:.5,y:.16}),'head');
  assert.equal(portraitRegion({x:.5,y:.89}),'hand');
  assert.equal(portraitRegion({x:.72,y:.85}),'body');
  assert.equal(portraitRegion({x:.5,y:.6}),'body');
  assert.equal(portraitRegion({x:.02,y:.16}),null);
  for(const rect of [{left:15,top:35,width:900,height:450},{left:0,top:0,width:412,height:620}]){
    const portraitWidth=rect.height/Math.max(1.64,1.04/(rect.width/rect.height));
    for(const [y,region] of [[.16,'head'],[.6,'body'],[.89,'hand']]){
      const point=portraitCoordinates(rect,rect.left+rect.width/2,rect.top+rect.height/2+(y-.5)*portraitWidth*1.5);
      assert.equal(portraitRegion(point),region);
    }
  }
});

test('Cubism hotspot fit matches its real width and height contain limits, including transformed canvas rects', () => {
  for(const rect of [{left:0,top:0,width:412,height:960},{left:20,top:70,width:900,height:450},{left:8,top:41,width:386,height:575}]){
    const fitWidth=Math.min(rect.width*.92,rect.height/1.5*.96);
    for(const expected of [{x:.5,y:.16,region:'head'},{x:.5,y:.6,region:'body'},{x:.5,y:.89,region:'hand'}]){
      const point=cubismPortraitCoordinates(rect,rect.left+rect.width/2+(expected.x-.5)*fitWidth,rect.top+rect.height/2+(expected.y-.5)*fitWidth*1.5);
      assert.ok(Math.abs(point.x-expected.x)<1e-12);assert.ok(Math.abs(point.y-expected.y)<1e-12);
      assert.equal(portraitRegion(point),expected.region);
    }
    assert.equal(portraitContains(cubismPortraitCoordinates(rect,rect.left+1,rect.top+1)),false);
  }
});

test('head hover dwells once, moving strokes are cooled down, and leave cancels a pending dwell', () => {
  const f=fixture(), point=f.point({region:'head'});
  f.gestures.move(point);f.advance(649);assert.deepEqual(f.emitted,[]);
  f.advance(1);assert.deepEqual(f.contexts,[{region:'head',source:'hover'}]);
  f.advance(2000);f.gestures.move(point);assert.equal(f.emitted.length,1,'stationary hover is not an animation loop');
  f.gestures.move({...point,x:58});assert.equal(f.emitted.length,2);
  f.gestures.move({...point,x:80});assert.equal(f.emitted.length,2,'one moving reaction per cooldown');
  f.gestures.leave();assert.equal(f.timers.size,0);
  const pending=fixture();pending.gestures.move(pending.point({region:'head'}));pending.advance(300);pending.gestures.leave();pending.advance(1000);assert.deepEqual(pending.emitted,[]);
});

test('hand hover has its own semantic cue while body, touch hover, sleep and legacy surfaces stay quiet', () => {
  const hand=fixture();hand.gestures.move(hand.point({region:'hand'}));hand.advance(900);
  assert.deepEqual(hand.contexts,[{region:'hand',source:'hover'}]);
  hand.advance(2000);hand.gestures.move(hand.point({region:'hand',x:90}));assert.equal(hand.emitted.length,1);
  for(const [initial,overrides] of [['idle',{region:'body'}],['idle',{region:'head',pointerType:'touch'}],['idle',{region:'head',buttons:1}],['idle',{region:'head',isPrimary:false}],['sleep',{region:'head'}],['idle',{}]]){
    const f=fixture(initial);f.gestures.move(f.point(overrides));f.advance(5000);assert.deepEqual(f.emitted,[]);
  }
});

test('moving from a reacted head to the hand waits out the shared cooldown instead of losing the dwell', () => {
  const f=fixture();f.gestures.move(f.point({region:'head'}));f.advance(650);
  f.gestures.move(f.point({region:'hand'}));f.advance(900);assert.equal(f.emitted.length,1);
  f.advance(699);assert.equal(f.emitted.length,1);f.advance(1);
  assert.deepEqual(f.contexts,[{region:'head',source:'hover'},{region:'hand',source:'hover'}]);
  assert.equal(f.timers.size,0);f.advance(5000);assert.equal(f.emitted.length,2);
});

test('mouse and touch taps keep hand/head metadata without changing old action contracts', () => {
  for(const pointerType of ['mouse','touch']){
    const f=fixture();f.tap({region:'hand',pointerType});f.advance(300);
    assert.deepEqual(f.emitted,['pet']);assert.deepEqual(f.contexts,[{region:'hand',source:'tap'}]);
    f.advance(100);f.tap({region:'hand',pointerType});f.advance(300);assert.equal(f.emitted.length,1,'rapid repeat is bounded');
    f.advance(900);f.tap({region:'head',pointerType});f.advance(300);assert.deepEqual(f.contexts.at(-1),{region:'head',source:'tap'});
  }
  const double=fixture();double.tap({region:'hand'});double.advance(100);double.tap({region:'hand'});double.advance(1000);assert.deepEqual(double.emitted,['jump']);
  const hold=fixture();hold.gestures.down(hold.point({region:'hand'}));hold.advance(700);hold.gestures.up(hold.point({region:'hand'}));hold.advance(1000);assert.deepEqual(hold.emitted,['sleep']);
});

test('crossing between body parts cannot release a tap or inherit a head hover timer', () => {
  const f=fixture();f.gestures.move(f.point({region:'head'}));f.advance(500);f.gestures.move(f.point({region:'hand'}));f.advance(649);assert.deepEqual(f.emitted,[]);
  f.gestures.cancel();f.gestures.down(f.point({region:'head'}));f.gestures.move(f.point({region:'body'}));f.gestures.up(f.point({region:'body'}));f.advance(1500);assert.deepEqual(f.emitted,[]);
  const scroll=fixture();scroll.gestures.down(scroll.point({region:'hand',pointerType:'touch'}));scroll.gestures.move(scroll.point({region:'hand',pointerType:'touch',y:60}));scroll.gestures.up(scroll.point({region:'hand',pointerType:'touch',y:60}));scroll.advance(1000);assert.deepEqual(scroll.emitted,[]);
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

test('contact feedback follows accepted gestures and never turns hover or keyboard into a hand press', () => {
  const f = fixture();
  assert.equal(f.gestures.move(f.point()), false); assert.deepEqual(f.feedback, []);
  f.gestures.down(f.point()); f.gestures.move(f.point({x:44})); f.gestures.move(f.point({x:60})); f.gestures.up(f.point({x:60}));
  assert.deepEqual(f.feedback.map(value => value.phase), ['press','press','stroke','release']);
  assert.equal(f.feedback.at(-1).x, 60);
  const keyboard = fixture(); keyboard.gestures.keyDown('Enter'); keyboard.gestures.keyUp('Enter'); keyboard.advance(400); keyboard.gestures.activate();
  assert.deepEqual(keyboard.feedback, []); assert.deepEqual(keyboard.emitted, ['pet','pet']);
});

test('scroll, multi-touch, hold, off-character release and cancellation remove contact feedback', () => {
  for (const mode of ['scroll','multi','hold','off','cancel','leave']) {
    const f = fixture(); f.gestures.down(f.point({pointerType:'touch'}));
    if (mode === 'scroll') f.gestures.move(f.point({pointerType:'touch',y:55}));
    if (mode === 'multi') f.gestures.down(f.point({pointerType:'touch',id:2,isPrimary:false}));
    if (mode === 'hold') f.advance(700);
    if (mode === 'off') f.gestures.up(f.point({pointerType:'touch',hit:false}));
    if (mode === 'cancel' || mode === 'leave') f.gestures[mode]();
    assert.deepEqual(f.feedback.map(value => value.phase), ['press','cancel'], mode);
    f.gestures.up(f.point({pointerType:'touch'})); f.advance(1000);
    assert.equal(f.feedback.at(-1).phase, 'cancel', mode);
    assert.deepEqual(f.emitted, mode === 'hold' ? ['sleep'] : [], mode);
  }
});

function domFixture(t, options = {}) {
  const prior = new Map(['window','document'].map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const win = new EventTarget(), doc = new EventTarget(); doc.hidden = false;
  Object.defineProperty(globalThis,'window',{configurable:true,value:win}); Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
  const surface = new EventTarget(); surface.style = {cursor:'auto'}; surface.contains = target => target === surface;
  const emitted = [], feedback = []; let available = true, enabled = true, hit = true;
  const unbind = bindCompanionGestures(surface, {
    hitTest:() => hit, emit:action => emitted.push(action), getAction:() => 'idle', enabled:() => enabled,
    onFeedback:value => {feedback.push(value); return available;}, ...options,
  });
  t.after(() => {
    unbind();
    for (const [name,descriptor] of prior) { if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]; }
  });
  const dispatch = (type, properties = {}, target = surface) => {
    const event = new Event(type,{cancelable:true});
    Object.assign(event,{pointerId:1,clientX:40,clientY:40,pointerType:'mouse',button:0,isPrimary:true,...properties});
    target.dispatchEvent(event); return event;
  };
  return {surface,win,doc,emitted,feedback,unbind,dispatch,setAvailable:value=>available=value,setEnabled:value=>enabled=value,setHit:value=>hit=value};
}

test('joint hit sampling is fresh for each operation and stable refreshes do not rewrite the cursor', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let reads=0,writes=0,region='head';
  const f=domFixture(t,{hitTest:()=>{throw new Error('joint sampling must replace separate hit tests');},regionAt:()=>{throw new Error('joint sampling must replace separate region tests');},pointAt:()=>{reads++;return {hit:true,region};}});
  f.surface.style=new Proxy(f.surface.style,{set(target,key,value){writes++;target[key]=value;return true;}});
  f.dispatch('pointermove');assert.equal(reads,1);assert.equal(writes,1);reads=writes=0;
  for(let frame=0;frame<300;frame++)f.unbind.refresh();
  assert.equal(reads,300);assert.equal(writes,0);
  region='body';f.unbind.refresh();assert.equal(f.feedback.at(-1).phase,'cancel');assert.equal(writes,1);
  t.mock.timers.tick(1000);assert.deepEqual(f.emitted,[]);
  f.dispatch('contextmenu');assert.equal(reads,302);
});

test('joint sampling rechecks delayed gestures without a render and normalizes optional regions', t => {
  t.mock.timers.enable({apis:['setTimeout']});let region='head',hit=true;
  const f=domFixture(t,{pointAt:()=>({hit,region})});
  for(const mode of ['hover','hold','tap']){
    region='head';hit=true;
    if(mode==='hover')f.dispatch('pointermove');else{f.dispatch('pointerdown');if(mode==='tap')f.dispatch('pointerup',{},f.win);}
    region='hand';t.mock.timers.tick(1000);
    assert.deepEqual(f.emitted,[],mode);assert.equal(f.feedback.at(-1).phase,'cancel');
    f.dispatch('pointercancel',{},f.win);
  }
  region=null;f.dispatch('pointerdown');f.dispatch('pointerup',{},f.win);t.mock.timers.tick(300);
  assert.deepEqual(f.emitted,['pet']);
  f.dispatch('pointermove');hit=false;f.unbind.refresh();assert.equal(f.feedback.at(-1).phase,'cancel');
});

test('mouse hover changes the cursor only over the character and only hides it with visible feedback', t => {
  const f = domFixture(t); f.setHit(false); const emptyMove = f.dispatch('pointermove');
  assert.equal(emptyMove.defaultPrevented,false); assert.equal(f.surface.style.cursor,'default'); assert.equal(f.feedback.at(-1).phase,'cancel');
  f.setHit(true); f.dispatch('pointermove'); assert.equal(f.surface.style.cursor,'none'); assert.equal(f.feedback.at(-1).phase,'hover');
  f.setAvailable(false); f.dispatch('pointermove'); assert.equal(f.surface.style.cursor,'pointer');
  f.dispatch('pointerleave'); assert.equal(f.surface.style.cursor,'default'); assert.deepEqual(f.emitted,[]);
  f.unbind(); assert.equal(f.surface.style.cursor,'auto');
});

test('animation refresh clears moved-away or inactive surfaces without starting another animation loop', t => {
  const f = domFixture(t); f.dispatch('pointermove'); f.unbind.refresh(); assert.equal(f.feedback.at(-1).phase,'hover');
  f.setHit(false); f.unbind.refresh(); assert.equal(f.feedback.at(-1).phase,'cancel'); assert.equal(f.surface.style.cursor,'default');
  const count = f.feedback.length; f.unbind.refresh(); assert.equal(f.feedback.length,count);
  f.setHit(true); f.dispatch('pointermove'); f.setEnabled(false); f.unbind.refresh();
  assert.equal(f.feedback.at(-1).phase,'cancel'); assert.equal(f.surface.style.cursor,'default');
  f.unbind(); const disposedCount=f.feedback.length; f.unbind.refresh(); assert.equal(f.feedback.length,disposedCount);
});

test('refresh cancels a stationary pointer dwell and hold when layout changes its region', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let region = 'head';
  const f = domFixture(t, {regionAt:() => region});
  f.dispatch('pointermove');
  t.mock.timers.tick(400);
  region = 'body'; f.unbind.refresh();
  t.mock.timers.tick(1000);
  assert.deepEqual(f.emitted, [], 'the old head dwell must not react over the body');
  assert.equal(f.feedback.at(-1).phase, 'cancel'); assert.equal(f.surface.style.cursor, 'default');

  for (const pointerType of ['mouse','touch']) {
    region = 'hand'; f.dispatch('pointerdown', {pointerType});
    t.mock.timers.tick(400);
    region = 'body'; f.unbind.refresh();
    t.mock.timers.tick(1000);
    f.dispatch('pointerup', {pointerType}, f.win);
    t.mock.timers.tick(400);
    assert.deepEqual(f.emitted, [], `${pointerType} cannot rest or tap after its held region moves`);
    assert.equal(f.feedback.at(-1).phase, 'cancel');
  }
});

for (const change of ['region','outside','disabled']) test(`delayed hover, hold and tap validate ${change} geometry even without render refresh`, t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let region = 'head';
  const f = domFixture(t, {regionAt:() => region});
  const reset = () => { region = 'head'; f.setHit(true); f.setEnabled(true); };
  const invalidate = () => {
    if (change === 'region') region = 'body';
    else if (change === 'outside') f.setHit(false);
    else f.setEnabled(false);
  };
  for (const hoveredRegion of ['head','hand']) {
    reset(); region = hoveredRegion; f.dispatch('pointermove');
    t.mock.timers.tick(200); invalidate(); t.mock.timers.tick(900);
    assert.deepEqual(f.emitted, [], `${hoveredRegion} dwell must recheck the current portrait`);
    assert.equal(f.feedback.at(-1).phase, 'cancel'); assert.equal(f.surface.style.cursor, 'default');
  }
  for (const pointerType of ['mouse','touch']) {
    reset(); f.dispatch('pointerdown', {pointerType});
    t.mock.timers.tick(200); invalidate(); t.mock.timers.tick(700);
    f.dispatch('pointerup', {pointerType}, f.win); t.mock.timers.tick(400);
    assert.deepEqual(f.emitted, [], `${pointerType} hold cannot rest or leave a queued tap`);
    assert.equal(f.feedback.at(-1).phase, 'cancel'); assert.equal(f.surface.style.cursor, 'default');

    reset(); f.dispatch('pointerdown', {pointerType}); f.dispatch('pointerup', {pointerType}, f.win);
    invalidate(); t.mock.timers.tick(300);
    assert.deepEqual(f.emitted, [], `${pointerType} delayed tap cannot target stale geometry`);
    assert.equal(f.feedback.at(-1).phase, 'cancel');
  }
});

test('timer-time geometry checks preserve enabled keyboard and semantic activation', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f = domFixture(t, {regionAt:() => null}); f.setHit(false);
  f.dispatch('keydown', {key:'Enter'}); f.dispatch('keyup', {key:'Enter'}); t.mock.timers.tick(300);
  assert.deepEqual(f.emitted, ['pet']);
  f.dispatch('keydown', {key:' '}); t.mock.timers.tick(700); f.dispatch('keyup', {key:' '});
  f.dispatch('click', {detail:0});
  assert.deepEqual(f.emitted, ['pet','sleep','pet']);
  f.setEnabled(false); f.dispatch('click', {detail:0});
  assert.equal(f.emitted.length, 3);
});

test('touch release survives the browser pointerleave but blur, hidden and pointercancel still clear it', t => {
  const f = domFixture(t);
  for (const type of ['blur','pointercancel','visibilitychange']) {
    f.doc.hidden=false;
    const down=f.dispatch('pointerdown',{pointerType:'touch'}), up=f.dispatch('pointerup',{pointerType:'touch'},f.win);
    f.dispatch('pointerleave',{pointerType:'touch'});
    assert.equal(f.feedback.at(-1).phase,'release',type); assert.equal(f.surface.style.cursor,'default');
    assert.equal(down.defaultPrevented,false); assert.equal(up.defaultPrevented,false);
    if (type === 'visibilitychange') {f.doc.hidden=true;f.dispatch(type,{},f.doc);} else f.dispatch(type,{},f.win);
    assert.equal(f.feedback.at(-1).phase,'cancel',type);
  }
});

test('vertical touch scrolling and blank-space presses do not trap input or leave a hand', t => {
  const f = domFixture(t); f.dispatch('pointerdown',{pointerType:'touch'});
  const move=f.dispatch('pointermove',{pointerType:'touch',clientY:60});
  assert.equal(move.defaultPrevented,false); assert.equal(f.feedback.at(-1).phase,'cancel');
  f.dispatch('pointerup',{pointerType:'touch'},f.win); assert.equal(f.feedback.at(-1).phase,'cancel');
  f.setHit(false); f.dispatch('pointerdown',{pointerType:'touch'}); f.dispatch('pointerup',{pointerType:'touch'},f.win);
  assert.equal(f.feedback.at(-1).phase,'cancel'); assert.deepEqual(f.emitted,[]);
});
