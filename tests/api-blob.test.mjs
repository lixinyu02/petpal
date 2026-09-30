import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

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
let moduleId=0;
const freshApi=()=>import(`data:text/javascript;base64,${Buffer.from(compiled+`\n// binary test ${++moduleId}`).toString('base64')}`);
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};

test('authenticated audio API fences credentials and binary data across account changes',async t=>{
  const keys=['window','location','sessionStorage','fetch'];
  const originals=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const install=(key,value)=>Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const window=new EventTarget();window.speechSynthesis={cancel(){}};
  install('window',window);install('location',{origin:'https://pet.example'});
  install('sessionStorage',{setItem(){},getItem(){return null;}});
  try{
    await t.test('returns audio bytes with the current token and preserves raw WAV uploads',async()=>{
      const api=await freshApi();api.setConnection({url:'https://pet.example',token:'current'});
      const wav=new Blob(['RIFF-audio'],{type:'audio/wav'});let sent;
      install('fetch',async(url,options)=>{sent={url,options};return new Response(wav,{headers:{'Content-Type':'audio/wav'}});});
      const result=await api.apiBlob('/voice/synthesize',{method:'POST',body:JSON.stringify({text:'你好'})});
      assert.equal(sent.url,'https://pet.example/api/voice/synthesize');
      assert.equal(sent.options.headers.get('Authorization'),'Bearer current');
      assert.equal(sent.options.headers.get('Content-Type'),'application/json');
      assert.equal(result.type,'audio/wav');assert.equal(await result.text(),'RIFF-audio');
      install('fetch',async(url,options)=>{sent={url,options};return new Response('{"hasReference":true}',{headers:{'Content-Type':'application/json'}});});
      await api.api('/voice/cosyvoice/reference',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav});
      assert.equal(sent.options.headers.get('Content-Type'),'audio/wav');assert.equal(sent.options.body,wav);
      assert.equal(sent.options.headers.has('Content-Disposition'),false);
    });
    await t.test('late Blob completion cannot be returned after switching accounts',async()=>{
      const api=await freshApi();api.setConnection({url:'',token:'old'});
      const reading=deferred(),late=deferred();let signal;
      install('fetch',async(_url,options)=>{signal=options.signal;return{ok:true,blob:()=>{reading.resolve();return late.promise;}};});
      const pending=api.apiBlob('/voice/synthesize',{method:'POST',body:'{"text":"private"}'});
      await reading.promise;api.setConnection({url:'',token:'new'});late.resolve(new Blob(['old account audio']));
      await assert.rejects(pending,api.SessionChangedError);assert.equal(signal.aborted,true);assert.equal(api.getConnection().token,'new');
    });
    await t.test('late unauthorized errors cannot log out the replacement account',async()=>{
      const api=await freshApi();api.setConnection({url:'',token:'old'});
      const reading=deferred(),late=deferred();
      install('fetch',async()=>({ok:false,status:401,json:()=>{reading.resolve();return late.promise;}}));
      const pending=api.apiBlob('/voice/synthesize',{method:'POST'});await reading.promise;
      api.setConnection({url:'',token:'new'});late.resolve({error:'expired'});
      await assert.rejects(pending,api.SessionChangedError);assert.equal(api.getConnection().token,'new');
    });
    await t.test('stopping synthesis aborts transport and rejects an ignored-abort Blob',async()=>{
      const api=await freshApi();api.setConnection({url:'',token:'current'});
      const reading=deferred(),late=deferred(),controller=new AbortController();let signal;
      install('fetch',async(_url,options)=>{signal=options.signal;return{ok:true,blob:()=>{reading.resolve();return late.promise;}};});
      const pending=api.apiBlob('/voice/synthesize',{method:'POST',signal:controller.signal});await reading.promise;
      controller.abort();late.resolve(new Blob(['cancelled']));
      await assert.rejects(pending,{name:'AbortError'});assert.equal(signal.aborted,true);
    });
    await t.test('a synthesis failure remains a server error rather than playable audio',async()=>{
      const api=await freshApi();api.setConnection({url:'',token:'current'});
      install('fetch',async()=>new Response('{"error":"请先配置参考声音"}',{status:409,headers:{'Content-Type':'application/json'}}));
      await assert.rejects(api.apiBlob('/voice/synthesize',{method:'POST'}),/参考声音/);
    });
    await t.test('audio and its finite speaking intention return together without credential overrides',async()=>{
      const api=await freshApi();api.setConnection({url:'https://pet.example',token:'current'});let sent;
      install('fetch',async(url,options)=>{sent={url,options};return new Response('WAV',{headers:{'content-type':'audio/wav','x-petpal-speech-emotion':'happy','x-petpal-speech-intensity':'strong','x-petpal-speech-source':'choice'}});});
      const result=await api.apiSpeechAudio('你好',new AbortController().signal);
      assert.equal(sent.options.headers.Authorization,'Bearer current');assert.deepEqual(JSON.parse(sent.options.body),{text:'你好'});
      assert.deepEqual(result.emotion,{emotion:'happy',intensity:'strong',source:'choice'});assert.equal(await result.blob.text(),'WAV');
      install('fetch',async()=>new Response('old WAV'));assert.equal((await api.apiSpeechAudio('你好',new AbortController().signal)).emotion,null);
      let cancelled=false;
      install('fetch',async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'x-petpal-speech-emotion':'happy'}}));
      await assert.rejects(api.apiSpeechAudio('你好',new AbortController().signal));assert.equal(cancelled,true);
    });
    await t.test('a late WAV with emotion cannot enter a replacement account or outlive cancellation',async()=>{
      for(const action of ['account','stop']){
        const api=await freshApi();api.setConnection({url:'',token:'old'});
        const reading=deferred(),late=deferred(),controller=new AbortController();let signal;
        install('fetch',async(_url,options)=>{signal=options.signal;return{ok:true,headers:new Headers({'x-petpal-speech-emotion':'sad','x-petpal-speech-intensity':'natural','x-petpal-speech-source':'rules'}),blob:()=>{reading.resolve();return late.promise;}};});
        const pending=api.apiSpeechAudio('你好',controller.signal);await reading.promise;
        if(action==='account')api.setConnection({url:'',token:'new'});else controller.abort();
        late.resolve(new Blob(['old account audio']));await assert.rejects(pending,action==='account'?api.SessionChangedError:{name:'AbortError'});assert.equal(signal.aborted,true);
      }
    });
    await t.test('stream holds the old credential scope while consumer is waiting and drops late audio on account switch',async()=>{
      const api=await freshApi();api.setConnection({url:'https://pet.example',token:'old'});
      const consuming=deferred(),release=deferred();let sent,output=0,cancelled=false;
      const frames=[{type:'format',format:'pcm_s16le',sampleRate:24000,channels:1},{type:'audio',data:'AQI='},{type:'audio',data:'AwQ='},{type:'end',bytes:4}];
      install('fetch',async(url,options)=>{
        sent={url,options};return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(frames.map(value=>JSON.stringify(value)+'\n').join('')));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/x-ndjson'}});
      });
      const pending=api.apiSpeechStream('你好',new AbortController().signal,{onFormat(){},async onAudio(){output++;consuming.resolve();await release.promise;}});
      const rejected=assert.rejects(pending,api.SessionChangedError);
      await consuming.promise;
      assert.equal(sent.url,'https://pet.example/api/voice/synthesize/stream');
      assert.equal(sent.options.headers.Authorization,'Bearer old');assert.equal(sent.options.signal.aborted,false);
      assert.equal(sent.options.headers.Accept,'application/x-petpal-speech-v2+ndjson');
      api.setConnection({url:'https://pet.example',token:'new'});release.resolve();await rejected;
      assert.equal(sent.options.signal.aborted,true);assert.equal(output,1);assert.equal(cancelled,true);assert.equal(api.getConnection().token,'new');
    });
    await t.test('stream unauthorized response expires only the current account',async()=>{
      const api=await freshApi();api.setConnection({url:'',token:'expired'});
      install('fetch',async()=>new Response('{"error":"请登录"}',{status:401,headers:{'content-type':'application/json'}}));
      await assert.rejects(api.apiSpeechStream('你好',new AbortController().signal,{onFormat(){},onAudio(){}}),/请登录/);
      assert.equal(api.getConnection().token,'');
    });
  }finally{for(const[key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
