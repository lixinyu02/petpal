import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as uiMotion from '../src/platform/ui-motion.mjs';

const compile=async file=>ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText;
const [source,motionSource]=await Promise.all([compile('../src/CompanionWorld.tsx'),compile('../src/platform/ui-motion.ts')]);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

class Surface{
  events=new Map();attributes=new Map();isConnected=true;entries=0;scrollHeight=420;scrollTop=0;
  addEventListener(type,callback){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(callback);}
  removeEventListener(type,callback){this.events.get(type)?.delete(callback);}
  dispatchEvent(event){for(const callback of [...(this.events.get(event.type)||[])])callback(event);}
  fire(type,target=this){this.dispatchEvent({type,target});}
  setAttribute(name,value){this.attributes.set(name,value);if(name==='data-ui-enter'&&value==='true')this.entries++;}
  getAttribute(name){return this.attributes.get(name)??null;}
  removeAttribute(name){this.attributes.delete(name);}
  count(){return [...this.events.values()].reduce((sum,callbacks)=>sum+callbacks.size,0);}
}

/** Real page, hook bridge and policy; isolate rendering, recording and service access. */
function fixture({reduced=false,hidden=false,authenticated=false,stateGate=null,initialKind='anime',stateKind=initialKind}={}){
  const hooks=[],layout=[],passive=[],refs=new Map(),surfaces=new Map(),commits=[],apiReads=[],choices=[],hydrations=[],frames=new Map();let frameId=0;
  const document=new Surface(),window=new Surface(),media=new Surface();
  let index=0,tree,dirty=false,kind=initialKind,disposed=false,starts=0,stops=0;
  document.documentElement=new Surface();document.visibilityState=hidden?'hidden':'visible';document.hidden=hidden;
  media.matches=reduced;window.document=document;window.matchMedia=()=>media;
  const same=(left,right)=>left&&right&&left.length===right.length&&left.every((value,at)=>Object.is(value,right[at]));
  const effect=(queue,callback,deps)=>{
    const at=index++,previous=hooks[at];
    if(!same(previous?.deps,deps))queue.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:callback()};});
  };
  const react={
    useState(initial){const at=index++;hooks[at]||={state:typeof initial==='function'?initial():initial};return[hooks[at].state,next=>{const value=typeof next==='function'?next(hooks[at].state):next;if(!Object.is(value,hooks[at].state)){hooks[at].state=value;dirty=true;}}];},
    useRef(initial){const at=index++;hooks[at]||={ref:{current:initial}};return hooks[at].ref;},
    useCallback(callback,deps){const at=index++;if(!same(hooks[at]?.deps,deps))hooks[at]={deps,value:callback};return hooks[at].value;},
    useEffect:(callback,deps)=>effect(passive,callback,deps),
    useLayoutEffect:(callback,deps)=>effect(layout,callback,deps),
  };
  const scene=Symbol('isolated-companion-scene');
  const state={instanceId:'fixture-instance',user:{id:'fixture-owner',isOwner:true,canUseCodex:true},settings:{petName:'小伴',companionKind:stateKind,defaultProviderId:'fixture-model'},providers:[{id:'fixture-model',name:'Fixture',protocol:'responses'}],codex:{eligibleProviderIds:['fixture-model']}};
  const voice={phase:'idle',active:false,listening:false,recognizing:false,thinking:false,speaking:false,transcript:'',reply:'',level:0,error:'',assistantTasks:[],performanceInput:{},conversationId:'fixture-conversation',
    start:async()=>{starts++;},stop:()=>{stops++;},interrupt:async()=>{},finishUtterance:async()=>{},updateAssistantTasks:()=>{}};
  const assistant={snapshot:{},hosts:[],value:{enabled:false},loading:false};
  const element=(type,props)=>({type,props});
  const stub=name=>({__esModule:true,default:Symbol(name)});
  const modules={
    react,'react/jsx-runtime':{jsx:element,jsxs:element},
    'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))}),
    './BrandMark':stub('BrandMark'),'./MessageMarkdown':stub('MessageMarkdown'),
    './avatar/CompanionScene':{__esModule:true,default:scene},
    './avatar/preference':{useCompanion:()=>[kind],useCompanionCatEnabled:()=>[true],chooseCompanion:async next=>{choices.push(next);kind=next;},hydrateCompanion:async next=>{hydrations.push(next);kind=next;}},
    './api':{getSessionEpoch:()=>1,initConnection:async()=>{apiReads.push('initConnection');return{token:authenticated};},api:async path=>{apiReads.push(path);assert.equal(path,'/state','Animation must not write to services');return stateGate?await stateGate.promise:state;}},
    './voice/useVoiceConversation':{useVoiceConversation:()=>voice},
    './ChatAssistant':{useChatAssistant:()=>assistant,ChatAssistantControls:Symbol('ChatAssistantControls'),ChatAssistantTasks:Symbol('ChatAssistantTasks')},
    './ui-motion.mjs':{...uiMotion,createUiMotionController:options=>uiMotion.createUiMotionController({window,document,...options})},
  };
  const context={window,document,location:{assign:()=>assert.fail('Animation cannot navigate')},
    requestAnimationFrame:callback=>{const id=++frameId;frames.set(id,callback);return id;},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:()=>assert.fail('Animation cannot schedule polling'),clearTimeout:()=>{},
    require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),`Unexpected dependency: ${name}`);return modules[name];}};
  const load=code=>{const module={exports:{}};vm.runInNewContext(code,{...context,module,exports:module.exports});return module.exports;};
  modules['./platform/ui-motion.ts']=load(motionSource);
  const stopPolicy=modules['./platform/ui-motion.ts'].mountUiMotionLifecycle(),Component=load(source).default;
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  const commitRefs=()=>{
    const mounted=new Set();
    for(const node of nodes(tree))if(typeof node.type==='string'&&node.props?.ref){
      const ref=node.props.ref;mounted.add(ref);
      let surface=refs.get(ref);
      if(!surface){surface=new Surface();refs.set(ref,surface);const history=surfaces.get(node.props.className)||[];history.push(surface);surfaces.set(node.props.className,history);}
      surface.isConnected=true;ref.current=surface;
    }
    for(const [ref,surface]of refs)if(!mounted.has(ref)){surface.isConnected=false;ref.current=null;refs.delete(ref);}
  };
  const render=()=>{
    for(let pass=0;pass<8;pass++){
      index=0;layout.length=0;passive.length=0;dirty=false;tree=Component();commitRefs();
      commits.push({kind:tree.props['data-companion-kind'],ready:tree.props['data-ready']});
      // Commit layout first: passive preference resets cannot conceal an erroneous ready entrance.
      for(const callback of layout)callback();for(const callback of passive)callback();
      if(!dirty)return tree;
    }
    assert.fail('Companion fixture did not settle');
  };
  render();
  return{document,window,media,state,voice,assistant,commits,apiReads,choices,hydrations,find,frames,
    paint(){const pending=[...frames.values()];frames.clear();for(const callback of pending)callback();},
    get starts(){return starts;},get stops(){return stops;},
    history:className=>surfaces.get(className)||[],
    surface:className=>(surfaces.get(className)||[]).at(-1),
    ready(){find(scene).props.onReady();render();},
    action(next){find(scene).props.onState({action:next});render();},
    setKind(next){kind=next;render();},
    choose(next){find('button',p=>p['aria-pressed']!==undefined&&p.children===(next==='cat'?'3D 小猫':'二次元伙伴')).props.onClick();render();},
    refresh(next={}){Object.assign(voice,next);render();},
    open(){const button=find('button',p=>p.className==='companion-voice-entry');assert.equal(button.props.disabled,false);button.props.onClick();render();},
    close(){find('button',p=>p['aria-label']==='关闭语音聊天').props.onClick();render();},
    reduce(value){media.matches=value;media.fire('change');},
    hide(value){document.hidden=value;document.visibilityState=value?'hidden':'visible';document.fire('visibilitychange');},
    async flush(){await new Promise(resolve=>setImmediate(resolve));render();},
    dispose(){if(disposed)return;disposed=true;for(const hook of hooks)hook?.cleanup?.();stopPolicy();for(const history of surfaces.values())for(const surface of history){assert.equal(surface.getAttribute('data-ui-enter'),null);assert.equal(surface.count(),0);}assert.equal(document.count()+window.count()+media.count(),0);},
  };
}

