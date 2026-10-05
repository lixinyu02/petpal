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

/** Execute App's real effects and navigation handlers. Only child UIs, browser surfaces
 * and network are isolated; notification and history decisions stay in App.tsx. */
function workspaceFixture({canUseCodex=false,storage,deniedGetter=false,touch=false,native=false,desktop=false,holdStream=false,attachmentItems=[],attachmentUploading=false,initialConversations=[],registeredAutomationIds=[],search='?chat=1',failAgentSubmit=false,handleAgentControl=false}={}){
  const permissions={access:'read-only',approval:'ask'},identity={instanceId:'fixture-service',userId:'fixture-user'};
  const state={instanceId:identity.instanceId,user:{id:identity.userId,username:'fixture',displayName:'Fixture',isOwner:false,canUseCodex,agentAccess:canUseCodex?'full':'none'},
    settings:{petName:'Fixture companion',persona:'Fixture',companionKind:'anime',defaultProviderId:'model'},
    providers:[{id:'model',name:'Fixture model',model:'fixture-model',protocol:'responses',supportsImages:true}],conversations:[],codex:{available:true,eligibleProviderIds:['model']}};
  const hosts=[{id:'central',name:'Fixture server',kind:'central',platform:'linux',online:true},
    {id:'pc-one',name:'Fixture PC one',kind:'desktop',platform:'win32',online:true,codex:{available:true}},
    {id:'pc-two',name:'Fixture PC two',kind:'desktop',platform:'linux',online:true,codex:{available:true}}];
  const hooks=[],effects=[],timers=new Map(),calls=[],requests=[],streams=[],navigations=[],backendConversations=[...initialConversations],window=new EventTarget(),document=new EventTarget();
  let notificationSnapshot={navigation:null},notificationTakes=0;
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
      if(path==='/state')return{...state,conversations:publicConversations()};
      if(path==='/agent/hosts')return{hosts};
      if(path==='/conversations'&&options.method==='POST'){
        const body=JSON.parse(options.body),conversation={id:`fixture-chat-${backendConversations.length+1}`,mode:body.mode,providerId:body.providerId,title:'Fixture chat',messages:[]};
        backendConversations.push(conversation);return conversation;
      }
      if(/^\/conversations\/[^/]+$/.test(path)&&!options.method){const conversation=backendConversations.find(item=>item.id===path.split('/')[2]);assert.ok(conversation);return conversation;}
      if(handleAgentControl&&callControl(path,options))return{};
      if(path.endsWith('/agent/submit')&&failAgentSubmit)throw Error('Fixture lost the submission acknowledgement');
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
  const publicConversations=()=>backendConversations.filter(item=>!item.automationId||!registeredAutomationIds.includes(item.automationId));
  function callControl(path,options){
    if(options.method==='DELETE'&&/^\/conversations\/[^/]+$/.test(path)){const at=backendConversations.findIndex(item=>item.id===path.split('/')[2]);assert.ok(at>=0);backendConversations.splice(at,1);return true;}
    if(options.method!=='POST')return false;
    const stop=/^\/conversations\/([^/]+)\/stop$/.exec(path);
    if(stop){const at=backendConversations.findIndex(item=>item.id===stop[1]);assert.ok(at>=0);const before=backendConversations[at];backendConversations[at]={...before,agent:{...before.agent,revision:before.agent.revision+1,run:{...before.agent.run,status:'stopping'}}};return true;}
    const approval=/^\/codex\/approvals\/([^/]+)$/.exec(path);
    if(approval){const at=backendConversations.findIndex(item=>item.agent?.approvals?.some(entry=>entry.id===approval[1]));assert.ok(at>=0);const before=backendConversations[at];backendConversations[at]={...before,agent:{...before.agent,revision:before.agent.revision+1,approvals:before.agent.approvals.filter(entry=>entry.id!==approval[1])}};return true;}
    return false;
  }
  const attachments={items:[...attachmentItems],uploading:attachmentUploading,error:'',clearCount:0,clear(){attachments.items=[];attachments.uploading=false;attachments.clearCount++;},inputRef:{current:null}};
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
    './platform/task-notification-session':{taskNotificationSession:{subscribe(){},snapshot:()=>notificationSnapshot,takeNavigation(){notificationTakes++;const previous=notificationSnapshot.navigation;notificationSnapshot={navigation:null};return previous;}}},'./desktop-settings.mjs':{reasoningEfforts},
    './ui-motion.mjs':{...uiMotion,createUiMotionController:options=>uiMotion.createUiMotionController({window,document,...options})},
  };
  for(const name of ['AutomationsView','DownloadsView','BrandMark','CompanionOptions','ChatMessages','ConversationHistory','AgentQueue','UpdatesSettings','CatV2','WorkspaceDisclosure','AccountsSettings','VoiceSettings','DesktopAssistantSettings','MusicMcpSettings','ComputerUseSettings','OpenCliSettings','ClientBehaviorSettings'])modules[`./${name}`]=component(name);
  const module={exports:{}},context={module,exports:module.exports,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),`Unexpected dependency: ${name}`);return modules[name];},
    window,document,location:{search,origin:'https://fixture.invalid',assign:path=>navigations.push(path)},URL,URLSearchParams,AbortController,DOMException,crypto:{randomUUID:()=>`fixture-submission-${requests.length}`},
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
    enterChat(){find('button',props=>props['aria-label']==='Chat 聊天').props.onClick();render();},
    newChat(){find('button',props=>props.className==='new-chat').props.onClick();render();},
    brand(){find('a',props=>props.className==='brand').props.onClick({preventDefault(){}});render();},
    selectHistory(id){find(modules['./ConversationHistory'].default).props.onSelect(id);render();},
    get selectedId(){return find(modules['./ConversationHistory'].default)?.props.selectedId;},
    history(){return Array.from(find(modules['./ConversationHistory'].default)?.props.conversations || []);},
    automation(){return nodes(tree).find(node=>typeof node.props?.onEditingChange==='function'&&typeof node.props?.onOpenConversation==='function');},
    automationEditing(value,{rerender=true}={}){const node=this.automation();assert.ok(node,'automation view is mounted');node.props.onEditingChange(value);if(rerender)render();},
    automationResult(id){this.automation().props.onOpenConversation(id);render();},
    click(label){const node=find('button',props=>props['aria-label']===label||text(props.children)===label);assert.ok(node,`Missing button ${label}`);node.props.onClick();render();},
    component(name){return find(controls[name]||modules[`./${name}`]?.default);},
    deleteHistory(id){find(modules['./ConversationHistory'].default).props.onDelete(id);render();},
    render,
    queueNew(){find(modules['./AgentQueue'].default).props.onNewConversation();render();},
    clickHome(properties={},className='single-companion-return'){
      let prevented=false;
      find('a',props=>props.className===className).props.onClick({button:0,defaultPrevented:false,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,...properties,preventDefault(){prevented=true;}});
      render();return prevented;
    },
    confirm(){find('button',props=>text(props.children)==='丢弃并切换').props.onClick();render();},
    cancel(){find('button',props=>text(props.children)==='继续编辑').props.onClick();render();},
    suggestion(label){find('button',props=>text(props.children)===label).props.onClick();render();},
    prepareBrowser(){nodes(tree).find(node=>typeof node.props?.onPrepareBrowser==='function').props.onPrepareBrowser();render();},
    setAttachments(items=[],uploading=false){attachments.items=[...items];attachments.uploading=uploading;render();},
    notify(conversation){const visible=publicConversations().filter(item=>item.id!==conversation.id);if(!registeredAutomationIds.includes(conversation.automationId))visible.push(conversation);notificationSnapshot={navigation:{epoch:1,...identity,state:{...state,conversations:visible},conversation}};render();},
    get notificationTakes(){return notificationTakes;},
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

