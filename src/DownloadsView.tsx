import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, Laptop, Monitor, RefreshCw, Smartphone } from 'lucide-react';
import { api, getSessionEpoch, isSessionChanged } from './api';
import './downloads.css';

type Platform = 'android' | 'windows' | 'ubuntu';
type Package = {
  id: string; platform: Platform; arch: 'universal' | 'x64' | 'arm64'; version: string; channel: 'stable' | 'preview';
  format: 'apk' | 'portable-exe' | 'portable-zip' | 'tar.gz' | 'appimage' | 'deb'; filename: string; url: string; releaseUrl: string;
  bytes: number; publishedAt: string; sha256?: string; debug: boolean;
};
type Catalog = { repository: string; releasesUrl: string; checkedAt: string | null; stale: boolean; error: string | null; retryAt: string | null; packages: Package[] };
const platforms = [
  { id: 'android' as const, name: 'Android', icon: Smartphone, description: '手机陪伴 · 连接远程助手' },
  { id: 'windows' as const, name: 'Windows', icon: Monitor, description: 'Windows 10/11 x64 · 桌宠与本机 Agent' },
  { id: 'ubuntu' as const, name: 'Ubuntu', icon: Laptop, description: 'Linux 桌面 · 本机 Codex' },
];
const formats = { apk: 'APK', 'portable-exe': '便携 EXE', 'portable-zip': '便携 ZIP（推荐）', 'tar.gz': 'tar.gz', appimage: 'AppImage', deb: 'DEB' };
const installation = (item: Package) => item.format === 'apk'
  ? `${item.debug ? '沿用开发证书签名。' : ''}下载 APK 后，按 Android 提示允许此来源安装。`
  : item.format === 'portable-zip' ? '推荐使用 ZIP：完整解压到本地新目录，再运行 PetPal.exe。请勿在压缩包内直接打开。'
  : item.format === 'portable-exe' ? '下载后运行便携 EXE；每次启动都会解压，请等待窗口出现。首次启动可能需要较长时间。'
  : item.format === 'tar.gz' ? '解压到新目录，运行 ./start-petpal.sh；保留旧目录便于回退。'
  : item.format === 'appimage' ? '允许文件作为程序执行，然后打开 AppImage。'
  : '下载后使用 Ubuntu 的软件安装器打开 DEB。';
const packageLabel = (item: Package) => `v${item.version} · ${item.arch === 'universal' ? '通用' : item.arch} · ${formats[item.format]} · 正式版`;
const architectureRank = (arch: Package['arch']) => arch === 'x64' ? 0 : arch === 'arm64' ? 1 : 2;
/** Also protect upgraded clients still connected to an older mixed catalog. */
export function latestStableDownloadPackages(packages: Package[]) {
  const stable = packages.filter(item => item.channel === 'stable' && /^(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})$/.test(item.version));
  const compare = (a: string, b: string) => {
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
  };
  const latest = stable.map(item => item.version).sort(compare).at(-1);
  return stable.filter(item => item.version === latest);
}

