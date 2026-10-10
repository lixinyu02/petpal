import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceConversation, cleanTranscript } from '../src/voice/conversation.mjs';
import { createSentenceSplitter, createSpeechQueue, createSpeechAwaiter } from '../src/voice/speech-flow.mjs';

const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function harness(options={}){
  const states=[],sessions=[],plays=[],chats=[],streams=[];let callbacks,captureStarts=0,captureStops=0,capturePauses=0,outputStops=0,allowed=true,current=true,unlocks=0;
  const machine=createVoiceConversation({
    id:()=> 'test',onState:state=>states.push(state),isCurrent:()=>current,isAllowed:()=>allowed,getProviderId:()=> 'model',getDeviceId:()=> 'microphone',
    createCapture:handlers=>{callbacks=handlers;return {async start(device){assert.equal(device,'microphone');captureStarts++;},pause(){capturePauses++;},stop(){captureStops++;}};},
    unlock:async()=>{unlocks++;return true;},verify:async()=>{},stopSpeech(){outputStops++;},
    openAsr:async(signal,transcript)=>{const final=deferred(),session={signal,transcript,frames:[],ends:0,cancelled:0,final,async send(frame){this.frames.push(frame);},finish(){this.ends++;return final.promise;},cancel(){this.cancelled++;}};sessions.push(session);return session;},
    createChat:async(provider,signal)=>{chats.push({provider,signal});return 'conversation';},
    streamChat:(id,text,signal,onEvent,request)=>{const pending=deferred();streams.push({id,text,signal,onEvent,request,...pending});return pending.promise;},
    play:(text,id,signal)=>{const pending=deferred();plays.push({text,id,signal,...pending});return pending.promise;},...options,
  });
  return{machine,states,sessions,plays,chats,streams,feed(level=.05){callbacks.onFrame(new Float32Array(6000).fill(level),level);},error(error){callbacks.onError(error);},deny(){allowed=false;},expire(){current=false;},get counts(){return{captureStarts,captureStops,capturePauses,outputStops,unlocks};}};
}

test('one turn cleans speaker labels, streams ordered sentences and retains one AEC microphone acquisition',async()=>{
  const h=harness();await h.machine.start();assert.equal(h.machine.snapshot().phase,'listening');
  h.feed(0);h.feed();h.feed();await flush();assert.deepEqual(h.sessions[0].frames.map(f=>f.length),[4800,6000,6000]);
  h.sessions[0].transcript('Speaker 0: 你好');assert.equal(h.machine.snapshot().transcript,'你好');
  const finishing=h.machine.finishUtterance();await flush();assert.equal(h.machine.snapshot().phase,'recognizing');assert.equal(h.counts.capturePauses,0);
  h.feed();h.feed();assert.equal(h.sessions[0].frames.length,3,'recognition finishing never uploads further microphone frames');
  h.sessions[0].final.resolve('Speaker 0: 你好小伴。');await flush();assert.equal(h.streams[0].text,'你好小伴。');assert.equal(h.chats.length,1);
  h.streams[0].onEvent({type:'delta',data:{text:'今天我们可以一起听音乐。'}});await flush();assert.equal(h.plays.length,1);
  h.streams[0].onEvent({type:'delta',data:{text:'然后慢慢聊一聊今天的趣事。'}});h.streams[0].onEvent({type:'done',data:{}});h.streams[0].resolve();await flush();
  assert.equal(h.machine.snapshot().phase,'speaking');assert.equal(h.counts.captureStarts,1);assert.equal(h.plays.length,1);
  h.plays[0].resolve();await flush();assert.equal(h.plays.length,2);assert.equal(h.counts.captureStarts,1);
  h.plays[1].resolve();assert.equal(await finishing,true);assert.equal(h.machine.snapshot().phase,'listening');assert.equal(h.counts.captureStarts,1);assert.equal(h.counts.unlocks,1);
  h.feed();h.feed();await flush();const second=h.machine.finishUtterance();h.sessions[1].final.resolve('继续');await flush();assert.equal(h.chats.length,1);assert.equal(h.streams[1].id,'conversation');
  h.machine.stop();h.streams[1].resolve();await second;assert.equal(h.counts.captureStops,1);
});

