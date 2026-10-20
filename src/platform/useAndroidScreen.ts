import { useEffect } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useTheme } from './theme.ts';

const screen = registerPlugin<{setAppearance(options: {theme: 'day'|'night'}): Promise<{nativeInsets: boolean}>}>('PetScreen');

/** A foreground, origin-scoped native bridge; no network or permission changes. */
export function useAndroidScreen(disabled: boolean) {
  const { theme } = useTheme();
  useEffect(() => {
    if (disabled || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    let active = true;
    const update = () => {
      if (document.visibilityState === 'hidden') return;
      void screen.setAppearance({ theme }).then(result => {
        if (active) document.documentElement.dataset.nativeInsets = String(result.nativeInsets);
      }).catch(() => { /* Older installed clients retain CSS safe-area handling. */ });
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => { active = false; document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); };
  }, [disabled, theme]);
}
