import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as executionHosts from '../src/execution-hosts.mjs';
import * as projectPreferences from '../src/project-directory-preferences.mjs';
import {watchCompanionBreakpoint} from '../src/companion-mount.mjs';
import {createChatDisplay} from '../src/chat-display.mjs';
import {mergeAssistantTask,mergeChatAssistantConversation} from '../src/chat-assistant-preferences.mjs';
import {createBrowserSetupDraft} from '../src/browser-setup-draft.mjs';
import {reasoningEfforts} from '../src/desktop-settings.mjs';
import * as uiMotion from '../src/platform/ui-motion.mjs';
import {composerKeyAction} from '../src/composer-keyboard.mjs';

const source=ts.transpileModule(await readFile(new URL('../src/App.tsx',import.meta.url),'utf8'),{
  fileName:'App.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText;
const motionSource=ts.transpileModule(await readFile(new URL('../src/platform/ui-motion.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true},
}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);

/** Mount App itself and execute its real effects/handlers. Child UIs and network are isolated. */
function workspaceFixture({canUseCodex=false,storage,deniedGetter=false,touch=false,native=false,desktop=false,holdStream=false,attachmentItems=[],attachmentUploading=false}={}){
  const permissions={access:'read-only',approval:'ask'},identity={instanceId:'fixture-service',userId:'fixture-user'};
  const state={instanceId:identity.instanceId,user:{id:identity.userId,username:'fixture',displayName:'Fixture',isOwner:false,canUseCodex,agentAccess:canUseCodex?'full':'none'},
    settings:{petName:'Fixture companion',persona:'Fixture',companionKind:'anime',defaultProviderId:'model'},
    providers:[{id:'model',name:'Fixture model',model:'fixture-model',protocol:'responses',supportsImages:true}],conversations:[],codex:{available:true,eligibleProviderIds:['model']}};
  const hosts=[{id:'central',name:'Fixture server',kind:'central',platform:'linux',online:true},
    {id:'pc-one',name:'Fixture PC one',kind:'desktop',platform:'win32',online:true,codex:{available:true}},
    {id:'pc-two',name:'Fixture PC two',kind:'desktop',platform:'linux',online:true,codex:{available:true}}];
  const hooks=[],effects=[],timers=new Map(),calls=[],requests=[],streams=[],navigations=[],backendConversations=[],window=new EventTarget(),document=new EventTarget();
  let index=0,tree,timerId=0,getterReads=0;
  Object.assign(window,{matchMedia:query=>({matches:query==='(pointer: coarse)'&&touch,addEventListener(){},removeEventListener(){}})});
  if(desktop)window.petpal={};
  const readStorage=()=>{getterReads++;if(deniedGetter)throw new DOMException('Storage is blocked','SecurityError');return storage;};
  Object.defineProperty(window,'localStorage',{get:readStorage});
  document.hidden=false;
  const react={
    ...React,
    useState(initial){const at=index++;if(!hooks[at])hooks[at]={state:typeof initial==='function'?initial():initial};return[hooks[at].state,value=>{hooks[at].state=typeof value==='function'?value(hooks[at].state):value;}];},
    useRef(initial){const at=index++;if(!hooks[at])hooks[at]={ref:{current:initial}};return hooks[at].ref;},
    useEffect(effect,deps){const at=index++,previous=hooks[at];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps?.[i])))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
    useLayoutEffect(effect,deps){react.useEffect(effect,deps);},
    useMemo:callback=>callback(),useCallback:callback=>callback,useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),
  };
  const element=(type,props)=>({type,props}),component=name=>({__esModule:true,default:Symbol(name)});
  const controls=Object.fromEntries(['ModelPicker','ExecutionTarget','AgentOnboarding'].map(name=>[name,Symbol(name)]));
  const api={getConnection:()=>({url:'https://fixture.invalid',token:'fixture-token'}),getIdentity:()=>identity,getSessionEpoch:()=>1,
    initConnection:async()=>({url:'https://fixture.invalid',token:'fixture-token'}),isSessionChanged:()=>false,SessionChangedError:Error,
    api:async(path,options={})=>{
      calls.push(path);requests.push({path,method:options.method||'GET',body:options.body?JSON.parse(options.body):undefined});
      if(path==='/state')return{...state,conversations:[...backendConversations]};
      if(path==='/agent/hosts')return{hosts};
      if(path==='/conversations'&&options.method==='POST'){
        const body=JSON.parse(options.body),conversation={id:`fixture-chat-${backendConversations.length+1}`,mode:body.mode,providerId:body.providerId,title:'Fixture chat',messages:[]};
        backendConversations.push(conversation);return conversation;
      }
      throw Error(`Unexpected API call: ${path}`);
    },
    streamMessage:async(id,content,signal,onEvent,attachmentIds,assistant)=>{
      const stream={id,content,signal,attachmentIds,assistant};streams.push(stream);
      if(holdStream){
        let abort;
        try{await new Promise((resolve,reject)=>{
          stream.complete=resolve;abort=()=>reject(new DOMException('Fixture stream aborted','AbortError'));
          signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
        });}finally{signal.removeEventListener('abort',abort);}
      }
      signal.throwIfAborted();
      const conversation=backendConversations.find(item=>item.id===id);
      assert.ok(conversation,'isolated stream must use the conversation created by App');
      const completed={...conversation,messages:[{id:'fixture-user-message',role:'user',content},{id:'fixture-answer',role:'assistant',content:'Fixture reply',status:'complete'}]};
      backendConversations[backendConversations.indexOf(conversation)]=completed;
      onEvent({type:'meta',data:{}});onEvent({type:'done',data:{conversation:completed}});
    },
  };
  const attachments={items:[...attachmentItems],uploading:attachmentUploading,error:'',clear(){attachments.items=[];},inputRef:{current:null}};
  const speech={enabled:false,playing:false,active:false,pending:false,supported:false,stop(){},prepare(){},speak(){},speakIfEnabled(){}};
  const modules={
    react,'react/jsx-runtime':{jsx:element,jsxs:element},'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))}),
    '@capacitor/core':{Capacitor:{isNativePlatform:()=>native}},'./api':api,'./WorkspaceControls':controls,'./composer-keyboard.mjs':{composerKeyAction},
    './companion-mount.mjs':{watchCompanionBreakpoint},'./chat-display.mjs':{createChatDisplay},'./useChatScroll':{useChatScroll:()=>({contentRef:{current:null},onScroll(){},latest(){},showLatest:false})},
    './AgentPermissions':{...component('AgentPermissions'),defaultAgentPermissions:permissions},
    './ProjectDirectory':{...component('ProjectDirectory'),useProjectDirectory:()=>({value:'',change(){}})},
    './project-directory-preferences.mjs':projectPreferences,'./execution-hosts.mjs':executionHosts,
    './ChatAssistant':{ChatAssistantControls:Symbol('ChatAssistantControls'),ChatAssistantTasks:Symbol('ChatAssistantTasks'),useChatAssistant:()=>({value:{hostId:'',providerId:'',enabled:false,permissions},snapshot:()=>undefined})},
    './chat-assistant-preferences.mjs':{mergeAssistantTask,mergeChatAssistantConversation},
    './Attachments':{useAttachments:()=>attachments,AttachmentInput:Symbol('AttachmentInput'),AttachmentDrafts:Symbol('AttachmentDrafts'),MessageImages:Symbol('MessageImages')},
    './auth/LoginGate':{ConnectionDialog:Symbol('ConnectionDialog')},'./avatar/preference':{useCompanion:()=>['anime'],hydrateCompanion:async()=>{},readCompanion:()=> 'anime'},
    './avatar/useSpeech':{useSpeech:()=>speech},'./platform/overlay':{PetOverlay:{},showPet(){}},
    './browser-setup-draft.mjs':{createBrowserSetupDraft},'./platform/computer-use':{nativeComputerUse:()=>undefined},'./platform/music-mcp':{nativeMusicMcp:()=>undefined},
    './platform/task-notification-session':{taskNotificationSession:{subscribe(){},snapshot:()=>({navigation:null}),takeNavigation(){}}},'./desktop-settings.mjs':{reasoningEfforts},
    './ui-motion.mjs':{...uiMotion,createUiMotionController:options=>uiMotion.createUiMotionController({window,document,...options})},
  };
  for(const name of ['DownloadsView','BrandMark','CompanionOptions','ChatMessages','ConversationHistory','AgentQueue','UpdatesSettings','CatV2','WorkspaceDisclosure','AccountsSettings','VoiceSettings','DesktopAssistantSettings','MusicMcpSettings','ComputerUseSettings','OpenCliSettings','ClientBehaviorSettings'])modules[`./${name}`]=component(name);
  const module={exports:{}},context={module,exports:module.exports,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),`Unexpected dependency: ${name}`);return modules[name];},
    window,document,location:{search:'?chat=1',origin:'https://fixture.invalid',assign:path=>navigations.push(path)},URL,URLSearchParams,AbortController,DOMException,
    setTimeout(callback){const id=++timerId;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id)};
  Object.defineProperty(context,'localStorage',{get:readStorage});
  // Execute the actual hook bridge without a documentElement, preserving the off path.
  const motionModule={exports:{}};
  vm.runInNewContext(motionSource,{module:motionModule,exports:motionModule.exports,require:context.require,window,document});
  modules['./platform/ui-motion.ts']=motionModule.exports;
  vm.runInNewContext(source,context);const Component=module.exports.default;
  const render=()=>{index=0;effects.length=0;tree=Component();for(const effect of effects)effect();return tree;};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  render();
  return{find,calls,requests,streams,navigations,attachments,get getterReads(){return getterReads;},text:()=>text(tree),
    ready:async()=>{for(let attempt=0;attempt<3;attempt++){await flush();render();}},
    enterAgent(){find('button',props=>props['aria-label']==='Agent 执行任务').props.onClick();render();},
    selectedHost:()=>find(controls.ExecutionTarget)?.props.value,
    chooseHost(id){find(controls.ExecutionTarget).props.onChange(id);render();},
    typeDraft(value){find('textarea',props=>props['aria-label']==='消息').props.onChange({target:{value}});render();},
    keyDown(properties={}){
      const nativeEvent={key:'Enter',keyCode:13,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,isComposing:false,defaultPrevented:false,...properties};
      let prevented=false;
      find('textarea',props=>props['aria-label']==='消息').props.onKeyDown({nativeEvent,isComposing:false,preventDefault(){prevented=true;nativeEvent.defaultPrevented=true;}});
      render();return prevented;
    },
    openView(label){find('button',props=>text(props.children)===label).props.onClick();render();},
    back(alreadyPrevented=false){const event=new Event('petpal:workspace-back',{cancelable:true});if(alreadyPrevented)event.preventDefault();window.dispatchEvent(event);render();return event.defaultPrevented;},
    async close(){for(const hook of hooks)hook?.cleanup?.();await flush();assert.equal(timers.size,0,'effect cleanup must release every fixture timer');},
  };
}

