import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as uiMotion from '../src/platform/ui-motion.mjs';
import * as assistantPreferences from '../src/chat-assistant-preferences.mjs';
import * as projectPreferences from '../src/project-directory-preferences.mjs';
import * as approvalReviewUi from '../src/approval-review-ui.mjs';

const compile=async file=>ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText;
const [source,motionSource]=await Promise.all([compile('../src/ChatAssistant.tsx'),compile('../src/platform/ui-motion.ts')]);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];

class Surface{
  events=new Map();attributes=new Map();isConnected=true;entries=0;style={};
  addEventListener(type,callback){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(callback);}
  removeEventListener(type,callback){this.events.get(type)?.delete(callback);}
  dispatchEvent(event){for(const callback of [...(this.events.get(event.type)||[])])callback(event);}
  fire(type,target=this){this.dispatchEvent({type,target});}
  setAttribute(name,value){this.attributes.set(name,value);if(name==='data-ui-enter'&&value==='true')this.entries++;}
  getAttribute(name){return this.attributes.get(name)??null;}
  removeAttribute(name){this.attributes.delete(name);}
  count(){return [...this.events.values()].reduce((sum,callbacks)=>sum+callbacks.size,0);}
  getBoundingClientRect(){return{left:16,top:80,right:396,bottom:128};}
  querySelector(){return null;}
  querySelectorAll(){return[];}
  contains(target){return target===this;}
  focus(){}
}

