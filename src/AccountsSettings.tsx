import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Loader2, LogOut, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { api, logout, getSessionEpoch, isSessionChanged, type ManagedUser, type Provider, type User } from './api';
import './accounts.css';

type Edit = {id?:string;username:string;displayName:string;password:string;providerIds:string[];disabled:boolean;isOwner:boolean;role:User['role']};
const isAdmin = (user?: User) => Boolean(user?.isAdmin || user?.isOwner);
const roleLabel = (user: User) => isAdmin(user) ? '管理员' : '用户';

export default function AccountsSettings({connected,user,providers,connect}:{connected:boolean;user?:User;providers:Provider[];connect():void}){
  const[users,setUsers]=useState<ManagedUser[]>([]),[editing,setEditing]=useState<Edit|null>(null);
  const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const admin=isAdmin(user),accountEpoch=getSessionEpoch(),operation=useRef(false);
  async function load(signal?:AbortSignal){
    const epoch=getSessionEpoch(),result=await api<{users:ManagedUser[]}>('/admin/users',{signal});
    if(!signal?.aborted&&epoch===getSessionEpoch())setUsers(result.users);
  }
  useEffect(()=>{
    operation.current=false;setBusy(false);setUsers([]);setEditing(null);setError('');setNotice('');
    if(!connected||!admin)return;
    const controller=new AbortController();
    void load(controller.signal).catch(e=>{if(!controller.signal.aborted&&!isSessionChanged(e))setError(e.message);});
    return()=>controller.abort();
  },[connected,admin,user?.id,accountEpoch]);
  async function save(event:FormEvent){
    event.preventDefault();if(!editing||!connected||!admin||operation.current||accountEpoch!==getSessionEpoch())return;
    const epoch=accountEpoch;operation.current=true;setBusy(true);setError('');setNotice('');
    const body={displayName:editing.displayName,...(!editing.id?{username:editing.username}:{}),...(editing.password?{password:editing.password}:{}),...(!editing.isOwner?{role:editing.role,providerIds:editing.providerIds,disabled:editing.disabled}:{})};
    try{
      await api(`/admin/users${editing.id?`/${encodeURIComponent(editing.id)}`:''}`,{method:editing.id?'PATCH':'POST',body:JSON.stringify(body)});
      if(epoch!==getSessionEpoch())return;
      setEditing(null);await load();
      if(epoch===getSessionEpoch())setNotice('账号设置已保存。密码、身份或停用状态变更后，该账号需要重新登录。');
    }catch(e){if(epoch===getSessionEpoch()&&!isSessionChanged(e))setError((e as Error).message);}
    finally{if(epoch===getSessionEpoch()){operation.current=false;setBusy(false);}}
  }
  function manage(item:ManagedUser){setError('');setEditing({id:item.id,username:item.username,displayName:item.displayName,password:'',providerIds:[...item.providerIds],disabled:item.disabled,isOwner:item.isOwner,role:isAdmin(item)?'admin':'user'});}
  return<div className="settings-section accounts-settings">
    <div className="section-title"><div><h2>我的账号</h2><p>聊天记录、伙伴偏好和语音资料分别保存在各自账号中。</p></div><UserRound size={24}/></div>
    <div className="account-identity"><div><strong>{user?.displayName||'尚未登录'}</strong><span>{user?`@${user.username} · ${roleLabel(user)}`:'由管理员提供账号和密码'}</span></div><div className="button-row"><button className="secondary-button" onClick={connect}>{connected?'切换账号':'登录账号'}</button>{connected&&<button className="secondary-button" onClick={logout}><LogOut size={15}/>退出登录</button>}</div></div>
    {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="field-help" role="status">{notice}</p>}
    {connected&&admin&&<>
      <div className="section-title account-management-title"><div><h2>用户与身份管理</h2><p>用户使用自己登录的电脑；管理员可选择全部设备与中央服务器。</p></div><button className="primary-button" onClick={()=>{setError('');setEditing({username:'',displayName:'',password:'',providerIds:[],disabled:false,isOwner:false,role:'user'});}}><Plus size={16}/>创建账号</button></div>
      <div className="account-list">{users.map(item=><div className="account-row" key={item.id}>
        <div><strong>{item.displayName}</strong><span>@{item.username} · {roleLabel(item)}{item.disabled?' · 已停用':''}</span><small>{isAdmin(item)?'全部模型 · 全部执行设备':`已分配 ${item.providerIds.length} 个模型 · 自己的电脑`}{item.hasPassword?'':' · 尚未设置登录密码'}</small></div>
        <button className="secondary-button" aria-label={`管理账号 ${item.username}`} onClick={()=>manage(item)}>管理账号</button>
      </div>)}</div>
    </>}
    {connected&&!admin&&<div className="info-note"><ShieldCheck size={18}/><p>你可以使用自己登录的电脑。模型、身份与密码由管理员管理。</p></div>}
    {editing&&<div className="modal-backdrop" data-ui-layer="dialog"><section className="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
      <div className="modal-heading"><h2 id="account-dialog-title">{editing.id?'管理账号':'创建账号'}</h2><button className="secondary-button" data-ui-dismiss="dialog" onClick={()=>setEditing(null)} disabled={busy}>关闭</button></div>
      <form onSubmit={save}>
        <label>账号名称<input aria-label="账号名称" value={editing.username} disabled={!!editing.id} onChange={e=>setEditing({...editing,username:e.target.value.toLowerCase()})} minLength={2} maxLength={40} pattern="[a-z0-9][a-z0-9_.-]{1,39}" required autoComplete="off"/></label>
        <label>显示名称<input aria-label="显示名称" value={editing.displayName} onChange={e=>setEditing({...editing,displayName:e.target.value})} maxLength={64} required/></label>
        <label>{editing.id?'设置新密码（留空保留）':'登录密码'}<input type="password" aria-label={editing.id?'设置新密码':'登录密码'} value={editing.password} onChange={e=>setEditing({...editing,password:e.target.value})} minLength={8} maxLength={256} required={!editing.id} autoComplete="new-password"/></label>
        <label>账号身份<select aria-label="账号身份" value={editing.role} disabled={editing.isOwner} onChange={e=>{if(!editing.isOwner&&['user','admin'].includes(e.target.value))setEditing({...editing,role:e.target.value as User['role']});}}><option value="user">用户</option><option value="admin">管理员</option></select></label>
        <p className="field-help">{editing.role==='admin'?'管理员可管理账号、模型，并选择全部执行设备。':'用户仅可选择自己登录的电脑。'}</p>
        {!editing.isOwner&&<>
          <fieldset className="account-grants" disabled={editing.role==='admin'}><legend>可使用的模型{editing.role==='admin'?'（管理员可使用全部模型）':''}</legend>{providers.length?providers.map(provider=><label key={provider.id}><input type="checkbox" checked={editing.role==='admin'||editing.providerIds.includes(provider.id)} onChange={e=>{if(editing.role!=='admin')setEditing({...editing,providerIds:e.target.checked?[...editing.providerIds,provider.id]:editing.providerIds.filter(id=>id!==provider.id)});}}/><span>{provider.name}<small>{provider.model}</small></span></label>):<p className="field-help">还没有模型，请先在“模型连接”中添加。</p>}</fieldset>
          {editing.id&&<label className="account-disabled"><input type="checkbox" checked={editing.disabled} onChange={e=>setEditing({...editing,disabled:e.target.checked})}/>停用此账号</label>}
        </>}
        {editing.isOwner&&<p className="field-help">初始主账号始终保留管理员身份，不可停用。</p>}
        {error&&<p className="form-error" role="alert">{error}</p>}<button className="primary-button full-button" disabled={busy}>{busy?<Loader2 size={16} className="spin"/>:<Check size={16}/>}保存账号</button>
      </form>
    </section></div>}
  </div>;
}
