import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createResampler, audioLevel, createVoiceGate, pcmFloat32LE, microphoneWorkletSource } from '../src/voice/audio.mjs';

test('24kHz resampling is independent of callback boundaries at hardware rates', () => {
  for (const rate of [24000,44100,48000,96000]) {
    const source = Float32Array.from({length:rate},(_,i)=>Math.sin(i / rate * 2 * Math.PI * 440) * .3);
    const whole = createResampler(rate).push(source), resampler = createResampler(rate), blocks = [];
    for(let i=0;i<source.length;i+=128)blocks.push(...resampler.push(source.subarray(i,i+128)));
    assert.equal(whole.length,24000); assert.deepEqual(blocks,[...whole]);
    assert.ok(Math.abs(audioLevel(whole)-.212)<.002);
  }
});

test('invalid samples are sanitized at capture and cannot enter uploaded PCM', () => {
  assert.deepEqual([...createResampler(24000).push(new Float32Array([NaN,Infinity,-2,2]))],[0,0,-1,1]);
  assert.throws(()=>pcmFloat32LE(new Float32Array([NaN])),/Invalid/);
  assert.throws(()=>audioLevel(new Float32Array([1.1])),/Invalid/);
  assert.throws(()=>createResampler(0),/Unsupported/);
  const pcm = new DataView(pcmFloat32LE(new Float32Array([-.5,.25])));
  assert.equal(pcm.getFloat32(0,true),-.5); assert.equal(pcm.getFloat32(4,true),.25);
});

test('VAD keeps bounded pre-roll, waits for 900ms silence and caps continuous speech', () => {
  const gate=createVoiceGate(), silence=new Float32Array(6000), spoken=new Float32Array(6000).fill(.05);
  for(let i=0;i<100;i++)assert.equal(gate.push(silence).samples.length,0);
  assert.equal(gate.push(spoken).started,false);
  const first=gate.push(spoken); assert.equal(first.started,true); assert.deepEqual(first.samples.map(s=>s.length),[4800,6000,6000]);
  for(let i=0;i<3;i++)assert.equal(gate.push(silence).ended,false);
  assert.equal(gate.push(silence).reason,'silence');
  gate.reset(); let count=0, ending;
  do { ending=gate.push(spoken);count+=ending.samples.reduce((n,frame)=>n+frame.length,0); }while(!ending.ended);
  assert.equal(count,45*24000);assert.equal(ending.reason,'limit');
  gate.reset();assert.equal(gate.active,false);
});

test('the shipped worklet mixes channels and emits only 250ms 24kHz Float32 frames', () => {
  let Processor;const frames=[];
  class Base { port={postMessage(frame,transfers){assert.equal(transfers[0],frame.buffer);frames.push(frame);}}; }
  vm.runInNewContext(microphoneWorkletSource(),{AudioWorkletProcessor:Base,sampleRate:48000,Float32Array,registerProcessor(name,klass){assert.equal(name,'petpal-microphone');Processor=klass;}});
  const worklet=new Processor();
  for(let i=0;i<188;i++) {
    const output=new Float32Array(128).fill(1);
    assert.equal(worklet.process([[new Float32Array(128).fill(.6),new Float32Array(128).fill(.2)]],[[output]]),true);
    assert.equal(output.some(Boolean),false,'capture output must remain silent');
  }
  assert.equal(frames.length,2);assert.ok(frames.every(frame=>frame.length===6000&&Math.abs(frame[0]-.4)<1e-6));
});

test('interruption gate rejects brief noise and quieter echo, and preserves sustained onset with bounded pre-roll',()=>{
  const gate=createVoiceGate({threshold:.028,minSpeechMs:500}),quiet=new Float32Array(6000).fill(.02),voiced=new Float32Array(6000).fill(.05);
  for(let i=0;i<200;i++)assert.equal(gate.push(quiet).started,false);
  assert.equal(gate.push(voiced).started,false);
  assert.equal(gate.push(quiet).started,false,'quiet between clicks resets the sustained-speech requirement');
  assert.equal(gate.push(voiced).started,false);
  const detected=gate.push(voiced);assert.equal(detected.started,true);assert.deepEqual(detected.samples.map(frame=>frame.length),[4800,6000,6000]);
  assert.equal(detected.samples[0][0],quiet[0]);assert.equal(detected.samples[1][0],voiced[0]);
  gate.reset();assert.equal(gate.push(voiced).started,false);assert.equal(gate.push(voiced).started,true);
  assert.throws(()=>createVoiceGate({minSpeechMs:1001}),/Invalid/);
});