const sceneSurfaces=f=>['companion-intro','companion-aura','companion-reply'].map(name=>f.surface(name));

test('waiting wake UI keeps microphone visible and manual entry distinct from submitting a candidate',async t=>{
  const f=fixture({authenticated:true});t.after(()=>f.dispose());await f.flush();f.ready();f.open();
  f.refresh({phase:'armed',active:true,awaitingWake:true,wake:{enabled:true,phrases:['你好小伴','小伴小伴'],idleTimeoutSeconds:45}});
  const primary=f.find('button',p=>p.className==='voice-primary');assert.equal(primary.props.children.at(-1),'直接开始聊天');assert.equal(primary.props.disabled,false);
  assert.equal(f.find('meter').props['aria-label'],'语音聊天麦克风电平');assert.equal(f.find('div',p=>p.className==='voice-conversation-captions').props.hidden,false);
  f.refresh({phase:'recognizing',recognizing:true,hasUtterance:true});assert.equal(f.find('button',p=>p.className==='voice-primary').props.children.at(-1),'直接开始聊天');
  f.refresh({phase:'listening',listening:true,recognizing:false,awaitingWake:false,hasUtterance:false});assert.equal(f.find('button',p=>p.className==='voice-primary').props.children.at(-1),'说完了');assert.equal(f.find('button',p=>p.className==='voice-primary').props.disabled,true);
});
const finish=f=>{for(const surface of sceneSurfaces(f))surface?.fire('animationend');};

