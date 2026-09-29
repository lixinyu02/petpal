import { createVoiceGate } from './audio.mjs';
import { createSentenceSplitter, createSpeechQueue } from './speech-flow.mjs';

export function cleanTranscript(text) {
  return String(text).replace(/^\s*Speaker\s+\d+\s*[:：]\s*/gmi,'').trim();
}

const empty=()=>({phase:'idle',active:false,transcript:'',reply:'',level:0,error:'',conversationId:'',hasUtterance:false});
const cancelled=()=>Object.assign(new Error('语音对话已取消。'),{name:'AbortError'});

/** Half duplex: no microphone track remains open during recognition or playback. */
export function createVoiceConversation(options) {
  let state=empty(),current=null,disposed=false,lastConversation=null;
  const publish=patch=>{state={...state,...patch};if(!disposed)options.onState({...state});};
  const valid=job=>!disposed&&current===job&&!job.abort.signal.aborted&&options.isCurrent();
  const validUtterance=(job,utterance)=>valid(job)&&job.utterance===utterance&&!utterance.abort.signal.aborted;
  function release(job){
    if(!job)return;clearTimeout(job.idleTimer);job.abort.abort(cancelled());job.turn?.abort(cancelled());
    job.utterance?.abort.abort(cancelled());job.utterance?.session?.cancel();job.capture.stop();options.stopSpeech();
  }
  function stop(){const job=current;current=null;release(job);publish({phase:'idle',active:false,level:0,error:'',hasUtterance:false});}
  function fail(job,error){if(!valid(job))return;current=null;release(job);publish({phase:'error',active:false,level:0,hasUtterance:false,error:typeof error?.message==='string'?error.message.slice(0,500):'语音对话未能继续，请重试。'});}
  function idleTimeout(job){clearTimeout(job.idleTimer);job.idleTimer=setTimeout(()=>{if(valid(job)&&!job.utterance){stop();publish({error:'一段时间没有听到说话，已停止收音。点击即可重新开始。'});}},45000);}
  async function listen(job){
    if(!valid(job))return;const revision=++job.listenRevision;job.gate.reset();job.utterance=null;job.turn=null;publish({phase:'starting',level:0,hasUtterance:false});
    try{await job.capture.start(options.getDeviceId());if(valid(job)&&job.listenRevision===revision){publish({phase:'listening'});idleTimeout(job);}}
    catch(error){if(valid(job)&&job.listenRevision===revision)fail(job,error);}
  }
  function sendFrames(job,utterance,frames){
    if(!validUtterance(job,utterance))return;
    for(const frame of frames){
      if(utterance.session){void utterance.session.send(frame).catch(error=>{if(validUtterance(job,utterance))fail(job,error);});}
      else{utterance.pendingSamples+=frame.length;if(utterance.pendingSamples>24000*3){fail(job,new Error('识别连接较慢，录音已停止以避免积压，请重试。'));return;}utterance.pending.push(frame);}
    }
  }
  function beginUtterance(job){
    const utterance={abort:new AbortController(),pending:[],pendingSamples:0,session:null,ready:null,finishing:false};
    job.utterance=utterance;clearTimeout(job.idleTimer);publish({transcript:'',reply:'',error:'',hasUtterance:true});
    utterance.ready=options.openAsr(utterance.abort.signal,text=>{if(validUtterance(job,utterance))publish({transcript:cleanTranscript(text)});}).then(session=>{
      if(!validUtterance(job,utterance)){session.cancel();throw cancelled();}
      utterance.session=session;const pending=utterance.pending;utterance.pending=[];utterance.pendingSamples=0;sendFrames(job,utterance,pending);return session;
    });
    void utterance.ready.catch(error=>{if(validUtterance(job,utterance))fail(job,error);});return utterance;
  }
  function feed(job,frame,level){
    if(!valid(job)||state.phase!=='listening')return;publish({level:Math.min(1,Math.max(0,level*6))});
    const detected=job.gate.push(frame);
    if(detected.started)beginUtterance(job);
    if(job.utterance)sendFrames(job,job.utterance,detected.samples);
    if(detected.ended)void finishUtterance();
  }
  async function answer(job,text){
    if(!valid(job))return;
    const turn=new AbortController(),sequence=++job.sequence;job.turn=turn;
    const active=()=>valid(job)&&job.sequence===sequence&&!turn.signal.aborted;
    const splitter=createSentenceSplitter(180);let full='',terminal=false,piece=0;
    const queue=createSpeechQueue({signal:turn.signal,play:async sentence=>{
      if(!active())throw cancelled();publish({phase:'speaking'});
      await options.play(sentence,`voice-${job.id}-${sequence}-${++piece}`,turn.signal);
      if(active())publish({phase:'thinking'});
    },onError:error=>{if(valid(job)&&job.sequence===sequence&&!turn.signal.aborted){turn.abort(error);options.stopSpeech();}}});
    publish({phase:'thinking',reply:'',hasUtterance:false});
    try{
      if(!job.conversationId){
        job.conversationId=lastConversation?.providerId===job.providerId?lastConversation.id:await options.createChat(job.providerId,turn.signal);
        if(!active())return;lastConversation={providerId:job.providerId,id:job.conversationId};publish({conversationId:job.conversationId});
      }
      await options.streamChat(job.conversationId,text,turn.signal,event=>{
        if(!active())throw cancelled();
        if(event.type==='error')throw new Error(event.data.message||'回复未完成，请重试。');
        if(event.type==='delta'){
          if(typeof event.data.text!=='string'||full.length+event.data.text.length>12000)throw new Error('本次语音回复过长，请到对话页面继续。');
          full+=event.data.text;publish({reply:full});for(const sentence of splitter.push(event.data.text))queue.enqueue(sentence);
        }
        if(event.type==='done')terminal=true;
      });
      if(!active())throw turn.signal.reason||cancelled();
      if(!terminal)throw new Error('回复连接提前断开，已停止语音。');
      for(const sentence of splitter.finish())queue.enqueue(sentence);
      await queue.finish();if(!active())return;
      await listen(job);
    }catch(error){
      const reason=turn.signal.aborted?turn.signal.reason||error:error;
      turn.abort(reason);queue.cancel();if(valid(job)&&job.sequence===sequence)options.stopSpeech();
      if(valid(job)&&job.sequence===sequence)fail(job,reason);
    }
  }
  async function finishUtterance(){
    const job=current,utterance=job?.utterance;if(!job||!utterance||utterance.finishing||!validUtterance(job,utterance))return false;
    utterance.finishing=true;job.capture.pause();publish({phase:'recognizing',level:0});
    try{
      const session=await utterance.ready;if(!validUtterance(job,utterance))return false;
      const transcript=cleanTranscript(await session.finish());if(!validUtterance(job,utterance))return false;
      job.utterance=null;publish({transcript,hasUtterance:false});
      if(transcript)await answer(job,transcript);else await listen(job);return true;
    }catch(error){if(validUtterance(job,utterance))fail(job,error);return false;}
  }
  async function start(){
    if(disposed||current)return;
    if(!options.isAllowed()){publish({phase:'error',error:'请先登录并选择可用的聊天模型。'});return;}
    const job={id:options.id(),providerId:options.getProviderId(),abort:new AbortController(),capture:null,gate:createVoiceGate(),utterance:null,turn:null,idleTimer:null,conversationId:'',sequence:0,listenRevision:0};
    job.capture=options.createCapture({onFrame:(frame,level)=>feed(job,frame,level),onError:error=>fail(job,error)});current=job;
    publish({...empty(),phase:'starting',active:true});
    try{
      // Both calls run before an await, retaining the user's start gesture.
      const unlocked=options.unlock();void Promise.resolve(unlocked).catch(()=>{});
      const capture=job.capture.start(options.getDeviceId());
      const [ready]=await Promise.all([unlocked,capture,options.verify(job.abort.signal)]);
      if(!valid(job)||job.sequence!==0)return;if(!ready)throw new Error('未能解锁声音播放，请再次点击开始语音。');
      publish({phase:'listening'});idleTimeout(job);
    }catch(error){if(valid(job)&&job.sequence===0)fail(job,error);}
  }
  async function interrupt(){
    const job=current;if(!job||!valid(job))return;
    job.sequence++;job.turn?.abort(cancelled());job.utterance?.abort.abort(cancelled());job.utterance?.session?.cancel();job.utterance=null;
    job.capture.pause();options.stopSpeech();publish({phase:'starting',level:0,hasUtterance:false});
    try{if(!await options.unlock())throw new Error('未能恢复语音播放，请重新开始。');if(valid(job))await listen(job);}catch(error){if(valid(job))fail(job,error);}
  }
  return {start,stop,interrupt,finishUtterance,snapshot:()=>({...state}),dispose(){stop();disposed=true;lastConversation=null;}};
}