export default function DownloadsView() {
  const [catalog, setCatalog] = useState<Catalog | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0), [clock, setClock] = useState(Date.now()), [selected, setSelected] = useState<Partial<Record<Platform, string>>>({});
  const epoch = useRef(getSessionEpoch()).current;
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    const current = () => alive && getSessionEpoch() === epoch;
    const sessionChanged = () => controller.abort();
    window.addEventListener('petpal:session-change', sessionChanged);
    setLoading(true); setError('');
    void api<Catalog>('/downloads', { signal: controller.signal }).then(value => {
      if (current()) { setCatalog(value); setClock(Date.now()); }
    }).catch(error => { if (current() && !controller.signal.aborted && !isSessionChanged(error)) setError((error as Error).message || '下载列表暂时不可用，请重试。'); })
      .finally(() => { if (current()) setLoading(false); });
    return () => { alive = false; controller.abort(); window.removeEventListener('petpal:session-change', sessionChanged); };
  }, [revision, epoch]);
  const retrySeconds = catalog?.retryAt ? Math.max(0, Math.ceil((Date.parse(catalog.retryAt) - clock) / 1000)) : 0;
  useEffect(() => {
    if (!retrySeconds) return;
    const timer = setTimeout(() => setClock(Date.now()), 1000); return () => clearTimeout(timer);
  }, [retrySeconds, clock]);
  const failure = error || catalog?.error;
  const latestPackages = latestStableDownloadPackages(catalog?.packages || []);
  return <section className="downloads-view" aria-labelledby="downloads-title" aria-busy={loading}>
    <header className="downloads-heading"><div><span className="downloads-eyebrow">小伴 · PetPal</span><h2 id="downloads-title">下载客户端</h2><p>仅提供最新正式版，选择适合设备的架构与格式。</p></div>
      <button className="secondary-button" disabled={loading || retrySeconds > 0} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} className={loading ? 'spin' : ''}/>{loading ? '正在读取…' : retrySeconds ? `${retrySeconds} 秒后重试` : failure ? '重试' : '刷新列表'}</button>
    </header>
    {failure && <p className="downloads-notice" role="alert">{failure}{catalog?.checkedAt && ' 下方保留上次读取的最新正式版安装包。'}</p>}
    {loading && !catalog && <p className="downloads-loading" role="status">正在读取 GitHub 已发布的安装包…</p>}
    <div className="downloads-list">
      {platforms.map(platform => {
        const packages = latestPackages.filter(item => item.platform === platform.id).sort((a, b) => architectureRank(a.arch) - architectureRank(b.arch)
          || (a.platform === 'windows' && a.releaseUrl === b.releaseUrl && a.arch === b.arch ? Number(b.format === 'portable-zip') - Number(a.format === 'portable-zip') : 0)
          || a.filename.localeCompare(b.filename));
        const item = packages.find(item => item.id === selected[platform.id]) || packages[0], Icon = platform.icon;
        return <article key={platform.id} className="downloads-row" aria-labelledby={`download-${platform.id}`}>
          <div className="downloads-platform"><Icon size={26} strokeWidth={1.6}/><div><h3 id={`download-${platform.id}`}>{platform.name}</h3><p>{platform.description}</p></div></div>
          <div className="downloads-package">
            {item ? <><div className="downloads-version">{packages.length > 1 ? <select aria-label={`${platform.name} 安装包`} value={item.id} onChange={event => setSelected(previous => ({ ...previous, [platform.id]: event.target.value }))}>{packages.map(item => <option key={item.id} value={item.id}>{packageLabel(item)}</option>)}</select> : <strong>{packageLabel(item)}</strong>}</div>
              <p className="downloads-install">{installation(item)}</p><p className="downloads-file">{item.filename} <span>· {(item.bytes / 1024 ** 2).toFixed(1)} MB</span></p>
              {item.sha256 && <details className="downloads-checksum"><summary>查看 SHA-256</summary><code>{item.sha256}</code></details>}</>
              : <p className="downloads-empty">{loading && !catalog ? '正在查询…' : failure && !catalog?.checkedAt ? '列表暂不可用，请重试。' : '最新正式版尚未提供此平台安装包。'}</p>}
          </div>
          <div className="downloads-actions">{item ? <><a className="primary-button" href={item.url} target="_blank" rel="noreferrer noopener" aria-label={`下载 ${platform.name} ${item.version} ${item.arch}`}><Download size={16}/>下载</a><a className="downloads-release" href={item.releaseUrl} target="_blank" rel="noreferrer noopener">发布说明<ArrowUpRight size={13}/></a></> : <span className="downloads-pending">{loading && !catalog ? '查询中' : failure && !catalog?.checkedAt ? '等待恢复' : '等待发布'}</span>}</div>
        </article>;
      })}
    </div>
    <footer className="downloads-footer"><p>安装包来自 GitHub 公开发布。登录仅用于进入小伴下载中心；GitHub 文件本身公开可访问。</p>
      <div><span>{catalog?.checkedAt ? `${catalog.stale || error ? '缓存列表' : '最近读取'} · ${new Date(catalog.checkedAt).toLocaleString('zh-CN', { hour12: false })}` : '展示最新正式版客户端安装包'}</span><a href={latestPackages[0]?.releaseUrl || 'https://github.com/lixinyu02/petpal/releases/latest'} target="_blank" rel="noreferrer noopener">前往 GitHub<ArrowUpRight size={13}/></a></div>
    </footer>
  </section>;
}
