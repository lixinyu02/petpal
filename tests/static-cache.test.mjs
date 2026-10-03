import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {staticCacheControl} from '../server/static-cache.mjs';

test('only content-addressed scripts/styles are immutable; mutable avatars revalidate',()=>{
  const root=path.resolve('fixture-site');
  const policy=name=>staticCacheControl(root,path.join(root,name));
  for(const file of ['assets/index-DLeQOhCG.js','assets/theme-B_iD--q8.css'])assert.match(policy(file),/31536000, immutable$/);
  for(const file of ['avatars/akari-cubism-v12/akari.moc3','vendor/live2dcubismcore.min.js','favicon.svg'])assert.equal(policy(file),'public, max-age=0, must-revalidate');
  for(const file of ['index.html','version.json','assets/main.js','assets/test.js','downloads/manifest.json','../assets/main-DLeQOhCG.js'])assert.equal(policy(file),'no-store');
});
