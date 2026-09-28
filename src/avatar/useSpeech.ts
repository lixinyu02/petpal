import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiBlob, getConnection, getSessionEpoch, isSessionChanged, type VoiceConfig } from '../api';
import { createDevicePreferences } from '../media/device-preferences.mjs';
import { createSpeechController, selectSpeechVoice, type SpeechState } from './speech.mjs';
import { createRemoteSpeechController } from './remote-speech.mjs';

const initial: SpeechState = { utteranceId: '', text: '', active: false, pending: false, charIndex: 0, ended: true, progressBasis: 'none', voiceName: '', error: '' };
type Engine = VoiceConfig['tts']['mode'] | 'loading';
export function useSpeech(allowed: boolean, scope = 'guest') {
  const [enabled, updateEnabled] = useState(false);
  const [state, setState] = useState<SpeechState>(initial);
  const [engine, setEngine] = useState<Engine>('loading');
  const [supported, setSupported] = useState(false);
  const [hasChineseVoice, setChineseVoice] = useState(false);
  const [configError, setConfigError] = useState('');
  const enabledRef = useRef(false), allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const controller = useRef<ReturnType<typeof createSpeechController> | ReturnType<typeof createRemoteSpeechController> | null>(null);
  useEffect(() => {
    let live = true, revision = 0, loading:AbortController|undefined;
    const epoch = getSessionEpoch();
    const current = () => live && getSessionEpoch() === epoch;
    enabledRef.current = false; updateEnabled(false); setState(initial);
    const systemAvailable = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
    const synthesis = systemAvailable ? window.speechSynthesis : undefined;
    const refreshVoices = () => { if(current())try { setChineseVoice(Boolean(synthesis && selectSpeechVoice(synthesis.getVoices(), 'zh'))); } catch { setChineseVoice(false); } };
    const onState = (next:SpeechState) => { if (current()) setState(next); };
    function install(mode:VoiceConfig['tts']['mode']) {
      controller.current?.dispose(); controller.current = null; setState(initial); setEngine(mode); setConfigError('');
      if(mode === 'cosyvoice') {
        const available = typeof Audio === 'function' && typeof URL.createObjectURL === 'function';
        setSupported(available);
        if(available)controller.current = createRemoteSpeechController({
          requestAudio:(text,signal)=>apiBlob('/voice/synthesize',{method:'POST',body:JSON.stringify({text}),signal}),
          createAudio:()=>new Audio(),createObjectURL:blob=>URL.createObjectURL(blob),revokeObjectURL:url=>URL.revokeObjectURL(url),
          getSpeakerId:()=>{
            let storage:Storage|undefined;try{storage=window.localStorage;}catch{}
            const preferences=createDevicePreferences(storage,scope);
            try{return preferences.read().speakerId;}finally{preferences.dispose();}
          },onState,
        });
      } else if(mode === 'system') {
        setSupported(systemAvailable);
        controller.current=createSpeechController({synthesis,createUtterance:systemAvailable?text=>new SpeechSynthesisUtterance(text):undefined,onState});
      } else setSupported(false);
    }
    async function load() {
      const requestRevision=++revision;loading?.abort();controller.current?.stop();
      if(!getConnection().token){install('system');return;}
      const request=new AbortController();loading=request;setEngine('loading');setSupported(false);setConfigError('');
      try{
        const saved=await api<VoiceConfig>('/voice',{signal:request.signal});
        if(current()&&!request.signal.aborted&&requestRevision===revision)install(saved.tts.mode);
      }catch(error){if(current()&&!request.signal.aborted&&!isSessionChanged(error)&&requestRevision===revision){setConfigError('读取朗读设置失败，请在语音与设备中重新读取。');setSupported(false);}}
    }
    const hidden = () => { if (document.hidden) controller.current?.stop(); };
    const leaving = () => controller.current?.stop();
    const sessionChanged = () => { loading?.abort();controller.current?.stop();enabledRef.current=false;updateEnabled(false); };
    const configChanged = () => { if(current())void load(); };
    refreshVoices();void load();synthesis?.addEventListener('voiceschanged',refreshVoices);
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leaving);
    window.addEventListener('petpal:session-change',sessionChanged);window.addEventListener('petpal:voice-settings-change',configChanged);
    return()=>{
      live=false;loading?.abort();controller.current?.dispose();controller.current=null;
      synthesis?.removeEventListener('voiceschanged',refreshVoices);
      document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leaving);
      window.removeEventListener('petpal:session-change',sessionChanged);window.removeEventListener('petpal:voice-settings-change',configChanged);
    };
  },[scope]);
  const stop=useCallback(()=>controller.current?.stop(),[]);
  useEffect(()=>{if(!allowed)stop();},[allowed,stop]);
  const setEnabled=useCallback((value:boolean)=>{enabledRef.current=value;updateEnabled(value);if(!value)stop();},[stop]);
  const speak=useCallback((text:string,utteranceId:string)=>{
    if(!allowedRef.current||document.hidden||!supported)return false;
    return controller.current?.speak({text,utteranceId,language:navigator.language})??false;
  },[supported]);
  const speakIfEnabled=useCallback((text:string,utteranceId:string)=>enabledRef.current?speak(text,utteranceId):false,[speak]);
  const feedback=state.error||configError||(engine==='loading'?'正在读取已保存的朗读设置…':engine==='remote'?'远程 TTS 仍为预备配置，请选择系统语音或 CosyVoice。':!supported?'此环境无法播放所选语音，请检查设备或浏览器。':engine==='cosyvoice'?(state.pending?'正在合成 CosyVoice 语音…':state.active?'CosyVoice 播放中 · 口型按音频时间近似同步':'使用已保存的 CosyVoice 音色与语速；播放时口型近似同步。'):!hasChineseVoice?'未检测到本地中文音色；可安装系统中文语音包或选择 CosyVoice。':state.pending?'正在准备本地语音…':state.active?`正在朗读 · ${state.voiceName}`:'使用本地系统音色，跟随系统默认输出。');
  return{...state,enabled,supported,hasChineseVoice,engine,feedback,playing:state.active||state.pending,setEnabled,stop,speak,speakIfEnabled};
}
