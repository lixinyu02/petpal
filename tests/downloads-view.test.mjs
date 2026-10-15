import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/DownloadsView.tsx',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react/jsx-runtime','react/jsx-dev-runtime'],loader:{'.css':'empty'},plugins:[{name:'isolated-download-api',setup(builder){
  builder.onLoad({filter:/src[\\/]api\.ts$/},()=>({contents:'export const api=(path,options)=>apiFixture.api(path,options);export const getConnection=()=>({url:apiFixture.serverUrl||""});export const getSessionEpoch=()=>1;export const isSessionChanged=()=>false;',loader:'ts'}));
}}]});
function load(react=require('react'),apiFixture={},window=new EventTarget(),navigation={}){
  const compiled={exports:{}};
  new Function('require','module','exports','apiFixture','window','navigator',bundle.outputFiles[0].text)(name=>name==='react'?react:require(name),compiled,compiled.exports,apiFixture,window,navigation);
  return compiled.exports;
}
const compiled=load();
const {latestStableDownloadPackages}=compiled;
const item=(id,version,platform,extra={})=>({id,version,platform,channel:'stable',arch:platform==='android'?'universal':'x64',format:platform==='android'?'apk':'portable-zip',publishedAt:'2026-10-03T00:00:00Z',...extra});

test('the UI filters old mixed catalogs globally before grouping by platform, retaining latest architecture/format alternatives',()=>{
  const source=[item('old','0.9.99','ubuntu'),item('zip','0.10.0','windows',{publishedAt:'2026-01-01T00:00:00Z'}),item('exe','0.10.0','windows',{format:'portable-exe'}),item('arm','0.10.0','windows',{arch:'arm64'}),item('android','0.10.0','android')].map(Object.freeze);
  Object.freeze(source);
  const latest=latestStableDownloadPackages(source);
  assert.deepEqual(latest.map(value=>value.id),['zip','exe','arm','android']);
  assert.equal(latest.some(value=>value.platform==='ubuntu'),false,'no platform-specific historical fallback');
  assert.equal(source.length,5,'does not rewrite a cached response');
});

test('the UI rejects preview flags and semantic suffixes even when an older server calls them stable',()=>{
  const invalid=[item('flag','10.0.0','windows',{channel:'preview'}),...['3.0.0-rc.1','3.0.0-preview','3.0.0+build.1','03.0.0','v3.0.0'].map((version,index)=>item(String(index),version,'windows'))];
  assert.deepEqual(latestStableDownloadPackages(invalid),[]);
  const stable=item('stable','0.9.7','android');
  assert.deepEqual(latestStableDownloadPackages([...invalid,stable]),[stable]);
  assert.deepEqual(latestStableDownloadPackages([]),[]);
});

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return[];return[tree,...nodes(tree.props?.children)];}
/** Run the real component's effects, state and selection handler; no network or global browser state. */
function downloadFixture(packages,{serverUrl='',catalog={},runtime,navigation={}}={}){
  const hooks=[],effects=[];let index=0,tree;
  const react={...require('react'),
    useState(initial){const at=index++;if(!hooks[at])hooks[at]={state:typeof initial==='function'?initial():initial};return[hooks[at].state,value=>{hooks[at].state=typeof value==='function'?value(hooks[at].state):value;}];},
    useRef(initial){const at=index++;if(!hooks[at])hooks[at]={ref:{current:initial}};return hooks[at].ref;},
    useEffect(effect,deps){const at=index++,previous=hooks[at];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps?.[i])))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
    useLayoutEffect(effect,deps){react.useEffect(effect,deps);},
  };
  const apiFixture={serverUrl,api:async path=>{assert.equal(path,'/downloads');return{packages,checkedAt:'2026-10-03T00:00:00Z',error:null,stale:false,retryAt:null,...catalog};}};
  const window=new EventTarget();if(runtime)window.petpal={runtime};
  const Component=load(react,apiFixture,window,navigation).default;
  const render=()=>{index=0;effects.length=0;tree=Component();for(const effect of effects)effect();return tree;};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  render();
  return{find,text:()=>nodes(tree).filter(node=>typeof node.props?.children==='string').map(node=>node.props.children).join(' '),ready:async()=>{await flush();render();},refresh:async()=>{find('button').props.onClick();render();await flush();render();},chooseArchitecture(platform,arch){find('select',props=>props['aria-label']===`${platform} 架构`).props.onChange({target:{value:arch}});render();},choose(platform,id){find('select',props=>props['aria-label']===`${platform} 安装包`).props.onChange({target:{value:id}});render();},close(){for(const hook of hooks)hook?.cleanup?.();}};
}
const download=(id,platform,arch,format)=>({...item(id,'0.9.7',platform,{arch,format}),filename:`PetPal-0.9.7-${platform}-${arch}.${format}`,url:`https://example.invalid/${id}`,releaseUrl:'https://example.invalid/releases/v0.9.7',bytes:1000,debug:false});

