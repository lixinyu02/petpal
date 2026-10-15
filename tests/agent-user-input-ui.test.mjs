import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=ts.transpileModule(await readFile(new URL('../src/AgentUserInput.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const startTime=1900000000000;
const request=(id='question-one',extra={})=>({id,requestedAt:new Date(startTime-1000).toISOString(),expiresAt:new Date(startTime+60000).toISOString(),questions:[{id:'target',header:'执行位置',question:'选择要处理的项目',isOther:false,isSecret:false,options:[{label:'项目 A',description:'仅处理 A'},{label:'项目 B',description:'仅处理 B'}]},{id:'secret',header:'私有输入',question:'填写本次验证文本',isOther:false,isSecret:true}],...extra});

/** Execute the real question component with isolated timers and controllable HTTP delivery. */
function fixture({requests=[request()],active=true}={}){
  let index=0,tree,dirty=false,epoch=1,mounted=true,lateUpdates=0,now=startTime,timerId=0,requestWait,requestFailure,refreshWait,refreshFailure,nextRequests;
  const hooks=[],effects=[],timers=new Map(),posts=[],reads=[],busyChanges=[];
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,at)=>Object.is(value,b[at]));
  const react={useState(initial){const at=index++;hooks[at]||={value:typeof initial==='function'?initial():initial};return[hooks[at].value,value=>{if(!mounted)lateUpdates++;hooks[at].value=typeof value==='function'?value(hooks[at].value):value;dirty=true;}];},useRef(initial){const at=index++;hooks[at]||={ref:{current:initial}};return hooks[at].ref;},useEffect(effect,deps){const at=index++,old=hooks[at];if(!same(old?.deps,deps))effects.push(()=>{old?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},useId:()=> 'questions-fixture'};
  const api={getSessionEpoch:()=>epoch,isSessionChanged:error=>error?.name==='SessionChangedError',async api(path,options){posts.push({path,method:options.method,body:JSON.parse(options.body)});const wait=requestWait;requestWait=undefined;if(wait)await wait.promise;if(requestFailure){const error=requestFailure;requestFailure=undefined;throw error;}return{ok:true};}};
  const props={conversationId:'owned-chat',requests:structuredClone(requests),active,disabled:false,interactionLock:{current:false},onBusyChange(value){busyChanges.push(value);},async refresh(){reads.push(props.conversationId);const wait=refreshWait;refreshWait=undefined;if(wait)await wait.promise;if(refreshFailure){const error=refreshFailure;refreshFailure=undefined;throw error;}if(nextRequests!==undefined){props.requests=structuredClone(nextRequests);nextRequests=undefined;dirty=true;}return{id:props.conversationId,agent:{userInputs:structuredClone(props.requests)}};}};
  const element=(type,props)=>({type,props}),module={exports:{}},modules={react,'react/jsx-runtime':{jsx:element,jsxs:element},'./api':api,'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))})};
  class Clock extends Date{static now(){return now;}}
  vm.runInNewContext(source,{module,exports:module.exports,Date:Clock,setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name));return modules[name];}});
  const render=()=>{for(let pass=0;pass<8;pass++){index=0;effects.length=0;dirty=false;tree=module.exports.default(props);for(const effect of effects)effect();if(!dirty)return;}assert.fail('question fixture failed to settle');};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  const all=(type,predicate=()=>true)=>nodes(tree).filter(node=>node.type===type&&predicate(node.props));
  const flush=async()=>{for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty&&mounted)render();}};
  const button=label=>find('button',props=>text(props.children)===label);
  render();
  return{props,posts,reads,busyChanges,render,flush,find,all,button,text:()=>text(tree),get lateUpdates(){return lateUpdates;},get timerCount(){return timers.size;},
    click(label){const target=button(label);assert.ok(target,`Missing ${label}`);assert.notEqual(target.props.disabled,true);target.props.onClick();render();},
    choose(index=0,card=0){all('input',props=>props.type==='radio')[card*2+index].props.onChange();render();},
    type(value,label='私有输入的回答'){const input=find('input',props=>props['aria-label']===label);assert.ok(input);input.props.onChange({target:{value}});render();},
    complete(){this.choose();this.type('temporary-private-answer');},
    delayPost(){requestWait=deferred();return requestWait;},failPost(error){requestFailure=error;},delayRefresh(){refreshWait=deferred();return refreshWait;},failRefresh(error){refreshFailure=error;},snapshot(values){nextRequests=values;},
    update(values){Object.assign(props,values);render();},changeSession(rerender=false){epoch++;if(rerender)render();},
    advance(milliseconds){now+=milliseconds;for(const[id,timer]of[...timers])if(timer.at<=now){timers.delete(id);timer.callback();}render();},
    async close(){if(mounted){mounted=false;for(const hook of hooks)hook?.cleanup?.();}await flush();assert.equal(lateUpdates,0);assert.equal(timers.size,0);},
  };
}

