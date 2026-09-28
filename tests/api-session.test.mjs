import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

let moduleId=0;
const source=await fs.readFile(new URL('../src/api.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
  .replaceAll("'./auth/request-scope.mjs'",JSON.stringify(new URL('../src/auth/request-scope.mjs',import.meta.url).href));
const freshApi=()=>import(`data:text/javascript;base64,${Buffer.from(compiled+`\n// module ${++moduleId}`).toString('base64')}`);
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

test('real API wrapper account-switch and native restore behavior',async t=>{
  const original=new Map(['window','location','history','sessionStorage','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const disk=new Map();
  const install=(key,value)=>Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const window=new EventTarget();window.speechSynthesis={cancel(){}};
  install('window',window);install('location',{hash:'',pathname:'/',search:''});install('history',{replaceState(){}});
  install('sessionStorage',{getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value),removeItem:key=>disk.delete(key)});
  try{
    await t.test('late JSON and 401 from old credentials cannot update identity or log out new account',async()=>{
      const api=await freshApi();api.setConnection({url:'https://a.example',token:'old'});
      const release=deferred(),entered=deferred();let sent;
      install('fetch',async(url,options)=>{sent={url,options};entered.resolve();return{ok:false,status:401,json:()=>release.promise};});
      const pending=api.api('/state');await entered.promise;api.setConnection({url:'https://b.example',token:'new'});
      release.resolve({instanceId:'old-host',user:{id:'old-user'},error:'expired'});
      await assert.rejects(pending,api.SessionChangedError);
      assert.equal(sent.options.signal.aborted,true);assert.equal(sent.options.headers.get('Authorization'),'Bearer old');
      assert.deepEqual(api.getConnection(),{url:'https://b.example',token:'new'});assert.equal(api.getIdentity(),null);
    });
    await t.test('late SSE chunks are not delivered after switching',async()=>{
      const api=await freshApi();api.setConnection({url:'',token:'old'});
      let writer;const started=deferred();const events=[];
      install('fetch',async()=>new Response(new ReadableStream({start(controller){writer=controller;started.resolve();}})));
      const pending=api.streamMessage('conversation','hello',new AbortController().signal,event=>events.push(event));
      await started.promise;await Promise.resolve();api.setConnection({url:'',token:'new'});
      writer.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"old private reply"}\n\n'));
      await assert.rejects(pending,api.SessionChangedError);assert.deepEqual(events,[]);
    });
    await t.test('invalid credentials or malformed identity never replace the active account',async()=>{
      const api=await freshApi();api.setConnection({url:'',token:'active'});
      install('fetch',async()=>json({error:'bad credentials'},401));
      await assert.rejects(api.connectWithToken({url:'',token:'wrong'}),/bad credentials/);
      install('fetch',async()=>json({ok:true}));
      await assert.rejects(api.connectWithToken({url:'',token:'malformed'}),/身份/);
      assert.equal(api.getConnection().token,'active');
    });
    await t.test('login uses anonymous credentials and persists session kind; logout clears immediately',async()=>{
      const api=await freshApi();api.setConnection({url:'',token:'owner'});let request;
      install('fetch',async(url,options)=>{request={url,options};return json({token:'member-token',user:{id:'member'}});});
      await api.login('', 'member','password123');
      assert.equal(request.options.headers.Authorization,undefined);
      assert.equal(JSON.parse(disk.get('petpal.connection')).credentialKind,'session');
      assert.equal(api.getConnection().token,'member-token');api.logout();
      assert.equal(api.getConnection().token,'');assert.equal(JSON.parse(disk.get('petpal.connection')).credentialKind,'none');
    });
    await t.test('desktop starts without silently logging in the owner',async()=>{
      disk.clear();window.petpal={connection:async()=>({url:'http://127.0.0.1:60002',token:'fresh-owner'})};
      const api=await freshApi();
      assert.deepEqual(await api.initConnection(),{url:'http://127.0.0.1:60002',token:''});
    });
    await t.test('desktop restore refreshes local port but preserves member login and explicit logout',async()=>{
      window.petpal={connection:async()=>({url:'http://127.0.0.1:60002',token:'fresh-owner'})};
      for(const [kind,savedToken,expectedToken] of [['session','member','member'],['none','',''],['pairing','old-owner','fresh-owner']]){
        disk.set('petpal.connection',JSON.stringify({url:'http://127.0.0.1:60001',token:savedToken,credentialKind:kind}));
        const api=await freshApi();await api.initConnection();
        assert.deepEqual(api.getConnection(),{url:'http://127.0.0.1:60002',token:expectedToken});
        api.setConnection({url:'http://127.0.0.1:60002',token:'later'});
        assert.equal((await api.initConnection()).token,'later');
      }
    });
    await t.test('mobile default selects a server without credentials and keeps explicit connections',async()=>{
      delete window.petpal;disk.clear();
      const api=await freshApi();
      assert.deepEqual(await api.initConnection('https://mobile.example'),{url:'https://mobile.example',token:''});
      api.setConnection({url:'https://personal.example',token:'later'});
      const restored=await freshApi();
      assert.deepEqual(await restored.initConnection('https://mobile.example'),{url:'https://personal.example',token:'later'});
      restored.logout();
      const loggedOut=await freshApi();
      assert.deepEqual(await loggedOut.initConnection('https://mobile.example'),{url:'https://personal.example',token:''});
      disk.clear();
      const web=await freshApi();assert.deepEqual(await web.initConnection(),{url:'',token:''});
    });
    await t.test('a default server never becomes the destination of a URL pairing token',async()=>{
      disk.set('petpal.connection',JSON.stringify({url:'https://personal.example',token:'later',credentialKind:'session'}));
      location.hash='#token=later';
      try{
        const api=await freshApi();
        assert.deepEqual(await api.initConnection('https://mobile.example'),{url:'',token:'later'});
      }finally{location.hash='';disk.clear();}
    });
  }finally{for(const[key,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
