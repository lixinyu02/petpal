import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Loader2, Mic, RefreshCw, Volume2 } from 'lucide-react';
import { api } from './api';
import MediaDevicesSettings from './MediaDevicesSettings';
import './voice-settings.css';

type ConnectionFields = { baseUrl: string; model: string; hasApiKey?: boolean; apiKey?: string; clearApiKey?: boolean };
type VoiceConfig = {
  tts: ConnectionFields & { mode: 'system' | 'remote'; voice: string; speed: number };
  asr: ConnectionFields & { mode: 'disabled' | 'browser' | 'remote'; language: string };
  runtime?: { tts: string; asr: string; remoteConfiguredOnly: boolean };
};
const clean = (value: VoiceConfig): VoiceConfig => ({
  ...value,
  tts: { ...value.tts, apiKey: '', clearApiKey: false },
  asr: { ...value.asr, apiKey: '', clearApiKey: false },
});

export default function VoiceSettings({ connected, scope = 'guest' }: { connected: boolean; scope?: string }) {
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load(signal?: AbortSignal) {
    setBusy(true); setError('');
    try { const result = await api<VoiceConfig>('/voice', { signal }); if (alive.current && !signal?.aborted) setConfig(clean(result)); }
    catch (e) { if (alive.current && !signal?.aborted) setError((e as Error).message); }
    finally { if (alive.current && !signal?.aborted) setBusy(false); }
  }
  useEffect(() => {
    if (!connected) { setConfig(null); return; }
    const controller = new AbortController(); void load(controller.signal);
    return () => controller.abort();
  }, [connected]);
  function update(section: 'tts' | 'asr', patch: Record<string, unknown>) {
    setConfig(previous => previous ? { ...previous, [section]: { ...previous[section], ...patch } } : previous);
    setMessage('');
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!config) return;
    setBusy(true); setError(''); setMessage('');
    const fields = ({ hasApiKey: _saved, ...value }: ConnectionFields) => value;
    try {
      const result = await api<VoiceConfig>('/voice', { method: 'PATCH', body: JSON.stringify({ tts: fields(config.tts), asr: fields(config.asr) }) });
      if (alive.current) { setConfig(clean(result)); setMessage('已保存到当前账号。远程语音和录音尚未启用。'); }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  const remoteFields = (section: 'tts' | 'asr') => {
    if (!config) return null;
    const item = config[section], label = section.toUpperCase();
    return <div className="voice-remote-fields">
      <label>{label} 服务地址<input type="url" required maxLength={2048} placeholder="https://speech.example.com/v1" value={item.baseUrl} onChange={event => update(section, { baseUrl: event.target.value })}/></label>
      <label>{label} 模型 ID<input required maxLength={160} placeholder="填写服务商提供的模型 ID" value={item.model} onChange={event => update(section, { model: event.target.value })}/></label>
      <label>{label} API Key<input type="password" autoComplete="new-password" maxLength={8192} disabled={item.clearApiKey} value={item.apiKey || ''} placeholder={item.hasApiKey ? '已保存，留空保留' : '无需认证的本地服务可留空'} onChange={event => update(section, { apiKey: event.target.value })}/></label>
      {item.hasApiKey && <label className="voice-clear-key"><input type="checkbox" checked={!!item.clearApiKey} onChange={event => update(section, { clearApiKey: event.target.checked, apiKey: '' })}/>清除已保存的 {label} 密钥</label>}
      <p className="field-help">更换服务地址时，请重新填写密钥或明确清除旧密钥。保存配置不会调用服务。</p>
    </div>;
  };
  return <section className="settings-section voice-settings" aria-label="语音服务配置">
    <div className="section-title"><div><h2>声音与倾听</h2><p>为当前账号准备语音合成与语音识别连接。</p></div><span className="voice-preparing">配置预备</span></div>
    <div className="voice-runtime-note"><strong>当前仍使用设备本地朗读</strong><p>下面的 TTS / ASR 设置会保存到你的账号。远程音色、浏览器识别和录音入口尚未接入运行；保存后不会上传文字、音频或开启麦克风。</p></div>
    {error && <div className="form-error" role="alert">{error}<button type="button" className="secondary-button" disabled={busy || !connected} onClick={() => void load()}><RefreshCw size={14}/>重新读取</button></div>}
    {connected && !config && !error && <p role="status"><Loader2 size={16} className="spin"/>正在读取语音配置…</p>}
    <MediaDevicesSettings key={scope} scope={scope}/>
    {config && <form onSubmit={save}>
      <fieldset disabled={busy || !connected} className="voice-config-block"><legend><Volume2 size={19}/>TTS · 让小伴说话</legend>
        <label>计划使用的朗读引擎<select value={config.tts.mode} onChange={event => update('tts', { mode: event.target.value })}><option value="system">设备本地语音（当前可用）</option><option value="remote">远程 TTS 接口（预备配置）</option></select></label>
        {config.tts.mode === 'system' ? <p className="field-help">在首页打开「语音朗读」，或在聊天页打开「自动朗读回复」。可用音色由设备提供。</p> : <>{remoteFields('tts')}<div className="voice-fields-pair"><label>音色 ID<input maxLength={160} value={config.tts.voice} placeholder="服务商音色 ID，可留空" onChange={event => update('tts', { voice: event.target.value })}/></label><label>语速<input type="number" min="0.25" max="4" step="0.05" required value={config.tts.speed} onChange={event => update('tts', { speed: Number(event.target.value) })}/></label></div></>}
      </fieldset>
      <fieldset disabled={busy || !connected} className="voice-config-block"><legend><Mic size={19}/>ASR · 听懂你说的话</legend>
        <label>计划使用的识别引擎<select value={config.asr.mode} onChange={event => update('asr', { mode: event.target.value })}><option value="disabled">暂不配置语音识别</option><option value="browser">浏览器识别（预备配置）</option><option value="remote">远程 ASR 接口（预备配置）</option></select></label>
        {config.asr.mode !== 'disabled' && <label>识别语言<input maxLength={35} value={config.asr.language} placeholder="例如 zh-CN，留空由服务检测" onChange={event => update('asr', { language: event.target.value })}/></label>}
        {config.asr.mode === 'remote' && remoteFields('asr')}
        {config.asr.mode === 'browser' && <p className="field-help">浏览器识别的可用性和音频处理方式取决于浏览器；本轮只保存选择，不请求麦克风权限。</p>}
      </fieldset>
      <p className="field-help">连接密钥仅由后端保存，页面只显示是否已配置；不同账号的语音配置互相独立。</p>
      {message && <p className="voice-saved" role="status"><Check size={16}/>{message}</p>}
      <button className="primary-button" disabled={busy || !connected}>{busy ? <Loader2 size={16} className="spin"/> : <Check size={16}/>}保存语音配置</button>
    </form>}
  </section>;
}
