export type CentralServerSettingsUpdate = { enabled: boolean; port: number; publicUrl: string };
export type CentralServerStatus = CentralServerSettingsUpdate & {
  supported: boolean;
  platform: string;
  listening: boolean;
  urls: string[];
  ownerHasPassword: boolean;
  reason?: string;
};
export type CentralServerBridge = {
  status(): Promise<CentralServerStatus>;
  update(settings: CentralServerSettingsUpdate): Promise<CentralServerStatus>;
};

const invalidStatus = () => new Error('客户端返回的中央服务器状态不完整，请更新客户端后重试。');
const restrictedPorts = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);

export function readCentralServerPort(value: string | number): number {
  if (typeof value === 'string' && !/^[1-9]\d{3,4}$/.test(value.trim())) throw new Error('端口须为 1024–65535 的整数。');
  const port = Number(typeof value === 'string' ? value.trim() : value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口须为 1024–65535 的整数。');
  if (restrictedPorts.has(port)) throw new Error('该端口被浏览器限制，请选择其他端口。');
  return port;
}

/** A declared reverse-proxy origin is a connection hint, never proof of HTTPS readiness. */
export function readCentralServerPublicUrl(value: string): string {
  const text = value.trim();
  if (!text) return '';
  try {
    if (text.length > 2048 || !/^https:\/\/[^/?#]+\/?$/i.test(text) || /[\x00-\x20\x7f\\%*?#]/.test(text)) throw new Error();
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url.origin;
  } catch { throw new Error('HTTPS 访问地址须为完整 HTTPS 地址，只填写域名和可选端口。'); }
}

const safeErrorMessages = new Set([
  '此端口已被占用，请更换端口后重试。', '系统未允许监听此端口，请检查本机权限。',
  '中央服务器未能启动，请检查本机网络后重试。', '请先为本机管理员设置登录密码。',
  '请先在账号设置中为本机管理员设置登录密码。', '无法核对本机管理员账号，请重新启动小伴。',
  '此系统暂不支持作为中央服务器。', '客户端正在退出，中央服务器设置未保存。', '客户端正在退出，无法更改中央服务器。',
  '请先登录本机管理员账号。', '中央服务器仅可由本机管理员管理，请切换到本机服务。',
  '中央服务器仅允许可信主窗口管理。', '登录账号已变化，请重新打开中央服务器设置。',
  '仅本机管理员可管理中央服务器，请重新登录本机管理员账号。',
  '中央服务器监听已中断，设置未保存，请重试。', '中央服务器设置未能保存，请稍后重试。',
  '中央服务器设置未能保存，变更已撤销；请检查本机权限或空间。',
  '公开地址未能更新，变更已撤销，请重试。', '公开地址更新失败且配置回滚未完成，请重新启动小伴并核对设置。',
  '端口须为 1024 至 65535 之间的浏览器可访问端口。',
  '公开地址须为完整 HTTPS 来源，不可包含路径、凭据或查询参数。', '公开地址须为完整 HTTPS 来源。',
  '无法读取中央服务器状态，请重新打开小伴。',
]);

/** Electron may wrap an IPC rejection; only exact, known public messages may reach the UI. */
export function centralServerErrorMessage(value: unknown, fallback: string): string {
  const message = value && typeof value === 'object' ? (value as { message?: unknown }).message : undefined;
  if (typeof message !== 'string' || message.length > 1024) return fallback;
  const publicMessage = message.replace(/^Error invoking remote method 'petpal:central-server:(?:status|update)': Error: /, '');
  return safeErrorMessages.has(publicMessage) ? publicMessage : fallback;
}

export function readCentralServerStatus(value: unknown): CentralServerStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidStatus();
  const status = value as Record<string, unknown>;
  const keys = ['supported', 'enabled', 'listening', 'ownerHasPassword'];
  if (keys.some(key => typeof status[key] !== 'boolean') || typeof status.platform !== 'string' || !status.platform.trim()
    || status.platform.length > 40 || typeof status.port !== 'number' || typeof status.publicUrl !== 'string'
    || !Array.isArray(status.urls) || status.urls.length > 32
    || (status.reason !== undefined && (typeof status.reason !== 'string' || status.reason.length > 2000))) throw invalidStatus();
  let port: number, publicUrl: string;
  try { port = readCentralServerPort(status.port); publicUrl = readCentralServerPublicUrl(status.publicUrl); }
  catch { throw invalidStatus(); }
  if (status.listening && (!status.enabled || !status.supported)) throw invalidStatus();
  const urls = status.urls.map(value => {
    try {
      if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20\x7f\\%*?#]/.test(value)) throw new Error();
      const url = new URL(value);
      if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/'
        || Number(url.port || '80') !== port) throw new Error();
      return url.origin;
    } catch { throw invalidStatus(); }
  });
  if (!status.listening && urls.length) throw invalidStatus();
  return {
    supported: status.supported as boolean, platform: status.platform, enabled: status.enabled as boolean,
    listening: status.listening as boolean, port, urls: [...new Set(urls)], publicUrl,
    ownerHasPassword: status.ownerHasPassword as boolean,
    ...(status.reason === undefined ? {} : { reason: status.reason as string }),
  };
}

export function centralServerBridge(): CentralServerBridge | undefined {
  const bridge = typeof window === 'undefined' ? undefined : window.petpal?.centralServer;
  return bridge && typeof bridge.status === 'function' && typeof bridge.update === 'function' ? bridge : undefined;
}

/** One asynchronous operation owns its readback until the account or mounted view changes. */
export function createCentralServerOperationGuard(readScope: () => string) {
  let generation = 0, active: { generation: number; scope: string } | null = null;
  return {
    invalidate() { generation++; active = null; },
    begin(scope: string) {
      if (active || scope !== readScope()) return null;
      active = { generation, scope }; return active;
    },
    current(operation: { generation: number; scope: string }) {
      return operation === active && operation.generation === generation && operation.scope === readScope();
    },
    finish(operation: { generation: number; scope: string }) { if (operation === active) active = null; },
  };
}
