import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceDetectionPreferences,normalizeVoiceSensitivity,voiceGateProfile} from '../src/voice/detection-preferences.mjs';
import {createVoiceGate} from '../src/voice/audio.mjs';

test('detection defaults to noise reduction and isolates account/device preferences',()=>{
  const data=new Map(),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
  const owner=createVoiceDetectionPreferences(storage,'owner'),other=createVoiceDetectionPreferences(storage,'test');
  assert.equal(owner.read(),'noise-reduced');assert.equal(other.read(),'noise-reduced');
  owner.write('sensitive');assert.equal(other.read(),'noise-reduced');
  assert.equal(createVoiceDetectionPreferences(storage,'owner').read(),'sensitive');
  assert.equal(createVoiceDetectionPreferences(undefined,'owner').read(),'noise-reduced');
  owner.dispose();owner.write('balanced');assert.equal(createVoiceDetectionPreferences(storage,'owner').read(),'sensitive');
});

test('invalid or unavailable storage falls back safely without microphone access',()=>{
  const storage={getItem(){throw new Error('denied');},setItem(){throw new Error('full');}};
  const preferences=createVoiceDetectionPreferences(storage,'account');assert.equal(preferences.read(),'noise-reduced');
  assert.equal(preferences.write('balanced'),'balanced');assert.equal(preferences.write('__proto__'),'noise-reduced');
  for(const value of [null,{},[],42,'toString','constructor','noise-reduced\n'])assert.equal(normalizeVoiceSensitivity(value),'noise-reduced');
  for(const scope of ['',null,'bad\n','x'.repeat(2049)])assert.throws(()=>createVoiceDetectionPreferences(storage,scope),/account scope/);
});

test('a voice-hook controller sees a session choice when persistence is blocked or quota is full',()=>{
  for(const storage of [undefined,{getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}},{getItem:()=> 'noise-reduced',setItem(){throw new Error('quota');}}]){
    const preferences=createVoiceDetectionPreferences(storage,'blocked:member');preferences.write('sensitive');preferences.dispose();
    assert.equal(createVoiceDetectionPreferences(storage,'blocked:member').read(),'sensitive');
    assert.equal(createVoiceDetectionPreferences(storage,'blocked:other').read(),'noise-reduced');
  }
});

test('each selectable profile changes real speech admission while keeping stricter interruption confirmation',()=>{
  const noise=voiceGateProfile('noise-reduced'),balanced=voiceGateProfile('balanced'),sensitive=voiceGateProfile('sensitive');
  const quiet=new Float32Array(6000).fill(.018);
  assert.equal(createVoiceGate(sensitive.listening).push(quiet).started,true);
  for(const profile of [noise,balanced]){
    const gate=createVoiceGate(profile.listening);for(let i=0;i<20;i++)assert.equal(gate.push(quiet).started,false);
  }
  for(const name of ['noise-reduced','balanced','sensitive']){
    const {listening,interruption}=voiceGateProfile(name);
    assert.ok(interruption.threshold>listening.threshold);assert.ok(interruption.minSpeechMs>=listening.minSpeechMs);
    const gate=createVoiceGate(listening);let started=0;
    for(let i=0;i<3;i++)started+=Number(gate.push(new Float32Array(6000).fill(.065)).started);
    assert.equal(started,1);
  }
  noise.listening.threshold=1;assert.equal(voiceGateProfile('noise-reduced').listening.threshold,.028,'profile copies must not mutate other sessions');
});

test('light-speech profile admits a short reply while anti-noise keeps its stronger confirmation',()=>{
  const reply=Float32Array.from({length:5760},(_,i)=>.08*Math.sin(2*Math.PI*240*i/24000));
  assert.equal(createVoiceGate(voiceGateProfile('sensitive').listening).push(reply).started,true);
  assert.equal(createVoiceGate(voiceGateProfile('noise-reduced').listening).push(reply).started,false,'240ms speech alone is deliberately below anti-noise confirmation');
});
