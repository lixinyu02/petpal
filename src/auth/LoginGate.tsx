import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {useUiEntrance} from '../platform/ui-motion.ts';
import { ArrowRight, Link2, Loader2, ShieldCheck, X } from 'lucide-react';
import BrandMark from '../BrandMark';
import { avatarPreview } from '../avatar/preview';
import { api, clearSavedLogin, connectWithToken, getConnection, getLoginPersistenceError, getSessionEpoch, isSessionChanged, login, retrySavedLogin, type Connection } from '../api';
import './login.css';
const needsVaultRetry=()=>Boolean(window.petpalLoginSession&&!getConnection().token&&getLoginPersistenceError().startsWith('无法恢复设备保存的登录'));

export function ConnectionDialog({ close }: { close?(): void }) {
  const [form, setForm] = useState<Connection>({ url: getConnection().url, token: '' });
  const [method, setMethod] = useState<'password'|'token'>('password');
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(getLoginPersistenceError()), [busy, setBusy] = useState(false);
  const alive=useRef(true),locked=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{const changed=()=>setError(getLoginPersistenceError());window.addEventListener('petpal:login-persistence-error',changed);changed();return()=>window.removeEventListener('petpal:login-persistence-error',changed);},[]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (locked.current) return; locked.current=true;const epoch=getSessionEpoch(),current=()=>alive.current&&epoch===getSessionEpoch();setBusy(true); setError('');
    try { if (method === 'password') await login(form.url, username, password); else await connectWithToken(form); }
    catch (error) { if (current()&&!isSessionChanged(error)) setError((error as Error).message); }
    finally { locked.current=false;if(current()){setBusy(false); setPassword('');} }
  }
  async function localOwner() {
    if(locked.current)return;locked.current=true;const epoch=getSessionEpoch(),current=()=>alive.current&&epoch===getSessionEpoch();setBusy(true); setError('');
    try { if (window.petpal) { const connection=await window.petpal.connection();if(current())await connectWithToken(connection); } }
    catch (error) { if (current()&&!isSessionChanged(error)) setError((error as Error).message); }
    finally { locked.current=false;if(current())setBusy(false); }
  }
  async function clearDeviceLogin(){
    if(locked.current)return;locked.current=true;const epoch=getSessionEpoch(),current=()=>alive.current&&epoch===getSessionEpoch();setBusy(true);
    try{await clearSavedLogin();if(current())setError('');}
    catch(failure){if(current()&&!isSessionChanged(failure))setError(getLoginPersistenceError()||'无法清除设备保存的登录，请重试。');}
    finally{locked.current=false;if(current())setBusy(false);}
  }
  const pageEntrance = useUiEntrance<HTMLElement>('login-page', !close);
  const scrimEntrance = useUiEntrance<HTMLDivElement>('connection-dialog', !!close);
  const formContent = <section className={close ? 'modal' : 'login-form'} aria-labelledby="connection-title" aria-busy={busy}>
    <div className="modal-heading"><span className="dialog-icon"><Link2 size={23} aria-hidden="true"/></span>{close && <button className="icon-button" disabled={busy} data-ui-dismiss="dialog" aria-label="关闭连接窗口" onClick={()=>{if(!locked.current)close();}}><X size={20} aria-hidden="true"/></button>}</div>
    <h2 id="connection-title">登录你的小伴</h2><p>聊天、语音与 Agent 工作，都从你的账号开始。{window.petpal?.executor && '登录后，此电脑会出现在同账号的 Agent 执行列表中。'}</p>
    <div className="auth-modes" role="group" aria-label="登录方式"><button aria-pressed={method === 'password'} className={method === 'password' ? 'active' : ''} onClick={() => setMethod('password')}>账号密码</button><button aria-pressed={method === 'token'} className={method === 'token' ? 'active' : ''} onClick={() => setMethod('token')}>管理员配对</button></div>
    <form onSubmit={submit}><fieldset disabled={busy} className="login-fields">
      <label>服务地址<input placeholder="默认当前服务，也可填写其他服务器地址" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} autoComplete="url"/></label>
      {method === 'password' ? <><label>账号名称<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required maxLength={40}/></label><label>登录密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required maxLength={256}/></label></> : <label>配对令牌<input type="password" value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} required autoComplete="off"/></label>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="primary-button full-button" type="submit">{busy ? <Loader2 className="spin" size={17} aria-hidden="true"/> : <ArrowRight size={17} aria-hidden="true"/>}{busy?'正在登录…':'登录并继续'}</button>
    </fieldset></form>
    {window.petpalLoginSession&&getLoginPersistenceError()&&!needsVaultRetry()&&<button type="button" className="secondary-button full-button" disabled={busy} onClick={()=>void clearDeviceLogin()}>清除设备保存的登录</button>}
    {window.petpal && <button className="secondary-button full-button auth-owner" disabled={busy} onClick={localOwner}>以本机管理员身份登录</button>}
    <p className="field-help login-note"><ShieldCheck size={14} aria-hidden="true"/>{window.petpalLoginSession?'此设备会加密保存登录，退出账号后清除。':'管理员分配模型与账号身份；登录凭据仅保留当前会话。'}</p>
  </section>;
  return close ? <div ref={scrimEntrance} className="modal-backdrop" data-ui-layer="dialog" role="dialog" aria-modal="true">{formContent}</div> : <main ref={pageEntrance} className="login-page"><a href="/" className="login-brand"><BrandMark size={36}/><span>小伴<small>PetPal</small></span></a><div className="login-layout"><div className="login-welcome"><span>你的日常伙伴</span><h1>聊聊想法，<br/>一起把事情做好。</h1><img src={avatarPreview} alt="温柔的二次元伙伴" width="384" height="576" decoding="async" fetchPriority="high" onError={e => { e.currentTarget.style.display = 'none'; }}/></div>{formContent}</div></main>;
}

