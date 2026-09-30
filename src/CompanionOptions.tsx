import {Cat} from 'lucide-react';
import {useCompanionCatEnabled} from './avatar/preference';

export default function CompanionOptions(){
  const[enabled,setEnabled]=useCompanionCatEnabled();
  return <div className="companion-options">
    <button type="button" className="secondary-button companion-cat-option" role="switch" aria-label="启用 3D 小猫" aria-checked={enabled} onClick={()=>setEnabled(!enabled)}><Cat size={18} aria-hidden="true"/><span>3D 小猫</span><strong>{enabled?'已开启':'已关闭'}</strong></button>
    <p className="field-help">默认使用二次元伙伴。开启后可在首页切换小猫；仅对这台设备的当前账号生效。</p>
  </div>;
}
