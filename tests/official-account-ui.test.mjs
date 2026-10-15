import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const compiled=async path=>ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const platformSource=await compiled('../src/platform/official-account.ts'),componentSource=await compiled('../src/OfficialAccountSettings.tsx');
const signedOut={supported:true,state:'signed-out',activeProfileId:null,planUsageEnabled:false,profiles:[],models:[]};
const signedIn={supported:true,state:'signed-in',activeProfileId:'profile-one',planUsageEnabled:true,profiles:[{id:'profile-one',email:'alice@example.invalid',label:'Alice',signedIn:true,planUsageEnabled:true}],models:[{id:'model-one',model:'official-one',displayName:'官方模型',supportsImages:true}]};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?typeof tree==='symbol'?'':String(tree):text(tree.props?.children);

function fixture({platform='desktop',connected=true,target='local',value=signedOut,read,start,cancel,select,logout,refresh,resumeUsage}={}){
  const window=new EventTarget(),document=new EventTarget(),timers=new Map(),calls=[];
  let actual=structuredClone(value),epoch=1,identity={instanceId:'local-service',userId:'ordinary-member'},timerId=0,index=0,tree,dirty=false,mounted=true,updatesAfterUnmount=0,connections=0;
  document.hidden=false;
  const native={
    async status(){calls.push({action:'status'});return read?read(calls.filter(item=>item.action==='status').length,actual):structuredClone(actual);},
    async start(input){calls.push({action:'start',input});if(start)return start(input,actual);actual={...actual,state:'signing-in'};return structuredClone(actual);},
    async cancel(){calls.push({action:'cancel'});actual=cancel?await cancel(actual):structuredClone(value);return structuredClone(actual);},
    async select(profileId){calls.push({action:'select',profileId});actual=select?await select(profileId,actual):{...actual,activeProfileId:profileId};return structuredClone(actual);},
    async logout(){calls.push({action:'logout'});actual=logout?await logout(actual):structuredClone(signedOut);return structuredClone(actual);},
    async refresh(){calls.push({action:'refresh'});return refresh?refresh(actual):structuredClone(actual);},
    async resumeUsage(){calls.push({action:'resumeUsage'});actual=resumeUsage?await resumeUsage(actual):{...actual,usage:{...actual.usage,state:'unverified'}};return structuredClone(actual);},
  };
  if(platform==='desktop')window.petpal={officialAccount:native};else if(platform==='legacy')window.petpal={};
  class SessionChangedError extends Error{}
  const api={getConnection:()=>({url:target==='local'?'http://127.0.0.1:4318':'https://central.example.invalid',token:connected?'session-private':''}),getExecutionTarget:()=>target,getIdentity:()=>connected?identity:null,getSessionEpoch:()=>epoch,SessionChangedError};
  const platformModule={exports:{}},context={module:platformModule,exports:platformModule.exports,window,document,Error,setTimeout(callback){const id=++timerId;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),require:name=>{assert.equal(name,'../api');return api;}};
  vm.runInNewContext(platformSource,context);const session=platformModule.exports;
  const hooks=[],effects=[],same=(a,b)=>a&&b&&a.length===b.length&&a.every((item,at)=>Object.is(item,b[at]));
  const react={
    useId(){index++;return'official-fixture';},
    useSyncExternalStore(subscribe,snapshot){const at=index++;if(!hooks[at])hooks[at]={cleanup:subscribe(()=>{if(!mounted)updatesAfterUnmount++;dirty=true;})};return snapshot();},
    useEffect(effect,deps){const at=index++,previous=hooks[at];if(!same(previous?.deps,deps))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
  };
  const module={exports:{}},modules={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))}),'./platform/official-account':session};
  vm.runInNewContext(componentSource,{module,exports:module.exports,window,document,setTimeout:context.setTimeout,clearTimeout:context.clearTimeout,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  const render=()=>{index=0;dirty=false;effects.length=0;tree=module.exports.default({connected,onConnect:()=>connections++});for(const effect of effects)effect();return tree;};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  const flush=async()=>{for(let count=0;count<20;count++){await Promise.resolve();if(dirty&&mounted)render();}};
  render();
  return{session,native,calls,flush,find,get tree(){return tree;},get updatesAfterUnmount(){return updatesAfterUnmount;},get connections(){return connections;},get timerCount(){return timers.size;},text:()=>text(tree),render,
    click(label){const node=find('button',props=>props['aria-label']===label||text(props.children)===label);assert.ok(node,`Missing button ${label}`);node.props.onClick();},
    choose(profileId){find('select',props=>props['aria-label']==='切换官方账号').props.onChange({target:{value:profileId}});},
    setValue(next){actual=structuredClone(next);},
    setConnected(next){connected=next;epoch++;window.dispatchEvent(new Event('petpal:session-change'));render();},
    changeSession(){epoch++;identity={...identity,userId:'next-user'};window.dispatchEvent(new Event('petpal:session-change'));render();},
    setHidden(hidden){document.hidden=hidden;document.dispatchEvent(new Event('visibilitychange'));},
    fireTimers(){const pending=[...timers.values()];timers.clear();for(const callback of pending)callback();},
    close(){if(!mounted)return;mounted=false;for(const hook of hooks)hook?.cleanup?.();assert.equal(timers.size,0);},
  };
}

test('official controls are absent on Web Android and older desktop clients',async t=>{
  for(const platform of ['web','android','legacy']){const f=fixture({platform});t.after(()=>f.close());await f.flush();assert.equal(f.tree,null);assert.equal(f.calls.length,0);}
});
test('ordinary desktop users can sign in; disconnected and central connections never read native account',async t=>{
  const loggedOut=fixture({connected:false});t.after(()=>loggedOut.close());await loggedOut.flush();assert.equal(loggedOut.calls.length,0);assert.match(loggedOut.text(),/先登录/);
  const central=fixture({target:'remote'});t.after(()=>central.close());await central.flush();assert.equal(central.calls.length,0);assert.match(central.text(),/当前连接的是远程服务/);central.click('更改服务连接');assert.equal(central.connections,1);assert.doesNotMatch(central.text(),/使用 ChatGPT 登录/);
  const f=fixture();t.after(()=>f.close());await f.flush();assert.equal(f.calls.length,1);assert.equal(f.find('button',props=>text(props.children)==='使用 ChatGPT 登录').props.disabled,false);
  f.click('使用 ChatGPT 登录');await f.flush();assert.deepEqual(f.calls.at(-1),{action:'start',input:undefined});assert.match(f.text(),/系统浏览器/);assert.match(f.text(),/取消登录/);
});
test('login status polls only while pending, pauses hidden pages and stops after completion',async t=>{
  const f=fixture();t.after(()=>f.close());await f.flush();assert.equal(f.timerCount,0);
  f.click('使用 ChatGPT 登录');await f.flush();assert.equal(f.timerCount,1);
  f.setHidden(true);assert.equal(f.timerCount,0);f.setValue(signedIn);f.setHidden(false);await f.flush();assert.equal(f.timerCount,0);assert.match(f.text(),/alice@example.invalid/);assert.match(f.text(),/1 个官方模型/);assert.match(f.text(),/图文/);assert.match(f.text(),/Chat 与 Agent/);
  const before=f.calls.length;f.fireTimers();await f.flush();assert.equal(f.calls.length,before);
});
test('cancel can interrupt a slow login and a late old result cannot overwrite it or request a default',async t=>{
  const login=deferred(),f=fixture({start:()=>login.promise});t.after(()=>f.close());await f.flush();f.click('使用 ChatGPT 登录');await f.flush();assert.match(f.text(),/取消登录/);
  f.click('取消登录');await f.flush();assert.equal(f.session.officialAccountSnapshot().defaultRequest,0);assert.match(f.text(),/尚未连接/);
  login.resolve(signedIn);await f.flush();assert.match(f.text(),/尚未连接/);assert.equal(f.timerCount,0);assert.equal(f.session.officialAccountSnapshot().defaultRequest,0);
});
test('saved accounts switch or reauthorize through native calls and logout clears model state',async t=>{
  const value={...signedIn,profiles:[...signedIn.profiles,{id:'profile-two',email:'bob@example.invalid',label:'Bob',signedIn:true,planUsageEnabled:true},{id:'profile-expired',email:'expired@example.invalid',label:'Expired',signedIn:false,planUsageEnabled:false}]};
  const f=fixture({value});t.after(()=>f.close());await f.flush();assert.equal(f.session.officialAccountSnapshot().defaultRequest,0,'routine warmup does not request a new default');
  f.choose('profile-two');await f.flush();assert.deepEqual(f.calls.at(-1),{action:'select',profileId:'profile-two'});assert.ok(f.session.officialAccountSnapshot().defaultRequest>0);
  f.choose('profile-expired');await f.flush();assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))),{action:'start',input:{profileId:'profile-expired'}});
  f.click('取消登录');await f.flush();f.click('退出官方账号');await f.flush();assert.match(f.text(),/尚未连接/);assert.doesNotMatch(f.text(),/官方模型可用/);assert.equal(f.session.officialAccountSnapshot().defaultRequest,0);
});
test('status reads deduplicate, malformed statuses and raw native errors never leak or fabricate success',async t=>{
  const gate=deferred(),f=fixture({read:()=>gate.promise});t.after(()=>f.close());await f.flush();const second=f.session.readOfficialAccount();await f.flush();assert.equal(f.calls.length,1);
  gate.resolve({...signedOut,accessToken:'never-public',privateKey:'never-public'});await second;await f.flush();assert.equal(JSON.stringify(f.session.officialAccountSnapshot()).includes('never-public'),false);
  const failure=fixture({start:()=>{throw new Error('Bearer private-native-token');}});t.after(()=>failure.close());await failure.flush();failure.click('使用 ChatGPT 登录');await failure.flush();assert.match(failure.text(),/无法打开官方登录/);assert.equal(failure.text().includes('private-native-token'),false);assert.equal(failure.session.officialAccountSnapshot().defaultRequest,0);
  assert.throws(()=>f.session.readOfficialAccountStatus({supported:true,state:'signed-in',models:[]}),/不完整/);
});
test('account switch and unmount discard stale status and clear polling without cancelling another account',async t=>{
  const old=deferred(),f=fixture({read:call=>call===1?old.promise:signedOut});t.after(()=>f.close());await f.flush();f.changeSession();await f.flush();old.resolve(signedIn);await f.flush();assert.match(f.text(),/尚未连接/);assert.doesNotMatch(f.text(),/alice@example/);assert.equal(f.calls.filter(item=>item.action==='cancel').length,0);
  const late=deferred(),closed=fixture({read:()=>late.promise});await closed.flush();closed.close();late.resolve(signedIn);await closed.flush();assert.equal(closed.updatesAfterUnmount,0);
});
test('initial status failure offers safe retry and future reads do not remain permanently locked',async t=>{
  let failing=true;
  const f=fixture({read:()=>{if(failing)throw new Error('Authorization: Bearer private-token');return signedOut;}});t.after(()=>f.close());await f.flush();assert.match(f.text(),/无法读取/);assert.equal(f.text().includes('private-token'),false);
  failing=false;f.click('重新读取');await f.flush();assert.equal(f.find('button',props=>text(props.children)==='使用 ChatGPT 登录').props.disabled,false);assert.doesNotMatch(f.text(),/无法读取/);
});

