import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const compile=async file=>ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{
  fileName:file,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText;
const [platformSource,settingsSource]=await Promise.all([compile('../src/platform/opencli.ts'),compile('../src/OpenCliSettings.tsx')]);
function load(source,modules,extra={}){
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>{
    if(name.endsWith('.css'))return{};
    if(!Object.hasOwn(modules,name))throw new Error(`Unexpected dependency: ${name}`);
    return modules[name];
  },URL,URLSearchParams,AbortController,Promise,...extra});
  return module.exports;
}
const platform=load(platformSource,{'../api':{}});
const plain=value=>JSON.parse(JSON.stringify(value));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function nodes(tree){
  if(Array.isArray(tree))return tree.flatMap(nodes);
  if(!tree||typeof tree!=='object')return[];
  return[tree,...nodes(tree.props?.children)];
}
function textContent(tree){
  if(Array.isArray(tree))return tree.map(textContent).join('');
  if(tree===null||tree===undefined||typeof tree==='boolean')return'';
  if(typeof tree!=='object')return String(tree);
  return textContent(tree.props?.children);
}

/** Execute the component's real state, effects and event handlers with a deterministic hook host. */
function fixture({connected=true,user={isOwner:true},native=false,onPrepareBrowser,prepareBrowserDisabled=false,setup,websiteAccess,browserReady=false}={}){
  let epoch=1,active,props={connected,user,onPrepareBrowser,prepareBrowserDisabled},saved={revision:'saved-one',enabled:true};
  const defaultOrigins={dyyj:['https://bbs.dyyjmax.org','https://bbs.dyyjv.com'],switch520:['https://520switch.com'],gamer520:['https://gamer520.com'],dygang:['https://dygangs.me'],wlgo:['https://wlgooo.com'],'fire-exam':['https://xfhyjd.119.gov.cn']};
  const originsFor=site=>saved.siteOrigins?.[site]||defaultOrigins[site]||['https://example.invalid'];
  const browserSites=['bing','baidu-search','baidu-pan','tieba','bilibili','quark','xunlei-pan'];
  const calls=[],events=new EventTarget(),owner={index:0,hooks:[],effects:[],tree:null};
  const status=()=>({config:saved,queryReady:true,available:true,ready:browserReady,profiles:browserReady?[{id:'chrome-a',label:'Chrome',connected:true}]:[],selectedProfileId:browserReady?'chrome-a':null,daemon:{state:'stopped'},extension:{connected:browserReady},version:'1.8.8',...(setup?{setup}:{}),...(websiteAccess?{websiteAccess}:{})});
  const catalog=()=>({version:'1.8.8',summary:{adapterNamespaces:179,totalCommands:1366,readCommands:1009,writeCommands:357,browserCommands:1042,querySites:24,queryCommands:40,publicQueryCommands:27,browserQueryCommands:13,configuredSites:6},
    sites:[...platform.openCliConfiguredSites.map(({site,label})=>({site,label,domains:originsFor(site).map(origin=>new URL(origin).hostname),commands:2,queryCommands:2,browserCommands:1,enabledCommands:['search','read'],needsBrowserBridge:true,local:false,id:site,mode:'configured',websiteStatus:'ready'})),...browserSites.map(site=>({site,domains:['example.invalid'],commands:1,queryCommands:1,browserCommands:1,enabledCommands:['search'],needsBrowserBridge:true,local:false,id:site,mode:'browser'}))],
    notebookSites:[...platform.openCliConfiguredSites.map(({site,label})=>({site,label,origins:originsFor(site),status:'ready',commands:['search','read']})),...browserSites.map(site=>({site,label:site,origins:['https://example.invalid'],status:'ready',commands:['search']}))]});
  const transport={native,
    status:async()=>{calls.push(['status']);return status();},
    sites:async body=>{calls.push(['sites',body]);return catalog();},
    configure:async body=>{calls.push(['configure',plain(body)]);saved={...plain(body),revision:'saved-two'};return saved;},
    action:async body=>{calls.push(['action',plain(body)]);return{tab:{url:body.url}};},cancel:async()=>{calls.push(['cancel']);},
  };
  const react={
    useState:initial=>{
      const index=active.index++;
      if(!owner.hooks[index])owner.hooks[index]={state:typeof initial==='function'?initial():initial};
      return[owner.hooks[index].state,value=>{owner.hooks[index].state=typeof value==='function'?value(owner.hooks[index].state):value;}];
    },
    useRef:initial=>{
      const index=active.index++;
      if(!owner.hooks[index])owner.hooks[index]={ref:{current:initial}};
      return owner.hooks[index].ref;
    },
    useEffect:(effect,deps)=>{
      const index=active.index++,previous=owner.hooks[index];
      if(!previous||deps.some((value,at)=>!Object.is(value,previous.deps?.[at])))owner.effects.push(()=>{
        previous?.cleanup?.();owner.hooks[index]={deps,cleanup:effect()};
      });
    },
  };
  const element=(type,props)=>({type,props});
  const Component=load(settingsSource,{
    react,'react/jsx-runtime':{jsx:element,jsxs:element},
    './api':{getSessionEpoch:()=>epoch,isSessionChanged:()=>false},
    './platform/opencli':{...platform,openCliTransport:()=>transport},
    'lucide-react':Object.fromEntries(['ArrowUpRight','Check','ChevronDown','Globe2','Loader2','RefreshCw','Search','Unplug'].map(name=>[name,Symbol(name)])),
  },{window:events}).default;
  owner.render=()=>{owner.index=0;owner.effects=[];active=owner;owner.tree=Component(props);active=null;for(const effect of owner.effects)effect();return owner.tree;};
  owner.unmount=()=>{for(const hook of owner.hooks)hook?.cleanup?.();};
  const find=(type,predicate=()=>true)=>nodes(owner.tree).find(node=>node.type===type&&predicate(node.props,node));
  owner.render();
  return{owner,transport,calls,find,
    ready:async()=>{await flush();owner.render();},
    edit:(site,value,index=0)=>{find('input',props=>props.id===`opencli-origin-${site}-${index}`).props.onChange({target:{value}});owner.render();},
    save:async()=>{await find('form').props.onSubmit({preventDefault(){}});owner.render();},
    setSaved:value=>{saved=value;},setProps:value=>{props={...props,...value};owner.render();},
    changeSession:()=>{epoch++;events.dispatchEvent(new Event('petpal:session-change'));},
    text:()=>textContent(owner.tree),
  };
}