const conversation = (id, extra = {}) => ({ id, title: id, mode: 'chat', providerId: 'model', messages: [], ...extra });

test('automation navigation mounts an account-bound independent view and keeps Chat text and image drafts', async t => {
  const f = workspaceFixture({ canUseCodex: true }); t.after(() => f.close()); await f.ready();
  f.typeDraft('尚未发送的 Chat 文字'); const image = { id: 'fixture-image', name: 'draft.png', mimeType: 'image/png' }; f.setAttachments([image]);
  f.openView('自动化'); await f.ready();
  assert.ok(f.automation()); assert.equal(f.automation().props.user.id, 'fixture-user');
  assert.deepEqual(f.automation().props.providers.map(item => item.id), ['model']);
  assert.equal(f.attachments.clearCount, 0); assert.deepEqual(f.attachments.items, [image]);
  assert.equal(f.back(), true); await f.ready();
  assert.equal(f.automation(), undefined); assert.equal(f.find('textarea', props => props['aria-label'] === '消息').props.value, '尚未发送的 Chat 文字');
  assert.equal(f.attachments.clearCount, 0); assert.ok(f.requests.every(item => item.method === 'GET'));
});

test('registered automation results stay out of backend recent history while orphan results remain reachable', async t => {
  const visible = conversation('chat-visible'), background = conversation('assistant-child', { mode: 'codex', backgroundParentId: visible.id });
  const scheduled = conversation('scheduled-result', { mode: 'codex', automationId: 'automation-one' });
  const orphan = conversation('orphan-result', { mode: 'codex', automationId: 'deleted-automation' });
  const f = workspaceFixture({ canUseCodex: true, initialConversations: [visible, background, scheduled, orphan], registeredAutomationIds: ['automation-one'] }); t.after(() => f.close()); await f.ready();
  assert.deepEqual(f.history().map(item => item.id), ['chat-visible', 'orphan-result']);
  f.openView('自动化'); f.automationResult(scheduled.id); await f.ready();
  assert.equal(f.automation(), undefined); assert.equal(f.selectedId, scheduled.id, 'an excluded result still has a complete reachable Agent conversation');
  assert.deepEqual(f.history().map(item => item.id), ['chat-visible', 'orphan-result']);
});

