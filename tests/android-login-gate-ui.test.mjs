import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=ts.transpileModule(await readFile(new URL('../src/auth/LoginGate.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?typeof tree==='symbol'?'':String(tree):text(tree.props?.children);
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
function fixture(initial=''){
  const window=new EventTarget(),hooks=[],effects=[];window.petpalLoginSession={};let savedError=initial,index=0,tree,dirty=false,mounted=true,lateUpdates=0,clearWait,clears=0;
  const react={useState(initial){const at=index++;hooks[at]||={value:initial};return[hooks[at].value,value=>{if(!mounted)lateUpdates++;hooks[at].value=typeof value==='function'?value(hooks[at].value):value;dirty=true;}];},useEffect(effect,deps){const at=index++;if(!hooks[at])effects.push(()=>{hooks[at]={cleanup:effect(),deps};});}};
  const modules={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))}),
    '../platform/ui-motion.ts':{useUiEntrance:()=>null},'../BrandMark':{default:Symbol('BrandMark')},'../avatar/preview':{avatarPreview:'synthetic-preview.png'},
    '../api':{getConnection:()=>({url:'https://fixture.invalid',token:''}),getLoginPersistenceError:()=>savedError,isSessionChanged:error=>error?.name==='SessionChangedError',clearSavedLogin:async()=>{clears++;if(clearWait)await clearWait.promise;savedError='';window.dispatchEvent(new Event('petpal:login-persistence-error'));},login:async()=>{},connectWithToken:async()=>{}},
  };
  const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,window,Event,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  const render=()=>{index=0;dirty=false;effects.length=0;tree=module.exports.ConnectionDialog({});for(const effect of effects)effect();};
  const flush=async()=>{for(let count=0;count<25;count++){await Promise.resolve();if(dirty&&mounted)render();}};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));render();
  return{flush,find,text:()=>text(tree),get clears(){return clears;},get lateUpdates(){return lateUpdates;},
    warn(message){savedError=message;window.dispatchEvent(new Event('petpal:login-persistence-error'));},
    wait(){clearWait=deferred();return clearWait;},
    close(){mounted=false;for(const hook of hooks)hook?.cleanup?.();},
  };
}
test('a logout-clear warning that arrives after the login form mounted becomes visible and can be retried',async t=>{
  const f=fixture();t.after(()=>f.close());await f.flush();assert.equal(f.find('div',props=>props.role==='alert'),undefined);
  f.warn('当前会话已关闭，但未能清除设备保存的登录。');await f.flush();assert.match(f.text(),/未能清除设备保存的登录/);
  const button=f.find('button',props=>text(props.children)==='清除设备保存的登录');assert.ok(button);const wait=f.wait();button.props.onClick();await f.flush();assert.equal(f.clears,1);assert.equal(f.find('button',props=>text(props.children)==='清除设备保存的登录').props.disabled,true);
  wait.resolve();await f.flush();assert.equal(f.find('div',props=>props.role==='alert'),undefined);assert.equal(f.find('button',props=>text(props.children)==='清除设备保存的登录'),undefined);assert.ok(f.find('form'));assert.match(f.text(),/登录你的小伴/);
});
test('initial persistence errors are shown and a closed login view unsubscribes from later errors',async()=>{
  const f=fixture('无法恢复设备保存的登录，请重新登录。');await f.flush();assert.match(f.text(),/无法恢复设备保存的登录/);f.close();f.warn('later error');await f.flush();assert.equal(f.lateUpdates,0);
});

