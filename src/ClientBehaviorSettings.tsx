import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Download, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { getIdentity, getSessionEpoch, subscribeSession } from './api';
import TaskNotificationsSettings from './TaskNotificationsSettings';
import { supportsTaskNotifications } from './platform/task-notifications';
import { readAppPreferencesStatus, type AppPreferences, type AppPreferencesStatus, type PreferencesBridge } from './platform/app-preferences';
import './client-behavior-settings.css';

type Props = { connected: boolean; onDownload?: () => void };
type SettingKey = keyof AppPreferences;
const startupSettings: { key: SettingKey; title: string; help: string }[] = [
  { key: 'autoLaunch', title: '开机自启', help: '登录这台电脑后自动打开小伴。' },
  { key: 'startMinimized', title: '启动时最小化', help: '启动后藏到托盘，不会自动登录账号。' },
];
const windowSettings: { key: SettingKey; title: string; help: string }[] = [
  { key: 'showPetOnLaunch', title: '启动显示桌宠', help: '打开小伴时显示独立桌宠窗口。' },
  { key: 'closeToTray', title: '关闭主窗口留在托盘', help: '关掉后，关闭窗口会退出应用并中断本机任务连接。' },
  { key: 'petAlwaysOnTop', title: '桌宠始终置顶', help: '让独立桌宠窗口显示在其他窗口上方。' },
];

function sessionScope() {
  const identity = getIdentity();
  return `${getSessionEpoch()}:${identity?.instanceId || ''}:${identity?.userId || ''}`;
}

function clientBridge(): PreferencesBridge | undefined {
  const bridge = (window.petpal as (typeof window.petpal & { preferences?: PreferencesBridge }))?.preferences;
  return bridge && typeof bridge.status === 'function' && typeof bridge.update === 'function' ? bridge : undefined;
}

export default function ClientBehaviorSettings({ connected, onDownload }: Props) {
  const scope = useSyncExternalStore(subscribeSession, sessionScope, sessionScope);
  const bridge = clientBridge(), desktop = !!window.petpal, android = supportsTaskNotifications();
  const id = useId();
  const [snapshot, setSnapshot] = useState<{ scope: string; status: AppPreferencesStatus } | null>(null);
  const [busy, setBusy] = useState<'load' | SettingKey | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [feedbackScope, setFeedbackScope] = useState(scope);
  const generation = useRef(0), operation = useRef(false);
  const status = snapshot?.scope === scope ? snapshot.status : null;
  const current = (revision: number) => revision === generation.current && connected && scope === sessionScope();

  async function load() {
    if (!connected || !bridge || operation.current || scope !== sessionScope()) return;
    const revision = generation.current;
    operation.current = true; setFeedbackScope(scope); setBusy('load'); setError(''); setNotice('');
    try {
      const next = readAppPreferencesStatus(await bridge.status());
      if (current(revision)) setSnapshot({ scope, status: next });
    } catch {
      if (current(revision)) { setSnapshot(null); setError('无法读取这台电脑的设置，请重新读取。'); }
    } finally {
      if (current(revision)) { operation.current = false; setBusy(null); }
    }
  }

  useEffect(() => {
    ++generation.current; operation.current = false;
    setSnapshot(null); setFeedbackScope(scope); setBusy(null); setError(''); setNotice('');
    if (connected && bridge) void load();
    return () => { ++generation.current; };
  }, [connected, scope, bridge]);

  async function update(key: SettingKey, value: boolean) {
    if (!connected || !bridge || !status || operation.current || scope !== sessionScope()
      || (key === 'autoLaunch' && !status.autoLaunchSupported)) return;
    const revision = generation.current;
    operation.current = true; setFeedbackScope(scope); setBusy(key); setError(''); setNotice('');
    let submitted = false;
    try {
      await bridge.update({ [key]: value }); submitted = true;
      if (!current(revision)) return;
      // Read back the operating system state instead of displaying an optimistic update.
      const next = readAppPreferencesStatus(await bridge.status());
      if (!current(revision)) return;
      setSnapshot({ scope, status: next });
      if (next[key] === value) setNotice('设置已保存到这台电脑。');
      else setError('设置未生效，已显示这台电脑的实际状态。');
    } catch {
      if (current(revision)) {
        setSnapshot(null);
        setError(submitted ? '未能确认设置是否保存，请重新读取这台电脑的设置。' : '未能保存设置，请重新读取后重试。');
      }
    } finally {
      if (current(revision)) { operation.current = false; setBusy(null); }
    }
  }

  function rows(settings: typeof startupSettings) {
    return settings.map(setting => {
      const unsupported = setting.key === 'autoLaunch' && !status?.autoLaunchSupported;
      const disabled = !connected || !status || !!busy || unsupported;
      const help = setting.key === 'autoLaunch' && status?.autoLaunchReason ? status.autoLaunchReason : unsupported ? '当前安装方式不支持系统自启，请使用正式安装包。' : setting.help;
      const helpId = `${id}-${setting.key}-help`;
      return <label key={setting.key} className={`client-behavior-row${disabled ? ' is-disabled' : ''}`}>
        <span className="client-behavior-copy"><strong>{setting.title}</strong><small id={helpId}>{help}</small></span>
        <span className="client-behavior-control">
          <input type="checkbox" role="switch" aria-label={setting.title} aria-describedby={helpId} checked={status?.[setting.key] ?? false} disabled={disabled} onChange={event => void update(setting.key, event.target.checked)} />
          <span className="client-behavior-switch" aria-hidden="true" />
          {busy === setting.key && <Loader2 size={13} className="client-behavior-saving spin" aria-hidden="true" />}
        </span>
      </label>;
    });
  }

  return <>
    <section className="settings-section client-behavior-settings" aria-label="启动与窗口" aria-busy={!!busy}>
      <div className="section-title"><div><h2>启动与窗口</h2><p>{android ? '检查这部手机的自启动与后台提醒。' : desktop ? '设置只应用于这台电脑。' : '系统自启与独立桌宠窗口需要桌面客户端。'}</p></div><Settings2 size={22} aria-hidden="true" /></div>
      {!connected ? <p className="client-behavior-note">登录后可以管理本设备的启动与窗口设置。</p> : android ? <p className="client-behavior-note">手机的自启动和省电限制由系统管理，可在下方“后台任务提醒”中打开对应设置。手机重启后仍需打开小伴并检查提醒状态。</p> : !desktop ? <>
        <p className="client-behavior-note">浏览器不能设置系统开机自启。使用 Windows 或 Ubuntu 客户端后，可在这里管理。</p>
        {onDownload && <button type="button" className="secondary-button" onClick={onDownload}><Download size={15} aria-hidden="true" />下载桌面客户端</button>}
      </> : !bridge ? <p className="client-behavior-note">当前客户端还不支持这些设置，请更新客户端后使用。</p> : <>
        {status && <div className="client-behavior-groups"><fieldset><legend>启动</legend>{rows(startupSettings)}</fieldset><fieldset><legend>窗口</legend>{rows(windowSettings)}</fieldset></div>}
        {busy === 'load' && <p className="client-behavior-state" role="status"><Loader2 size={15} className="spin" aria-hidden="true" />正在读取本机设置…</p>}
        {feedbackScope === scope && error && <p className="form-error" role="alert">{error}</p>}
        {feedbackScope === scope && notice && <p className="client-behavior-state" role="status">{notice}</p>}
        <div className="client-behavior-footer"><span>每项更改会自动保存。</span><button type="button" className="secondary-button" disabled={!!busy} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />重新读取</button></div>
      </>}
    </section>
    {android && <TaskNotificationsSettings connected={connected} />}
  </>;
}
