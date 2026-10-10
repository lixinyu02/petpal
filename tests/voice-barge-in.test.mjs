import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceConversation } from '../src/voice/conversation.mjs';

const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function harness(overrides={}){
  let callbacks,starts=0,stops=0,unlocks=0,outputStops=0,current=true;
  const sessions=[],streams=[],plays=[],states=[];
  const machine=createVoiceConversation({
    id:()=> 'barge',onState:state=>states.push(state),isCurrent:()=>current,isAllowed:()=>true,getProviderId:()=> 'model',getDeviceId:()=> '',
    createCapture:handlers=>{callbacks=handlers;return{async start(){starts++;},pause(){assert.fail('a live voice conversation must retain its AEC microphone');},stop(){stops++;}};},
    unlock:async()=>{unlocks++;return true;},verify:async()=>{},stopSpeech(){outputStops++;},
    openAsr:async(signal,onTranscript)=>{const final=deferred(),session={signal,onTranscript,frames:[],ends:0,cancelled:0,final,async send(frame){this.frames.push(frame);},finish(){this.ends++;return final.promise;},cancel(){this.cancelled++;}};sessions.push(session);return session;},
    createChat:async()=> 'conversation',
    streamChat:(id,text,signal,onEvent)=>{const pending=deferred();streams.push({id,text,signal,onEvent,...pending});return pending.promise;},
    play:(text,id,signal)=>{const pending=deferred();plays.push({text,id,signal,...pending});return pending.promise;},...overrides,
  });
  return{machine,sessions,streams,plays,states,feed(level=.05){const frame=new Float32Array(6000).fill(level);callbacks.onFrame(frame,level);return frame;},expire(){current=false;},get counts(){return{starts,stops,unlocks,outputStops};}};
}
async function asking(h,text='你好'){
  h.feed();h.feed();await flush();const finishing=h.machine.finishUtterance();h.sessions.at(-1).final.resolve(text);await flush();return{finishing};
}

test('ambient audio and repeated short knocks never open ASR during normal listening',async()=>{
  const h=harness();await h.machine.start();
  for(let i=0;i<30;i++)h.feed(.022);
  for(let i=0;i<8;i++)h.feed(i%2?.03:.018);
  await flush();assert.equal(h.sessions.length,0);assert.equal(h.machine.snapshot().hasUtterance,false);
  h.feed(.075);h.feed(.075);await flush();assert.equal(h.sessions.length,1);assert.equal(h.machine.snapshot().hasUtterance,true);
  h.machine.dispose();
});

test('automatic speech interruption cannot deliver the old presentation timer into the new reply',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness();await h.machine.start();const first=await asking(h);
  h.streams[0].onEvent({type:'delta',data:{text:'旧'}});h.streams[0].onEvent({type:'delta',data:{text:'未展示回复'}});
  assert.equal(h.machine.snapshot().reply,'旧');h.feed(.06);h.feed(.06);await flush();
  assert.equal(h.streams[0].signal.aborted,true);assert.equal(h.sessions.length,2);assert.equal(h.machine.snapshot().reply,'');
  h.streams[0].resolve();await first.finishing;
  const second=h.machine.finishUtterance();h.sessions[1].final.resolve('新的问题');await flush();
  h.streams[1].onEvent({type:'delta',data:{text:'新的回复'}});t.mock.timers.tick(200);
  assert.equal(h.machine.snapshot().reply,'新的回复');h.machine.stop();h.streams[1].resolve();await second;h.machine.dispose();
});

