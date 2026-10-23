import {Profiler,useLayoutEffect,useRef,type ProfilerOnRenderCallback} from 'react';
import {createRoot,type Root} from 'react-dom/profiling';
import ChatMessages from '../../../src/ChatMessages';
import {useChatScroll} from '../../../src/useChatScroll';
import type {Message} from '../../../src/api';
import '../../../src/styles.css';
import '../../../src/theme.css';
import '../../../src/ui-motion.css';
import '../../../src/workspace.css';
import '../../../src/workspace-density.css';
import '../../../src/workspace-room.css';
import '../../../src/workspace-smoothness.css';
import '../../../src/workspace-polish.css';
import './fixture.css';

type Motion='full'|'reduced';
type Scroll='follow'|'locked';
type Counters={classRemoves:number;attributeRemoves:number};
type Commit={phase:string;actualDuration:number;baseDuration:number;startTime:number;commitTime:number};
type Report=Record<string,unknown>;
const host=document.querySelector<HTMLDivElement>('#chat-host')!;
const countControl=document.querySelector<HTMLSelectElement>('#message-count')!;
const motionControl=document.querySelector<HTMLSelectElement>('#motion-policy')!;
const scrollControl=document.querySelector<HTMLSelectElement>('#scroll-policy')!;
const startButton=document.querySelector<HTMLButtonElement>('#benchmark-start')!;
const cancelButton=document.querySelector<HTMLButtonElement>('#benchmark-cancel')!;
const status=document.querySelector<HTMLElement>('#benchmark-status')!;
const reportElement=document.querySelector<HTMLElement>('#benchmark-report')!;
const params=new URLSearchParams(location.search);
if(params.get('messages')==='1000')countControl.value='1000';
if(params.get('motion')==='reduced')motionControl.value='reduced';
if(params.get('scroll')==='locked')scrollControl.value='locked';
const noAction=()=>{};
const stableProps={petName:'合成小伴',mode:'chat' as const,working:true,busy:true,sleeping:false,speechId:'',speechPlaying:false,speechPending:false,speechSupported:true,speechFeedback:'合成测试，不播放语音',speechError:'',onRead:noAction,onStop:noAction,onNotice:noAction,onUseInPrompt:noAction};
let active:AbortController|null=null,chatRoot:Root|null=null,build:Record<string,unknown>={};
const sleep=(ms:number,signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return;}
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason);};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},Math.max(0,ms));signal?.addEventListener('abort',abort,{once:true});
});
const frames=async(count=2)=>{for(let i=0;i<count;i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));};
const percentile=(values:number[],fraction:number)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor((values.length-1)*fraction))]:null;
const distribution=(values:number[])=>({count:values.length,min:values.length?Math.min(...values):null,p50:percentile(values,.5),p95:percentile(values,.95),max:values.length?Math.max(...values):null});
function makeHistory(count:number):Message[]{
  return Array.from({length:count},(_,index)=>({id:`synthetic-history-${index}`,role:index%2?'assistant':'user',status:'complete',model:'synthetic-model',content:index%2
    ? `这是第 ${index+1} 条合成回复。**稳定历史**与 [示例链接](https://example.invalid/) 用于真实 Markdown 布局。\n\n- 第一项内容保持不变\n- 第二项内容保持不变`
    : `这是第 ${index+1} 条合成提问：请整理今天的安排。`}));
}
const initialTail='# 合成流式回复\n\n这一段只用于比较当前源码的浏览器渲染开销。';
const chunks=Array.from({length:100},(_,i)=>`\n\n第 ${i+1} 段：**合成进度 ${i+1}**，内容与执行次序保持一致。`);
function History({messages,onCommit,onProfile}:{messages:Message[];onCommit:()=>void;onProfile:ProfilerOnRenderCallback}){
  const scrollRef=useRef<HTMLDivElement>(null);
  const scrolling=useChatScroll({scrollRef,conversationId:'synthetic-performance',active:true,messages,approvalKey:''});
  useLayoutEffect(onCommit,[messages,onCommit]);
  return <div className="app-shell"><main className="main-area"><section className="chat-area">
    <div className="chat-scroll" ref={scrollRef} onScroll={scrolling.onScroll}><div className="chat-scroll-content" ref={scrolling.contentRef}>
      <Profiler id="actual-chat-messages" onRender={onProfile}><ChatMessages conversationId="synthetic-performance" messages={messages} {...stableProps}/></Profiler>
    </div></div><div className="composer-area">合成流式输入 · 固定 50ms 节奏 · 100 次尾部追加 · 无模型请求</div>
  </section></main></div>;
}
/** Count real product calls; the wrappers stay identical for before/after runs. */
function instrumentMotion(){
  const counters:Counters={classRemoves:0,attributeRemoves:0},owners=new WeakMap<DOMTokenList,Element>();
  const classDescriptor=Object.getOwnPropertyDescriptor(Element.prototype,'classList')!;
  const removeToken=DOMTokenList.prototype.remove,removeAttribute=Element.prototype.removeAttribute;
  Object.defineProperty(Element.prototype,'classList',{...classDescriptor,get(){const list=classDescriptor.get!.call(this) as DOMTokenList;if((this as Element).hasAttribute('data-message-id'))owners.set(list,this as Element);return list;}});
  DOMTokenList.prototype.remove=function(...tokens:string[]){const owner=owners.get(this);if(tokens.includes('ui-message-enter')&&owner&&host.contains(owner))counters.classRemoves++;return removeToken.apply(this,tokens);};
  Element.prototype.removeAttribute=function(name:string){if(name==='data-ui-enter'&&this.hasAttribute('data-message-id')&&host.contains(this))counters.attributeRemoves++;return removeAttribute.call(this,name);};
  return{counters,snapshot:()=>({...counters}),stop(){Object.defineProperty(Element.prototype,'classList',classDescriptor);DOMTokenList.prototype.remove=removeToken;Element.prototype.removeAttribute=removeAttribute;}};
}
async function warmModules(){
  chatRoot?.unmount();chatRoot=createRoot(host);let committed=false;
  chatRoot.render(<History messages={makeHistory(2)} onCommit={()=>{committed=true;}} onProfile={noAction}/>);
  const deadline=performance.now()+15000;
  while(!committed||!host.querySelector('.message-markdown strong')||host.querySelector('.message-markdown[aria-busy="true"]')){
    if(performance.now()>deadline)throw new Error('真实 Markdown 模块预热超时。');
    await sleep(20);
  }
  await document.fonts.ready;await frames();chatRoot.unmount();chatRoot=null;await frames();
}
async function publish(report:Report){
  reportElement.textContent=JSON.stringify(report,null,2);
  (window as Window&{__CHAT_BENCH_REPORT__?:Report}).__CHAT_BENCH_REPORT__=report;
  try{const response=await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const saved=await response.json();report.savedReport=saved.filename;reportElement.textContent=JSON.stringify(report,null,2);}
  catch(error){report.saveError=String(error);reportElement.textContent=JSON.stringify(report,null,2);}
}
async function run(){
  if(active)return;const controller=new AbortController();active=controller;startButton.disabled=true;cancelButton.disabled=false;for(const control of [countControl,motionControl,scrollControl])control.disabled=true;
  const count=Number(countControl.value),motion=motionControl.value as Motion,scroll=scrollControl.value as Scroll;
  const invalid:string[]=[],commits:Commit[]=[],frameTimes:number[]=[],longTasks:Record<string,unknown>[]=[],updates:Record<string,number>[]=[],listCommits:number[]=[];
  const initialViewport={width:innerWidth,height:innerHeight,dpr:devicePixelRatio};
  const focusEvents:{time:number;focused:boolean}[]=[];
  const invalidate=(reason:string)=>{if(!invalid.includes(reason))invalid.push(reason);};
  const visibility=()=>{if(document.hidden)invalidate('document-hidden');};
  const pagehide=()=>invalidate('pagehide');const resize=()=>invalidate('viewport-resized');
  const interaction=()=>invalidate('user-interaction-during-sample');
  const focus=()=>focusEvents.push({time:performance.now(),focused:document.hasFocus()});
  const blur=()=>{focus();invalidate('window-lost-focus');};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide);window.addEventListener('resize',resize);window.addEventListener('focus',focus);window.addEventListener('blur',blur);
  let stopMotion:ReturnType<typeof instrumentMotion>|undefined,observer:PerformanceObserver|undefined,frame=0,recordFrames=false;
  let measurementStart=0,mountStart=0,mountEnd=0,streamStart=0,streamEnd=0;
  const record=(time:number)=>{if(recordFrames)frameTimes.push(time);frame=requestAnimationFrame(record);};
  const profile:ProfilerOnRenderCallback=(_id,phase,actualDuration,baseDuration,startTime,commitTime)=>commits.push({phase,actualDuration,baseDuration,startTime,commitTime});
  try{
    if(document.hidden)invalidate('started-hidden');
    document.documentElement.dataset.uiMotion=motion;
    document.documentElement.dataset.theme='day';
    status.textContent='预热真实 Markdown 模块（预热不计入测量）…';await warmModules();controller.signal.throwIfAborted();
    const messages=makeHistory(count);messages[messages.length-1]={...messages.at(-1)!,role:'assistant',content:initialTail,status:'streaming'};
    let next=messages,pendingCommit:(()=>void)|undefined;
    const commit=()=>{listCommits.push(performance.now());const done=pendingCommit;pendingCommit=undefined;done?.();};
    chatRoot=createRoot(host);
    const render=(current:Message[])=>new Promise<void>((resolve,reject)=>{
      let timer:ReturnType<typeof setTimeout>;
      const abort=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);pendingCommit=undefined;reject(controller.signal.reason);};
      pendingCommit=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);resolve();};
      timer=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);pendingCommit=undefined;reject(new Error('React 提交超过 15 秒。'));},15000);
      controller.signal.addEventListener('abort',abort,{once:true});
      chatRoot!.render(<History messages={current} onCommit={commit} onProfile={profile}/>);
    });
    if(PerformanceObserver.supportedEntryTypes.includes('longtask')){observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push({startTime:entry.startTime,duration:entry.duration,name:entry.name});});observer.observe({type:'longtask',buffered:false});}
    stopMotion=instrumentMotion();measurementStart=performance.now();focus();if(!document.hasFocus())invalidate('started-without-focus');recordFrames=true;frame=requestAnimationFrame(record);
    status.textContent=`测量中：${count} 条消息／${motion}／${scroll}，请保持当前页面可见，约 6–10 秒。`;
    host.addEventListener('wheel',interaction,{passive:true});host.addEventListener('touchstart',interaction,{passive:true});host.addEventListener('pointerdown',interaction,{passive:true});
    mountStart=performance.now();await render(next);await frames();mountEnd=performance.now();const mountCounters=stopMotion.snapshot();
    const scrollElement=host.querySelector<HTMLDivElement>('.chat-scroll')!;
    if(scroll==='locked'){scrollElement.scrollTop=Math.max(0,scrollElement.scrollTop-300);scrollElement.dispatchEvent(new Event('scroll'));await frames();}
    const lockedTop=scrollElement.scrollTop;
    const mountCommitCount=listCommits.length,mountProfilerCount=commits.length;streamStart=performance.now();
    for(let index=0;index<100;index++){
      const scheduledAt=streamStart+(index+1)*50;await sleep(scheduledAt-performance.now(),controller.signal);controller.signal.throwIfAborted();
      const dispatchedAt=performance.now();next=[...next.slice(0,-1),{...next.at(-1)!,content:next.at(-1)!.content+chunks[index]}];
      await render(next);updates.push({index:index+1,scheduledAt,dispatchedAt,committedAt:performance.now(),lateness:Math.max(0,dispatchedAt-scheduledAt)});
    }
    await frames();streamEnd=performance.now();const streamCounters=stopMotion.snapshot();
    const displayedTail=host.querySelector('.messages')?.lastElementChild?.querySelector('.message-text');
    const finalExpected=initialTail+chunks.join('');
    const renderedChunks=Array.from(displayedTail?.querySelectorAll('strong')||[],node=>node.textContent);
    const allChunks=renderedChunks.length===100&&renderedChunks.every((value,index)=>value===`合成进度 ${index+1}`);
    if(listCommits.length-mountCommitCount!==100)invalidate('list-commit-count-mismatch');
    if(!allChunks)invalidate('missing-final-content');
    if(commits.length===0)invalidate('react-profiler-unavailable');
    const scrollingCorrect=scroll==='locked'?Math.abs(scrollElement.scrollTop-lockedTop)<2:scrollElement.scrollHeight-scrollElement.scrollTop-scrollElement.clientHeight<=80;
    if(!scrollingCorrect)invalidate('scroll-policy-not-preserved');
    const intervals=frameTimes.slice(1).map((value,index)=>value-frameTimes[index]);
    // A visible but occluded Chrome window may run rAF at roughly 1Hz without
    // reporting document.hidden. Keep this raw trace, but never treat the
    // ambiguous throttled sample as a product frame-rate comparison.
    const suspectedOneHz=intervals.filter(value=>value>=900&&value<=1200).length>=2;
    if(suspectedOneHz)invalidate('suspected-occluded-1hz-throttling');
    if(!document.hasFocus())invalidate('finished-without-focus');
    const report:Report={schemaVersion:1,syntheticOnly:true,valid:invalid.length===0,invalidReasons:invalid,runId:crypto.randomUUID(),createdAt:new Date().toISOString(),build,
      environment:{userAgent:navigator.userAgent,viewport:initialViewport,finalViewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},visibility:document.visibilityState,focused:document.hasFocus(),focusEvents,suspectedOneHzThrottling:suspectedOneHz,systemReducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches,performanceObserverLongTask:!!observer},
      workload:{messages:count,updates:100,cadenceMs:50,motion,scroll,stableRowProps:true,cache:'warm modules and fonts; fresh React root for mount',renderer:'React production profiling build',schedule:'fixed deadlines, serialized commit acknowledgement; lateness recorded',historyShape:'alternating user/assistant, stable GFM paragraphs/list/link; assistant tail appends one new paragraph per update',finalTailCharacters:finalExpected.length},
      timings:{measurementStart,mountStart,mountEnd,mountMs:mountEnd-mountStart,streamStart,streamEnd,streamMs:streamEnd-streamStart,totalMs:streamEnd-mountStart},
      commits:{listMount:mountCommitCount,listStream:listCommits.length-mountCommitCount,listTotal:listCommits.length,profilerMount:mountProfilerCount,profilerTotal:commits.length,actualDuration:distribution(commits.map(item=>item.actualDuration)),samples:commits},
      motionCalls:{mount:mountCounters,stream:{classRemoves:streamCounters.classRemoves-mountCounters.classRemoves,attributeRemoves:streamCounters.attributeRemoves-mountCounters.attributeRemoves},total:streamCounters},
      frames:{count:frameTimes.length,intervalMs:distribution(intervals),intervalsAbove34ms:intervals.filter(value=>value>34).length,intervalsAbove50ms:intervals.filter(value=>value>50).length,timestamps:frameTimes},
      longTasks:{count:longTasks.length,totalDuration:longTasks.reduce((sum,item)=>sum+Number(item.duration),0),samples:longTasks},updates,
      assertions:{all100ChunksPresentInOrder:allChunks,expectedFinalCharacters:finalExpected.length,renderedMessageRows:host.querySelectorAll('.messages>.message').length,scrollingCorrect,lockedTop,finalScrollTop:scrollElement.scrollTop},
      boundaries:['Synthetic browser workload; not a real model, phone, GPU FPS or production SLA.','rAF intervals observe the page main thread and do not prove compositor presentation.','Production profiling renderer and narrow DOM-call instrumentation add identical measurement overhead to before/after.','No attachments, account credentials, model calls or backend.']};
    await publish(report);status.textContent=report.valid?'测量完成 · valid=true · 原始报告已显示并尝试保存。':'本轮无效，请查看 invalidReasons 后重测。';
  }catch(error){invalidate(controller.signal.aborted?'cancelled':'measurement-error');await publish({schemaVersion:1,syntheticOnly:true,valid:false,invalidReasons:invalid,error:String(error),createdAt:new Date().toISOString(),build,workload:{messages:count,motion,scroll},commits:commits.length,listCommits:listCommits.length});status.textContent='测量中断或失败，本轮已标记 invalid。';}
  finally{recordFrames=false;cancelAnimationFrame(frame);observer?.disconnect();stopMotion?.stop();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);window.removeEventListener('resize',resize);window.removeEventListener('focus',focus);window.removeEventListener('blur',blur);host.removeEventListener('wheel',interaction);host.removeEventListener('touchstart',interaction);host.removeEventListener('pointerdown',interaction);if(active===controller)active=null;startButton.disabled=false;cancelButton.disabled=true;for(const control of [countControl,motionControl,scrollControl])control.disabled=false;}
}
cancelButton.addEventListener('click',()=>active?.abort(new Error('用户取消了合成测量。')));
startButton.addEventListener('click',()=>{void run();});
window.addEventListener('pagehide',()=>{active?.abort(new Error('页面已离开。'));chatRoot?.unmount();});
fetch('/build-result.json').then(response=>{if(!response.ok)throw new Error('无法读取冻结构建信息');return response.json();}).then(value=>{build={buildId:value.buildId,gitHead:value.gitHead,sourceDigest:value.sourceDigest,label:value.label,builtAt:value.builtAt};status.textContent='就绪 · 请选择参数后开始；保持此页可见至完成。';startButton.disabled=false;}).catch(error=>{status.textContent=String(error);startButton.disabled=true;});
startButton.disabled=true;
