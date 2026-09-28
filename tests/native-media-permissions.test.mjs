import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const {canRequestMedia,canCheckMedia}=createRequire(import.meta.url)('../desktop/media-permissions.cjs');
const origin='http://127.0.0.1:54321';
function context(url=origin+'/?chat=1') {
  const webContents={getURL:()=>url};
  return {origin,webContents,mainWindow:{webContents,isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false}};
}
const details={isMainFrame:true,requestingUrl:origin+'/?chat=1',mediaTypes:['audio','video']};

test('only local main-window media and speaker selection requests are granted',()=>{
  const ctx=context();assert.equal(canRequestMedia(ctx,'media',details),true);
  assert.equal(canRequestMedia(ctx,'speaker-selection',details),true);
  for(const permission of ['display-capture','geolocation','notifications','midi'])assert.equal(canRequestMedia(ctx,permission,details),false);
  for(const override of [{isMainFrame:false},{requestingUrl:'https://example.com'},{requestingUrl:origin+'/?pet=1'},{mediaTypes:[]},{mediaTypes:['screen']}])assert.equal(canRequestMedia(ctx,'media',{...details,...override}),false);
  assert.equal(canRequestMedia({...ctx,webContents:{getURL:()=>origin}},'media',details),false);
  assert.equal(canRequestMedia(context(origin+'/?overlay=1'),'media',details),false);
  ctx.mainWindow.isVisible=()=>false;assert.equal(canRequestMedia(ctx,'media',details),false);
});

test('permission checks require same origin, main frame and known microphone/camera type',()=>{
  const ctx=context(),check={...details,mediaType:'audio'};
  assert.equal(canCheckMedia(ctx,'media',origin,check),true);
  assert.equal(canCheckMedia(ctx,'media',origin,{...check,mediaType:'video'}),true);
  assert.equal(canCheckMedia(ctx,'speaker-selection',origin,{isMainFrame:true,requestingUrl:origin+'/?chat=1'}),true);
  assert.equal(canCheckMedia(ctx,'speaker-selection',origin,{isMainFrame:false,requestingUrl:origin+'/?chat=1'}),false);
  assert.equal(canCheckMedia(ctx,'media','https://example.com',check),false);
  assert.equal(canCheckMedia(ctx,'media',origin,{...check,isMainFrame:false}),false);
  assert.equal(canCheckMedia(ctx,'media',origin,{...check,mediaType:'unknown'}),false);
  assert.equal(canCheckMedia(ctx,'geolocation',origin,check),false);
});
