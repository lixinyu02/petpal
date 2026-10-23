import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=ts.transpileModule(await readFile(new URL('../src/auth/LoginGate.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?typeof tree==='symbol'?'':String(tree):text(tree.props?.children);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
test('connection dialogs expose their visible heading as the accessible dialog name', t => {
  const f=fixture('',{onClose(){}});t.after(()=>f.close());
  const dialog=f.find('div',props=>props.role==='dialog');assert.ok(dialog);
  assert.equal(dialog.props['aria-modal'],'true');
  const heading=f.find('h2',props=>props.id===dialog.props['aria-labelledby']);
  assert.ok(heading);assert.equal(text(heading),'登录你的小伴');
});
function fixture(initial='',{onClose,ownerConnection,apiBridge,environmentWindow}={}){
  const window=environmentWindow||new EventTarget(),hooks=[],effects=[],logins=[],pairings=[];window.petpalLoginSession??={};if(ownerConnection)window.petpal={connection:ownerConnection};let savedError=initial,index=0,tree,dirty=false,mounted=true,lateUpdates=0,clearWait,loginWait,clears=0,epoch=0;
  const react={useRef(initial){const at=index++;return hooks[at]??=( {current:initial});},useState(initial){const at=index++;hooks[at]||={value:initial};return[hooks[at].value,value=>{if(!mounted)lateUpdates++;hooks[at].value=typeof value==='function'?value(hooks[at].value):value;dirty=true;}];},useEffect(effect,deps){const at=index++;if(!hooks[at])effects.push(()=>{hooks[at]={cleanup:effect(),deps};});}};
  const modules={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))}),
    '../platform/ui-motion.ts':{useUiEntrance:()=>null},'../BrandMark':{default:Symbol('BrandMark')},'../avatar/preview':{avatarPreview:'synthetic-preview.png'},
    '../api':{getConnection:()=>({url:'https://fixture.invalid',token:''}),getSessionEpoch:()=>epoch,getLoginPersistenceError:()=>savedError,isSessionChanged:error=>error?.name==='SessionChangedError',clearSavedLogin:async()=>{clears++;if(clearWait)await clearWait.promise;savedError='';window.dispatchEvent(new Event('petpal:login-persistence-error'));},login:async(...args)=>{logins.push(args);if(loginWait)await loginWait.promise;},connectWithToken:async(...args)=>{pairings.push(args);},...apiBridge},
  };
  const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,window,Event,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  const render=()=>{index=0;dirty=false;effects.length=0;tree=module.exports.ConnectionDialog({close:onClose});for(const effect of effects)effect();};
  const flush=async()=>{for(let count=0;count<25;count++){await Promise.resolve();if(dirty&&mounted)render();}};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));render();
  return{flush,find,text:()=>text(tree),logins,pairings,get clears(){return clears;},get lateUpdates(){return lateUpdates;},
    warn(message){savedError=message;window.dispatchEvent(new Event('petpal:login-persistence-error'));},
    wait(){clearWait=deferred();return clearWait;},
    waitLogin(){loginWait=deferred();return loginWait;},replaceSession(){epoch++;},
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
function gateFixture({token='synthetic-session',onVerified=()=>{},persistenceError='',native=true,online=true,hidden=false,apiBridge,environmentWindow}={}){
  const hooks=[],effects=[],requests=[],restorations=[],children=Symbol('authenticated-workspace'),window=environmentWindow||new EventTarget(),document=new EventTarget();window.navigator={onLine:online};if(native)window.petpalLoginSession??={};document.hidden=hidden;let index=0,tree,dirty=false,mounted=true,lateUpdates=0,epoch=0,now=10000;
  const react={
    useRef(initial){const at=index++;return hooks[at]??={current:initial};},
    useState(initial){const at=index++;hooks[at]||={value:initial};return[hooks[at].value,next=>{if(!mounted)lateUpdates++;const value=typeof next==='function'?next(hooks[at].value):next;if(!Object.is(value,hooks[at].value)){hooks[at].value=value;dirty=true;}}];},
    useEffect(effect,deps){const at=index++,previous=hooks[at];if(!previous||deps.some((value,position)=>!Object.is(value,previous.deps?.[position])))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
  };
  const modules={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':new Proxy({},{get:(_target,key)=>Symbol.for(String(key))}),
    '../platform/ui-motion.ts':{useUiEntrance:()=>null},'../BrandMark':{default:Symbol('BrandMark')},'../avatar/preview':{avatarPreview:'synthetic-preview.png'},
    '../api':{getConnection:()=>({url:'https://fixture.invalid',token}),getSessionEpoch:()=>epoch,getLoginPersistenceError:()=>persistenceError,isSessionChanged:error=>error?.name==='SessionChangedError',retrySavedLogin:()=>{const pending=deferred();restorations.push(pending);return pending.promise.then(value=>{token=value?.token||'';persistenceError='';return{url:'https://fixture.invalid',token};});},api:(_route,options)=>{
      let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});requests.push({signal:options.signal,resolve,reject});return promise;
    },...apiBridge},
  };
  const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,window,document,AbortController,setTimeout,clearTimeout,Error,Date:class extends Date{static now(){return now;}},require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  const render=()=>{index=0;dirty=false;effects.length=0;tree=module.exports.default({children,onVerified});for(const effect of effects)effect();};
  const flush=async()=>{for(let count=0;count<30;count++){await Promise.resolve();if(dirty&&mounted)render();}};
  render();return{children,requests,restorations,flush,render,text:()=>text(tree),find:(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props)),connection:()=>({token,epoch}),time(ms){now+=ms;},event(name){(name==='visibilitychange'?document:window).dispatchEvent(new Event(name));},hidden(value){document.hidden=value;document.dispatchEvent(new Event('visibilitychange'));},online(value){window.navigator.onLine=value;window.dispatchEvent(new Event(value?'online':'offline'));},replace(next=''){token=next;epoch++;},get tree(){return tree;},get lateUpdates(){return lateUpdates;},close(){mounted=false;for(const hook of hooks)hook?.cleanup?.();}};
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