test('voice background settings are captured before slow conversation creation and refreshed for each later sentence',async()=>{
  const creating=deferred();let chosen='first-computer',sequence=0;
  const h=harness({createChat:()=>creating.promise,getChatRequest:()=>({assistant:{enabled:true,hostId:chosen,providerId:'model',permissions:{access:'read-only',approval:'ask'}},submissionId:`request-${++sequence}`})});
  await h.machine.start();h.feed();h.feed();await flush();const first=h.machine.finishUtterance();h.sessions[0].final.resolve('打开播放器');await flush();
  chosen='second-computer';creating.resolve('conversation');await flush();
  assert.equal(h.streams[0].request.assistant.hostId,'first-computer');assert.equal(h.streams[0].request.submissionId,'request-1');
  h.streams[0].onEvent({type:'done',data:{}});h.streams[0].resolve();await first;
  h.feed();h.feed();await flush();const second=h.machine.finishUtterance();h.sessions[1].final.resolve('继续');await flush();
  assert.equal(h.streams[1].request.assistant.hostId,'second-computer');assert.equal(h.streams[1].request.submissionId,'request-2');
  h.streams[1].onEvent({type:'done',data:{}});h.streams[1].resolve();await second;h.machine.dispose();
});

test('invalid background project settings stop voice input before creating or submitting a Chat request',async()=>{
  const h=harness({getChatRequest:()=>{throw new Error('这台电脑尚不支持自定义项目目录，请更新客户端。');}});
  await h.machine.start();h.feed();h.feed();await flush();const finishing=h.machine.finishUtterance();h.sessions[0].final.resolve('在项目里检查文件');await finishing;
  assert.equal(h.machine.snapshot().phase,'error');assert.equal(h.machine.snapshot().active,false);assert.match(h.machine.snapshot().error,/项目目录/);
  assert.equal(h.chats.length,0);assert.equal(h.streams.length,0);assert.equal(h.counts.captureStops,1);h.machine.dispose();
});

test('900ms pause automatically submits once; interrupt aborts old ASR and ignores late transcript',async()=>{
  const h=harness();await h.machine.start();h.feed();h.feed();await flush();for(let i=0;i<4;i++)h.feed(0);await flush();
  assert.equal(h.sessions[0].ends,1);assert.equal(h.machine.snapshot().phase,'recognizing');
  await h.machine.interrupt();assert.equal(h.sessions[0].signal.aborted,true);assert.equal(h.sessions[0].cancelled,1);assert.equal(h.machine.snapshot().phase,'listening');
  h.sessions[0].transcript('late');h.sessions[0].final.resolve('late');await flush();assert.notEqual(h.machine.snapshot().transcript,'late');assert.equal(h.streams.length,0);h.machine.dispose();
});

test('interrupt stops the old LLM and TTS; late completion cannot overwrite a new listening turn',async()=>{
  const h=harness();await h.machine.start();h.feed();h.feed();await flush();const finishing=h.machine.finishUtterance();h.sessions[0].final.resolve('你好');await flush();
  h.streams[0].onEvent({type:'delta',data:{text:'这是一个尚未播放完的长句子。'}});await flush();
  await h.machine.interrupt();assert.equal(h.streams[0].signal.aborted,true);assert.equal(h.plays[0].signal.aborted,true);assert.equal(h.machine.snapshot().phase,'listening');
  const before=h.machine.snapshot();h.plays[0].resolve();h.streams[0].resolve();await finishing;assert.deepEqual(h.machine.snapshot(),before);h.machine.dispose();
});

test('LLM EOF without done and TTS failure end the conversation instead of restarting the microphone',async()=>{
  for(const cause of ['eof','tts']){
    const h=harness();await h.machine.start();h.feed();h.feed();await flush();const finishing=h.machine.finishUtterance();h.sessions[0].final.resolve('你好');await flush();
    if(cause==='tts'){h.streams[0].onEvent({type:'delta',data:{text:'这是一个会播放失败的回答。'}});await flush();h.plays[0].reject(new Error('扬声器已断开'));h.streams[0].onEvent({type:'done',data:{}});}
    h.streams[0].resolve();await finishing;assert.equal(h.machine.snapshot().phase,'error');assert.equal(h.machine.snapshot().active,false);assert.equal(h.counts.captureStarts,1);assert.equal(h.counts.captureStops,1);assert.match(h.machine.snapshot().error,cause==='tts'?/扬声器/:/提前断开/);h.machine.dispose();
  }
});

