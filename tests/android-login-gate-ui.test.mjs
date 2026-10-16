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
