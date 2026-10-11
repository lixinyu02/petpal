import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=ts.transpileModule(await readFile(new URL('../src/AccountsSettings.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):!tree||typeof tree!=='object'?[]:[tree,...nodes(tree.props?.children)];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree!=='object'?String(tree):text(tree.props?.children);
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const user=(extra={})=>({id:'alice',username:'alice',displayName:'Alice',role:'user',isAdmin:false,isOwner:false,canUseCodex:true,agentAccess:'full',providerIds:['model-one'],disabled:false,hasPassword:true,...extra});
const admin=user({id:'admin',username:'manager',displayName:'Manager',role:'admin',isAdmin:true});
const root=user({id:'root',username:'owner',role:'admin',isAdmin:true,isOwner:true});

function fixture({identity=admin,users=[root,user()],request}={}){
  let epoch=1,index=0,tree,dirty=false;
  const hooks=[],effects=[],requests=[];
  const same=(left,right)=>left&&right&&left.length===right.length&&left.every((value,i)=>Object.is(value,right[i]));
  const react={
    useState(initial){const at=index++;hooks[at]||={value:initial};return[hooks[at].value,next=>{hooks[at].value=typeof next==='function'?next(hooks[at].value):next;dirty=true;}];},
    useRef(value){const at=index++;hooks[at]||={ref:{current:value}};return hooks[at].ref;},
    useEffect(effect,deps){const at=index++,previous=hooks[at];if(!same(previous?.deps,deps))effects.push(()=>{previous?.cleanup?.();hooks[at]={deps,cleanup:effect()};});},
  };
  const modules={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':new Proxy({},{get:(_target,name)=>Symbol.for(name)}),
    './api':{getSessionEpoch:()=>epoch,isSessionChanged:error=>error?.name==='SessionChangedError',logout(){epoch++;},api:async(path,options={})=>{
      const call={path,method:options.method||'GET',body:options.body?JSON.parse(options.body):undefined,signal:options.signal};requests.push(call);
      const custom=await request?.(call);if(custom!==undefined)return custom;
      if(call.method==='GET')return{users};return{user:user({...call.body})};
    }},
  };
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,AbortController,require:name=>{if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  const props={connected:true,user:identity,providers:[{id:'model-one',name:'Agent model',model:'fixture'}],connect(){}};
  const render=()=>{index=0;dirty=false;effects.length=0;tree=module.exports.default(props);for(const effect of effects)effect();};
  const flush=async()=>{for(let tick=0;tick<12;tick++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}};
  const find=(type,predicate=()=>true)=>nodes(tree).find(node=>node.type===type&&predicate(node.props));
  const button=label=>find('button',props=>props['aria-label']===label||text(props.children)===label);
  render();
  return{requests,flush,find,render,text:()=>text(tree),button,
    click(label){const node=button(label);assert.ok(node,label);node.props.onClick?.();render();},
    type(label,value){const node=nodes(tree).find(node=>['input','select'].includes(node.type)&&node.props['aria-label']===label);assert.ok(node,label);node.props.onChange({target:{value}});render();},
    submit(){return find('form').props.onSubmit({preventDefault(){}});},
    changeIdentity(value){epoch++;props.user=value;},
    close(){for(const hook of hooks)hook?.cleanup?.();},
  };
}

test('a regular administrator manages roles and creates a user without Agent access tiers',async t=>{
  const f=fixture();t.after(f.close);await f.flush();
  assert.equal(f.requests[0].path,'/admin/users');assert.match(f.text(),/@manager · 管理员/);
  f.click('创建账号');assert.equal(f.find('select',props=>props['aria-label']==='账号身份').props.value,'user');
  assert.equal(f.find('select',props=>props['aria-label']==='账号 Agent 权限'),undefined);
  f.type('账号名称','charlie');f.type('显示名称','Charlie');f.type('登录密码','synthetic-password');
  await f.submit();await f.flush();
  const created=f.requests.find(call=>call.method==='POST');
  assert.deepEqual(created.body,{username:'charlie',displayName:'Charlie',password:'synthetic-password',role:'user',providerIds:[],disabled:false});
  assert.equal(Object.hasOwn(created.body,'agentAccess'),false);
});

test('role edits keep model grants and protect the initial owner from downgrading or disabling',async t=>{
  const f=fixture();t.after(f.close);await f.flush();f.click('管理账号 alice');f.type('账号身份','admin');
  assert.equal(f.find('fieldset').props.disabled,true);
  await f.submit();await f.flush();
  const changed=f.requests.find(call=>call.method==='PATCH');
  assert.equal(changed.path,'/admin/users/alice');assert.equal(changed.body.role,'admin');assert.deepEqual(changed.body.providerIds,['model-one']);
  f.click('管理账号 owner');const role=f.find('select',props=>props['aria-label']==='账号身份');assert.equal(role.props.disabled,true);
  role.props.onChange({target:{value:'user'}});f.render();assert.equal(f.find('select',props=>props['aria-label']==='账号身份').props.value,'admin');
  assert.equal(f.find('label',props=>text(props.children).includes('停用此账号')),undefined);
  await f.submit();await f.flush();assert.deepEqual(f.requests.filter(call=>call.method==='PATCH').at(-1).body,{displayName:'Alice'});
});

test('users see their identity and available Agent permissions without requesting other accounts',async t=>{
  const f=fixture({identity:user()});t.after(f.close);await f.flush();
  assert.equal(f.requests.length,0);assert.match(f.text(),/@alice · 用户/);assert.match(f.text(),/自己登录的电脑/);
  assert.equal(f.button('创建账号'),undefined);
});

test('stale account management handlers cannot mutate after a session change, and late lists are discarded',async t=>{
  const pending=deferred(),f=fixture({request:call=>call.method==='GET'?pending.promise:undefined});t.after(f.close);
  f.click('创建账号');f.type('账号名称','charlie');f.type('显示名称','Charlie');f.type('登录密码','synthetic-password');
  const submit=f.find('form').props.onSubmit;f.changeIdentity(user());await submit({preventDefault(){}});
  assert.equal(f.requests.some(call=>call.method==='POST'),false);f.render();pending.resolve({users:[root,user()]});await f.flush();
  assert.equal(f.find('form'),undefined);assert.equal(f.button('管理账号 owner'),undefined);
});

test('rapid duplicate role saves send one mutation before React rerenders',async t=>{
  const pending=deferred(),f=fixture({request:call=>call.method==='POST'?pending.promise:undefined});t.after(f.close);await f.flush();
  f.click('创建账号');f.type('账号名称','charlie');f.type('显示名称','Charlie');f.type('登录密码','synthetic-password');
  const submit=f.find('form').props.onSubmit,one=submit({preventDefault(){}}),two=submit({preventDefault(){}});
  await f.flush();assert.equal(f.requests.filter(call=>call.method==='POST').length,1);
  pending.resolve({user:user()});await Promise.all([one,two]);await f.flush();assert.equal(f.find('form'),undefined);
});