test('universal website entry follows the actual runtime capability and selected browser',async()=>{
  const legacy=fixture();await legacy.ready();
  assert.equal(legacy.find('input',props=>props['aria-label']==='OpenCLI 网站地址'),undefined);
  legacy.owner.unmount();
  const offline=fixture({websiteAccess:'all'});await offline.ready();
  assert.match(offline.text(),/默认支持所有 HTTP/);
  assert.equal(offline.find('form',props=>props.className==='opencli-web-open').props.children[1].props.disabled,true);
  offline.owner.unmount();
  const f=fixture({websiteAccess:'all',browserReady:true});await f.ready();
  f.find('input',props=>props['aria-label']==='OpenCLI 网站地址').props.onChange({target:{value:'https://soutxt8.com/'}});f.owner.render();
  f.find('form',props=>props.className==='opencli-web-open').props.onSubmit({preventDefault(){}});
  await f.ready();
  assert.deepEqual(f.calls.find(([kind])=>kind==='action'),['action',{action:'open',profileId:'chrome-a',url:'https://soutxt8.com/'}]);
  f.changeSession();f.setProps({connected:false,user:undefined});
  assert.equal(f.find('input',props=>props['aria-label']==='OpenCLI 网站地址'),undefined);f.owner.unmount();
});

test('old two-field configs start with empty origins and clearing a site preserves the CAS revision',()=>{
  const config={revision:'old-revision',enabled:true},draft=platform.openCliOriginDraft(config);
  assert.equal(platform.openCliConfigChanged(config,true,draft),false);
  draft.dyyj=[' https://PRIMARY.EXAMPLE/ ',''];
  draft.switch520=['  '];
  const patch=platform.openCliConfigPatch(config,false,draft);
  assert.deepEqual(plain(patch),{revision:'old-revision',enabled:false,siteOrigins:{dyyj:['https://primary.example']}});
  const saved={...config,siteOrigins:{gamer520:['https://game.example']}};
  assert.equal(platform.openCliConfigChanged(saved,true,platform.openCliOriginDraft(saved)),false);
  const cleared=platform.openCliOriginDraft(saved);cleared.gamer520=[''];
  assert.equal(platform.openCliConfigChanged(saved,true,cleared),true);
  assert.deepEqual(plain(platform.openCliConfigPatch(saved,true,cleared)).siteOrigins,{});
});

