export interface DevicePreferences {
  microphoneId: string;
  cameraId: string;
  speakerId: string;
}
export interface DevicePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface DevicePreferenceController {
  read(): DevicePreferences;
  write(patch: Partial<DevicePreferences>): DevicePreferences;
  clear(): void;
  dispose(): void;
}
export interface ListedMediaDevice {
  kind: string;
  deviceId: string;
  label?: string;
}
export function normalizeDevicePreferences(value: unknown): DevicePreferences;
export function createDevicePreferences(storage: DevicePreferenceStorage | undefined | null, scope: string): DevicePreferenceController;
export function reconcileDevicePreferences(
  preferences: DevicePreferences,
  devices: readonly ListedMediaDevice[],
  options?: { labelsAvailable?: boolean },
): { preferences: DevicePreferences; missing: Array<keyof DevicePreferences> };
