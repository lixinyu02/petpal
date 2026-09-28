import test from 'node:test';
import assert from 'node:assert/strict';
import {webUpdateState,updateProgress} from '../src/update-presentation.mjs';
test('web distinguishes release availability from deployed static assets',()=>{
  assert.equal(webUpdateState('0.6.0','0.6.0',{version:'0.7.0'}),'waiting-deploy');
  assert.equal(webUpdateState('0.6.0','0.7.0',null),'reload');
  assert.equal(webUpdateState('0.6.0',null,null),'current');
  assert.equal(webUpdateState('0.6.0','<html>',null),'current');
});
test('progress is bounded and unknown totals remain indeterminate',()=>{
  assert.equal(updateProgress({received:30,total:100}),30);
  assert.equal(updateProgress({received:300,total:100}),100);
  assert.equal(updateProgress({received:0,total:0}),null);
});
