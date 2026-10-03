import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Copy, Download, Loader2, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { getConnection, getExecutionTarget, getIdentity, getSessionEpoch, subscribeSession, type User } from './api';
import { centralServerBridge, centralServerErrorMessage, createCentralServerOperationGuard, readCentralServerPort, readCentralServerPublicUrl, readCentralServerStatus, type CentralServerStatus } from './platform/central-server';
import './central-server-settings.css';

type Props = { connected: boolean; user?: User; onConnect(): void; onAccounts(): void; onDownload?(): void };
function sessionScope() {
  const identity = getIdentity();
  return `${getSessionEpoch()}:${getExecutionTarget()}:${identity?.instanceId || ''}:${identity?.userId || ''}`;
}

export default function CentralServerSettings({ connected, user, onConnect, onAccounts, onDownload }: Props) {
  const scope = useSyncExternalStore(subscribeSession, sessionScope, sessionScope), id = useId();
  const desktop = typeof window !== 'undefined' && !!window.petpal, bridge = centralServerBridge();
  const local = getExecutionTarget() === 'local', eligible = connected && local && !!user?.isOwner && !!bridge;
  const [snapshot, setSnapshot] = useState<{ scope: string; status: CentralServerStatus } | null>(null);
  const [enabled, setEnabled] = useState(false), [port, setPort] = useState('4319'), [publicUrl, setPublicUrl] = useState('');
  const [busy, setBusy] = useState<'load' | 'save' | 'copy' | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [feedbackScope, setFeedbackScope] = useState(scope);
  const guard = useRef(createCentralServerOperationGuard(sessionScope)), access = useRef(eligible);
  access.current = eligible;
  const status = snapshot?.scope === scope && eligible ? snapshot.status : null;
  const connectionUrl = getConnection().url || (typeof location === 'undefined' ? '' : location.origin);
  const current = (operation: NonNullable<ReturnType<typeof guard.current.begin>>) => access.current && guard.current.current(operation);
  function accept(next: CentralServerStatus) {
    setSnapshot({ scope, status: next }); setEnabled(next.enabled); setPort(String(next.port)); setPublicUrl(next.publicUrl);
  }
  async function load() {
    if (!eligible || !bridge) return;
    const operation = guard.current.begin(scope); if (!operation) return;
    setFeedbackScope(scope); setBusy('load'); setError(''); setNotice('');
    try { const next = readCentralServerStatus(await bridge.status()); if (current(operation)) accept(next); }
    catch (failure) { if (current(operation)) { setSnapshot(null); setError(centralServerErrorMessage(failure, '无法读取这台电脑的服务状态，请重新读取。')); } }
    finally { if (current(operation)) setBusy(null); guard.current.finish(operation); }
  }
  useEffect(() => {
    guard.current.invalidate(); setSnapshot(null); setFeedbackScope(scope); setBusy(null); setError(''); setNotice('');
    if (eligible) void load();
    return () => { guard.current.invalidate(); };
  }, [eligible, scope, bridge]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!eligible || !bridge || !status?.supported || (enabled && !status.ownerHasPassword)) return;
    let patch;
    try { patch = { enabled, port: readCentralServerPort(port), publicUrl: readCentralServerPublicUrl(publicUrl) }; }
    catch (failure) { if (scope === sessionScope()) { setFeedbackScope(scope); setError((failure as Error).message); setNotice(''); } return; }
    const operation = guard.current.begin(scope); if (!operation) return;
    setFeedbackScope(scope); setBusy('save'); setError(''); setNotice('');
    let submitted = false;
    try {
      await bridge.update(patch); submitted = true; if (!current(operation)) return;
      const next = readCentralServerStatus(await bridge.status()); if (!current(operation)) return;
      accept(next);
      if (next.enabled !== patch.enabled || next.port !== patch.port || next.publicUrl !== patch.publicUrl
        || (patch.enabled && !next.listening)) setError('设置未完全生效，已显示本机实际状态。请检查提示后重试。');
      else setNotice(next.listening ? '中央服务器已开启，其他设备可使用下方地址登录。' : '服务设置已保存，中央服务器已关闭。');
    } catch (failure) { if (current(operation)) { setSnapshot(null); setError(submitted ? '未能确认服务设置，请重新读取本机状态后重试。' : centralServerErrorMessage(failure, '未能确认服务设置，请重新读取本机状态后重试。')); } }
    finally { if (current(operation)) setBusy(null); guard.current.finish(operation); }
  }

  async function copy(value: string) {
    if (!eligible || !status || busy || scope !== sessionScope()) return;
    const operation = guard.current.begin(scope); if (!operation) return;
    setFeedbackScope(scope); setBusy('copy'); setError(''); setNotice('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(value);
      if (current(operation)) setNotice('访问地址已复制。');
    } catch { if (current(operation)) setError('复制未获允许，请选择并复制地址文字。'); }
    finally { if (current(operation)) setBusy(null); guard.current.finish(operation); }
  }
  function address(value: string, kind: string) {
    return <li key={`${kind}:${value}`}><div><span>{kind}</span><code tabIndex={0}>{value}</code></div><button type="button" className="secondary-button" aria-label={`复制${kind} ${value}`} disabled={!!busy} onClick={() => void copy(value)}><Copy size={14} aria-hidden="true" />复制</button></li>;
  }
  const unsupported = <>
    <p className="central-server-note">{desktop ? '当前客户端还不支持中央服务器设置，请使用新版 Windows 或 Ubuntu 客户端。' : 'Windows 或 Ubuntu 电脑可以承担中央服务器；此设备连接服务后即可共用账号、对话和 Agent 执行电脑。'}</p>
    {onDownload && <button type="button" className="secondary-button" onClick={onDownload}><Download size={15} aria-hidden="true" />下载桌面客户端</button>}
  </>;
  return <section className="settings-section central-server-settings" aria-label="中央服务器" aria-busy={!!busy}>
    <div className="section-title"><div><h2>中央服务器</h2><p>让这台电脑保存账号、对话和模型配置，供其他设备连接使用。</p></div><Server size={22} aria-hidden="true" /></div>
    {connected && <p className="central-server-connection"><span>当前连接 · {local ? '本机服务' : '远程服务'}</span><code>{connectionUrl}</code></p>}
    {!connected ? <p className="central-server-note">登录后可以管理中央服务器。</p> : !desktop || !bridge ? unsupported : !local || !user?.isOwner ? <>
      <p className="central-server-note">中央服务器由这台电脑的本机管理员管理。当前账号的聊天与服务连接保持原样。</p>
      <button type="button" className="secondary-button" onClick={onConnect}><ShieldCheck size={15} aria-hidden="true" />登录本机管理员</button>
    </> : <>
      {status && <div className={`central-server-state${status.listening ? ' is-listening' : ''}`} role="status"><span aria-hidden="true" />{status.listening ? '正在监听局域网连接' : status.enabled ? '已设置开启，当前未监听' : '中央服务器已关闭'}</div>}
      {status?.reason && <p className="central-server-note central-server-reason">{status.reason}</p>}
      {status?.supported && <>
        {!status.ownerHasPassword && <div className="central-server-password"><p>开启前，请先为本机管理员设置登录密码，再为其他用户创建成员账号。</p><button type="button" className="secondary-button" disabled={!!busy} onClick={onAccounts}>设置账号密码</button></div>}
        <form onSubmit={event => void save(event)} className="central-server-form">
          <fieldset disabled={!!busy}>
            <label className="central-server-toggle"><span><strong>启用中央服务器</strong><small id={`${id}-enabled-help`}>随小伴启动恢复；收起到托盘继续运行，完全退出会停止服务。保存后生效。</small></span><input type="checkbox" role="switch" aria-label="启用中央服务器" aria-describedby={`${id}-enabled-help`} checked={enabled} disabled={!status.ownerHasPassword && !enabled} onChange={event => setEnabled(event.target.checked)} /></label>
            <div className="central-server-fields"><label>局域网端口<input aria-label="局域网端口" inputMode="numeric" value={port} onChange={event => setPort(event.target.value)} maxLength={5} required aria-describedby={`${id}-port-help`} /></label><label>HTTPS 访问地址（可选）<input aria-label="HTTPS 访问地址（可选）" type="url" placeholder="https://pet.example.com" value={publicUrl} onChange={event => setPublicUrl(event.target.value)} maxLength={2048} autoComplete="url" aria-describedby={`${id}-https-help`} /></label></div>
            <p className="central-server-note" id={`${id}-port-help`}>端口范围 1024–65535；更改端口后，其他设备需要重新连接。</p>
            <p className="central-server-note" id={`${id}-https-help`}>填写已配置并可信的 HTTPS 入口。保存地址不会创建证书或配置反向代理。</p>
            <button type="submit" className="primary-button" disabled={enabled && !status.ownerHasPassword}>{busy === 'save' ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}保存服务设置</button>
          </fieldset>
        </form>
        {(status.urls.length > 0 || status.publicUrl) && <div className="central-server-access"><h3>其他设备的访问地址</h3><ul>{status.urls.map(url => address(url, '局域网 HTTP'))}{status.publicUrl && address(status.publicUrl, '已配置的 HTTPS 入口')}</ul></div>}
        <p className="central-server-note">局域网 HTTP 支持网页 Chat / Agent 和其他电脑客户端。Android 安装版，以及网页的麦克风、摄像头，需要可信 HTTPS 入口。</p>
        <p className="central-server-note">连接此电脑后使用这里的账号和对话；其他服务器上的数据不会自动迁移。</p>
      </>}
      {busy === 'load' && <p className="central-server-feedback" role="status"><Loader2 size={15} className="spin" aria-hidden="true" />正在读取本机服务…</p>}
      {feedbackScope === scope && error && <p className="form-error" role="alert">{error}</p>}
      {feedbackScope === scope && notice && <p className="central-server-feedback" role="status">{notice}</p>}
      <div className="central-server-footer"><span>设置和启动状态以本机读取结果为准。</span><button type="button" className="secondary-button" disabled={!!busy} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />重新读取</button></div>
    </>}
  </section>;
}
