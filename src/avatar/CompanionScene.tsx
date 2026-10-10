import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { CompanionKind } from '../api';
import type { CubismSceneProps } from './cubism/CubismScene';
import AvatarLoading from './AvatarLoading';
import { avatarPreview } from './preview';
import '../companion.css';
import '../companion-portrait.css';
// The bundled native model retains the original character's neutral proportions.
const CubismScene = lazy(() => import('./cubism/CubismScene'));

class AvatarBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="avatar-module-fallback" role="status"><img src={avatarPreview} alt="二次元伙伴" width="384" height="576"/><p>动画暂时未能加载；请保存输入后刷新页面重试。</p><button type="button" onClick={() => location.reload()}>刷新恢复动画</button></div>;
  }
}

export default function CompanionScene({ kind: _legacyKind, ...props }: CubismSceneProps & { kind?: CompanionKind }) {
  return <AvatarBoundary><Suspense fallback={<AvatarLoading compact={props.compact}/>}><CubismScene {...props}/></Suspense></AvatarBoundary>;
}
