import {useEffect,useId,useRef,useState} from 'react';
import {CircleHelp,Loader2} from 'lucide-react';
import {api,getSessionEpoch,isSessionChanged,type AgentUserInput as InputRequest,type Conversation} from './api';
import './agent-user-input.css';

type Choice={selection?:number|'other';text?:string};
type Draft={signature:string;values:Record<string,Choice>};
type Decision='consumed'|'uncertain';
const signature=(request:InputRequest)=>JSON.stringify([request.id,request.requestedAt,request.expiresAt,request.questions]);
const live=(request:InputRequest,now:number)=>Number.isFinite(Date.parse(request.expiresAt))&&Date.parse(request.expiresAt)>now;
const uncertainMessage='回答送达状态尚未确认，请刷新状态或停止任务；不会自动重发。';

export default function AgentUserInput({conversationId,requests,active,refresh,interactionLock,onBusyChange,disabled=false}:{conversationId:string;requests:InputRequest[];active:boolean;refresh():Promise<Conversation>;interactionLock?:{current:boolean};onBusyChange?(value:boolean):void;disabled?:boolean}){
  const epoch=getSessionEpoch(),scopeRef=useRef({conversationId,epoch}),alive=useRef(true),operationRef=useRef<object|null>(null),prefix=useId();
  if(scopeRef.current.conversationId!==conversationId||scopeRef.current.epoch!==epoch)scopeRef.current={conversationId,epoch};
  const scope=scopeRef.current,current=()=>alive.current&&scopeRef.current===scope&&getSessionEpoch()===scope.epoch;
  const inputRef=useRef({requests,active});inputRef.current={requests,active};
  const [state,setState]=useState<{scope:object;forms:Record<string,Draft>;decisions:Record<string,Decision>;error:string}>({scope,forms:{},decisions:{},error:''});
  const [busyState,setBusy]=useState({scope,value:false}),[now,setNow]=useState(Date.now);
  const local=state.scope===scope?state:{scope,forms:{},decisions:{},error:''},busy=busyState.scope===scope&&busyState.value;
  const formsRef=useRef(local.forms);formsRef.current=local.forms;
  const decisionsRef=useRef(local.decisions);decisionsRef.current=local.decisions;
  const requestKey=requests.map(signature).join('\n');
  const shown=active?requests.filter(request=>live(request,Math.max(now,Date.now()))&&local.decisions[request.id]!=='consumed'):[];
  const update=(change:(before:typeof state)=>typeof state)=>{if(current())setState(before=>change(before.scope===scope?before:{scope,forms:{},decisions:{},error:''}));};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    update(before=>({...before,forms:Object.fromEntries(Object.entries(before.forms).filter(([id,draft])=>active&&requests.some(request=>request.id===id&&signature(request)===draft.signature&&live(request,Date.now())))),...(!active?{decisions:{},error:''}:{})}));
  },[scope,active,requestKey,now]);
  useEffect(()=>{
    if(!active)return;
    const deadlines=requests.map(request=>Date.parse(request.expiresAt)).filter(value=>Number.isFinite(value)&&value>Date.now());
    if(!deadlines.length)return;
    const timer=setTimeout(()=>{if(current())setNow(Date.now());},Math.min(2147483647,Math.max(1,Math.min(...deadlines)-Date.now()+1)));
    return()=>clearTimeout(timer);
  },[scope,active,requestKey,now]);
  function getDraft(request:InputRequest){const value=Object.hasOwn(formsRef.current,request.id)?formsRef.current[request.id]:undefined;return value?.signature===signature(request)?value.values:{};}
  function currentRequest(request:InputRequest){return current()&&inputRef.current.active&&inputRef.current.requests.some(item=>item.id===request.id&&signature(item)===signature(request)&&live(item,Date.now())&&!item.deliveryUncertain);}
  function setChoice(request:InputRequest,questionId:string,choice:Choice){
    if(disabled||operationRef.current||interactionLock?.current||!currentRequest(request)||decisionsRef.current[request.id])return;
    update(before=>({...before,error:'',forms:{...before.forms,[request.id]:{signature:signature(request),values:{...getDraft(request),[questionId]:choice}}}}));
  }
  function answersFor(request:InputRequest){
    const draft=getDraft(request),answers:Record<string,{answers:string[]}>=Object.create(null);
    for(const question of request.questions){
      const value=Object.hasOwn(draft,question.id)?draft[question.id]:undefined,options=question.options||[];
      const answer=options.length&&typeof value?.selection==='number'?options[value.selection]?.label:(!options.length||question.isOther&&value?.selection==='other')?value?.text:undefined;
      if(typeof answer!=='string'||!answer.trim()||answer.length>2000)return null;
      answers[question.id]={answers:[answer]};
    }
    return request.questions.length?answers:null;
  }
  function start(){
    if(disabled||operationRef.current||interactionLock?.current||!current())return null;
    const operation={};operationRef.current=operation;if(interactionLock)interactionLock.current=true;
    setBusy({scope,value:true});onBusyChange?.(true);update(before=>({...before,error:''}));return operation;
  }
  function finish(operation:object){
    if(operationRef.current===operation){operationRef.current=null;if(interactionLock)interactionLock.current=false;}
    if(current()){setBusy({scope,value:false});onBusyChange?.(false);}
  }
  function mark(id:string,decision:Decision){
    decisionsRef.current={...decisionsRef.current,[id]:decision};
    update(before=>{const forms={...before.forms};delete forms[id];return{...before,forms,decisions:{...before.decisions,[id]:decision}};});
  }
  function acceptSnapshot(next:Conversation){
    if(!current()||next.id!==conversationId||!Array.isArray(next.agent?.userInputs))return;
    update(before=>{const decisions={...before.decisions};for(const [id,decision]of Object.entries(decisions)){if(decision!=='uncertain')continue;const pending=next.agent!.userInputs!.find(item=>item.id===id);if(!pending)decisions[id]='consumed';else if(!pending.deliveryUncertain)delete decisions[id];}decisionsRef.current=decisions;return{...before,forms:{},decisions};});
  }
  async function refreshState(){
    const operation=start();if(!operation)return;
    try{const next=await refresh();if(current()){acceptSnapshot(next);update(before=>({...before,error:''}));}}
    catch(cause){if(current()&&!isSessionChanged(cause))update(before=>({...before,error:'暂时无法刷新问题状态，请稍后重试；不会自动重发回答。'}));}
    finally{finish(operation);}
  }
  async function submit(request:InputRequest,skip:boolean){
    if(!currentRequest(request)||decisionsRef.current[request.id])return;
    const answers=skip?null:answersFor(request);if(!skip&&!answers)return;
    const operation=start();if(!operation)return;
    let submitted=false;
    try{
      await api(`/codex/user-inputs/${encodeURIComponent(request.id)}`,{method:'POST',body:JSON.stringify(skip?{skip:true}:{answers})});submitted=true;
      if(!current())return;
      mark(request.id,'consumed');
      try{await refresh();}catch(cause){if(current()&&!isSessionChanged(cause))update(before=>({...before,error:'回答已提交，任务进度暂时无法刷新；不会重复提交。'}));}
    }catch(cause){
      if(!current()||isSessionChanged(cause))return;
      const status=(cause as {status?:number}).status;
      if(!submitted&&(status===400||status===422)){update(before=>({...before,error:'回答未被接受，请检查每个问题的选项和填写内容。'}));return;}
      mark(request.id,'uncertain');
      if(status===409){
        try{const next=await refresh();if(current()){acceptSnapshot(next);update(before=>({...before,error:'问题状态已变化，已刷新；请检查当前问题后再操作。'}));}}
        catch(refreshError){if(current()&&!isSessionChanged(refreshError))update(before=>({...before,error:'暂时无法刷新问题状态；不会自动重发回答。'}));}
      }else update(before=>({...before,error:uncertainMessage}));
    }finally{finish(operation);}
  }
  if(!active||(!shown.length&&!local.error))return null;
  return <section className="agent-user-input" tabIndex={-1} aria-label="Agent 待回答问题" aria-busy={busy}>
    {shown.map(request=>{
      const draft=getDraft(request),uncertain=request.deliveryUncertain||local.decisions[request.id]==='uncertain',blocked=busy||disabled||uncertain;
      return <div className="agent-input-card" key={request.id}>
        <h3><CircleHelp size={17} aria-hidden="true"/>Agent 需要你的回答</h3>
        {uncertain?<div className="agent-input-uncertain"><p role="status">{uncertainMessage}</p><button type="button" className="secondary-button" disabled={busy||disabled} onClick={()=>void refreshState()}>刷新问题状态</button></div>:<>
          {request.questions.map((question,questionIndex)=>{
            const value=Object.hasOwn(draft,question.id)?draft[question.id]:undefined,options=question.options||[],name=`${prefix}-${request.id}-${questionIndex}`;
            return <fieldset key={question.id} disabled={blocked}>
              <legend><span>{question.header}</span>{question.question}</legend>
              {options.map((option,index)=><label className="agent-input-option" key={index}><input type="radio" name={name} value={index} checked={value?.selection===index} onChange={()=>setChoice(request,question.id,{selection:index})}/><span><strong>{option.label}</strong>{option.description&&<span>{option.description}</span>}</span></label>)}
              {options.length>0&&question.isOther&&<label className="agent-input-option"><input type="radio" name={name} value="other" checked={value?.selection==='other'} onChange={()=>setChoice(request,question.id,{selection:'other',text:value?.text||''})}/><span>其他回答</span></label>}
              {(!options.length||question.isOther&&value?.selection==='other')&&<input className="agent-input-text" aria-label={`${question.header}的回答`} type={question.isSecret?'password':'text'} autoComplete="off" spellCheck={false} maxLength={2000} value={value?.text||''} onChange={event=>setChoice(request,question.id,{...value,...(options.length?{selection:'other' as const}:{}),text:event.target.value})} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}}/>}
            </fieldset>;
          })}
          <div className="agent-input-actions"><button type="button" className="secondary-button" disabled={blocked} onClick={()=>void submit(request,true)}>跳过本次提问</button><button type="button" className="primary-button" disabled={blocked||!answersFor(request)} onClick={()=>void submit(request,false)}>{busy?<><Loader2 size={14} className="spin" aria-hidden="true"/>正在提交…</>:'提交回答'}</button></div>
        </>}
      </div>;
    })}
    {local.error&&<p className="agent-input-error" role="alert">{local.error}</p>}
  </section>;
}
