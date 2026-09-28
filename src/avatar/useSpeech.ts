import { useCallback, useEffect, useRef, useState } from 'react';
import { createSpeechController, selectSpeechVoice, type SpeechState } from './speech.mjs';

const initial: SpeechState = { utteranceId: '', text: '', active: false, pending: false, charIndex: 0, ended: true, progressBasis: 'none', voiceName: '', error: '' };
export function useSpeech(allowed: boolean) {
  const [enabled, updateEnabled] = useState(false);
  const [state, setState] = useState<SpeechState>(initial);
  const [supported, setSupported] = useState(false);
  const [hasChineseVoice, setChineseVoice] = useState(false);
  const enabledRef = useRef(false), allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const controller = useRef<ReturnType<typeof createSpeechController> | null>(null);
  useEffect(() => {
    let live = true;
    const supported = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
    setSupported(supported);
    const synthesis = supported ? window.speechSynthesis : undefined;
    const refreshVoices = () => { try { setChineseVoice(Boolean(synthesis && selectSpeechVoice(synthesis.getVoices(), 'zh'))); } catch { setChineseVoice(false); } };
    const engine = createSpeechController({ synthesis, createUtterance: supported ? text => new SpeechSynthesisUtterance(text) : undefined, onState: next => { if (live) setState(next); } });
    controller.current = engine;
    const hidden = () => { if (document.hidden) engine.stop(); };
    const leaving = () => engine.stop();
    refreshVoices(); synthesis?.addEventListener('voiceschanged', refreshVoices);
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', leaving);
    window.addEventListener('petpal:session-change', leaving);
    return () => {
      live = false; engine.dispose(); controller.current = null;
      synthesis?.removeEventListener('voiceschanged', refreshVoices);
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leaving);
      window.removeEventListener('petpal:session-change', leaving);
    };
  }, []);
  const stop = useCallback(() => controller.current?.stop(), []);
  useEffect(() => { if (!allowed) stop(); }, [allowed, stop]);
  const setEnabled = useCallback((value: boolean) => { enabledRef.current = value; updateEnabled(value); if (!value) stop(); }, [stop]);
  const speak = useCallback((text: string, utteranceId: string) => {
    if (!allowedRef.current || document.hidden) return false;
    return controller.current?.speak({ text, utteranceId, language: navigator.language }) ?? false;
  }, []);
  const speakIfEnabled = useCallback((text: string, utteranceId: string) => enabledRef.current ? speak(text, utteranceId) : false, [speak]);
  return { ...state, enabled, supported, hasChineseVoice, playing: state.active || state.pending, setEnabled, stop, speak, speakIfEnabled };
}