test('Chat-only workspace loads verified state when the browser storage getter throws SecurityError',async t=>{
  const f=workspaceFixture({deniedGetter:true});t.after(()=>f.close());await f.ready();
  assert.ok(f.getterReads>0,'exercise the actual browser getter rather than only a denied getItem stub');
  assert.ok(f.calls.includes('/state'));assert.match(f.text(),/今天想聊些什么/);assert.match(f.text(),/Fixture companion/);
  assert.equal(f.find('button',props=>props['aria-label']==='Agent 执行任务').props.disabled,true);
});

test('Agent workspace remains usable and a host choice stays in memory with denied browser storage',async t=>{
  const f=workspaceFixture({canUseCodex:true,deniedGetter:true});t.after(()=>f.close());await f.ready();f.enterAgent();await f.ready();
  assert.equal(f.selectedHost(),'central');
  f.chooseHost('pc-two');assert.equal(f.selectedHost(),'pc-two');
  assert.match(f.text(),/Fixture PC two/);assert.ok(f.getterReads>=3,'mount, authenticated scope and explicit host choice all use the protected getter');
  assert.ok(f.calls.every(path=>path==='/state'||path==='/agent/hosts'),'preference changes must not start a task');
});

test('available storage still restores and saves the account-scoped host preference',async t=>{
  const values=new Map([['petpal.agent-host.fixture-service%3Afixture-user','pc-one']]);
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const f=workspaceFixture({canUseCodex:true,storage});t.after(()=>f.close());await f.ready();f.enterAgent();await f.ready();
  assert.equal(f.selectedHost(),'pc-one');f.chooseHost('pc-two');assert.equal(f.selectedHost(),'pc-two');
  assert.equal(values.get('petpal.agent-host.fixture-service%3Afixture-user'),'pc-two');
  assert.deepEqual([...values.keys()],['petpal.agent-host.fixture-service%3Afixture-user']);
});

