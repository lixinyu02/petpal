import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=ts.transpileModule(await readFile(new URL('../src/AgentQueue.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const idle=()=>({revision:9,queueRevision:0,paused:false,queue:[],run:null,submissions:[],approvals:[]});

/** Real AgentQueue handlers with controlled transport, refresh, and scope changes. */
function fixture({state=idle(),configChanged=false}={}){
  let index=0,tree,dirty=false,epoch=1,mounted=true,lateUpdates=0,refreshCount=0,newCount=0,requestWait,requestFailure,refreshWait,refreshFailure,nextSnapshot;
  const hooks=[],effects=[],requests=[],refreshes=[];
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={useState(initial){const at=index++;hooks[at]||={value:typeof initial==='function'?initial():initial};return[hooks[at].value,value=>{if(!mounted)lateUpdates++;hooks[at].value=typeof value==='function'?value(hooks[at].value):value;dirty=true;}];},useRef(initial){const at=index++;hooks[at]||={ref:{current:initial}};return hooks[at].ref;},useEffect(effect,deps){const at=index++,old=hooks[at];if(!same(old?.deps,deps))effects.push(()=>{old?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},useId:()=> 'context-fixture'};
  const api={getSessionEpoch:()=>epoch,isSessionChanged:error=>error?.name==='SessionChangedError',async api(path,options){requests.push({path,method:options.method,body:JSON.parse(options.body)});const wait=requestWait;requestWait=undefined;if(wait)await wait.promise;if(requestFailure){const error=requestFailure;requestFailure=undefined;throw error;}return{ok:true};}};
  const props={conversationId:'same-conversation',state:structuredClone(state),configChanged,hosts:[{id:'pc',online:true}],onNewConversation(){newCount++;},async refresh(){refreshCount++;refreshes.push(props.conversationId);const wait=refreshWait;refreshWait=undefined;if(wait)await wait.promise;if(refreshFailure){const error=refreshFailure;refreshFailure=undefined;throw error;}if(nextSnapshot){props.state=structuredClone(nextSnapshot);nextSnapshot=undefined;dirty=true;}}};
  const element=(type,props)=>({type,props}),module={exports:{}},modules={react,'react/jsx-runtime':{jsx:element,jsxs:element},'./api':api,'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))})};
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name));return modules[name];}});
  const render=()=>{for(let pass=0;pass<8;pass++){index=0;effects.length=0;dirty=false;tree=module.exports.default(props);for(const effect of effects)effect();if(!dirty)return;}assert.fail('context fixture failed to settle');};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  const button=label=>find('button',props=>typeof label==='string'?(props['aria-label']||text(props.children))===label:label.test(props['aria-label']||text(props.children)));
  const flush=async()=>{for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty&&mounted)render();}};
  render();
  return{props,requests,refreshes,render,flush,find,button,text:()=>text(tree),get refreshCount(){return refreshCount;},get newCount(){return newCount;},get lateUpdates(){return lateUpdates;},click(label){const target=button(label);assert.ok(target,`Missing ${label}`);assert.notEqual(target.props.disabled,true,`Disabled ${label}`);target.props.onClick();render();},check(value=true){const input=find('input',props=>props.type==='checkbox');assert.ok(input);assert.notEqual(input.props.disabled,true);input.props.onChange({target:{checked:value}});render();},delayRequest(){requestWait=deferred();return requestWait;},failRequest(error){requestFailure=error;},delayRefresh(){refreshWait=deferred();return refreshWait;},failRefresh(error){refreshFailure=error;},snapshot(value){nextSnapshot=value;},changeState(update){props.state={...props.state,...update};render();},changeConversation(){props.conversationId='other-conversation';props.state=idle();props.configChanged=true;render();},changeSession(renderNow=false){epoch++;if(renderNow)render();},async close(){if(mounted){mounted=false;for(const hook of hooks)hook?.cleanup?.();}await flush();assert.equal(lateUpdates,0);}};
}
const open='重建当前会话的 CLI 上下文',submit='确认重建当前会话的 CLI 上下文';