/** Exercise the real login effect; warm loading is never an alternative gate. */
function gateFixture({token='synthetic-session',onVerified=()=>{}}={}){
  const hooks=[],effects=[],requests=[],children=Symbol('authenticated-workspace');let index=0,tree,dirty=false,mounted=true,lateUpdates=0;
  const react={
    useState(initial){const at=index++;hooks[at]||={value:initial};return[hooks[at].value,next=>{if(!mounted)lateUpdates++;const value=typeof next==='function'?next(hooks[at].value):next;if(!Object.is(value,hooks[at].value)){hooks[at].value=value;dirty=true;}}];},
    useEffect(effect,deps){const at=index++,previous=hooks[at];if(!previous||deps.some((value,position)=>!Object.is(value,previous.deps?.[position])))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
  };
  const modules={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))}),
    '../platform/ui-motion.ts':{useUiEntrance:()=>null},'../BrandMark':{default:Symbol('BrandMark')},'../avatar/preview':{avatarPreview:'synthetic-preview.png'},
    '../api':{getConnection:()=>({url:'https://fixture.invalid',token}),isSessionChanged:error=>error?.name==='SessionChangedError',api:(_route,options)=>{
      let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});requests.push({signal:options.signal,resolve,reject});return promise;
    }},
  };
  const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,window:{},AbortController,setTimeout,clearTimeout,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  const render=()=>{index=0;dirty=false;effects.length=0;tree=module.exports.default({children,onVerified});for(const effect of effects)effect();};
  const flush=async()=>{for(let count=0;count<30;count++){await Promise.resolve();if(dirty&&mounted)render();}};
  render();return{children,requests,flush,render,get tree(){return tree;},get lateUpdates(){return lateUpdates;},close(){mounted=false;for(const hook of hooks)hook?.cleanup?.();}};
}
test('page warmup runs only after valid /auth/me, before rendering the authenticated workspace',async t=>{
  let verified=0;const f=gateFixture({onVerified:()=>{verified++;assert.notEqual(f.tree,f.children);}});t.after(()=>f.close());
  assert.equal(f.requests.length,1);assert.equal(verified,0);assert.notEqual(f.tree,f.children);
  f.requests[0].resolve({instanceId:'fixture-instance',user:{id:'fixture-user'}});await f.flush();
  assert.equal(verified,1);assert.equal(f.tree,f.children);f.render();assert.equal(f.requests.length,1);
});
test('signed out, invalid identity, failed and cancelled authentication never warm private state',async t=>{
  for(const outcome of ['signed-out','invalid','failed','abandoned'])await t.test(outcome,async t=>{
    let verified=0;const f=gateFixture({token:outcome==='signed-out'?'':'synthetic-session',onVerified:()=>{verified++;}});t.after(()=>f.close());
    if(outcome==='signed-out')assert.equal(f.requests.length,0);
    else if(outcome==='failed')f.requests[0].reject(new Error('fixture unauthorized'));
    else{if(outcome==='abandoned')f.close();f.requests[0].resolve(outcome==='invalid'?{instanceId:'fixture-instance'}:{instanceId:'fixture-instance',user:{id:'fixture-user'}});}
    await f.flush();assert.equal(verified,0);assert.notEqual(f.tree,f.children);assert.equal(f.lateUpdates,0);
    if(outcome==='abandoned')assert.equal(f.requests[0].signal.aborted,true);
  });
});
test('a speculative warmup exception cannot reject an otherwise verified login',async t=>{
  const f=gateFixture({onVerified:()=>{throw new Error('fixture module prefetch failed');}});t.after(()=>f.close());
  f.requests[0].resolve({instanceId:'fixture-instance',user:{id:'fixture-user'}});await f.flush();assert.equal(f.tree,f.children);
});
test('a timed out auth response cannot trigger late warming or bypass retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let verified=0;
  const f=gateFixture({onVerified:()=>{verified++;}});t.after(()=>f.close());
  t.mock.timers.tick(15000);await f.flush();assert.equal(f.requests[0].signal.aborted,true);
  f.requests[0].resolve({instanceId:'fixture-instance',user:{id:'fixture-user'}});await f.flush();assert.equal(verified,0);assert.notEqual(f.tree,f.children);
  const retry=nodes(f.tree).find(node=>node.type==='button'&&text(node.props.children)==='重试连接');assert.ok(retry);retry.props.onClick();await f.flush();assert.equal(f.requests.length,2);
  f.requests[1].resolve({instanceId:'fixture-instance',user:{id:'fixture-user'}});await f.flush();assert.equal(verified,1);assert.equal(f.tree,f.children);
});
