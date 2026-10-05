import {memo,useCallback,useEffect,useId,useLayoutEffect,useRef,useState,type FormEvent} from 'react';
import {createPortal} from 'react-dom';
import {Archive,ArchiveRestore,Check,ChevronLeft,Folder,FolderInput,Loader2,MessageCircle,MoreHorizontal,Pencil,Plus,Settings2,Terminal,Trash2,X} from 'lucide-react';
import {getSessionEpoch,isSessionChanged,type Conversation,type ConversationProject} from './api';
import {useUiEntrance} from './platform/ui-motion.ts';
import './conversation-history.css';

type HistoryItem=Pick<Conversation,'id'|'title'|'mode'|'projectId'|'archivedAt'|'backgroundParentId'>;
export type ConversationOrganizationPatch={title?:string;projectId?:string|null;archived?:boolean};
export type ConversationHistoryProps={
  conversations:HistoryItem[];projects:ConversationProject[];selectedId:string|null;active:boolean;busy:boolean;
  projectFilter:string;archived:boolean;onFilter(projectFilter:string,archived:boolean):void;
  onSelect(id:string):void;onDelete(id:string):void;
  onOrganize(id:string,patch:ConversationOrganizationPatch):Promise<void>;
  onCreateProject(name:string):Promise<void>;onRenameProject(id:string,name:string):Promise<void>;onDeleteProject(id:string):Promise<void>;
};
type Dialog={kind:'conversation'|'rename'|'move';id:string}|{kind:'projects'|'create-project'}|{kind:'rename-project'|'delete-project';id:string};

export function filterHistoryConversations(conversations:HistoryItem[],projectFilter:string,archived:boolean) {
  return conversations.filter(item=>!item.backgroundParentId&&!!item.archivedAt===archived&&(projectFilter==='all'||(projectFilter==='unassigned'?!item.projectId:item.projectId===projectFilter)));
}

export function historyProjectCounts(conversations:HistoryItem[],projects:ConversationProject[],archived:boolean) {
  const result:Record<string,number>={all:0,unassigned:0};for(const project of projects)result[project.id]=0;
  for(const item of conversations){if(item.backgroundParentId||!!item.archivedAt!==archived)continue;result.all++;result[item.projectId||'unassigned']=(result[item.projectId||'unassigned']||0)+1;}
  return result;
}

export const ConversationHistoryRow=memo(function ConversationHistoryRow({id,title,mode,selected,onSelect,onMore}:Pick<HistoryItem,'id'|'title'|'mode'>&{selected:boolean;onSelect(id:string):void;onMore(id:string):void}) {
  return <div className={`history-row${selected?' selected':''}`}>
    <button type="button" className="history-item" title={title} aria-current={selected?'page':undefined} onClick={()=>onSelect(id)}>{mode==='codex'?<Terminal size={15} aria-hidden="true"/>:<MessageCircle size={15} aria-hidden="true"/>}<span>{title||'新对话'}</span></button>
    <button type="button" className="history-more icon-button" aria-label={`对话 ${title||'新对话'} 的更多操作`} aria-haspopup="dialog" onClick={()=>onMore(id)}><MoreHorizontal size={16} aria-hidden="true"/></button>
  </div>;
});

/** Message content, timestamps and Agent receipts do not change the navigation labels. */
export function sameConversationHistory(before:ConversationHistoryProps,after:ConversationHistoryProps) {
  return before.selectedId===after.selectedId&&before.active===after.active&&before.busy===after.busy&&before.projectFilter===after.projectFilter&&before.archived===after.archived
    &&before.onFilter===after.onFilter&&before.onSelect===after.onSelect&&before.onDelete===after.onDelete&&before.onOrganize===after.onOrganize&&before.onCreateProject===after.onCreateProject&&before.onRenameProject===after.onRenameProject&&before.onDeleteProject===after.onDeleteProject
    &&(before.projects===after.projects||before.projects.length===after.projects.length&&before.projects.every((item,index)=>item.id===after.projects[index].id&&item.name===after.projects[index].name))
    &&(before.conversations===after.conversations||before.conversations.length===after.conversations.length&&before.conversations.every((item,index)=>{
      const next=after.conversations[index];return item.id===next.id&&item.title===next.title&&item.mode===next.mode&&(item.projectId||null)===(next.projectId||null)&&(item.archivedAt||null)===(next.archivedAt||null)&&(item.backgroundParentId||null)===(next.backgroundParentId||null);
    }));
}

