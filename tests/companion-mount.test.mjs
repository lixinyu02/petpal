import test from 'node:test';
import assert from 'node:assert/strict';
import {watchCompanionBreakpoint} from '../src/companion-mount.mjs';

function fixture(matches) {
  const listeners=new Set(),history=[];let mountCount=0;
  const media={matches,addEventListener(type,callback){assert.equal(type,'change');listeners.add(callback);history.push(callback);},removeEventListener(type,callback){assert.equal(type,'change');listeners.delete(callback);}};
  const dispose=watchCompanionBreakpoint(media,()=>mountCount++);
  return {media,listeners,history,dispose,get mounts(){return mountCount;},resize(matches){media.matches=matches;for(const listener of listeners)listener();}};
}

test('the visible narrow companion is mounted initially, while a closed wide panel stays deferred',()=>{
  const narrow=fixture(true),wide=fixture(false);
  assert.equal(narrow.mounts,1);assert.equal(wide.mounts,0);
  narrow.dispose();wide.dispose();assert.equal(narrow.listeners.size,0);assert.equal(wide.listeners.size,0);
});

test('entering the narrow layout mounts once; returning wide preserves the mounted instance',()=>{
  const current=fixture(false);current.resize(false);assert.equal(current.mounts,0);
  current.resize(true);assert.equal(current.mounts,1);
  current.resize(false);current.resize(true);assert.equal(current.mounts,1);current.dispose();
});

test('cleanup removes the breakpoint listener and ignores an already delivered callback',()=>{
  const current=fixture(false),late=current.history[0];current.dispose();current.resize(true);late();
  assert.equal(current.listeners.size,0);assert.equal(current.mounts,0);
});
