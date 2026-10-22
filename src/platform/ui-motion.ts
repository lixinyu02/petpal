import { useLayoutEffect, useRef, type RefObject } from 'react';
import { beginUiEntrance, createUiMotionController } from './ui-motion.mjs';

const motion = createUiMotionController();
export const mountUiMotionLifecycle = (options: { disabled?: boolean } = {}) => motion.mount(options);
// Existing scroll/measurement owners keep their DOM ref and node identity.
export function useUiEntrance<T extends HTMLElement>(key: string, active = true, existingRef?: RefObject<T | null>) {
  const localRef = useRef<T>(null);
  const ref = existingRef ?? localRef;
  useLayoutEffect(() => {
    if (active) return beginUiEntrance(ref.current, motion);
  }, [key, active, ref]);
  return ref;
}
