import test from 'node:test';
import {createVisiblePoll} from '../src/platform/visible-poll.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as preferences from '../src/chat-assistant-preferences.mjs';
import * as projectPreferences from '../src/project-directory-preferences.mjs';
import * as reviewUi from '../src/approval-review-ui.mjs';
import * as messageReuse from '../src/conversation-message-reuse.mjs';

const source=ts.transpileModule(await readFile(new URL('../src/ChatAssistant.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const clone=value=>JSON.parse(JSON.stringify(value));
const storage=()=>{const entries=new Map();return{getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value),entries};};

/** Run the actual hook so restored settings, account boundaries and request snapshots
 * share the same state transitions as the product. No Agent command is executed. */
function fixture(local,scope='service:alice',defaultHostId='alice-pc'){
  let epoch=1,index=0,dirty=false,result;
  const hooks=[],effects=[],window=new EventTarget(),apiCalls=[];
  const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,at)=>Object.is(value,b[at]));
  const react={
    useState(initial){const at=index++;hooks[at]||={state:typeof initial==='function'?initial():initial};return[hooks[at].state,next=>{const value=typeof next==='function'?next(hooks[at].state):next;if(!Object.is(value,hooks[at].state)){hooks[at].state=value;dirty=true;}}];},
    useRef(initial){const at=index++;hooks[at]||={ref:{current:initial}};return hooks[at].ref;},
    useEffect(effect,deps){const at=index++,previous=hooks[at];if(!equal(previous?.deps,deps))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
    memo:component=>component,useCallback:callback=>callback,
  };
  const modules={
    './platform/visible-poll.mjs':{createVisiblePoll},
    react,'react/jsx-runtime':{},'react-dom':{},'lucide-react':{},
    './api':{getSessionEpoch:()=>epoch,isSessionChanged:()=>false,api:async path=>{apiCalls.push(path);throw Error('Review settings must not execute API calls');}},
    './chat-assistant-preferences.mjs':preferences,'./project-directory-preferences.mjs':projectPreferences,'./approval-review-ui.mjs':reviewUi,
    './conversation-message-reuse.mjs':messageReuse,
    './AgentPermissions':{__esModule:true,default:Symbol('AgentPermissions'),defaultAgentPermissions:{access:'read-only',approval:'ask'}},
    './WorkspaceControls':{},'./ProjectDirectory':{},'./platform/ui-motion.ts':{},
  };
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,window,localStorage:local,AbortController,setTimeout,clearTimeout,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  const props={scope,defaultHostId,allowed:true,hostState:{hosts:[{id:'alice-pc',online:true,codex:{available:true}},{id:'bob-pc',online:true,codex:{available:true}}],loading:false,error:'',refresh(){}}};
  const render=()=>{for(let pass=0;pass<8;pass++){index=0;dirty=false;effects.length=0;result=module.exports.useChatAssistant(props);for(const effect of effects)effect();if(!dirty)return result;}assert.fail('Review settings hook did not settle');};
  render();
  return{props,apiCalls,get value(){return result.value;},get changeHandler(){return result.change;},snapshot:()=>result.snapshot(),change(value){result.change(value);render();},switchAccount(scope,defaultHostId){epoch++;props.scope=scope;props.defaultHostId=defaultHostId;window.dispatchEvent(new Event('petpal:session-change'));render();},render,dispose(){for(const hook of hooks)hook?.cleanup?.();}};
}

test('the real Chat + Agent hook restores only the independent reviewer choice and freezes it into the dispatched request',t=>{
  const local=storage();preferences.saveChatAssistantPreferences(local,'service:alice',{hostId:'alice-pc',providerId:'agent-model',permissions:{access:'full-access',approval:'review',reviewProviderId:'other-api-review'}});
  const f=fixture(local);t.after(()=>f.dispose());
  assert.deepEqual(clone(f.value.permissions),{access:'read-only',approval:'ask',reviewProviderId:'other-api-review'});assert.equal(f.value.enabled,false);assert.equal(f.snapshot(),undefined);
  f.change({...f.value,enabled:true,permissions:{access:'full-access',approval:'review',reviewProviderId:'other-api-review'}});
  const request=f.snapshot();assert.deepEqual(clone(request),{enabled:true,hostId:'alice-pc',providerId:'agent-model',permissions:{access:'full-access',approval:'review',reviewProviderId:'other-api-review'}});
  f.change({...f.value,permissions:{...f.value.permissions,reviewProviderId:'next-review'}});
  assert.equal(request.permissions.reviewProviderId,'other-api-review');assert.equal(f.snapshot().permissions.reviewProviderId,'next-review');
  f.change({...f.value,permissions:{...f.value.permissions,reviewProviderId:null}});assert.equal(f.snapshot().permissions.reviewProviderId,null);
  assert.equal(preferences.readChatAssistantPreferences(local,'service:alice').reviewProviderId,undefined);assert.deepEqual(f.apiCalls,[]);
});

test('a different account restores its own reviewer with authority disabled and rejects an old account settings handler',t=>{
  const local=storage();for(const [name,reviewProviderId]of [['alice','alice-review'],['bob','bob-review']])preferences.saveChatAssistantPreferences(local,`service:${name}`,{hostId:`${name}-pc`,providerId:`${name}-agent`,reviewProviderId});
  const f=fixture(local);t.after(()=>f.dispose());
  f.change({...f.value,enabled:true,permissions:{access:'full-access',approval:'review',reviewProviderId:'alice-review'}});const oldChange=f.changeHandler;
  f.switchAccount('service:bob','bob-pc');
  assert.equal(f.value.hostId,'bob-pc');assert.equal(f.value.providerId,'bob-agent');assert.equal(f.value.permissions.reviewProviderId,'bob-review');assert.equal(f.value.enabled,false);assert.equal(f.value.permissions.approval,'ask');
  oldChange({...f.value,enabled:true,permissions:{access:'full-access',approval:'auto',reviewProviderId:'alice-review'}});f.render();
  assert.equal(f.value.enabled,false);assert.equal(f.value.permissions.reviewProviderId,'bob-review');assert.equal(preferences.readChatAssistantPreferences(local,'service:bob').reviewProviderId,'bob-review');assert.deepEqual(f.apiCalls,[]);
});