test('unknown devices require an explicit architecture and ARM64 choice updates the real download link',async t=>{
  const packages=[download('arm','ubuntu','arm64','tar.gz'),download('x64','ubuntu','x64','tar.gz')].map(Object.freeze);
  const f=downloadFixture(Object.freeze(packages));t.after(()=>f.close());await f.ready();
  assert.equal(f.find('select',props=>props['aria-label']==='Ubuntu 架构').props.value,'');
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Ubuntu 0.9.7 x64'),undefined);
  assert.match(f.text(),/手动选择/);f.chooseArchitecture('Ubuntu','x64');
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Ubuntu 0.9.7 x64').props.href,'https://example.invalid/x64');
  f.chooseArchitecture('Ubuntu','arm64');
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Ubuntu 0.9.7 arm64').props.href,'https://example.invalid/arm');
  await f.refresh();
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Ubuntu 0.9.7 arm64').props.href,'https://example.invalid/arm','refreshing the same catalog must retain an explicit architecture choice');
  assert.deepEqual(packages.map(value=>value.id),['arm','x64'],'rendering and choosing must not reorder cached metadata');
});

test('Windows keeps x64 ZIP as the default and EXE remains explicitly selectable',async t=>{
  const f=downloadFixture([download('exe','windows','x64','portable-exe'),download('arm','windows','arm64','portable-zip'),download('zip','windows','x64','portable-zip')],{runtime:{platform:'win32',arch:'x64'}});t.after(()=>f.close());await f.ready();
  assert.equal(f.find('select',props=>props['aria-label']==='Windows 安装包').props.value,'zip');
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Windows 0.9.7 x64').props.href,'https://example.invalid/zip');
  f.choose('Windows','exe');
  assert.equal(f.find('select',props=>props['aria-label']==='Windows 安装包').props.value,'exe');
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Windows 0.9.7 x64').props.href,'https://example.invalid/exe');
});

test('an ARM64-only Ubuntu release is downloadable explicitly and a missing x64 package is not invented',async t=>{
  const f=downloadFixture([download('arm','ubuntu','arm64','tar.gz')]);t.after(()=>f.close());await f.ready();
  assert.equal(f.find('select',props=>props['aria-label']==='Ubuntu 安装包'),undefined);
  f.chooseArchitecture('Ubuntu','arm64');
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Ubuntu 0.9.7 arm64').props.href,'https://example.invalid/arm');
  f.chooseArchitecture('Ubuntu','x64');assert.equal(f.find('a',props=>props['aria-label']==='下载 Ubuntu 0.9.7 arm64'),undefined);assert.match(f.text(),/尚未提供 Ubuntu x64/);
});

test('a declared newest version keeps an older mixed client catalog hidden even when its newest assets are absent',()=>{
  assert.deepEqual(latestStableDownloadPackages([item('old','0.9.7','windows')],'0.9.8'),[]);
});

