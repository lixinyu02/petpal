import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarMicroacting } from '../src/avatar/microacting.mjs';

const advance=(controller,seconds,options)=>{
  let pose=controller.step(0,options);
  for(let time=0;time<seconds-.0001;time+=.025)pose=controller.step(.025,options);
  return pose;
};

test('first idle cue waits 8.5 seconds and three bounded cues have long quiet gaps',()=>{
  const controller=createAvatarMicroacting();assert.equal(advance(controller,8.4).microExpression,'none');
  const starts=[],ends=[],kinds=[];let previous='none';
  for(let time=8.4;time<55;time+=.025){
    const pose=controller.step(.025);
    if(pose.microExpression!=='none'&&previous==='none'){starts.push(time);kinds.push(pose.microExpression);}
    if(pose.microExpression==='none'&&previous!=='none')ends.push(time);
    for(const [key,value]of Object.entries(pose))if(key!=='microExpression')assert.ok(Number.isFinite(value)&&Math.abs(value)<=1,key);
    previous=pose.microExpression;
  }
  assert.deepEqual(kinds.slice(0,3),['glance','softBlink','softSmile']);
  for(let index=1;index<starts.length;index++)assert.ok(starts[index]-ends[index-1]>=10,'idle cues have at least ten quiet seconds between them');
});

test('idle cues are subtle, terminate, and snapshots cannot mutate internal state',()=>{
  const controller=createAvatarMicroacting();advance(controller,8.8);
  const glance=advance(controller,.3);assert.equal(glance.microExpression,'glance');assert.ok(Math.abs(glance.gazeOffsetX)>.2&&Math.abs(glance.gazeOffsetX)<=.34);
  glance.gazeOffsetX=100;assert.ok(Math.abs(controller.step(0).gazeOffsetX)<=.34);
  advance(controller,12.55);const blink=advance(controller,.25);assert.equal(blink.microExpression,'softBlink');assert.ok(blink.blink>.5);
  advance(controller,14.2);const smile=advance(controller,.6);assert.equal(smile.microExpression,'softSmile');assert.ok(smile.smileAmount>.1&&smile.smileAmount<=.22);
  assert.equal(advance(controller,3).microExpression,'none');
});

test('higher-priority work cancels immediately and requires a fresh quiet interval',()=>{
  const controller=createAvatarMicroacting();advance(controller,9);
  assert.equal(controller.step(0,{enabled:false}).microExpression,'none');
  advance(controller,60,{enabled:false});
  assert.equal(advance(controller,8.4).microExpression,'none');
  assert.notEqual(advance(controller,.2).microExpression,'none');
  controller.cancel();assert.equal(controller.step(0).microExpression,'none');
  assert.equal(advance(controller,8).microExpression,'none');
});

test('a long frame gap consumes missed cues instead of catching up or freezing mid-expression',()=>{
  const controller=createAvatarMicroacting();
  assert.equal(controller.step(60).microExpression,'none');
  assert.equal(advance(controller,1).microExpression,'none');
  advance(controller,11);assert.equal(controller.step(60).microExpression,'none');
  assert.equal(advance(controller,1).microExpression,'none');
  controller.reset();assert.equal(advance(controller,8).microExpression,'none');
  for(const value of [NaN,Infinity,-2])assert.equal(controller.step(value).microExpression,'none');
});