const connectionDialog=tree=>nodes(tree).find(node=>node.type?.name==='ConnectionDialog');
const click=(f,label)=>{const button=f.find('button',props=>text(props.children)===label);assert.ok(button,label);button.props.onClick();};
const identity={instanceId:'fixture-instance',user:{id:'fixture-user'}};

test('a saved login failure shows reconnect only and switching accounts is an explicit reversible action',async t=>{
  const f=gateFixture();t.after(()=>f.close());f.requests[0].reject(new TypeError('fixture offline'));await f.flush();
  assert.match(f.text(),/登录已保存/);assert.ok(f.find('div',props=>props.className==='login-retry'&&props.role==='alert'));assert.equal(connectionDialog(f.tree),undefined);assert.equal(f.find('form'),undefined);assert.equal(f.connection().token,'synthetic-session');
  click(f,'切换账号或服务器');await f.flush();const dialog=connectionDialog(f.tree);assert.ok(dialog);assert.equal(typeof dialog.props.close,'function');assert.equal(f.connection().token,'synthetic-session');dialog.props.close();await f.flush();assert.equal(connectionDialog(f.tree),undefined);assert.equal(f.connection().token,'synthetic-session');
});

test('native foreground notification alone reconnects when WebView emits no DOM lifecycle events',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=gateFixture();t.after(()=>f.close());f.requests[0].reject(new Error('offline request finished before return'));await f.flush();
  f.event('petpal:native-resume');t.mock.timers.tick(249);await f.flush();assert.equal(f.requests.length,1);t.mock.timers.tick(1);await f.flush();assert.equal(f.requests.length,2);
  f.requests[1].resolve(identity);await f.flush();assert.equal(f.tree,f.children);f.event('petpal:native-resume');t.mock.timers.tick(60000);await f.flush();assert.equal(f.requests.length,2,'a verified workspace must not issue redundant validation');
});

