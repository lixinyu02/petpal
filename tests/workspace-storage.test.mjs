import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as executionHosts from '../src/execution-hosts.mjs';
import * as projectPreferences from '../src/project-directory-preferences.mjs';
import {watchCompanionBreakpoint} from '../src/companion-mount.mjs';
import {createChatDisplay} from '../src/chat-display.mjs';
import {mergeAssistantTask,mergeChatAssistantConversation} from '../src/chat-assistant-preferences.mjs';
import {createBrowserSetupDraft} from '../src/browser-setup-draft.mjs';
import {reasoningEfforts} from '../src/desktop-settings.mjs';

const source=ts.transpileModule(await readFile(new URL('../src/App.tsx',import.meta.url),'utf8'),{
  fileName:'App.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);

/** Mount App itself and execute its real effects/handlers. Child UIs and network are isolated. */
function workspaceFixture({canUseCodex=false,storage,deniedGetter=false}={}){
  const permissions={access:'read-only',approval:'ask'},identity={instanceId:'fixture-service',userId:'fixture-user'};
  const state={instanceId:identity.instanceId,user:{id:identity.userId,username:'fixture',displayName:'Fixture',isOwner:false,canUseCodex,agentAccess:canUseCodex?'full':'none'},
    settings:{petName:'Fixture companion',persona:'Fixture',companionKind:'anime',defaultProviderId:'model'},
    providers:[{id:'model',name:'Fixture model',model:'fixture-model',protocol:'responses',supportsImages:true}],conversations:[],codex:{available:true,eligibleProviderIds:['model']}};
  const hosts=[{id:'central',name:'Fixture server',kind:'central',platform:'linux',online:true},
    {id:'pc-one',name:'Fixture PC one',kind:'desktop',platform:'win32',online:true,codex:{available:true}},
    {id:'pc-two',name:'Fixture PC two',kind:'desktop',platform:'linux',online:true,codex:{available:true}}];
  const hooks=[],effects=[],timers=new Map(),calls=[],window=new EventTarget(),document=new EventTarget();
  let index=0,tree,timerId=0,getterReads=0;
  Object.assign(window,{matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
  const readStorage=()=>{getterReads++;if(deniedGetter)throw new DOMException('Storage is blocked','SecurityError');return storage;};
  Object.defineProperty(window,'localStorage',{get:readStorage});
  document.hidden=false;
  const react={
    useState(initial){const at=index++;if(!hooks[at])hooks[at]={state:typeof initial==='function'?initial():initial};return[hooks[at].state,value=>{hooks[at].state=typeof value==='function'?value(hooks[at].state):value;}];},
    useRef(initial){const at=index++;if(!hooks[at])hooks[at]={ref:{current:initial}};return hooks[at].ref;},
    useEffect(effect,deps){const at=index++,previous=hooks[at];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps?.[i])))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
    useMemo:callback=>callback(),useCallback:callback=>callback,useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),
  };
  const element=(type,props)=>({type,props}),component=name=>({__esModule:true,default:Symbol(name)});
  const controls=Object.fromEntries(['ModelPicker','ExecutionTarget','AgentOnboarding'].map(name=>[name,Symbol(name)]));
  const api={getConnection:()=>({url:'https://fixture.invalid',token:'fixture-token'}),getIdentity:()=>identity,getSessionEpoch:()=>1,
    initConnection:async()=>({url:'https://fixture.invalid',token:'fixture-token'}),isSessionChanged:()=>false,SessionChangedError:Error,
    api:async path=>{calls.push(path);if(path==='/state')return state;if(path==='/agent/hosts')return{hosts};throw Error(`Unexpected API call: ${path}`);}};
  const speech={enabled:false,playing:false,active:false,pending:false,supported:false,stop(){},prepare(){},speak(){},speakIfEnabled(){}};
  const modules={
    react,'react/jsx-runtime':{jsx:element,jsxs:element},'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))}),
    '@capacitor/core':{Capacitor:{isNativePlatform:()=>false}},'./api':api,'./WorkspaceControls':controls,
    './companion-mount.mjs':{watchCompanionBreakpoint},'./chat-display.mjs':{createChatDisplay},'./useChatScroll':{useChatScroll:()=>({contentRef:{current:null},onScroll(){},latest(){},showLatest:false})},
    './AgentPermissions':{...component('AgentPermissions'),defaultAgentPermissions:permissions},
    './ProjectDirectory':{...component('ProjectDirectory'),useProjectDirectory:()=>({value:'',change(){}})},
    './project-directory-preferences.mjs':projectPreferences,'./execution-hosts.mjs':executionHosts,
    './ChatAssistant':{ChatAssistantControls:Symbol('ChatAssistantControls'),ChatAssistantTasks:Symbol('ChatAssistantTasks'),useChatAssistant:()=>({value:{hostId:'',providerId:'',enabled:false,permissions},snapshot:()=>undefined})},
    './chat-assistant-preferences.mjs':{mergeAssistantTask,mergeChatAssistantConversation},
    './Attachments':{useAttachments:()=>({items:[],uploading:false,error:'',clear(){},inputRef:{current:null}}),AttachmentInput:Symbol('AttachmentInput'),AttachmentDrafts:Symbol('AttachmentDrafts'),MessageImages:Symbol('MessageImages')},
    './auth/LoginGate':{ConnectionDialog:Symbol('ConnectionDialog')},'./avatar/preference':{useCompanion:()=>['anime'],hydrateCompanion:async()=>{},readCompanion:()=> 'anime'},
    './avatar/useSpeech':{useSpeech:()=>speech},'./platform/overlay':{PetOverlay:{},showPet(){}},
    './browser-setup-draft.mjs':{createBrowserSetupDraft},'./platform/computer-use':{nativeComputerUse:()=>undefined},'./platform/music-mcp':{nativeMusicMcp:()=>undefined},
    './platform/task-notification-session':{taskNotificationSession:{subscribe(){},snapshot:()=>({navigation:null}),takeNavigation(){}}},'./desktop-settings.mjs':{reasoningEfforts},
  };
  for(const name of ['DownloadsView','BrandMark','CompanionOptions','ChatMessages','ConversationHistory','AgentQueue','UpdatesSettings','CatV2','WorkspaceDisclosure','AccountsSettings','VoiceSettings','DesktopAssistantSettings','MusicMcpSettings','ComputerUseSettings','OpenCliSettings'])modules[`./${name}`]=component(name);
  const module={exports:{}},context={module,exports:module.exports,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),`Unexpected dependency: ${name}`);return modules[name];},
    window,document,location:{search:'?chat=1',origin:'https://fixture.invalid'},URL,URLSearchParams,AbortController,DOMException,
    setTimeout(callback){const id=++timerId;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id)};
  Object.defineProperty(context,'localStorage',{get:readStorage});
  vm.runInNewContext(source,context);const Component=module.exports.default;
  const render=()=>{index=0;effects.length=0;tree=Component();for(const effect of effects)effect();return tree;};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  render();
  return{find,calls,get getterReads(){return getterReads;},text:()=>text(tree),
    ready:async()=>{for(let attempt=0;attempt<3;attempt++){await flush();render();}},
    enterAgent(){find('button',props=>props['aria-label']==='Agent 执行任务').props.onClick();render();},
    selectedHost:()=>find(controls.ExecutionTarget)?.props.value,
    chooseHost(id){find(controls.ExecutionTarget).props.onChange(id);render();},
    close(){for(const hook of hooks)hook?.cleanup?.();assert.equal(timers.size,0,'effect cleanup must release every fixture timer');},
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