export default function LoginGate({children,onVerified}:{children:ReactNode;onVerified?():void}) {
  const [status, setStatus] = useState<'checking'|'ready'|'login'|'error'>(getConnection().token ? 'checking' : needsVaultRetry()?'error':'login');
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [switchOpen,setSwitchOpen]=useState(false),switching=useRef(false);
  useEffect(() => {
    const epoch=getSessionEpoch();let alive=true,phase:typeof status='login',lastVerified=0,lastAutomatic=-Infinity;
    let scheduled:ReturnType<typeof setTimeout>|undefined;
    let active:{controller:AbortController;timer:ReturnType<typeof setTimeout>}|undefined;
    const current=()=>alive&&epoch===getSessionEpoch();
    const eligible=()=>current()&&!document.hidden&&window.navigator?.onLine!==false&&!switching.current;
    const update=(next:typeof status,message='')=>{if(current()){phase=next;setError(message);setStatus(next);}};
    const stopScheduled=()=>{clearTimeout(scheduled);scheduled=undefined;};
    const validate=(keepReady=false)=>{
      if(active||!eligible())return;
      const controller=new AbortController();
      const attempt={controller,timer:setTimeout(()=>{
        if(!current()||active!==attempt)return;
        active=undefined;controller.abort();
        if(!keepReady)update('error','连接验证超时，请检查网络或重试连接。');
      },15000)};active=attempt;
      if(!keepReady)update('checking');
      void api('/auth/me',{signal:controller.signal}).then(value=>{
        if(!current()||active!==attempt||controller.signal.aborted)return;
        if(!value.instanceId||!value.user?.id)throw new Error('服务器没有返回有效的账号身份。');
        lastVerified=Date.now();
        // Refreshing a verified session keeps its workspace in place. Initial
        // verification alone may warm and reveal private startup data.
        if(!keepReady){try{onVerified?.();}catch{}if(current())update('ready');}
      }).catch(failure=>{
        if(!current()||active!==attempt||controller.signal.aborted||isSessionChanged(failure))return;
        if(!getConnection().token)update('login');
        else if(!keepReady)update('error',failure instanceof Error?failure.message:'服务暂时无法连接，请重试。');
      }).finally(()=>{clearTimeout(attempt.timer);if(active===attempt)active=undefined;});
    };
    const resume=()=>{
      if(!eligible()){stopScheduled();return;}
      const renew=phase==='ready'&&!!window.petpalLoginSession&&!window.petpal&&Date.now()-lastVerified>=24*60*60*1000;
      if(active||scheduled||!getConnection().token||(phase!=='error'&&!renew)||Date.now()-lastAutomatic<5000)return;
      scheduled=setTimeout(()=>{scheduled=undefined;if(!eligible()||active)return;lastAutomatic=Date.now();validate(phase==='ready');},250);
    };
    document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);window.addEventListener('offline',resume);window.addEventListener('focus',resume);
    if(getConnection().token){
      if(eligible())validate();else update('error',document.hidden?'回到小伴后将自动重新连接。':'网络暂时不可用，联网后将自动重新连接。');
    }else if(needsVaultRetry()){
      if(retry===0)update('error',getLoginPersistenceError());
      else{
        update('checking');
        void retrySavedLogin().then(()=>{
          if(!current())return;
          if(getConnection().token)validate();else update('login');
        }).catch(failure=>{if(current()&&!isSessionChanged(failure))update('error',getLoginPersistenceError()||'暂时无法读取保存的登录，请重试。');});
      }
    }else update('login');
    return()=>{alive=false;stopScheduled();if(active){clearTimeout(active.timer);active.controller.abort();}document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);window.removeEventListener('offline',resume);window.removeEventListener('focus',resume);};
  }, [retry,onVerified]);
  if (status === 'checking') return <div className="loading-view" role="status"><Loader2 className="spin" size={20} aria-hidden="true"/>正在恢复账号连接…</div>;
  if (status === 'ready') return children;
  if(status==='login')return <ConnectionDialog/>;
  const vaultRetry=needsVaultRetry();
  return <><main className="login-page login-reconnect-page"><a href="/" className="login-brand"><BrandMark size={32}/><span>小伴<small>PetPal</small></span></a><section className="login-reconnect" aria-labelledby="reconnect-title"><span className="dialog-icon"><Link2 size={24} aria-hidden="true"/></span><h1 id="reconnect-title">{vaultRetry?'恢复设备保存的登录':'登录已保存，重新连接即可'}</h1><p>{vaultRetry?'设备暂时未能读取登录信息，可以先重试恢复。':'暂时无法连接服务器，账号仍保留在这台设备上。'}</p><div className="login-retry" role="alert"><span>{error}</span></div><div className="login-reconnect-actions"><button className="primary-button" onClick={()=>setRetry(value=>value+1)}>{vaultRetry?'重试保存的登录':'重试连接'}</button><button className="secondary-button" onClick={()=>{switching.current=true;setSwitchOpen(true);}}>切换账号或服务器</button></div></section></main>{switchOpen&&<ConnectionDialog close={()=>{switching.current=false;setSwitchOpen(false);}}/>}</>;
}
