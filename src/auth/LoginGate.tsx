import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Link2, Loader2, ShieldCheck, X } from 'lucide-react';
import BrandMark from '../BrandMark';
import { api, connectWithToken, getConnection, isSessionChanged, login, type Connection } from '../api';
import './login.css';

export function ConnectionDialog({ close }: { close?(): void }) {
  const [form, setForm] = useState<Connection>({ url: getConnection().url, token: '' });
  const [method, setMethod] = useState<'password'|'token'>('password');
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { if (method === 'password') await login(form.url, username, password); else await connectWithToken(form); }
    catch (error) { if (!isSessionChanged(error)) setError((error as Error).message); }
    finally { setBusy(false); setPassword(''); }
  }
  async function localOwner() {
    setBusy(true); setError('');
    try { if (window.petpal) await connectWithToken(await window.petpal.connection()); }
    catch (error) { if (!isSessionChanged(error)) setError((error as Error).message); }
    finally { setBusy(false); }
  }
  const formContent = <section className={close ? 'modal' : 'login-form'} aria-labelledby="connection-title">
    <div className="modal-heading"><span className="dialog-icon"><Link2 size={23} aria-hidden="true"/></span>{close && <button className="icon-button" aria-label="关闭连接窗口" onClick={close}><X size={20} aria-hidden="true"/></button>}</div>
    <h2 id="connection-title">登录你的小伴</h2><p>聊天、语音与 Agent 工作，都从你的账号开始。{window.petpal?.executor && '登录后，此电脑会出现在同账号的 Agent 执行列表中。'}</p>
    <div className="auth-modes" role="group" aria-label="登录方式"><button aria-pressed={method === 'password'} className={method === 'password' ? 'active' : ''} onClick={() => setMethod('password')}>账号密码</button><button aria-pressed={method === 'token'} className={method === 'token' ? 'active' : ''} onClick={() => setMethod('token')}>管理员配对</button></div>
    <form onSubmit={submit}><fieldset disabled={busy} className="login-fields">
      <label>服务地址<input placeholder="同站点留空，或 https://pet.example.com" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} autoComplete="url"/></label>
      {method === 'password' ? <><label>账号名称<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required maxLength={40}/></label><label>登录密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required maxLength={256}/></label></> : <label>配对令牌<input type="password" value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} required autoComplete="off"/></label>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="primary-button full-button" type="submit">{busy ? <Loader2 className="spin" size={17} aria-hidden="true"/> : <ArrowRight size={17} aria-hidden="true"/>}登录并继续</button>
    </fieldset></form>
    {window.petpal && <button className="secondary-button full-button auth-owner" disabled={busy} onClick={localOwner}>以本机管理员身份登录</button>}
    <p className="field-help login-note"><ShieldCheck size={14} aria-hidden="true"/>管理员分配模型与 Agent 权限；登录凭据仅保留当前会话。</p>
  </section>;
  return close ? <div className="modal-backdrop" role="dialog" aria-modal="true">{formContent}</div> : <main className="login-page"><a href="/" className="login-brand"><BrandMark size={36}/><span>小伴<small>PetPal</small></span></a><div className="login-layout"><div className="login-welcome"><span>你的日常伙伴</span><h1>聊聊想法，<br/>一起把事情做好。</h1><img src="/avatars/akari/idle.webp" alt="温柔的二次元伙伴" width="1024" height="1536" decoding="async" fetchPriority="high" onError={e => { e.currentTarget.style.display = 'none'; }}/></div>{formContent}</div></main>;
}

export default function LoginGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'checking'|'ready'|'login'|'error'>(getConnection().token ? 'checking' : 'login');
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!getConnection().token) { setStatus('login'); return; }
    const controller = new AbortController(); setStatus('checking');
    const timeout = setTimeout(() => { setError('连接验证超时，请检查服务地址或重试。'); setStatus('error'); controller.abort(); }, 15000);
    void api('/auth/me', { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (!value.instanceId || !value.user?.id) throw new Error('服务器没有返回有效的账号身份。');
      setStatus('ready');
    }).catch(error => { if (!controller.signal.aborted && !isSessionChanged(error)) { setError(error.message); setStatus(getConnection().token ? 'error' : 'login'); } }).finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [retry]);
  if (status === 'checking') return <div className="loading-view" role="status"><Loader2 className="spin" size={20} aria-hidden="true"/>正在验证登录…</div>;
  if (status === 'ready') return children;
  return <>{status === 'error' && <div className="login-retry" role="alert"><span>{error}</span><button onClick={() => setRetry(value => value + 1)}>重试连接</button></div>}<ConnectionDialog/></>;
}