test('origin editor rejects unsafe formats and preserves input instead of sending a malformed config',()=>{
  const config={revision:'saved',enabled:true};
  for(const origin of ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com/?secret=1','https://example.com/#fragment','not a url']){
    const draft=platform.openCliOriginDraft(config);draft.switch520=[origin];
    assert.throws(()=>platform.openCliConfigPatch(config,true,draft));assert.equal(draft.switch520[0],origin);
  }
  const draft=platform.openCliOriginDraft(config);draft.gamer520=['https://one.example','https://two.example'];
  assert.throws(()=>platform.openCliConfigPatch(config,true,draft),/最多/);
});

test('logged-out and unprivileged settings do not read the runtime or show account website URLs',async()=>{
  for(const props of [{connected:false,user:{isOwner:true}},{user:{isOwner:false}},{native:true,user:{canUseCodex:true,agentAccess:'workspace'}}]){
    const f=fixture(props);await f.ready();assert.deepEqual(f.calls,[]);
    assert.equal(f.find('input',props=>props.type==='url'),undefined);assert.equal(f.find('button',props=>props.type==='submit').props.disabled,true);
    f.owner.unmount();
  }
});

test('the 13-site section renders optional origin overrides and saves them in the same CAS form',async()=>{
  const f=fixture();await f.ready();
  assert.match(f.text(),/13 个入口/);assert.equal(f.text().includes('待配置网址'),false);
  assert.equal(nodes(f.owner.tree).filter(node=>node.type==='input'&&node.props.type==='url').length,7);
  assert.equal(f.find('details',props=>props.className==='opencli-notebook').props.open,undefined);
  assert.equal(f.find('input',props=>props.id==='opencli-origin-dyyj-0').props.value,'');
  assert.equal(f.find('input',props=>props.id==='opencli-origin-dyyj-0').props.placeholder,'https://bbs.dyyjmax.org');
  assert.equal(f.find('input',props=>props.id==='opencli-origin-dyyj-1').props.placeholder,'https://bbs.dyyjv.com');
  f.edit('dyyj',' https://Primary.Example/ ');
  f.edit('dyyj','https://backup.example',1);
  f.edit('fire-exam','https://exam.example');
  assert.equal(f.find('button',props=>props.type==='submit').props.disabled,false);
  await f.save();
  assert.deepEqual(f.calls.find(([kind])=>kind==='configure')[1],{revision:'saved-one',enabled:true,siteOrigins:{dyyj:['https://primary.example','https://backup.example'],'fire-exam':['https://exam.example']}});
  assert.equal(f.find('input',props=>props.id==='opencli-origin-dyyj-0').props.value,'https://primary.example');
  assert.match(f.text(),/13 个入口/);assert.match(f.text(),/设置已保存/);
  assert.equal(f.find('button',props=>props.type==='submit').props.disabled,true);f.owner.unmount();
});

