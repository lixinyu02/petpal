export const browserSetupTask: string;
export function createBrowserSetupDraft(value: { connected: boolean; canUseCodex: boolean; host?: { id: string; online: boolean; platform?: string }; busy: boolean; draft?: string; attachmentCount?: number }): { hostId: string; content: string };
