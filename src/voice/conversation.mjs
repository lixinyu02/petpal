import { createVoiceGate } from './audio.mjs';
import { voiceGateProfile } from './detection-preferences.mjs';
import { createSentenceSplitter, createSpeechQueue } from './speech-flow.mjs';
import { createChatDisplay } from '../chat-display.mjs';
import {defaultWakeSettings, normalizeWakeSettings, matchWakePhrase} from '../../server/voice-wake.mjs';

export function cleanTranscript(text) {
  return String(text).replace(/^\s*Speaker\s+\d+\s*[:：]\s*/gmi,'').trim()
    .replace(/^(?:\[Silence\]\s*)+|(?:\s*\[Silence\])+$/gi,'').trim();
}

const empty=()=>({phase:'idle',active:false,transcript:'',reply:'',level:0,error:'',conversationId:'',hasUtterance:false,wake:defaultWakeSettings(),awaitingWake:false});
const cancelled=()=>Object.assign(new Error('语音对话已取消。'),{name:'AbortError'});
function plainReportPieces(text){
  const pieces=[];
  while(text.length){let end=Math.min(180,text.length);if(/^[\uDC00-\uDFFF]$/u.test(text[end]||''))end--;
    const boundary=[...text.slice(0,end).matchAll(/[。！？!?；;\n]/gu)].find(match=>match.index>=7);if(boundary)end=boundary.index+1;
    const piece=text.slice(0,end).trim();if(piece)pieces.push(piece);text=text.slice(end);
  }
  return pieces;
}

