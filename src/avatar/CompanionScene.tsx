import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { ComponentProps } from 'react';
import type PetScene from '../pet/PetScene';
import type { CompanionKind } from '../api';
import type { PerformanceInput } from './performance.mjs';
// Keep the coherent original portrait on the public path while the separately
// authored Cubism face is being revised against that character.
const AnimeScene = lazy(() => import('./AnimeScene'));
const CatScene = lazy(() => import('../pet/PetScene'));

class AvatarBoundary extends Component<{ children: ReactNode; kind: CompanionKind }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="avatar-module-fallback" role="status">{this.props.kind !== 'cat' && <img src="/avatars/akari/idle.webp" alt="二次元伙伴"/>}<p>动画暂时未能加载；请保存输入后刷新页面重试。</p><button type="button" onClick={() => location.reload()}>刷新恢复动画</button></div>;
  }
}

export default function CompanionScene({ kind, speaking = false, performanceInput, ...props }: ComponentProps<typeof PetScene> & { kind: CompanionKind; speaking?: boolean; performanceInput?: PerformanceInput }) {
  return <AvatarBoundary key={kind} kind={kind}><Suspense fallback={<div className="avatar-loading" role="status">{kind === 'cat' ? '小猫正在走来…' : '小伴正在走来…'}</div>}>{kind === 'cat' ? <CatScene {...props}/> : <AnimeScene {...props} speaking={speaking} performanceInput={performanceInput}/>}</Suspense></AvatarBoundary>;
}