for (const target of ['下载客户端', '连接与设置']) {
  test(`dirty automation form keeps its view until the user decides before ${target}`, async t => {
    const f = workspaceFixture({ canUseCodex: true, registeredAutomationIds: ['automation-one'] }); t.after(() => f.close()); await f.ready(); f.openView('自动化');
    f.automationEditing({ dirty: true, busy: false }); f.openView(target); await f.ready();
    assert.ok(f.automation(), 'navigation must not unmount the edited form'); assert.ok(f.find('section', props => props.role === 'dialog'));
    f.click('继续编辑'); await f.ready(); assert.ok(f.automation()); assert.equal(f.find('section', props => props.role === 'dialog'), undefined);
    f.openView(target); f.click('丢弃并切换'); await f.ready(); assert.equal(f.automation(), undefined);
    assert.ok(f.requests.every(item => item.method === 'GET'), 'the parent navigation must not save or dispatch a form implicitly');
  });
}

test('automation save lock blocks browser home, workspace back and navigation even before React rerenders', async t => {
  const f = workspaceFixture({ canUseCodex: true }); t.after(() => f.close()); await f.ready(); f.openView('自动化');
  f.automationEditing({ dirty: true, busy: true }, { rerender: false });
  assert.equal(f.clickHome(), true); await f.ready(); assert.ok(f.automation()); assert.deepEqual(f.navigations, []);
  assert.equal(f.back(), true); f.openView('下载客户端'); await f.ready(); assert.ok(f.automation());
  const discard = f.find('button', props => text(props.children) === '丢弃并切换');
  assert.ok(!discard || discard.props.disabled, 'an active mutation cannot be abandoned via a discard confirmation');
});

for (const editing of [{ dirty: true, busy: false }, { dirty: false, busy: true }]) {
  test(`task notifications wait while automation is ${editing.busy ? 'saving' : 'dirty'} and open once after it becomes safe`, async t => {
    const f = workspaceFixture({ canUseCodex: true, registeredAutomationIds: ['automation-one'] }); t.after(() => f.close()); await f.ready(); f.openView('自动化');
    f.automationEditing(editing); const result = conversation('notification-result', { mode: 'codex', automationId: 'automation-one' }); f.notify(result); await f.ready();
    assert.ok(f.automation()); assert.equal(f.selectedId, null); assert.equal(f.notificationTakes, 0, 'a blocked notification remains pending');
    f.automationEditing({ dirty: false, busy: false }); await f.ready();
    assert.equal(f.automation(), undefined); assert.equal(f.selectedId, result.id); assert.equal(f.notificationTakes, 1);
    await f.ready(); assert.equal(f.notificationTakes, 1, 'rerenders cannot consume the same notification twice');
    assert.equal(f.history().some(item => item.id === result.id), false);
  });
}

test('opening an automation result protects edits and preserves an existing Chat draft when canceled', async t => {
  const result = conversation('stored-result', { mode: 'codex', automationId: 'automation-one' });
  const f = workspaceFixture({ canUseCodex: true, initialConversations: [result] }); t.after(() => f.close()); await f.ready();
  f.typeDraft('保留原 Chat 草稿'); f.openView('自动化'); f.automationEditing({ dirty: true, busy: false }); f.automationResult(result.id); await f.ready();
  assert.ok(f.automation()); assert.equal(f.selectedId, null); assert.ok(f.find('section', props => props.role === 'dialog'));
  f.click('继续编辑'); f.automationEditing({ dirty: false, busy: false }); f.back(); await f.ready();
  assert.equal(f.find('textarea', props => props['aria-label'] === '消息').props.value, '保留原 Chat 草稿'); assert.equal(f.streams.length, 0);
});

