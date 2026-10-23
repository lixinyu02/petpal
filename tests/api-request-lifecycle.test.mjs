import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const nativeUrl=moduleUrl(await readFile(new URL('../src/auth/native-fetch.ts',import.meta.url),'utf8'));
let source=(await readFile(new URL('../src/api.ts',import.meta.url),'utf8')).replaceAll("'./auth/native-fetch'",JSON.stringify(nativeUrl)),revision=0;
for(const name of ['connection-targets','request-scope'])source=source.replaceAll(`'./auth/${name}.mjs'`,JSON.stringify(new URL(`../src/auth/${name}.mjs`,import.meta.url).href));
for(const name of ['speech-stream','speech-emotion'])source=source.replaceAll(`'./avatar/${name}.mjs'`,JSON.stringify(new URL(`../src/avatar/${name}.mjs`,import.meta.url).href));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const owner={instanceId:'fixture-instance',user:{id:'fixture-user'}};
const timeout=error=>error.name==='TimeoutError'&&error.code==='request_timeout';

test('JSON requests reject unreadable success bodies and own optional deadlines',async t=>{
  const names=['window','location','history','sessionStorage','fetch'],originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const install=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  const disk=new Map(),window=new EventTarget();window.speechSynthesis={cancel(){}};
  install('window',window);install('location',{origin:'https://fixture.invalid',hash:'',pathname:'/',search:''});install('history',{replaceState(){}});
  install('sessionStorage',{getItem:name=>disk.get(name)??null,setItem:(name,value)=>disk.set(name,value),removeItem:name=>disk.delete(name)});
  const fresh=async()=>{const api=await import(moduleUrl(source+`\n// lifecycle fixture ${++revision}`));await api.setConnection({url:'https://fixture.invalid',token:'synthetic-session'},'session');return api;};
  try{
    await t.test('malformed JSON and body reset are failures without discarding the saved account',async()=>{
      for(const kind of ['malformed','reset']){
        const api=await fresh(),failure=new TypeError('synthetic body reset');
        install('fetch',async()=>kind==='malformed'?new Response('{"hosts":'):
          new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"hosts":'));controller.error(failure);}})));
        await assert.rejects(api.api('/agent/hosts'),error=>error.code==='invalid_response'&&error.status===200&&/响应不完整/.test(error.message)&&(kind==='malformed'?error.cause instanceof SyntaxError:error.cause===failure));
        assert.equal(api.getConnection().token,'synthetic-session');assert.equal(api.getIdentity(),null);
        install('fetch',async()=>json(owner));await api.api('/auth/me');assert.deepEqual(api.getIdentity(),{instanceId:owner.instanceId,userId:owner.user.id});
      }
    });
    await t.test('non-JSON error bodies preserve HTTP errors and upstream 401 must confirm the account',async()=>{
      for(const status of [404,503,401]){
        const api=await fresh(),calls=[];
        install('fetch',async url=>{calls.push(url);return url.endsWith('/auth/me')?json(owner):new Response('<html>proxy failure</html>',{status});});
        await assert.rejects(api.api('/providers/example/test'),error=>error.status===status&&error.message===`请求失败 (${status})`&&error.code===undefined);
        assert.equal(api.getConnection().token,'synthetic-session');assert.equal(calls.length,status===401?2:1);
      }
    });
    await t.test('a fetch deadline aborts the transport, does not retry a write, and discards a late body',async t=>{
      const api=await fresh(),gate=deferred(),calls=[];let cancelled=0;t.mock.timers.enable({apis:['setTimeout']});
      install('fetch',async(url,options)=>{calls.push({url,options});return gate.promise;});
      const pending=api.api('/settings',{method:'PATCH',body:'{}',timeoutMs:80}),rejected=assert.rejects(pending,timeout);
      t.mock.timers.tick(79);await flush();assert.equal(calls[0].options.signal.aborted,false);
      t.mock.timers.tick(1);await rejected;assert.equal(calls[0].options.signal.aborted,true);assert.equal('timeoutMs' in calls[0].options,false);
      gate.resolve(new Response(new ReadableStream({cancel(){cancelled++;}})));await flush();assert.equal(cancelled,1);
      t.mock.timers.tick(300000);assert.equal(calls.length,1);assert.equal(api.getConnection().token,'synthetic-session');
      install('fetch',async()=>json(owner));await api.api('/auth/me',{timeoutMs:80});assert.deepEqual(api.getIdentity(),{instanceId:owner.instanceId,userId:owner.user.id});
    });
    await t.test('the same deadline covers fetch and a body reader which ignores cancellation',async t=>{
      const api=await fresh(),headers=deferred(),body=deferred();let signal,bodyStarted=false;t.mock.timers.enable({apis:['setTimeout']});
      install('fetch',async(_url,options)=>{signal=options.signal;return headers.promise;});
      const pending=api.api('/auth/me',{timeoutMs:80}),rejected=assert.rejects(pending,timeout);
      t.mock.timers.tick(30);headers.resolve({ok:true,status:200,json:()=>{bodyStarted=true;return body.promise;}});await flush();assert.equal(bodyStarted,true);
      t.mock.timers.tick(49);await flush();assert.equal(signal.aborted,false);
      t.mock.timers.tick(1);await rejected;assert.equal(signal.aborted,true);assert.equal(api.getIdentity(),null);assert.equal(api.getConnection().token,'synthetic-session');
      body.resolve(owner);await flush();assert.equal(api.getIdentity(),null,'a timed-out identity cannot be adopted late');
      install('fetch',async()=>json(owner));await api.api('/auth/me',{timeoutMs:80});assert.deepEqual(api.getIdentity(),{instanceId:owner.instanceId,userId:owner.user.id});
    });
    for(const phase of ['headers','body'])await t.test(`a native remote ${phase} timeout sends one transport cancellation`,async t=>{
      const api=await fresh(),gate=deferred(),calls=[],aborts=[];t.mock.timers.enable({apis:['setTimeout']});
      window.petpal={remoteRequest:async(request,onEvent)=>{calls.push(request);if(phase==='body')onEvent({type:'headers',status:200,headers:{'content-type':'application/json'}});await gate.promise;},remoteAbort:async id=>{aborts.push(id);}};
      try{
        await api.setConnection({url:'https://native-remote.invalid',token:'synthetic-session'},'session');
        const pending=api.api('/agent/hosts',{timeoutMs:80}),rejected=assert.rejects(pending,timeout);await flush();
        t.mock.timers.tick(80);await rejected;assert.equal(calls.length,1);assert.deepEqual(aborts,[calls[0].id]);assert.equal(api.getConnection().token,'synthetic-session');
        gate.resolve();await flush();assert.equal(aborts.length,1);
      }finally{delete window.petpal;gate.resolve();}
    });
    for(const phase of ['fetch','body'])await t.test(`external cancellation releases a stalled ${phase} and retains its exact reason`,async t=>{
      const api=await fresh(),gate=deferred(),parent=new AbortController(),reason=new Error('fixture caller cancelled');let signal,calls=0;t.mock.timers.enable({apis:['setTimeout']});
      install('fetch',async(_url,options)=>{calls++;signal=options.signal;return phase==='fetch'?gate.promise:{ok:true,status:200,json:()=>gate.promise};});
      const pending=api.api('/auth/me',{signal:parent.signal,timeoutMs:80}),rejected=assert.rejects(pending,error=>error===reason);await flush();
      parent.abort(reason);await rejected;assert.equal(signal.aborted,true);assert.equal(signal.reason,reason);t.mock.timers.tick(1000);
      gate.resolve(phase==='fetch'?json(owner):owner);await flush();assert.equal(calls,1);assert.equal(api.getIdentity(),null);assert.equal(api.getConnection().token,'synthetic-session');
      const before=calls;await assert.rejects(api.api('/auth/me',{signal:parent.signal,timeoutMs:80}),error=>error===reason);assert.equal(calls,before);
    });
    for(const phase of ['fetch','body'])await t.test(`account replacement releases a stalled ${phase} and never adopts its late identity`,async t=>{
      const api=await fresh(),gate=deferred();let signal;t.mock.timers.enable({apis:['setTimeout']});
      install('fetch',async(_url,options)=>{signal=options.signal;return phase==='fetch'?gate.promise:{ok:true,status:200,json:()=>gate.promise};});
      const pending=api.api('/auth/me',{timeoutMs:80}),rejected=assert.rejects(pending,api.SessionChangedError);await flush();
      await api.setConnection({url:'https://replacement.invalid',token:'synthetic-replacement'},'session');await rejected;assert.equal(signal.aborted,true);
      gate.resolve(phase==='fetch'?json(owner):owner);await flush();t.mock.timers.tick(1000);
      assert.deepEqual(api.getConnection(),{url:'https://replacement.invalid',token:'synthetic-replacement'});assert.equal(api.getIdentity(),null);
    });
    await t.test('deadlines are opt-in and successful reads release their deadline',async t=>{
      const api=await fresh(),gate=deferred();let signal;t.mock.timers.enable({apis:['setTimeout']});
      install('fetch',async(_url,options)=>{signal=options.signal;return gate.promise;});
      const pending=api.api('/agent/hosts');t.mock.timers.tick(300000);await flush();assert.equal(signal.aborted,false);
      gate.resolve(json({hosts:[]}));assert.deepEqual(await pending,{hosts:[]});
      install('fetch',async(_url,options)=>{signal=options.signal;return json({hosts:[]});});await api.api('/agent/hosts',{timeoutMs:80});
      t.mock.timers.tick(300000);assert.equal(signal.aborted,false,'successful completion clears its deadline');
    });
    await t.test('invalid deadline values never send a request',async()=>{
      const api=await fresh();let calls=0;install('fetch',async()=>{calls++;return json({});});
      for(const timeoutMs of [0,-1,NaN,Infinity,2147483648])await assert.rejects(api.api('/agent/hosts',{timeoutMs}),TypeError);
      assert.equal(calls,0);
    });
  }finally{for(const[name,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
});
