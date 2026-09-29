import test from 'node:test';
import assert from 'node:assert/strict';
import { animeHeadNodOffset, animePoseTransform } from '../src/avatar/anime-pose-render.mjs';

const identity={gesture:'none',progress:0,xPercent:0,yPercent:0,rotationDegrees:0,scale:1};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} ≈ ${expected}`);

test('body directions are screen-relative and forward lean keeps the entire portrait together',()=>{
  const right=animePoseTransform({bodyTurn:.5,headShake:.5});
  const left=animePoseTransform({bodyTurn:-.5,headShake:-.5});
  assert.ok(right.xPercent>0&&right.rotationDegrees>0);
  assert.ok(left.xPercent<0&&left.rotationDegrees<0);
  near(right.xPercent,-left.xPercent);near(right.rotationDegrees,-left.rotationDegrees);
  assert.ok(animePoseTransform({bodyLift:.5}).yPercent<0,'lift moves upward on screen');
  const lean=animePoseTransform({bodyLean:.5}),recoil=animePoseTransform({bodyLean:-.5});
  assert.ok(lean.scale>1&&lean.yPercent>0);assert.ok(recoil.scale<1&&recoil.yPercent<0);
});

test('single nods are visible at phone size while ordinary voice motion keeps its original subtle amplitude',()=>{
  near(animeHeadNodOffset(.1),.1*.014/3*100);
  const nod=animeHeadNodOffset(.5);
  const pixels=nod/100*480;
  assert.ok(pixels>=3&&pixels<=6,'a 480px portrait gives a readable 3–6px head nod');
  assert.ok(nod>0,'positive nod moves down');near(animeHeadNodOffset(-.5),-nod);
  assert.ok(Math.abs(animeHeadNodOffset(.12001)-animeHeadNodOffset(.11999))<.001,'gain is continuous at the voice threshold');
  for(const option of ['sleeping','reducedMotion','hidden'])assert.equal(animeHeadNodOffset(.5,{[option]:true}),0);
  for(const invalid of [undefined,NaN,Infinity])assert.equal(animeHeadNodOffset(invalid),0);
  near(animeHeadNodOffset(100),animeHeadNodOffset(1));
});

test('untrusted body channels cannot exceed the rigid pose limits or introduce non-finite transforms',()=>{
  const maximum=animePoseTransform({gesture:'bounce',gestureProgress:100,bodyTurn:100,headShake:100,bodyLift:-100,bodyLean:100});
  near(maximum.xPercent,3.45);near(maximum.yPercent,3.05);near(maximum.rotationDegrees,2.25);near(maximum.scale,1.028);
  assert.equal(maximum.gesture,'bounce');assert.equal(maximum.progress,1);
  const minimum=animePoseTransform({gesture:'unrecognized',gestureProgress:-1,bodyTurn:-100,headShake:-100,bodyLift:100,bodyLean:-100});
  near(minimum.xPercent,-3.45);near(minimum.yPercent,-3.05);near(minimum.rotationDegrees,-2.25);near(minimum.scale,.972);
  assert.equal(minimum.gesture,'none');assert.equal(minimum.progress,0);
  for(const value of [undefined,NaN,Infinity,-Infinity,'.5']){
    const result=animePoseTransform({gestureProgress:value,bodyTurn:value,headShake:value,bodyLift:value,bodyLean:value});
    for(const [key,output] of Object.entries(result))if(key!=='gesture')assert.ok(Number.isFinite(output));
    assert.equal(result.scale,1);assert.equal(result.xPercent,0);assert.equal(result.yPercent,0);
  }
});

test('sleep, reduced motion and hidden state clear gestures and rigid motion without mutating mouth input',()=>{
  const pose={gesture:'nod',gestureProgress:.5,bodyTurn:.3,headShake:.2,bodyLift:.2,bodyLean:.3,mouthOpen:.7,mouthShape:'O'};
  const original=structuredClone(pose);
  for(const option of ['sleeping','reducedMotion','hidden'])assert.deepEqual(animePoseTransform(pose,{[option]:true}),identity);
  assert.deepEqual(pose,original);
  const active=animePoseTransform(pose);
  assert.equal('mouthOpen' in active,false);assert.equal('mouthShape' in active,false);
  assert.deepEqual(animePoseTransform({...pose,mouthOpen:0,mouthShape:'closed'}),active);
});

test('normalized portrait offsets preserve direction and proportions for DOM and the 2×3 WebGL plane',()=>{
  const transform=animePoseTransform({bodyTurn:.4,headShake:-.1,bodyLift:.3,bodyLean:.5});
  // DOM percentages use screen down; a centered orthographic 2×3 plane uses up.
  const world={x:transform.xPercent*.02,y:-transform.yPercent*.03,rotation:-transform.rotationDegrees*Math.PI/180};
  for(const height of [360,960,1440]){
    const width=height*2/3;
    near(world.x/2*width,transform.xPercent/100*width);
    near(-world.y/3*height,transform.yPercent/100*height);
  }
  near(-world.rotation*180/Math.PI,transform.rotationDegrees);
});