for(const trigger of ['configuration','error-code','snapshot-hint'])test(`${trigger} exposes a direct contextual repair entry without expanding the queue`,async t=>{
  const state=idle();if(trigger==='error-code')state.run={id:'old-run',status:'error',errorCode:'thread_context_missing',error:'CLI 上下文丢失'};else if(trigger==='snapshot-hint')state.contextRepairNeeded=true;
  const f=fixture({state,configChanged:trigger==='configuration'});t.after(()=>f.close());assert.ok(f.button(open));assert.equal(f.find('ol').props.hidden,true);assert.match(f.text(),trigger==='configuration'?/模型连接配置已更新/:/CLI 上下文已丢失/);assert.equal(f.requests.length,0);
});

for(const oldFailure of [false,true])test(`manual repair remains available in collapsed options for ${oldFailure?'a legacy failure without a code':'an idle conversation'}`,async t=>{
  const state=idle();if(oldFailure)state.run={id:'old-run',status:'error',error:'旧版网络错误'};const f=fixture({state});t.after(()=>f.close());assert.equal(f.button(open),undefined);f.click(oldFailure?/展开队列/:/任务选项，展开/);assert.ok(f.button(open));f.click(open);assert.match(f.text(),/网页聊天记录、当前输入和图片会保留/);assert.match(f.text(),/CLI 记忆和旧会话绑定会清除.*补充需要的上下文.*不会自动发送/);assert.equal(f.find('input').props.checked,false);
});

test('repair is an explicit checked action and refreshes only the original conversation without any task submission',async t=>{
  const f=fixture({configChanged:true});t.after(()=>f.close());f.click(open);assert.equal(f.button(submit).props.disabled,true);f.button(submit).props.onClick();await f.flush();assert.equal(f.requests.length,0);f.check();f.click(submit);await f.flush();
  assert.deepEqual(f.requests,[{path:'/conversations/same-conversation/agent/context/reset',method:'POST',body:{revision:9,confirmed:true}}]);assert.deepEqual(f.refreshes,['same-conversation']);assert.equal(f.newCount,0);assert.equal(f.props.conversationId,'same-conversation');assert.match(f.text(),/CLI 记忆已重置.*网页历史已保留.*补充需要的上下文.*当前输入和图片不会自动发送/);
});

for(const [kind,update,reason]of[['running',{run:{id:'run',status:'running'}},/停止或等待/],['stopping',{run:{id:'run',status:'stopping'}},/停止或等待/],['queue',{queue:[{id:'queued',content:'任务',attachmentIds:[],permissions:{access:'read-only',approval:'ask'}}]},/待执行队列/],['unknown',{run:{id:'run',status:'unknown'}},/未知执行状态/],['uncertain',{run:{id:'run',status:'completed'},submissions:[{submissionId:'s',entryId:'uncertain',status:'uncertain'}]},/未知执行状态/]])test(`${kind} blocks context repair with an explanation and rejects direct invocation`,async t=>{
  const f=fixture({state:{...idle(),...update},configChanged:true});t.after(()=>f.close());assert.equal(f.button(open).props.disabled,true);assert.match(f.text(),reason);assert.ok(f.button(open).props['aria-describedby']);f.button(open).props.onClick();f.render();assert.equal(f.find('input'),undefined);assert.equal(f.requests.length,0);
});

test('canceling and reopening the form never carries a checked confirmation',async t=>{
  const f=fixture({configChanged:true});t.after(()=>f.close());f.click(open);f.check();f.click('取消修复');assert.equal(f.find('input'),undefined);f.click(open);assert.equal(f.find('input').props.checked,false);assert.equal(f.requests.length,0);
});

