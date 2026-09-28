export type AvatarImageName = 'idle' | 'blink' | 'talk' | 'round' | 'curious' | 'warm';
export function avatarImageUrl(name: AvatarImageName): string;
export function loadAvatarImage(name: AvatarImageName, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<HTMLImageElement>;
export function loadAvatarImages(options: {
  load(name: AvatarImageName): Promise<HTMLImageElement>;
  onBase(image: HTMLImageElement, name: AvatarImageName): void;
  onVariant(image: HTMLImageElement, name: AvatarImageName): void;
  onIssue(name: AvatarImageName): void;
  isStopped?(): boolean;
}): Promise<void>;
