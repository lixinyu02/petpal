import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Loader2, Network, Power, RefreshCw, Upload } from 'lucide-react';
import { getConnection, getExecutionTarget, getIdentity, getSessionEpoch, type AppProxyBridge, type AppProxyStatus } from './api';
import './app-proxy.css';

const MAX_YAML_BYTES = 4 * 1024 ** 2;
const MAX_REMOTE_URL_LENGTH = 4096;
const stateLabels:Record<AppProxyStatus['state'],string> = { stopped:'未启用', checking:'正在检查配置', starting:'正在启用', running:'已启用', stopping:'正在关闭', error:'需要检查' };
type Action = keyof AppProxyBridge;
type Snapshot = { scope:string; status:AppProxyStatus|null; action:Action|''; error:string };
const bounded = (value:unknown, maximum:number) => typeof value === 'string' && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
const scopeNow = () => { const identity = getIdentity(); return `${getSessionEpoch()}:${identity?.instanceId||''}:${identity?.userId||''}:${getExecutionTarget()}`; };
const nativeBridge = () => {
  const bridge = window.petpal?.appProxy;
  return bridge && ['status','importFile','importText','start','stop','preferences','select'].every(key => typeof bridge[key as Action] === 'function') ? bridge : undefined;
};

/** Keep native configuration, credentials and unknown fields out of UI state. */
export function readAppProxyStatus(value:unknown):AppProxyStatus {
  if (!value || typeof value !== 'object') throw new Error('代理状态不完整。');
  const item = value as Record<string,unknown>;
  if (item.supported !== true || !Object.hasOwn(stateLabels, item.state as string) ||
      typeof item.configured !== 'boolean' || typeof item.running !== 'boolean' || item.running !== (item.state === 'running') || typeof item.autoStart !== 'boolean' ||
      !bounded(item.version, 48) || !item.version || !['win32','linux'].includes(item.platform as string) ||
      !['x64','arm64'].includes(item.arch as string) || !Array.isArray(item.groups) || item.groups.length > 128) throw new Error('代理状态不完整。');
  if ((item.remoteConfigured !== undefined && typeof item.remoteConfigured !== 'boolean') || (item.remoteUpdatedAt !== undefined &&
      (item.remoteConfigured !== true || typeof item.remoteUpdatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.remoteUpdatedAt) || !Number.isFinite(Date.parse(item.remoteUpdatedAt)) || new Date(item.remoteUpdatedAt).toISOString() !== item.remoteUpdatedAt))) throw new Error('远程配置状态不完整。');
  const names = new Set<string>();
  const groups = item.groups.map(value => {
    if (!value || typeof value !== 'object' || !bounded(value.name, 256) || !value.name || names.has(value.name) ||
        !bounded(value.selected, 256) || !Array.isArray(value.choices) || value.choices.length > 2048 ||
        value.choices.some((choice:unknown) => !bounded(choice, 256) || !choice) ||
        new Set(value.choices).size !== value.choices.length) throw new Error('代理节点状态不完整。');
    names.add(value.name);
    return { name:value.name as string, selected:value.selected as string, choices:[...value.choices] as string[] };
  });
  return { supported:true, state:item.state as AppProxyStatus['state'], configured:item.configured, running:item.running,
    autoStart:item.autoStart, version:item.version as string, platform:item.platform as AppProxyStatus['platform'],
    arch:item.arch as AppProxyStatus['arch'], groups, remoteConfigured:item.remoteConfigured === true,
    ...(item.remoteUpdatedAt ? { remoteUpdatedAt:item.remoteUpdatedAt as string } : {}), ...(item.error ? { error:'代理运行异常，请检查配置后重试。' } : {}) };
}

