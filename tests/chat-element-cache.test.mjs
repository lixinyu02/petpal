import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareChatElements} from '../src/chat-element-cache.mjs';

const message=(id,extra={})=>({id,role:'assistant',content:`content ${id}`,status:'complete',...extra});
const noop=()=>{};
const shared={petName:'小伴',mode:'chat',working:false,busy:false,sleeping:false,supported:true,feedback:'ready',reading:false,pending:false,error:'',onRead:noop,onStop:noop,onNotice:noop,onUseInPrompt:noop};
function fixture(){
  let creations=0,projections=0;
  const create=(key,props)=>({key,props,sequence:++creations});
  const project=(item,inputs)=>{projections++;return{message:item,...inputs};};
  return{prepare:(before,messages,props=shared,scope='conversation')=>prepareChatElements(before,scope,messages,props,project,create),get creations(){return creations;},get projections(){return projections;}};
}

test('tail content updates keep all unchanged element identities and the stable ID sequence',()=>{
  const f=fixture();let messages=Array.from({length:1000},(_,index)=>message(`id-${index}`)),snapshot=f.prepare(null,messages);const ids=snapshot.ids,prefix=snapshot.elements.slice(0,-1);
  for(let index=0;index<100;index++){
    const previous=snapshot;messages=[...messages.slice(0,-1),{...messages.at(-1),content:`stream ${index}`}];snapshot=f.prepare(snapshot,messages);
    assert.equal(snapshot.ids,ids);assert.deepEqual(snapshot.elements.slice(0,-1),prefix);assert.notEqual(snapshot.elements.at(-1),previous.elements.at(-1));
  }
  assert.equal(f.creations,1100);assert.equal(f.projections,1100,'1000 mount + 100 changed tails, instead of 101000 per-row projections');
  assert.equal(f.prepare(snapshot,messages,{...shared}),snapshot);assert.equal(f.projections,1100,'equivalent fresh shared input does not reproject unchanged rows');
});

test('deletion, insertion and cross-boundary reorder keep one flat sibling list and release deleted cache entries',()=>{
  const f=fixture(),messages=Array.from({length:130},(_,index)=>message(`id-${index}`)),initial=f.prepare(null,messages),elements=new Map(initial.entries.map(entry=>[entry.id,entry.element]));
  const reordered=[messages[64],...messages.slice(1,32),messages[100],...messages.slice(32,64),...messages.slice(65,100),...messages.slice(101)];
  const next=f.prepare(initial,reordered);assert.equal(next.entries.length,129);assert.equal(next.elements.length,129);assert.ok(!next.ids.includes('id-0'));assert.ok(next.ids.includes('id-129'));
  for(let index=0;index<reordered.length;index++){assert.equal(next.elements[index],elements.get(reordered[index].id));assert.equal(next.elements[index].key,`conversation:${reordered[index].id}`);}
  assert.equal(f.creations,130);
  const inserted=message('new-row'),withInsert=f.prepare(next,[...reordered.slice(0,31),inserted,...reordered.slice(31)]);assert.equal(f.creations,131);assert.equal(withInsert.elements[31].key,'conversation:new-row');
  const empty=f.prepare(withInsert,[]);assert.deepEqual(empty.entries,[]);assert.deepEqual(empty.elements,[]);assert.deepEqual(empty.ids,[]);assert.equal(f.prepare(empty,[]),empty);
});

test('every actual row prop and a newly introduced prop participates in reuse, including callback identity',()=>{
  const f=fixture(),messages=[message('one'),message('two')],initial=f.prepare(null,messages);
  for(const key of Object.keys(shared)){
    const value=shared[key],changed=typeof value==='function'?()=>{}:typeof value==='boolean'?!value:`changed ${value}`;
    const next=f.prepare(initial,messages,{...shared,[key]:changed});assert.notEqual(next.elements[0],initial.elements[0],key);assert.equal(next.elements[0].props[key],changed,key);
  }
  const extra=f.prepare(initial,messages,{...shared,newerServerOrUiField:'new'});assert.notEqual(extra.elements[0],initial.elements[0]);assert.equal(extra.elements[0].props.newerServerOrUiField,'new');
  const removed=f.prepare(extra,messages,shared);assert.notEqual(removed.elements[0],extra.elements[0]);assert.ok(!Object.hasOwn(removed.elements[0].props,'newerServerOrUiField'));
});

test('a new immutable message reference carries all status, attachment and unknown-field updates',()=>{
  const f=fixture(),initial=f.prepare(null,[message('one')]);
  for(const extra of [{status:'cancelled'},{attachments:[{id:'image'}]},{model:'new-model'},{steered:true},{newServerField:{value:1}},{outputRendering:'auto'}]){
    const changed={...initial.entries[0].message,...extra},next=f.prepare(initial,[changed]);assert.notEqual(next.elements[0],initial.elements[0]);assert.equal(next.elements[0].props.message,changed);assert.equal(next.ids,initial.ids);
  }
});

test('conversation scopes, canonical ID replacement and ambiguous IDs never borrow another row identity',()=>{
  const f=fixture(),one=message('one'),initial=f.prepare(null,[one]);const switched=f.prepare(initial,[one],shared,'other-conversation');assert.notEqual(switched.elements[0],initial.elements[0]);assert.equal(switched.elements[0].key,'other-conversation:one');
  const canonical=f.prepare(initial,[{...one,id:'canonical'}]);assert.notEqual(canonical.elements[0],initial.elements[0]);assert.deepEqual(canonical.ids,['canonical']);
  for(const messages of [[one,one],[message(''),message('')],[message(undefined)]]){
    const duplicated=f.prepare(initial,messages),next=f.prepare(duplicated,messages);assert.equal(next.elements.length,messages.length);for(let index=0;index<messages.length;index++)assert.notEqual(next.elements[index],duplicated.elements[index]);
  }
});

