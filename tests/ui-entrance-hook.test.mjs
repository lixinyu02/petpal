import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as uiMotion from '../src/platform/ui-motion.mjs';

const source=ts.transpileModule(await readFile(new URL('../src/platform/ui-motion.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText;
class Surface{
  events=new Map();attributes=new Map();isConnected=true;entries=0;removals=0;scrollTop=217;children=[];
  addEventListener(type,callback){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(callback);}
  removeEventListener(type,callback){this.events.get(type)?.delete(callback);}
  dispatchEvent(event){for(const callback of [...(this.events.get(event.type)||[])])callback(event);}
  fire(type,target=this){this.dispatchEvent({type,target});}
  setAttribute(name,value){this.attributes.set(name,value);if(name==='data-ui-enter'&&value==='true')this.entries++;}
  getAttribute(name){return this.attributes.get(name)??null;}
  removeAttribute(name){if(name==='data-ui-enter'&&this.attributes.has(name))this.removals++;this.attributes.delete(name);}
  count(){return[...this.events.values()].reduce((sum,listeners)=>sum+listeners.size,0);}
}

/** The production hook and controller execute together. Only React's commit
 * scheduler and DOM/media event surfaces are deterministic fixtures. */
function fixture(context,{reduced=false,hidden=false,suppressed=false}={}){
  const document=new Surface(),window=new Surface(),media=new Surface(),localNode=new Surface(),nodes=new Set([localNode]);
  document.documentElement=new Surface();document.visibilityState=hidden?'hidden':'visible';window.document=document;
  media.matches=reduced;window.matchMedia=()=>media;
  const slots=[],effects=[];let index=0,key='conversation-one',active=true,existingRef,returned,disposed=false,subscriptions=0;
  const same=(before,after)=>before&&after&&before.length===after.length&&before.every((value,i)=>Object.is(value,after[i]));
  const react={
    useRef(value){const at=index++;return slots[at]??={current:value};},
    useLayoutEffect(callback,deps){const at=index++,before=slots[at];if(!same(before?.deps,deps)){const next={deps,cleanup:null};slots[at]=next;effects.push(()=>{before?.cleanup?.();next.cleanup=callback();});}},
  };
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>{
    if(name==='react')return react;
    assert.equal(name,'./ui-motion.mjs');
    return{...uiMotion,createUiMotionController(){const controller=uiMotion.createUiMotionController({window,document});return{...controller,subscribe(listener){subscriptions++;const unsubscribe=controller.subscribe(listener);let stopped=false;return()=>{if(stopped)return;stopped=true;subscriptions--;unsubscribe();};}};}};
  }});
  const{useUiEntrance,mountUiMotionLifecycle}=module.exports,stopPolicy=mountUiMotionLifecycle({disabled:suppressed});
  function render(next={}){
    assert.equal(disposed,false);
    if(Object.hasOwn(next,'key'))key=next.key;
    if(Object.hasOwn(next,'active'))active=next.active;
    if(Object.hasOwn(next,'existingRef'))existingRef=next.existingRef;
    index=0;returned=useUiEntrance(key,active,existingRef);
    // React attaches refs before executing layout effects. The hook must never
    // replace a measurement owner's ref, clear it, or recreate its DOM node.
    if(Object.hasOwn(next,'node'))returned.current=next.node;
    else if(!existingRef)returned.current=localNode;
    if(returned.current)nodes.add(returned.current);
    while(effects.length)effects.shift()();
    return returned;
  }
  function dispose(){
    if(disposed)return;disposed=true;
    for(const slot of slots)slot?.cleanup?.();stopPolicy();
    assert.equal(subscriptions,0,'unmount removes each entrance policy subscription');
    for(const node of nodes){assert.equal(node.getAttribute('data-ui-enter'),null);assert.equal(node.count(),0);}
    assert.equal(document.count()+window.count()+media.count(),0);
  }
  context.after(dispose);
  return{render,dispose,document,window,media,localNode,get subscriptions(){return subscriptions;},
    reduce(value){media.matches=value;media.fire('change');},
    hide(value){document.visibilityState=value?'hidden':'visible';document.fire('visibilitychange');},
  };
}

test('an external scroll ref and its original DOM node retain exact identity and position',context=>{
  const f=fixture(context),node=new Surface(),image={name:'retained-image'},scrollRef={current:node};node.children=[image];
  assert.equal(f.render({existingRef:scrollRef}),scrollRef);assert.equal(scrollRef.current,node);
  assert.equal(node.scrollTop,217);assert.equal(node.children[0],image);assert.equal(node.entries,1);assert.equal(f.subscriptions,1);
  for(let i=0;i<30;i++)assert.equal(f.render(),scrollRef);
  assert.equal(node.entries,1);assert.equal(scrollRef.current,node);assert.equal(node.scrollTop,217);assert.equal(node.children[0],image);
});

test('same-key renders preserve one local ref and never replay a completed entrance',context=>{
  const f=fixture(context),ref=f.render();assert.equal(ref.current,f.localNode);assert.equal(f.localNode.entries,1);
  for(let i=0;i<20;i++)assert.equal(f.render(),ref);
  assert.equal(f.localNode.entries,1);assert.equal(f.subscriptions,1);
  f.localNode.fire('animationend');assert.equal(f.subscriptions,0);
  for(let i=0;i<20;i++)assert.equal(f.render(),ref);
  assert.equal(f.localNode.entries,1);assert.equal(f.subscriptions,0);
});

test('changing conversation keys consumes the prior entrance before installing the next',context=>{
  const f=fixture(context),node=new Surface(),ref={current:node};f.render({existingRef:ref});
  f.render({key:'conversation-two'});assert.equal(node.entries,2);assert.equal(node.removals,1);assert.equal(f.subscriptions,1);assert.equal(node.count(),2);
  node.fire('animationend',new Surface());assert.equal(f.subscriptions,1,'child animations cannot finish the container entrance');
  node.fire('animationcancel');assert.equal(node.getAttribute('data-ui-enter'),null);assert.equal(f.subscriptions,0);
});

test('replacing an external ref object safely releases the old DOM node with an unchanged key',context=>{
  const f=fixture(context),oldNode=new Surface(),nextNode=new Surface(),before={current:oldNode},after={current:nextNode};
  f.render({existingRef:before});assert.equal(f.render({existingRef:after}),after);
  assert.equal(before.current,oldNode);assert.equal(after.current,nextNode);assert.equal(oldNode.getAttribute('data-ui-enter'),null);assert.equal(oldNode.count(),0);
  assert.equal(nextNode.entries,1);assert.equal(f.subscriptions,1);assert.equal(nextNode.scrollTop,217);
});

test('an owning ref may receive a new DOM node when the conversation key changes',context=>{
  const f=fixture(context),before=new Surface(),after=new Surface(),ref={current:before};f.render({existingRef:ref});
  before.isConnected=false;assert.equal(f.render({key:'conversation-two',node:after}),ref);
  assert.equal(ref.current,after);assert.equal(before.getAttribute('data-ui-enter'),null);assert.equal(before.count(),0);assert.equal(after.entries,1);assert.equal(f.subscriptions,1);
});

test('inactive view cleanup and reactivation support a remounted scroll node',context=>{
  const f=fixture(context),before=new Surface(),after=new Surface(),ref={current:before};f.render({existingRef:ref});
  ref.current=null;f.render({active:false});assert.equal(before.getAttribute('data-ui-enter'),null);assert.equal(f.subscriptions,0);
  ref.current=after;f.render({active:true});assert.equal(ref.current,after);assert.equal(after.entries,1);assert.equal(f.subscriptions,1);
});

for(const cause of ['reduced','hidden','suppressed'])test(`${cause} policy skips entrances and restoration cannot replay a consumed key`,context=>{
  const f=fixture(context,{reduced:cause==='reduced',hidden:cause==='hidden',suppressed:cause==='suppressed'});
  f.render();assert.equal(f.localNode.entries,0);assert.equal(f.subscriptions,0);
  if(cause==='reduced')f.reduce(false);if(cause==='hidden')f.hide(false);
  f.render();assert.equal(f.localNode.entries,0);assert.equal(f.subscriptions,0);
  if(cause!=='suppressed'){f.render({key:'another-conversation'});assert.equal(f.localNode.entries,1);}
});

for(const cause of ['reduced','hidden'])test(`${cause} cancels an active entrance without replay after restoration`,context=>{
  const f=fixture(context);f.render();assert.equal(f.localNode.entries,1);
  if(cause==='reduced')f.reduce(true);else f.hide(true);
  assert.equal(f.localNode.getAttribute('data-ui-enter'),null);assert.equal(f.subscriptions,0);
  if(cause==='reduced')f.reduce(false);else f.hide(false);
  f.render();assert.equal(f.localNode.entries,1);assert.equal(f.subscriptions,0);
});

test('unmount cleans the captured node even after its owner has cleared ref.current',context=>{
  const f=fixture(context),node=new Surface(),ref={current:node};f.render({existingRef:ref});
  ref.current=null;node.isConnected=false;f.dispose();assert.equal(ref.current,null);assert.equal(node.getAttribute('data-ui-enter'),null);assert.equal(node.count(),0);
});

// Contract: node replacement is signalled by key, active or the ref object.
// This hook deliberately adds no observer for silent ref.current mutations.
