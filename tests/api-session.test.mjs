import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

let moduleId=0;
const nativeSource=await fs.readFile(new URL('../src/auth/native-fetch.ts',import.meta.url),'utf8');
const nativeCompiled=ts.transpileModule(nativeSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const nativeUrl='data:text/javascript;base64,'+Buffer.from(nativeCompiled).toString('base64');
const source=await fs.readFile(new URL('../src/api.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
  .replaceAll("'./auth/native-fetch'",JSON.stringify(nativeUrl))
  .replaceAll("'./avatar/speech-stream.mjs'",JSON.stringify(new URL('../src/avatar/speech-stream.mjs',import.meta.url).href))
  .replaceAll("'./avatar/speech-emotion.mjs'",JSON.stringify(new URL('../src/avatar/speech-emotion.mjs',import.meta.url).href))
  .replaceAll("'./auth/connection-targets.mjs'",JSON.stringify(new URL('../src/auth/connection-targets.mjs',import.meta.url).href))
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
    await t.test('bootstrap and deferred-history startup accept verified identity with the captured credentials',async()=>{
      delete window.petpal;disk.clear();
      for(const history of [false,true]){
        const api=await freshApi();api.setConnection({url:'https://startup.example',token:'member'},'session');
        const calls=[],state={instanceId:'startup-host',user:{id:'startup-member'},settings:{companionKind:'anime'},conversations:history?[{id:'chat-one'}]:[]};
        install('fetch',async(url,options)=>{calls.push({url,options});return json(state);});
        assert.deepEqual(await api.loadInitialState({history}),state);
        assert.equal(calls.length,1);assert.equal(calls[0].url,`https://startup.example/api${history?'/state?runtime=deferred':'/bootstrap'}`);
        assert.equal(calls[0].options.headers.get('Authorization'),'Bearer member');
        assert.deepEqual(api.getIdentity(),{instanceId:'startup-host',userId:'startup-member'});
      }
      disk.clear();
    });
    await t.test('only missing bootstrap falls back once to the legacy state route',async()=>{
      const api=await freshApi();api.setConnection({url:'https://startup.example',token:'member'});
      const calls=[],state={instanceId:'fallback-host',user:{id:'fallback-member'}};
      install('fetch',async url=>{calls.push(url);return calls.length===1?json({error:'missing'},404):json(state);});
      assert.deepEqual(await api.loadInitialState(),state);
      assert.deepEqual(calls,['https://startup.example/api/bootstrap','https://startup.example/api/state']);
      assert.deepEqual(api.getIdentity(),{instanceId:'fallback-host',userId:'fallback-member'});
      install('fetch',async url=>{calls.push(url);return json({error:'state missing'},404);});
      await assert.rejects(api.loadInitialState({history:true}),error=>error.status===404);
      assert.deepEqual(calls.slice(2),['https://startup.example/api/state?runtime=deferred']);
    });
    await t.test('startup auth, server and network failures do not create a fallback request',async()=>{
      for(const failure of [401,403,503,'network']){
        const api=await freshApi();api.setConnection({url:'https://startup.example',token:'member'});const calls=[];
        const networkError=new TypeError('fixture network unavailable');
        install('fetch',async url=>{calls.push(url);if(failure==='network')throw networkError;return json({error:`fixture ${failure}`},failure);});
        await assert.rejects(api.loadInitialState(),error=>failure==='network'?error===networkError:error.status===failure);
        assert.deepEqual(calls,['https://startup.example/api/bootstrap']);assert.equal(api.getIdentity(),null);
        assert.equal(api.getConnection().token,failure===401?'':'member');
      }
    });
    await t.test('startup deadline cancels the active transport, reports timeout, and can retry',async()=>{
      const api=await freshApi();api.setConnection({url:'https://startup.example',token:'member'});const calls=[];
      install('fetch',async(url,options)=>{calls.push({url,signal:options.signal});return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));});
      await assert.rejects(api.loadInitialState({timeoutMs:15}),/加载个人设置超时/);
      assert.equal(calls.length,1);assert.equal(calls[0].signal.aborted,true);assert.equal(api.getConnection().token,'member');
      install('fetch',async url=>{calls.push({url});return json({instanceId:'retry-host',user:{id:'retry-member'}});});
      await api.loadInitialState();assert.equal(calls.length,2);assert.deepEqual(api.getIdentity(),{instanceId:'retry-host',userId:'retry-member'});
    });
    await t.test('the same startup deadline covers a slow legacy fallback',async()=>{
      const api=await freshApi();api.setConnection({url:'https://startup.example',token:'member'});const calls=[];
      install('fetch',async(url,options)=>{
        calls.push({url,signal:options.signal});if(calls.length===1)return json({error:'missing'},404);
        return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
      });
      await assert.rejects(api.loadInitialState({timeoutMs:15}),/加载个人设置超时/);
      assert.deepEqual(calls.map(item=>item.url),['https://startup.example/api/bootstrap','https://startup.example/api/state']);
      assert.equal(calls[1].signal.aborted,true);assert.equal(api.getIdentity(),null);
    });
    await t.test('parent cancellation propagates its reason and pre-cancelled startup never fetches',async()=>{
      const api=await freshApi();api.setConnection({url:'https://startup.example',token:'member'});const calls=[],entered=deferred();
      install('fetch',async(url,options)=>{calls.push({url,signal:options.signal});entered.resolve();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));});
      const parent=new AbortController(),reason=new Error('fixture page unmounted'),pending=api.loadInitialState({signal:parent.signal});
      await entered.promise;parent.abort(reason);await assert.rejects(pending,error=>error===reason);
      assert.equal(calls.length,1);assert.equal(calls[0].signal.aborted,true);
      const preCancelled=new AbortController();preCancelled.abort(reason);
      await assert.rejects(api.loadInitialState({signal:preCancelled.signal}),error=>error===reason);assert.equal(calls.length,1);
    });
    await t.test('late startup JSON from an old account cannot adopt identity or connect its executor',async()=>{
      disk.clear();const connections=[];window.petpal={executor:{connect:async input=>{connections.push(input);return{state:'online'};},disconnect:async()=>{}}};
      const api=await freshApi();api.setConnection({url:'https://startup.example',token:'old'},'session');
      const body=deferred(),entered=deferred();let signal;
      install('fetch',async(_url,options)=>{signal=options.signal;entered.resolve();return{ok:true,status:200,json:()=>body.promise};});
      const pending=api.loadInitialState();await entered.promise;await Promise.resolve();api.setConnection({url:'https://startup.example',token:'new'},'session');
      body.resolve({instanceId:'old-host',user:{id:'old-user',canUseCodex:true}});
      await assert.rejects(pending,api.SessionChangedError);assert.equal(signal.aborted,true);assert.equal(api.getIdentity(),null);assert.deepEqual(connections,[]);
      install('fetch',async()=>json({instanceId:'new-host',user:{id:'new-user',canUseCodex:true}}));
      await api.loadInitialState();assert.deepEqual(api.getIdentity(),{instanceId:'new-host',userId:'new-user'});assert.equal(connections.length,1);assert.equal(connections[0].userId,'new-user');
      delete window.petpal;disk.clear();
    });
    await t.test('notification lifecycle distinguishes initial restoration from real logout, identity and 401 changes',async()=>{
      disk.clear();delete window.petpal;
      const reasons=[],listener=event=>reasons.push(event.detail?.reason);window.addEventListener('petpal:session-change',listener);
      try{
        const api=await freshApi();await api.initConnection('https://pet.example');assert.deepEqual(reasons,['restore']);
        api.setConnection({url:'https://pet.example',token:'member'});assert.equal(reasons.at(-1),'change');
        install('fetch',async()=>json({instanceId:'host-one',user:{id:'user-one'}}));await api.api('/auth/me');assert.equal(reasons.at(-1),'change');
        install('fetch',async()=>json({instanceId:'host-one',user:{id:'user-two'}}));await api.api('/auth/me');assert.equal(reasons.at(-1),'identity');
        install('fetch',async()=>json({error:'expired'},401));await assert.rejects(api.api('/state'),/expired/);assert.equal(reasons.at(-1),'change');
        api.logout();assert.equal(reasons.at(-1),'change');
        disk.set('petpal.connection',JSON.stringify({url:'https://pet.example',token:'restored',credentialKind:'session',target:'remote'}));
        const restored=await freshApi();await restored.initConnection();assert.equal(reasons.at(-1),'restore');
      }finally{window.removeEventListener('petpal:session-change',listener);disk.clear();}
    });
    await t.test('cold-start authentication preserves pending native taps until verified account reconciliation',async()=>{
      disk.clear();delete window.petpal;const reasons=[],listener=event=>reasons.push(event.detail?.reason);window.addEventListener('petpal:session-change',listener);
      try{
        const api=await freshApi();await api.initConnection('https://pet.example');
        install('fetch',async()=>json({token:'new-session',user:{id:'user-one'}}));await api.login('https://pet.example','member','password123');assert.equal(reasons.at(-1),'authenticate');
        install('fetch',async()=>json({instanceId:'host-one',user:{id:'user-one'}}));await api.api('/auth/me');assert.equal(reasons.at(-1),'authenticate');
        install('fetch',async()=>json({token:'other-session',user:{id:'user-two'}}));await api.login('https://pet.example','other','password123');assert.equal(reasons.at(-1),'change','a known-account switch invalidates immediately');
        api.logout();
        await api.login('https://different.example','other','password123');assert.equal(reasons.at(-1),'change','changing servers invalidates even without known identity');
      }finally{window.removeEventListener('petpal:session-change',listener);disk.clear();}
    });
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
    await t.test('new desktop may default to the central service without transferring the local owner credential',async()=>{
      disk.clear();window.petpal={connection:async()=>({url:'http://127.0.0.1:60002',token:'private-owner'})};
      const api=await freshApi();
      assert.deepEqual(await api.initConnection('https://central.example'),{url:'https://central.example',token:''});
      assert.equal(api.getExecutionTarget(),'remote');disk.clear();
    });
    await t.test('desktop hosting starts only after verified identity, remains idempotent, and stops on permission loss or logout',async()=>{
      const calls=[];
      window.petpal={executor:{connect:async value=>{calls.push(['connect',value]);return{state:'online'};},disconnect:async()=>{calls.push(['disconnect']);}}};
      const api=await freshApi();api.setConnection({url:'https://central.example',token:'member-token'},'session');
      assert.deepEqual(calls,[['disconnect']]);
      let user={id:'member',canUseCodex:true};
      install('fetch',async()=>json({instanceId:'central-id',user}));
      await api.api('/auth/me');await api.api('/state');
      assert.deepEqual(calls,[['disconnect'],['connect',{url:'https://central.example',token:'member-token',instanceId:'central-id',userId:'member'}]]);
      user={...user,canUseCodex:false};await api.api('/state');
      assert.equal(calls.at(-1)[0],'disconnect');
      user={...user,canUseCodex:true};await api.api('/auth/me');
      assert.equal(calls.at(-1)[0],'connect');api.logout();
      assert.equal(calls.at(-1)[0],'disconnect');assert.equal(api.getConnection().token,'');
      delete window.petpal;disk.clear();
    });
    await t.test('failed executor connect releases its scope and later identity retries once while pending',async()=>{
      disk.clear();let calls=0;const online=deferred();
      window.petpal={executor:{connect:async()=>{if(++calls===1)throw new Error('offline');return online.promise;},disconnect:async()=>{}}};
      const api=await freshApi();api.setConnection({url:'https://central.example',token:'member-token'},'session');
      install('fetch',async()=>json({instanceId:'central-id',user:{id:'member',canUseCodex:true}}));
      await api.api('/auth/me');await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
      await Promise.all([api.api('/state'),api.api('/auth/me')]);assert.equal(calls,2);
      online.resolve({state:'online'});await new Promise(resolve=>setImmediate(resolve));
      await api.api('/state');assert.equal(calls,2);api.logout();delete window.petpal;disk.clear();
    });
    await t.test('late failed executor attempt cannot clear a newer account scope or reconnect after logout',async()=>{
      disk.clear();const calls=[];let rejectOld;
      const old=new Promise((_resolve,reject)=>{rejectOld=reject;});
      window.petpal={executor:{connect:async value=>{calls.push(value.userId);return value.userId==='old-user'?old:{state:'online'};},disconnect:async()=>{}}};
      const api=await freshApi();api.setConnection({url:'https://central.example',token:'old'},'session');
      install('fetch',async(_url,options)=>json({instanceId:'central-id',user:{id:options.headers.get('Authorization')==='Bearer old'?'old-user':'new-user',canUseCodex:true}}));
      await api.api('/auth/me');assert.deepEqual(calls,['old-user']);
      api.setConnection({url:'https://central.example',token:'new'},'session');await api.api('/auth/me');
      rejectOld(new Error('late offline'));await new Promise(resolve=>setImmediate(resolve));
      await api.api('/state');assert.deepEqual(calls,['old-user','new-user']);api.logout();
      await new Promise(resolve=>setImmediate(resolve));assert.equal(api.getConnection().token,'');assert.equal(calls.length,2);
      delete window.petpal;disk.clear();
    });
    await t.test('native retry and terminal permission states are retained without renderer reconnect storms',async()=>{
      for(const state of [{state:'reconnecting',retryable:true},{state:'error',retryable:false}]){
        disk.clear();let calls=0;
        window.petpal={executor:{connect:async()=>{calls++;return state;},disconnect:async()=>{}}};
        const api=await freshApi();api.setConnection({url:'https://central.example',token:'member-token'},'session');
        install('fetch',async()=>json({instanceId:'central-id',user:{id:'member',canUseCodex:true}}));
        await api.api('/auth/me');await new Promise(resolve=>setImmediate(resolve));await api.api('/state');await api.api('/auth/me');
        assert.equal(calls,1);api.logout();
      }
      delete window.petpal;disk.clear();
    });
    await t.test('desktop restore refreshes local port but preserves member login and explicit logout',async()=>{
      window.petpal={connection:async()=>({url:'http://127.0.0.1:60002',token:'fresh-owner'})};
      for(const [kind,savedToken,expectedToken] of [['session','member','member'],['none','',''],['pairing','old-owner','fresh-owner']]){
        disk.set('petpal.connection',JSON.stringify({url:'http://127.0.0.1:60001',token:savedToken,credentialKind:kind,target:'local'}));
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
    await t.test('desktop target switching never transfers remote credentials into local owner access',async()=>{
      disk.clear();window.petpal={connection:async()=>({url:'http://127.0.0.1:60002',token:'local-owner'})};
      disk.set('petpal.connection',JSON.stringify({url:'https://remote.example',token:'remote-member',credentialKind:'session',target:'remote'}));
      const api=await freshApi();await api.initConnection();
      assert.equal(api.getExecutionTarget(),'remote');
      assert.deepEqual(api.getConnection(),{url:'https://remote.example',token:'remote-member'});
      await api.switchExecutionTarget('local');
      assert.deepEqual(api.getConnection(),{url:'http://127.0.0.1:60002',token:''});
      api.setConnection({url:'http://127.0.0.1:60002',token:'local-member'},'session');
      await api.switchExecutionTarget('remote');
      assert.deepEqual(api.getConnection(),{url:'https://remote.example',token:'remote-member'});
      await api.switchExecutionTarget('local');
      assert.deepEqual(api.getConnection(),{url:'http://127.0.0.1:60002',token:'local-member'});
      delete window.petpal;disk.clear();
    });
    await t.test('a default server never becomes the destination of a URL pairing token',async()=>{
      disk.set('petpal.connection',JSON.stringify({url:'https://personal.example',token:'later',credentialKind:'session'}));
      location.hash='#token=later';
      try{
        const api=await freshApi();
        assert.deepEqual(await api.initConnection('https://mobile.example'),{url:'',token:'later'});
      }finally{location.hash='';disk.clear();}
    });
    await t.test('a late native target lookup cannot resurrect credentials after logout or a newer selection',async()=>{
      for(const interrupt of ['logout','remote']){
        disk.clear();const lookup=deferred();
        window.petpal={connection:()=>lookup.promise};
        const api=await freshApi();api.setConnection({url:'https://remote.example',token:'member'},'session','remote');
        const pending=api.switchExecutionTarget('local');
        if(interrupt==='logout')api.logout();else await api.switchExecutionTarget('remote');
        lookup.resolve({url:'http://127.0.0.1:60002',token:'owner'});
        await assert.rejects(pending,api.SessionChangedError);
        assert.equal(api.getExecutionTarget(),'remote');
        assert.deepEqual(api.getConnection(),{url:'https://remote.example',token:interrupt==='logout'?'':'member'});
      }
      delete window.petpal;disk.clear();
    });
  }finally{for(const[key,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