test('sustained speech interrupts Chat and TTS immediately and submits the preserved opening words once',async()=>{
  const released=deferred(),stopCalls=[],h=harness({stopChat:(id,signal)=>{stopCalls.push({id,signal});return released.promise;}});
  await h.machine.start();const first=await asking(h);
  h.streams[0].onEvent({type:'delta',data:{text:'这是正在播放的第一句话。'}});await flush();assert.equal(h.plays.length,1);
  h.feed(0);const onset=h.feed(.055);assert.equal(h.machine.snapshot().phase,'speaking');h.feed(.06);await flush();
  assert.equal(h.streams[0].signal.aborted,true);assert.equal(h.plays[0].signal.aborted,true);assert.equal(h.machine.snapshot().phase,'listening');assert.equal(h.machine.snapshot().hasUtterance,true);
  assert.equal(h.sessions.length,2);assert.deepEqual(h.sessions[1].frames.map(frame=>frame.length),[4800,6000,6000]);assert.deepEqual(h.sessions[1].frames[1],onset);
  assert.equal(h.counts.starts,1);assert.equal(h.counts.unlocks,1);assert.equal(stopCalls.length,1);assert.equal(stopCalls[0].id,'conversation');
  const second=h.machine.finishUtterance();h.sessions[1].final.resolve('换个话题');await flush();assert.equal(h.streams.length,1,'new turn awaits server cancellation receipt');
  released.resolve();await flush();assert.equal(h.streams.length,2);assert.equal(h.streams[1].text,'换个话题');
  const latest=h.machine.snapshot();h.streams[0].onEvent({type:'delta',data:{text:'迟到的旧回复'}});h.plays[0].resolve();h.streams[0].resolve();await first.finishing;assert.deepEqual(h.machine.snapshot(),latest);
  h.streams[1].onEvent({type:'done',data:{}});h.streams[1].resolve();await second;assert.equal(h.machine.snapshot().phase,'listening');h.machine.dispose();assert.equal(h.counts.stops,1);
});

test('thinking also permits interruption while silence, quiet residual echo and isolated noise never open ASR',async()=>{
  const h=harness();await h.machine.start();const first=await asking(h);assert.equal(h.machine.snapshot().phase,'thinking');
  for(let i=0;i<12;i++)h.feed(.02);h.feed(.05);h.feed(0);h.feed(.05);h.feed(.01);await flush();assert.equal(h.sessions.length,1);assert.equal(h.streams[0].signal.aborted,false);
  h.feed(.05);h.feed(.05);await flush();assert.equal(h.sessions.length,2);assert.equal(h.streams[0].signal.aborted,true);
  h.machine.stop();const after=h.machine.snapshot();h.feed(.1);h.sessions[1].onTranscript('迟到的字幕');h.sessions[1].final.resolve('迟到');h.streams[0].resolve();await first.finishing;assert.deepEqual(h.machine.snapshot(),after);
});

test('live microphone levels update during thinking and speech without changing their phase or opening ASR',async()=>{
  const h=harness();await h.machine.start();const first=await asking(h);
  h.feed(.02);assert.equal(h.machine.snapshot().phase,'thinking');assert.equal(h.machine.snapshot().level,.12);
  h.streams[0].onEvent({type:'delta',data:{text:'这是正在播放的一句话。'}});await flush();
  h.feed(.01);assert.equal(h.machine.snapshot().phase,'speaking');assert.equal(h.machine.snapshot().level,.06);
  h.feed(0);assert.equal(h.machine.snapshot().level,0);assert.equal(h.sessions.length,1);assert.equal(h.streams[0].signal.aborted,false);
  h.machine.stop();h.plays[0].resolve();h.streams[0].resolve();await first.finishing;h.machine.dispose();
});

test('a failed server cancellation receipt cannot submit a concurrent conversation turn',async()=>{
  const h=harness({stopChat:async()=>{throw new Error('停止回执未收到');}});await h.machine.start();const first=await asking(h);
  h.feed();h.feed();await flush();const next=h.machine.finishUtterance();h.sessions[1].final.resolve('新问题');await next;
  assert.equal(h.streams.length,1);assert.equal(h.machine.snapshot().phase,'error');assert.match(h.machine.snapshot().error,/停止回执/);
  h.streams[0].resolve();await first.finishing;h.machine.dispose();
});

test('server cancellation wait has a deadline and cannot hang the next utterance indefinitely',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const h=harness({stopChat:()=>new Promise(()=>{})});await h.machine.start();const first=await asking(h);
  h.feed();h.feed();await flush();const next=h.machine.finishUtterance();h.sessions[1].final.resolve('新问题');await flush();
  context.mock.timers.tick(10000);await next;assert.equal(h.machine.snapshot().phase,'error');assert.match(h.machine.snapshot().error,/仍在停止/);assert.equal(h.streams.length,1);
  h.streams[0].resolve();await first.finishing;h.machine.dispose();
});