test('unauthenticated start acquires nothing and stop while ASR is connecting cancels the late session',async()=>{
  const denied=harness();denied.deny();await denied.machine.start();assert.equal(denied.counts.captureStarts,0);assert.equal(denied.counts.unlocks,0);denied.machine.dispose();
  const pending=deferred();let cancelled=0;
  const h=harness({openAsr:()=>pending.promise});await h.machine.start();h.feed();h.feed();h.machine.stop();pending.resolve({cancel(){cancelled++;}});await flush();
  assert.equal(cancelled,1);assert.equal(h.machine.snapshot().active,false);assert.equal(h.counts.captureStops,1);h.machine.dispose();
});

test('long silent listening and continuous speech are bounded at 45 seconds',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const silent=harness();await silent.machine.start();context.mock.timers.tick(44999);assert.equal(silent.machine.snapshot().active,true);context.mock.timers.tick(1);assert.equal(silent.machine.snapshot().active,false);assert.equal(silent.counts.captureStops,1);silent.machine.dispose();
  const voiced=harness();await voiced.machine.start();voiced.feed();voiced.feed();await flush();for(let i=2;i<180;i++)voiced.feed();await flush();assert.equal(voiced.sessions[0].ends,1);assert.equal(voiced.machine.snapshot().phase,'recognizing');voiced.machine.dispose();voiced.sessions[0].final.resolve('');await flush();
});

test('sentence bounds preserve surrogate pairs and speech queue applies ordered backpressure',async()=>{
  const splitter=createSentenceSplitter(20),text='猫'.repeat(19)+'😀'+'好'.repeat(25)+'。';const pieces=[...splitter.push(text.slice(0,21)),...splitter.push(text.slice(21)),...splitter.finish()];
  assert.equal(pieces.join(''),text);for(const piece of pieces){assert.ok(piece.length<=20);assert.equal(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(piece),false);}
  assert.equal(cleanTranscript('Speaker 0: 你好\nSpeaker 1：小伴'),'你好\n小伴');
  const first=deferred(),seen=[],queue=createSpeechQueue({play:async text=>{seen.push(text);if(text==='one')await first.promise;}});
  queue.enqueue('one');queue.enqueue('two');const finish=queue.finish();await flush();assert.deepEqual(seen,['one']);first.resolve();await finish;assert.deepEqual(seen,['one','two']);
  const bounded=createSpeechQueue({maxChars:5,play:()=>new Promise(()=>{})});bounded.enqueue('12345');assert.throws(()=>bounded.enqueue('6'),/上限/);await assert.rejects(bounded.finish(),/上限/);
});

test('speech awaiter rejects stopped/error states and only resolves complete audio for its own utterance',async()=>{
  const waiting=createSpeechAwaiter();let settled=false;
  const result=waiting.begin('one').then(()=>{settled=true;});waiting.observe({utteranceId:'other',ended:true,charIndex:4,text:'done'});await flush();assert.equal(settled,false);
  waiting.observe({utteranceId:'one',ended:true,active:false,pending:false,charIndex:4,text:'done'});await result;
  const failed=waiting.begin('two');waiting.observe({utteranceId:'two',ended:true,active:false,pending:false,charIndex:0,text:'fail'});waiting.observe({utteranceId:'two',ended:true,active:false,pending:false,charIndex:0,text:'fail',error:'stream failed'});await assert.rejects(failed,/stream failed/);
  const abort=new AbortController();let stopped=0;const cancelled=waiting.begin('three',abort.signal,()=>stopped++);abort.abort();await assert.rejects(cancelled,{name:'AbortError'});assert.equal(stopped,1);
});
test('confirmed upstream silence markers at transcript edges never become a Chat request',()=>{
  assert.equal(cleanTranscript('Speaker 0:你好，请介绍一下你自己。[Silence]'),'你好，请介绍一下你自己。');
  assert.equal(cleanTranscript('Speaker 0:[Silence]'),'');
  assert.equal(cleanTranscript('[Silence] [Silence]'),'');
  assert.equal(cleanTranscript('文字中的 [Silence] 示例'),'文字中的 [Silence] 示例');
});