const tone=(rms,length=6000,frequency=240)=>Float32Array.from({length},(_,i)=>Math.SQRT2*rms*Math.sin(2*Math.PI*frequency*i/24000));

test('default gate learns low background audio and rejects lower-volume ambient speech across utterance resets',()=>{
  const gate=createVoiceGate();
  for(let i=0;i<80;i++)assert.equal(gate.push(tone(.02)).started,false);
  assert.ok(gate.noiseFloor>.019);
  for(let i=0;i<12;i++)assert.equal(gate.push(tone(i%2?.032:.023)).started,false);
  const floor=gate.noiseFloor;gate.reset();assert.equal(gate.noiseFloor,floor,'a turn transition must retain the room estimate');
  assert.equal(gate.push(tone(.07)).started,false);
  assert.equal(gate.push(tone(.07)).started,true,'closer speech still starts after confirmation');
  const duringSpeech=gate.noiseFloor;gate.push(tone(.1));assert.equal(gate.noiseFloor,duringSpeech,'speech cannot train the noise floor');
});

test('loud short impacts in consecutive 250ms frames cannot satisfy sustained speech',()=>{
  const gate=createVoiceGate(),impact=tone(.006);
  // An 8ms impact makes the full frame RMS exceed the old .014 gate.
  impact.set(tone(.6,192,1000),2400);assert.ok(audioLevel(impact)>.028);
  for(let i=0;i<200;i++){const result=gate.push(impact);assert.equal(result.started,false);assert.equal(result.samples.length,0);}
  assert.equal(gate.push(tone(.07)).started,false);
  const result=gate.push(tone(.07));assert.equal(result.started,true);assert.equal(result.samples.reduce((sum,frame)=>sum+frame.length,0),16800,'200ms pre-roll plus the complete 500ms onset');
});

test('rapid rhythmic impacts cannot accumulate into a speech candidate indefinitely',()=>{
  const gate=createVoiceGate();
  for(let frame=0;frame<120;frame++){
    const samples=Float32Array.from({length:6000},(_,i)=>((frame*6000+i)%1920)<480 ? .16*Math.sin(2*Math.PI*1000*i/24000) : 0);
    assert.equal(gate.push(samples).started,false,'20ms taps separated by 60ms quiet are not sustained speech');
  }
  const starts=[gate.push(tone(.075)),gate.push(tone(.075))].filter(result=>result.started);
  assert.equal(starts.length,1,'nearby speech must still be recognized within 500ms after impacts');
});

test('adaptive floor follows rising idle noise but accepts quieter continuation and preserves 900ms ending',()=>{
  const gate=createVoiceGate();
  for(let i=0;i<80;i++)assert.equal(gate.push(tone(.004+i/80*.02)).started,false);
  assert.ok(gate.noiseFloor>.02);
  gate.push(tone(.065));assert.equal(gate.push(tone(.065)).started,true);
  for(let i=0;i<6;i++)assert.equal(gate.push(tone(.04)).ended,false,'a softer continuation should not be cut off');
  for(let i=0;i<3;i++)assert.equal(gate.push(tone(.02)).ended,false);
  assert.equal(gate.push(tone(.02)).reason,'silence');
});

test('interrupt monitoring uses learned room noise without learning assistant playback',()=>{
  const gate=createVoiceGate({threshold:.04,minSpeechMs:500,noiseRatio:2.4});
  for(let i=0;i<100;i++)assert.equal(gate.push(tone(.05),{learnNoise:false,noiseFloor:.025}).started,false);
  assert.equal(gate.noiseFloor,0);
  assert.equal(gate.push(tone(.085),{learnNoise:false,noiseFloor:.025}).started,false);
  assert.equal(gate.push(tone(.085),{learnNoise:false,noiseFloor:.025}).started,true);
});

test('normal speech after native-rate resampling confirms once and retains its opening samples',()=>{
  for(const rate of [44100,48000]){
    const source=Float32Array.from({length:rate/2},(_,i)=>.1*Math.sin(2*Math.PI*240*i/rate));
    const pcm=createResampler(rate).push(source),gate=createVoiceGate();
    assert.equal(gate.push(pcm.subarray(0,6000)).started,false);
    const result=gate.push(pcm.subarray(6000));assert.equal(result.started,true);
    assert.deepEqual(result.samples.flatMap(frame=>[...frame]),[...pcm]);
  }
  for(const options of [{noiseRatio:NaN},{threshold:Infinity},{maxSeconds:Infinity},{noiseRatio:.5}])assert.throws(()=>createVoiceGate(options),/Invalid/);
});
