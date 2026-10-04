import { useLayoutEffect, useRef } from 'react';
import { beginUiEntrance, createUiMotionController } from './ui-motion.mjs';

const motion = createUiMotionController();
export const mountUiMotionLifecycle = (options: { disabled?: boolean } = {}) => motion.mount(options);
export function useUiEntrance<T extends HTMLElement>(key: string, active = true) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    if (active) return beginUiEntrance(ref.current, motion);
  }, [key, active]);
  return ref;
}
