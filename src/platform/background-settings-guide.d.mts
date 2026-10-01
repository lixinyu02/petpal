import type { BackgroundSettingsKind, BackgroundSettingsOpened, BackgroundSettingsStatus, PhoneVendor } from './task-notifications';
export type PhoneSettingsGuide={vendor:PhoneVendor;name:string;battery:string;autostart:string;notifications:string;tips:string[]};
export const BACKGROUND_SETTINGS_KINDS:readonly BackgroundSettingsKind[];
export function isBackgroundSettingsKind(value:unknown):value is BackgroundSettingsKind;
export function phoneSettingsGuide(device?:Partial<BackgroundSettingsStatus>|null):PhoneSettingsGuide;
export function batteryOptimizationLabel(exempt:boolean|null|undefined):string;
export function backgroundSettingsNotice(result?:BackgroundSettingsOpened|null):string;
