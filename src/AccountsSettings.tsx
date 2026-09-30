import { useEffect, useState, type FormEvent } from 'react';
import { Check, Loader2, LogOut, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { api, logout, isSessionChanged, type AgentAccess, type ManagedUser, type Provider, type User } from './api';
import './accounts.css';
import TaskNotificationsSettings from './TaskNotificationsSettings';

type Edit = {id?:string;username:string;displayName:string;password:string;providerIds:string[];disabled:boolean;isOwner:boolean;agentAccess:AgentAccess};
export default function AccountsSettings({connected,user,providers,connect}:{connected:boolean;user?:User;providers:Provider[];connect():void}){
  const[users,setUsers]=useState<ManagedUser[]>([]),[editing,setEditing]=useState<Edit|null>(null);
  const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const admin=!!user?.isOwner;
  async function load(signal?:AbortSignal){const result=await api<{users:ManagedUser[]}>('/admin/users',{signal});setUsers(result.users);}
  useEffect(()=>{if(!connected||!admin)return;const controller=new AbortController();void load(controller.signal).catch(e=>{if(!controller.signal.aborted&&!isSessionChanged(e))setError(e.message);});return()=>controller.abort();},[connected,admin]);
  async function save(event:FormEvent){
    event.preventDefault();if(!editing)return;setBusy(true);setError('');setNotice('');
    const body={displayName:editing.displayName,...(!editing.id?{username:editing.username}:{}),...(editing.password?{password:editing.password}:{}),...(!editing.isOwner?{providerIds:editing.providerIds,disabled:editing.disabled,agentAccess:editing.agentAccess}:{})};
    try{await api(`/admin/users${editing.id?`/${encodeURIComponent(editing.id)}`:''}`,{method:editing.id?'PATCH':'POST',body:JSON.stringify(body)});setEditing(null);await load();setNotice('账号设置已保存。密码重置或停用会结束该账号的现有登录。');}
    catch(e){if(!isSessionChanged(e))setError((e as Error).message);}finally{setBusy(false);}
  }
  return<div className="settings-section accounts-settings">
    <div className="section-title"><div><h2>我的账号</h2><p>聊天记录、伙伴偏好和语音资料分别保存在各自账号中。</p></div><UserRound size={24}/></div>
    <div className="account-identity"><div><strong>{user?.displayName||'尚未登录'}</strong><span>{user?`@${user.username} · ${user.isOwner?'主机管理员':'成员'}`:'由管理员提供账号和密码'}</span></div><div className="button-row"><button className="secondary-button" onClick={connect}>{connected?'切换账号':'登录账号'}</button>{connected&&<button className="secondary-button" onClick={logout}><LogOut size={15}/>退出登录</button>}</div></div>
    <TaskNotificationsSettings connected={connected}/>
    {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="field-help" role="status">{notice}</p>}
    {connected&&admin&&<><div className="section-title account-management-title"><div><h2>成员与模型授权</h2><p>按账号分配模型与 Agent 执行范围；新账号默认只有 Chat。</p></div><button className="primary-button" onClick={()=>{setError('');setEditing({username:'',displayName:'',password:'',providerIds:[],disabled:false,isOwner:false,agentAccess:'none'});}}><Plus size={16}/>创建账号</button></div><div className="account-list">{users.map(item=><div className="account-row" key={item.id}><div><strong>{item.displayName}</strong><span>@{item.username} · {item.isOwner?'主机管理员':item.disabled?'已停用':'成员'}</span><small>{item.isOwner?'全部模型 · 可使用主机 Codex':`已分配 ${item.providerIds.length} 个模型 · ${item.canUseCodex ? (item.agentAccess === 'full' ? 'Agent 完整访问' : 'Agent 工作区') : 'Chat'}`}{item.hasPassword?'':' · 尚未设置登录密码'}</small></div><button className="secondary-button" onClick={()=>{setError('');setEditing({id:item.id,username:item.username,displayName:item.displayName,password:'',providerIds:[...item.providerIds],disabled:item.disabled,isOwner:item.isOwner,agentAccess:item.agentAccess || 'none'});}}>管理账号</button></div>)}</div></>}
    {connected&&!admin&&<div className="info-note"><ShieldCheck size={18}/><p>模型授权、密码重置和账号停用由主机管理员管理。你可以独立调整伙伴、默认模型和语音设置。</p></div>}
    {editing&&<div className="modal-backdrop"><section className="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"><div className="modal-heading"><h2 id="account-dialog-title">{editing.id?'管理账号':'创建成员账号'}</h2><button className="secondary-button" onClick={()=>setEditing(null)} disabled={busy}>关闭</button></div><form onSubmit={save}>
      <label>账号名称<input value={editing.username} disabled={!!editing.id} onChange={e=>setEditing({...editing,username:e.target.value.toLowerCase()})} minLength={3} maxLength={40} pattern="[a-z0-9][a-z0-9_.-]{2,39}" required autoComplete="off"/></label>
      <label>显示名称<input value={editing.displayName} onChange={e=>setEditing({...editing,displayName:e.target.value})} maxLength={64} required/></label>
      <label>{editing.id?'设置新密码（留空保留）':'登录密码'}<input type="password" value={editing.password} onChange={e=>setEditing({...editing,password:e.target.value})} minLength={8} maxLength={256} required={!editing.id} autoComplete="new-password"/></label>
      {!editing.isOwner&&<><label>Agent 执行权限<select aria-label="账号 Agent 权限" value={editing.agentAccess} onChange={e=>setEditing({...editing,agentAccess:e.target.value as AgentAccess})}><option value="none">仅 Chat</option><option value="workspace">Agent · 工作区访问</option><option value="full">Agent · 允许完整访问</option></select></label><p className="field-help">Agent 操作的是服务主机。完整访问可读写主机文件和运行程序，撤销授权会停止该账号任务。</p><fieldset className="account-grants"><legend>可使用的模型</legend>{providers.length?providers.map(provider=><label key={provider.id}><input type="checkbox" checked={editing.providerIds.includes(provider.id)} onChange={e=>setEditing({...editing,providerIds:e.target.checked?[...editing.providerIds,provider.id]:editing.providerIds.filter(id=>id!==provider.id)})}/><span>{provider.name}<small>{provider.model}</small></span></label>):<p className="field-help">还没有模型，请先在“模型连接”中添加。</p>}</fieldset>{editing.id&&<label className="account-disabled"><input type="checkbox" checked={editing.disabled} onChange={e=>setEditing({...editing,disabled:e.target.checked})}/>停用此账号</label>}</>}
      {editing.isOwner&&<p className="field-help">主机管理员不可停用。设置密码后，可从其他设备使用 owner 账号登录。</p>}
      {error&&<p className="form-error" role="alert">{error}</p>}<button className="primary-button full-button" disabled={busy}>{busy?<Loader2 size={16} className="spin"/>:<Check size={16}/>}保存账号</button>
    </form></section></div>}
  </div>;
}
