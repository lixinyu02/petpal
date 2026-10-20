import {useEffect,useRef,useState,useSyncExternalStore,type FormEvent} from 'react';
import {Bell,Check,ChevronDown,CloudSun,Loader2,MapPin,Pause,Play,RefreshCw,Search,Sunrise} from 'lucide-react';
import {api,getIdentity,getSessionEpoch,isSessionChanged,subscribeSession} from './api';
import MessageMarkdown from './MessageMarkdown';
import TaskNotificationsSettings from './TaskNotificationsSettings';
import {supportsTaskNotifications} from './platform/task-notifications';
import {createVisiblePoll} from './platform/visible-poll.mjs';
import {companionDate,companionRunLabel,companionRunPending,companionSettings,companionSettingsEqual,companionSettingsIssue,defaultCompanionSettings,readCompanionRequest,saveCompanionRequest,type CompanionLocation,type CompanionRoutine,type CompanionRoutineCatalog,type CompanionRoutinePreview,type CompanionRoutineRun,type CompanionRoutineSettings} from './daily-companion';
import './daily-companion.css';

type Props={connected?:boolean;selectedRunId?:string;onEditingChange?:(dirty:boolean)=>void};
type UnknownRequest={kind:'save';settings:CompanionRoutineSettings;revision:string|null}|{kind:'run';requestId:string};
type Identity={instanceId:string;userId:string};
const knownRejection=(error:unknown)=>{const status=(error as {status?:number})?.status;return typeof status==='number'&&status>=400&&status<500;};