export default function AppProxySettings({connected}:{connected:boolean}) {
  const id = useId(), bridge = nativeBridge();
  const [, setSessionRevision] = useState(0), scope = scopeNow();
  const [snapshot, setSnapshot] = useState<Snapshot>({ scope, status:null, action:'', error:'' });
  const [yaml, setYaml] = useState(''), [pasteOpen, setPasteOpen] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState(''), [remoteOpen, setRemoteOpen] = useState(false);
  const mounted = useRef(false), generation = useRef(0), pending = useRef(false);
  const allowed = !!bridge && connected && getExecutionTarget() === 'local' && !!getIdentity() && !!getConnection().token;
  const current = snapshot.scope === scope ? snapshot : { scope, status:null, action:'', error:'' };
  const status = allowed ? current.status : null;
  const busy = !!current.action || !!status && ['checking','starting','stopping'].includes(status.state);
  const remoteSupported = typeof bridge?.importUrl === 'function' && typeof bridge?.updateRemote === 'function';

  useEffect(() => {
    mounted.current = true;
    const changed = () => {
      generation.current++; pending.current = false;
      setSnapshot({ scope:scopeNow(), status:null, action:'', error:'' }); setYaml(''); setPasteOpen(false); setRemoteUrl(''); setRemoteOpen(false);
      setSessionRevision(value => value + 1);
    };
    window.addEventListener('petpal:session-change', changed);
    return () => { mounted.current = false; generation.current++; pending.current = false; window.removeEventListener('petpal:session-change', changed); };
  }, []);

  const run = async (action:Action, input?:{yaml:string}|{url:string}|{autoStart:boolean}|{group:string;name:string}) => {
    if (!allowed || !bridge || pending.current || getExecutionTarget() !== 'local' || !getIdentity() || !getConnection().token) return false;
    if (action === 'importUrl' && !bridge.importUrl || action === 'updateRemote' && !bridge.updateRemote) return false;
    if (['importFile','importText','importUrl','updateRemote'].includes(action) && status?.running) return false;
    const owner = scopeNow(), revision = ++generation.current;
    const active = () => mounted.current && generation.current === revision && scopeNow() === owner;
    pending.current = true;
    setSnapshot(previous => ({ scope:owner, status:previous.scope === owner ? previous.status : null, action, error:'' }));
    try {
      let result:AppProxyStatus;
      if (action === 'importText') result = await bridge.importText(input as {yaml:string});
      else if (action === 'importUrl') result = await bridge.importUrl!(input as {url:string});
      else if (action === 'updateRemote') result = await bridge.updateRemote!();
      else if (action === 'preferences') result = await bridge.preferences(input as {autoStart:boolean});
      else if (action === 'select') result = await bridge.select(input as {group:string;name:string});
      else result = await bridge[action]();
      if (!active()) return false;
      const next = readAppProxyStatus(result);
      setSnapshot({ scope:owner, status:next, action:'', error:'' }); return true;
    } catch {
      if (!active()) return false;
      const message = action === 'status' ? '无法读取代理状态。请确认已登录本机主账号，再重试。'
        : action === 'importUrl' || action === 'updateRemote' ? '远程配置未能下载或保存，请检查链接、配置和网络后重试。'
        : action === 'importFile' || action === 'importText' ? '配置未能导入，请检查 YAML 文件和本机主账号权限。'
        : action === 'start' ? '代理未能启用，请检查配置和网络后重试。'
        : action === 'stop' ? '代理未能关闭，请稍后重试。'
        : action === 'select' ? '节点未能切换，请刷新状态后重试。' : '启动偏好未能保存，请稍后重试。';
      setSnapshot(previous => ({ ...previous, action:'', error:message })); return false;
    } finally { if (active()) pending.current = false; }
  };

  useEffect(() => {
    if (!allowed) { generation.current++; pending.current = false; setSnapshot({ scope, status:null, action:'', error:'' }); setYaml(''); setPasteOpen(false); setRemoteUrl(''); setRemoteOpen(false); return; }
    void run('status');
    let disposed = false, timer:ReturnType<typeof setTimeout>|null = null;
    const stop = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
    const schedule = () => {
      stop();
      if (!disposed && !document.hidden) timer = setTimeout(() => { timer = null; void run('status').finally(schedule); }, 15000);
    };
    document.addEventListener('visibilitychange', schedule); schedule();
    return () => { disposed = true; generation.current++; pending.current = false; stop(); document.removeEventListener('visibilitychange', schedule); };
    // The request scope and bridge identify the authenticated native context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, bridge, scope]);

  const importText = async () => {
    if (!allowed || busy || !yaml.trim()) return;
    if (new TextEncoder().encode(yaml).length > MAX_YAML_BYTES) {
      setSnapshot(previous => ({ ...previous, error:'配置超过 4 MiB，请缩小文件后重新导入。' })); return;
    }
    const owner = scopeNow();
    if (await run('importText', { yaml }) && mounted.current && scopeNow() === owner) { setYaml(''); setPasteOpen(false); }
  };

  const importUrl = async () => {
    if (!allowed || busy || status?.running || !remoteSupported || !remoteUrl.trim()) return;
    const url = remoteUrl.trim(), owner = scopeNow();
    setRemoteUrl('');
    if (url.length > MAX_REMOTE_URL_LENGTH) {
      setSnapshot(previous => ({ ...previous, error:'配置链接过长，请检查后重新输入。' })); return;
    }
    if (await run('importUrl', { url }) && mounted.current && scopeNow() === owner) setRemoteOpen(false);
  };

  return <section className="app-proxy-settings" aria-labelledby={`${id}-title`} aria-busy={busy}>
    <div className="app-proxy-heading"><div className="app-proxy-title"><span className="app-proxy-symbol"><Network size={21} aria-hidden="true"/></span><div><h3 id={`${id}-title`}>应用代理</h3><p>为小伴提供独立的网络代理。</p></div></div>
      {status && <span className={`app-proxy-state is-${status.state}`} role="status"><i aria-hidden="true"/>{stateLabels[status.state]}</span>}
    </div>
    {!bridge ? <p className="app-proxy-note">请在 Windows 或 Ubuntu 桌面客户端设置应用代理。</p>
      : !connected ? <p className="app-proxy-note">先登录这台电脑的小伴主账号，再设置代理。</p>
      : getExecutionTarget() !== 'local' ? <p className="app-proxy-note">请先切换到客户端的本机服务，再设置这台电脑的代理。</p>
      : !getIdentity() || !getConnection().token ? <p className="app-proxy-note">正在确认本机登录状态…</p>
      : <>
        {!status && current.action === 'status' && <p className="app-proxy-note" role="status"><Loader2 size={14} className="spin" aria-hidden="true"/>正在读取代理状态…</p>}
        {(current.error || status?.error) && <p className="form-error app-proxy-error" role="alert">{current.error || status?.error}</p>}
        {status && <>
          <div className="app-proxy-summary"><span>{status.configured ? '配置已保存在这台电脑' : '尚未导入代理配置'}</span><span>Mihomo {status.version} · {status.platform === 'win32' ? 'Windows' : 'Ubuntu'} {status.arch === 'arm64' ? 'ARM64' : 'x64'}</span></div>
          <div className="app-proxy-actions">
            <button type="button" className={status.running ? 'secondary-button' : 'primary-button'} disabled={busy || !status.configured} onClick={() => { setRemoteUrl(''); setRemoteOpen(false); void run(status.running ? 'stop' : 'start'); }}>
              {current.action === 'start' || current.action === 'stop' ? <Loader2 size={15} className="spin" aria-hidden="true"/> : <Power size={15} aria-hidden="true"/>}{status.running ? '关闭代理' : '启用代理'}
            </button>
            <button type="button" className="secondary-button" disabled={busy || status.running} onClick={() => { setYaml(''); setRemoteUrl(''); setRemoteOpen(false); void run('importFile'); }}><Upload size={15} aria-hidden="true"/>导入配置</button>
            <button type="button" className="icon-button app-proxy-refresh" aria-label="刷新应用代理状态" disabled={busy} onClick={() => { void run('status'); }}><RefreshCw size={15} aria-hidden="true"/></button>
          </div>
          <label className="app-proxy-startup"><input type="checkbox" checked={status.autoStart} disabled={busy || !status.configured} onChange={event => { void run('preferences', { autoStart:event.target.checked }); }}/><span>随小伴启动</span></label>
          {remoteSupported && <div className="app-proxy-paste app-proxy-remote">
            <button type="button" className="app-proxy-paste-toggle" aria-expanded={remoteOpen} aria-controls={`${id}-remote`} disabled={busy || status.running} onClick={() => { setRemoteOpen(value => !value); setRemoteUrl(''); setPasteOpen(false); setYaml(''); }}><ChevronDown size={14} className={remoteOpen ? 'is-open' : ''} aria-hidden="true"/>从链接下载配置</button>
            {remoteOpen && <div id={`${id}-remote`} className="app-proxy-paste-body app-proxy-remote-body"><label htmlFor={`${id}-remote-url`}>配置文件链接</label><input id={`${id}-remote-url`} type="password" value={remoteUrl} maxLength={MAX_REMOTE_URL_LENGTH} spellCheck={false} autoComplete="off" autoCapitalize="off" placeholder="https://example.com/clash.yaml" disabled={busy || status.running} onChange={event => setRemoteUrl(event.target.value)}/><button type="button" className="secondary-button" disabled={busy || status.running || !remoteUrl.trim()} onClick={() => { void importUrl(); }}>{current.action === 'importUrl' && <Loader2 size={14} className="spin" aria-hidden="true"/>}下载并保存</button></div>}
            {status.remoteConfigured && <div className="app-proxy-remote-saved"><span>已保存远程来源{status.remoteUpdatedAt && <small>更新于 <time dateTime={status.remoteUpdatedAt}>{new Date(status.remoteUpdatedAt).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}</time></small>}</span><button type="button" className="secondary-button" disabled={busy || status.running} onClick={() => { setRemoteUrl(''); void run('updateRemote'); }}><RefreshCw size={14} className={current.action === 'updateRemote' ? 'spin' : ''} aria-hidden="true"/>更新远程配置</button></div>}
          </div>}
          <div className="app-proxy-paste">
            <button type="button" className="app-proxy-paste-toggle" aria-expanded={pasteOpen} aria-controls={`${id}-paste`} disabled={busy || status.running} onClick={() => { setPasteOpen(value => !value); setYaml(''); setRemoteUrl(''); setRemoteOpen(false); }}><ChevronDown size={14} className={pasteOpen ? 'is-open' : ''} aria-hidden="true"/>粘贴 YAML 配置</button>
            {pasteOpen && <div id={`${id}-paste`} className="app-proxy-paste-body"><label htmlFor={`${id}-yaml`}>Clash YAML</label><textarea id={`${id}-yaml`} value={yaml} maxLength={MAX_YAML_BYTES} spellCheck={false} autoComplete="off" autoCapitalize="off" placeholder="粘贴你的完整 YAML 配置" disabled={busy || status.running} onChange={event => setYaml(event.target.value)}/><button type="button" className="secondary-button" disabled={busy || status.running || !yaml.trim()} onClick={() => { void importText(); }}>保存配置</button></div>}
          </div>
          {status.running && <p className="app-proxy-note">更换或更新配置前，请先关闭代理。</p>}
          {status.running && status.groups.length > 0 && <div className="app-proxy-groups" aria-label="代理节点选择">{status.groups.map((group, index) => <label className="app-proxy-group" key={group.name} htmlFor={`${id}-group-${index}`}><span>{group.name}</span><select id={`${id}-group-${index}`} value={group.selected} disabled={busy || !group.choices.length} onChange={event => { if (group.choices.includes(event.target.value)) void run('select', { group:group.name, name:event.target.value }); }}>{!group.selected ? <option value="" disabled>选择节点</option> : !group.choices.includes(group.selected) ? <option value={group.selected} disabled>{group.selected} · 当前节点</option> : null}{group.choices.map(choice => <option value={choice} key={choice}>{choice}</option>)}</select></label>)}</div>}
          <p className="app-proxy-note">本机与局域网服务保持直连。启用后可在对话中验证实际连接。</p>
        </>}
        {!status && current.error && <button type="button" className="secondary-button" disabled={busy} onClick={() => { void run('status'); }}>重新读取代理状态</button>}
      </>}
  </section>;
}