/** Keep the explicitly acquired AEC microphone open; upload only actual utterances. */
export function createVoiceConversation(options) {
  let state=empty(),current=null,disposed=false,lastConversation=null;
  const publish=patch=>{state={...state,...patch};if(!disposed)options.onState({...state});};
  const valid=job=>!disposed&&current===job&&!job.abort.signal.aborted&&options.isCurrent();
  const validUtterance=(job,utterance)=>valid(job)&&job.utterance===utterance&&!utterance.abort.signal.aborted;
  const stopCue=()=>{try{options.stopWakeCue?.();}catch{/* Optional feedback cannot break cancellation. */}};
  function release(job){
    if(!job)return;job.display?.close();job.display=null;clearTimeout(job.idleTimer);job.abort.abort(cancelled());job.turn?.abort(cancelled());
    stopCue();try{options.releaseWakeCue?.();}catch{/* Still release microphone and speech. */}
    job.utterance?.abort.abort(cancelled());job.utterance?.session?.cancel();job.capture.stop();options.stopSpeech();
  }
  function stop(){const job=current;job?.display?.flush();current=null;release(job);publish({phase:'idle',active:false,level:0,error:'',hasUtterance:false,awaitingWake:false});}
  function fail(job,error){if(!valid(job))return;job.display?.flush();current=null;release(job);publish({phase:'error',active:false,level:0,hasUtterance:false,awaitingWake:false,error:typeof error?.message==='string'?error.message.slice(0,500):'语音对话未能继续，请重试。'});}
  function arm(job){
    if(!valid(job))return;clearTimeout(job.idleTimer);job.gate.reset();job.monitor.reset();job.utterance=null;job.turn=null;
    publish({phase:'armed',level:0,hasUtterance:false,awaitingWake:true});
  }
  function idleTimeout(job){clearTimeout(job.idleTimer);job.idleTimer=setTimeout(()=>{
    if(!valid(job)||job.utterance||state.phase!=='listening')return;
    if(job.wake.enabled)arm(job);else{stop();publish({error:'一段时间没有听到说话，已停止收音。点击即可重新开始。'});}
  },job.wake.enabled?job.wake.idleTimeoutSeconds*1000:45000);}
  async function listen(job){
    if(!valid(job))return;job.gate.reset();job.monitor.reset();job.utterance=null;job.turn=null;
    publish({phase:'listening',level:0,hasUtterance:false,awaitingWake:false});idleTimeout(job);
    queueMicrotask(()=>{if(valid(job))void reportNext(job);});
  }
  function sendFrames(job,utterance,frames){
    if(!validUtterance(job,utterance))return;
    for(const frame of frames){
      if(utterance.session){void utterance.session.send(frame).catch(error=>{if(validUtterance(job,utterance))fail(job,error);});}
      else{utterance.pendingSamples+=frame.length;if(utterance.pendingSamples>24000*3){fail(job,new Error('识别连接较慢，录音已停止以避免积压，请重试。'));return;}utterance.pending.push(frame);}
    }
  }
  function beginUtterance(job){
    const utterance={abort:new AbortController(),pending:[],pendingSamples:0,session:null,ready:null,finishing:false,wakeCandidate:state.awaitingWake};
    job.utterance=utterance;clearTimeout(job.idleTimer);publish({...(utterance.wakeCandidate?{}:{transcript:'',reply:''}),error:'',hasUtterance:true});
    utterance.ready=options.openAsr(utterance.abort.signal,text=>{if(validUtterance(job,utterance)&&!utterance.wakeCandidate)publish({transcript:cleanTranscript(text)});}).then(session=>{
      if(!validUtterance(job,utterance)){session.cancel();throw cancelled();}
      utterance.session=session;const pending=utterance.pending;utterance.pending=[];utterance.pendingSamples=0;sendFrames(job,utterance,pending);return session;
    });
    void utterance.ready.catch(error=>{if(validUtterance(job,utterance))fail(job,error);});return utterance;
  }
  function feed(job,frame,level){
    if(!valid(job))return;
    if(state.phase==='thinking'||state.phase==='speaking'){
      publish({level:Math.min(1,Math.max(0,level*6))});
      const detected=job.monitor.push(frame,{learnNoise:false,noiseFloor:job.gate.noiseFloor});
      if(detected.started){cancelTurn(job);job.gate.reset();job.monitor.reset();publish({phase:'listening',level:0,hasUtterance:false});
        // Re-feed the bounded onset and pre-roll, preserving the words that
        // caused the interruption instead of asking the user to repeat them.
        for(const captured of detected.samples)feed(job,captured,level);
      }
      return;
    }
    if(state.phase!=='listening'&&state.phase!=='armed')return;publish({level:Math.min(1,Math.max(0,level*6))});
    const detected=job.gate.push(frame);
    if(detected.started)beginUtterance(job);
    if(job.utterance)sendFrames(job,job.utterance,detected.samples);
    if(detected.ended)void finishUtterance();
  }
  function cancelTurn(job){
    job.display?.flush();job.display?.close();job.display=null;
    job.sequence++;clearTimeout(job.idleTimer);job.turn?.abort(cancelled());job.turn=null;
    job.utterance?.abort.abort(cancelled());job.utterance?.session?.cancel();job.utterance=null;stopCue();options.stopSpeech();
    if(job.chatPending&&job.chatStopFor!==job.chatPending){
      job.chatStopFor=job.chatPending;
      // The server stop receipt waits until its active conversation slot is
      // released; a fetch abort alone can settle before upstream cleanup.
      try{job.chatRelease=options.stopChat&&job.conversationId?Promise.resolve(options.stopChat(job.conversationId,job.abort.signal)):job.chatPending.then(()=>{},()=>{});}
      catch(error){job.chatRelease=Promise.reject(error);}
      void job.chatRelease.catch(()=>{});
    }
  }
  async function waitForRelease(job,turn){
    const pending=job.chatRelease;if(!pending)return;
    await new Promise((resolve,reject)=>{
      const abort=()=>finish(turn.signal.reason||cancelled()),timer=setTimeout(()=>finish(new Error('上次回复仍在停止，请重新开始语音聊天。')),10000);
      const finish=error=>{clearTimeout(timer);turn.signal.removeEventListener('abort',abort);error?reject(error):resolve();};
      turn.signal.addEventListener('abort',abort,{once:true});if(turn.signal.aborted)abort();
      pending.then(()=>finish(),finish);
    });
    if(job.chatRelease===pending)job.chatRelease=null;
  }
  async function answer(job,text){
    if(!valid(job))return;
    let chatRequest;
    try{chatRequest=options.getChatRequest?.();}catch(error){if(valid(job))fail(job,error);return;}
    const turn=new AbortController(),sequence=++job.sequence;job.turn=turn;
    const active=()=>valid(job)&&job.sequence===sequence&&!turn.signal.aborted;
    const splitter=createSentenceSplitter(180);let full='',shown='',terminal=false,piece=0;
    const display=createChatDisplay({isCurrent:active,onText:text=>{shown+=text;publish({reply:shown});}});job.display=display;
    const queue=createSpeechQueue({signal:turn.signal,play:async sentence=>{
      if(!active())throw cancelled();display.flush();publish({phase:'speaking'});
      await options.play(sentence,`voice-${job.id}-${sequence}-${++piece}`,turn.signal);
      if(active()){display.flush();publish({phase:'thinking'});}
    },onError:error=>{if(active()){display.flush();turn.abort(error);options.stopSpeech();}}});
    job.monitor.reset();publish({phase:'thinking',reply:'',hasUtterance:false});
    try{
      if(!job.conversationId){
        const id=lastConversation?.providerId===job.providerId?lastConversation.id:await options.createChat(job.providerId,turn.signal);
        if(!active())return;job.conversationId=id;lastConversation={providerId:job.providerId,id};publish({conversationId:id});
      }
      await waitForRelease(job,turn);if(!active())return;
      const pending=Promise.resolve(options.streamChat(job.conversationId,text,turn.signal,event=>{
        if(!active())return;
        if(event.type==='error'){display.flush();throw new Error(event.data.message||'回复未完成，请重试。');}
        if(event.type==='delta'){
          if(typeof event.data.text!=='string'||full.length+event.data.text.length>12000)throw new Error('本次语音回复过长，请到对话页面继续。');
          full+=event.data.text;display.push(event.data.text);for(const sentence of splitter.push(event.data.text))queue.enqueue(sentence);
        }
        if(event.type==='done'){display.flush();terminal=true;}
      },chatRequest));job.chatPending=pending;
      try{await pending;}finally{if(job.chatPending===pending)job.chatPending=null;}
      if(!active())throw turn.signal.reason||cancelled();
      if(!terminal)throw new Error('回复连接提前断开，已停止语音。');
      display.flush();for(const sentence of splitter.finish())queue.enqueue(sentence);
      await queue.finish();if(!active())return;
      await listen(job);
    }catch(error){
      display.flush();
      const reason=turn.signal.aborted?turn.signal.reason||error:error;
      turn.abort(reason);queue.cancel();if(valid(job)&&job.sequence===sequence)options.stopSpeech();
      if(valid(job)&&job.sequence===sequence)fail(job,reason);
    }finally{
      display.close();if(job.display===display)job.display=null;
    }
  }
  async function reportNext(job){
    if(!valid(job)||state.phase!=='listening'||job.utterance||!job.reports.length)return;
    const report=job.reports.shift(),turn=new AbortController(),sequence=++job.sequence;job.turn=turn;
    const active=()=>valid(job)&&job.sequence===sequence&&!turn.signal.aborted;
    clearTimeout(job.idleTimer);job.monitor.reset();publish({phase:'speaking',reply:report.text,hasUtterance:false,level:0});
    const splitter=createSentenceSplitter(180);let piece=0;
    const queue=createSpeechQueue({signal:turn.signal,play:async text=>{
      if(!active())throw cancelled();await options.play(text,`voice-report-${job.id}-${sequence}-${++piece}`,turn.signal);
    }});
    try{const pieces=report.plainText?plainReportPieces(report.text):[...splitter.push(report.text),...splitter.finish()];for(const text of pieces)queue.enqueue(text);await queue.finish();if(active())await listen(job);}
    catch(error){queue.cancel();if(active())fail(job,error);}
  }
  function notifyReport(report){
    const job=current;
    if(!job||!valid(job)||typeof report?.id!=='string'||!report.id||report.id.length>256||typeof report.text!=='string'||!report.text.trim()||report.text.length>1000||job.reportIds.has(report.id)||job.reports.length>=8||job.reports.reduce((sum,item)=>sum+item.text.length,0)+report.text.length>4000)return false;
    job.reportIds.add(report.id);if(job.reportIds.size>128)job.reportIds.delete(job.reportIds.values().next().value);
    job.reports.push({id:report.id,text:report.text.trim(),plainText:report.plainText===true});queueMicrotask(()=>{if(valid(job))void reportNext(job);});return true;
  }
  async function finishUtterance(){
    const job=current,utterance=job?.utterance;if(!job||!utterance||utterance.finishing||!validUtterance(job,utterance))return false;
    utterance.finishing=true;publish({phase:'recognizing',level:0});
    try{
      const session=await utterance.ready;if(!validUtterance(job,utterance))return false;
      const transcript=cleanTranscript(await session.finish());if(!validUtterance(job,utterance))return false;
      job.utterance=null;
      if(utterance.wakeCandidate){
        const match=matchWakePhrase(transcript,job.wake.phrases);
        if(!match){arm(job);return true;}
        publish({transcript:match.text,reply:'',hasUtterance:false,awaitingWake:false});
        // A final match acknowledges once. Never await output or pause the microphone.
        if(valid(job))try{options.wakeCue?.(job.abort.signal);}catch{/* Continue even if local feedback is unavailable. */}
        if(match.text)await answer(job,match.text);else await listen(job);return true;
      }
      publish({transcript,hasUtterance:false});
      if(transcript)await answer(job,transcript);else await listen(job);return true;
    }catch(error){if(validUtterance(job,utterance))fail(job,error);return false;}
  }
  async function start(){
    if(disposed||current)return;
    if(!options.isAllowed()){publish({phase:'error',error:'请先登录并选择可用的聊天模型。'});return;}
    let profile;
    try{profile=voiceGateProfile(options.getSensitivity?.());}catch{publish({phase:'error',error:'未能读取麦克风检测设置，请重新开始。'});return;}
    const job={id:options.id(),providerId:options.getProviderId(),abort:new AbortController(),capture:null,gate:createVoiceGate(profile.listening),monitor:createVoiceGate(profile.interruption),utterance:null,turn:null,idleTimer:null,conversationId:'',sequence:0,chatPending:null,chatRelease:null,chatStopFor:null,reports:[],reportIds:new Set(),wake:defaultWakeSettings()};
    job.capture=options.createCapture({onFrame:(frame,level)=>feed(job,frame,level),onError:error=>fail(job,error)});current=job;
    publish({...empty(),phase:'starting',active:true});
    try{
      // Both calls run before an await, retaining the user's start gesture.
      const unlocked=options.unlock();void Promise.resolve(unlocked).catch(()=>{});
      const capture=job.capture.start(options.getDeviceId());
      const [ready,,config]=await Promise.all([unlocked,capture,options.verify(job.abort.signal)]);
      if(!valid(job)||job.sequence!==0)return;if(!ready)throw new Error('未能解锁声音播放，请再次点击开始语音。');
      job.wake=normalizeWakeSettings(config?.wake);publish({wake:normalizeWakeSettings(job.wake)});
      if(job.wake.enabled)arm(job);else await listen(job);
    }catch(error){if(valid(job)&&job.sequence===0)fail(job,error);}
  }
  async function interrupt(){
    const job=current;if(!job||!valid(job)||state.phase==='starting')return;
    cancelTurn(job);await listen(job);
  }
  return {start,stop,interrupt,finishUtterance,notifyReport,snapshot:()=>({...state}),dispose(){stop();disposed=true;lastConversation=null;}};
}