for(const recoveryEvent of ['focus','petpal:native-resume'])test(`${recoveryEvent} received during pending offline validation survives its late failure`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=gateFixture();t.after(()=>f.close());if(recoveryEvent==='focus'){f.online(false);f.online(true);}f.event(recoveryEvent);f.event(recoveryEvent);
  assert.equal(f.requests.length,1);f.requests[0].reject(new Error('late offline 503'));await f.flush();t.mock.timers.tick(250);await f.flush();assert.equal(f.requests.length,2,'the one recovery event must not disappear while the old request is pending');
  f.requests[1].resolve(identity);await f.flush();assert.equal(f.tree,f.children);
});

for(const recoveryEvent of ['focus','petpal:native-resume'])test(`${recoveryEvent} within reconnect cooldown retains one trailing retry and does not become a polling loop`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=gateFixture();t.after(()=>f.close());f.requests[0].reject(new Error('initial offline'));await f.flush();f.event(recoveryEvent);t.mock.timers.tick(250);await f.flush();assert.equal(f.requests.length,2);
  f.requests[1].reject(new Error('still offline'));await f.flush();f.time(1000);if(recoveryEvent==='focus'){f.hidden(true);f.hidden(false);}f.event(recoveryEvent);f.event(recoveryEvent);t.mock.timers.tick(3999);await f.flush();assert.equal(f.requests.length,2);t.mock.timers.tick(1);await f.flush();assert.equal(f.requests.length,3,'the returning foreground event gets one retry after the remaining cooldown');
  f.requests[2].reject(new Error('temporary retry failure'));await f.flush();t.mock.timers.tick(60000);await f.flush();assert.equal(f.requests.length,3,'failure without another recovery event must stop');
});

for(const reason of ['hidden','offline','switching','account-change','unmounted'])test(`native foreground notifications respect ${reason} and cannot revive a queued old login`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const environmentWindow=new EventTarget(),removed=[];const remove=environmentWindow.removeEventListener.bind(environmentWindow);environmentWindow.removeEventListener=(name,...args)=>{removed.push(name);remove(name,...args);};
  const f=gateFixture({environmentWindow});t.after(()=>f.close());f.requests[0].reject(new Error('fixture offline'));await f.flush();f.event('petpal:native-resume');
  if(reason==='hidden')f.hidden(true);else if(reason==='offline')f.online(false);else if(reason==='switching'){click(f,'切换账号或服务器');await f.flush();}else if(reason==='account-change')f.replace('synthetic-new-account');else f.close();
  f.event('petpal:native-resume');t.mock.timers.tick(60000);await f.flush();assert.equal(f.requests.length,1);assert.notEqual(f.tree,f.children);assert.equal(f.lateUpdates,0);
  if(reason==='unmounted')assert.ok(removed.includes('petpal:native-resume'),'the native listener must be detached with the component');
  if(reason==='switching'){connectionDialog(f.tree).props.close();await f.flush();t.mock.timers.tick(60000);await f.flush();assert.equal(f.requests.length,1);f.event('petpal:native-resume');t.mock.timers.tick(250);await f.flush();assert.equal(f.requests.length,2);}
});

test('an in-flight validation timeout honors one remembered resume and fences the timed-out response',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=gateFixture();t.after(()=>f.close());f.event('focus');t.mock.timers.tick(15000);await f.flush();assert.equal(f.requests[0].signal.aborted,true);t.mock.timers.tick(250);await f.flush();assert.equal(f.requests.length,2);
  f.requests[0].resolve(identity);await f.flush();assert.notEqual(f.tree,f.children);f.requests[1].reject(new Error('one retry failed'));await f.flush();t.mock.timers.tick(60000);await f.flush();assert.equal(f.requests.length,2);
});

test('successful validation discards pending recovery events instead of validating twice',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=gateFixture();t.after(()=>f.close());for(const name of ['focus','online','visibilitychange'])f.event(name);f.requests[0].resolve(identity);await f.flush();t.mock.timers.tick(60000);await f.flush();assert.equal(f.requests.length,1);assert.equal(f.tree,f.children);
});