test('a superseded slow conversation creation cannot replace the conversation used by the new utterance',async()=>{
  const firstChat=deferred(),secondChat=deferred();let creates=0;
  const h=harness({createChat:()=>++creates===1?firstChat.promise:secondChat.promise});await h.machine.start();const first=await asking(h);
  h.feed();h.feed();await flush();const next=h.machine.finishUtterance();h.sessions[1].final.resolve('新的问题');await flush();
  secondChat.resolve('new-conversation');await flush();assert.equal(h.streams[0].id,'new-conversation');
  firstChat.resolve('old-conversation');await first.finishing;assert.equal(h.machine.snapshot().conversationId,'new-conversation');assert.equal(h.streams.length,1);
  h.streams[0].onEvent({type:'done',data:{}});h.streams[0].resolve();await next;h.machine.dispose();
});

test('reports deduplicate and defer through user speech and Chat, then play serially without model calls',async()=>{
  const h=harness();assert.equal(h.machine.notifyReport({id:'idle',text:'完成'}),false);await h.machine.start();h.feed();h.feed();await flush();
  assert.equal(h.machine.notifyReport({id:'progress',text:'后台已经开始处理你的任务。'}),true);assert.equal(h.machine.notifyReport({id:'progress',text:'重复'}),false);
  assert.equal(h.machine.notifyReport({id:'result',text:'后台任务已经完成。'}),true);await flush();assert.equal(h.plays.length,0);
  const finishing=h.machine.finishUtterance();h.sessions[0].final.resolve('再聊聊');await flush();assert.equal(h.streams.length,1);assert.equal(h.plays.length,0);
  h.streams[0].onEvent({type:'done',data:{}});h.streams[0].resolve();await finishing;await flush();assert.equal(h.plays.length,1);assert.match(h.plays[0].text,/开始处理/);
  h.plays[0].resolve();await flush();assert.equal(h.plays.length,2);assert.match(h.plays[1].text,/已经完成/);h.plays[1].resolve();await flush();
  assert.equal(h.machine.snapshot().phase,'listening');assert.equal(h.streams.length,1);assert.equal(h.counts.starts,1);h.machine.dispose();
});

test('a spoken report can be interrupted; late report completion never erases the new utterance',async()=>{
  const h=harness();await h.machine.start();h.machine.notifyReport({id:'one',text:'你的后台任务已经完成，可以继续聊天。'});await flush();assert.equal(h.plays.length,1);
  h.feed();h.feed();await flush();assert.equal(h.plays[0].signal.aborted,true);assert.equal(h.machine.snapshot().hasUtterance,true);assert.equal(h.sessions.length,1);assert.equal(h.streams.length,0);
  h.sessions[0].onTranscript('说说结果');const latest=h.machine.snapshot();h.plays[0].resolve();await flush();assert.deepEqual(h.machine.snapshot(),latest);
  assert.equal(h.machine.notifyReport({id:'one',text:'不会重播'}),false);h.machine.dispose();
});

test('already extracted plain reports preserve literal Markdown and code rather than parsing a second time',async()=>{
  const h=harness();await h.machine.start();const text='字面内容 **保持原样** 和 10**2。';
  assert.equal(h.machine.notifyReport({id:'plain',text,plainText:true}),true);await flush();assert.equal(h.plays[0].text,text);
  h.plays[0].resolve();await flush();h.machine.dispose();
});

test('report backlog and text are bounded, and expired sessions accept or play nothing',async()=>{
  const h=harness();await h.machine.start();h.feed();h.feed();await flush();
  for(let i=0;i<8;i++)assert.equal(h.machine.notifyReport({id:`report-${i}`,text:'状态更新'}),true);
  assert.equal(h.machine.notifyReport({id:'overflow',text:'更新'}),false);assert.equal(h.machine.notifyReport({id:'long',text:'字'.repeat(1001)}),false);
  h.expire();assert.equal(h.machine.notifyReport({id:'expired',text:'更新'}),false);await flush();assert.equal(h.plays.length,0);h.machine.dispose();
});
