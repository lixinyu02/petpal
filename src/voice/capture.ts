import { audioLevel, microphoneWorkletSource } from './audio.mjs';
import { mediaFailure } from '../media/devices';

export function createVoiceCapture(options: { onFrame(samples:Float32Array,level:number):void; onError(error:Error):void }) {
  let context:AudioContext|null = null, loaded:Promise<void>|null = null, stream:MediaStream|null = null;
  let source:MediaStreamAudioSourceNode|null = null, worklet:AudioWorkletNode|null = null, gain:GainNode|null = null;
  let revision = 0, disposed = false;
  function detach() {
    if (worklet) { worklet.port.onmessage = null; worklet.port.close(); worklet.disconnect(); worklet = null; }
    source?.disconnect(); source = null; gain?.disconnect(); gain = null;
    if (stream) { for (const track of stream.getTracks()) { track.onended = null; track.stop(); } stream = null; }
  }
  function pause() { revision++; detach(); }
  function stop() { if (disposed) return; disposed = true; pause(); const previous = context; context = null; loaded = null; void previous?.close().catch(()=>{}); }
  // Called before the first await of the explicit start gesture.
  function unlock() {
    if (disposed) return Promise.reject(new DOMException('录音已取消','AbortError'));
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof AudioContext !== 'function' || typeof AudioWorkletNode !== 'function') return Promise.reject(new Error('语音聊天需要 HTTPS 与支持 AudioWorklet 的浏览器。'));
    context ??= new AudioContext({latencyHint:'interactive'});
    return context.resume();
  }
  async function start(deviceId = '') {
    if (disposed) throw new DOMException('录音已取消','AbortError');
    pause(); const token = revision;
    const resumed = unlock(), activeContext = context!;
    void resumed.catch(()=>{});
    let captured:MediaStream|null = null;
    try {
      // Ask during the same gesture; both the microphone and audio output remain explicit.
      const acquisition = navigator.mediaDevices.getUserMedia({video:false,audio:{...(deviceId?{deviceId:{exact:deviceId}}:{}),echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:{ideal:1}}});
      captured = await acquisition;
      if (disposed || token !== revision) throw new DOMException('录音已取消','AbortError');
      stream = captured;
      await resumed;
      if (!loaded) {
        const url = URL.createObjectURL(new Blob([microphoneWorkletSource()],{type:'text/javascript'}));
        loaded = activeContext.audioWorklet.addModule(url).finally(()=>URL.revokeObjectURL(url));
      }
      await loaded;
      if (disposed || token !== revision) throw new DOMException('录音已取消','AbortError');
      if (activeContext.state !== 'running') throw new Error('麦克风音频未能启动，请再次点击开始语音。');
      source = activeContext.createMediaStreamSource(captured);
      worklet = new AudioWorkletNode(activeContext,'petpal-microphone',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
      gain = activeContext.createGain(); gain.gain.value = 0;
      worklet.port.onmessage = event => {
        if (disposed || token !== revision) return;
        try { const samples=event.data;if (!(samples instanceof Float32Array)||samples.length!==6000)throw new Error('麦克风数据格式不正确。');options.onFrame(samples,audioLevel(samples)); }
        catch(error) { pause(); options.onError(error instanceof Error?error:new Error('麦克风处理失败。')); }
      };
      worklet.onprocessorerror = () => { if (!disposed && token===revision) { pause(); options.onError(new Error('麦克风音频处理已停止，请重新开始。')); } };
      source.connect(worklet); worklet.connect(gain); gain.connect(activeContext.destination);
      for (const track of captured.getAudioTracks()) track.onended = () => { if (!disposed && token===revision) { pause(); options.onError(new Error('麦克风已断开，请检查设备后重新开始。')); } };
    } catch(error) {
      // A superseded acquisition owns only its own tracks, not a later recording.
      if (token===revision) detach(); else if(captured)for(const track of captured.getTracks())track.stop();
      if ((error as Error).name==='AbortError') throw error;
      throw new Error(mediaFailure(error));
    }
  }
  return { unlock, start, pause, stop };
}