for(const reason of ['hidden','offline','account-change'])test(`${reason} cancels a remembered event before a late validation failure`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=gateFixture();t.after(()=>f.close());f.event('focus');if(reason==='hidden')f.hidden(true);else if(reason==='offline')f.online(false);else f.replace('synthetic-new-account');
  f.requests[0].reject(new Error('late failure'));await f.flush();t.mock.timers.tick(60000);await f.flush();assert.equal(f.requests.length,1);assert.notEqual(f.tree,f.children);
  if(reason!=='account-change'){if(reason==='hidden')f.hidden(false);else f.online(true);t.mock.timers.tick(250);await f.flush();assert.equal(f.requests.length,2);}
});

test('foreground and network recovery events coalesce, remain single flight and never create passive polling',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=gateFixture();t.after(()=>f.close());f.requests[0].reject(new Error('fixture unavailable'));await f.flush();
  for(const name of ['online','focus','visibilitychange','focus'])f.event(name);t.mock.timers.tick(249);await f.flush();assert.equal(f.requests.length,1);t.mock.timers.tick(1);await f.flush();assert.equal(f.requests.length,2);
  for(const name of ['focus','online','visibilitychange'])f.event(name);t.mock.timers.tick(1000);await f.flush();assert.equal(f.requests.length,2);
  f.requests[1].reject(new Error('still unavailable'));await f.flush();f.event('focus');t.mock.timers.tick(5000);await f.flush();assert.equal(f.requests.length,3,'coalesced events authorize one trailing retry after cooldown');
  f.requests[2].reject(new Error('trailing attempt unavailable'));await f.flush();t.mock.timers.tick(10000);await f.flush();assert.equal(f.requests.length,3,'a failed trailing retry without a new event never polls');
  f.time(5001);f.event('focus');t.mock.timers.tick(250);await f.flush();assert.equal(f.requests.length,4);f.requests[3].resolve(identity);await f.flush();assert.equal(f.tree,f.children);
});

test('startup and automatic retries wait for both visibility and connectivity',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=gateFixture({online:false,hidden:true});t.after(()=>f.close());await f.flush();assert.equal(f.requests.length,0);assert.ok(f.find('div',props=>props.role==='alert'));
  f.event('focus');f.online(true);t.mock.timers.tick(1000);await f.flush();assert.equal(f.requests.length,0);
  f.hidden(false);t.mock.timers.tick(200);f.hidden(true);t.mock.timers.tick(1000);await f.flush();assert.equal(f.requests.length,0,'a pending resume is cancelled when hidden');
  f.hidden(false);t.mock.timers.tick(250);await f.flush();assert.equal(f.requests.length,1);f.requests[0].resolve(identity);await f.flush();assert.equal(f.tree,f.children);
});

test('opening account settings suppresses automatic reconnect until the user returns',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=gateFixture();t.after(()=>f.close());f.requests[0].reject(new Error('fixture offline'));await f.flush();
  f.event('focus');click(f,'切换账号或服务器');await f.flush();t.mock.timers.tick(250);f.event('online');t.mock.timers.tick(1000);await f.flush();assert.equal(f.requests.length,1);
  connectionDialog(f.tree).props.close();await f.flush();click(f,'重试连接');await f.flush();assert.equal(f.requests.length,2);assert.equal(f.connection().token,'synthetic-session');
});

test('opening and immediately closing account settings cancels an earlier queued resume intent',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=gateFixture();t.after(()=>f.close());f.requests[0].reject(new Error('fixture offline'));await f.flush();f.event('focus');click(f,'切换账号或服务器');await f.flush();connectionDialog(f.tree).props.close();await f.flush();t.mock.timers.tick(60000);await f.flush();assert.equal(f.requests.length,1);
});

