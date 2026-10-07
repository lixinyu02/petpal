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
import {mergeAssistantTask,mergeChatAssistantConversation,foregroundAssistantMessage} from '../src/chat-assistant-preferences.mjs';
import {createBrowserSetupDraft} from '../src/browser-setup-draft.mjs';
import {reasoningEfforts} from '../src/desktop-settings.mjs';
import * as uiMotion from '../src/platform/ui-motion.mjs';
import {composerKeyAction} from '../src/composer-keyboard.mjs';
import * as organizationSync from '../src/conversation-organization-sync.mjs';
import {reuseConversationMessages} from '../src/conversation-message-reuse.mjs';
import * as approvalReviewUi from '../src/approval-review-ui.mjs';

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
function workspaceFixture({canUseCodex=false,storage,deniedGetter=false,touch=false,native=false,desktop=false,holdStream=false,attachmentItems=[],attachmentUploading=false,initialConversations=[],initialProjects=[],organizationResponse,registeredAutomationIds=[],search='?chat=1',failAgentSubmit=false,handleAgentControl=false,globalReviewCapability,hostReviewCapability,extraProviders=[],approvalReviewProviderIds,assistantSnapshot}={}){
  const permissions={access:'read-only',approval:'ask'},identity={instanceId:'fixture-service',userId:'fixture-user'};
  const state={instanceId:identity.instanceId,user:{id:identity.userId,username:'fixture',displayName:'Fixture',isOwner:false,canUseCodex,agentAccess:canUseCodex?'full':'none'},
    settings:{petName:'Fixture companion',persona:'Fixture',companionKind:'anime',defaultProviderId:'model'},
    providers:[{id:'model',name:'Fixture model',model:'fixture-model',protocol:'responses',supportsImages:true},...extraProviders],conversations:[],codex:{available:true,eligibleProviderIds:['model'],approvalReviewProviderIds,approvalReview:globalReviewCapability}};
  const hosts=[{id:'central',name:'Fixture server',kind:'central',platform:'linux',online:true},
    {id:'pc-one',name:'Fixture PC one',kind:'desktop',platform:'win32',online:true,codex:{available:true,approvalReview:hostReviewCapability}},
    {id:'pc-two',name:'Fixture PC two',kind:'desktop',platform:'linux',online:true,codex:{available:true}}];
  const hooks=[],effects=[],timers=new Map(),calls=[],requests=[],streams=[],navigations=[],backendConversations=structuredClone(initialConversations),backendProjects=structuredClone(initialProjects),delayedResponses=[],apiFailures=[],window=new EventTarget(),document=new EventTarget();
  let notificationSnapshot={navigation:null},notificationTakes=0;
  let index=0,tree,timerId=0,getterReads=0,createdConversations=initialConversations.length,createdProjects=initialProjects.length,sessionEpoch=1;
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
  class SessionChangedError extends Error {constructor(){super('Fixture account changed');this.name='SessionChangedError';}}
  const api={getConnection:()=>({url:'https://fixture.invalid',token:'fixture-token'}),getIdentity:()=>identity,getSessionEpoch:()=>sessionEpoch,
    initConnection:async()=>({url:'https://fixture.invalid',token:'fixture-token'}),isSessionChanged:error=>error instanceof SessionChangedError,SessionChangedError,
    api:async(path,options={})=>{
      const method=options.method||'GET',body=options.body?JSON.parse(options.body):undefined;
      calls.push(path);requests.push({path,method,body});
      const failure=apiFailures.findIndex(item=>item.path===path&&item.method===method);if(failure>=0)throw apiFailures.splice(failure,1)[0].error;
      const response=async value=>{
        const snapshot=structuredClone(value),at=delayedResponses.findIndex(entry=>entry.path===path&&entry.method===method);
        if(at<0)return snapshot;
        const delayed=delayedResponses.splice(at,1)[0];delayed.started.resolve(snapshot);await delayed.release.promise;
        return delayed.value===undefined?snapshot:structuredClone(delayed.value);
      };
      if(path==='/state')return response({...state,projects:backendProjects,conversations:publicConversations()});
      if(path==='/agent/hosts')return{hosts};
      if(path==='/conversations'&&options.method==='POST'){
        const conversation={id:`fixture-chat-${++createdConversations}`,mode:body.mode,providerId:body.providerId,title:'Fixture chat',messages:[],projectId:body.projectId??null,archivedAt:null};
        backendConversations.push(conversation);return response(conversation);
      }
      if(path==='/projects'&&method==='POST'){
        const project={id:`fixture-project-${++createdProjects}`,name:body.name,createdAt:'2026-10-06T00:00:00.000Z',updatedAt:'2026-10-06T00:00:00.000Z'};backendProjects.push(project);return response(project);
      }
      if(/^\/projects\/[^/]+$/.test(path)){
        const at=backendProjects.findIndex(item=>item.id===path.split('/')[2]);assert.ok(at>=0,'project operation must belong to fixture account');
        if(method==='PATCH'){backendProjects[at]={...backendProjects[at],name:body.name};return response(backendProjects[at]);}
        if(method==='DELETE'){const [removed]=backendProjects.splice(at,1);for(const item of backendConversations)if(item.projectId===removed.id)item.projectId=null;return response({ok:true});}
      }
      const organization=/^\/conversations\/([^/]+)\/organization$/.exec(path);
      if(organization&&method==='PATCH'){
        const item=backendConversations.find(item=>item.id===organization[1]);assert.ok(item,'organization operation must use an existing conversation');
        if(body.title!==undefined){item.title=body.title;item.customTitle=body.title;}
        if(body.projectId!==undefined)item.projectId=body.projectId;
        if(body.archived!==undefined)item.archivedAt=body.archived?'2026-10-06T00:00:00.000Z':null;
        return response(organizationResponse?organizationResponse(structuredClone(item),body):item);
      }
      if(/^\/conversations\/[^/]+$/.test(path)&&method==='GET'){const conversation=backendConversations.find(item=>item.id===path.split('/')[2]);assert.ok(conversation);return response(conversation);}
      if(path.endsWith('/agent/submit')&&!failAgentSubmit){
        const at=backendConversations.findIndex(item=>item.id===path.split('/')[2]);assert.ok(at>=0);
        const item=backendConversations[at];item.agent={revision:1,paused:false,queue:[],run:{id:'fixture-run',submissionId:body.submissionId,status:'completed',providerId:'model',permissions,hostId:'central'},submissions:[{submissionId:body.submissionId,status:'completed'}],approvals:[]};
        return response({conversation:item,submission:{submissionId:body.submissionId,status:'completed'}});
      }
      if(handleAgentControl&&callControl(path,options))return response({});
      if(path.endsWith('/agent/submit')&&failAgentSubmit)throw Error('Fixture lost the submission acknowledgement');
      throw Error(`Unexpected API call: ${path}`);
    },
    streamMessage:async(id,content,signal,onEvent,attachmentIds,assistant)=>{
      const stream={id,content,signal,attachmentIds,assistant,emit:onEvent};streams.push(stream);
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
    './project-directory-preferences.mjs':projectPreferences,'./execution-hosts.mjs':executionHosts,'./conversation-organization-sync.mjs':organizationSync,'./conversation-message-reuse.mjs':{reuseConversationMessages},
    './approval-review-ui.mjs':approvalReviewUi,
    './ChatAssistant':{ChatAssistantControls:Symbol('ChatAssistantControls'),ChatAssistantTasks:Symbol('ChatAssistantTasks'),useChatAssistant:()=>({value:{hostId:'',providerId:'',enabled:false,permissions},snapshot:()=>assistantSnapshot})},
    './chat-assistant-preferences.mjs':{mergeAssistantTask,mergeChatAssistantConversation,foregroundAssistantMessage},
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
  const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
  return{find,calls,requests,streams,navigations,attachments,get getterReads(){return getterReads;},text:()=>text(tree),
    ready:async()=>{for(let attempt=0;attempt<3;attempt++){await flush();render();}},
    enterAgent(){find('button',props=>props['aria-label']==='Agent 执行任务').props.onClick();render();},
    enterChat(){find('button',props=>props['aria-label']==='Chat 聊天').props.onClick();render();},
    newChat(){find('button',props=>props.className==='new-chat').props.onClick();render();},
    brand(){find('a',props=>props.className==='brand').props.onClick({preventDefault(){}});render();},
    selectHistory(id){find(modules['./ConversationHistory'].default).props.onSelect(id);render();},
    get selectedId(){return find(modules['./ConversationHistory'].default)?.props.selectedId;},
    history(){return Array.from(find(modules['./ConversationHistory'].default)?.props.conversations || []);},
    historyProps(){return find(modules['./ConversationHistory'].default)?.props;},
    filter(filter,archived=false){this.historyProps().onFilter(filter,archived);render();},
    async organize(id,patch){await this.historyProps().onOrganize(id,patch);render();},
    async createProject(name){await this.historyProps().onCreateProject(name);render();},
    async renameProject(id,name){await this.historyProps().onRenameProject(id,name);render();},
    async deleteProject(id){await this.historyProps().onDeleteProject(id);render();},
    submit(){const pending=find('form',props=>props.className?.includes('composer')).props.onSubmit({preventDefault(){}});render();return pending;},
    delayNext(path,method='GET'){const item={path,method,started:deferred(),release:deferred()};delayedResponses.push(item);return{started:item.started.promise,release(value){item.value=value;item.release.resolve();}};},
    failNext(path,method,error=Object.assign(new Error('Fixture durable save failed'),{status:500})){apiFailures.push({path,method,error});},
    changeSession(){sessionEpoch++;},
    automation(){return nodes(tree).find(node=>typeof node.props?.onEditingChange==='function'&&typeof node.props?.onOpenConversation==='function');},
    automationEditing(value,{rerender=true}={}){const node=this.automation();assert.ok(node,'automation view is mounted');node.props.onEditingChange(value);if(rerender)render();},
    automationResult(id){this.automation().props.onOpenConversation(id);render();},
    click(label){const node=find('button',props=>props['aria-label']===label||text(props.children)===label);assert.ok(node,`Missing button ${label}`);const pending=node.props.onClick();render();return pending;},
    component(name){return find(controls[name]||modules[`./${name}`]?.default||modules['./ChatAssistant'][name]);},
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
    notify(conversation){const visible=publicConversations().filter(item=>item.id!==conversation.id);if(!registeredAutomationIds.includes(conversation.automationId))visible.push(conversation);notificationSnapshot={navigation:{epoch:1,...identity,state:{...state,projects:structuredClone(backendProjects),conversations:visible},conversation}};render();},
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

const project=(id,name=id)=>({id,name,createdAt:'2026-10-06T00:00:00.000Z',updatedAt:'2026-10-06T00:00:00.000Z'});
const idleAgent=(id,extra={})=>conversation(id,{mode:'codex',agent:{revision:1,paused:false,queue:[],submissions:[],approvals:[]},...extra});

const reviewCapability={available:true,modelStrategy:'agent-model',dynamicTools:'bounded-audio-rules-with-manual-fallback',version:1};
const approvalConversation=(extra={})=>idleAgent('approval-ui-task',{agent:{revision:1,paused:false,queue:[],submissions:[],run:{id:'active-run',status:'running',turnId:'turn-one',permissions:{access:'full-access',approval:'review'},providerId:'model',model:'fixture-model',hostId:'pc-one'},approvals:[{id:'approval-ui-one',kind:'desktopTool',description:'将所选电脑系统音量调到 45%'}]},...extra});

for(const automation of [false,true])test(`real App ${automation?'loaded automation':'selected Agent'} readback keeps messages stable when approval state changes`,async t=>{
  const saved=approvalConversation({id:`snapshot-${automation?'automation':'agent'}`,messages:[{id:'stable-question',role:'user',content:'question'},{id:'stable-answer',role:'assistant',content:'**answer**',status:'complete'}],...(automation?{automationId:'automation-reuse'}:{})});
  const f=workspaceFixture({canUseCodex:true,initialConversations:[saved],registeredAutomationIds:automation?['automation-reuse']:[],handleAgentControl:true});t.after(()=>f.close());await f.ready();
  if(automation){f.openView('自动化');f.automationResult(saved.id);}else f.selectHistory(saved.id);
  await f.ready();const before=f.component('ChatMessages').props.messages;
  assert.ok(f.find('button',props=>text(props.children)==='允许本次'));
  f.click('允许本次');await f.ready();
  assert.equal(f.component('ChatMessages').props.messages,before,'agent-only readback cannot invalidate stable rows or scroll dependencies');
  assert.equal(f.find('button',props=>text(props.children)==='允许本次'),undefined,'the authoritative approval state must still update');
  if(!automation)assert.equal(f.component('AgentQueue').props.state.approvals.length,0);
});

test('real App background task updates reuse stable rows and replace only changed authoritative text',async t=>{
  const saved=conversation('background-snapshot',{messages:[{id:'question',role:'user',content:'question'},{id:'answer',role:'assistant',content:'old answer',status:'complete'}],assistantTasks:[{id:'task',status:'running'}]});
  const f=workspaceFixture({initialConversations:[saved]});t.after(()=>f.close());await f.ready();f.selectHistory(saved.id);await f.ready();
  const before=f.component('ChatMessages').props.messages,incoming={...structuredClone(saved),assistantTasks:[{id:'task',status:'completed'}]};
  f.component('ChatAssistantTasks').props.onUpdate(incoming);await f.ready();
  assert.equal(f.component('ChatMessages').props.messages,before);assert.equal(f.component('ChatAssistantTasks').props.tasks[0].status,'completed');
  const changed=structuredClone(incoming);changed.messages[1].content='new answer';
  f.component('ChatAssistantTasks').props.onUpdate(changed);await f.ready();const after=f.component('ChatMessages').props.messages;
  assert.equal(after[0],before[0]);assert.equal(after[1],changed.messages[1]);assert.equal(after[1].content,'new answer');
});

test('permission UI receives only the actual selected executor review capability, never the global fallback',async t=>{
  const f=workspaceFixture({canUseCodex:true,globalReviewCapability:reviewCapability,hostReviewCapability:{...reviewCapability,available:false,message:'Fixture old PC'}});t.after(()=>f.close());await f.ready();f.enterAgent();await f.ready();f.chooseHost('pc-one');
  assert.equal(f.component('AgentPermissions').props.reviewCapability.available,false);
  f.chooseHost('pc-two');assert.equal(f.component('AgentPermissions').props.reviewCapability,undefined);
  assert.equal(f.component('AgentPermissions').props.reviewModel,'fixture-model');
});

const crossConnectionReviewer={id:'cross-review',name:'独立审查连接',model:'review-model',protocol:'responses',baseUrl:'https://other-api.invalid/v1'};
const independentReviewCapability={available:true,modelStrategy:'agent-model',dynamicTools:'bounded-audio-rules-with-manual-fallback',version:2,independentModel:true};

test('App supplies the separately authorized Responses reviewer catalog to Agent, Chat + Agent and automation entry points',async t=>{
  const f=workspaceFixture({canUseCodex:true,extraProviders:[crossConnectionReviewer,{id:'not-assigned',protocol:'responses'},{id:'chat-only',protocol:'chat-completions'}],approvalReviewProviderIds:['model','cross-review','chat-only'],hostReviewCapability:independentReviewCapability});t.after(()=>f.close());await f.ready();
  assert.deepEqual(f.component('ChatAssistantControls').props.reviewProviders.map(provider=>provider.id),['model','cross-review']);
  f.enterAgent();f.chooseHost('pc-one');
  assert.deepEqual(f.component('AgentPermissions').props.reviewProviders.map(provider=>provider.id),['model','cross-review']);
  assert.deepEqual(f.component('ModelPicker').props.providers.map(provider=>provider.id),['model'],'a cross-connection reviewer must not expand the Agent model grant');
  f.openView('自动化');await f.ready();
  assert.deepEqual(f.automation().props.reviewProviders.map(provider=>provider.id),['model','cross-review']);assert.deepEqual(f.automation().props.providers.map(provider=>provider.id),['model']);
});

test('App sends the selected independent reviewer in an ordinary Agent submission without replacing the Agent provider',async t=>{
  const f=workspaceFixture({canUseCodex:true,extraProviders:[crossConnectionReviewer],approvalReviewProviderIds:['cross-review'],hostReviewCapability:independentReviewCapability});t.after(()=>f.close());await f.ready();f.enterAgent();f.chooseHost('pc-one');
  f.component('AgentPermissions').props.onChange({access:'workspace-write',approval:'review',reviewProviderId:'cross-review'});f.render();f.typeDraft('仅执行验收任务');await f.submit();await f.ready();
  const request=f.requests.find(item=>item.path.endsWith('/agent/submit'));assert.ok(request);
  assert.equal(request.body.providerId,'model');assert.equal(request.body.hostId,'pc-one');assert.deepEqual(request.body.permissions,{access:'workspace-write',approval:'review',reviewProviderId:'cross-review'});
});

test('running Agent and queued submissions retain the frozen reviewer and expose disabled permission controls',async t=>{
  const frozen={access:'workspace-write',approval:'review',reviewProviderId:'cross-review'};
  const running=idleAgent('review-queue',{agent:{revision:1,paused:false,queue:[],submissions:[],run:{id:'review-run',status:'running',turnId:'review-turn',providerId:'model',model:'fixture-model',hostId:'pc-one',permissions:frozen},approvals:[]}});
  const f=workspaceFixture({canUseCodex:true,initialConversations:[running],search:'?chat=1&conversation=review-queue',extraProviders:[crossConnectionReviewer],approvalReviewProviderIds:['cross-review'],hostReviewCapability:independentReviewCapability});t.after(()=>f.close());await f.ready();
  assert.equal(f.component('AgentPermissions').props.disabled,true);assert.equal(f.component('AgentPermissions').props.value.reviewProviderId,'cross-review');
  f.find('select',props=>props['aria-label']==='Agent 发送方式').props.onChange({target:{value:'submit'}});f.render();f.typeDraft('下一条验收任务');await f.submit();
  const request=f.requests.find(item=>item.path.endsWith('/agent/submit'));assert.ok(request);assert.deepEqual(request.body.permissions,frozen);assert.equal(request.body.providerId,'model');
});

test('App carries the Chat + Agent independent reviewer snapshot in the foreground Chat request',async t=>{
  const assistantSnapshot={enabled:true,hostId:'pc-one',providerId:'model',permissions:{access:'workspace-write',approval:'review',reviewProviderId:'cross-review'}};
  const f=workspaceFixture({canUseCodex:true,assistantSnapshot,extraProviders:[crossConnectionReviewer],approvalReviewProviderIds:['cross-review']});t.after(()=>f.close());await f.ready();f.typeDraft('帮我安排一个后台任务');await f.submit();
  assert.equal(f.streams.length,1);assert.deepEqual(f.streams[0].assistant.assistant,assistantSnapshot);assert.ok(f.streams[0].assistant.submissionId);
});

test('actual App approval events are single-flight and successful decisions stay consumed through stale readback',async t=>{
  const original=approvalConversation();
  const f=workspaceFixture({canUseCodex:true,initialConversations:[original],search:`?chat=1&mode=codex&conversation=${original.id}`,handleAgentControl:true,hostReviewCapability:reviewCapability});t.after(()=>f.close());await f.ready();
  const post=f.delayNext('/codex/approvals/approval-ui-one','POST');
  const handler=f.find('button',props=>text(props.children)==='允许本次').props.onClick;
  const first=handler(),second=handler();await post.started;await second;f.render();
  assert.equal(f.requests.filter(item=>item.path==='/codex/approvals/approval-ui-one').length,1);
  assert.equal(f.find('button',props=>text(props.children)==='拒绝').props.disabled,true);
  assert.match(f.text(),/正在提交/);
  const refresh=f.delayNext(`/conversations/${original.id}`);post.release();await refresh.started;f.render();
  assert.equal(f.find('div',props=>props.className==='approval'),undefined,'a positive POST receipt consumes the visible card before GET returns');
  refresh.release(original);await first;await f.ready();
  assert.equal(f.find('div',props=>props.className==='approval'),undefined,'stale GET cannot reopen an already consumed approval');
  await handler();assert.equal(f.requests.filter(item=>item.path==='/codex/approvals/approval-ui-one').length,1,'stale captured click cannot replay a consumed decision');
});

test('App distinguishes a successful approval from a failed progress read and never replays it',async t=>{
  const original=approvalConversation(),f=workspaceFixture({canUseCodex:true,initialConversations:[original],search:`?chat=1&mode=codex&conversation=${original.id}`,handleAgentControl:true});t.after(()=>f.close());await f.ready();
  f.failNext(`/conversations/${original.id}`,'GET');await f.click('允许本次');await f.ready();
  assert.match(f.text(),/确认已提交.*进度暂时无法刷新.*请勿重复提交/);
  assert.equal(f.find('div',props=>props.className==='approval'),undefined);
  assert.equal(f.requests.filter(item=>item.path==='/codex/approvals/approval-ui-one').length,1);
});

test('an uncertain App approval locks both decisions until an explicit read-only refresh',async t=>{
  const original=approvalConversation(),f=workspaceFixture({canUseCodex:true,initialConversations:[original],search:`?chat=1&mode=codex&conversation=${original.id}`,handleAgentControl:true});t.after(()=>f.close());await f.ready();
  const handler=f.find('button',props=>text(props.children)==='允许本次').props.onClick;
  f.failNext('/codex/approvals/approval-ui-one','POST',new Error('Fixture network lost acknowledgement'));await handler();await f.ready();
  assert.match(f.text(),/确认结果尚未收到/);assert.equal(f.find('button',props=>text(props.children)==='允许本次'),undefined);
  await handler();assert.equal(f.requests.filter(item=>item.path==='/codex/approvals/approval-ui-one').length,1);
  f.click('刷新审批状态');await f.ready();
  assert.equal(f.find('button',props=>text(props.children)==='允许本次').props.disabled,false);
  assert.equal(f.requests.filter(item=>item.method==='POST').length,1,'refreshing can only read status');
});

test('a positive App approval receipt after session change cannot mutate UI or launch a follow-up read',async t=>{
  const original=approvalConversation(),f=workspaceFixture({canUseCodex:true,initialConversations:[original],search:`?chat=1&mode=codex&conversation=${original.id}`,handleAgentControl:true});t.after(()=>f.close());await f.ready();
  const post=f.delayNext('/codex/approvals/approval-ui-one','POST');const pending=f.click('允许本次');await post.started;const reads=f.requests.filter(item=>item.method==='GET').length;
  f.changeSession();post.release();await pending;f.render();
  assert.equal(f.requests.filter(item=>item.method==='GET').length,reads);
  assert.ok(f.find('div',props=>props.className==='approval'),'an old-session continuation must not replace the current view');
});

test('actual App shows native guardian progress without inventing an interactive approval',async t=>{
  const original=approvalConversation();original.agent.approvals=[];original.agent.run.approvalReview={status:'inProgress',reviewId:'review-one',targetItemId:'command-one'};
  const f=workspaceFixture({canUseCodex:true,initialConversations:[original],search:`?chat=1&mode=codex&conversation=${original.id}`,handleAgentControl:true});t.after(()=>f.close());await f.ready();
  assert.match(f.text(),/自动审查中/);assert.equal(f.find('div',props=>props.className==='approval'),undefined);
  assert.equal(f.component('AgentPermissions').props.reviewProgress.status,'inProgress');
  assert.ok(f.requests.every(item=>item.method==='GET'));
});

test('project filter changes preserve the selected conversation, unsent text and image drafts',async t=>{
  const stored=conversation('organized-chat',{projectId:'work',messages:[{id:'prior',role:'assistant',content:'原来记录',status:'complete'}]});
  const f=workspaceFixture({initialConversations:[stored],initialProjects:[project('work','工作'),project('personal','个人')]});t.after(()=>f.close());await f.ready();f.selectHistory(stored.id);await f.ready();
  f.typeDraft('这个输入还没有发送');const image={id:'draft-image',name:'draft.png'};f.setAttachments([image]);const cleared=f.attachments.clearCount;
  f.filter('personal',true);await f.ready();
  assert.equal(f.selectedId,stored.id);assert.equal(f.historyProps().projectFilter,'personal');assert.equal(f.historyProps().archived,true);
  assert.equal(f.find('textarea',props=>props['aria-label']==='消息').props.value,'这个输入还没有发送');assert.deepEqual(f.attachments.items,[image]);assert.equal(f.attachments.clearCount,cleared);
  assert.ok(f.requests.every(item=>item.method==='GET'),'classification browsing cannot mutate conversations or execute tasks');
});

for(const mode of ['chat','codex'])test(`new ${mode} conversations inherit the chosen project and return from archive view`,async t=>{
  const f=workspaceFixture({canUseCodex:true,initialProjects:[project('work','工作')]});t.after(()=>f.close());await f.ready();
  f.filter('work',true);if(mode==='codex')f.enterAgent();else f.newChat();await f.ready();
  assert.equal(f.historyProps().projectFilter,'work');assert.equal(f.historyProps().archived,false);
  f.typeDraft(mode==='chat'?'在这个项目里聊天':'在这个项目里执行');await f.submit();await f.ready();
  const creation=f.requests.find(item=>item.path==='/conversations'&&item.method==='POST');assert.ok(creation);assert.equal(creation.body.mode,mode);assert.equal(creation.body.projectId,'work');
  const created=f.history().find(item=>item.id===f.selectedId);assert.ok(created);assert.equal(created.projectId,'work');assert.equal(created.archivedAt,null);
});

test('project create, rename and deletion keep assigned conversations and selected drafts intact',async t=>{
  const saved=conversation('project-dialogue',{messages:[{id:'original',role:'assistant',content:'不能丢失的聊天',status:'complete'}]});
  const f=workspaceFixture({initialConversations:[saved]});t.after(()=>f.close());await f.ready();f.selectHistory(saved.id);await f.ready();f.typeDraft('仍未发送');
  await f.createProject('学习');const created=f.historyProps().projects.find(item=>item.name==='学习');assert.ok(created);assert.equal(f.historyProps().projectFilter,created.id);
  await f.organize(saved.id,{projectId:created.id,title:'学习记录'});await f.renameProject(created.id,'阅读笔记');
  assert.equal(f.historyProps().projects.find(item=>item.id===created.id).name,'阅读笔记');assert.equal(f.history().find(item=>item.id===saved.id).title,'学习记录');
  await f.deleteProject(created.id);await f.ready();
  assert.equal(f.historyProps().projects.length,0);assert.equal(f.historyProps().projectFilter,'unassigned');assert.equal(f.selectedId,saved.id);
  const retained=f.history().find(item=>item.id===saved.id);assert.ok(retained);assert.equal(retained.projectId,null);assert.deepEqual(retained.messages,saved.messages);
  assert.equal(f.find('textarea',props=>props['aria-label']==='消息').props.value,'仍未发送');assert.equal(f.requests.some(item=>item.method==='DELETE'&&item.path.startsWith('/conversations/')),false);
});

test('archived URL and task-notification entries align the history view and stay reachable',async t=>{
  const archived=conversation('archived-linked',{projectId:'work',archivedAt:'2026-10-06T00:00:00.000Z'});
  const f=workspaceFixture({initialConversations:[archived],initialProjects:[project('work')],search:`?chat=1&conversation=${archived.id}`});t.after(()=>f.close());await f.ready();
  assert.equal(f.selectedId,archived.id);assert.equal(f.historyProps().archived,true);assert.ok(f.history().some(item=>item.id===archived.id));
  f.newChat();f.filter('unassigned',false);f.notify(archived);await f.ready();
  assert.equal(f.selectedId,archived.id);assert.equal(f.historyProps().projectFilter,'work');assert.equal(f.historyProps().archived,true);assert.equal(f.notificationTakes,1);
});

test('organizing a live Chat preserves its pending message content and the selected input',async t=>{
  const saved=conversation('streaming-metadata',{messages:[{id:'original',role:'assistant',content:'原来的完整记录',status:'complete'}]});
  const f=workspaceFixture({initialConversations:[saved],holdStream:true,organizationResponse:item=>({...item,messages:[]})});t.after(()=>f.close());await f.ready();f.selectHistory(saved.id);await f.ready();f.typeDraft('尚在生成的下一轮');
  const sending=f.submit();await f.ready();assert.equal(f.streams.length,1);
  await f.organize(saved.id,{title:'正在进行的对话',archived:true});await f.ready();
  const updated=f.history().find(item=>item.id===saved.id);assert.equal(updated.title,'正在进行的对话');assert.ok(updated.archivedAt);assert.equal(updated.messages.length,3);assert.equal(updated.messages.at(-2).content,'尚在生成的下一轮');assert.equal(updated.messages.at(-1).status,'streaming');
  assert.equal(f.selectedId,saved.id);f.streams[0].complete();await sending;await f.ready();assert.equal(f.history().find(item=>item.id===saved.id).title,'正在进行的对话');
});

test('selected deletion retains unsent draft/images and a rapid repeated confirmation performs one durable delete',async t=>{
  const saved=conversation('delete-with-draft');const f=workspaceFixture({initialConversations:[saved],handleAgentControl:true});t.after(()=>f.close());await f.ready();f.selectHistory(saved.id);await f.ready();f.typeDraft('不要清空我的输入');const image={id:'draft-retained',name:'retained.png'};f.setAttachments([image]);const clears=f.attachments.clearCount;
  f.deleteHistory(saved.id);assert.equal(f.requests.some(item=>item.method==='DELETE'),false);const pending=f.delayNext(`/conversations/${saved.id}`,'DELETE');const confirm=f.find('button',props=>text(props.children)==='删除对话');assert.ok(confirm);confirm.props.onClick();confirm.props.onClick();f.render();await pending.started;
  assert.equal(f.requests.filter(item=>item.method==='DELETE').length,1);pending.release();await f.ready();assert.equal(f.selectedId,null);assert.deepEqual(f.history(),[]);
  assert.equal(f.find('textarea',props=>props['aria-label']==='消息').props.value,'不要清空我的输入');assert.deepEqual(f.attachments.items,[image]);assert.equal(f.attachments.clearCount,clears);assert.ok(f.text().includes('输入已保留'));
});

test('an Agent poll captured before organization cannot revert its durable title, archive or project',async t=>{
  const saved=idleAgent('late-metadata-poll');const f=workspaceFixture({canUseCodex:true,initialConversations:[saved],initialProjects:[project('work')]});t.after(()=>f.close());await f.ready();
  const delayed=f.delayNext(`/conversations/${saved.id}`);f.selectHistory(saved.id);await delayed.started;
  await f.organize(saved.id,{title:'已经重命名',projectId:'work',archived:true});delayed.release();await f.ready();
  const retained=f.history().find(item=>item.id===saved.id);assert.equal(retained.title,'已经重命名');assert.equal(retained.projectId,'work');assert.ok(retained.archivedAt);
});

test('an Agent GET completed after deletion cannot revive the conversation in history',async t=>{
  const saved=idleAgent('late-deleted-poll');const f=workspaceFixture({canUseCodex:true,initialConversations:[saved],handleAgentControl:true});t.after(()=>f.close());await f.ready();
  const delayed=f.delayNext(`/conversations/${saved.id}`);f.selectHistory(saved.id);await delayed.started;f.deleteHistory(saved.id);await f.click('删除对话');await f.ready();
  assert.equal(f.selectedId,null);assert.deepEqual(f.history(),[]);delayed.release();await f.ready();assert.equal(f.selectedId,null);assert.deepEqual(f.history(),[]);
});

test('a state refresh requested before organization cannot restore deleted history or stale project metadata',async t=>{
  const active=conversation('active-for-refresh'),rename=conversation('keep-with-new-title'),removed=conversation('remove-before-refresh');
  const f=workspaceFixture({initialConversations:[active,rename,removed],initialProjects:[project('work')],handleAgentControl:true});t.after(()=>f.close());await f.ready();f.selectHistory(active.id);await f.ready();
  const delayed=f.delayNext('/state');f.typeDraft('引发一次普通刷新');const sending=f.submit();await delayed.started;
  await f.organize(rename.id,{title:'刷新也不能改回的名字',projectId:'work',archived:true});await f.renameProject('work','已经更新的项目');f.deleteHistory(removed.id);await f.click('删除对话');await f.ready();
  delayed.release();await sending;await f.ready();
  const retained=f.history().find(item=>item.id===rename.id);assert.equal(retained.title,'刷新也不能改回的名字');assert.equal(retained.projectId,'work');assert.ok(retained.archivedAt);assert.equal(f.historyProps().projects.find(item=>item.id==='work').name,'已经更新的项目');assert.equal(f.history().some(item=>item.id===removed.id),false);
});

test('failed organization writes leave visible metadata untouched and failed delete keeps confirmation and drafts',async t=>{
  const saved=conversation('failed-write-retains');const f=workspaceFixture({initialConversations:[saved],handleAgentControl:true});t.after(()=>f.close());await f.ready();f.selectHistory(saved.id);await f.ready();f.typeDraft('失败以后仍保留草稿');
  f.failNext(`/conversations/${saved.id}/organization`,'PATCH');await assert.rejects(f.organize(saved.id,{title:'未成功的名字',archived:true}),/durable save failed/);await f.ready();
  assert.equal(f.history()[0].title,saved.title);assert.equal(f.history()[0].archivedAt,undefined);
  f.failNext(`/conversations/${saved.id}`,'DELETE');f.deleteHistory(saved.id);await f.click('删除对话');await f.ready();
  assert.equal(f.selectedId,saved.id);assert.ok(f.find('section',props=>props.role==='alertdialog'||props.role==='dialog'));assert.ok(f.text().includes('durable save failed'));assert.equal(f.find('textarea',props=>props['aria-label']==='消息').props.value,'失败以后仍保留草稿');
  await f.click('删除对话');await f.ready();assert.equal(f.selectedId,null);assert.deepEqual(f.history(),[]);
});

test('organization responses belonging to an earlier account cannot publish metadata into the current workspace',async t=>{
  const saved=conversation('epoch-fenced');const f=workspaceFixture({initialConversations:[saved]});t.after(()=>f.close());await f.ready();
  const delayed=f.delayNext(`/conversations/${saved.id}/organization`,'PATCH');const pending=f.organize(saved.id,{title:'旧账号迟来的改名'});await delayed.started;f.changeSession();delayed.release();
  await assert.rejects(pending,error=>error.name==='SessionChangedError');await f.ready();assert.equal(f.history()[0].title,saved.title);assert.equal(f.history()[0].customTitle,undefined);
});