export default memo(function ConversationHistory({conversations,projects,selectedId,active,busy,projectFilter,archived,onFilter,onSelect,onDelete,onOrganize,onCreateProject,onRenameProject,onDeleteProject}:ConversationHistoryProps) {
  const id=useId(),[dialog,setDialog]=useState<Dialog|null>(null),[value,setValue]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  const sequence=useRef(0),mounted=useRef(false),pendingRef=useRef(false);
  const projectSelector=useRef<HTMLSelectElement>(null),currentTab=useRef<HTMLButtonElement>(null),archiveTab=useRef<HTMLButtonElement>(null),wasDialogOpen=useRef(false);
  const layer=useUiEntrance<HTMLDivElement>(dialog?`${id}-${dialog.kind}`:'',!!dialog);
  const close=useCallback((force=false)=>{if(pendingRef.current&&!force)return;sequence.current++;pendingRef.current=false;setDialog(null);setPending(false);setError('');},[]);
  const open=useCallback((next:Dialog,text='')=>{if(pendingRef.current)return;sequence.current++;setValue(text);setError('');setPending(false);setDialog(next);},[]);
  const more=useCallback((conversationId:string)=>open({kind:'conversation',id:conversationId}),[open]);
  useEffect(()=>{const dispose=()=>close(true);mounted.current=true;window.addEventListener('petpal:session-change',dispose);return()=>{mounted.current=false;sequence.current++;pendingRef.current=false;window.removeEventListener('petpal:session-change',dispose);};},[close]);
  useLayoutEffect(()=>{
    const previouslyOpen=wasDialogOpen.current;wasDialogOpen.current=!!dialog;
    if(dialog||!previouslyOpen)return;
    // Shared layer teardown restores an existing row trigger first. An archive
    // or move can remove that trigger; recover only the otherwise lost focus.
    const frame=requestAnimationFrame(()=>{
      if(!mounted.current||document.querySelector('.history-dialog-layer,[data-ui-layer="dialog"]'))return;
      const focused=document.activeElement;
      if(focused&&focused!==document.body&&focused!==document.documentElement)return;
      const tab=archived?archiveTab.current:currentTab.current;
      (tab?.isConnected?tab:projectSelector.current)?.focus({preventScroll:true});
    });
    return()=>cancelAnimationFrame(frame);
  },[!!dialog,archived]);
  const conversation=dialog&&'id'in dialog?conversations.find(item=>item.id===dialog.id):undefined;
  const project=dialog&&'id'in dialog?projects.find(item=>item.id===dialog.id):undefined;
  useEffect(()=>{
    if(dialog&&(['conversation','rename','move'].includes(dialog.kind)&&!conversation||['rename-project','delete-project'].includes(dialog.kind)&&!project))close(true);
  },[dialog,conversation,project,close]);
  const run=async(operation:()=>Promise<void>,after?:()=>void)=>{
    if(pendingRef.current)return;
    pendingRef.current=true;
    const ticket=++sequence.current,epoch=getSessionEpoch();setPending(true);setError('');
    try{await operation();if(mounted.current&&ticket===sequence.current&&epoch===getSessionEpoch()){after?.();pendingRef.current=false;close();}}
    catch(cause){if(mounted.current&&ticket===sequence.current&&epoch===getSessionEpoch()&&!isSessionChanged(cause))setError((cause as Error).message||'未能保存，请重试。');}
    finally{if(mounted.current&&ticket===sequence.current){pendingRef.current=false;setPending(false);}}
  };
  const save=(event:FormEvent)=>{
    event.preventDefault();if(!dialog||pending)return;
    if(dialog.kind==='move'&&conversation){void run(()=>onOrganize(conversation.id,{projectId:value||null}));return;}
    const name=value.trim();if(!name){setError(dialog.kind==='rename'?'请输入对话名称。':'请输入项目名称。');return;}
    if(dialog.kind==='rename'&&conversation)void run(()=>onOrganize(conversation.id,{title:name}));
    else if(dialog.kind==='create-project')void run(()=>onCreateProject(name));
    else if(dialog.kind==='rename-project'&&project)void run(()=>onRenameProject(project.id,name));
  };
  const counts=historyProjectCounts(conversations,projects,archived),items=filterHistoryConversations(conversations,projectFilter,archived);
  const currentCount=filterHistoryConversations(conversations,projectFilter,false).length,archiveCount=filterHistoryConversations(conversations,projectFilter,true).length;
  const title=dialog?.kind==='conversation'?'对话操作':dialog?.kind==='rename'?'重命名对话':dialog?.kind==='move'?'移动到项目':dialog?.kind==='projects'?'管理项目':dialog?.kind==='create-project'?'新建项目':dialog?.kind==='rename-project'?'重命名项目':'删除项目？';
  const isForm=dialog&&['rename','move','create-project','rename-project'].includes(dialog.kind);
  return <div className="conversation-history">
    <div className="history-project-control"><Folder size={14} aria-hidden="true"/><select ref={projectSelector} aria-label="筛选对话项目" value={projectFilter} onChange={event=>onFilter(event.target.value,archived)}>
      <option value="all">全部对话 · {counts.all}</option><option value="unassigned">未分类 · {counts.unassigned}</option>{projects.map(item=><option key={item.id} value={item.id}>{item.name} · {counts[item.id]||0}</option>)}
    </select><button type="button" className="history-project-button" aria-label="新建项目" aria-haspopup="dialog" disabled={projects.length>=50} title={projects.length>=50?'最多创建 50 个项目':'新建项目'} onClick={()=>open({kind:'create-project'})}><Plus size={16} aria-hidden="true"/></button><button type="button" className="history-project-button" aria-label="管理项目" aria-haspopup="dialog" onClick={()=>open({kind:'projects'})}><Settings2 size={14} aria-hidden="true"/></button></div>
    <div className="history-tabs" role="group" aria-label="对话状态"><button ref={currentTab} type="button" aria-pressed={!archived} onClick={()=>onFilter(projectFilter,false)}>当前<span>{currentCount}</span></button><button ref={archiveTab} type="button" aria-pressed={archived} onClick={()=>onFilter(projectFilter,true)}><Archive size={12} aria-hidden="true"/>归档<span>{archiveCount}</span></button></div>
    <div className="history-list" aria-label={archived?'已归档对话':'当前对话'}>{items.length===0?<p className="history-empty">{archived?'这里还没有归档的对话。':projectFilter==='all'?'我们的故事，从一句你好开始。':'这个分类还没有对话。'}</p>:items.map(item=><ConversationHistoryRow key={item.id} id={item.id} title={item.title} mode={item.mode} selected={active&&selectedId===item.id} onSelect={onSelect} onMore={more}/>)}</div>
    {dialog&&typeof document!=='undefined'&&createPortal(<div ref={layer} className="modal-backdrop history-dialog-layer" data-ui-layer="dialog" onClick={event=>{if(event.target===event.currentTarget)close();}}><section className="modal history-dialog" role={dialog.kind==='delete-project'?'alertdialog':'dialog'} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={dialog.kind==='delete-project'?`${id}-description`:undefined} aria-busy={pending||undefined}>
      <div className="modal-heading"><h2 id={`${id}-title`}>{title}</h2><button type="button" className="history-dialog-close" data-ui-dismiss="dialog" aria-label="关闭对话整理窗口" disabled={pending} onClick={()=>close()}><X size={19} aria-hidden="true"/></button></div>
      {dialog.kind==='conversation'&&conversation&&<><p className="history-dialog-context" title={conversation.title}>{conversation.title}</p><div className="history-action-list">
        <button type="button" disabled={pending} onClick={()=>open({kind:'rename',id:conversation.id},conversation.title)}><Pencil size={16} aria-hidden="true"/>重命名</button>
        <button type="button" disabled={pending} onClick={()=>open({kind:'move',id:conversation.id},conversation.projectId||'')}><FolderInput size={16} aria-hidden="true"/>移动到项目<span>{projects.find(item=>item.id===conversation.projectId)?.name||'未分类'}</span></button>
        <button type="button" disabled={pending} onClick={()=>void run(()=>onOrganize(conversation.id,{archived:!conversation.archivedAt}))}>{pending?<Loader2 size={16} className="spin" aria-hidden="true"/>:conversation.archivedAt?<ArchiveRestore size={16} aria-hidden="true"/>:<Archive size={16} aria-hidden="true"/>}{conversation.archivedAt?'恢复对话':'归档对话'}</button>
        <button type="button" className="history-action-danger" disabled={busy||pending} onClick={()=>{close();onDelete(conversation.id);}}><Trash2 size={16} aria-hidden="true"/>删除对话</button>
      </div></>}
      {dialog.kind==='projects'&&<><p className="history-dialog-help">用项目整理对话，执行电脑和工作目录照常设置。</p><div className="history-project-list">{projects.length===0?<p className="history-dialog-help">还没有项目，创建一个开始整理。</p>:projects.map(item=><div key={item.id}><Folder size={15} aria-hidden="true"/><span title={item.name}>{item.name}</span><button type="button" aria-label={`重命名项目 ${item.name}`} onClick={()=>open({kind:'rename-project',id:item.id},item.name)}><Pencil size={15} aria-hidden="true"/></button><button type="button" className="history-action-danger" aria-label={`删除项目 ${item.name}`} onClick={()=>open({kind:'delete-project',id:item.id})}><Trash2 size={15} aria-hidden="true"/></button></div>)}</div><button type="button" className="secondary-button history-new-project" disabled={projects.length>=50} onClick={()=>open({kind:'create-project'})}><Plus size={15} aria-hidden="true"/>新建项目</button></>}
      {isForm&&<form onSubmit={save}><label htmlFor={`${id}-input`}>{dialog.kind==='move'?'所属项目':dialog.kind==='rename'?'对话名称':'项目名称'}</label>{dialog.kind==='move'?<select autoFocus id={`${id}-input`} value={value} disabled={pending} onChange={event=>setValue(event.target.value)}><option value="">未分类</option>{projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>:<input autoFocus id={`${id}-input`} required maxLength={dialog.kind==='rename'?100:60} value={value} disabled={pending} onChange={event=>setValue(event.target.value)} autoComplete="off"/>}<div className="button-row history-dialog-footer"><button type="button" className="secondary-button" disabled={pending} onClick={()=>dialog.kind==='rename-project'?open({kind:'projects'}):dialog.kind==='create-project'?close():'id'in dialog&&open({kind:'conversation',id:dialog.id})}><ChevronLeft size={14} aria-hidden="true"/>返回</button><button type="submit" className="primary-button" disabled={pending||dialog.kind!=='move'&&!value.trim()}>{pending?<Loader2 size={15} className="spin" aria-hidden="true"/>:<Check size={15} aria-hidden="true"/>}{pending?'正在保存…':'保存'}</button></div></form>}
      {dialog.kind==='delete-project'&&project&&<><p id={`${id}-description`} className="history-dialog-help">删除“{project.name}”后，对话将移到未分类。聊天记录和归档状态都会保留。</p><div className="button-row history-dialog-footer"><button type="button" className="secondary-button" disabled={pending} onClick={()=>open({kind:'projects'})}>保留项目</button><button type="button" className="danger-button" disabled={pending} onClick={()=>void run(()=>onDeleteProject(project.id),()=>{if(projectFilter===project.id)onFilter('unassigned',archived);})}>{pending?<Loader2 size={15} className="spin" aria-hidden="true"/>:<Trash2 size={15} aria-hidden="true"/>}{pending?'正在删除…':'删除项目'}</button></div></>}
      {error&&<p className="form-error" role="alert">{error}</p>}
    </section></div>,document.body)}
  </div>;
},sameConversationHistory);
