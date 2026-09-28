import { useEffect, useRef, useState } from 'react';
import { Camera, Mic, RefreshCw, Square, Volume2 } from 'lucide-react';
import { createDevicePreferences, type DevicePreferences } from './media/device-preferences.mjs';
import { captureDevice, createOutputTestTone, mediaFailure, routeAudioOutput } from './media/devices';

type DeviceField = keyof DevicePreferences;
const defaults: DevicePreferences = { microphoneId: '', cameraId: '', speakerId: '' };

export default function MediaDevicesSettings({ scope }: { scope: string }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [preferences, setPreferences] = useState<DevicePreferences>(defaults);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState<'microphone' | 'camera' | 'speaker' | ''>('');
  const [pending, setPending] = useState(false);
  const [level, setLevel] = useState(0);
  const storage = useRef<ReturnType<typeof createDevicePreferences> | null>(null);
  const mounted = useRef(false), generation = useRef(0), enumeration = useRef(0);
  const stream = useRef<MediaStream | null>(null), context = useRef<AudioContext | null>(null);
  const video = useRef<HTMLVideoElement>(null), audio = useRef<HTMLAudioElement | null>(null);
  const frame = useRef(0), mediaUrl = useRef('');
  const available = window.isSecureContext && !!navigator.mediaDevices?.enumerateDevices;
  const canRouteOutput = typeof (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId === 'function';

  function stop(update = true) {
    ++generation.current; cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    const oldContext = context.current; context.current = null; if (oldContext) void oldContext.close().catch(() => {});
    if (video.current) { video.current.pause(); video.current.srcObject = null; }
    if (audio.current) { audio.current.onended = null; audio.current.onerror = null; audio.current.pause(); audio.current.removeAttribute('src'); audio.current.load(); audio.current = null; }
    if (mediaUrl.current) { URL.revokeObjectURL(mediaUrl.current); mediaUrl.current = ''; }
    if (update && mounted.current) { setActive(''); setPending(false); setLevel(0); }
  }
  async function refresh() {
    if (!available) return;
    const revision = ++enumeration.current;
    try { const listed = await navigator.mediaDevices.enumerateDevices(); if (mounted.current && revision === enumeration.current) setDevices(listed); }
    catch (e) { if (mounted.current && revision === enumeration.current) setError(mediaFailure(e)); }
  }
  useEffect(() => {
    mounted.current = true;
    let local: Storage | undefined; try { local = window.localStorage; } catch { /* Session-only device selection remains available. */ }
    storage.current = createDevicePreferences(local, scope); setPreferences(storage.current.read());
    void refresh();
    const changed = () => { void refresh(); };
    const hidden = () => { if (document.hidden) stop(); };
    const leaving = () => stop();
    const sessionChanged = () => { ++enumeration.current; stop(); setDevices([]); setPreferences(defaults); storage.current?.dispose(); };
    navigator.mediaDevices?.addEventListener('devicechange', changed);
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', leaving); window.addEventListener('petpal:session-change', sessionChanged);
    return () => {
      mounted.current = false; ++enumeration.current; stop(false); storage.current?.dispose(); storage.current = null;
      navigator.mediaDevices?.removeEventListener('devicechange', changed);
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leaving); window.removeEventListener('petpal:session-change', sessionChanged);
    };
  }, [scope]);
  function select(field: DeviceField, value: string) {
    stop(); setError(''); setMessage('设备选择已更新。');
    const next = { ...preferences, [field]: value }; setPreferences(storage.current?.write(next) ?? next);
    if(field==='speakerId')window.dispatchEvent(new Event('petpal:audio-output-change'));
  }
  async function startCapture(kind: 'microphone' | 'camera') {
    stop(); setError(''); setMessage(''); setPending(true);
    const revision = generation.current;
    try {
      const captured = await captureDevice(kind, kind === 'microphone' ? preferences.microphoneId : preferences.cameraId);
      if (!mounted.current || revision !== generation.current || document.hidden) { captured.getTracks().forEach(track => track.stop()); return; }
      stream.current = captured;
      captured.getTracks().forEach(track => track.addEventListener('ended', () => { if (revision === generation.current) { stop(); setError('设备已断开或权限被撤销。'); void refresh(); } }, { once: true }));
      if (kind === 'camera') {
        if (!video.current) throw new Error('预览区域尚未就绪。');
        video.current.srcObject = captured; await video.current.play();
      } else {
        const ctx = new AudioContext(); context.current = ctx; await ctx.resume();
        if (!mounted.current || revision !== generation.current) return;
        const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
        ctx.createMediaStreamSource(captured).connect(analyser);
        const values = new Uint8Array(analyser.fftSize);
        const sample = () => {
          if (!mounted.current || revision !== generation.current) return;
          analyser.getByteTimeDomainData(values);
          const rms = Math.sqrt(values.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / values.length);
          setLevel(Math.min(100, Math.round(rms * 400))); frame.current = requestAnimationFrame(sample);
        }; sample();
      }
      if (!mounted.current || revision !== generation.current) return;
      setActive(kind); setPending(false); setMessage(kind === 'microphone' ? '正在检查输入电平，不录音、不上传，也不会通过扬声器回放。' : '摄像头预览仅在当前页面显示，不拍照、不录制、不上传。');
      void refresh();
    } catch (e) { if (mounted.current && revision === generation.current) { stop(); setError(mediaFailure(e)); } }
  }
  async function testOutput() {
    stop(); setError(''); setMessage(''); setPending(true);
    const revision = generation.current;
    try {
      const player = new Audio(); player.volume = .5; audio.current = player;
      await routeAudioOutput(player, canRouteOutput ? preferences.speakerId : '');
      if (!mounted.current || revision !== generation.current || document.hidden) return;
      mediaUrl.current = URL.createObjectURL(createOutputTestTone()); player.src = mediaUrl.current;
      player.onended = () => { if (revision === generation.current) { stop(); setMessage('测试音播放已结束；请根据实际听到的声音确认输出设备。'); } };
      player.onerror = () => { if (revision === generation.current) { stop(); setError('当前环境无法播放测试音，请检查系统输出设备。'); } };
      await player.play();
      if (mounted.current && revision === generation.current) { setActive('speaker'); setPending(false); setMessage('正在向所选输出播放短测试音。'); }
    } catch (e) { if (mounted.current && revision === generation.current) { stop(); setError(mediaFailure(e)); } }
  }
  const picker = (field: DeviceField, kind: MediaDeviceKind, label: string) => {
    const list = devices.filter(device => device.kind === kind && device.deviceId);
    const selectedValue = field === 'speakerId' && !canRouteOutput ? '' : preferences[field];
    const selectedMissing = selectedValue && !list.some(device => device.deviceId === selectedValue);
    return <label>{label}<select aria-label={label} value={selectedValue} disabled={!available || (field === 'speakerId' && !canRouteOutput)} onChange={event => select(field, event.target.value)}>
      <option value="">系统默认设备</option>
      {selectedMissing && <option value={preferences[field]}>上次选择的设备（未授权或当前未连接）</option>}
      {list.filter(device => device.deviceId !== 'default').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}（名称需设备权限）`}</option>)}
    </select></label>;
  };
  return <section className="media-devices-section" aria-label="输入输出设备">
    <div className="section-title"><div><h2>输入与输出设备</h2><p>设备选择只保存在当前账号的这台设备上。</p></div><button type="button" className="secondary-button" onClick={() => void refresh()} disabled={!available}><RefreshCw size={14}/>刷新设备</button></div>
    {!available && <p className="form-error" role="status">此环境未提供设备访问接口。请使用 HTTPS、本机 localhost，或支持媒体权限的应用环境。</p>}
    <div className="media-device-row"><div><h3><Mic size={18}/>麦克风输入</h3>{picker('microphoneId', 'audioinput', '麦克风')}<meter aria-label="麦克风输入电平" min="0" max="100" value={level}/><span className="field-help">{active === 'microphone' ? `输入电平 ${level}%` : '点击测试时才申请麦克风权限。'}</span></div><button type="button" className="secondary-button" disabled={!available || pending} onClick={() => void startCapture('microphone')}>测试麦克风</button></div>
    <div className="media-device-row"><div><h3><Camera size={18}/>摄像头输入</h3>{picker('cameraId', 'videoinput', '摄像头')}<video ref={video} muted playsInline hidden={active !== 'camera'} aria-label="本地摄像头预览"/><span className="field-help">点击预览时才申请摄像头权限。</span></div><button type="button" className="secondary-button" disabled={!available || pending} onClick={() => void startCapture('camera')}>预览摄像头</button></div>
    <div className="media-device-row"><div><h3><Volume2 size={18}/>扬声器输出</h3>{picker('speakerId', 'audiooutput', '扬声器')}<p className="field-help">{canRouteOutput ? '用于测试音及可指定输出的音频播放。设备名称可能需要麦克风权限后才能显示。' : '此环境只能跟随系统默认输出，请在系统设置中选择扬声器。'}系统语音始终跟随系统输出。CosyVoice 流式播放还需要浏览器支持 Web Audio 输出选择；不支持时会提示你选择系统默认设备。</p></div><button type="button" className="secondary-button" disabled={pending} onClick={() => void testOutput()}>播放测试音</button></div>
    {(active || pending) && <button type="button" className="secondary-button" onClick={() => { stop(); setMessage('设备测试已停止。'); }}><Square size={14}/>停止设备测试</button>}
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="field-help" role="status">{message}</p>}
  </section>;
}