test('all questions require explicit answers, with no radio defaults and password fields for secrets',async t=>{
  const f=fixture();t.after(()=>f.close());assert.equal(f.all('input',props=>props.type==='radio').every(node=>node.props.checked===false),true);assert.equal(f.find('input',props=>props['aria-label']==='私有输入的回答').props.type,'password');assert.equal(f.button('提交回答').props.disabled,true);
  f.choose();assert.equal(f.button('提交回答').props.disabled,true);f.type('private-answer');assert.equal(f.button('提交回答').props.disabled,false);assert.doesNotMatch(f.text(),/private-answer/);f.click('提交回答');await f.flush();
  assert.deepEqual(f.posts,[{path:'/codex/user-inputs/question-one',method:'POST',body:{answers:{target:{answers:['项目 A']},secret:{answers:['private-answer']}}}}]);assert.deepEqual(f.reads,['owned-chat']);assert.equal(f.find('input'),undefined);
});

test('other answers are explicit and exact option labels remain the ordinary wire answer',async t=>{
  const only=request('other-question',{questions:[{id:'choice',header:'计划',question:'采用哪种方案？',isOther:true,isSecret:false,options:[{label:'继续',description:'保持当前方案'}]}]});const f=fixture({requests:[only]});t.after(()=>f.close());assert.equal(f.find('input',props=>props.type==='text'),undefined);
  f.all('input',props=>props.type==='radio')[1].props.onChange();f.render();f.type('自定义方案','计划的回答');f.click('提交回答');await f.flush();assert.deepEqual(f.posts[0].body,{answers:{choice:{answers:['自定义方案']}}});
});

test('secret answers preserve intentional leading and trailing whitespace in the wire payload',async t=>{
  const f=fixture();t.after(()=>f.close());f.choose();f.type('  password with spaces  ');f.click('提交回答');await f.flush();assert.deepEqual(f.posts[0].body.answers.secret,{answers:['  password with spaces  ']});assert.doesNotMatch(f.text(),/password with spaces/);
});

test('free-text fields cap answers at 2000 characters and cannot submit forced oversized or whitespace-only input',async t=>{
  const f=fixture();t.after(()=>f.close());f.choose();assert.equal(f.find('input',props=>props.type==='password').props.maxLength,2000);f.type('x'.repeat(2001));assert.equal(f.button('提交回答').props.disabled,true);f.button('提交回答').props.onClick();await f.flush();assert.equal(f.posts.length,0);f.type('   ');assert.equal(f.button('提交回答').props.disabled,true);f.type('x'.repeat(2000));assert.equal(f.button('提交回答').props.disabled,false);
});

test('skip is a separate explicit request and never fabricates answers for incomplete questions',async t=>{
  const f=fixture();t.after(()=>f.close());assert.equal(f.button('提交回答').props.disabled,true);f.click('跳过本次提问');await f.flush();assert.deepEqual(f.posts[0].body,{skip:true});assert.equal(f.posts.length,1);
});

test('input Enter never submits a normal chat message or an incomplete question group',async t=>{
  const f=fixture();t.after(()=>f.close());let prevented=false;f.find('input',props=>props.type==='password').props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(f.posts.length,0);
});

test('repeated answer and skip handlers share one synchronous mutation lock across all cards and approvals',async t=>{
  const f=fixture({requests:[request(),request('question-two')]});t.after(()=>f.close());f.complete();const wait=f.delayPost(),answer=f.button('提交回答').props.onClick,skip=f.all('button',props=>text(props.children)==='跳过本次提问')[1].props.onClick;answer();answer();skip();f.render();assert.equal(f.posts.length,1);assert.equal(f.props.interactionLock.current,true);assert.equal(f.all('button').every(node=>node.props.disabled===true),true);wait.resolve();await f.flush();assert.equal(f.props.interactionLock.current,false);assert.deepEqual(f.busyChanges,[true,false]);
  const external=fixture();t.after(()=>external.close());external.complete();external.props.interactionLock.current=true;external.button('提交回答').props.onClick();external.button('跳过本次提问').props.onClick();assert.equal(external.posts.length,0);
});

test('a positive receipt consumes the form before a stale read completes and a captured handler cannot replay',async t=>{
  const f=fixture();t.after(()=>f.close());f.complete();const wait=f.delayRefresh(),handler=f.button('提交回答').props.onClick;handler();await f.flush();assert.equal(f.find('input'),undefined);wait.resolve();await f.flush();handler();await f.flush();assert.equal(f.posts.length,1);assert.equal(f.find('input'),undefined);
});

test('positive answer receipt followed by read failure reports the committed answer without exposing its value',async t=>{
  const f=fixture();t.after(()=>f.close());f.failRefresh(new Error('raw upstream detail'));f.complete();f.click('提交回答');await f.flush();assert.match(f.text(),/回答已提交.*不会重复提交/);assert.doesNotMatch(f.text(),/temporary-private-answer|raw upstream detail/);assert.equal(f.find('input'),undefined);assert.equal(f.posts.length,1);
});

