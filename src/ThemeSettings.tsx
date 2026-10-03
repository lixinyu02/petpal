import { useId } from 'react';
import { Clock3, Moon, Sun } from 'lucide-react';
import { setThemePreference, useTheme, type ThemePreference } from './platform/theme.ts';

const choices = [{ value: 'auto', title: '自动', Icon: Clock3 }, { value: 'day', title: '日间', Icon: Sun }, { value: 'night', title: '夜间', Icon: Moon }] as const;

export default function ThemeSettings({ connected }: { connected: boolean }) {
  const state = useTheme(), id = useId();
  return <section className="settings-section theme-settings" aria-label="外观">
    <div className="section-title"><div><h2>外观</h2><p>按这台设备的时间调整界面，也可以固定日间或夜间。</p></div>{state.theme === 'night' ? <Moon size={22} aria-hidden="true" /> : <Sun size={22} aria-hidden="true" />}</div>
    <fieldset className="theme-choices" disabled={!connected} aria-describedby={`${id}-theme-help`}><legend className="theme-visually-hidden">界面主题</legend>{choices.map(({ value, title, Icon }) => <label key={value} className="theme-choice">
      <input type="radio" name={`${id}-theme`} value={value} checked={state.preference === value} onChange={() => { if (connected) setThemePreference(value as ThemePreference); }} />
      <span><Icon size={17} aria-hidden="true" />{title}</span>
    </label>)}</fieldset>
    <p className="theme-help" id={`${id}-theme-help`}>自动按本机时间切换：07:00–19:00 日间，其余时间夜间。</p>
    <p className="theme-current" role="status">当前：{state.theme === 'night' ? '夜间' : '日间'}{state.preference === 'auto' ? ' · 自动切换' : ' · 手动选择'}{!state.saved && '。当前会话可用，未能保存到此设备。'}</p>
  </section>;
}
