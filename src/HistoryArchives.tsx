import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Archive,ArrowLeft,ChevronDown,ChevronUp,Loader2,RefreshCw,Search} from 'lucide-react';
import {isSessionChanged,type User} from './api';
import {useCloudSession} from './platform/cloud-session';
import './history-archives.css';

type HistoryArchive={id:string;personName:string;sourceStart:string;sourceEnd:string;messageCount:number;importedAt:string;memory?:{total:number;acked:number;state:string}};
type HistoryMessage={id:string;speaker:'self'|'other'|'system';speakerName:string;occurredAt:string;text:string;kind:string;attachmentCount:number};
type Filters={q:string;from:string;to:string;speaker:string};
type HistoryPage={messages:HistoryMessage[];nextCursor:number|null;total:number};
const emptyFilters=():Filters=>({q:'',from:'',to:'',speaker:''});
const count=(value:number)=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString('zh-CN'):'—';
const day=(value:string)=>/^\d{4}-\d{2}-\d{2}/.test(value)?value.slice(0,10):'日期待确认';
const validDay=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(`${value}T00:00:00Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};
const originalTime=(value:string)=>{
  const date=new Date(value);
  return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date):'原时间待确认';
};
const memoryLabels=new Map(Object.entries({staged:'等待导入',staging:'等待导入',prepared:'准备完成',working:'提炼中',disabled:'记忆已停用',queued:'等待导入',importing:'导入中',running:'导入中',complete:'已完成',completed:'已完成',paused:'已暂停','sample-limit':'样本已完成',epoch_changed:'记忆版本已变化，待确认',unknown:'结果待确认',error:'需要检查'}));
const memoryState=(value?:string)=>memoryLabels.get(value||'')||'待确认';
const safeFailure=(failure:unknown)=>{
  const status=(failure as {status?:number})?.status;
  return status===404?'此服务器暂未提供历史档案，请更新服务器。':status===501?'此服务器暂不支持历史档案。':'暂时无法读取历史档案，请重试。';
};

/** History remains a dated record of two people, never an AI conversation. */
export default function HistoryArchives({connected,user}:{connected:boolean;user?:User}){
  const scope=useCloudSession(connected,user),[opened,setOpened]=useState(false),[owner,setOwner]=useState({key:'',epoch:-1});
  const [archives,setArchives]=useState<HistoryArchive[]>([]),[selected,setSelected]=useState(''),[catalogBusy,setCatalogBusy]=useState(false),[catalogRevision,setCatalogRevision]=useState(0);
  const [draft,setDraft]=useState<Filters>(emptyFilters),[filters,setFilters]=useState<Filters>(emptyFilters),[page,setPage]=useState<HistoryPage&{key:string}>({key:'',messages:[],nextCursor:null,total:0});
  const [pageBusy,setPageBusy]=useState(false),[pageRevision,setPageRevision]=useState(0),[error,setError]=useState(''),[expanded,setExpanded]=useState<Set<string>>(()=>new Set());
  const catalogSequence=useRef(0),pageSequence=useRef(0),pageController=useRef<AbortController|null>(null),pagingLock=useRef(false);
  const visible=scope.allowed&&owner.key===scope.key&&owner.epoch===scope.epoch;
  const archive=visible?archives.find(item=>item.id===selected):undefined;
  const pageKey=JSON.stringify([selected,filters]);
  const currentPage=visible&&archive&&page.key===pageKey?page:null;

  useEffect(()=>{
    catalogSequence.current++;pageSequence.current++;pageController.current?.abort();pagingLock.current=false;
    setOpened(false);setArchives([]);setSelected('');setPage({key:'',messages:[],nextCursor:null,total:0});setError('');setExpanded(new Set());setDraft(emptyFilters());setFilters(emptyFilters());setPageBusy(false);setCatalogBusy(false);
  },[scope.key,scope.epoch]);
  useEffect(()=>{
    if(!opened||!visible)return;
    const generation=scope.capture(),sequence=++catalogSequence.current,controller=new AbortController();setCatalogBusy(true);setError('');
    void scope.request<{archives:HistoryArchive[]}>('/history-archives',{signal:controller.signal},generation).then(value=>{
      if(!Array.isArray(value.archives)||value.archives.some(item=>!item||typeof item.id!=='string'||typeof item.personName!=='string'||typeof item.sourceStart!=='string'||typeof item.sourceEnd!=='string'||!Number.isSafeInteger(item.messageCount)||item.messageCount<0))throw new Error('Invalid archive catalog');
      if(!controller.signal.aborted&&scope.current(generation)&&sequence===catalogSequence.current)setArchives(value.archives);
    }).catch(failure=>{
      if(!controller.signal.aborted&&scope.current(generation)&&sequence===catalogSequence.current&&!isSessionChanged(failure))setError(safeFailure(failure));
    }).finally(()=>{if(!controller.signal.aborted&&scope.current(generation)&&sequence===catalogSequence.current)setCatalogBusy(false);});
    return()=>{controller.abort();catalogSequence.current++;};
  },[opened,visible,scope.key,scope.epoch,catalogRevision]);
  useEffect(()=>{
    if(!opened||!visible||!archive)return;
    const generation=scope.capture(),sequence=++pageSequence.current,controller=new AbortController();pageController.current?.abort();pageController.current=controller;pagingLock.current=false;
    setPageBusy(true);setError('');setExpanded(new Set());
    void requestPage(0,controller.signal,generation).then(value=>{
      if(!controller.signal.aborted&&scope.current(generation)&&sequence===pageSequence.current)setPage({...value,key:pageKey});
    }).catch(failure=>{
      if(!controller.signal.aborted&&scope.current(generation)&&sequence===pageSequence.current&&!isSessionChanged(failure))setError(safeFailure(failure));
    }).finally(()=>{if(!controller.signal.aborted&&scope.current(generation)&&sequence===pageSequence.current)setPageBusy(false);});
    return()=>{controller.abort();pageSequence.current++;pagingLock.current=false;};
  },[opened,visible,scope.key,scope.epoch,selected,pageKey,!!archive,pageRevision]);

  async function requestPage(cursor:number,signal:AbortSignal,generation:number):Promise<HistoryPage>{
    const query=new URLSearchParams({cursor:String(cursor),limit:'100'});
    for(const key of ['q','from','to','speaker'] as const)if(filters[key])query.set(key,filters[key]);
    const value=await scope.request<HistoryPage>(`/history-archives/${encodeURIComponent(selected)}/messages?${query}`,{signal},generation);
    if(!Array.isArray(value.messages)||!Number.isSafeInteger(value.total)||value.total<0||value.messages.some(item=>!item||typeof item.id!=='string'||typeof item.text!=='string'||typeof item.occurredAt!=='string'||!['self','other','system'].includes(item.speaker)))throw new Error('Invalid archive page');
    return {...value,nextCursor:Number.isSafeInteger(value.nextCursor)&&Number(value.nextCursor)>cursor?value.nextCursor:null};
  }
  function open(){if(!scope.live())return;setOwner({key:scope.key,epoch:scope.epoch});setOpened(true);setError('');}
  function close(){pageController.current?.abort();pageSequence.current++;pagingLock.current=false;setOpened(false);setSelected('');setPage({key:'',messages:[],nextCursor:null,total:0});setError('');}
  function select(id:string){if(!scope.live())return;pageController.current?.abort();pageSequence.current++;setSelected(id);setDraft(emptyFilters());setFilters(emptyFilters());setExpanded(new Set());setError('');}
  function apply(event:FormEvent){
    event.preventDefault();
    if(!scope.live())return;
    if((draft.from&&!validDay(draft.from))||(draft.to&&!validDay(draft.to))||draft.from&&draft.to&&draft.from>draft.to){setError('请检查起止日期。');return;}
    setFilters({...draft,q:draft.q.trim()});setPageRevision(value=>value+1);setError('');
  }
  async function more(){
    if(!currentPage||currentPage.nextCursor===null||pageBusy||pagingLock.current||!scope.live())return;
    const generation=scope.capture(),sequence=++pageSequence.current,controller=new AbortController(),capturedKey=pageKey,cursor=currentPage.nextCursor;
    pagingLock.current=true;pageController.current?.abort();pageController.current=controller;setPageBusy(true);setError('');
    try{
      const value=await requestPage(cursor,controller.signal,generation);
      if(!controller.signal.aborted&&scope.current(generation)&&sequence===pageSequence.current)setPage(previous=>{
        if(previous.key!==capturedKey)return previous;
        const ids=new Set(previous.messages.map(item=>item.id));
        return {...value,key:capturedKey,messages:[...previous.messages,...value.messages.filter(item=>!ids.has(item.id))]};
      });
    }catch(failure){if(!controller.signal.aborted&&scope.current(generation)&&sequence===pageSequence.current&&!isSessionChanged(failure))setError(safeFailure(failure));}
    finally{if(scope.current(generation)&&sequence===pageSequence.current){pagingLock.current=false;setPageBusy(false);}}
  }
  function toggle(id:string){setExpanded(value=>{const next=new Set(value);next.has(id)?next.delete(id):next.add(id);return next;});}

  return <section className="history-archives" aria-label="我的历史档案">
    <header className="history-archives-heading"><Archive size={19} aria-hidden="true"/><div><h3>历史档案</h3><p>保留原说话人和日期，与你的新对话分开查看。</p></div><button type="button" className="secondary-button" disabled={!scope.allowed} aria-expanded={opened&&visible} onClick={()=>opened&&visible?close():open()}>{opened&&visible?'收起档案':'查看历史档案'}{opened&&visible?<ChevronUp size={15} aria-hidden="true"/>:<ChevronDown size={15} aria-hidden="true"/>}</button></header>
    {!scope.allowed&&<p className="history-archives-note">登录后可查看当前账号的历史资料。</p>}
    {opened&&visible&&<div className="history-archives-body">
      <div className="history-archives-toolbar"><span>仅当前账号可见</span><button type="button" className="text-button" disabled={catalogBusy} onClick={()=>{setCatalogRevision(value=>value+1);if(archive)setPageRevision(value=>value+1);}}><RefreshCw size={14} aria-hidden="true"/>刷新档案</button></div>
      {error&&<p className="history-archives-error" role="alert">{error}</p>}
      {!archive?<div aria-busy={catalogBusy}>{catalogBusy?<p className="history-archives-note" role="status"><Loader2 size={15} className="spin" aria-hidden="true"/>正在读取档案…</p>:!archives.length?(!error&&<p className="history-archives-note">还没有导入的历史档案。</p>):<ul className="history-archives-list">{archives.map(item=><li key={item.id}><button type="button" className="history-archive-choice" onClick={()=>select(item.id)}><span><strong>{item.personName||'历史资料'}</strong><small>{day(item.sourceStart)} — {day(item.sourceEnd)} · {count(item.messageCount)} 条原消息</small></span><span>查看原文 <ChevronDown size={14} aria-hidden="true"/></span></button>{item.memory&&<p className="history-archive-progress" data-state={item.memory.state}><span>{memoryState(item.memory.state)}</span><span>本人记忆材料已同步 {count(item.memory.acked)} / {count(item.memory.total)}</span></p>}</li>)}</ul>}</div>:<>
        <div className="history-archive-title"><button type="button" className="text-button" onClick={()=>select('')}><ArrowLeft size={15} aria-hidden="true"/>全部档案</button><h4>{archive.personName||'历史资料'}</h4><p>{day(archive.sourceStart)} — {day(archive.sourceEnd)} · 原聊天时间（北京时间）</p></div>
        <form className="history-archive-filters" aria-label="筛选历史消息" onSubmit={apply}>
          <label className="history-archive-search">搜索原文<input aria-label="搜索历史原文" type="search" maxLength={160} value={draft.q} onChange={event=>setDraft(value=>({...value,q:event.target.value}))} placeholder="输入记得的词句"/></label>
          <label>从<input aria-label="历史起始日期" type="date" value={draft.from} max={draft.to||undefined} onChange={event=>setDraft(value=>({...value,from:event.target.value}))}/></label>
          <label>至<input aria-label="历史结束日期" type="date" value={draft.to} min={draft.from||undefined} onChange={event=>setDraft(value=>({...value,to:event.target.value}))}/></label>
          <label>说话人<select aria-label="历史说话人" value={draft.speaker} onChange={event=>setDraft(value=>({...value,speaker:event.target.value}))}><option value="">全部</option><option value="self">本人</option><option value="other">对方</option><option value="system">系统记录</option></select></label>
          <button className="secondary-button" disabled={pageBusy}><Search size={15} aria-hidden="true"/>筛选</button>
          {(filters.q||filters.from||filters.to||filters.speaker)&&<button type="button" className="text-button" disabled={pageBusy} onClick={()=>{setDraft(emptyFilters());setFilters(emptyFilters());setError('');}}>清除筛选</button>}
        </form>
        <div className="history-archive-messages" aria-label="历史消息" aria-busy={pageBusy}>
          {currentPage&&<p className="history-archives-note">找到 {count(currentPage.total)} 条，已显示 {count(currentPage.messages.length)} 条</p>}
          {currentPage?.messages.map(message=>{const long=message.text.length>480||message.text.split('\n').length>7,isExpanded=expanded.has(message.id);return <article className={`history-archive-message history-speaker-${message.speaker}`} key={message.id}>
            <header><strong>{message.speaker==='self'?'本人':message.speaker==='other'?'对方':'系统记录'}{message.speakerName?` · ${message.speakerName}`:''}</strong><time dateTime={message.occurredAt} title={message.occurredAt}>{originalTime(message.occurredAt)}</time></header>
            <div className={`history-archive-original${long&&!isExpanded?' is-collapsed':''}`}>{message.text||'（原消息没有可显示的文字）'}</div>
            {long&&<button type="button" className="text-button" aria-label={`${isExpanded?'收起':'展开'}原文 ${message.id}`} aria-expanded={isExpanded} onClick={()=>toggle(message.id)}>{isExpanded?'收起全文':'展开全文'}{isExpanded?<ChevronUp size={13} aria-hidden="true"/>:<ChevronDown size={13} aria-hidden="true"/>}</button>}
            {message.attachmentCount>0&&<p className="history-archive-attachment">附件引用 {count(message.attachmentCount)} · {message.kind||'媒体消息'}，原媒体未在此打开</p>}
          </article>;})}
          {pageBusy&&<p className="history-archives-note" role="status"><Loader2 size={15} className="spin" aria-hidden="true"/>正在读取原文…</p>}
          {currentPage&&!pageBusy&&!currentPage.messages.length&&<p className="history-archives-note">这个范围内没有消息，可换个词句或日期。</p>}
          {currentPage?.nextCursor!==null&&currentPage&&<button type="button" className="secondary-button history-archive-more" disabled={pageBusy} onClick={()=>void more()}>加载更多原消息<ChevronDown size={15} aria-hidden="true"/></button>}
        </div>
      </>}
    </div>}
  </section>;
}
