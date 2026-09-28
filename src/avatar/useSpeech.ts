import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiBlob, apiSpeechStream, getConnection, getIdentity, getSessionEpoch, isSessionChanged, type VoiceConfig } from '../api';
import { createDevicePreferences } from '../media/device-preferences.mjs';
import { createSpeechController, selectSpeechVoice, type SpeechState } from './speech.mjs';
import { createRemoteSpeechController } from './remote-speech.mjs';
import { createStreamingSpeechController } from './stream-speech.mjs';

type PlaybackState = SpeechState & { audioLevel?:number; buffering?:boolean; streaming?:boolean };
const initial: PlaybackState = { utteranceId: '', text: '', active: false, pending: false, charIndex: 0, ended: true, progressBasis: 'none', voiceName: '', error: '' };
type Engine = VoiceConfig['tts']['mode'] | 'loading';
export function useSpeech(allowed: boolean, scope = 'guest') {
  const [enabled, updateEnabled] = useState(false);
  const [state, setState] = useState<PlaybackState>(initial);
  const [streaming, setStreaming] = useState(false);
  const [engine, setEngine] = useState<Engine>('loading');
  const [supported, setSupported] = useState(false);
  const [hasChineseVoice, setChineseVoice] = useState(false);
  const [configError, setConfigError] = useState('');
  const enabledRef = useRef(false), allowedRef = useRef(allowed);
  const preparation = useRef(0);
  allowedRef.current = allowed;
  const controller = useRef<ReturnType<typeof createSpeechController> | ReturnType<typeof createRemoteSpeechController> | ReturnType<typeof createStreamingSpeechController> | null>(null);
  useEffect(() => {
    let live = true, revision = 0, loading:AbortController|undefined;
    const epoch = getSessionEpoch();
    const current = () => live && getSessionEpoch() === epoch;
    enabledRef.current = false; updateEnabled(false); setState(initial);
    const systemAvailable = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
    const synthesis = systemAvailable ? window.speechSynthesis : undefined;
    const refreshVoices = () => { if(current())try { setChineseVoice(Boolean(synthesis && selectSpeechVoice(synthesis.getVoices(), 'zh'))); } catch { setChineseVoice(false); } };
    const onState = (next:PlaybackState) => { if (current()) setState(next); };
    function install(mode:VoiceConfig['tts']['mode'],speed:number) {
      controller.current?.dispose(); controller.current = null; setState(initial); setEngine(mode); setConfigError('');
      setStreaming(mode==='cosyvoice'&&speed===1);
      if(mode === 'cosyvoice') {
        const useStream=speed===1;
        const available = useStream ? typeof AudioContext === 'function' : typeof Audio === 'function' && typeof URL.createObjectURL === 'function';
        setSupported(available);
        const getSpeakerId=()=>{
          let storage:Storage|undefined;try{storage=window.localStorage;}catch{}
          const preferences=createDevicePreferences(storage,scope);
          try{return preferences.read().speakerId;}finally{preferences.dispose();}
        };
        if(available)controller.current = useStream ? createStreamingSpeechController({requestStream:apiSpeechStream,createContext:()=>new AudioContext({latencyHint:'interactive'}),getSpeakerId,onState}) : createRemoteSpeechController({
            requestAudio:(text,signal)=>apiBlob('/voice/synthesize',{method:'POST',body:JSON.stringify({text}),signal}),
            createAudio:()=>new Audio(),createObjectURL:blob=>URL.createObjectURL(blob),revokeObjectURL:url=>URL.revokeObjectURL(url),getSpeakerId,onState,
          });
      } else if(mode === 'system') {
        setSupported(systemAvailable);
        controller.current=createSpeechController({synthesis,createUtterance:systemAvailable?text=>new SpeechSynthesisUtterance(text):undefined,onState});
      } else setSupported(false);
    }
    async function load() {
      const requestRevision=++revision;loading?.abort();controller.current?.stop();
      if(!getConnection().token || !getIdentity()){controller.current?.dispose();controller.current=null;setSupported(false);setEngine('loading');setConfigError('请先登录账号后使用语音。');return;}
      const request=new AbortController();loading=request;setEngine('loading');setSupported(false);setConfigError('');
      try{
        const saved=await api<VoiceConfig>('/voice',{signal:request.signal});
        if(current()&&!request.signal.aborted&&requestRevision===revision)install(saved.tts.mode,saved.tts.speed);
      }catch(error){if(current()&&!request.signal.aborted&&!isSessionChanged(error)&&requestRevision===revision){setConfigError('读取朗读设置失败，请在语音与设备中重新读取。');setSupported(false);}}
    }
    const hidden = () => { if (document.hidden) controller.current?.stop(); };
    const leaving = () => controller.current?.stop();
    const sessionChanged = () => { loading?.abort();controller.current?.stop();enabledRef.current=false;updateEnabled(false); };
    const configChanged = () => { if(current())void load(); };
    const deviceChanged = () => { controller.current?.stop(); };
    refreshVoices();void load();synthesis?.addEventListener('voiceschanged',refreshVoices);
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leaving);
    window.addEventListener('petpal:session-change',sessionChanged);window.addEventListener('petpal:voice-settings-change',configChanged);
    navigator.mediaDevices?.addEventListener('devicechange',deviceChanged);window.addEventListener('petpal:audio-output-change',deviceChanged);
    return()=>{
      live=false;loading?.abort();controller.current?.dispose();controller.current=null;
      synthesis?.removeEventListener('voiceschanged',refreshVoices);
      document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leaving);
      window.removeEventListener('petpal:session-change',sessionChanged);window.removeEventListener('petpal:voice-settings-change',configChanged);
      navigator.mediaDevices?.removeEventListener('devicechange',deviceChanged);window.removeEventListener('petpal:audio-output-change',deviceChanged);
    };
  },[scope]);
  const stop=useCallback(()=>{preparation.current++;controller.current?.stop();},[]);
  useEffect(()=>{if(!allowed)stop();},[allowed,stop]);
  const prepare=useCallback(()=>{
    const active=controller.current,revision=++preparation.current;
    if(enabledRef.current&&allowedRef.current&&!document.hidden&&getConnection().token&&getIdentity()&&active&&'unlock' in active)void active.unlock().then(ok=>{
      if(!ok&&controller.current===active&&preparation.current===revision){enabledRef.current=false;updateEnabled(false);}
    });
  },[]);
  const setEnabled=useCallback((value:boolean)=>{
    if(value&&(!allowedRef.current||!getConnection().token||!getIdentity()))return;
    enabledRef.current=value;updateEnabled(value);if(!value)stop();else prepare();
  },[stop,prepare]);
  const speak=useCallback((text:string,utteranceId:string)=>{
    if(!allowedRef.current||document.hidden||!supported||!getConnection().token||!getIdentity())return false;
    return controller.current?.speak({text,utteranceId,language:navigator.language})??false;
  },[supported]);
  const speakIfEnabled=useCallback((text:string,utteranceId:string)=>enabledRef.current?speak(text,utteranceId):false,[speak]);
  const feedback=state.error||configError||(engine==='loading'?'正在读取已保存的朗读设置…':engine==='remote'?'远程 TTS 仍为预备配置，请选择系统语音或 CosyVoice。':!supported?'此环境无法播放所选语音，请检查设备或浏览器。':engine==='cosyvoice'?(streaming?(state.buffering?'正在缓冲 CosyVoice 音频…':state.pending?'正在接收首段 CosyVoice 音频…':state.active?'CosyVoice 边生成边播放 · 口型跟随声音起伏':'CosyVoice 流式朗读已就绪 · 1.0 倍速，边生成边播放。'):(state.pending?'正在合成完整 CosyVoice 音频…':state.active?'CosyVoice 播放中 · 口型按播放时间近似同步':'当前语速使用完整合成；设为 1.0 倍可边生成边播放。')):!hasChineseVoice?'未检测到本地中文音色；可安装系统中文语音包或选择 CosyVoice。':state.pending?'正在准备本地语音…':state.active?`正在朗读 · ${state.voiceName}`:'使用本地系统音色，跟随系统默认输出。');
  return{...state,enabled,supported,hasChineseVoice,engine,feedback,playing:state.active||state.pending,setEnabled,stop,speak,speakIfEnabled,prepare};
}
