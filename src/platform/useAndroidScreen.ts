import { useEffect } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useTheme } from './theme.ts';

const screen = registerPlugin<{setAppearance(options: {theme: 'day'|'night';preference?:'day'|'night'|'auto'}): Promise<{nativeInsets: boolean}>}>('PetScreen');

/** A foreground, origin-scoped native bridge; no network or permission changes. */
export function useAndroidScreen(disabled: boolean) {
  const { theme, preference } = useTheme();
  useEffect(() => {
    if (disabled || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    let active = true;
    const update = () => {
      if (document.visibilityState === 'hidden') return;
      void screen.setAppearance({ theme, preference }).catch(() => {
        // Older installed clients accept only {theme}. Never let a delayed
        // compatibility retry overwrite a more recent user preference.
        if (!active) return null;
        return screen.setAppearance({ theme });
      }).then(result => {
        if (!result) return;
        if (active) document.documentElement.dataset.nativeInsets = String(result.nativeInsets);
      }).catch(() => { /* Older installed clients retain CSS safe-area handling. */ });
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => { active = false; document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); };
  }, [disabled, theme, preference]);
}