test('preparing an abandoned or failed render never mutates the committed comparison snapshot',()=>{
  const f=fixture(),first=message('one'),initial=f.prepare(null,[first],{...shared});for(const entry of initial.entries){Object.freeze(entry.props);Object.freeze(entry);}Object.freeze(initial.inputs);Object.freeze(initial.entries);Object.freeze(initial.elements);Object.freeze(initial.ids);Object.freeze(initial);
  const candidate=f.prepare(initial,[{...first,content:'not committed'}]);assert.notEqual(candidate,initial);assert.equal(initial.elements[0].props.message.content,'content one');assert.equal(f.prepare(initial,[first]),initial);
  assert.throws(()=>prepareChatElements(initial,'conversation',[{...first,content:'throws'}],shared,message=>({message,...shared}),()=>{throw new Error('synthetic rendering failure');}),/synthetic rendering failure/);
  assert.throws(()=>prepareChatElements(initial,'conversation',[first],{...shared,working:true},()=>{throw new Error('synthetic projection failure');},initial.createElement),/synthetic projection failure/);
  const abandonedInputs=f.prepare(initial,[first],{...shared,feedback:'not committed'});assert.equal(abandonedInputs.inputs.feedback,'not committed');assert.equal(initial.inputs.feedback,shared.feedback);
  assert.equal(f.prepare(initial,[first]),initial);
});

test('shared input equality uses complete own keys and Object.is, including new, removed and undefined fields',()=>{
  const f=fixture(),messages=[message('one')],initial=f.prepare(null,messages,{...shared,amount:NaN});
  assert.equal(f.prepare(initial,messages,{...shared,amount:NaN}),initial);assert.equal(f.projections,1);
  const positive=f.prepare(initial,messages,{...shared,amount:0}),negative=f.prepare(positive,messages,{...shared,amount:-0});
  assert.notEqual(positive.elements[0],negative.elements[0]);assert.ok(Object.is(negative.elements[0].props.amount,-0));
  const added=f.prepare(negative,messages,{...shared,amount:-0,newField:undefined});assert.notEqual(added.elements[0],negative.elements[0]);assert.ok(Object.hasOwn(added.elements[0].props,'newField'));
  const removed=f.prepare(added,messages,{...shared,amount:-0});assert.notEqual(removed.elements[0],added.elements[0]);assert.ok(!Object.hasOwn(removed.elements[0].props,'newField'));
  const replaced=f.prepare(removed,messages,{...shared,differentField:-0});assert.notEqual(replaced.elements[0],removed.elements[0]);assert.ok(!Object.hasOwn(replaced.elements[0].props,'amount'));assert.equal(f.projections,6);
});

test('changing projection or element factory cannot reuse stale output',()=>{
  const messages=[message('one')],inputs={value:'input'},project=(message,inputs)=>({message,label:inputs.value}),create=(key,props)=>({key,props});
  const initial=prepareChatElements(null,'conversation',messages,inputs,project,create);
  const nextProject=(message,inputs)=>({message,label:`updated ${inputs.value}`});
  const projected=prepareChatElements(initial,'conversation',messages,inputs,nextProject,create);assert.notEqual(projected.elements[0],initial.elements[0]);assert.equal(projected.elements[0].props.label,'updated input');
  const nextCreate=(key,props)=>({key,props,kind:'replacement'});
  const created=prepareChatElements(projected,'conversation',messages,inputs,nextProject,nextCreate);assert.notEqual(created.elements[0],projected.elements[0]);assert.equal(created.elements[0].kind,'replacement');
  assert.equal(prepareChatElements(created,'conversation',messages,{...inputs},nextProject,nextCreate),created);
});

test('changed speech inputs with unchanged row output publish current metadata then use the fast path',()=>{
  let projections=0;
  const messages=[message('one'),message('two')],create=(key,props)=>({key,props});
  const project=(message,inputs)=>{projections++;return{message,reading:inputs.speechId===message.id&&inputs.playing};};
  const initial=prepareChatElements(null,'conversation',messages,{speechId:'elsewhere',playing:true},project,create);
  const nextInputs={speechId:'another-conversation',playing:true},next=prepareChatElements(initial,'conversation',messages,nextInputs,project,create);
  assert.notEqual(next,initial);assert.equal(next.inputs,nextInputs);assert.equal(next.entries,initial.entries);assert.equal(next.elements,initial.elements);assert.equal(projections,4);
  assert.equal(prepareChatElements(next,'conversation',messages,{...nextInputs},project,create),next);assert.equal(projections,4);
  const owned=prepareChatElements(next,'conversation',messages,{speechId:'one',playing:true},project,create);
  assert.equal(owned.elements[0].props.reading,true);assert.notEqual(owned.elements[0],initial.elements[0]);assert.equal(owned.elements[1],initial.elements[1]);
});

test('equivalent replacement projections publish their identity without remounting rows',()=>{
  let newProjections=0;
  const messages=[message('one')],inputs={value:'input'},project=(message,inputs)=>({message,label:inputs.value}),create=(key,props)=>({key,props});
  const initial=prepareChatElements(null,'conversation',messages,inputs,project,create);
  const replacement=(message,inputs)=>{newProjections++;return{message,label:inputs.value};};
  const next=prepareChatElements(initial,'conversation',messages,inputs,replacement,create);
  assert.notEqual(next,initial);assert.equal(next.properties,replacement);assert.equal(next.elements,initial.elements);assert.equal(newProjections,1);
  assert.equal(prepareChatElements(next,'conversation',messages,inputs,replacement,create),next);assert.equal(newProjections,1);
});
