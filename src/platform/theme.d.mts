export type ThemePreference = 'auto' | 'day' | 'night';
export type EffectiveTheme = 'day' | 'night';
export type ThemeSnapshot = Readonly<{ preference: ThemePreference; theme: EffectiveTheme; saved: boolean }>;
export type ThemeSurface = { transparent?: boolean };
export type ThemeController = {
  snapshot(): ThemeSnapshot;
  subscribe(listener: () => void): () => void;
  setPreference(preference: ThemePreference): void;
  refresh(options?: { fromStorage?: boolean }): void;
  mount(surface?: ThemeSurface): () => void;
};
export const THEME_STORAGE_KEY: string;
export const THEME_COLORS: Readonly<Record<EffectiveTheme, string>>;
export const THEME_CHROME_COLORS: Readonly<Record<EffectiveTheme, string>>;
export function normalizeThemePreference(value: unknown): ThemePreference;
export function effectiveTheme(preference: unknown, date?: Date): EffectiveTheme;
export function nextThemeBoundary(date?: Date): Date;
export function createThemeController(options?: {
  window?: Window;
  document?: Document;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => Date;
  setTimeout?: (callback: () => void, delay: number) => number;
  clearTimeout?: (id: number) => void;
}): ThemeController;
