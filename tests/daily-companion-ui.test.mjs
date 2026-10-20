import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {createVisiblePoll} from '../src/platform/visible-poll.mjs';

const compile=async file=>ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const source=await compile('../src/DailyCompanionSettings.tsx'),helperSource=await compile('../src/daily-companion.ts');
const helper={exports:{}};vm.runInNewContext(helperSource,{module:helper,exports:helper.exports,Intl,Date});
const helpers=helper.exports,clone=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const identity={instanceId:'daily-server-one',userId:'daily-user-one'};
const place={id:'101020600001',name:'北蔡镇',fullName:'上海市浦东新区北蔡镇',province:'上海市',city:'上海市',sourceUrl:'https://www.weather.com.cn/'};
const routine=(extra={})=>({...helpers.defaultCompanionSettings(),timezone:'Asia/Shanghai',notify:true,revision:'routine-one',nextRunAt:null,...extra});
const run=(extra={})=>({id:'daily-run-one',status:'completed',trigger:'manual',createdAt:'2026-10-20T00:00:00.000Z',scheduledFor:'2026-10-20T00:00:00.000Z',title:'早安，今天也要开心',content:'**早安**，新的一天开始了。',warnings:[],...extra});

/** Runs real component handlers and polling with fixture HTTP, notification
 * child, storage and React lifecycle. Never calls a production endpoint. */
