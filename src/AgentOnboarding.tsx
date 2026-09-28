import { CheckCircle2, CircleHelp, KeyRound, Loader2, Settings2, ShieldCheck, Terminal } from 'lucide-react';
import { getExecutionTarget, type CodexStatus, type User } from './api';
import './workspace-controls.css';

export function AgentOnboarding({ codex, user, onConfigure }: { codex: CodexStatus; user?: User; onConfigure(): void }) {
  const local = getExecutionTarget() === 'local', owner = Boolean(user?.isOwner);
  let status: 'locked'|'checking'|'configuration'|'unavailable'|'authentication'|'ready';
  if (!user?.canUseCodex) status = 'locked';
  else if (codex.configured === false) status = 'configuration';
  else if (codex.available === false) status = 'unavailable';
  else if (codex.authenticated === false) status = 'authentication';
  else if (codex.available === true && codex.authenticated === true) status = 'ready';
  else status = 'checking';
  const details = {
    locked: { icon: ShieldCheck, title: '此账号尚未开通 Agent', description: '请联系管理员分配主机访问权限和可用模型。' },
    checking: { icon: Loader2, title: '正在检查执行主机', description: '确认 Codex 连接后，即可发送任务。' },
    configuration: { icon: Settings2, title: '先连接 Agent 模型', description: owner ? '为执行主机填写 Responses API 地址、密钥和模型，或使用主机已有的 Codex 登录。' : '执行主机尚未配置模型，请联系管理员完成连接。' },
    unavailable: { icon: Terminal, title: '执行主机的 Codex 暂不可用', description: owner ? '检查这台执行主机的 Codex 安装和连接设置，然后重新连接。' : '请联系管理员检查执行主机上的 Codex 服务。' },
    authentication: { icon: KeyRound, title: 'Codex 需要登录或 API 凭据', description: owner ? '在执行主机登录 Codex，或在设置中连接 Responses API。' : '请联系管理员为执行主机配置有效的模型凭据。' },
    ready: { icon: CheckCircle2, title: 'Agent 已就绪', description: `任务在${local ? '此电脑' : '远程主机'}执行，按发送前选择的访问范围与运行策略工作。` },
  }[status];
  const Icon = details.icon;
  return <section className={`agent-onboarding agent-onboarding-${status}`} aria-label="Agent 连接状态">
    <Icon size={20} className={status === 'checking' ? 'spin' : undefined} aria-hidden="true"/>
    <div className="agent-onboarding-copy"><h3>{details.title}</h3><p>{details.description}</p>{status === 'ready' && <p className="agent-onboarding-hint"><CircleHelp size={12}/>图片理解取决于所选模型；主机软件操作需要相应权限。</p>}</div>
    {owner && status !== 'checking' && <button type="button" className="agent-onboarding-configure" onClick={onConfigure}><Settings2 size={14}/>{status === 'ready' ? '设置' : '配置 Agent'}</button>}
  </section>;
}

export default AgentOnboarding;
