import './avatar-loading.css';
import { avatarPreview } from './preview';

/** A stable portrait while the native rig or its recovery module is loading. */
export default function AvatarLoading({ compact = false }: { compact?: boolean }) {
  return <div className="avatar-loading" data-compact={compact} role="status">
    <img src={avatarPreview} alt="二次元伙伴小伴" width="384" height="576" decoding="async" draggable={false}/>
    <span>正在准备动画…</span>
  </div>;
}