for(const scenario of[
  {name:'desktop Web',options:{},send:true},
  {name:'touch Web',options:{touch:true},send:false},
  {name:'Android native with a hardware keyboard',options:{native:true},send:false},
  {name:'touchscreen Electron',options:{touch:true,desktop:true},send:true},
]){
  test(`App textarea plain Enter uses the ${scenario.name} send/newline policy`,async t=>{
    const f=workspaceFixture(scenario.options);t.after(()=>f.close());await f.ready();f.typeDraft('测试 Enter');
    assert.equal(f.keyDown(),scenario.send,'only send gestures may prevent the browser newline');await f.ready();
    assert.equal(f.streams.length,scenario.send?1:0);
    assert.equal(f.requests.filter(item=>item.method==='POST').length,scenario.send?1:0);
    if(scenario.send){
      assert.equal(f.streams[0].content,'测试 Enter');assert.equal(f.find('textarea').props.value,'');
      assert.deepEqual(f.requests.filter(item=>item.method==='POST').map(item=>item.path),['/conversations']);
    }else{
      assert.equal(f.find('textarea').props.value,'测试 Enter');
      // onKeyDown leaves the native edit untouched; onChange receives the newline.
      f.typeDraft('测试 Enter\n');assert.equal(f.find('textarea').props.value,'测试 Enter\n');
      assert.ok(f.requests.every(item=>item.method==='GET'),'newline must not create a chat or task');
    }
    assert.match(f.text(),scenario.send?/Enter 发送/:/Enter 换行/);
  });
}

