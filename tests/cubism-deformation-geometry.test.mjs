import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {waitForCubismCore} from '../src/avatar/cubism/runtime.mjs';

const root=new URL('../public/avatars/akari-cubism-v4/',import.meta.url);
const arrayBuffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const span=points=>({width:Math.max(...points.filter((_,i)=>i%2===0))-Math.min(...points.filter((_,i)=>i%2===0)),height:Math.max(...points.filter((_,i)=>i%2===1))-Math.min(...points.filter((_,i)=>i%2===1))});

test('actual V4 stable MOC preserves head/body edges and feature spacing throughout combined poses, and uses one closed mouth drawing',async()=>{
 const source=await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js',import.meta.url),'utf8');
 const sandbox={console,setTimeout,clearTimeout,TextDecoder,TextEncoder,atob,btoa,window:{},document:{currentScript:{src:'https://petpal.test/vendor/live2d/live2dcubismcore.min.js'}}};
 vm.runInNewContext(source,sandbox,{timeout:2000});
 const core=await waitForCubismCore(()=>sandbox.Live2DCubismCore);
 const manifest=JSON.parse(await fs.readFile(new URL('akari.model3.json',root),'utf8'));
 const bytes=arrayBuffer(await fs.readFile(new URL(manifest.FileReferences.Moc,root)));
 assert.equal(core.Moc.prototype.hasMocConsistency(bytes),1);
 const moc=core.Moc.fromArrayBuffer(bytes),model=core.Model.fromMoc(moc);
 assert.ok(model);
 try{
  const parameter=new Map(Array.from(model.parameters.ids,(id,i)=>[id,i]));
  const drawable=new Map(Array.from(model.drawables.ids,(id,i)=>[id,i]));
  const reset=values=>{
   model.parameters.values.set(model.parameters.defaultValues);
   for(const [id,value] of Object.entries(values)){assert.ok(parameter.has(id),id);model.parameters.values[parameter.get(id)]=value;}
   model.update();
  };
  const snapshot=()=>Array.from(model.drawables.vertexPositions,p=>Array.from(p));
  reset({});const rest=snapshot();
  const rigidIds=['ArtMeshFace','ArtMeshEyewhiteR','ArtMeshEyewhiteL','ArtMeshEyelashR','ArtMeshEyelashL','ArtMeshEyebrowR','ArtMeshEyebrowL','ArtMeshNose','ArtMeshTopwear'];
  assert.ok(rigidIds.every(id=>drawable.has(id)));
  const center=points=>[points.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0)/(points.length/2),points.filter((_,i)=>i%2===1).reduce((a,b)=>a+b,0)/(points.length/2)];
  const faceIds=rigidIds.filter(id=>id!=='ArtMeshTopwear');
  const anchors=faceIds.map(id=>center(rest[drawable.get(id)]));
  let maxEdgeError=0,maxSpacingError=0;
  for(let step=0;step<121;step++){
   const t=step*Math.PI*2/120;
   reset({ParamAngleX:30*Math.sin(t),ParamAngleY:20*Math.cos(t*2),ParamAngleZ:12*Math.sin(t*3),ParamBodyAngleX:5*Math.cos(t),ParamBodyAngleY:4*Math.sin(t*2),ParamBodyAngleZ:6*Math.cos(t*3),ParamBreath:(1+Math.sin(t))/2});
   const current=snapshot();
   for(const id of rigidIds){
    const index=drawable.get(id),indices=model.drawables.indices[index],a=rest[index],b=current[index];
    for(let edge=0;edge<indices.length;edge+=3)for(let pair=0;pair<3;pair++){
     const i=indices[edge+pair]*2,j=indices[edge+(pair+1)%3]*2;
     const before=Math.hypot(a[i]-a[j],a[i+1]-a[j+1]);if(before<1e-5)continue;
     const after=Math.hypot(b[i]-b[j],b[i+1]-b[j+1]);
     maxEdgeError=Math.max(maxEdgeError,Math.abs(after/before-1));
    }
   }
   const nextAnchors=faceIds.map(id=>center(current[drawable.get(id)]));
   for(let i=0;i<anchors.length;i++)for(let j=i+1;j<anchors.length;j++){
    const distance=points=>Math.hypot(points[i][0]-points[j][0],points[i][1]-points[j][1]);
    maxSpacingError=Math.max(maxSpacingError,Math.abs(distance(nextAnchors)/distance(anchors)-1));
   }
  }
  // A broad sweep intentionally exceeds ordinary pointer/gesture inputs. Rendering these
  // poses must not independently stretch skin, eyelids, eyebrows or the clothed body.
  assert.ok(maxEdgeError<.001,`rigid edge distortion ${maxEdgeError}`);
  assert.ok(maxSpacingError<.001,`feature spacing distortion ${maxSpacingError}`);
  const irisId=drawable.get('ArtMeshIridesR');
  reset({});const irisSpan=span(snapshot()[irisId]);
  for(const form of [-1,-.5,.5,1]){reset({ParamEyeBallForm:form});const current=span(snapshot()[irisId]);assert.ok(Math.abs(current.width/irisSpan.width-1)<1e-5);assert.ok(Math.abs(current.height/irisSpan.height-1)<1e-5);}
  // The same check must detect the old iris stretch, rather than merely validating numbers.
  const oldMoc=core.Moc.fromArrayBuffer(arrayBuffer(await fs.readFile(new URL('../public/avatars/akari-cubism-v2/akari.moc3',import.meta.url))));
  const oldModel=core.Model.fromMoc(oldMoc);
  try{
   const eye=Array.from(oldModel.drawables.ids).indexOf('ArtMeshIridesR'),form=Array.from(oldModel.parameters.ids).indexOf('ParamEyeBallForm');
   assert.ok(eye>=0&&form>=0);oldModel.update();const before=span(Array.from(oldModel.drawables.vertexPositions[eye]));
   oldModel.parameters.values[form]=1;oldModel.update();const after=span(Array.from(oldModel.drawables.vertexPositions[eye]));
   assert.ok(Math.abs(after.height/before.height-1)>.08,'old model must fail the iris proportion check');
  }finally{oldModel.release();oldMoc._release();}
  assert.ok(!Array.from(drawable.keys()).some(id=>id.includes('_lip_')),'procedural lip outlines must be absent');
  const open=drawable.get('ArtMeshMouthOpen'),closed=drawable.get('ArtMeshMouthClose');
  for(const [amount,expectedOpen] of [[0,0],[.09,.5],[.18,1],[.6,1],[1,1]]){
   reset({ParamMouthOpenY:amount});
   assert.ok(Math.abs(model.drawables.opacities[open]-expectedOpen)<1e-5);
   assert.ok(Math.abs(model.drawables.opacities[closed]-(1-expectedOpen))<1e-5);
  }
  const physics=JSON.parse(await fs.readFile(new URL(manifest.FileReferences.Physics,root),'utf8'));
  assert.deepEqual(physics.PhysicsSettings.map(s=>s.Id),['PhysicsHairBack','PhysicsHairFront']);
  assert.ok(physics.PhysicsSettings.flatMap(s=>s.Output).every(o=>o.Destination.Id!=='ParamEyeBallForm'));
 }finally{model.release();moc._release();}
});

