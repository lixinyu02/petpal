export type DownloadPlatform = 'windows'|'ubuntu'|'android';
export type DownloadArchitecture = 'x64'|'arm64'|'universal';
export type DownloadTarget = {platform:DownloadPlatform|null;arch:DownloadArchitecture|null;source:'native'|'ua-ch'|'unknown'};
export function detectDownloadTarget(input?:{runtime?:{readonly platform:string;readonly arch:string};navigator?:{readonly userAgent?:string;readonly userAgentData?:{readonly platform?:string;getHighEntropyValues?(hints:string[]):Promise<{platform?:string;architecture?:string;bitness?:string}>}};timeoutMs?:number}):Promise<DownloadTarget>;
