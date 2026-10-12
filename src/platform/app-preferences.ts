/** Preferences belong to this computer, independently of the selected Agent host. */
export type AppPreferences = {
  autoLaunch: boolean;
  startMinimized: boolean;
  startFullscreen: boolean;
  showPetOnLaunch: boolean;
  closeToTray: boolean;
  petAlwaysOnTop: boolean;
};

export type AppPreferencesStatus = Omit<AppPreferences, 'startFullscreen'> & {
  platform: string;
  autoLaunchSupported: boolean;
  autoLaunchReason?: string;
  /** Optional so an older desktop client can still manage its existing preferences. */
  startFullscreen?: boolean;
  fullscreenSupported?: boolean;
  fullscreen?: boolean;
};

export type PreferencesBridge = {
  status(): Promise<AppPreferencesStatus>;
  update(patch: Partial<AppPreferences>): Promise<AppPreferencesStatus>;
  setFullscreen?(enabled: boolean): Promise<AppPreferencesStatus>;
  onWindowState?(callback: (state: { fullscreen: boolean }) => void): () => void;
};

/** An older or failed client bridge must not become a set of apparently saved switches. */
export function readAppPreferencesStatus(value: unknown): AppPreferencesStatus {
  if (!value || typeof value !== 'object') throw new Error('客户端返回的设置不完整，请更新客户端后重试。');
  const status = value as Record<string, unknown>;
  const keys = ['autoLaunch', 'startMinimized', 'showPetOnLaunch', 'closeToTray', 'petAlwaysOnTop', 'autoLaunchSupported'];
  if (keys.some(key => typeof status[key] !== 'boolean') || typeof status.platform !== 'string' || !status.platform.trim()
    || (status.autoLaunchReason !== undefined && typeof status.autoLaunchReason !== 'string')
    || ['startFullscreen', 'fullscreenSupported', 'fullscreen'].some(key => status[key] !== undefined && typeof status[key] !== 'boolean')
    || (status.fullscreenSupported === true && (typeof status.startFullscreen !== 'boolean' || typeof status.fullscreen !== 'boolean'))) {
    throw new Error('客户端返回的设置不完整，请更新客户端后重试。');
  }
  return {
    platform: status.platform,
    autoLaunchSupported: status.autoLaunchSupported as boolean,
    autoLaunch: status.autoLaunch as boolean,
    startMinimized: status.startMinimized as boolean,
    showPetOnLaunch: status.showPetOnLaunch as boolean,
    closeToTray: status.closeToTray as boolean,
    petAlwaysOnTop: status.petAlwaysOnTop as boolean,
    ...(status.startFullscreen === undefined ? {} : { startFullscreen: status.startFullscreen as boolean }),
    ...(status.fullscreenSupported === undefined ? {} : { fullscreenSupported: status.fullscreenSupported as boolean }),
    ...(status.fullscreen === undefined ? {} : { fullscreen: status.fullscreen as boolean }),
    ...(status.autoLaunchReason === undefined ? {} : { autoLaunchReason: status.autoLaunchReason as string }),
  };
}
