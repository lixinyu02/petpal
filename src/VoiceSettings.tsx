import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Loader2, Mic, Play, RefreshCw, Square, Upload, Volume2 } from 'lucide-react';
import { api, getSessionEpoch, isSessionChanged, type CosyVoiceConfig, type VoiceConfig, type VoiceConnectionFields } from './api';
import { useSpeech } from './avatar/useSpeech';
import MediaDevicesSettings from './MediaDevicesSettings';
import './voice-settings.css';

type CosyDraft = {baseUrl:string;referenceText:string;apiKey:string;clearApiKey:boolean};
const clean = (value:VoiceConfig):VoiceConfig => ({...value,tts:{...value.tts,apiKey:'',clearApiKey:false},asr:{...value.asr,apiKey:'',clearApiKey:false}});
const cosyDraft = (value:CosyVoiceConfig):CosyDraft => ({baseUrl:value.baseUrl,referenceText:value.referenceText,apiKey:'',clearApiKey:false});
const changed = () => window.dispatchEvent(new Event('petpal:voice-settings-change'));
const defaultPreviewText='你好，我是小伴。今天也一起慢慢来吧。';

export default function VoiceSettings({connected,scope='guest'}:{connected:boolean;scope?:string}) {
  const [config,setConfig]=useState<VoiceConfig|null>(null),[cosy,setCosy]=useState<CosyVoiceConfig|null>(null);
  const [shared,setShared]=useState<CosyDraft|null>(null),[reference,setReference]=useState<File|null>(null);
  const [voiceDirty,setVoiceDirty]=useState(false),[cosyDirty,setCosyDirty]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [previewText,setPreviewText]=useState(defaultPreviewText);
  const alive=useRef(false),revision=useRef(0),request=useRef<AbortController|null>(null),fileInput=useRef<HTMLInputElement>(null);
  const epoch=getSessionEpoch();
  const speech=useSpeech(connected,scope);
  async function run<T,>(work:(signal:AbortSignal)=>Promise<T>,accept:(result:T)=>void) {
    if(!connected||!alive.current||getSessionEpoch()!==epoch)return;
    request.current?.abort();speech.stop();
    const controller=new AbortController(),id=++revision.current;request.current=controller;
    const current=()=>alive.current&&!controller.signal.aborted&&revision.current===id&&getSessionEpoch()===epoch;
    setBusy(true);setError('');setMessage('');
    try{const result=await work(controller.signal);if(current())accept(result);}
    catch(error){if(current()&&!isSessionChanged(error))setError((error as Error).message);}
    finally{if(current()){request.current=null;setBusy(false);}}
  }
  function load(){return run(signal=>Promise.all([api<VoiceConfig>('/voice',{signal}),api<CosyVoiceConfig>('/voice/cosyvoice',{signal})]),([voice,service])=>{
    setConfig(clean(voice));setCosy(service);setShared(cosyDraft(service));setVoiceDirty(false);setCosyDirty(false);setReference(null);if(fileInput.current)fileInput.current.value='';changed();
  });}
  useEffect(()=>{
    alive.current=true;
    setConfig(null);setCosy(null);setShared(null);setReference(null);setPreviewText(defaultPreviewText);setVoiceDirty(false);setCosyDirty(false);setError('');setMessage('');setBusy(false);
    if(fileInput.current)fileInput.current.value='';
    if(connected)void load();
    return()=>{alive.current=false;++revision.current;request.current?.abort();speech.stop();};
  },[connected,scope,epoch]);
  function update(section:'tts'|'asr',patch:Record<string,unknown>){setConfig(previous=>previous?{...previous,[section]:{...previous[section],...patch}}:previous);setVoiceDirty(true);setMessage('');speech.stop();}
  function updateShared(patch:Partial<CosyDraft>){setShared(previous=>previous?{...previous,...patch}:previous);setCosyDirty(true);setMessage('');speech.stop();}
  async function save(event:FormEvent){
    event.preventDefault();if(!config)return;
    const fields=({hasApiKey:_saved,...value}:VoiceConnectionFields)=>value;
    await run(signal=>api<VoiceConfig>('/voice',{method:'PATCH',body:JSON.stringify({tts:fields(config.tts),asr:fields(config.asr)}),signal}),result=>{
      setConfig(clean(result));setVoiceDirty(false);changed();setMessage(result.tts.mode==='cosyvoice'?'已保存到当前账号。点击试听可调用 CosyVoice；自动朗读仍由你手动开启。':result.tts.mode==='system'?'已保存，使用设备本地语音。':'已保存预备配置；通用远程 TTS 和 ASR 尚未接入。');
    });
  }
  async function saveShared(event:FormEvent){
    event.preventDefault();if(!cosy?.editable||!shared)return;
    if(shared.apiKey.trim()&&shared.clearApiKey){setError('替换密钥和清除密钥只能选择一项。');return;}
    const body={baseUrl:shared.baseUrl.trim(),referenceText:shared.referenceText.trim(),revision:cosy.revision,...(shared.apiKey.trim()?{apiKey:shared.apiKey.trim()}:{}),...(shared.clearApiKey?{clearApiKey:true}:{})};
    await run(signal=>api<CosyVoiceConfig>('/voice/cosyvoice',{method:'PATCH',body:JSON.stringify(body),signal}),result=>{
      setCosy(result);setShared(cosyDraft(result));setCosyDirty(false);setMessage('CosyVoice 服务配置已保存。参考声音供已登录账号使用。');changed();
    });
  }
  async function upload(){
    if(!reference||!cosy?.editable)return;
    if(!reference.size||reference.size>5*1024*1024){setError('请选择不超过 5 MiB 的有效 WAV 文件。');return;}
    await run(signal=>api<CosyVoiceConfig>('/voice/cosyvoice/reference',{method:'POST',headers:{'Content-Type':'audio/wav'},body:reference,signal}),result=>{
      setCosy(result);setShared(cosyDraft(result));setCosyDirty(false);setReference(null);if(fileInput.current)fileInput.current.value='';setMessage('参考 WAV 已上传。请核对参考文本与音频一致，再保存并试听。');changed();
    });
  }
  const remoteFields=(section:'tts'|'asr')=>{
    if(!config)return null;const item=config[section],label=section.toUpperCase();
    return <div className="voice-remote-fields">
      <label>{label} 服务地址<input type="url" required maxLength={2048} placeholder="https://speech.example.com/v1" value={item.baseUrl} onChange={event=>update(section,{baseUrl:event.target.value})}/></label>
      <label>{label} 模型 ID<input required maxLength={160} placeholder="填写服务商提供的模型 ID" value={item.model} onChange={event=>update(section,{model:event.target.value})}/></label>
      <label>{label} API Key<input type="password" autoComplete="new-password" maxLength={8192} disabled={item.clearApiKey} value={item.apiKey||''} placeholder={item.hasApiKey?'已保存，留空保留':'无需认证的本地服务可留空'} onChange={event=>update(section,{apiKey:event.target.value})}/></label>
      {item.hasApiKey&&<label className="voice-clear-key"><input type="checkbox" checked={!!item.clearApiKey} onChange={event=>update(section,{clearApiKey:event.target.checked,apiKey:''})}/>清除已保存的 {label} 密钥</label>}
      <p className="field-help">更换服务地址时，请重新填写密钥或明确清除旧密钥。通用远程接口仍只保存配置。</p>
    </div>;
  };
  return <section className="settings-section voice-settings" aria-label="语音服务配置">
    <div className="section-title"><div><h2>声音与倾听</h2><p>为当前账号选择声音，在需要时听小伴朗读。</p></div><button type="button" className="secondary-button" disabled={busy||!connected} onClick={()=>void load()}><RefreshCw size={14}/>重新读取</button></div>
    <div className="voice-runtime-note"><strong>系统语音与 CosyVoice 可用于朗读</strong><p>CosyVoice 会在你点击试听、朗读，或主动开启自动朗读后，将相应文字发送到管理员配置的语音服务。正常语速支持边生成边播放，口型跟随声音起伏。ASR 仍为预备配置，不会自动录音。</p></div>
    {error&&<div className="form-error" role="alert">{error}</div>}
    {message&&<p className="voice-saved" role="status"><Check size={16}/>{message}</p>}
    {connected&&!config&&!error&&<p role="status"><Loader2 size={16} className="spin"/>正在读取语音配置…</p>}
    <MediaDevicesSettings key={scope} scope={scope}/>
    {config&&<form onSubmit={save}>
      <fieldset disabled={busy||!connected} className="voice-config-block"><legend><Volume2 size={19}/>TTS · 让小伴说话</legend>
        <label>朗读引擎<select aria-label="朗读引擎" value={config.tts.mode} onChange={event=>update('tts',{mode:event.target.value,...(event.target.value==='cosyvoice'?{speed:Math.min(2,Math.max(.5,config.tts.speed))}:{})})}><option value="system">设备本地语音</option><option value="cosyvoice">CosyVoice 参考声音</option><option value="remote">通用远程 TTS（预备配置）</option></select></label>
        {config.tts.mode==='system'?<p className="field-help">可用音色由设备提供，使用系统默认扬声器。保存后在首页开启「语音朗读」，或在聊天页开启「自动朗读回复」。</p>:config.tts.mode==='cosyvoice'?<><label>CosyVoice 语速<input aria-label="CosyVoice 语速" type="number" min="0.5" max="2" step="0.05" required value={config.tts.speed} onChange={event=>update('tts',{speed:Number(event.target.value)})}/></label><p className="field-help">1.0 倍速支持流式播放，收到首段就开始朗读；其他语速使用完整合成。每次最多 1000 个字符。音频使用本账号选择的扬声器，不依赖本地中文语音包。</p></>:<>{remoteFields('tts')}<div className="voice-fields-pair"><label>音色 ID<input maxLength={160} value={config.tts.voice} placeholder="服务商音色 ID，可留空" onChange={event=>update('tts',{voice:event.target.value})}/></label><label>语速<input type="number" min="0.25" max="4" step="0.05" required value={config.tts.speed} onChange={event=>update('tts',{speed:Number(event.target.value)})}/></label></div></>}
      </fieldset>
      <fieldset disabled={busy||!connected} className="voice-config-block"><legend><Mic size={19}/>ASR · 语音识别预备</legend>
        <label>计划使用的识别引擎<select value={config.asr.mode} onChange={event=>update('asr',{mode:event.target.value})}><option value="disabled">暂不配置语音识别</option><option value="browser">浏览器识别（预备配置）</option><option value="remote">远程 ASR（预备配置）</option></select></label>
        {config.asr.mode!=='disabled'&&<label>识别语言<input maxLength={35} value={config.asr.language} placeholder="例如 zh-CN，留空由服务检测" onChange={event=>update('asr',{language:event.target.value})}/></label>}
        {config.asr.mode==='remote'&&remoteFields('asr')}
        <p className="field-help">语音识别尚未接入；此处保存选择不会申请麦克风权限。</p>
      </fieldset>
      <p className="field-help">朗读引擎和语速只影响当前账号。自动朗读默认关闭。</p>
      <button className="primary-button" disabled={busy||!connected}>{busy?<Loader2 size={16} className="spin"/>:<Check size={16}/>}保存语音配置</button>
    </form>}
    {cosy&&<section className="cosyvoice-section" aria-label="CosyVoice 服务与试听">
      <div className="section-title"><div><h2>CosyVoice 声音</h2><p>{cosy.editable?'由你管理服务地址与参考声音。':'使用管理员提供的服务与参考声音。'}</p></div><span className="voice-preparing">{cosy.configured?'服务已配置':'等待配置'}</span></div>
      <p className="field-help">{cosy.hasReference?'已保存参考 WAV':'尚未上传参考 WAV'}{cosy.referenceName?` · ${cosy.referenceName}`:''}。{!cosy.configured&&'需要服务地址、参考声音和对应参考文本才能合成。'}</p>
      {cosy.editable&&shared&&<>
        <form onSubmit={saveShared}><fieldset disabled={busy||!connected} className="voice-config-block">
          <label>CosyVoice 服务地址<input type="url" required maxLength={2048} placeholder="https://voice.example.com" value={shared.baseUrl} onChange={event=>updateShared({baseUrl:event.target.value})}/></label>
          <label>服务 API Key<input type="password" autoComplete="new-password" maxLength={8192} disabled={shared.clearApiKey} value={shared.apiKey} placeholder={cosy.hasApiKey?'已保存，留空保留':'服务无需认证时可留空'} onChange={event=>updateShared({apiKey:event.target.value})}/></label>
          {cosy.hasApiKey&&<label className="voice-clear-key"><input type="checkbox" checked={shared.clearApiKey} onChange={event=>updateShared({clearApiKey:event.target.checked,apiKey:''})}/>清除已保存的服务密钥</label>}
          <label>参考音频对应的文字<textarea rows={3} maxLength={1000} value={shared.referenceText} placeholder="准确填写参考 WAV 中说出的内容" onChange={event=>updateShared({referenceText:event.target.value})}/></label>
          <p className="field-help">保存不会合成语音。更换服务地址时，请重新填写密钥或明确清除旧密钥。</p>
          <button className="primary-button" disabled={busy||!connected}><Check size={16}/>保存 CosyVoice 服务</button>
        </fieldset></form>
        <div className="voice-config-block cosyvoice-upload"><label>参考 WAV<input ref={fileInput} type="file" accept=".wav,audio/wav,audio/x-wav" disabled={busy||!connected} onChange={event=>{speech.stop();setReference(event.target.files?.[0]||null);setError('');}}/></label><p className="field-help">上传你有权使用的声音：PCM WAV、1–30 秒、采样率至少 16 kHz，文件不超过 5 MiB。已有服务设置改动请先保存。</p><button type="button" className="secondary-button" disabled={busy||!connected||!reference||cosyDirty} onClick={()=>void upload()}><Upload size={15}/>上传参考声音</button></div>
      </>}
      <div className="voice-config-block cosyvoice-preview"><label>试听内容<textarea aria-label="CosyVoice 试听内容" rows={3} maxLength={1000} value={previewText} onChange={event=>{speech.stop();setPreviewText(event.target.value);}}/></label><div className="voice-preview-actions"><button type="button" className="secondary-button" disabled={busy||!connected||!cosy.configured||voiceDirty||cosyDirty||speech.engine!=='cosyvoice'||!speech.supported||speech.playing||!previewText.trim()} onClick={()=>speech.speak(previewText,`cosy-preview-${Date.now()}`)}>{speech.pending?<Loader2 size={15} className="spin"/>:<Play size={15}/>}合成并试听</button>{speech.playing&&<button type="button" className="secondary-button" onClick={speech.stop}><Square size={14}/>停止试听</button>}</div><p className="field-help">先选择 CosyVoice 并保存语音配置，再点击试听；使用已保存的参考声音。1.0 倍速边生成边播放，其他语速等待完整合成。</p>{(speech.engine==='cosyvoice'||speech.playing||speech.error)&&<p className="voice-saved" role="status">{speech.feedback}</p>}</div>
    </section>}
  </section>;
}