test('a vault read warning offers explicit non-destructive recovery and still validates restored credentials',async t=>{
  let verified=0;const f=gateFixture({token:'',persistenceError:'无法恢复设备保存的登录，请重试；原私有文件已保留。',onVerified:()=>{verified++;}});t.after(()=>f.close());
  assert.equal(f.requests.length,0);assert.equal(f.restorations.length,0);assert.equal(connectionDialog(f.tree),undefined);assert.equal(f.find('button',props=>text(props.children)==='清除设备保存的登录'),undefined);
  click(f,'重试保存的登录');await f.flush();assert.equal(f.restorations.length,1);assert.equal(f.requests.length,0);f.restorations[0].reject(new Error('fixture vault temporarily locked'));await f.flush();assert.equal(f.requests.length,0);assert.match(f.text(),/恢复设备保存的登录/);
  click(f,'重试保存的登录');await f.flush();f.restorations[1].resolve({token:'synthetic-restored'});await f.flush();assert.equal(f.requests.length,1);assert.equal(verified,0);assert.notEqual(f.tree,f.children);f.requests[0].resolve(identity);await f.flush();assert.equal(verified,1);assert.equal(f.tree,f.children);
});

test('an empty successful vault read returns to normal login without claiming authenticated access',async t=>{
  const f=gateFixture({token:'',persistenceError:'无法恢复设备保存的登录，请重试。'});t.after(()=>f.close());click(f,'重试保存的登录');await f.flush();f.restorations[0].resolve({token:''});await f.flush();assert.ok(connectionDialog(f.tree));assert.equal(f.requests.length,0);assert.notEqual(f.tree,f.children);
});

test('late verification or vault reads after an account replacement cannot warm or reveal private content',async t=>{
  for(const source of ['verification','vault'])await t.test(source,async t=>{
    let verified=0;const f=gateFixture({token:source==='vault'?'':'synthetic-session',persistenceError:source==='vault'?'无法恢复设备保存的登录，请重试。':'',onVerified:()=>{verified++;}});t.after(()=>f.close());
    if(source==='vault'){click(f,'重试保存的登录');await f.flush();}f.replace('synthetic-new-account');if(source==='vault')f.restorations[0].resolve({token:'synthetic-old-account'});else f.requests[0].resolve(identity);await f.flush();assert.equal(verified,0);assert.notEqual(f.tree,f.children);assert.equal(f.requests.length,source==='vault'?0:1);
  });
});

test('unmount cancels scheduled reconnects and fences a native restore that resolves later',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=gateFixture();f.requests[0].reject(new Error('fixture offline'));await f.flush();f.event('focus');f.close();t.mock.timers.tick(20000);await f.flush();assert.equal(f.requests.length,1);assert.equal(f.lateUpdates,0);
  const vault=gateFixture({token:'',persistenceError:'无法恢复设备保存的登录，请重试。'});click(vault,'重试保存的登录');await vault.flush();vault.close();vault.restorations[0].resolve({token:'synthetic-restored'});await vault.flush();assert.equal(vault.requests.length,0);assert.equal(vault.lateUpdates,0);
});

test('Android renews a long-lived verified foreground session daily and keeps its workspace on transient failures',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let warmed=0;const f=gateFixture({onVerified:()=>{warmed++;}});t.after(()=>f.close());f.requests[0].resolve(identity);await f.flush();assert.equal(f.tree,f.children);
  f.event('focus');t.mock.timers.tick(1000);await f.flush();assert.equal(f.requests.length,1);
  f.time(24*60*60*1000);for(const name of ['focus','online','visibilitychange'])f.event(name);t.mock.timers.tick(250);await f.flush();assert.equal(f.requests.length,2);assert.equal(f.tree,f.children);f.requests[1].reject(new Error('temporary network failure'));await f.flush();assert.equal(f.tree,f.children);assert.equal(warmed,1);
  f.time(5001);f.event('focus');t.mock.timers.tick(250);await f.flush();assert.equal(f.requests.length,3);f.requests[2].resolve(identity);await f.flush();assert.equal(f.tree,f.children);assert.equal(warmed,1);
  f.event('focus');t.mock.timers.tick(24*60*60*1000);await f.flush();assert.equal(f.requests.length,3,'there is no scheduled daily background poll');
});

test('ordinary Web does not inherit native device renewal requests',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=gateFixture({native:false});t.after(()=>f.close());f.requests[0].resolve(identity);await f.flush();f.time(2*24*60*60*1000);f.event('focus');t.mock.timers.tick(1000);await f.flush();assert.equal(f.requests.length,1);assert.equal(f.tree,f.children);
});

