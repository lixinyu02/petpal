import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseGfx,parseMemory,frameStats} from '../scripts/android-fluidity-metrics.mjs';
test('API36 framestats accepts FrameTimelineVsyncId before IntendedVsync and rejects sentinel or nonzero flags',()=>{
 const parsed=parseGfx(`Total frames rendered: 492\nJanky frames: 3 (0.61%)\nJanky frames (legacy): 490 (99.59%)\nFlags,FrameTimelineVsyncId,IntendedVsync,Vsync,FrameCompleted,\n0,123,100000000,100000000,125000000,\n1,124,200000000,200000000,900000000,\n0,125,300000000,300000000,9223372036854775807,\n0,126,0,0,500000000,\n0,127,500000000,500000000,530000000,`);
 assert.deepEqual(parsed.total,{count:492,percent:null});assert.deepEqual(parsed.janky,{count:3,percent:.61});assert.deepEqual(parsed.legacyJanky,{count:490,percent:99.59});assert.equal(parsed.nativeFrameCompletion.count,2);assert.equal(parsed.nativeFrameCompletion.p50Ms,25);assert.equal(parsed.nativeFrameCompletion.p95Ms,30);
});
test('legacy framestats parses by column names; missing data remains unavailable',()=>{
 const value=parseGfx('Flags,IntendedVsync,FrameCompleted,\n0,100000000,119000000,\n');assert.equal(value.nativeFrameCompletion.p50Ms,19);assert.equal(value.janky,null);assert.equal(parseGfx('').nativeFrameCompletion.count,0);
});
test('host memory does not invent renderer memory and quantiles retain long-tail frames',()=>{
 const memory=parseMemory('  Java Heap: 123\n  Native Heap: 456\n TOTAL PSS: 45678 TOTAL RSS: 56789\n');assert.equal(memory.totalPssKb,45678);assert.equal(memory.graphicsPssKb,null);assert.equal(memory.rendererProcessMemoryMeasured,false);assert.equal(frameStats([16.7,16.7,1000]).maxMs,1000);assert.equal(frameStats([]).p95Ms,null);
});
