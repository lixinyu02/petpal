export const ANDROID_PERMISSION_SETTINGS = Object.freeze(['app','microphone','camera','notifications','task','companion','watch','overlay','install','battery','autostart']);
export const isAndroidPermissionKind = value => ANDROID_PERMISSION_SETTINGS.includes(value);

export function mediaPermissionPresentation(permission, kind) {
  const name = kind === 'camera' ? '摄像头' : '麦克风';
  if (!permission?.supported || permission.state === 'unsupported') return { label:'设备不支持', help:`当前设备未提供${name}。`, action:'none' };
  if (permission.blocked === true) return { label:'系统总开关已关闭', help:`请在系统快捷设置或隐私设置中打开“${name}访问”；应用授权不能代替系统总开关。`, action:'settings' };
  if (permission.state === 'granted') return { label:'已允许', help:'可检查实际访问，完成后立即释放；使用仍受系统隐私开关与一次性授权限制。', action:'request' };
  if (permission.state === 'settings') return { label:'需在系统设置允许', help:`请在小伴的应用权限中允许${name}。`, action:'settings' };
  return { label:permission.state === 'denied' ? '尚未允许' : '按需授权', help:`只检查${name}访问，完成后立即释放，不录制或上传。`, action:'request' };
}
export function notificationChannelPresentation(channel) {
  if (!channel?.created) return '使用此功能时创建';
  return channel.enabled ? '已允许' : '此通知类别已关闭';
}
export function permissionSettingsFeedback(result) {
  if (!result?.opened) return '暂时无法打开设置，请在手机设置中查找“小伴”。';
  if (result.fallback) return result.route === 'android-settings' ? '已打开系统设置，请查找小伴并手动检查。' : '已打开小伴应用信息，请手动检查对应权限。';
  return '已打开系统设置；返回小伴后会重新读取实际状态。';
}

/** A timed out native prompt still owns WebView's media callback until it settles. */
export function createMediaPermissionProbe({getUserMedia,timeoutMs=45000,setTimer=setTimeout,clearTimer=clearTimeout,onSettled=()=>{}}) {
  let occupied=false, disposed=false, activeCancel;
  const stop = stream => { for (const track of stream?.getTracks?.() || []) { try { track.stop(); } catch {} } };
  return {
    pending:()=>occupied,
    request(kind, deviceId='', signal) {
      if (kind !== 'microphone' && kind !== 'camera') return Promise.reject(new TypeError('媒体权限类型无效。'));
      if (disposed || signal?.aborted) return Promise.reject(Object.assign(new Error('权限检查已取消。'),{name:'AbortError'}));
      if (occupied) return Promise.reject(new Error('系统权限窗口仍在处理中，请先完成或关闭系统提示。'));
      occupied=true;
      let done=false,timer;
      return new Promise((resolve,reject)=>{
        const settle=(error)=>{
          if(done)return;done=true;clearTimer(timer);signal?.removeEventListener('abort',cancel);
          if(activeCancel===cancel)activeCancel=undefined;
          error?reject(error):resolve();
        };
        const cancel=()=>settle(Object.assign(new Error('权限检查已取消。'),{name:'AbortError'}));
        activeCancel=cancel;signal?.addEventListener('abort',cancel,{once:true});
        timer=setTimer(()=>settle(new Error('系统权限检查等待较久，请先完成系统提示，再刷新状态。')),timeoutMs);
        const selected=deviceId?{deviceId:{exact:deviceId}}:{};
        let acquisition;
        try { acquisition=getUserMedia(kind==='microphone'?{audio:selected,video:false}:{audio:false,video:selected}); }
        catch(error){occupied=false;settle(error);onSettled();return;}
        Promise.resolve(acquisition).then(stream=>{stop(stream);occupied=false;settle();onSettled();},error=>{occupied=false;settle(error);onSettled();});
      });
    },
    dispose(){disposed=true;activeCancel?.();},
  };
}
