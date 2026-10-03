import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { createPetServer } from '../server/app.mjs';
import { listenFixture } from './helpers/loopback.mjs';

test('public package files remain downloadable while missing packages return 404 and SPA routes still render',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-downloads-static-'));
  const staticDir=path.join(directory,'site');let app;
  t.after(async()=>{
    try{await app?.close();}finally{
      assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));
      assert.ok(path.basename(directory).startsWith('petpal-downloads-static-'));
      await rm(directory,{recursive:true,force:true});
    }
  });
  await mkdir(path.join(staticDir,'downloads'),{recursive:true});
  await writeFile(path.join(staticDir,'index.html'),'<!doctype html><title>isolated SPA fixture</title>');
  const packageBytes=Buffer.from('PK-latest-package-fixture'),filename='PetPal-0.9.7-Windows-x64.zip';
  const sha256=createHash('sha256').update(packageBytes).digest('hex');
  await writeFile(path.join(staticDir,'downloads',filename),packageBytes);
  await writeFile(path.join(staticDir,'downloads','release-manifest-0.9.7.json'),JSON.stringify({version:'0.9.7',channel:'stable',createdAt:new Date().toISOString(),files:[{name:filename,target:'windows-x64',bytes:packageBytes.length,sha256}]}));
  await writeFile(path.join(staticDir,'downloads','SHA256SUMS-0.9.7.txt'),`${sha256}  ${filename}\n`);
  await mkdir(path.join(staticDir,'downloads','updates'));
  await writeFile(path.join(staticDir,'downloads','updates','stable.json'),'{"signed":"separate-update-contract"}');
  await mkdir(path.join(staticDir,'assets'));await mkdir(path.join(staticDir,'avatars'));
  await writeFile(path.join(staticDir,'assets','index-DLeQOhCG.js'),'export const cached=true;'.repeat(200));
  await writeFile(path.join(staticDir,'avatars','face.webp'),'avatar-fixture');
  await writeFile(path.join(staticDir,'version.json'),'{"version":"0.9.7"}');
  app=await createPetServer({dataDir:path.join(directory,'state'),staticDir,token:randomUUID(),
    codex:{async close(){},async status(){throw new Error('Unexpected Codex request');}},
    desktopTools:{async close(){},async status(){throw new Error('Unexpected desktop request');}},
    downloadsOptions:{fetchImpl:async()=>{throw new Error('Unexpected catalog request');}},
  });
  await listenFixture(app.server);const origin=`http://127.0.0.1:${app.server.address().port}`;
  const request=(pathname,extra={})=>fetch(origin+pathname,{signal:AbortSignal.timeout(5000),redirect:'manual',...extra});
  const present=await request('/downloads/PetPal-0.9.7-Windows-x64.zip');assert.equal(present.status,200);assert.equal(await present.text(),'PK-latest-package-fixture');
  const partial=await request('/downloads/PetPal-0.9.7-Windows-x64.zip',{headers:{Range:'bytes=0-1'}});assert.equal(partial.status,206);assert.equal(partial.headers.get('content-encoding'),null);assert.equal(await partial.text(),'PK');
  const updates=await request('/downloads/updates/stable.json');assert.equal(updates.status,200);assert.equal((await updates.json()).signed,'separate-update-contract');
  for(const pathname of ['/downloads','/downloads/','/downloads/PetPal-0.9.6-Windows-x64.zip','/downloads/nested/removed.apk']){
    const missing=await request(pathname);assert.equal(missing.status,404,pathname);assert.match(missing.headers.get('content-type'),/application\/json/);assert.match((await missing.json()).error,/安装包/);
  }
  const head=await request('/downloads/removed.apk',{method:'HEAD'});assert.equal(head.status,404);assert.equal(await head.text(),'');
  for(const pathname of ['/','/settings','/downloads-guide']){
    const spa=await request(pathname);assert.equal(spa.status,200,pathname);assert.match(await spa.text(),/isolated SPA fixture/);
    assert.equal(spa.headers.get('cache-control'),'no-store');
  }
  const hashed=await request('/assets/index-DLeQOhCG.js');assert.match(hashed.headers.get('cache-control'),/immutable/);await hashed.arrayBuffer();
  const compressed=await request('/assets/index-DLeQOhCG.js',{headers:{'Accept-Encoding':'gzip'}});assert.equal(compressed.headers.get('content-encoding'),'gzip');assert.match(compressed.headers.get('vary'),/Accept-Encoding/);await compressed.arrayBuffer();
  const conditional=await request('/assets/index-DLeQOhCG.js',{headers:{'If-None-Match':hashed.headers.get('etag'),'Cache-Control':'max-age=0'}});assert.equal(conditional.status,304);
  const avatar=await request('/avatars/face.webp');assert.equal(avatar.headers.get('cache-control'),'public, max-age=0, must-revalidate');await avatar.arrayBuffer();
  const version=await request('/version.json');assert.equal(version.headers.get('cache-control'),'no-store');await version.arrayBuffer();
  const api=await request('/api/downloads');assert.equal(api.status,401,'API authentication boundary remains in force');await api.arrayBuffer();
  assert.equal(api.headers.get('cache-control'),'no-store');
});