export default function DailyCompanionSettings({connected=true,selectedRunId,onEditingChange}:Props){
  const session=useSyncExternalStore(subscribeSession,getSessionEpoch,getSessionEpoch),epoch=useRef(session).current;
  const alive=useRef(true),lock=useRef(false),loadSequence=useRef(0),searchSequence=useRef(0),controllers=useRef(new Map<AbortController,ReturnType<typeof setTimeout>>()),callback=useRef(onEditingChange);callback.current=onEditingChange;
  const [routine,setRoutine]=useState<CompanionRoutine|null>(null),routineRef=useRef<CompanionRoutine|null>(null),[draft,setDraft]=useState(defaultCompanionSettings),draftRef=useRef(draft);
  const [runs,setRuns]=useState<CompanionRoutineRun[]>([]),runsRef=useRef(runs),[loading,setLoading]=useState(connected),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [unknown,setUnknown]=useState<UnknownRequest|null>(null),unknownRef=useRef<UnknownRequest|null>(null),identity=useRef<Identity|null>(null),[preview,setPreview]=useState<CompanionRoutinePreview|null>(null);
  const [query,setQuery]=useState(''),[locations,setLocations]=useState<CompanionLocation[]>([]),[searching,setSearching]=useState(false),[searched,setSearched]=useState(false),[locationError,setLocationError]=useState(''),[expanded,setExpanded]=useState(selectedRunId||'');
  const native=supportsTaskNotifications(),dirty=!!routine&&!companionSettingsEqual(draft,routine),stale=session!==epoch,current=()=>alive.current&&getSessionEpoch()===epoch;
  const canWork=()=>current()&&connected;
  const scope=()=>identity.current?`${identity.current.instanceId}:${identity.current.userId}`:'';
  const storage=()=>{try{return window.sessionStorage;}catch{return undefined;}};
  function requestController(){const controller=new AbortController();controllers.current.set(controller,setTimeout(()=>controller.abort(new Error('请求超时，请检查网络后确认结果。')),30000));return controller;}
  function releaseController(controller:AbortController){clearTimeout(controllers.current.get(controller));controllers.current.delete(controller);}
  function isOwn(value:Partial<Identity>){const expected=identity.current||getIdentity();return !expected||value.instanceId===expected.instanceId&&value.userId===expected.userId;}
  // Parent tab and workspace handlers read their own synchronous guard refs.
  // Publish before React commits, so a captured click cannot hide the first edit.
  function reportEditing(){if(current())callback.current?.(!!routineRef.current&&!companionSettingsEqual(draftRef.current,routineRef.current)||lock.current||!!unknownRef.current);}
  function assignDraft(next:CompanionRoutineSettings){draftRef.current=next;setDraft(next);reportEditing();}
  function setUncertain(next:UnknownRequest|null){unknownRef.current=next;setUnknown(next);reportEditing();}
  function acceptRun(run:CompanionRoutineRun){const next=[run,...runsRef.current.filter(item=>item.id!==run.id)].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,30);runsRef.current=next;setRuns(next);}
  function acceptCatalog(result:CompanionRoutineCatalog,replaceDraft=false){
    if(!isOwn(result))throw Error('服务返回的账号与当前登录不一致，请重新连接。');
    identity.current={instanceId:result.instanceId,userId:result.userId};routineRef.current=result.routine;setRoutine(result.routine);
    if(replaceDraft)assignDraft(companionSettings(result.routine));else reportEditing();
    if(result.runs){const selected=selectedRunId?runsRef.current.find(item=>item.id===selectedRunId):undefined;const next=selected&&!result.runs.some(item=>item.id===selected.id)?[selected,...result.runs]:result.runs;runsRef.current=next;setRuns(next);}
  }
  async function load(signal?:AbortSignal,replaceDraft=false){
    if(!canWork()||signal?.aborted)return;const sequence=++loadSequence.current;
    const result=await api<CompanionRoutineCatalog>('/companion-routine',{signal});if(!current()||signal?.aborted||sequence!==loadSequence.current)return;
    const previous=routineRef.current,initial=!previous;acceptCatalog(result,replaceDraft||!previous||companionSettingsEqual(draftRef.current,previous));setLoading(false);
    if(initial){const requestId=readCompanionRequest(storage(),scope());if(requestId)setUncertain({kind:'run',requestId});}
  }
  useEffect(()=>{
    alive.current=true;if(!connected)return()=>{alive.current=false;};
    const controller=requestController();void load(controller.signal).catch(e=>{if(current()&&!isSessionChanged(e)){setError((e as Error).message||'暂时无法读取每日陪伴。');setLoading(false);}}).finally(()=>releaseController(controller));
    return()=>{alive.current=false;loadSequence.current++;searchSequence.current++;for(const [item,timer] of controllers.current){item.abort();clearTimeout(timer);}controllers.current.clear();callback.current?.(false);};
  },[connected]);
  useEffect(()=>{reportEditing();},[dirty,busy,unknown]);
  useEffect(()=>{if(!dirty&&!busy&&!unknown)return;const leave=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty,busy,unknown]);
  useEffect(()=>{
    if(!connected||stale)return;
    return createVisiblePoll({document,window,intervalMs:4000,isCurrent:current,run:async signal=>{
      if(lock.current||!routineRef.current)return;
      const active=runsRef.current.filter(companionRunPending);if(!active.length)return;
      for(const item of active){const controller=requestController(),abort=()=>controller.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});try{if(signal.aborted)return;const result=await api<{run:CompanionRoutineRun}&Identity>(`/companion-routine/runs/${encodeURIComponent(item.id)}`,{signal:controller.signal});if(!current()||signal.aborted||controller.signal.aborted)return;if(!isOwn(result))throw Error('账号已变化，请重新打开每日陪伴。');acceptRun(result.run);}catch(e){if(current()&&!signal.aborted&&!isSessionChanged(e))setError((e as Error).message||'进度暂时不可用，可刷新重试。');}finally{signal.removeEventListener('abort',abort);releaseController(controller);}}
    }});
  },[connected,stale]);
  useEffect(()=>{
    if(!selectedRunId||!canWork())return;setExpanded(selectedRunId);const controller=requestController();
    void api<{run:CompanionRoutineRun}&Identity>(`/companion-routine/runs/${encodeURIComponent(selectedRunId)}`,{signal:controller.signal}).then(result=>{if(!current()||controller.signal.aborted)return;const expected=identity.current||getIdentity();if(expected&&(expected.instanceId!==result.instanceId||expected.userId!==result.userId))return;acceptRun(result.run);}).catch(e=>{if(current()&&!isSessionChanged(e)&&controller.signal.reason?.name!=='AbortError')setError((e as Error).message||'无法读取这条问候。');}).finally(()=>releaseController(controller));
    return()=>controller.abort();
  },[selectedRunId,connected]);
  function patch(change:Partial<CompanionRoutineSettings>){if(!canWork()||lock.current||unknownRef.current)return;assignDraft({...draftRef.current,...change});setPreview(null);setError('');setNotice('');}
  async function search(){
    if(!canWork()||lock.current||unknownRef.current||query.trim().length<2)return;const sequence=++searchSequence.current,controller=requestController();setSearching(true);setSearched(false);setLocationError('');setLocations([]);
    try{const result=await api<{locations:CompanionLocation[]}>(`/companion-routine/locations?query=${encodeURIComponent(query.trim())}`,{signal:controller.signal});if(current()&&!controller.signal.aborted&&sequence===searchSequence.current){setLocations(result.locations);setSearched(true);}}
    catch(e){if(current()&&sequence===searchSequence.current&&!isSessionChanged(e))setLocationError((e as Error).message||'地点搜索暂不可用，请重试。');}
    finally{releaseController(controller);if(current()&&sequence===searchSequence.current)setSearching(false);}
  }
  async function save(settings:CompanionRoutineSettings=draftRef.current,revision=routineRef.current?.revision??null,confirming=false){
    if(!canWork()||lock.current||unknownRef.current&&!confirming)return;const issue=companionSettingsIssue(settings);if(issue){setError(issue);return;}
    lock.current=true;reportEditing();loadSequence.current++;const controller=requestController();setBusy('save');setError('');setNotice('');
    try{
      if(confirming){const result=await api<CompanionRoutineCatalog>('/companion-routine',{signal:controller.signal});if(!current())return;acceptCatalog(result);if(companionSettingsEqual(result.routine,settings)){assignDraft(companionSettings(result.routine));setUncertain(null);setNotice('已确认此前的保存。');return;}if(result.routine.revision!==revision){setUncertain(null);throw Object.assign(Error('计划已在其他窗口修改。当前草稿保留，请先载入最新配置再调整。'),{status:409});}}
      const result=await api<CompanionRoutineCatalog>('/companion-routine',{method:'PUT',body:JSON.stringify({...companionSettings(settings),revision}),signal:controller.signal});if(!current())return;acceptCatalog(result,true);setUncertain(null);setPreview(null);setNotice(result.routine.enabled?'每日陪伴已保存并开启。':'已保存，定时陪伴保持暂停。');
    }catch(e){if(!current()||isSessionChanged(e))return;if(knownRejection(e)){setUncertain(null);setError((e as Error).message);}else{setUncertain({kind:'save',settings:companionSettings(settings),revision});setError('保存结果暂未确认。请确认原请求，避免覆盖新的设置。');}}
    finally{releaseController(controller);lock.current=false;if(current()){setBusy('');reportEditing();}}
  }
  async function showPreview(){
    if(!canWork()||lock.current||unknownRef.current)return;const issue=companionSettingsIssue(draftRef.current);if(issue){setError(issue);return;}
    lock.current=true;reportEditing();const controller=requestController();setBusy('preview');setError('');setNotice('');
    try{const result=await api<CompanionRoutinePreview>('/companion-routine/preview',{method:'POST',body:JSON.stringify(companionSettings(draftRef.current)),signal:controller.signal});if(current()){setPreview(result);setNotice('这是预览，不保存、不发送通知。');}}
    catch(e){if(current()&&!isSessionChanged(e))setError((e as Error).message||'暂时无法生成预览。');}
    finally{releaseController(controller);lock.current=false;if(current()){setBusy('');reportEditing();}}
  }
  async function run(requestId?:string){
    if(!canWork()||lock.current||!routineRef.current?.revision||!companionSettingsEqual(draftRef.current,routineRef.current)||unknownRef.current&&unknownRef.current.kind!=='run')return;
    const id=requestId||(unknownRef.current?.kind==='run'?unknownRef.current.requestId:crypto.randomUUID());saveCompanionRequest(storage(),scope(),id);setUncertain({kind:'run',requestId:id});
    lock.current=true;reportEditing();const controller=requestController();setBusy('run');setError('');setNotice('');
    try{const result=await api<{run:CompanionRoutineRun}&Identity>('/companion-routine/run',{method:'POST',body:JSON.stringify({requestId:id}),signal:controller.signal});if(!current())return;if(!isOwn(result))throw Error('服务返回的账号不一致，请重新连接。');acceptRun(result.run);setExpanded(result.run.id);setUncertain(null);saveCompanionRequest(storage(),scope(),null);setNotice(companionRunPending(result.run)?'已提交，问候正在生成。可在下方查看进度。':'已确认运行结果。');}
    catch(e){if(!current()||isSessionChanged(e))return;if(knownRejection(e)){setUncertain(null);saveCompanionRequest(storage(),scope(),null);setError((e as Error).message);}else setError('运行回执暂未收到。原请求标识已保留，请确认原请求，不会创建第二次问候。');}
    finally{releaseController(controller);lock.current=false;if(current()){setBusy('');reportEditing();}}
  }
  function submit(event:FormEvent){event.preventDefault();void save();}
  const disabled=!connected||stale||loading||!!busy||!!unknown,pendingRun=runs.some(companionRunPending),settingsReady=!!routine;
  return<section className="daily-companion" aria-label="每日陪伴" aria-busy={loading||!!busy}>
    <header className="daily-companion-heading"><div><span className="daily-companion-eyebrow"><Sunrise size={17} aria-hidden="true"/>每天，先说一声你好</span><h1>每日陪伴</h1><p>按你选择的时间送来问候、当地天气和节日祝福。</p></div><button type="button" className="icon-button" aria-label="刷新每日陪伴" disabled={disabled||dirty} onClick={()=>{const controller=requestController();void load(controller.signal).catch(e=>{if(current()&&!isSessionChanged(e))setError(e.message);}).finally(()=>releaseController(controller));}}><RefreshCw size={18} aria-hidden="true"/></button></header>
    {!connected||stale?<p className="daily-companion-feedback" role="status">{stale?'登录已变化，请重新打开每日陪伴。':'登录后即可设置自己的每日陪伴。'}</p>:<>
    {error&&<p className="daily-companion-feedback is-error" role="alert">{error}</p>}{notice&&<p className="daily-companion-feedback" role="status"><Check size={16} aria-hidden="true"/>{notice}</p>}
    {unknown&&<div className="daily-companion-uncertain" role="status"><p>{unknown.kind==='run'?'待确认的试运行已保留。确认时沿用同一请求标识，已提交过的问候不会重复创建。':'保存可能已经生效。先读取服务器结果，再确认原修改。'}</p><button type="button" className="secondary-button" disabled={!!busy} onClick={()=>unknown.kind==='run'?void run(unknown.requestId):void save(unknown.settings,unknown.revision,true)}>{busy?<Loader2 size={15} className="spin" aria-hidden="true"/>:<RefreshCw size={15} aria-hidden="true"/>}确认原请求</button></div>}
    {loading?<p className="daily-companion-loading" role="status"><Loader2 size={19} className="spin" aria-hidden="true"/>正在读取陪伴计划…</p>:!settingsReady?<button type="button" className="secondary-button" disabled={!!busy} onClick={()=>{const controller=requestController();void load(controller.signal).catch(e=>{if(current()&&!isSessionChanged(e))setError(e.message);}).finally(()=>releaseController(controller));}}>重新读取计划</button>:<>
      <div className="daily-companion-status"><span className={routine.enabled?'is-enabled':''}>{routine.enabled?'定时已开启':'定时未开启'}</span><p>{routine.enabled?`下次问候：${companionDate(routine.nextRunAt)} · ${routine.timezone}`:'先设置时间与内容，保存后由你决定是否开启。'}</p>{routine.enabled&&<button type="button" className="secondary-button" disabled={disabled||dirty} onClick={()=>void save({...companionSettings(routine),enabled:false})}><Pause size={15} aria-hidden="true"/>暂停计划</button>}</div>
      <form className="daily-companion-form" aria-label="每日陪伴设置" onSubmit={submit}>
        <div className="daily-companion-time"><label className="daily-companion-field">每日时间<input type="time" aria-label="每日陪伴时间" value={draft.time} disabled={disabled} onChange={e=>patch({time:e.target.value})}/></label><label className="daily-companion-field">时区<input aria-label="每日陪伴时区" maxLength={100} value={draft.timezone} disabled={disabled} placeholder="Asia/Shanghai" onChange={e=>patch({timezone:e.target.value})}/></label><button type="button" className="daily-companion-link" disabled={disabled} onClick={()=>patch({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai'})}>使用当前时区</button></div>
        <fieldset className="daily-companion-content"><legend>问候里带上</legend><label className="daily-companion-check"><input type="checkbox" aria-label="问候包含天气" checked={draft.includeWeather} disabled={disabled} onChange={e=>patch({includeWeather:e.target.checked})}/><CloudSun size={17} aria-hidden="true"/><span>当地天气</span></label>
          {draft.includeWeather&&<div className="daily-companion-location"><div className="daily-companion-search"><label className="daily-companion-field">查找地点<input aria-label="搜索天气地点" value={query} maxLength={100} disabled={disabled} placeholder="省市、区县或乡镇，如北蔡镇" onChange={e=>{if(!canWork()||lock.current||unknownRef.current)return;searchSequence.current++;setSearching(false);setLocations([]);setSearched(false);setLocationError('');setQuery(e.target.value);}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void search();}}}/></label><button type="button" className="secondary-button" disabled={disabled||searching||query.trim().length<2} onClick={()=>void search()}>{searching?<Loader2 size={16} className="spin" aria-hidden="true"/>:<Search size={16} aria-hidden="true"/>}搜索</button></div>
          {draft.location&&<p className="daily-companion-selected"><MapPin size={16} aria-hidden="true"/><span>已选：<strong>{draft.location.fullName}</strong></span><button type="button" className="daily-companion-link" disabled={disabled} onClick={()=>patch({location:null})}>更换</button></p>}
          {locationError&&<p className="daily-companion-feedback is-error" role="alert">{locationError}</p>}{searched&&!locations.length&&<p className="daily-companion-note" role="status">没有找到候选，请补充省市或换一种地名。</p>}
          {!!locations.length&&<div className="daily-companion-candidates" role="group" aria-label="选择天气地点"><p>请确认一个地点，同名地点不会自动选择。</p>{locations.map(location=><button type="button" key={location.id} aria-pressed={draft.location?.id===location.id} disabled={disabled} onClick={()=>{patch({location});setLocations([]);setSearched(false);}}><MapPin size={16} aria-hidden="true"/><span><strong>{location.fullName}</strong><small>{location.name}</small></span>{draft.location?.id===location.id&&<Check size={16} aria-hidden="true"/>}</button>)}</div>}
          </div>}
          <label className="daily-companion-check"><input type="checkbox" aria-label="问候包含节日祝福" checked={draft.includeHolidays} disabled={disabled} onChange={e=>patch({includeHolidays:e.target.checked})}/><span>节日祝福</span></label><div className="daily-companion-personal"><label className="daily-companion-field">生日（可选）<input aria-label="每日陪伴生日" value={draft.birthday||''} maxLength={5} inputMode="numeric" placeholder="月-日，例如 10-20" disabled={disabled} onChange={e=>patch({birthday:e.target.value||null})}/></label><label className="daily-companion-field">问候语气<select aria-label="每日陪伴语气" value={draft.tone} disabled={disabled} onChange={e=>patch({tone:e.target.value as CompanionRoutineSettings['tone']})}><option value="gentle">温柔一点</option><option value="brief">简短一点</option></select></label></div>
        </fieldset>
        <fieldset className="daily-companion-notifications"><legend><Bell size={16} aria-hidden="true"/>通知</legend><label className="daily-companion-check"><input type="checkbox" aria-label="每日问候发送通知" checked={draft.notify} disabled={disabled} onChange={e=>patch({notify:e.target.checked})}/><span>问候生成后提醒我</span></label><label className="daily-companion-check is-suboption"><input type="checkbox" aria-label="通知显示问候预览" checked={draft.notificationPreview} disabled={disabled||!draft.notify} onChange={e=>patch({notificationPreview:e.target.checked})}/><span>在通知中显示内容预览</span></label><p className="daily-companion-note">默认通知只提示问候已就绪，完整内容保存在下方记录。</p></fieldset>
        <div className="daily-companion-form-footer"><label className="daily-companion-check"><input type="checkbox" aria-label="保存后启用每日陪伴" checked={draft.enabled} disabled={disabled} onChange={e=>patch({enabled:e.target.checked})}/><span>保存后开启每日陪伴</span></label><div className="daily-companion-actions"><button type="button" className="secondary-button" disabled={disabled} onClick={()=>void showPreview()}>{busy==='preview'&&<Loader2 size={15} className="spin" aria-hidden="true"/>}预览问候</button><button type="submit" className="primary-button" disabled={disabled||!dirty&&routine.revision!==null}>{busy==='save'&&<Loader2 size={15} className="spin" aria-hidden="true"/>}保存设置</button></div></div>
        {dirty&&<p className="daily-companion-note" role="status">修改尚未保存。试运行使用保存后的设置。</p>}
        {dirty&&<button type="button" className="daily-companion-link" disabled={disabled} onClick={()=>{if(!canWork()||lock.current||unknownRef.current)return;const controller=requestController();void load(controller.signal,true).catch(e=>{if(current()&&!isSessionChanged(e))setError(e.message);}).finally(()=>releaseController(controller));}}>放弃修改，载入最新设置</button>}
      </form>
      {preview&&<section className="daily-companion-preview" aria-label="问候预览"><div><h2>{preview.title}</h2><span>仅预览</span></div><MessageMarkdown content={preview.content}/>{preview.warnings?.map((warning,i)=><p className="daily-companion-note" key={i}>{warning}</p>)}</section>}
      <section className="daily-companion-history" aria-label="每日陪伴运行记录"><header><div><h2>问候记录</h2><p>{routine.revision?'可先试运行一次，计划仍按保存的开关运行。':'先保存设置，再试运行一次问候。'}</p></div><button type="button" className="secondary-button" disabled={disabled||dirty||pendingRun||!routine.revision} onClick={()=>void run()}>{busy==='run'||pendingRun?<Loader2 size={15} className="spin" aria-hidden="true"/>:<Play size={15} aria-hidden="true"/>}{pendingRun?'正在生成':routine.notify?'试运行并提醒':'立即试运行'}</button></header>{!runs.length?<p className="daily-companion-empty">第一声问候，会留在这里。</p>:<ol>{runs.map(item=><li key={item.id}><button type="button" className="daily-companion-run-toggle" aria-expanded={expanded===item.id} onClick={()=>setExpanded(expanded===item.id?'':item.id)}><span><strong>{item.title||'小伴的每日问候'}</strong><small>{companionDate(item.createdAt||item.scheduledFor)} · {item.trigger==='manual'?'手动试运行':'每日计划'}</small></span><em className={`status-${item.status}`}>{companionRunLabel(item.status)}</em><ChevronDown size={16} aria-hidden="true"/></button>{expanded===item.id&&<div className="daily-companion-run-body">{item.content?<MessageMarkdown content={item.content}/>:<p>{companionRunPending(item)?'小伴正在准备问候，进度会自动更新。':'本次没有生成可展示的问候。'}</p>}{item.warnings?.map((warning,i)=><p className="daily-companion-note" key={i}>{warning}</p>)}</div>}</li>)}</ol>}</section>
      <section className="daily-companion-delivery" aria-label="手机后台提醒"><h2>让问候到达手机</h2>{native?<TaskNotificationsSettings connected={connected}/>:<p>在安卓客户端开启后台提醒后，可离开应用接收问候。网页仍可查看计划和全部记录。</p>}<p className="daily-companion-note">会结合当前账号的记忆与可用聊天模型；服务不可用时保留基础问候。</p><p className="daily-companion-note">服务器需保持运行。手机断网、省电冻结、强制停止或登录过期可能影响提醒；不补发已过期的问候。</p></section>
    </>}
    </>}
  </section>;
}
