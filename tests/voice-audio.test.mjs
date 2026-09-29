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
  const first=gate.push(spoken); assert.equal(first.started,true); assert.deepEqual(first.samples.map(s=>s.length),[4800,6000]);
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