test('collapsing manual options discards the confirmation instead of reviving a checked action',async t=>{
  const f=fixture();t.after(()=>f.close());f.click(/任务选项，展开/);f.click(open);f.check();f.click(/任务选项，收起/);assert.equal(f.find('input'),undefined);f.click(/任务选项，展开/);f.click(open);assert.equal(f.find('input').props.checked,false);assert.equal(f.requests.length,0);
});

for(const boundary of ['revision','configuration','queue','conversation','session'])test(`${boundary} changes invalidate a checked form and a captured old submit handler`,async t=>{
  const f=fixture({configChanged:true});t.after(()=>f.close());f.click(open);f.check();const handler=f.button(submit).props.onClick;
  if(boundary==='revision')f.changeState({revision:10});else if(boundary==='configuration'){f.props.configChanged=false;f.render();}else if(boundary==='queue')f.changeState({queue:[{id:'queued',content:'任务',attachmentIds:[],permissions:{access:'read-only',approval:'ask'}}]});else if(boundary==='conversation')f.changeConversation();else f.changeSession(true);
  assert.equal(f.find('input'),undefined);handler();await f.flush();assert.equal(f.requests.length,0);
});

test('account changes before a rerender still fence a captured checked handler',async t=>{
  const f=fixture({configChanged:true});t.after(()=>f.close());f.click(open);f.check();const handler=f.button(submit).props.onClick;f.changeSession();handler();await f.flush();assert.equal(f.requests.length,0);
});

test('repeat clicks share the mutation lock and never resend a successful reset',async t=>{
  const f=fixture({configChanged:true});t.after(()=>f.close());f.click(open);f.check();const wait=f.delayRequest(),handler=f.button(submit).props.onClick;handler();handler();f.render();assert.equal(f.requests.length,1);assert.equal(f.button(open).props.disabled,true);f.button(open).props.onClick();f.render();assert.equal(f.find('input'),undefined);wait.resolve();await f.flush();handler();await f.flush();assert.equal(f.requests.length,1);assert.equal(f.refreshCount,1);
});

test('CAS conflict refreshes changed state, clears confirmation, and never retries',async t=>{
  const f=fixture({configChanged:true});t.after(()=>f.close());const changed={...idle(),revision:20,contextRepairNeeded:true};f.snapshot(changed);f.failRequest(Object.assign(new Error('revision conflict'),{status:409}));f.click(open);f.check();f.click(submit);await f.flush();assert.deepEqual(f.props.state,changed);assert.match(f.text(),/会话状态已变化，已刷新/);assert.equal(f.find('input'),undefined);assert.equal(f.requests.length,1);assert.equal(f.refreshCount,1);
});

test('successful reset retains durable notice after refresh and separates a failed read from the committed reset',async t=>{
  const f=fixture({configChanged:true});t.after(()=>f.close());f.failRefresh(new Error('offline'));f.click(open);f.check();f.click(submit);await f.flush();assert.match(f.text(),/网页历史已保留/);assert.match(f.text(),/操作已提交，但队列暂时无法刷新/);assert.equal(f.requests.length,1);
  const restored=fixture({state:{...idle(),contextNotice:'CLI 上下文已重置，网页历史已保留；请主动发送要继续的任务。'}});t.after(()=>restored.close());assert.match(restored.text(),/网页历史已保留.*主动发送/);assert.equal(restored.requests.length,0);
});

for(const boundary of ['conversation','session','unmount'])for(const failed of [false,true])test(`late ${failed?'failed':'successful'} reset cannot update the ${boundary} scope`,async t=>{
  const f=fixture({configChanged:true});t.after(()=>f.close());f.click(open);f.check();const wait=f.delayRequest();if(failed)f.failRequest(Object.assign(new Error('late conflict'),{status:409}));f.click(submit);if(boundary==='conversation')f.changeConversation();else if(boundary==='session')f.changeSession();else await f.close();wait.resolve();await f.flush();assert.equal(f.refreshCount,0);assert.equal(f.lateUpdates,0);assert.doesNotMatch(f.text(),/CLI 记忆已重置|late conflict|会话状态已变化/);
});
