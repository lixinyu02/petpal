import {Cat} from 'lucide-react';
import {useEffect} from 'react';
import {Capacitor} from '@capacitor/core';
import {getIdentity,getSessionEpoch} from './api';
import {useCompanionCatEnabled} from './avatar/preference';
import {PetOverlay,showPet} from './platform/overlay';

export default function CompanionOptions(){
  const[enabled,setEnabled]=useCompanionCatEnabled();
  const epoch=getSessionEpoch();
  const ownerIdentity=getIdentity();
  useEffect(()=>{
    if(enabled||!Capacitor.isNativePlatform())return;
    let alive=true;
    // An independent Android overlay cannot receive main-WebView storage events.
    // Update only a currently running cat, using the existing native API.
    void PetOverlay.status().then(status=>{
      if(alive&&getSessionEpoch()===epoch&&getIdentity()===ownerIdentity&&status.running&&status.companionKind==='cat')return showPet({companionKind:'anime'});
    }).catch(()=>{});
    return()=>{alive=false;};
  },[enabled,epoch,ownerIdentity]);
  return <div className="companion-options">
    <button type="button" className="secondary-button companion-cat-option" role="switch" aria-label="启用 3D 小猫" aria-checked={enabled} onClick={()=>setEnabled(!enabled)}><Cat size={18} aria-hidden="true"/><span>3D 小猫</span><strong>{enabled?'已开启':'已关闭'}</strong></button>
    <p className="field-help">默认使用二次元伙伴。开启后可在首页切换小猫；仅对这台设备的当前账号生效。</p>
  </div>;
}
