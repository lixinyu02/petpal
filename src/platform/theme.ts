import { useSyncExternalStore } from 'react';
import { createThemeController, type ThemePreference, type ThemeSurface } from './theme.mjs';
export type { ThemePreference, EffectiveTheme, ThemeSnapshot } from './theme.mjs';

const theme = createThemeController();
export const mountThemeLifecycle = (surface: ThemeSurface = {}) => theme.mount(surface);
export const setThemePreference = (preference: ThemePreference) => theme.setPreference(preference);
export const readTheme = theme.snapshot;
export function useTheme() { return useSyncExternalStore(theme.subscribe, theme.snapshot, theme.snapshot); }
