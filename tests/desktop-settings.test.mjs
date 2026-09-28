import test from 'node:test';
import assert from 'node:assert/strict';
import {codexConfigPatch,canControlPlayer,canOpenMusicSite,playerStateLabel} from '../src/desktop-settings.mjs';

const config={mode:'api',baseUrl:'https://api.example/v1',model:'example',hasApiKey:true,revision:'saved-revision',protocol:'responses',configured:true};
const draft={mode:'api',baseUrl:config.baseUrl,model:config.model,apiKey:'',clearApiKey:false};
test('Codex form preserves a saved secret by omission and binds changes to the read revision',()=>{
  const patch=codexConfigPatch(config,draft);
  assert.deepEqual(patch,{mode:'api',baseUrl:config.baseUrl,model:'example',revision:'saved-revision'});
  assert.equal(Object.hasOwn(patch,'hasApiKey'),false);assert.equal(Object.hasOwn(patch,'apiKey'),false);
  assert.deepEqual(codexConfigPatch(config,{...draft,apiKey:' new-key '}),{...patch,apiKey:'new-key'});
  assert.deepEqual(codexConfigPatch(config,{...draft,clearApiKey:true}),{...patch,clearApiKey:true});
  assert.throws(()=>codexConfigPatch(config,{...draft,apiKey:'key',clearApiKey:true}),/只能选择/);
});
test('an incomplete API form cannot be saved while host mode requires no API credentials',()=>{
  assert.throws(()=>codexConfigPatch(config,{...draft,model:' '}),/模型/);
  assert.throws(()=>codexConfigPatch(config,{...draft,baseUrl:''}),/地址/);
  assert.equal(codexConfigPatch(config,{...draft,mode:'host',model:'',baseUrl:''}).mode,'host');
});
test('media UI never substitutes installation for a supported live media control',()=>{
  const installed={installed:true,session:false,controls:[]};
  assert.equal(canControlPlayer(installed,'open'),true);assert.equal(canControlPlayer(installed,'play'),false);
  assert.equal(canControlPlayer({...installed,session:true,controls:['pause']},'pause'),true);
  assert.equal(canControlPlayer({...installed,session:true,controls:['pause']},'next'),false);
  assert.equal(canControlPlayer({...installed,installed:false},'open'),false);
  assert.equal(playerStateLabel(installed),'已安装 · 无可控媒体会话');
  assert.equal(playerStateLabel({...installed,session:true,state:'Paused'}),'已暂停');
});
test('a changed or disconnected browser selection cannot use a prior ready profile',()=>{
  const status={ready:true,selectedProfileId:'work',profiles:[{id:'work',connected:true},{id:'personal',connected:true}]};
  assert.equal(canOpenMusicSite(status,'work'),true);
  assert.equal(canOpenMusicSite(status,'personal'),false);
  assert.equal(canOpenMusicSite(status,''),false);
  assert.equal(canOpenMusicSite({...status,profiles:[{id:'work',connected:false}]},'work'),false);
  assert.equal(canOpenMusicSite({...status,ready:false},'work'),false);
});