test('clearing an override saves its removal and shows the restored default website',async()=>{
  const f=fixture();await f.ready();f.edit('switch520','https://override.example');await f.save();
  assert.equal(f.find('input',props=>props.id==='opencli-origin-switch520-0').props.value,'https://override.example');
  f.edit('switch520','');await f.save();
  const patch=f.calls.filter(([kind])=>kind==='configure').at(-1)[1];
  assert.deepEqual(patch.siteOrigins,{});assert.equal(patch.revision,'saved-two');
  assert.equal(f.find('input',props=>props.id==='opencli-origin-switch520-0').props.placeholder,'https://520switch.com');
  assert.match(f.text(),/清空并保存可恢复默认网址/);f.owner.unmount();
});

test('failed save and passive refresh retain edits while an explicit restore replaces the draft',async()=>{
  const f=fixture();await f.ready();f.edit('switch520','https://draft.example');
  f.transport.configure=async()=>{throw Error('配置冲突，请重新读取');};
  await f.save();assert.match(f.text(),/配置冲突/);
  assert.equal(f.find('input',props=>props.id==='opencli-origin-switch520-0').props.value,'https://draft.example');
  assert.equal(f.find('button',props=>props.type==='submit').props.disabled,false);
  f.setSaved({revision:'external-change',enabled:false,siteOrigins:{switch520:['https://saved.example']}});
  await f.find('button',(_props,node)=>textContent(node)==='刷新状态').props.onClick();await flush();f.owner.render();
  assert.equal(f.find('input',props=>props.id==='opencli-origin-switch520-0').props.value,'https://draft.example');
  f.find('button',(_props,node)=>textContent(node)==='恢复已保存设置').props.onClick();await flush();f.owner.render();
  assert.equal(f.find('input',props=>props.id==='opencli-origin-switch520-0').props.value,'https://saved.example');
  assert.equal(f.find('input',props=>props.type==='checkbox').props.checked,false);
  assert.equal(f.find('button',props=>props.type==='submit').props.disabled,true);f.owner.unmount();
});

test('an invalid draft stays visible and never invokes configure',async()=>{
  const f=fixture();await f.ready();f.edit('wlgo','http://invalid.example');await f.save();
  assert.equal(f.calls.some(([kind])=>kind==='configure'),false);assert.match(f.text(),/只接受 HTTPS/);
  assert.equal(f.find('input',props=>props.id==='opencli-origin-wlgo-0').props.value,'http://invalid.example');f.owner.unmount();
});

test('an old-session save result cannot publish URLs or trigger more reads after logout',async()=>{
  const f=fixture();await f.ready();f.edit('dygang','https://draft.example');
  const pending=deferred();let entered=false;
  f.transport.configure=async()=>{entered=true;return pending.promise;};
  const saving=f.save();assert.equal(entered,true);const reads=f.calls.length;
  f.changeSession();f.setProps({connected:false,user:undefined});
  pending.resolve({revision:'late-result',enabled:true,siteOrigins:{dygang:['https://late-private.example']}});
  await saving;await flush();f.owner.render();
  assert.equal(f.calls.length,reads);assert.equal(f.find('input',props=>props.type==='url'),undefined);
  assert.equal(f.text().includes('late-private.example'),false);f.owner.unmount();
});

test('browser guidance names the managed host and does not treat a legacy status as Chrome installation proof',async()=>{
  for(const options of [{},{native:true,user:{isOwner:true,canUseCodex:true}}]){
    const f=fixture(options);await f.ready();
    assert.match(f.text(),/Chrome 尚未检测/);assert.equal(f.text().includes('已检测到 Chrome'),false);
    assert.match(f.text(),options.native?/下方检测和连接管理这台电脑/:/下方检测和连接管理服务主机/);
    assert.match(f.text(),/聊天任务使用你在聊天中选择的执行电脑/);
    assert.match(f.text(),/网页或 Android 没有 Chrome，也可通过远程电脑/);
    assert.equal(f.find('ol',props=>props.className==='opencli-browser-steps').props.children.length,3);
    assert.equal(f.find('a',props=>props.href==='https://www.google.com/chrome/').props.target,'_blank');
    assert.equal(f.find('a',props=>props.href.includes('chromewebstore.google.com')).props.rel,'noreferrer');
    assert.match(f.text(),/由你确认安装并授权连接/);
    f.owner.unmount();
  }
});