test('local download URLs follow the connected backend and expose the independently selectable GitHub fallback',async t=>{
  const name='PetPal-0.9.7-Windows-x64.zip',fallback='https://github.com/lixinyu02/petpal/releases/download/v0.9.7/'+name;
  const f=downloadFixture([{...download('local','windows','x64','portable-zip'),filename:name,source:'server',url:'/downloads/'+name,fallbackUrl:fallback}],
    {serverUrl:'https://petpal.example:44318',runtime:{platform:'win32',arch:'x64'}});t.after(()=>f.close());await f.ready();
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Windows 0.9.7 x64').props.href,'https://petpal.example:44318/downloads/'+name);
  assert.equal(f.find('a',props=>props.children?.[0]==='GitHub 备用').props.href,fallback);
});

test('native ARM64 recommendation never falls back to a published x64 package',async t=>{
  const f=downloadFixture([download('zip','windows','x64','portable-zip')],{runtime:{platform:'win32',arch:'arm64'}});t.after(()=>f.close());await f.ready();
  assert.equal(f.find('select',props=>props['aria-label']==='Windows 架构').props.value,'arm64');
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Windows 0.9.7 x64'),undefined);
  assert.match(f.text(),/尚未提供 Windows ARM64/);assert.match(f.text(),/当前客户端：Windows ARM64/);
});

test('Chrome ARM64 detection selects its own platform while another platform stays explicitly selectable',async t=>{
  const f=downloadFixture([download('windows','windows','arm64','portable-zip'),download('linux','ubuntu','arm64','tar.gz')],{navigation:{userAgentData:{platform:'Windows',getHighEntropyValues:async()=>({platform:'Windows',architecture:'arm',bitness:'64'})}}});t.after(()=>f.close());await f.ready();
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Windows 0.9.7 arm64').props.href,'https://example.invalid/windows');
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Ubuntu 0.9.7 arm64'),undefined);
  f.chooseArchitecture('Ubuntu','arm64');assert.equal(f.find('a',props=>props['aria-label']==='下载 Ubuntu 0.9.7 arm64').props.href,'https://example.invalid/linux');
});

test('a manual architecture choice survives late detection and catalog refresh',async t=>{
  let resolve;const pending=new Promise(yes=>{resolve=yes;});
  const f=downloadFixture([download('x64','windows','x64','portable-zip'),download('arm','windows','arm64','portable-zip')],{navigation:{userAgentData:{platform:'Windows',getHighEntropyValues:()=>pending}}});t.after(()=>f.close());await f.ready();
  f.chooseArchitecture('Windows','x64');resolve({platform:'Windows',architecture:'arm',bitness:'64'});await f.ready();
  assert.equal(f.find('select',props=>props['aria-label']==='Windows 架构').props.value,'x64');
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Windows 0.9.7 x64').props.href,'https://example.invalid/x64');
  await f.refresh();assert.equal(f.find('select',props=>props['aria-label']==='Windows 架构').props.value,'x64');
});

test('Android universal stays directly downloadable when desktop architecture is unknown',async t=>{
  const f=downloadFixture([download('apk','android','universal','apk'),download('pc','windows','x64','portable-zip')]);t.after(()=>f.close());await f.ready();
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Android 0.9.7 universal').props.href,'https://example.invalid/apk');
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Windows 0.9.7 x64'),undefined);
  assert.equal(f.find('select',props=>props['aria-label']==='Android 架构'),undefined);
});

test('legacy Win64 x64 UA cannot expose an automatic desktop download link',async t=>{
  const f=downloadFixture([download('pc','windows','x64','portable-zip')],{navigation:{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/146.0'}});t.after(()=>f.close());await f.ready();
  assert.equal(f.find('select',props=>props['aria-label']==='Windows 架构').props.value,'');
  assert.equal(f.find('a',props=>props['aria-label']==='下载 Windows 0.9.7 x64'),undefined);
  f.chooseArchitecture('Windows','x64');assert.equal(f.find('a',props=>props['aria-label']==='下载 Windows 0.9.7 x64').props.href,'https://example.invalid/pc');
});