test('read-failure login forms never offer destructive clearing and pending dialogs cannot be dismissed mid-authentication',async t=>{
  const read=fixture('无法恢复设备保存的登录，请重试。');t.after(()=>read.close());assert.equal(read.find('button',props=>text(props.children)==='清除设备保存的登录'),undefined);
  let closed=0;const f=fixture('',{onClose:()=>{closed++;}});t.after(()=>f.close());const wait=f.waitLogin();f.find('form').props.onSubmit({preventDefault(){}});await f.flush();const close=f.find('button',props=>props['aria-label']==='关闭连接窗口');assert.equal(close.props.disabled,true);close.props.onClick();assert.equal(closed,0);
  wait.reject(new Error('synthetic login unavailable'));await f.flush();assert.equal(f.find('button',props=>props['aria-label']==='关闭连接窗口').props.disabled,false);f.find('button',props=>props['aria-label']==='关闭连接窗口').props.onClick();assert.equal(closed,1);
});

test('dialog authentication and owner connection callbacks cannot update a closed or replaced account view',async t=>{
  for(const lifecycle of ['unmount','replace'])await t.test(lifecycle,async()=>{
    const f=fixture(),wait=f.waitLogin();f.find('form').props.onSubmit({preventDefault(){}});await f.flush();if(lifecycle==='unmount')f.close();else f.replaceSession();wait.reject(new Error('late synthetic login failure'));await f.flush();assert.equal(f.lateUpdates,0);f.close();
    const ownerWait=deferred(),owner=fixture('',{ownerConnection:()=>ownerWait.promise});owner.find('button',props=>text(props.children)==='以本机管理员身份登录').props.onClick();await owner.flush();if(lifecycle==='unmount')owner.close();else owner.replaceSession();ownerWait.resolve({url:'http://127.0.0.1:4318',token:'synthetic-owner'});await owner.flush();assert.equal(owner.pairings.length,0);assert.equal(owner.lateUpdates,0);owner.close();
  });
});

// Integrate the real API deadlines with real component event handlers. Only
// browser transport and the native vault are substituted; no service is used.
const moduleUrl=value=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(value,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const nativeUrl=moduleUrl(await readFile(new URL('../src/auth/native-fetch.ts',import.meta.url),'utf8'));
let apiSource=(await readFile(new URL('../src/api.ts',import.meta.url),'utf8')).replaceAll("'./auth/native-fetch'",JSON.stringify(nativeUrl)),apiRevision=0;
for(const name of ['connection-targets','request-scope'])apiSource=apiSource.replaceAll(`'./auth/${name}.mjs'`,JSON.stringify(new URL(`../src/auth/${name}.mjs`,import.meta.url).href));
for(const name of ['speech-stream','speech-emotion'])apiSource=apiSource.replaceAll(`'./avatar/${name}.mjs'`,JSON.stringify(new URL(`../src/avatar/${name}.mjs`,import.meta.url).href));
async function realApiFixture(t){
  const names=['window','location','history','sessionStorage','fetch'],original=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)])),disk=new Map(),window=new EventTarget();let saved={url:'https://fixture.invalid',token:'synthetic-original',credentialKind:'session',target:'remote'};
  const install=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  window.speechSynthesis={cancel(){}};window.petpalLoginSession={read:async()=>({connection:saved}),write:async value=>{saved=structuredClone(value);},clear:async()=>{saved=null;}};
  install('window',window);install('location',{origin:'https://localhost',hash:'',pathname:'/',search:''});install('history',{replaceState(){}});install('sessionStorage',{getItem:name=>disk.get(name)??null,setItem:(name,value)=>disk.set(name,value),removeItem:name=>disk.delete(name)});
  t.after(()=>{for(const[name,value]of original)if(value)Object.defineProperty(globalThis,name,value);else delete globalThis[name];});
  return{api:await import(moduleUrl(apiSource+`\n// component integration ${++apiRevision}`)),window,install,saved:()=>saved,commit:value=>{saved=structuredClone(value);}};
}
const json=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});