test('automation result is a read-only conversation with an explicit return to its plans', async t => {
  const result = conversation('completed-automation-result', { mode: 'codex', automationId: 'automation-one', messages: [{ id: 'result-message', role: 'assistant', status: 'complete', content: '已完成自动化任务' }],
    agent: { revision: 1, paused: false, queue: [], run: { id: 'completed-run', status: 'completed', permissions: { access: 'read-only', approval: 'ask' }, providerId: 'model', model: 'fixture-model', hostId: 'central' }, approvals: [] } });
  const f = workspaceFixture({ canUseCodex: true, initialConversations: [result] }); t.after(() => f.close()); await f.ready(); f.openView('自动化'); f.automationResult(result.id); await f.ready();
  assert.equal(f.selectedId, result.id); assert.equal(f.find('textarea', props => props['aria-label'] === '消息'), undefined);
  assert.equal(f.find('form', props => props.className?.includes('composer')), undefined); assert.equal(f.find('select', props => props['aria-label'] === 'Agent 发送方式'), undefined);
  for (const child of ['AgentQueue', 'ModelPicker', 'ExecutionTarget', 'AgentPermissions', 'ProjectDirectory']) assert.equal(f.component(child), undefined, `${child} cannot change a persistent automation result`);
  assert.equal(f.find('button', props => ['发送消息', '追加指令', '加入队列'].includes(props['aria-label'])), undefined);
  f.click('返回自动化'); await f.ready(); assert.ok(f.automation()); assert.ok(f.requests.every(item => item.method === 'GET')); assert.equal(f.streams.length, 0);
});

test('running automation results retain actual approval and stop events while returning to plans leaves the task running', async t => {
  const result = conversation('running-automation-result', { mode: 'codex', automationId: 'automation-one', messages: [{ id: 'progress-message', role: 'assistant', status: 'streaming', content: '正在执行' }],
    agent: { revision: 1, paused: false, queue: [], run: { id: 'active-run', status: 'running', turnId: 'turn-one', permissions: { access: 'read-only', approval: 'ask' }, providerId: 'model', model: 'fixture-model', hostId: 'central' },
      approvals: [{ id: 'approval-one', kind: 'command', description: '只读测试批准请求' }] } });
  const f = workspaceFixture({ canUseCodex: true, initialConversations: [result], handleAgentControl: true }); t.after(() => f.close()); await f.ready(); f.openView('自动化'); f.automationResult(result.id); await f.ready();
  assert.equal(f.find('textarea', props => props['aria-label'] === '消息'), undefined); f.click('允许本次'); await f.ready();
  const approval = f.requests.find(item => item.path === '/codex/approvals/approval-one'); assert.ok(approval); assert.equal(approval.method, 'POST'); assert.deepEqual(approval.body, { decision: 'accept' });
  f.click('返回自动化'); await f.ready(); assert.ok(f.automation()); assert.equal(f.requests.some(item => item.path.endsWith('/stop')), false, 'view navigation must not cancel a persistent run');
  f.automationResult(result.id); await f.ready(); f.click('停止自动化任务'); await f.ready();
  assert.equal(f.requests.filter(item => item.path === `/conversations/${result.id}/stop` && item.method === 'POST').length, 1);
  assert.equal(f.streams.length, 0); assert.equal(f.component('AgentQueue'), undefined); assert.equal(f.find('textarea'), undefined);
});

test('a result from a deleted automation remains read-only in recent history and can be deleted explicitly', async t => {
  const orphan = conversation('retired-automation-result', { mode: 'codex', automationId: 'deleted-automation', messages: [{ id: 'old-result', role: 'assistant', content: '旧结果', status: 'complete' }] });
  const f = workspaceFixture({ canUseCodex: true, initialConversations: [orphan], handleAgentControl: true }); t.after(() => f.close()); await f.ready();
  assert.deepEqual(f.history().map(item => item.id), [orphan.id]); f.selectHistory(orphan.id); await f.ready(); assert.equal(f.find('textarea', props => props['aria-label'] === '消息'), undefined);
  assert.equal(f.component('AgentQueue'), undefined); f.deleteHistory(orphan.id); assert.equal(f.requests.some(item => item.method === 'DELETE'), false);
  f.click('删除对话'); await f.ready(); assert.equal(f.requests.filter(item => item.method === 'DELETE' && item.path === `/conversations/${orphan.id}`).length, 1); assert.deepEqual(f.history(), []);
});

