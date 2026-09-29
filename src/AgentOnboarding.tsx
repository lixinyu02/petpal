import { CheckCircle2, CircleHelp, KeyRound, Loader2, Settings2, ShieldCheck, Terminal } from 'lucide-react';
import type { AgentHost, CodexStatus, User } from './api';
import './workspace-controls.css';

export function AgentOnboarding({ codex, user, host, hostLoading = false, localHostId = '', onConfigure }: { codex: CodexStatus; user?: User; host?: AgentHost; hostLoading?: boolean; localHostId?: string; onConfigure(): void }) {
  const owner = Boolean(user?.isOwner), local = Boolean(host && host.id === localHostId);
  let status: 'locked'|'checking'|'offline'|'configuration'|'unavailable'|'authentication'|'ready';
  if (!user?.canUseCodex) status = 'locked';
  else if (hostLoading && !host) status = 'checking';
  else if (!host || !host.online) status = 'offline';
  else if (codex.configured === false) status = 'configuration';
  else if (codex.available === false) status = 'unavailable';
  else if (codex.authenticated === false) status = 'authentication';
  else if (codex.available === true && codex.authenticated === true) status = 'ready';
  else status = 'checking';
  const details = {
    locked: { icon: ShieldCheck, title: '此账号尚未开通 Agent', description: '请联系管理员分配主机访问权限和可用模型。' },
    checking: { icon: Loader2, title: '正在检查执行主机', description: '确认 Codex 连接后，即可发送任务。' },
    offline: { icon: Terminal, title: host ? `${host.name} 已离线` : '请选择一台在线电脑', description: '在 Windows 或 Ubuntu 客户端登录同一账号，并保持客户端运行。任务会等待你选择，不会自动转到其他电脑。' },
    configuration: { icon: Settings2, title: '先连接 Agent 模型', description: owner ? '为执行主机填写 Responses API 地址、密钥和模型，或使用主机已有的 Codex 登录。' : '执行主机尚未配置模型，请联系管理员完成连接。' },
    unavailable: { icon: Terminal, title: '执行电脑的 Codex 暂不可用', description: host?.kind === 'desktop' ? '请在这台电脑更新或重启小伴客户端，确认内置 Codex 可以运行。' : owner ? '检查服务器的 Codex 安装和连接设置，然后重新连接。' : '请联系管理员检查服务器上的 Codex 服务。' },
    authentication: { icon: KeyRound, title: 'Codex 需要登录或 API 凭据', description: owner ? '在执行主机登录 Codex，或在设置中连接 Responses API。' : '请联系管理员为执行主机配置有效的模型凭据。' },
    ready: { icon: CheckCircle2, title: `Agent 已就绪 · ${host?.name || '执行电脑'}`, description: `任务在${local ? '此电脑' : host?.name || '所选电脑'}执行，按发送前选择的访问范围与运行策略工作。` },
  }[status];
  const Icon = details.icon;
  return <section className={`agent-onboarding agent-onboarding-${status}`} aria-label="Agent 连接状态">
    <Icon size={20} className={status === 'checking' ? 'spin' : undefined} aria-hidden="true"/>
    <div className="agent-onboarding-copy"><h3>{details.title}</h3><p>{details.description}</p>{status === 'ready' && <p className="agent-onboarding-hint"><CircleHelp size={12}/>图片理解取决于所选模型；主机软件操作需要相应权限。</p>}</div>
    {owner && !['checking','offline'].includes(status) && <button type="button" className="agent-onboarding-configure" onClick={onConfigure}><Settings2 size={14}/>{status === 'ready' ? '模型设置' : '配置 Agent'}</button>}
  </section>;
}

export default AgentOnboarding;
