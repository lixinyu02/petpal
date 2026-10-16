import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {Cloud,Loader2,Plus,RefreshCw,Upload} from 'lucide-react';
import {api,getIdentity,getSessionEpoch,subscribeSession,type ManagedUser,type User} from './api';
import {createServerProxyProfile,deleteServerProxyProfile,listAdminProxyProfiles,updateServerProxyProfile,type ServerProxyAdminProfile} from './platform/server-proxy-profiles';
import './app-proxy.css';

type Mode='rule'|'global'|'direct';
type Edit={id?:string;revision?:string;name:string;yaml:string;mode:Mode;selections:Record<string,string>;userIds:string[];groups:ServerProxyAdminProfile['groups']};
const modes={rule:'规则',global:'全局',direct:'直连'};
const MAX_BYTES=4*1024*1024;

export default function ServerProxyProfilesSettings({connected,user}:{connected:boolean;user?:User}){
  const id=useId(),[open,setOpen]=useState(false),[profiles,setProfiles]=useState<ServerProxyAdminProfile[]>([]),[users,setUsers]=useState<ManagedUser[]>([]);
  const [editing,setEditing]=useState<Edit|null>(null),[removing,setRemoving]=useState<ServerProxyAdminProfile|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[session,setSession]=useState(0);
  const life=useRef(0),operation=useRef(false),editGeneration=useRef(0);
  const epoch=getSessionEpoch(),identity=getIdentity(),allowed=connected&&!!(user?.isAdmin||user?.isOwner)&&identity?.userId===user?.id;
  const liveScope=()=>allowed&&epoch===getSessionEpoch()&&identity?.instanceId===getIdentity()?.instanceId&&identity?.userId===getIdentity()?.userId;
  useEffect(()=>subscribeSession(()=>setSession(value=>value+1)),[]);
  const current=(generation:number,captured:number)=>liveScope()&&generation===life.current&&captured===getSessionEpoch();
  async function load(generation=life.current,captured=getSessionEpoch()){
    if(!liveScope()||captured!==epoch)return;
    const [catalog,accounts]=await Promise.all([listAdminProxyProfiles(),api<{users:ManagedUser[]}>('/admin/users')]);
    if(current(generation,captured)){setProfiles(catalog.profiles);setUsers(accounts.users);}
  }
  useEffect(()=>{
    const generation=++life.current,captured=getSessionEpoch();editGeneration.current++;operation.current=false;
    setProfiles([]);setUsers([]);setEditing(null);setRemoving(null);setError('');setNotice('');setBusy(false);
    if(open&&allowed){setBusy(true);void load(generation,captured).catch(failure=>{if(current(generation,captured))setError(failure?.status===404?'服务器尚未提供代理配置管理，请更新后端。':'无法读取服务器配置，请刷新重试。');}).finally(()=>{if(current(generation,captured))setBusy(false);});}
    return()=>{life.current++;editGeneration.current++;};
  },[open,allowed,user?.id,epoch,session]);
  async function perform(work:()=>Promise<unknown>,message:string){
    if(!liveScope()||operation.current||busy)return;
    const generation=life.current,captured=getSessionEpoch();operation.current=true;setBusy(true);setError('');setNotice('');
    try{await work();if(!current(generation,captured))return;editGeneration.current++;setEditing(null);setRemoving(null);await load(generation,captured);if(current(generation,captured))setNotice(message);}
    catch(failure){if(current(generation,captured))setError((failure as {status?:number})?.status===409?'配置已被修改，请刷新后重试。':'操作未完成，请检查配置和账号分配后重试。');}
    finally{if(current(generation,captured)){operation.current=false;setBusy(false);}}
  }
  function edit(profile?:ServerProxyAdminProfile){
    if(!liveScope()||operation.current||busy)return;
    editGeneration.current++;setError('');setNotice('');setRemoving(null);
    setEditing(profile?{id:profile.id,revision:profile.revision,name:profile.name,yaml:'',mode:profile.mode,selections:{...profile.selections},userIds:[...profile.userIds],groups:profile.groups}:{name:'',yaml:'',mode:'rule',selections:{},userIds:user?[user.id]:[],groups:[]});
  }
  async function chooseFile(file?:File){
    if(!file||!editing||!liveScope()||operation.current||busy)return;const generation=life.current,captured=getSessionEpoch(),form=++editGeneration.current;
    if(file.size>MAX_BYTES){setError('配置文件不能超过 4 MB。');return;}
    try{const yaml=await file.text();if(!current(generation,captured)||form!==editGeneration.current)return;if(new TextEncoder().encode(yaml).length>MAX_BYTES)throw new Error();setEditing(value=>value?{...value,yaml}:null);setError('');}
    catch{if(current(generation,captured)&&form===editGeneration.current)setError('无法读取配置文件，请选择 UTF-8 YAML 文件。');}
  }
  function save(event:FormEvent){
    event.preventDefault();if(!editing||!liveScope()||operation.current||busy)return;const value=editing;
    if(!value.name.trim()||(!value.id&&!value.yaml.trim())){setError('请填写名称并导入配置文件。');return;}
    if(new TextEncoder().encode(value.yaml).length>MAX_BYTES){setError('配置文件不能超过 4 MB。');return;}
    const input={name:value.name.trim(),mode:value.mode,selections:value.selections,userIds:value.userIds,...(value.yaml.trim()?{yaml:value.yaml}:{})};
    editGeneration.current++;setEditing(previous=>previous?{...previous,yaml:''}:null);
    void perform(()=>value.id?updateServerProxyProfile(value.id,{...input,revision:value.revision!}):createServerProxyProfile({...input,yaml:value.yaml}),'配置已保存，分配的账号可以在安卓端选择使用。');
  }
  if(!allowed)return null;
  return <details className="app-proxy-settings server-proxy-settings" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary className="app-proxy-heading"><span className="app-proxy-title"><span className="app-proxy-symbol"><Cloud size={20} aria-hidden="true"/></span><span><h3>服务器代理配置</h3><p>管理配置文件、默认策略和可使用的账号</p></span></span></summary>
    {open&&<div className="server-proxy-content">
      <div className="app-proxy-actions"><button className="primary-button" disabled={busy} onClick={()=>edit()}><Plus size={15}/>添加配置</button><button className="icon-button app-proxy-refresh" aria-label="刷新服务器代理配置" disabled={busy||!!editing} onClick={()=>void perform(()=>Promise.resolve(),'配置列表已刷新。')}><RefreshCw size={15} className={busy?'spin':''}/></button></div>
      {!busy&&!profiles.length&&<p className="app-proxy-note">尚未添加配置。导入后分配给需要使用的账号。</p>}
      <div className="server-proxy-list">{profiles.map(profile=><div className="server-proxy-row" key={profile.id}><div><strong>{profile.name}</strong><span>{profile.userIds.length} 个账号 · 默认{modes[profile.mode]}模式</span></div><div className="server-proxy-row-actions"><button className="secondary-button" disabled={busy} onClick={()=>edit(profile)}>编辑</button><button className="secondary-button" disabled={busy} onClick={()=>{editGeneration.current++;setEditing(null);setRemoving(profile);}}>删除</button></div></div>)}</div>
      {removing&&<div className="server-proxy-delete" role="group" aria-label="确认删除服务器配置"><p>删除“{removing.name}”并撤销账号访问？</p><div className="app-proxy-actions"><button className="secondary-button" disabled={busy} onClick={()=>setRemoving(null)}>取消</button><button className="primary-button" disabled={busy} onClick={()=>void perform(()=>deleteServerProxyProfile(removing.id,removing.revision),'配置已删除。')}>删除并撤销</button></div></div>}
      {editing&&<form className="server-proxy-editor" onSubmit={save} aria-label={editing.id?'编辑服务器代理配置':'添加服务器代理配置'}>
        <label>配置名称<input required maxLength={80} value={editing.name} disabled={busy} onChange={event=>setEditing({...editing,name:event.target.value})}/></label>
        <div className="server-proxy-file"><label className="secondary-button"><Upload size={15}/>选择 YAML 文件<input type="file" accept=".yaml,.yml,text/plain,application/yaml" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void chooseFile(file);}}/></label><span>{editing.id?'不替换文件时保留原配置':'最多 4 MB'}</span></div>
        <label htmlFor={`${id}-yaml`}>{editing.id?'替换配置（可留空）':'Clash YAML'}<textarea id={`${id}-yaml`} autoComplete="off" spellCheck={false} maxLength={MAX_BYTES} value={editing.yaml} disabled={busy} onChange={event=>{if(!liveScope())return;editGeneration.current++;setEditing({...editing,yaml:event.target.value});}}/></label>
        <label>默认模式<select value={editing.mode} disabled={busy} onChange={event=>setEditing({...editing,mode:event.target.value as Mode})}>{Object.entries(modes).map(([mode,label])=><option key={mode} value={mode}>{label}</option>)}</select></label>
        {editing.groups.length>0&&<fieldset className="server-proxy-defaults"><legend>默认节点与策略组</legend>{editing.groups.map((group,index)=><label className="app-proxy-group" key={group.name} htmlFor={`${id}-policy-${index}`}><span>{group.name}</span>{group.dynamic?<span><input id={`${id}-policy-${index}`} list={`${id}-choices-${index}`} maxLength={160} value={editing.selections[group.name]||''} placeholder="订阅节点名称（可留空）" disabled={busy} onChange={event=>{const selections={...editing.selections};if(event.target.value)selections[group.name]=event.target.value;else delete selections[group.name];setEditing({...editing,selections});}}/><datalist id={`${id}-choices-${index}`}>{group.choices.map(choice=><option key={choice} value={choice}/>)}</datalist></span>:<select id={`${id}-policy-${index}`} value={editing.selections[group.name]||''} disabled={busy} onChange={event=>{const selections={...editing.selections};if(event.target.value)selections[group.name]=event.target.value;else delete selections[group.name];setEditing({...editing,selections});}}><option value="">沿用配置默认值</option>{editing.selections[group.name]&&!group.choices.includes(editing.selections[group.name])&&<option value={editing.selections[group.name]}>{editing.selections[group.name]}</option>}{group.choices.map(choice=><option key={choice}>{choice}</option>)}</select>}</label>)}</fieldset>}
        <fieldset className="server-proxy-users"><legend>可使用的账号</legend>{users.map(account=><label key={account.id}><input type="checkbox" checked={editing.userIds.includes(account.id)} disabled={busy} onChange={event=>setEditing({...editing,userIds:event.target.checked?[...editing.userIds,account.id]:editing.userIds.filter(value=>value!==account.id)})}/><span>{account.displayName} <small>@{account.username}{account.disabled?' · 已停用':''}</small></span></label>)}</fieldset>
        <div className="app-proxy-actions"><button type="submit" className="primary-button" disabled={busy}>{busy&&<Loader2 size={15} className="spin"/>}保存配置</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>{editGeneration.current++;setEditing(null);}}>取消</button></div>
      </form>}
      {error&&<p role="alert" className="app-proxy-note app-proxy-error">{error}</p>}{notice&&<p role="status" className="app-proxy-note">{notice}</p>}
    </div>}
  </details>;
}