for(const scenario of[
  {name:'desktop Ctrl Enter',options:{},key:{ctrlKey:true}},
  {name:'desktop Cmd Enter',options:{},key:{metaKey:true}},
  {name:'touch Web Ctrl Enter',options:{touch:true},key:{ctrlKey:true}},
  {name:'Android Cmd Enter',options:{native:true},key:{metaKey:true}},
]){
  test(`App textarea ${scenario.name} sends one message through the isolated stream`,async t=>{
    const f=workspaceFixture(scenario.options);t.after(()=>f.close());await f.ready();f.typeDraft('快捷键消息');
    assert.equal(f.keyDown(scenario.key),true);await f.ready();
    assert.equal(f.streams.length,1);assert.equal(f.streams[0].content,'快捷键消息');
    assert.deepEqual(f.requests.filter(item=>item.method==='POST').map(item=>item.path),['/conversations']);
    assert.equal(f.find('textarea').props.disabled,false);
  });
}

for(const scenario of[
  {name:'desktop Shift Enter',options:{},key:{shiftKey:true}},
  {name:'Android Shift Enter',options:{native:true},key:{shiftKey:true}},
  {name:'Ctrl Shift Enter',options:{},key:{ctrlKey:true,shiftKey:true}},
  {name:'Cmd Shift Enter',options:{touch:true},key:{metaKey:true,shiftKey:true}},
  {name:'IME isComposing from the native event',options:{},key:{ctrlKey:true,isComposing:true}},
  {name:'IME keyCode 229 from the native event',options:{native:true},key:{metaKey:true,keyCode:229}},
  {name:'an already prevented native Enter',options:{},key:{ctrlKey:true,defaultPrevented:true}},
]){
  test(`App textarea preserves ${scenario.name} without any send or task`,async t=>{
    const f=workspaceFixture(scenario.options);t.after(()=>f.close());await f.ready();f.typeDraft('正在输入中文');
    assert.equal(f.keyDown(scenario.key),false);await f.ready();
    assert.equal(f.streams.length,0);assert.equal(f.find('textarea').props.value,'正在输入中文');
    assert.ok(f.requests.every(item=>item.method==='GET'),'composition and newline must never reach a mutating API');
  });
}