/** Execute the actual dialog and hook bridge; browser geometry and service calls are isolated. */
function fixture({reduced=false,hidden=false}={}){
  const hooks=[],effects=[],frames=new Map(),layers=[],observers=new Set(),changes=[],apiCalls=[];
  const document=new Surface(),window=new Surface(),media=new Surface();
  let index=0,tree,dirty=false,frameId=0,disposed=false;
  document.documentElement=new Surface();document.body=new Surface();document.body.style.overflow='initial';document.visibilityState=hidden?'hidden':'visible';document.getElementById=()=>null;
  media.matches=reduced;window.document=document;window.matchMedia=()=>media;
  Object.assign(window,{innerWidth:412,innerHeight:960,visualViewport:Object.assign(new Surface(),{width:412,height:960,offsetLeft:0,offsetTop:0})});
  const same=(left,right)=>left&&right&&left.length===right.length&&left.every((value,at)=>Object.is(value,right[at]));
  const react={
    useState(initial){const at=index++;hooks[at]||={state:typeof initial==='function'?initial():initial};return[hooks[at].state,next=>{const value=typeof next==='function'?next(hooks[at].state):next;if(!Object.is(value,hooks[at].state)){hooks[at].state=value;dirty=true;}}];},
    useRef(initial){const at=index++;hooks[at]||={ref:{current:initial}};return hooks[at].ref;},
    useId(){const at=index++;hooks[at]||={id:`assistant-fixture-${at}`};return hooks[at].id;},
    useEffect(effect,deps){const at=index++,previous=hooks[at];if(!same(previous?.deps,deps))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
    useLayoutEffect(effect,deps){react.useEffect(effect,deps);},
    useCallback:callback=>callback,
  };
  const element=(type,props)=>({type,props}),controls={ExecutionHostPicker:Symbol('ExecutionHostPicker'),ModelPicker:Symbol('ModelPicker')};
  const permissions={access:'workspace-write',approval:'ask'};
  const assistant={value:{enabled:false,hostId:'pc-one',providerId:'provider-one',projectDirectory:'',permissions},hosts:[{id:'pc-one',name:'Fixture PC',kind:'desktop',platform:'win32',online:true,codex:{available:true}}],savedHostId:'pc-one',savingDefault:false,loading:false,error:'',change:next=>changes.push(next),saveDefault:()=>{assert.fail('animation must not save account preferences');},refresh(){}};
  const props={assistant,allowed:true,user:{id:'owner',isOwner:true,canUseCodex:true},providers:[{id:'provider-one',name:'Fixture model',model:'fixture',protocol:'responses'}]};
  const modules={
    react,'react/jsx-runtime':{jsx:element,jsxs:element},'react-dom':{createPortal:children=>element('portal',{children})},
    'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))}),
    './api':{getSessionEpoch:()=>1,isSessionChanged:()=>false,api:async path=>{apiCalls.push(path);throw Error('Unexpected API call');}},
    './chat-assistant-preferences.mjs':assistantPreferences,'./project-directory-preferences.mjs':projectPreferences,
    './approval-review-ui.mjs':approvalReviewUi,
    './AgentPermissions':{__esModule:true,default:Symbol('AgentPermissions'),defaultAgentPermissions:permissions},
    './WorkspaceControls':controls,'./ProjectDirectory':{__esModule:true,default:Symbol('ProjectDirectory')},
    './ui-motion.mjs':{...uiMotion,createUiMotionController:options=>uiMotion.createUiMotionController({window,document,...options})},
  };
  class Observer{constructor(){observers.add(this);}observe(){}disconnect(){observers.delete(this);}}
  const context={window,document,ResizeObserver:Observer,MutationObserver:Observer,HTMLDetailsElement:class{},getComputedStyle:()=>({display:'block',visibility:'visible'}),
    requestAnimationFrame(callback){const id=++frameId;frames.set(id,callback);return id;},cancelAnimationFrame:id=>frames.delete(id),
    require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),`Unexpected dependency: ${name}`);return modules[name];}};
  const load=code=>{const module={exports:{}};vm.runInNewContext(code,{...context,module,exports:module.exports});return module.exports;};
  // Keep the bridge real so active/key dependencies, cancellation and the policy are all exercised.
  modules['./platform/ui-motion.ts']=load(motionSource);
  const stopPolicy=modules['./platform/ui-motion.ts'].mountUiMotionLifecycle(),Component=load(source).ChatAssistantControls;
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  const refs=new Map();
  const commitRefs=()=>{
    const mounted=new Set();
    for(const node of nodes(tree))if(typeof node.type==='string'&&node.props?.ref){
      const ref=node.props.ref;mounted.add(ref);
      let surface=refs.get(ref);
      if(!surface){surface=new Surface();surface.offsetHeight=72;surface.scrollHeight=330;refs.set(ref,surface);if(node.props.className==='chat-assistant-layer')layers.push(surface);}
      surface.isConnected=true;ref.current=surface;
    }
    for(const [ref,surface]of refs)if(!mounted.has(ref)){surface.isConnected=false;ref.current=null;refs.delete(ref);}
  };
  const render=()=>{
    for(let pass=0;pass<6;pass++){
      index=0;effects.length=0;dirty=false;tree=Component(props);commitRefs();for(const effect of effects)effect();if(!dirty)return tree;
    }
    assert.fail('Fixture did not settle');
  };
  render();
  return{assistant,props,layers,document,window,media,find,changes,apiCalls,permissions:modules['./AgentPermissions'].default,
    open(){find('button',p=>p.className.startsWith('chat-assistant-trigger')).props.onClick();render();},
    close(){find('button',p=>p['aria-label']==='关闭 Chat + Agent 设置').props.onClick();render();},
    refresh(next={}){Object.assign(assistant,next);render();},
    setAllowed(value){props.allowed=value;render();},
    reduce(value){media.matches=value;media.fire('change');},
    hide(value){document.visibilityState=value?'hidden':'visible';document.fire('visibilitychange');},
    dispose(){if(disposed)return;disposed=true;for(const hook of hooks)hook?.cleanup?.();stopPolicy();assert.equal(observers.size,0);assert.equal(frames.size,0);assert.equal(document.body.style.overflow,'initial');assert.equal(document.count()+window.count()+media.count()+window.visualViewport.count(),0);},
  };
}

test('the actual closed dialog is static, opens once on its portal layer and reopens with a fresh finite entrance',t=>{
  const f=fixture();t.after(()=>f.dispose());assert.equal(f.layers.length,0);
  f.open();const first=f.layers[0];assert.equal(first.entries,1);assert.equal(first.getAttribute('data-ui-enter'),'true');
  const layer=f.find('div',p=>p.className==='chat-assistant-layer');assert.equal(layer.props.ref.current,first);assert.equal(f.document.body.style.overflow,'hidden');assert.equal(layer.props.style.transform,undefined);
  assert.equal(f.find('section',p=>p.role==='dialog').props['aria-modal'],'true');
  f.close();assert.equal(first.getAttribute('data-ui-enter'),null);assert.equal(first.count(),0);assert.equal(f.document.body.style.overflow,'initial');
  f.open();assert.equal(f.layers.length,2);assert.equal(f.layers[1].entries,1);
  assert.deepEqual(f.changes,[]);assert.deepEqual(f.apiCalls,[]);
});