test('the actual companion waits for scene readiness, enters once and cleans root animation listeners',async t=>{
  const f=fixture();t.after(()=>f.dispose());
  assert.equal(f.find('main').props['data-ready'],false);
  for(const surface of sceneSurfaces(f)){assert.equal(surface.entries,0);assert.equal(surface.count(),0);}
  assert.equal(f.find('button',p=>p.className==='companion-voice-entry').props.disabled,true);
  await f.flush();f.ready();
  for(const surface of sceneSurfaces(f)){assert.equal(surface.entries,1);surface.fire('animationend',new Surface());assert.equal(surface.getAttribute('data-ui-enter'),'true');surface.fire('animationend');assert.equal(surface.getAttribute('data-ui-enter'),null);assert.equal(surface.count(),0);}
  f.ready();f.refresh({level:.5});for(const surface of sceneSurfaces(f))assert.equal(surface.entries,1);
  assert.equal(f.starts,0);assert.deepEqual(f.apiReads,['initConnection']);assert.deepEqual(f.choices,[]);
});

test('an externally selected character is unready before layout and waits for its own scene callback',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.flush();f.ready();finish(f);
  const intro=f.surface('companion-intro'),aura=f.surface('companion-aura'),firstCommit=f.commits.length;
  f.setKind('cat');
  assert.ok(f.commits.slice(firstCommit).every(commit=>commit.kind==='cat'&&commit.ready===false));
  assert.equal(intro.entries,1);assert.equal(aura.entries,1);assert.equal(f.find('main').props['data-ready'],false);
  f.refresh();assert.equal(aura.entries,1);f.ready();assert.equal(intro.entries,2);assert.equal(aura.entries,2);
  assert.deepEqual(f.choices,[]);assert.equal(f.starts,0);
});

test('delayed account hydration can change the ready character without a premature entrance',async t=>{
  const gate=deferred(),f=fixture({authenticated:true,stateGate:gate,stateKind:'cat'});t.after(()=>f.dispose());
  await f.flush();f.ready();finish(f);const aura=f.surface('companion-aura'),before=f.commits.length;
  gate.resolve(f.state);await f.flush();
  assert.deepEqual(f.hydrations,['cat']);assert.ok(f.commits.slice(before).every(commit=>!commit.ready));
  assert.equal(aura.entries,1);f.ready();assert.equal(aura.entries,2);assert.deepEqual(f.apiReads,['initConnection','/state']);
});

test('explicit character selection retains stop behavior and starts decoration only after scene ready',async t=>{
  const f=fixture({authenticated:true});t.after(()=>f.dispose());await f.flush();f.ready();finish(f);
  const aura=f.surface('companion-aura'),before=f.stops;f.choose('cat');await f.flush();
  assert.deepEqual(f.choices,['cat']);assert.ok(f.stops>before);assert.equal(aura.entries,1);assert.equal(f.find('main').props['data-ready'],false);
  f.ready();assert.equal(aura.entries,2);assert.deepEqual(f.apiReads,['initConnection','/state']);
});

test('sleep and wake cannot replay the aura while the existing voice-stop side effect remains',async t=>{
  const f=fixture();t.after(()=>f.dispose());await f.flush();f.ready();
  const aura=f.surface('companion-aura'),before=f.stops;
  f.action('sleep');assert.ok(f.stops>before);assert.equal(aura.entries,1);
  // Browser CSS cancels a sleeping aura; use its native event boundary without pretending to render CSS.
  aura.fire('animationcancel');assert.equal(aura.getAttribute('data-ui-enter'),null);assert.equal(aura.count(),0);
  f.action('idle');f.refresh();assert.equal(aura.entries,1);assert.equal(aura.getAttribute('data-ui-enter'),null);assert.equal(f.starts,0);
});

