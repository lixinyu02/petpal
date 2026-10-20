import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {readSafeViewport,safeViewportRect} from '../src/platform/safe-viewport.mjs';

function browser({width=960,height=412,left=0,top=0,scale=1,native=false,insets={top:24,right:20,bottom:16,left:40},unresolved=false}={}){
  let reads=0,appends=0,removes=0;
  const root={dataset:{nativeInsets:String(native)},style:{getPropertyValue:()=>''},appendChild(){appends++;}};
  const document={documentElement:root,createElement(){return {setAttribute(){},style:{setProperty(){}},remove(){removes++;}};}};
  const window={innerWidth:width,innerHeight:height,visualViewport:{width,height,offsetLeft:left,offsetTop:top,scale},getComputedStyle(element){
    reads++;
    return {getPropertyValue(property){const side=property.split('-').at(-1);return unresolved&&element===root?'env(safe-area-inset-'+side+')':`${insets[side]||0}px`;}};
  }};
  return {window,document,root,insets,get reads(){return reads;},get appends(){return appends;},get removes(){return removes;}};
}

test('landscape cutouts and navigation bars reduce the visible rectangle with the same coordinates as fixed overlays',()=>{
  const f=browser({left:12,top:8});
  const safe=readSafeViewport(f.window,f.document,12);
  assert.deepEqual({...safe,viewport:undefined},{left:64,top:44,right:940,bottom:392,width:876,height:348,viewport:undefined});
  assert.deepEqual(safe.viewport,{left:12,top:8,width:960,height:412,scale:1});
});

test('native WebView margins have already consumed insets and never trigger a second CSS measurement',()=>{
  const f=browser({native:true});
  assert.deepEqual(readSafeViewport(f.window,f.document,12),{left:12,top:12,right:948,bottom:400,width:936,height:388,viewport:{left:0,top:0,width:960,height:412,scale:1}});
  assert.equal(f.reads,0);assert.equal(f.appends,0);
  f.root.dataset.nativeInsets='false';
  assert.equal(readSafeViewport(f.window,f.document,12).left,52);assert.equal(f.reads,1);
});

test('env/calc fallback resolves once per viewport shape and the transient probe never survives a measurement',()=>{
  const f=browser({unresolved:true});
  assert.equal(readSafeViewport(f.window,f.document).left,40);
  for(let iteration=0;iteration<20;iteration++)readSafeViewport(f.window,f.document,iteration%2?12:0);
  assert.equal(f.reads,2);assert.equal(f.appends,1);assert.equal(f.removes,1);
  f.window.visualViewport.offsetTop=50;
  assert.equal(readSafeViewport(f.window,f.document).top,74);
  assert.equal(f.reads,2,'panning and popup ResizeObserver callbacks reuse the resolved insets');
  f.window.visualViewport.height=240;
  const keyboard=readSafeViewport(f.window,f.document,12);
  assert.equal(keyboard.bottom,262);assert.equal(keyboard.height,176);
  assert.equal(f.reads,4);assert.equal(f.appends,2);assert.equal(f.removes,2);
});

test('manual zoom retains its offset and reduced visible width while using current keyboard height',()=>{
  const f=browser({width:225,height:280,left:70,top:100,scale:2,insets:{top:0,left:0,right:0,bottom:0}});
  const zoom=readSafeViewport(f.window,f.document,12);
  assert.equal(zoom.left,82);assert.equal(zoom.right,283);assert.equal(zoom.viewport.scale,2);
  f.window.visualViewport.height=150;f.window.visualViewport.offsetTop=130;
  const keyboard=readSafeViewport(f.window,f.document,12);
  assert.equal(keyboard.top,142);assert.equal(keyboard.bottom,268);assert.equal(keyboard.height,126);
});

test('a degenerate short keyboard viewport still produces a bounded positive rectangle',()=>{
  const rect=safeViewportRect({left:3,top:6,width:20,height:12},{left:40,right:30,top:20,bottom:20},12);
  assert.ok(rect.width>=1&&rect.height>=1);assert.ok(rect.right<=23);assert.ok(rect.bottom<=18);
});

const disclosureSource=ts.transpileModule(await readFile(new URL('../src/WorkspaceDisclosure.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];

/** Exercise the real details layout effect, with browser geometry isolated. */
function disclosureFixture(options){
  const f=browser(options),hooks=[],effects=[],frames=new Map();let cursor=0,tree,id=0;
  Object.assign(f.window,new EventTarget());
  f.window.addEventListener=()=>{};f.window.removeEventListener=()=>{};
  f.window.visualViewport.addEventListener=()=>{};f.window.visualViewport.removeEventListener=()=>{};
  f.document.addEventListener=()=>{};f.document.removeEventListener=()=>{};
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const react={useRef(initial){const at=cursor++;hooks[at]||={ref:{current:initial}};return hooks[at].ref;},useState(initial){const at=cursor++;hooks[at]||={state:initial};return [hooks[at].state,next=>{hooks[at].state=typeof next==='function'?next(hooks[at].state):next;}];},useEffect(effect,deps){const at=cursor++,previous=hooks[at];if(!same(previous?.deps,deps))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});}};
  react.useLayoutEffect=react.useEffect;
  const element=(type,props)=>({type,props});
  const modules={react,'react/jsx-runtime':{jsx:element,jsxs:element},'lucide-react':{ChevronDown:Symbol('ChevronDown')},'./platform/safe-viewport.mjs':{readSafeViewport}};
  const module={exports:{}};
  vm.runInNewContext(disclosureSource,{module,exports:module.exports,window:f.window,document:f.document,ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame(callback){const current=++id;frames.set(current,callback);return current;},cancelAnimationFrame:current=>frames.delete(current),require:name=>{if(name.endsWith('.css'))return {};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  const anchor={left:0,top:options.top+100,right:200,bottom:options.top+144},details={open:false,contains:()=>true,querySelector:()=>({getBoundingClientRect:()=>anchor})};
  const content={scrollHeight:600};
  const find=type=>nodes(tree).find(node=>node.type===type);
  const render=()=>{cursor=0;effects.length=0;tree=module.exports.default({label:'权限',summary:'权限',className:'agent-permissions',children:'内容'});find('details').props.ref.current=details;find('div').props.ref.current=content;for(const effect of effects)effect();};
  render();details.open=true;find('details').props.onToggle({currentTarget:details});render();render();
  return {...f,get placement(){return find('div').props.style;},dispose(){for(const hook of hooks)hook?.cleanup?.();assert.equal(frames.size,0);}};
}

test('the actual permissions disclosure remains inside a short keyboard viewport and horizontal cutouts',t=>{
  const f=disclosureFixture({width:432,height:240,top:80,left:12,insets:{top:24,right:18,bottom:16,left:40}});t.after(()=>f.dispose());
  const style=f.placement,safe=readSafeViewport(f.window,f.document,12);
  assert.ok(style.left>=safe.left);assert.ok(style.left+style.width<=safe.right);
  assert.ok(style.top>=safe.top);assert.ok(style.top+style.maxHeight<=safe.bottom);
});
