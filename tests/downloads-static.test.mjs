import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
  await writeFile(path.join(staticDir,'downloads','PetPal-0.9.7-Windows-x64.zip'),Buffer.from('PK-latest-package-fixture'));
  app=await createPetServer({dataDir:path.join(directory,'state'),staticDir,token:randomUUID(),
    codex:{async close(){},async status(){throw new Error('Unexpected Codex request');}},
    desktopTools:{async close(){},async status(){throw new Error('Unexpected desktop request');}},
    downloadsOptions:{fetchImpl:async()=>{throw new Error('Unexpected catalog request');}},
  });
  await listenFixture(app.server);const origin=`http://127.0.0.1:${app.server.address().port}`;
  const request=(pathname,extra={})=>fetch(origin+pathname,{signal:AbortSignal.timeout(5000),redirect:'manual',...extra});
  const present=await request('/downloads/PetPal-0.9.7-Windows-x64.zip');assert.equal(present.status,200);assert.equal(await present.text(),'PK-latest-package-fixture');
  for(const pathname of ['/downloads','/downloads/','/downloads/PetPal-0.9.6-Windows-x64.zip','/downloads/nested/removed.apk']){
    const missing=await request(pathname);assert.equal(missing.status,404,pathname);assert.match(missing.headers.get('content-type'),/application\/json/);assert.match((await missing.json()).error,/安装包/);
  }
  const head=await request('/downloads/removed.apk',{method:'HEAD'});assert.equal(head.status,404);assert.equal(await head.text(),'');
  for(const pathname of ['/','/settings','/downloads-guide']){
    const spa=await request(pathname);assert.equal(spa.status,200,pathname);assert.match(await spa.text(),/isolated SPA fixture/);
  }
  const api=await request('/api/downloads');assert.equal(api.status,401,'API authentication boundary remains in force');await api.arrayBuffer();
});