test('host, provider, loading and task feedback refreshes do not restart an already open dialog',t=>{
  const f=fixture();t.after(()=>f.dispose());f.open();const layer=f.layers[0],before=JSON.stringify(f.assistant.value);
  for(let update=0;update<8;update++){
    f.props.providers=[...f.props.providers];f.refresh({hosts:[{...f.assistant.hosts[0],name:`Fixture PC ${update}`}],loading:!!(update%2),error:update%2?'正在确认执行电脑':''});
    assert.equal(layer.entries,1);assert.equal(f.layers.length,1);
  }
  layer.fire('animationend');assert.equal(layer.getAttribute('data-ui-enter'),null);f.refresh({error:''});assert.equal(layer.entries,1);assert.equal(layer.getAttribute('data-ui-enter'),null);
  assert.equal(JSON.stringify(f.assistant.value),before);assert.deepEqual(f.changes,[]);assert.deepEqual(f.apiCalls,[]);
});

test('reducing motion consumes an in-flight dialog entrance and restoring it cannot replay through data refreshes',t=>{
  const f=fixture();t.after(()=>f.dispose());f.open();const layer=f.layers[0];
  f.reduce(true);assert.equal(layer.getAttribute('data-ui-enter'),null);assert.equal(layer.count(),0);
  f.reduce(false);f.refresh({hosts:[...f.assistant.hosts]});assert.equal(layer.entries,1);assert.equal(layer.getAttribute('data-ui-enter'),null);
  f.close();f.open();assert.equal(f.layers[1].entries,1);
});

test('dialogs opened while hidden or reduced remain static after restoration and after service refresh',t=>{
  for(const options of[{reduced:true},{hidden:true}]){
    const f=fixture(options);t.after(()=>f.dispose());f.open();const layer=f.layers[0];assert.equal(layer.entries,0);assert.equal(layer.getAttribute('data-ui-enter'),null);
    f.reduce(false);f.hide(false);f.refresh({error:'电脑状态更新'});assert.equal(layer.entries,0);assert.equal(layer.getAttribute('data-ui-enter'),null);
    f.close();f.open();assert.equal(f.layers[1].entries,1);
  }
});

test('a nested selector or icon animation cannot consume the layer entrance; cancellation and unmount clean it',t=>{
  const f=fixture();t.after(()=>f.dispose());f.open();const layer=f.layers[0];
  layer.fire('animationend',new Surface());assert.equal(layer.getAttribute('data-ui-enter'),'true');
  layer.fire('animationcancel');assert.equal(layer.getAttribute('data-ui-enter'),null);assert.equal(layer.count(),0);
  f.close();f.open();const second=f.layers[1];assert.equal(second.getAttribute('data-ui-enter'),'true');f.dispose();assert.equal(second.getAttribute('data-ui-enter'),null);assert.equal(second.count(),0);
});

test('revoking Agent access retains the existing close behavior and cannot alter configured permissions',t=>{
  const f=fixture();t.after(()=>f.dispose());f.open();const layer=f.layers[0],before=JSON.stringify(f.assistant.value);
  f.setAllowed(false);assert.equal(f.find('section',p=>p.role==='dialog'),undefined);assert.equal(layer.getAttribute('data-ui-enter'),null);
  assert.equal(JSON.stringify(f.assistant.value),before);assert.deepEqual(f.changes,[]);assert.deepEqual(f.apiCalls,[]);
});

test('actual Chat + Agent controls bind review support and model copy to their selected executor',t=>{
  const f=fixture();t.after(()=>f.dispose());f.open();
  assert.equal(f.find(f.permissions).props.reviewCapability,undefined);
  const capability={available:true,modelStrategy:'agent-model',dynamicTools:'bounded-audio-rules-with-manual-fallback',version:1};
  f.refresh({hosts:[{...f.assistant.hosts[0],codex:{available:true,approvalReview:capability,model:'host-default'}}]});
  assert.equal(f.find(f.permissions).props.reviewCapability,capability);assert.equal(f.find(f.permissions).props.reviewModel,'fixture','selected Agent provider overrides the host default');
});