const usage={state:'available',checkedAt:'2026-10-15T08:00:00.000Z',lastModel:'official-one',completedRequests:3,inputTokens:160,outputTokens:40,totalTokens:200};
test('official usage distinguishes real connection counters from unavailable plan balance and exposes only a fixed official link',async t=>{
  const f=fixture({value:{...signedIn,usage:{...usage,accessToken:'private-usage-token',percentRemaining:88}}});t.after(()=>f.close());await f.flush();
  assert.match(f.text(),/最近验证可用/);assert.match(f.text(),/上次请求验证/);assert.match(f.text(),/3 次请求/);assert.match(f.text(),/输入 160 · 输出 40 · 合计 200/);assert.match(f.text(),/本次连接 Token 统计/);assert.match(f.text(),/不代表套餐剩余额度/);assert.doesNotMatch(f.text(),/88%/);
  assert.equal(JSON.stringify(f.session.officialAccountSnapshot()).includes('private-usage-token'),false);
  const link=f.find('a',props=>text(props.children).includes('查看官方用量'));assert.equal(link.props.href,'https://chatgpt.com/settings/usage');assert.equal(link.props.target,'_blank');
  const before=f.calls.length;f.click('刷新官方用量状态');await f.flush();assert.deepEqual(f.calls.at(-1),{action:'status'});assert.equal(f.calls.length,before+1);assert.equal(f.calls.filter(call=>call.action==='refresh').length,0,'usage refresh cannot run inference or fabricate a quota check');
});
test('usage cache polls only while the signed-in settings page is visible and releases timers at logout or unmount',async t=>{
  const f=fixture({value:{...signedIn,usage}});t.after(()=>f.close());await f.flush();assert.equal(f.timerCount,1);const before=f.calls.length;
  f.fireTimers();await f.flush();assert.equal(f.calls.length,before+1);assert.equal(f.timerCount,1);
  f.setHidden(true);assert.equal(f.timerCount,0);f.fireTimers();await f.flush();assert.equal(f.calls.length,before+1);
  f.setHidden(false);assert.equal(f.timerCount,1);f.click('退出官方账号');await f.flush();assert.equal(f.timerCount,0);assert.doesNotMatch(f.text(),/官方额度与用量/);
});
test('limited usage resumes as unverified; ineligible accounts can choose another account without repeated OAuth',async t=>{
  const f=fixture({value:{...signedIn,usage:{...usage,state:'limit-reached'}}});t.after(()=>f.close());await f.flush();assert.match(f.text(),/套餐额度已受限/);
  f.click('额度恢复后重试');await f.flush();assert.deepEqual(f.calls.at(-1),{action:'resumeUsage'});assert.match(f.text(),/尚未验证/);assert.match(f.text(),/3 次请求/);assert.doesNotMatch(f.text(),/最近验证可用/);
  const blocked=fixture({value:{...signedIn,usage:{...usage,state:'not-eligible'}}});t.after(()=>blocked.close());await blocked.flush();assert.match(blocked.text(),/账号或工作区暂不具备使用资格/);assert.equal(blocked.find('button',props=>text(props.children)==='额度恢复后重试'),undefined);assert.equal(blocked.find('button',props=>text(props.children)==='重新授权'),undefined);assert.equal(blocked.calls.filter(call=>call.action==='start').length,0);blocked.click('添加官方账号');await blocked.flush();assert.deepEqual(blocked.calls.at(-1),{action:'start',input:undefined});
});
test('usage rejects negative or unbounded counters and malformed times rather than showing false quota',async t=>{
  const f=fixture();t.after(()=>f.close());await f.flush();
  for(const patch of [{totalTokens:-1},{completedRequests:Number.MAX_SAFE_INTEGER+1},{checkedAt:'not-a-date'},{state:'100-percent-left'}])assert.throws(()=>f.session.readOfficialAccountStatus({...signedIn,usage:{...usage,...patch}}),/用量状态不完整/);
});
