import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';
import PetScene from '../pet/PetScene';
import type { CompanionKind } from '../api';
import type { PerformanceInput } from './performance.mjs';
const AnimeScene = lazy(() => import('./AnimeScene'));

export default function CompanionScene({ kind, speaking = false, performanceInput, ...props }: ComponentProps<typeof PetScene> & { kind: CompanionKind; speaking?: boolean; performanceInput?: PerformanceInput }) {
  return kind === 'cat' ? <PetScene {...props}/> : <Suspense fallback={<div className="avatar-loading" role="status">小伴正在走来…</div>}><AnimeScene {...props} speaking={speaking} performanceInput={performanceInput}/></Suspense>;
}
