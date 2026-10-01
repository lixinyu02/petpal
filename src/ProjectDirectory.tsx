import {useEffect,useId,useState,type FormEvent} from 'react';
import {Folder,LockKeyhole} from 'lucide-react';
import type {AgentHost,User} from './api';
import WorkspaceDisclosure from './WorkspaceDisclosure';
import {projectDirectoryIssue,readProjectDirectory,saveProjectDirectory} from './project-directory-preferences.mjs';
import './project-directory.css';

function storage(){try{return localStorage;}catch{return undefined;}}
export function useProjectDirectory({scope,hostId,conversationId='',conversationValue}:{scope:string;hostId:string;conversationId?:string;conversationValue?:string}) {
  const key=`${scope}:${hostId}:${conversationId}`;
  const fallback=conversationValue??readProjectDirectory(storage(),scope,hostId);
  const [selection,setSelection]=useState<{key:string;value:string;source?:string}>({key:'',value:''});
  const value=selection.key===key?selection.value:fallback;
  useEffect(()=>{setSelection(previous=>previous.key===key&&previous.source===conversationValue?previous:{key,value:conversationValue??readProjectDirectory(storage(),scope,hostId),source:conversationValue});},[key,conversationValue,scope,hostId]);
  function change(next:string){saveProjectDirectory(storage(),scope,hostId,next);setSelection({key,value:next,source:conversationValue});}
  return {value,change};
}

export default function ProjectDirectory({value,onChange,host,user,disabled=false,lockReason=''}:{value:string;onChange(value:string):void;host?:AgentHost;user?:User;disabled?:boolean;lockReason?:string}) {
  const id=useId(),[draft,setDraft]=useState(value),[error,setError]=useState('');
  useEffect(()=>{setDraft(value);setError('');},[value,host?.id]);
  const capable=host?.codex?.projectDirectory===true;
  const summary=value||'默认工作区',issue=projectDirectoryIssue(value,host);
  function apply(event:FormEvent){
    event.preventDefault();if(disabled||!capable)return;
    const next=draft.trim(),problem=projectDirectoryIssue(next,host);if(problem){setError(problem);return;}
    onChange(next);setError('');
  }
  return <WorkspaceDisclosure className="agent-project-directory" label={`项目目录：${summary}${disabled?'，暂时不能修改':''}`} summary={<><Folder size={15} aria-hidden="true"/><span className="agent-project-summary"><span>项目目录</span><strong title={summary}>{summary}</strong></span>{disabled&&<LockKeyhole size={13} aria-hidden="true"/>}</>}>
    <h3>执行电脑上的项目目录</h3>
    <p className="agent-project-host">{host?.name||'请先选择执行电脑'}{host?.codex?.workspaceRoot&&<span>默认：{host.codex.workspaceRoot}</span>}</p>
    <form onSubmit={apply} className="agent-project-form">
      <label htmlFor={`${id}-path`}>现有目录的绝对路径</label>
      <input id={`${id}-path`} aria-label="Agent 项目目录" value={draft} onChange={event=>{setDraft(event.target.value);setError('');}} placeholder={['win32','windows'].includes(host?.platform||'')?'C:\\Projects\\demo':'/home/me/projects/demo'} disabled={disabled||!capable} maxLength={4096} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}/>
      <div className="agent-project-actions"><button type="button" disabled={disabled||!value&&!draft} onClick={()=>{onChange('');setDraft('');setError('');}}>恢复默认</button><button type="submit" disabled={disabled||!capable||draft.trim()===value}>使用此目录</button></div>
    </form>
    <p>路径属于所选执行电脑。执行前会检查目录是否存在；不会自动创建或改用其他目录。</p>
    {!user?.isOwner&&user?.agentAccess!=='full'&&<p>你的账号只能选择默认工作区内的目录，实际范围由执行电脑校验。</p>}
    {!capable&&<p className="agent-project-note">自定义目录需要支持此功能的新版客户端；默认工作区仍可使用。</p>}
    {disabled&&<p className="agent-project-note">{lockReason||'正在执行、排队或等待提交确认，项目目录已固定。'}</p>}
    {(error||issue)&&<p className="agent-project-error" role="alert">{error||issue}</p>}
  </WorkspaceDisclosure>;
}
