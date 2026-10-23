import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createVisiblePoll} from '../src/platform/visible-poll.mjs';
import {SessionChangedError} from '../src/auth/request-scope.mjs';

// Exercise the shipped App effect. The fake transport deliberately ignores
// AbortSignal so a late response cannot silently inherit a newer poll owner.
const source=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const app=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='App');
const effects=app.body.statements.filter(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==='useEffect'&&node.expression.arguments[0]?.getText(ast).includes("'/agent/hosts'"));
assert.equal(effects.length,1,'the actual Agent host polling effect must remain identifiable');
const compiled=ts.transpileModule('globalThis.beginPolling='+effects[0].expression.arguments[0].getText(ast)+';',{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const host=(id='central-fresh',extra={})=>({id,kind:'central',online:true,...extra});
class Surface extends EventTarget{
  listeners=new Map();
  addEventListener(type,callback,options){super.addEventListener(type,callback,options);const set=this.listeners.get(type)||new Set();set.add(callback);this.listeners.set(type,set);}
  removeEventListener(type,callback,options){super.removeEventListener(type,callback,options);this.listeners.get(type)?.delete(callback);}
  get listenerCount(){return [...this.listeners.values()].reduce((sum,set)=>sum+set.size,0);}
}

function fixture(t,{hidden=false,online=true,connected=true,canUseCodex=true,hostScope='account-one',petOnly=false,mode='codex'}={}){
  const document=new Surface(),window=new Surface(),requests=[],timers=new Map(),errors=[],loadings=[];
  document.hidden=hidden;window.navigator={onLine:online};
  let epoch=1,clock=0,timerId=0,mounted=true,lateUpdates=0;
  let hosts=[host('central-old')],defaultHostId='central-old',error='',loading=false;
  const setTimeoutFn=(callback,delay)=>{const id=timerId++;timers.set(id,{callback,due:clock+delay});return id;};
  const clearTimeoutFn=id=>timers.delete(id);
  const update=apply=>{if(!mounted){lateUpdates++;return;}apply();};
  const context={document,window,AbortController,JSON,connected,state:{user:{canUseCodex}},hostScope,petOnly,currentMode:mode,accountEpoch:1,
    getSessionEpoch:()=>epoch,isSessionChanged:value=>value?.name==='SessionChangedError',
    setAgentHosts:value=>update(()=>{hosts=typeof value==='function'?value(hosts):value;}),
    setDefaultHostId:value=>update(()=>{defaultHostId=typeof value==='function'?value(defaultHostId):value;}),
    setHostsError:value=>update(()=>{error=typeof value==='function'?value(error):value;errors.push(error);}),
    setHostsLoading:value=>update(()=>{loading=typeof value==='function'?value(loading):value;loadings.push(loading);}),
    setNativeExecutor:()=>assert.fail('a browser-only host poll must not query a native executor'),
    api(path,options={}){assert.equal(path,'/agent/hosts');assert.equal(options.method,undefined,'host discovery must remain read-only');const pending=deferred();requests.push({path,options,...pending});return pending.promise;},
    createVisiblePoll:options=>createVisiblePoll({...options,setTimeoutFn,clearTimeoutFn}),
  };
  vm.runInNewContext(compiled,context);
  let cleanup=context.beginPolling();
  const flush=async()=>{for(let index=0;index<10;index++)await new Promise(resolve=>setImmediate(resolve));};
  const close=()=>{if(!mounted)return;cleanup?.();cleanup=null;mounted=false;};
  t.after(async()=>{close();for(const request of requests)request.resolve({hosts:[host()]});await flush();assert.equal(lateUpdates,0,'disposed polling must never update React state');assert.equal(timers.size,0);assert.equal(document.listenerCount+window.listenerCount,0);});
  return{requests,timers,document,window,errors,loadings,close,flush,
    get hosts(){return hosts;},get defaultHostId(){return defaultHostId;},get error(){return error;},get loading(){return loading;},
    async resolve(index,value){requests[index].resolve(value);await flush();},
    async reject(index,value){requests[index].reject(value);await flush();},
    hide(value){document.hidden=value;document.dispatchEvent(new Event('visibilitychange'));},
    online(value){window.navigator.onLine=value;window.dispatchEvent(new Event(value?'online':'offline'));},
    changeAccount(){epoch++;cleanup?.();cleanup=null;},
    async advance(milliseconds){const end=clock+milliseconds;for(;;){const next=[...timers].filter(([,timer])=>timer.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;timers.delete(next[0]);clock=next[1].due;next[1].callback();await flush();}clock=end;await flush();},
  };
}

const invalidResponses=[
  ['missing hosts',{}],['null response',null],['array response',[]],['null hosts',{hosts:null}],
  ['non-array hosts',{hosts:{}}],['null host',{hosts:[null]}],['missing host fields',{hosts:[{}]}],
  ['numeric id',{hosts:[host(1)]}],['null id',{hosts:[host(null)]}],
  ['numeric kind',{hosts:[host('central',{kind:1})]}],['string online',{hosts:[host('central',{online:'true'})]}],
  ['missing online',{hosts:[{id:'central',kind:'central'}]}],
  ['mixed valid and invalid hosts',{hosts:[host(),null]}],
];
for(const [name,response] of invalidResponses)test(`Agent host poll rejects ${name}, preserves prior state, and recovers on a valid response`,async t=>{
  const f=fixture(t),before=f.hosts;
  await f.resolve(0,response);
  assert.equal(f.hosts,before,'a rejected response must not overwrite the last usable host list');
  assert.equal(f.defaultHostId,'central-old');assert.equal(f.loading,false);
  assert.equal(typeof f.error,'string');assert.ok(f.error.trim(),'bad host data must surface a visible error');
  await f.advance(5000);assert.equal(f.requests.length,2);
  const fresh=[host(),host('remote-one',{kind:'remote',online:false})];await f.resolve(1,{hosts:fresh});
  assert.equal(f.hosts,fresh);assert.equal(f.defaultHostId,'central-fresh');assert.equal(f.error,'');assert.equal(f.loading,false);
});

test('Agent host poll passes a bounded request deadline on initial and repeated reads',async t=>{
  const f=fixture(t);assert.equal(f.requests[0].options.timeoutMs,12000);assert.ok(f.requests[0].options.signal instanceof AbortSignal);
  await f.resolve(0,{hosts:[host()]});await f.advance(5000);
  assert.equal(f.requests.length,2);assert.equal(f.requests[1].options.timeoutMs,12000);
});

test('Agent host poll retains hosts on transport failure and clears the error after an empty valid list',async t=>{
  const f=fixture(t),before=f.hosts;await f.reject(0,new Error('Connection timed out'));
  assert.equal(f.hosts,before);assert.equal(f.defaultHostId,'central-old');assert.equal(f.error,'Connection timed out');assert.equal(f.loading,false);
  await f.advance(5000);const empty=[];await f.resolve(1,{hosts:empty});
  assert.equal(f.hosts,empty);assert.equal(f.defaultHostId,'');assert.equal(f.error,'');
});

for(const cause of ['hidden','offline'])test(`Agent host poll ignores ${cause} late success and error, then refreshes once`,async t=>{
  for(const rejected of [false,true]){
    const f=fixture(t),before=f.hosts;
    if(cause==='hidden')f.hide(true);else f.online(false);
    assert.equal(f.requests[0].options.signal.aborted,true);await f.advance(30000);assert.equal(f.requests.length,1);
    if(cause==='hidden')f.hide(false);else f.online(true);
    assert.equal(f.requests.length,1,'ignored cancellation must retain the single-flight slot');
    if(rejected)await f.reject(0,new Error('late connection error'));else await f.resolve(0,{hosts:[host('late')]});
    assert.equal(f.hosts,before);assert.equal(f.defaultHostId,'central-old');assert.equal(f.errors.length,0);assert.equal(f.requests.length,2);
    await f.resolve(1,{hosts:[host()]});assert.equal(f.defaultHostId,'central-fresh');assert.equal(f.error,'');f.close();
  }
});

test('Agent host poll drops late success and error after account replacement or unmount',async t=>{
  for(const cause of ['account','unmount'])for(const rejected of [false,true]){
    const f=fixture(t),before=f.hosts;
    if(cause==='account')f.changeAccount();else f.close();
    assert.equal(f.requests[0].options.signal.aborted,true);
    if(rejected)await f.reject(0,new Error('old account error'));else await f.resolve(0,{hosts:[host('old-account')]});
    assert.equal(f.hosts,before);assert.equal(f.defaultHostId,'central-old');assert.equal(f.errors.length,0);assert.equal(f.timers.size,0);
  }
});

test('Agent host poll does not display session replacement as a connection failure',async t=>{
  const f=fixture(t),before=f.hosts;await f.reject(0,new SessionChangedError());
  assert.equal(f.hosts,before);assert.equal(f.errors.length,0);
});

test('Agent host polling respects connection, permission, account scope, and pet-only boundaries',async t=>{
  for(const options of [{connected:false},{canUseCodex:false},{hostScope:''},{petOnly:true}]){
    const f=fixture(t,options);assert.equal(f.requests.length,0);assert.equal(f.document.listenerCount+f.window.listenerCount,0);await f.advance(30000);assert.equal(f.requests.length,0);f.close();
  }
});
