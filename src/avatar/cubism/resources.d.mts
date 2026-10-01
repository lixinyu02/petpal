export interface CubismPackage {
  modelUrl: string; directory: string; moc: string; textures: string[];
  optional: { Physics?: string; Pose?: string; UserData?: string };
  expressions: { name: string; url: string }[];
  motions: { group: string; index: number; url: string }[];
}
export function cubismLocalUrl(path: string, base: string, options?: { directory?: string }): string;
export function validateCubismModel(manifest: unknown, modelUrl: string): CubismPackage;
export function fetchCubismBytes(url: string, options?: { fetcher?: typeof fetch; signal?: AbortSignal; maxBytes?: number }): Promise<ArrayBuffer>;