function fixture(options={}){
 let epoch=1,index=0,tree,dirty=false,mounted=true,afterUnmountUpdates=0,sequence=0,actual=routine(options.routine),actualRuns=clone(options.runs||[]);
 const hooks=[],effects=[],requests=[],editing=[],timers=new Map(),deadlines=new Map(),stored=options.stored||new Map(),props={connected:true,...options.props};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,at)=>Object.is(value,b[at]));
 const react={
  useRef(value){const at=index++;hooks[at]??={ref:{current:value}};return hooks[at].ref;},
  useState(value){const at=index++;hooks[at]??={value:typeof value==='function'?value():value};return [hooks[at].value,next=>{if(!mounted){afterUnmountUpdates++;return;}hooks[at].value=typeof next==='function'?next(hooks[at].value):next;dirty=true;}];},
  useEffect(effect,deps){const at=index++,previous=hooks[at];if(!same(previous?.deps,deps))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
  useSyncExternalStore(_subscribe,snapshot){index++;return snapshot();},
 };
 const api=async(path,init={})=>{
  const call={path,method:init.method||'GET',body:init.body?JSON.parse(init.body):undefined,signal:init.signal,epoch};requests.push(call);
  if(options.request){const result=await options.request(call,{routine:actual,runs:actualRuns});if(result!==undefined)return result;}
  if(path==='/companion-routine'&&call.method==='GET')return {...identity,routine:clone(actual),runs:clone(actualRuns)};
  if(path==='/companion-routine'&&call.method==='PUT'){actual={...call.body,revision:`routine-${++sequence}`,nextRunAt:call.body.enabled?'2026-10-21T00:00:00.000Z':null};return {...identity,routine:clone(actual),runs:clone(actualRuns)};}
  if(path.startsWith('/companion-routine/locations?'))return {locations:[clone(place),{...place,id:'other-place',fullName:'另一个省的北蔡镇'}]};
  if(path==='/companion-routine/preview')return {title:'预览问候',content:'**早安**，这是一份预览。',warnings:['天气示例降级提示']};
  if(path==='/companion-routine/run'){const result=run({requestId:call.body.requestId});actualRuns=[result,...actualRuns.filter(item=>item.id!==result.id)];return {...identity,run:result};}
  if(path.startsWith('/companion-routine/runs/'))return {...identity,run:clone(actualRuns.find(item=>item.id===decodeURIComponent(path.split('/').at(-1)))||run())};
  throw Error(`Unexpected daily companion fixture request ${call.method} ${path}`);
 };
 const window=new EventTarget(),document=new EventTarget();document.hidden=false;window.navigator={onLine:true};window.sessionStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
 const Markdown=Symbol('MessageMarkdown'),Notifications=Symbol('TaskNotificationsSettings');
 const element=(type,props)=>({type,props}),modules={react,'react/jsx-runtime':{jsx:element,jsxs:element},'lucide-react':new Proxy({},{get:(_target,name)=>Symbol.for(name)}),'./api':{api,getIdentity:()=>identity,getSessionEpoch:()=>epoch,subscribeSession:()=>()=>{},isSessionChanged:error=>error?.name==='SessionChangedError'},'./daily-companion':helpers,'./MessageMarkdown':{__esModule:true,default:Markdown},'./TaskNotificationsSettings':{__esModule:true,default:Notifications},'./platform/task-notifications':{supportsTaskNotifications:()=>!!options.native},'./platform/visible-poll.mjs':{createVisiblePoll:input=>createVisiblePoll({...input,setTimeoutFn:callback=>{const id=++sequence;timers.set(id,callback);return id;},clearTimeoutFn:id=>timers.delete(id)})}};
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,window,document,Intl,Date,AbortController,setTimeout(callback,delay){assert.equal(delay,30000);const id=++sequence;deadlines.set(id,callback);return id;},clearTimeout:id=>deadlines.delete(id),crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`},require:name=>{if(name.endsWith('.css'))return {};assert.ok(Object.hasOwn(modules,name),`Unexpected module ${name}`);return modules[name];}});
 props.onEditingChange=value=>editing.push(value);
 const render=()=>{index=0;dirty=false;effects.length=0;tree=module.exports.default(props);for(const effect of effects)effect();return tree;};
 const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
 const button=label=>find('button',value=>value['aria-label']===label||text(value.children).trim()===label);
 const field=label=>nodes(tree).find(node=>['input','select'].includes(node.type)&&node.props?.['aria-label']===label);
 const flush=async()=>{for(let tick=0;tick<14;tick++){await new Promise(resolve=>setImmediate(resolve));if(dirty&&mounted)render();}};
 render();
 return {requests,editing,stored,props,find,button,field,flush,render,Markdown,Notifications,text:()=>text(tree),get afterUnmountUpdates(){return afterUnmountUpdates;},get tree(){return tree;},
  click(label,rerender=true){const node=button(label);assert.ok(node,`Missing button ${label}`);const result=node.props.onClick?.({preventDefault(){}});if(rerender)render();return result;},
  change(label,value,rerender=true){const node=field(label);assert.ok(node,`Missing field ${label}`);node.props.onChange({target:{value,checked:value}});if(rerender)render();},
  submit(rerender=true){find('form').props.onSubmit({preventDefault(){}});if(rerender)render();},
  tick(){const callbacks=[...timers.values()];timers.clear();for(const callback of callbacks)callback();},
  expire(){const callbacks=[...deadlines.values()];deadlines.clear();for(const callback of callbacks)callback();},
  session(){epoch++;render();},
  close(){mounted=false;for(const hook of hooks)hook?.cleanup?.();},
  setRoutine(value){actual=clone(value);},setRuns(value){actualRuns=clone(value);},
 };
}

test('new account defaults remain paused and require an explicit save before a manual run',async t=>{
 const f=fixture({routine:{revision:null}});t.after(()=>f.close());await f.flush();
 assert.equal(f.field('保存后启用每日陪伴').props.checked,false);assert.equal(f.field('每日陪伴时间').props.value,'08:00');assert.equal(f.button('试运行并提醒').props.disabled,true);assert.equal(f.button('保存设置').props.disabled,false);
 f.button('试运行并提醒').props.onClick();await f.flush();assert.equal(f.requests.filter(call=>call.method==='POST').length,0);
 f.submit();await f.flush();assert.equal(f.requests.find(call=>call.method==='PUT').body.enabled,false);assert.equal(f.requests.find(call=>call.method==='PUT').body.revision,null);assert.equal(f.button('试运行并提醒').props.disabled,false);
});

test('weather search requires an explicit candidate and a changed query cannot silently change the selected place',async t=>{
 const f=fixture();t.after(()=>f.close());await f.flush();f.change('问候包含天气',true);f.change('搜索天气地点','北蔡镇');f.click('搜索');await f.flush();
 assert.equal(f.field('搜索天气地点').props.value,'北蔡镇');assert.match(f.text(),/同名地点不会自动选择/);f.submit();await f.flush();assert.equal(f.requests.some(call=>call.method==='PUT'),false);assert.match(f.text(),/明确选中/);
 f.find('button',value=>text(value.children).includes(place.fullName)).props.onClick();f.render();f.change('搜索天气地点','另一个地方');f.change('保存后启用每日陪伴',true);f.submit();await f.flush();
 const saved=f.requests.find(call=>call.method==='PUT');assert.deepEqual(saved.body.location,place);assert.equal(saved.body.includeWeather,true);assert.equal(saved.body.enabled,true);
});

test('late search responses are ignored after query edits or account changes',async t=>{
 const gate=deferred(),f=fixture({request:call=>call.path.includes('/locations?')?gate.promise:undefined});t.after(()=>f.close());await f.flush();f.change('问候包含天气',true);f.change('搜索天气地点','北蔡镇');f.click('搜索');f.change('搜索天气地点','张江镇');gate.resolve({locations:[place]});await f.flush();assert.doesNotMatch(f.text(),new RegExp(place.fullName));
 f.session();assert.doesNotMatch(f.text(),/每日时间|问候记录/);assert.match(f.text(),/登录已变化/);
});

test('preview sends complete draft without revision and cannot persist or notify',async t=>{
 const f=fixture();t.after(()=>f.close());await f.flush();f.change('每日陪伴生日','10-20');f.change('每日陪伴语气','brief');f.click('预览问候');await f.flush();const call=f.requests.find(item=>item.path.endsWith('/preview'));assert.equal(call.body.birthday,'10-20');assert.equal(call.body.tone,'brief');assert.equal(Object.hasOwn(call.body,'revision'),false);assert.equal(f.requests.filter(item=>item.method==='PUT'||item.path.endsWith('/run')).length,0);assert.equal(f.find(f.Markdown).props.content,'**早安**，这是一份预览。');assert.match(f.text(),/不保存、不发送通知/);
});

test('save serializes double submissions and carries the original revision',async t=>{
 const gate=deferred(),f=fixture({request:call=>call.method==='PUT'?gate.promise:undefined});t.after(()=>f.close());await f.flush();f.change('每日陪伴时间','07:30');f.submit(false);f.submit(false);assert.equal(f.requests.filter(call=>call.method==='PUT').length,1);const call=f.requests.find(item=>item.method==='PUT');assert.equal(call.body.revision,'routine-one');assert.equal(call.body.time,'07:30');gate.resolve({...identity,routine:routine({...call.body,revision:'routine-two'}),runs:[]});await f.flush();assert.equal(f.editing.at(-1),false);
});

test('a lost save acknowledgement is read first and never blindly overwrites a changed revision',async t=>{
 const f=fixture({request:call=>{if(call.method==='PUT'){f.setRoutine(routine({...call.body,revision:'routine-two'}));throw Error('lost acknowledgement');}}});t.after(()=>f.close());await f.flush();f.change('每日陪伴时间','07:20');f.submit();await f.flush();assert.match(f.text(),/保存结果暂未确认/);assert.equal(f.editing.at(-1),true);f.click('确认原请求');await f.flush();assert.equal(f.requests.filter(call=>call.method==='PUT').length,1);assert.match(f.text(),/已确认此前的保存/);assert.equal(f.editing.at(-1),false);
});

test('an unrelated revision conflict preserves the draft and never retries its write',async t=>{
 const f=fixture({request:call=>{if(call.method==='PUT')throw Object.assign(Error('revision conflict'),{status:409});}});t.after(()=>f.close());await f.flush();f.change('每日陪伴时间','07:15');f.submit();await f.flush();assert.equal(f.field('每日陪伴时间').props.value,'07:15');assert.equal(f.requests.filter(call=>call.method==='PUT').length,1);assert.equal(f.editing.at(-1),true);assert.match(f.text(),/revision conflict/);
});

test('manual run keeps one id across unknown delivery and only retries on explicit confirmation',async t=>{
 let count=0;const f=fixture({request:call=>{if(call.path==='/companion-routine/run'&&++count===1)throw Error('connection lost');}});t.after(()=>f.close());await f.flush();f.click('试运行并提醒');await f.flush();const original=f.requests.find(call=>call.path.endsWith('/run'));assert.equal(f.stored.size,1);assert.match(f.text(),/原请求标识已保留/);f.tick();await f.flush();assert.equal(f.requests.filter(call=>call.path.endsWith('/run')).length,1);f.click('确认原请求');await f.flush();const calls=f.requests.filter(call=>call.path.endsWith('/run'));assert.equal(calls.length,2);assert.deepEqual(calls[1].body,original.body);assert.equal(f.stored.size,0);assert.equal(f.find(f.Markdown).props.content,run().content);
});

test('an unresolved run survives view remount and is never automatically submitted',async t=>{
 const stored=new Map([['petpal.companion-request:daily-server-one:daily-user-one','00000000-0000-4000-8000-000000000333']]),f=fixture({stored});t.after(()=>f.close());await f.flush();assert.ok(f.button('确认原请求'));assert.equal(f.requests.filter(call=>call.method==='POST').length,0);f.click('确认原请求');await f.flush();assert.equal(f.requests.find(call=>call.path.endsWith('/run')).body.requestId,'00000000-0000-4000-8000-000000000333');
});

test('manual submission is locked before a rerender and stale captured buttons cannot run an unsaved draft',async t=>{
 const gate=deferred(),f=fixture({request:call=>call.path==='/companion-routine/run'?gate.promise:undefined});t.after(()=>f.close());await f.flush();const handler=f.button('试运行并提醒').props.onClick;f.change('每日陪伴时间','06:50',false);handler();await f.flush();assert.equal(f.requests.filter(call=>call.path.endsWith('/run')).length,0);f.submit();await f.flush();handler();handler();assert.equal(f.requests.filter(call=>call.path.endsWith('/run')).length,1);gate.resolve({...identity,run:run()});await f.flush();
});

test('accepted active runs poll with GET only until completion and expand Markdown content',async t=>{
 const f=fixture({request:call=>{if(call.path==='/companion-routine/run')return {...identity,run:run({status:'claiming',content:''})};}});t.after(()=>f.close());await f.flush();f.click('试运行并提醒');await f.flush();assert.match(f.text(),/正在准备|正在生成/);f.tick();await f.flush();assert.equal(f.requests.filter(call=>call.method==='POST').length,1);assert.ok(f.requests.some(call=>call.path==='/companion-routine/runs/daily-run-one'));assert.equal(f.find(f.Markdown).props.content,run().content);const reads=f.requests.length;f.tick();await f.flush();assert.equal(f.requests.length,reads);
});

test('notification navigation reads only the selected owned run and native settings remain explicit',async t=>{
 const f=fixture({native:true,props:{selectedRunId:'daily-run-one'}});t.after(()=>f.close());await f.flush();assert.ok(f.requests.some(call=>call.path==='/companion-routine/runs/daily-run-one'));assert.equal(f.find(f.Notifications).props.connected,true);assert.equal(f.requests.some(call=>call.path.includes('/notifications/')),false);assert.equal(f.find(f.Markdown).props.content,run().content);
});

test('unmounted reads and previews cannot show private late content or issue next-account requests',async()=>{
 const gate=deferred(),f=fixture({request:call=>call.path.endsWith('/preview')?gate.promise:undefined});await f.flush();f.click('预览问候');const oldRun=f.button('试运行并提醒').props.onClick;f.session();f.close();gate.resolve({title:'old private title',content:'old private content',warnings:[]});await f.flush();oldRun();assert.equal(f.afterUnmountUpdates,0);assert.equal(f.requests.some(call=>call.path.endsWith('/run')),false);
});

test('disconnected view makes no HTTP or native request',async t=>{
 const f=fixture({native:true,props:{connected:false}});t.after(()=>f.close());await f.flush();assert.equal(f.requests.length,0);assert.equal(f.find(f.Notifications),undefined);assert.match(f.text(),/登录后即可/);
});

test('a hung run times out into explicit receipt confirmation and keeps its original request id',async t=>{
 const f=fixture({request:call=>{if(call.path==='/companion-routine/run')return new Promise((_resolve,reject)=>call.signal.addEventListener('abort',()=>reject(call.signal.reason),{once:true}));}});t.after(()=>f.close());await f.flush();f.click('试运行并提醒');await f.flush();const original=f.requests.find(call=>call.path.endsWith('/run')).body.requestId;f.expire();await f.flush();assert.ok(f.button('确认原请求'));assert.equal(f.button('确认原请求').props.disabled,false);assert.equal(f.requests.filter(call=>call.path.endsWith('/run')).length,1);assert.equal([...f.stored.values()][0],original);
});

test('settings validation accepts leap birthdays but rejects invalid dates, times and unconfirmed weather',()=>{
 const base=helpers.defaultCompanionSettings();assert.equal(base.enabled,false);assert.equal(base.time,'08:00');assert.equal(helpers.companionSettingsIssue({...base,birthday:'02-29'}),'');assert.match(helpers.companionSettingsIssue({...base,birthday:'02-30'}),/生日日期/);assert.match(helpers.companionSettingsIssue({...base,time:'24:00'}),/每日时间/);assert.match(helpers.companionSettingsIssue({...base,timezone:'invalid/timezone'}),/时区/);assert.match(helpers.companionSettingsIssue({...base,includeWeather:true}),/明确选中/);assert.equal(helpers.companionSettingsIssue({...base,includeWeather:true,location:place}),'');assert.equal(Object.hasOwn(helpers.companionSettings(routine()),'revision'),false);
});

test('the first field edit publishes its guard before a render or effect and reverting is also synchronous',async t=>{
 const f=fixture();t.after(()=>f.close());await f.flush();assert.equal(f.editing.at(-1),false);f.change('每日陪伴时间','07:10',false);assert.equal(f.editing.at(-1),true,'the parent must receive dirty before an old tab click can run');f.change('每日陪伴时间','08:00',false);assert.equal(f.editing.at(-1),false);f.render();await f.flush();assert.equal(f.editing.at(-1),false);
});

test('a clean preview publishes an immediate busy guard and releases it only after its receipt',async t=>{
 const gate=deferred(),f=fixture({request:call=>call.path.endsWith('/preview')?gate.promise:undefined});t.after(()=>f.close());await f.flush();assert.equal(f.editing.at(-1),false);f.click('预览问候',false);assert.equal(f.editing.at(-1),true);f.render();await f.flush();assert.equal(f.editing.at(-1),true);gate.resolve({title:'完成预览',content:'早安',warnings:[]});await f.flush();assert.equal(f.editing.at(-1),false);
});

test('a first save and manual run publish immediate guards without waiting for their state effects',async t=>{
 const saving=deferred(),f=fixture({routine:{revision:null},request:call=>call.method==='PUT'?saving.promise:undefined});t.after(()=>f.close());await f.flush();assert.equal(f.editing.at(-1),false);f.submit(false);assert.equal(f.editing.at(-1),true);saving.resolve({...identity,routine:routine(),runs:[]});await f.flush();assert.equal(f.editing.at(-1),false);
 const running=deferred(),r=fixture({request:call=>call.path.endsWith('/run')?running.promise:undefined});t.after(()=>r.close());await r.flush();r.click('试运行并提醒',false);assert.equal(r.editing.at(-1),true);running.resolve({...identity,run:run()});await r.flush();assert.equal(r.editing.at(-1),false);
});
