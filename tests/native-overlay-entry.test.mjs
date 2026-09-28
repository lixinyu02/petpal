import test from 'node:test';
import assert from 'node:assert/strict';
import { isPassiveNativeOverlay } from '../src/auth/overlay-entry.mjs';
test('bridge-free Android AssetLoader keeps its passive avatar while public queries still require login',()=>{
  const entry='https://appassets.androidplatform.net/assets/public/index.html';
  for(const avatar of ['cat','anime'])assert.equal(isPassiveNativeOverlay(`${entry}?overlay=1&avatar=${avatar}`),true);
  for(const url of ['https://magicdatou.top:44318/?overlay=1&avatar=anime',`${entry}?pet=1`,`${entry}?overlay=1`,`${entry}?overlay=1&avatar=script`,'http://appassets.androidplatform.net/assets/public/index.html?overlay=1&avatar=anime','https://appassets.androidplatform.net/other?overlay=1&avatar=anime'])assert.equal(isPassiveNativeOverlay(url),false,url);
  assert.equal(isPassiveNativeOverlay('http://127.0.0.1:4318/?pet=1',true),true);
  assert.equal(isPassiveNativeOverlay('http://127.0.0.1:4318/',true),false);
});