test('readiness while hidden or reduced is consumed and cannot be replayed by restoration or subtitles',async t=>{
  for(const options of[{hidden:true},{reduced:true}]){
    const f=fixture(options);t.after(()=>f.dispose());await f.flush();f.ready();
    for(const surface of sceneSurfaces(f))assert.equal(surface.entries,0);
    f.hide(false);f.reduce(false);f.refresh({transcript:'输入字幕',reply:'回复字幕',phase:'thinking'});
    for(const surface of sceneSurfaces(f)){assert.equal(surface.entries,0);assert.equal(surface.getAttribute('data-ui-enter'),null);}
    assert.equal(f.starts,0);
  }
});

test('hiding or reducing an active entrance cleans it and restoring cannot restart it',async t=>{
  for(const suppress of['hide','reduce']){
    const f=fixture();t.after(()=>f.dispose());await f.flush();f.ready();f[suppress](true);
    for(const surface of sceneSurfaces(f)){assert.equal(surface.entries,1);assert.equal(surface.getAttribute('data-ui-enter'),null);assert.equal(surface.count(),0);}
    f[suppress](false);f.refresh();for(const surface of sceneSurfaces(f))assert.equal(surface.entries,1);
  }
});

test('voice panel enters per opening and never restarts for captions, phase, level or Agent task updates',async t=>{
  const f=fixture({authenticated:true});t.after(()=>f.dispose());await f.flush();f.ready();finish(f);
  f.open();const panel=f.surface('companion-voice-panel');assert.equal(panel.entries,1);assert.equal(f.starts,1);
  assert.equal(f.surface('companion-reply').isConnected,false);
  for(const next of[{phase:'listening',listening:true,level:.4},{transcript:'今天怎么样？'},{phase:'speaking',reply:'今天也陪着你。',speaking:true},{assistantTasks:[{id:'fixture-task',status:'completed'}]}]){
    f.refresh(next);assert.equal(panel.entries,1);assert.equal(f.history('companion-voice-panel').length,1);
  }
  const captions=f.surface('voice-conversation-captions');assert.equal(f.frames.size,1);f.paint();assert.equal(captions.scrollTop,captions.scrollHeight);
  panel.fire('animationend');f.refresh({reply:'字幕刷新'});assert.equal(panel.entries,1);assert.equal(panel.getAttribute('data-ui-enter'),null);
  const before=f.stops;f.close();assert.ok(f.stops>before);assert.equal(panel.isConnected,false);assert.equal(panel.count(),0);
  f.open();assert.equal(f.history('companion-voice-panel').length,2);assert.equal(f.surface('companion-voice-panel').entries,1);assert.equal(f.starts,2);
  assert.deepEqual(f.apiReads,['initConnection','/state']);assert.deepEqual(f.choices,[]);
});

test('voice opened under reduced motion remains static on restoration and cleanup is complete on unmount',async t=>{
  const f=fixture({authenticated:true,reduced:true});t.after(()=>f.dispose());await f.flush();f.ready();f.open();
  const first=f.surface('companion-voice-panel');assert.equal(first.entries,0);f.reduce(false);f.refresh({phase:'listening',transcript:'新的语音'});assert.equal(first.entries,0);
  f.close();f.open();const second=f.surface('companion-voice-panel');assert.equal(second.entries,1);f.dispose();assert.equal(second.getAttribute('data-ui-enter'),null);assert.equal(second.count(),0);
});

test('caption scroll coalesces before paint and closes without late scroll work',async t=>{
  const f=fixture({authenticated:true});t.after(()=>f.dispose());await f.flush();f.ready();f.open();
  const captions=f.surface('voice-conversation-captions');
  for(let delta=0;delta<20;delta++)f.refresh({reply:`字幕 ${delta}`});
  assert.equal(f.frames.size,1);assert.equal(captions.scrollTop,0);
  f.paint();assert.equal(captions.scrollTop,captions.scrollHeight);assert.equal(f.frames.size,0);
  captions.scrollTop=0;f.refresh({reply:'后台字幕'});f.hide(true);assert.equal(f.frames.size,0);f.paint();assert.equal(captions.scrollTop,0);
  f.refresh({reply:'隐藏时的末尾字幕'});assert.equal(f.frames.size,0);
  f.hide(false);assert.equal(f.frames.size,1);f.paint();assert.equal(captions.scrollTop,captions.scrollHeight);
  captions.scrollTop=0;f.refresh({reply:'关闭前的字幕'});assert.equal(f.frames.size,1);f.close();assert.equal(f.frames.size,0);
  f.paint();assert.equal(captions.scrollTop,0);
});
