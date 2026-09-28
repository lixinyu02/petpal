export type CaptureKind = 'microphone' | 'camera';

/** Capture is only called by an explicit UI action; callers own and must stop every returned track. */
export async function captureDevice(kind: CaptureKind, deviceId: string): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('设备输入需要 HTTPS 或本机 localhost，以及支持媒体采集的浏览器。');
  const selected = deviceId ? { deviceId: { exact: deviceId } } : {};
  return navigator.mediaDevices.getUserMedia(kind === 'microphone'
    ? { audio: { ...selected, echoCancellation: true, noiseSuppression: true }, video: false }
    : { audio: false, video: { ...selected, width: { ideal: 640 }, height: { ideal: 360 } } });
}

export async function routeAudioOutput(element: HTMLMediaElement, deviceId: string): Promise<void> {
  const target = element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof target.setSinkId === 'function') await target.setSinkId(deviceId);
  else if (deviceId) throw new Error('此环境不能为网页音频单独选择扬声器，请在系统设置中切换输出。');
}

/** Quiet 280 ms PCM tone. No network request or external media is used for the output test. */
export function createOutputTestTone(): Blob {
  const rate = 24000, count = Math.floor(rate * .28), buffer = new ArrayBuffer(44 + count * 2), data = new DataView(buffer);
  const word = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) data.setUint8(offset + i, value.charCodeAt(i)); };
  word(0, 'RIFF'); data.setUint32(4, 36 + count * 2, true); word(8, 'WAVE'); word(12, 'fmt '); data.setUint32(16, 16, true);
  data.setUint16(20, 1, true); data.setUint16(22, 1, true); data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true);
  data.setUint16(32, 2, true); data.setUint16(34, 16, true); word(36, 'data'); data.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const fade = Math.min(1, i / (rate * .02), (count - i) / (rate * .04));
    data.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * fade * .14 * 32767), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function mediaFailure(error: unknown): string {
  const e = error as { name?: string; message?: string };
  if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return '设备权限未获允许。请在浏览器或系统设置中允许后，再点击测试。';
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return '所选设备当前不可用。请重新连接设备，刷新列表后选择。';
  if (e.name === 'NotReadableError' || e.name === 'AbortError') return '设备可能被其他应用占用或已断开，请释放设备后重试。';
  return e.message || '设备测试没有完成，请检查设备和系统权限。';
}