for(const status of [400,422])test(`a ${status} validation refusal preserves editable fields without exposing server-supplied content`,async t=>{
  const f=fixture();t.after(()=>f.close());f.complete();f.failPost(Object.assign(new Error('temporary-private-answer raw diagnostic'),{status}));f.click('提交回答');await f.flush();assert.equal(f.find('input',props=>props.type==='password').props.value,'temporary-private-answer');assert.match(f.text(),/回答未被接受/);assert.doesNotMatch(f.text(),/raw diagnostic/);assert.equal(f.button('提交回答').props.disabled,false);
});

test('uncertain network delivery scrubs the form and requires explicit read-only refresh before another answer',async t=>{
  const f=fixture();t.after(()=>f.close());f.complete();const handler=f.button('提交回答').props.onClick;f.failPost(new Error('lost acknowledgement'));handler();await f.flush();assert.match(f.text(),/回答送达状态尚未确认/);assert.equal(f.find('input'),undefined);handler();await f.flush();assert.equal(f.posts.length,1);f.click('刷新问题状态');await f.flush();assert.equal(f.find('input',props=>props.type==='password').props.value,'');assert.equal(f.all('input',props=>props.type==='radio').every(node=>node.props.checked===false),true);assert.equal(f.posts.length,1);
});

test('server deliveryUncertain prevents answer and skip even after refresh until the native request resolves',async t=>{
  const f=fixture({requests:[request('uncertain',{deliveryUncertain:true})]});t.after(()=>f.close());assert.match(f.text(),/不会自动重发/);assert.equal(f.button('提交回答'),undefined);assert.equal(f.button('跳过本次提问'),undefined);f.click('刷新问题状态');await f.flush();assert.equal(f.find('input'),undefined);assert.equal(f.posts.length,0);f.snapshot([]);f.click('刷新问题状态');await f.flush();assert.equal(f.find('section'),undefined);
});

test('409 refreshes an authoritative resolved snapshot without retrying the answer',async t=>{
  const f=fixture();t.after(()=>f.close());f.complete();f.snapshot([]);f.failPost(Object.assign(new Error('stale question'),{status:409}));f.click('提交回答');await f.flush();assert.equal(f.posts.length,1);assert.equal(f.reads.length,1);assert.equal(f.find('input'),undefined);assert.match(f.text(),/问题状态已变化/);
});

test('expiration clears secret drafts, ends the form, and rejects a captured submit without a server write',async t=>{
  const f=fixture();t.after(()=>f.close());f.complete();const handler=f.button('提交回答').props.onClick;f.advance(60001);assert.equal(f.find('input'),undefined);handler();await f.flush();assert.equal(f.posts.length,0);f.update({requests:[request('question-one',{expiresAt:new Date(startTime+120000).toISOString()})]});assert.equal(f.find('input',props=>props.type==='password').props.value,'');
});

test('resolved or stopped requests discard drafts rather than reviving them from an identical stale card',async t=>{
  const resolved=fixture();t.after(()=>resolved.close());resolved.complete();resolved.update({requests:[]});assert.equal(resolved.find('input'),undefined);resolved.update({requests:[request()]});assert.equal(resolved.find('input',props=>props.type==='password').props.value,'');
  const stopped=fixture();t.after(()=>stopped.close());stopped.complete();stopped.update({active:false});assert.equal(stopped.find('input'),undefined);stopped.update({active:true});assert.equal(stopped.find('input',props=>props.type==='password').props.value,'');
});

test('already expired and malformed-deadline snapshots fail closed when received late in the session',async t=>{
  const f=fixture({requests:[]});t.after(()=>f.close());f.advance(90000);f.update({requests:[request()]});assert.equal(f.find('input'),undefined);f.update({requests:[request('invalid',{expiresAt:'invalid'})]});assert.equal(f.find('input'),undefined);assert.equal(f.posts.length,0);
});

for(const boundary of ['conversation','session','unmount'])for(const failed of [false,true])test(`late ${failed?'failed':'successful'} answer cannot affect the ${boundary} boundary`,async t=>{
  const f=fixture();t.after(()=>f.close());f.complete();const wait=f.delayPost();if(failed)f.failPost(Object.assign(new Error('late conflict'),{status:409}));f.click('提交回答');if(boundary==='conversation')f.update({conversationId:'new-chat',requests:[request()]});else if(boundary==='session')f.changeSession(true);else await f.close();const reads=f.reads.length,busy=f.busyChanges.length;wait.resolve();await f.flush();assert.equal(f.reads.length,reads);assert.equal(f.busyChanges.length,busy);assert.equal(f.lateUpdates,0);if(boundary!=='unmount')assert.equal(f.find('input',props=>props.type==='password').props.value,'');assert.doesNotMatch(f.text(),/late conflict|回答已提交/);
});

test('an account change without rerender fences old input and submit event handlers',async t=>{
  const f=fixture();t.after(()=>f.close());f.complete();const handler=f.button('提交回答').props.onClick;f.changeSession();handler();await f.flush();assert.equal(f.posts.length,0);
});