test('licensed Core keeps V4 forehead hair anchors attached to the face and limits motion to the lower tips, rejecting the old sliding hair',async t=>{
 const source=await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js',import.meta.url),'utf8');
 const sandbox={console,setTimeout,clearTimeout,TextDecoder,TextEncoder,atob,btoa,window:{},document:{currentScript:{src:'https://petpal.test/vendor/live2d/live2dcubismcore.min.js'}}};
 vm.runInNewContext(source,sandbox,{timeout:2000});
 const core=await waitForCubismCore(()=>sandbox.Live2DCubismCore);
 const centroid=points=>[points.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0)/(points.length/2),points.filter((_,i)=>i%2===1).reduce((a,b)=>a+b,0)/(points.length/2)];
 const yBounds=points=>{const y=points.filter((_,i)=>i%2===1);return [Math.min(...y),Math.max(...y)];};
 async function inspectHair(bundle,expectedFrontHairIds){
  const manifest=JSON.parse(await fs.readFile(new URL('akari.model3.json',bundle),'utf8'));
  const bytes=arrayBuffer(await fs.readFile(new URL(manifest.FileReferences.Moc,bundle)));
  assert.equal(core.Moc.prototype.hasMocConsistency(bytes),1);
  const moc=core.Moc.fromArrayBuffer(bytes),model=core.Model.fromMoc(moc);
  assert.ok(model);
  try{
   const parameter=new Map(Array.from(model.parameters.ids,(id,i)=>[id,i]));
   const drawable=new Map(Array.from(model.drawables.ids,(id,i)=>[id,i]));
   const ppu=model.canvasinfo.PixelsPerUnit;
   assert.ok(Number.isFinite(ppu)&&ppu>0);
   for(const id of ['ParamHairFront','ParamHairBack']){
    assert.ok(parameter.has(id),id);
    const i=parameter.get(id);
    assert.ok(model.parameters.minimumValues[i]<=-1&&model.parameters.maximumValues[i]>=1,`${id} must support both endpoints`);
   }
   for(const id of ['ArtMeshFace','ArtMeshEyebrowL','ArtMeshEyebrowR','ArtMeshNose','ArtMeshBackHair'])assert.ok(drawable.has(id),id);
   const frontHairIds=Array.from(drawable.keys()).filter(id=>/^ArtMeshFrontHair(?:\d+)?$/u.test(id)).sort();
   assert.deepEqual(frontHairIds,expectedFrontHairIds,'the native MOC must contain the intended single or legacy pair of front hair drawings');
   const sample=values=>{
    model.parameters.values.set(model.parameters.defaultValues);
    for(const [id,value] of Object.entries(values)){assert.ok(parameter.has(id),id);model.parameters.values[parameter.get(id)]=value;}
    model.update();
    return Array.from(model.drawables.vertexPositions,p=>Array.from(p));
   };
   const rest=sample({});
   const face=drawable.get('ArtMeshFace');
   // Select visible anatomical regions from neutral native geometry. The
   // eyebrow tops mark the forehead boundary; side locks below the nose and
   // back hair below the chin mark the tips. No warp-grid rows or UV layout
   // are involved, so a different mesh density retains the same contract.
   const forehead=Math.max(yBounds(rest[drawable.get('ArtMeshEyebrowL')])[1],yBounds(rest[drawable.get('ArtMeshEyebrowR')])[1]);
   const noseBottom=yBounds(rest[drawable.get('ArtMeshNose')])[0],chin=yBounds(rest[face])[0];
   const regions=[...frontHairIds,'ArtMeshBackHair'].map(id=>{
    const index=drawable.get(id),points=rest[index],back=id==='ArtMeshBackHair';
    const roots=[],tips=[];
    for(let i=0;i<points.length;i+=2){if(points[i+1]>=forehead)roots.push(i);if(points[i+1]<(back?chin:noseBottom))tips.push(i);}
    assert.ok(roots.length>0&&tips.length>0,`${id} needs real scalp anchors and low tips`);
    return {id,index,back,roots,tips};
   });
   const result={maxFrontAnchorSlipPx:0,maxBackAnchorSlipPx:0,maxFrontTipMotionPx:0,maxBackTipMotionPx:0,maxFrontVertexMotionPx:0,maxBackVertexMotionPx:0,maxFaceMotionPx:0};
   const headPoses=[{},
    {ParamAngleX:30,ParamAngleY:20,ParamAngleZ:12,ParamBodyAngleX:5,ParamBodyAngleY:4,ParamBodyAngleZ:6,ParamBreath:1},
    {ParamAngleX:-30,ParamAngleY:-20,ParamAngleZ:-12,ParamBodyAngleX:-5,ParamBodyAngleY:-4,ParamBodyAngleZ:-6,ParamBreath:.5}];
   for(const pose of headPoses){
    const before=sample(pose),origin=centroid(before[face]);
    for(const [front,back] of [[-1,0],[0,0],[1,0],[0,-1],[0,1],[-1,1],[1,-1]]){
     const after=sample({...pose,ParamHairFront:front,ParamHairBack:back}),nextOrigin=centroid(after[face]);
     for(let i=0;i<before[face].length;i+=2)result.maxFaceMotionPx=Math.max(result.maxFaceMotionPx,Math.hypot(after[face][i]-before[face][i],after[face][i+1]-before[face][i+1])*ppu);
     for(const region of regions){
      const a=before[region.index],b=after[region.index];
      // Subtract the face anchor in both frames: motion of the whole head
      // cannot conceal hair sliding independently over the forehead.
      const relativeMotion=i=>Math.hypot((b[i]-nextOrigin[0])-(a[i]-origin[0]),(b[i+1]-nextOrigin[1])-(a[i+1]-origin[1]))*ppu;
      const anchorKey=region.back?'maxBackAnchorSlipPx':'maxFrontAnchorSlipPx';
      const tipKey=region.back?'maxBackTipMotionPx':'maxFrontTipMotionPx';
      const allKey=region.back?'maxBackVertexMotionPx':'maxFrontVertexMotionPx';
      for(let i=0;i<a.length;i+=2)result[allKey]=Math.max(result[allKey],relativeMotion(i));
      for(const i of region.roots)result[anchorKey]=Math.max(result[anchorKey],relativeMotion(i));
      for(const i of region.tips)result[tipKey]=Math.max(result[tipKey],relativeMotion(i));
     }
    }
   }
   return result;
  }finally{model.release();moc._release();}
 }
 function attachedRootsAndGentleTips(result){
  // 0.01 authored pixel is float tolerance, not a perceptible sliding allowance.
  assert.ok(result.maxFrontAnchorSlipPx<.01,`front scalp slid ${result.maxFrontAnchorSlipPx}px relative to face`);
  assert.ok(result.maxBackAnchorSlipPx<.01,`back scalp slid ${result.maxBackAnchorSlipPx}px relative to face`);
  assert.ok(result.maxFaceMotionPx<.01,'hair input must not move the facial features');
  assert.ok(result.maxFrontVertexMotionPx<=6.01&&result.maxBackVertexMotionPx<=8.01,'all hair vertices must stay within the gentle motion envelope');
  assert.ok(result.maxFrontTipMotionPx>.5&&result.maxFrontTipMotionPx<=6.01,`front tips need gentle motion, got ${result.maxFrontTipMotionPx}px`);
  assert.ok(result.maxBackTipMotionPx>.5&&result.maxBackTipMotionPx<=8.01,`back tips need gentle motion, got ${result.maxBackTipMotionPx}px`);
 }
 const stable=await inspectHair(root,['ArtMeshFrontHair']);
 attachedRootsAndGentleTips(stable);
 const old=await inspectHair(new URL('../public/avatars/akari-cubism-v2/',import.meta.url),['ArtMeshFrontHair','ArtMeshFrontHair2']);
 // Execute the same acceptance function against a real old MOC. A test
 // that only checked finite vertices would accept this sliding negative case.
 assert.throws(()=>attachedRootsAndGentleTips(old),/front scalp slid/);
 assert.ok(old.maxFrontAnchorSlipPx>2&&old.maxBackAnchorSlipPx>2,'negative control must include visible scalp sliding');
 assert.ok(old.maxFrontTipMotionPx>20&&old.maxBackTipMotionPx>20,'negative control must include excessive tip motion');
 t.diagnostic(`v4 hair geometry ${JSON.stringify(stable)}`);
 t.diagnostic(`v2 sliding negative control ${JSON.stringify(old)}`);
});
