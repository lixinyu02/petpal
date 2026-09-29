import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Loader2, Mic, Radio } from 'lucide-react';
import { api, getSessionEpoch, isSessionChanged, type AsrConfig } from './api';

export default function AsrSettings({ connected, scope }: { connected:boolean; scope:string }) {
  const [config, setConfig] = useState<AsrConfig|null>(null);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const request = useRef<AbortController|null>(null), generation = useRef(0);
  const epoch = getSessionEpoch();
  async function run<T,>(work:(signal:AbortSignal)=>Promise<T>, accept:(value:T)=>void) {
    if (!connected || epoch !== getSessionEpoch()) return;
    request.current?.abort();
    const controller = new AbortController(), id = ++generation.current;
    request.current = controller; setBusy(true); setError(''); setMessage('');
    const current = () => id === generation.current && epoch === getSessionEpoch() && !controller.signal.aborted;
    try { const value = await work(controller.signal); if (current()) accept(value); }
    catch (cause) { if (current() && !isSessionChanged(cause)) setError((cause as Error).message); }
    finally { if (current()) { request.current = null; setBusy(false); } }
  }
  const acceptConfig = (value:AsrConfig) => { setConfig(value); setAddress(value.baseUrl); };
  useEffect(() => {
    setConfig(null); setAddress(''); setError(''); setMessage('');
    if (connected) void run(signal => api<AsrConfig>('/voice/asr', {signal}), acceptConfig);
    return () => { ++generation.current; request.current?.abort(); };
  }, [connected, scope, epoch]);
  function save(event:FormEvent) {
    event.preventDefault(); if (!config?.editable) return;
    void run(signal => api<AsrConfig>('/voice/asr', {method:'PATCH', body:JSON.stringify({baseUrl:address.trim(), revision:config.revision}), signal}), value => {
      acceptConfig(value); setMessage('识别服务已保存。回到伙伴页，点击语音聊天即可开始。');
      window.dispatchEvent(new Event('petpal:voice-settings-change'));
    });
  }
  function test() {
    void run(signal => api<{ok?:boolean;busy?:boolean}>('/voice/asr/test', {method:'POST',body:'{}',signal}), value => {
      setMessage(value.busy ? '服务已连接，目前有其他语音会话，稍后即可使用。' : '服务已连接，流式语音识别可用。');
    });
  }
  return <section className="asr-settings" aria-label="流式语音识别服务">
    <div className="section-title"><div><h2><Mic size={18}/>语音聊天 · 倾听服务</h2><p>说出想法，让伙伴听懂并用声音回应。</p></div><span className="voice-preparing">{config?.configured ? '服务已配置' : '等待配置'}</span></div>
    <p className="field-help">开启语音聊天后使用 VibeVoice 识别，回复由当前账号的 CosyVoice 声音朗读。只有你主动开启时才会使用麦克风；结束或离开页面会停止收音。</p>
    {config?.editable && <form onSubmit={save}><fieldset className="voice-config-block" disabled={busy || !connected}>
      <label>VibeVoice ASR 服务地址<input type="url" required maxLength={2048} value={address} placeholder="http://192.168.60.10:40000" onChange={event => setAddress(event.target.value)}/></label>
      <p className="field-help">由小伴后端连接该服务，网页和手机无需直接访问内网地址。</p>
      <button className="primary-button" disabled={busy || !connected}><Check size={15}/>保存识别服务</button>
    </fieldset></form>}
    <div className="voice-preview-actions"><button type="button" className="secondary-button" disabled={busy || !connected || !config?.configured || (!!config?.editable && address.trim() !== config.baseUrl)} onClick={test}>{busy ? <Loader2 size={15} className="spin"/> : <Radio size={15}/>}测试识别连接</button><a href="/">回到伙伴，语音聊天 ↗</a></div>
    {message && <p className="voice-saved" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