test('setup detection is shown only with management permission and is hidden immediately on logout',async()=>{
  const setup={platform:'win32',arch:'x64',supported:true,chromeInstalled:true,installerSupported:true,extensionUrl:'https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk',downloadPage:'https://www.google.com/chrome/',message:'fixture-host-setup-message'};
  const f=fixture({setup});await f.ready();
  assert.match(f.text(),/服务主机：已检测到 Chrome · win32\/x64/);assert.match(f.text(),/fixture-host-setup-message/);
  f.setProps({connected:false,user:undefined});
  assert.equal(f.text().includes('已检测到 Chrome'),false);assert.equal(f.text().includes('fixture-host-setup-message'),false);
  assert.equal(f.find('select',props=>props['aria-label']==='OpenCLI 浏览器档案').props.value,'');f.owner.unmount();
});

test('prepare browser invokes only the draft callback and leaves transport configuration and permissions unchanged',async()=>{
  const received=[],user={isOwner:true,canUseCodex:true,agentAccess:'workspace'};
  const f=fixture({user,onPrepareBrowser:(...args)=>received.push(args)});await f.ready();
  const calls=plain(f.calls),permissions=plain(user),button=f.find('button',(_props,node)=>textContent(node)==='让 Agent 准备浏览器');
  assert.equal(button.props.disabled,false);button.props.onClick();
  assert.deepEqual(received,[[]]);assert.deepEqual(plain(f.calls),calls);assert.deepEqual(user,permissions);
  assert.match(f.text(),/生成任务草稿，在聊天所选执行电脑上准备；由你发送，沿用当前权限/);
  f.owner.unmount();
});

test('remote preparation can use a member callback without reading service-owner configuration',async()=>{
  let prepared=0;
  const f=fixture({user:{canUseCodex:true,agentAccess:'full',isOwner:false},onPrepareBrowser:()=>prepared++});await f.ready();
  assert.deepEqual(f.calls,[]);const button=f.find('button',(_props,node)=>textContent(node)==='让 Agent 准备浏览器');
  assert.equal(button.props.disabled,false);button.props.onClick();assert.equal(prepared,1);assert.deepEqual(f.calls,[]);f.owner.unmount();
});

test('prepare is hidden without a callback and guarded for login, disabled state, busy work and stale sessions',async()=>{
  const absent=fixture();await absent.ready();assert.equal(absent.find('button',(_props,node)=>textContent(node)==='让 Agent 准备浏览器'),undefined);absent.owner.unmount();
  for(const options of [{connected:false},{user:null},{prepareBrowserDisabled:true}]){
    let prepared=0;const f=fixture({...options,onPrepareBrowser:()=>prepared++});await f.ready();
    const button=f.find('button',(_props,node)=>textContent(node)==='让 Agent 准备浏览器');
    assert.equal(button.props.disabled,true);button.props.onClick();assert.equal(prepared,0);f.owner.unmount();
  }
  let prepared=0;const f=fixture({onPrepareBrowser:()=>prepared++});await f.ready();
  const done=deferred(),previousStatus=f.transport.status;
  f.transport.status=async()=>{await done.promise;return previousStatus();};
  f.find('button',(_props,node)=>textContent(node)==='刷新状态').props.onClick();f.owner.render();
  const busy=f.find('button',(_props,node)=>textContent(node)==='让 Agent 准备浏览器');assert.equal(busy.props.disabled,true);busy.props.onClick();assert.equal(prepared,0);
  done.resolve();await flush();f.owner.render();
  const enabled=f.find('button',(_props,node)=>textContent(node)==='让 Agent 准备浏览器');assert.equal(enabled.props.disabled,false);
  f.changeSession();enabled.props.onClick();assert.equal(prepared,0);f.owner.unmount();
});
