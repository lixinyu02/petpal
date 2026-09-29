import test from 'node:test';
import assert from 'node:assert/strict';
import { readAsrEvents } from '../src/voice/asr-events.mjs';
import { openAsrTransport } from '../src/voice/asr-session.mjs';

const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const wire=(type,data)=>`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
function harness(overrides={}) {
  const abort=new AbortController(),requests=[],removed=[],transcripts=[];let stream,closes=0,current=true;
  const response=new Response(new ReadableStream({start(controller){stream=controller;}}));
  const session=openAsrTransport({...overrides,signal:abort.signal,assertCurrent(){if(!current)throw new Error('SessionChanged');},onClose(){closes++;},onTranscript:text=>transcripts.push(text),openEvents:async()=>response,remove:async id=>{removed.push(id);},request:async(path,options)=>{requests.push({path,options});if(path.endsWith('/sessions'))return{id:'one',sampleRate:24000};return overrides.request?.(path,options)??{};}});
  return {session,abort,requests,removed,transcripts,get closes(){return closes;},expire(){current=false;},event(type,data){stream.enqueue(new TextEncoder().encode(wire(type,data)));},eof(){stream.close();}};
}

test('split UTF-8/CRLF SSE replaces cumulative text and requires ready plus explicit done',async()=>{
  const text=wire('ready',{}).replaceAll('\n','\r\n')+wire('transcript',{text:'Speaker 0: 你好'})+wire('transcript',{text:'Speaker 0: 你好小伴'})+wire('done',{text:'Speaker 0: 你好小伴。'});
  const bytes=new TextEncoder().encode(text),seen=[];
  const response=new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}}));
  assert.equal(await readAsrEvents(response,{onTranscript:text=>seen.push(text)}),'Speaker 0: 你好小伴。');
  assert.deepEqual(seen,['Speaker 0: 你好','Speaker 0: 你好小伴','Speaker 0: 你好小伴。']);
  for(const bad of [wire('ready',{})+wire('transcript',{text:'partial'}),wire('done',{text:'missing ready'}),wire('ready',{})+wire('error',{error:'busy'})]){
    await assert.rejects(readAsrEvents(new Response(bad)),/提前断开|格式|busy/);
  }
});

test('no session escapes before readiness; uploads are serialized and end waits for all acknowledgements',async()=>{
  const acknowledgements=[];
  const h=harness({request:(path)=>{if(path.includes('/audio')){const item=deferred();acknowledgements.push(item);return item.promise;}return{};}});
  let started=false;void h.session.then(()=>{started=true;});await flush();assert.equal(started,false);
  h.event('ready',{});const session=await h.session;
  const first=session.send(new Float32Array([.25])),second=session.send(new Float32Array([-.5])),end=session.finish();
  await flush();assert.equal(acknowledgements.length,1);assert.equal(h.requests.filter(r=>r.path.endsWith('/end')).length,0);
  assert.equal(new DataView(h.requests[1].options.body).getFloat32(0,true),.25);assert.match(h.requests[1].path,/sequence=0$/);
  acknowledgements[0].resolve({nextSequence:1});await first;await flush();assert.equal(acknowledgements.length,2);assert.match(h.requests[2].path,/sequence=1$/);
  acknowledgements[1].resolve({nextSequence:2});await second;await flush();assert.equal(h.requests.at(-1).path,'/voice/asr/sessions/one/end');
  h.event('transcript',{text:'你好'});h.event('done',{text:'你好小伴。'});assert.equal(await end,'你好小伴。');
  assert.deepEqual(h.transcripts,['你好','你好小伴。']);assert.equal(h.closes,1);assert.deepEqual(h.removed,[]);
});

test('wrong acknowledgement, EOF, epoch change and cancellation cannot send later blocks',async()=>{
  for(const cause of ['ack','eof','epoch','cancel']){
    const h=harness({request:()=>({nextSequence:999})});await flush();h.event('ready',{});const session=await h.session;
    if(cause==='eof')h.eof();if(cause==='epoch')h.expire();if(cause==='cancel')h.abort.abort();await flush();
    await assert.rejects(session.send(new Float32Array([.1])));
    await assert.rejects(session.send(new Float32Array([.1])));await flush();
    assert.equal(h.requests.filter(r=>r.path.includes('/audio')).length,cause==='ack'?1:0);
    assert.deepEqual(h.removed,['one']);assert.equal(h.closes,1);
  }
});

test('bounded pending upload memory cancels a stalled session rather than accumulating audio',async()=>{
  const slow=deferred(),h=harness({request:()=>slow.promise});await flush();h.event('ready',{});const session=await h.session;
  const sends=[];for(let i=0;i<3;i++)sends.push(session.send(new Float32Array(24000)).catch(error=>error));
  await assert.rejects(session.send(new Float32Array(1)),/积压/);slow.resolve({nextSequence:1});await Promise.all(sends);await flush();
  assert.deepEqual(h.removed,['one']);assert.equal(h.closes,1);
});

test('abort before ready releases SSE and late creation still removes its server session',async()=>{
  const h=harness();await flush();h.abort.abort();await assert.rejects(h.session,{name:'AbortError'});await flush();assert.deepEqual(h.removed,['one']);
  const created=deferred(),abort=new AbortController(),removed=[];
  const opening=openAsrTransport({signal:abort.signal,request:()=>created.promise,remove:async id=>removed.push(id)});
  abort.abort();created.resolve({id:'late',sampleRate:24000});await assert.rejects(opening,{name:'AbortError'});await flush();assert.deepEqual(removed,['late']);
});

test('readiness and final-result deadlines cancel upstream sessions and release listeners',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const connecting=harness();await flush();context.mock.timers.tick(15000);await assert.rejects(connecting.session,/连接超时/);await flush();assert.equal(connecting.closes,1);assert.deepEqual(connecting.removed,['one']);
  const final=harness({request:()=>({nextSequence:1})});await flush();final.event('ready',{});const session=await final.session;await session.send(new Float32Array([.1]));
  const finishing=session.finish();await flush();context.mock.timers.tick(60000);await assert.rejects(finishing,/完整识别结果超时/);assert.equal(final.closes,1);assert.deepEqual(final.removed,['one']);
});