async function beginAnswer(h){
  await h.machine.start();h.feed();h.feed();await flush();
  const finishing=h.machine.finishUtterance();h.sessions[0].final.resolve('你好');await flush();return {finishing};
}

test('voice reply bursts coalesce presentation while first text and done remain immediate',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness(),{finishing}=await beginAnswer(h);
  const send=text=>h.streams[0].onEvent({type:'delta',data:{text}});
  send('首');const before=h.states.length;
  for(let index=0;index<100;index++)send('续');
  assert.equal(h.states.length,before);assert.equal(h.machine.snapshot().reply,'首');
  t.mock.timers.tick(49);assert.equal(h.machine.snapshot().reply,'首');
  t.mock.timers.tick(1);assert.equal(h.machine.snapshot().reply,'首'+'续'.repeat(100));
  send('结尾');h.streams[0].onEvent({type:'done',data:{}});
  assert.equal(h.machine.snapshot().reply,'首'+'续'.repeat(100)+'结尾');
  h.streams[0].resolve();await flush();h.plays[0].resolve();await finishing;h.machine.dispose();
});

for(const cause of ['stop','interrupt','eof','network'])test(`voice ${cause} preserves accepted partial text and cannot publish a late display timer`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness(),{finishing}=await beginAnswer(h);
  h.streams[0].onEvent({type:'delta',data:{text:'首'}});h.streams[0].onEvent({type:'delta',data:{text:'待显示'}});
  assert.equal(h.machine.snapshot().reply,'首');
  if(cause==='interrupt')await h.machine.interrupt();else if(cause==='stop')h.machine.stop();
  if(cause==='network')h.streams[0].reject(new Error('网络中断'));else h.streams[0].resolve();
  await finishing;assert.equal(h.machine.snapshot().reply,'首待显示');
  const before=h.machine.snapshot();t.mock.timers.tick(1000);assert.deepEqual(h.machine.snapshot(),before);h.machine.dispose();
});

test('speech sentence delivery does not wait for the presentation deadline and failed playback flushes pending captions',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness(),{finishing}=await beginAnswer(h);
  h.streams[0].onEvent({type:'delta',data:{text:'开头'}});
  h.streams[0].onEvent({type:'delta',data:{text:'这是马上可以开始朗读的第一句话。'}});await flush();
  assert.equal(h.plays.length,1);assert.equal(h.machine.snapshot().phase,'speaking');
  assert.equal(h.plays[0].text,'开头这是马上可以开始朗读的第一句话。');
  h.streams[0].onEvent({type:'delta',data:{text:'末尾字幕'}});assert.doesNotMatch(h.machine.snapshot().reply,/末尾字幕/);
  h.plays[0].reject(new Error('播放失败'));await flush();h.streams[0].resolve();await finishing;
  assert.equal(h.machine.snapshot().phase,'error');assert.match(h.machine.snapshot().reply,/末尾字幕$/);
  const before=h.machine.snapshot();t.mock.timers.tick(1000);assert.deepEqual(h.machine.snapshot(),before);h.machine.dispose();
});

test('account invalidation discards pending captions without a late display publication',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness(),{finishing}=await beginAnswer(h);
  h.streams[0].onEvent({type:'delta',data:{text:'当前'}});h.streams[0].onEvent({type:'delta',data:{text:'旧账号字幕'}});
  const before=h.machine.snapshot(),count=h.states.length;h.expire();t.mock.timers.tick(200);
  h.streams[0].onEvent({type:'delta',data:{text:'迟到字幕'}});h.streams[0].resolve();await finishing;
  assert.deepEqual(h.machine.snapshot(),before);assert.equal(h.states.length,count);h.machine.dispose();
});
