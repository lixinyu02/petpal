import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechPresentation,samePlaybackSemantics} from '../src/avatar/speech-presentation.mjs';

const initial={utteranceId:'fixture',text:'一段测试。',active:true,pending:false,charIndex:0,ended:false,progressBasis:'estimated',voiceName:'fixture',error:'',audioLevel:0,buffering:false,streaming:true,emotion:null};

test('snapshot remains cached and duplicate audio frames do not notify subscribers',()=>{
  const store=createSpeechPresentation(initial),before=store.source.snapshot();let deliveries=0;
  const unsubscribe=store.source.subscribe(()=>deliveries++);
  assert.equal(store.source.snapshot(),before);
  assert.equal(store.publish({...initial}),before);assert.equal(deliveries,0);
  const next=store.publish({...initial,charIndex:2,audioLevel:.8});assert.notEqual(next,before);assert.equal(deliveries,1);
  assert.equal(store.source.snapshot(),next);store.publish({...next});assert.equal(deliveries,1);
  unsubscribe();unsubscribe();store.publish({...next,audioLevel:.3});assert.equal(deliveries,1);
});

test('immutable snapshots own their emotion metadata and equivalent metadata does not notify',()=>{
  const store=createSpeechPresentation(initial);let deliveries=0;store.source.subscribe(()=>deliveries++);
  const emotion={emotion:'happy',intensity:'natural',source:'rules'},frame={...initial,emotion};
  const snapshot=store.publish(frame);emotion.emotion='sad';frame.text='mutated caller';
  assert.equal(snapshot.text,initial.text);assert.equal(snapshot.emotion.emotion,'happy');
  assert.throws(()=>{snapshot.audioLevel=1;},TypeError);assert.throws(()=>{snapshot.emotion.emotion='sad';},TypeError);
  store.publish({...initial,emotion:{emotion:'happy',intensity:'natural',source:'rules'}});assert.equal(deliveries,1);
});

test('only character, audio and emotion updates are classified as presentation-only',()=>{
  assert.equal(samePlaybackSemantics(initial,{...initial,charIndex:4,audioLevel:.7,emotion:{emotion:'gentle',intensity:'natural',source:'rules'}}),true);
  for(const patch of [{active:false},{pending:true},{ended:true},{utteranceId:'next'},{text:'下一句话'},{error:'failure'},{buffering:true},{streaming:false},{voiceName:'another voice'},{progressBasis:'boundary'},{futureControl:'new value'}])
    assert.equal(samePlaybackSemantics(initial,{...initial,...patch}),false,JSON.stringify(patch));
});

test('unsubscribe and resubscribe do not accumulate callbacks across scene remounts',()=>{
  const store=createSpeechPresentation(initial);let deliveries=0;
  for(let i=0;i<20;i++){
    const unsubscribe=store.source.subscribe(()=>deliveries++);
    store.publish({...initial,charIndex:i+1});assert.equal(deliveries,i+1);unsubscribe();
    store.publish({...initial,charIndex:0});assert.equal(deliveries,i+1);
  }
  assert.equal(Object.isFrozen(store.source),true);
});