test('the real login network timeout releases the dialog without clearing the saved account',async t=>{
  const h=await realApiFixture(t);await h.api.initConnection();t.mock.timers.enable({apis:['setTimeout']});const wait=deferred();let signal;
  h.install('fetch',async(_url,options)=>{signal=options.signal;return wait.promise;});const f=fixture('',{apiBridge:h.api,environmentWindow:h.window,onClose(){}});t.after(()=>f.close());
  f.find('form').props.onSubmit({preventDefault(){}});await f.flush();assert.equal(f.find('fieldset').props.disabled,true);assert.match(f.text(),/正在登录/);assert.equal(f.find('section').props['aria-busy'],true);
  t.mock.timers.tick(15000);await f.flush();assert.match(f.text(),/连接登录服务超时/);assert.equal(f.find('fieldset').props.disabled,false);assert.equal(f.find('button',props=>props['aria-label']==='关闭连接窗口').props.disabled,false);assert.equal(h.api.getConnection().token,'synthetic-original');assert.equal(h.saved().token,'synthetic-original');assert.equal(signal.aborted,true);
  wait.resolve(json({token:'synthetic-late-network'}));await f.flush();assert.equal(h.api.getConnection().token,'synthetic-original');
});

test('the real vault timeout restores recovery and switch controls and a later attempt still requires authentication',async t=>{
  const h=await realApiFixture(t);h.window.petpalLoginSession.read=async()=>{throw new Error('synthetic initial lock');};await h.api.initConnection('https://fixture.invalid');t.mock.timers.enable({apis:['setTimeout']});const wait=deferred();h.window.petpalLoginSession.read=()=>wait.promise;
  const f=gateFixture({apiBridge:h.api,environmentWindow:h.window});t.after(()=>f.close());click(f,'重试保存的登录');await f.flush();assert.match(f.text(),/正在恢复账号连接/);t.mock.timers.tick(15000);await f.flush();
  assert.ok(f.find('button',props=>text(props.children)==='重试保存的登录'));assert.ok(f.find('button',props=>text(props.children)==='切换账号或服务器'));assert.equal(h.api.getConnection().token,'');assert.equal(h.saved().token,'synthetic-original');
  wait.resolve({connection:{url:'https://fixture.invalid',token:'synthetic-stale-read',credentialKind:'session',target:'remote'}});await f.flush();assert.equal(h.api.getConnection().token,'');
  h.window.petpalLoginSession.read=async()=>({connection:h.saved()});click(f,'重试保存的登录');await f.flush();assert.equal(h.api.getIdentity(),null);assert.equal(h.api.getConnection().token,'synthetic-original');f.close();
  h.install('fetch',async()=>json(identity));let verified=0;const resumed=gateFixture({apiBridge:h.api,environmentWindow:h.window,onVerified:()=>{verified++;}});t.after(()=>resumed.close());await resumed.flush();assert.equal(verified,1);assert.equal(resumed.tree,resumed.children);
});

test('a native write already committed to disk cannot be timed out by the login dialog',async t=>{
  const h=await realApiFixture(t);await h.api.initConnection();t.mock.timers.enable({apis:['setTimeout']});const callback=deferred();h.window.petpalLoginSession.write=async value=>{h.commit(value);await callback.promise;};h.install('fetch',async()=>json({token:'synthetic-committed'}));
  const f=fixture('',{apiBridge:h.api,environmentWindow:h.window,onClose(){}});t.after(()=>f.close());f.find('form').props.onSubmit({preventDefault(){}});await f.flush();assert.equal(h.saved().token,'synthetic-committed');assert.equal(h.api.getConnection().token,'synthetic-original');
  t.mock.timers.tick(60000);await f.flush();assert.equal(f.find('fieldset').props.disabled,true);assert.equal(f.find('div',props=>props.role==='alert'),undefined);assert.equal(f.find('button',props=>props['aria-label']==='关闭连接窗口').props.disabled,true);
  callback.resolve();await f.flush();assert.equal(h.api.getConnection().token,h.saved().token);assert.equal(h.api.getConnection().token,'synthetic-committed');
});