for(const label of['连接与设置','下载客户端']){
  test(`App workspace back returns from ${label} to Chat with draft and attachments intact`,async t=>{
    const image={id:'fixture-image',name:'draft.png',type:'image/png'};
    const f=workspaceFixture({native:true,attachmentItems:[image]});t.after(()=>f.close());await f.ready();f.typeDraft('还没有发送的草稿');
    const before=f.requests.length;f.openView(label);assert.equal(f.find('textarea'),undefined);
    assert.equal(f.back(),true);await f.ready();
    assert.equal(f.find('textarea').props.value,'还没有发送的草稿');assert.deepEqual(f.attachments.items,[image]);
    assert.deepEqual(f.navigations,[]);assert.equal(f.requests.length,before);assert.equal(f.streams.length,0);
    assert.ok(f.requests.every(item=>item.method==='GET'),'view navigation must not write settings or start a task');
  });
}

test('App workspace back preserves a Chat stream in progress without navigation or another request',async t=>{
  const f=workspaceFixture({native:true,holdStream:true});t.after(()=>f.close());await f.ready();f.typeDraft('正在执行的回复');
  assert.equal(f.keyDown({ctrlKey:true}),true);await f.ready();
  assert.equal(f.streams.length,1);assert.equal(f.find('textarea').props.disabled,true);
  const before=f.requests.length;assert.equal(f.back(),true);await f.ready();
  assert.deepEqual(f.navigations,[]);assert.equal(f.requests.length,before);assert.equal(f.streams.length,1);
  assert.equal(f.streams[0].signal.aborted,false,'back must not cancel a healthy in-progress chat');
  assert.match(f.text(),/先完成或停止当前回复/);
});

for(const scenario of[
  {name:'unsent text',options:{},draft:'留在页面中的草稿'},
  {name:'unsent images',options:{attachmentItems:[{id:'fixture-unsent-image',name:'unsent.png',type:'image/png'}]}},
  {name:'an image upload',options:{attachmentUploading:true}},
]){
  test(`App workspace back keeps ${scenario.name} on the current Chat page`,async t=>{
    const f=workspaceFixture({native:true,...scenario.options});t.after(()=>f.close());await f.ready();if(scenario.draft)f.typeDraft(scenario.draft);
    const before=f.requests.length;assert.equal(f.back(),true);await f.ready();
    assert.deepEqual(f.navigations,[]);assert.equal(f.requests.length,before);assert.equal(f.streams.length,0);
    if(scenario.draft)assert.equal(f.find('textarea').props.value,scenario.draft);
    if(scenario.options.attachmentItems)assert.deepEqual(f.attachments.items,scenario.options.attachmentItems);
    assert.ok(f.find('textarea'),'Chat remains mounted');
    assert.ok(f.requests.every(item=>item.method==='GET'),'back must not write settings or create work');
  });
}

test('App workspace back respects an outer layer and only an empty idle Chat may leave for the companion',async t=>{
  const f=workspaceFixture({native:true});t.after(()=>f.close());await f.ready();
  const before=f.requests.length;assert.equal(f.back(true),true);assert.deepEqual(f.navigations,[]);
  assert.equal(f.back(),true);assert.deepEqual(f.navigations,['/']);
  assert.equal(f.requests.length,before);assert.equal(f.streams.length,0);
  assert.ok(f.requests.every(item=>item.method==='GET'));
});
