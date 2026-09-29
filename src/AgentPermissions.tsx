import { Shield, Zap } from 'lucide-react';
import type { AgentPermissions as Permissions, User } from './api';
import WorkspaceDisclosure from './WorkspaceDisclosure';
import './agent-controls.css';

export const defaultAgentPermissions: Permissions = { access:'read-only', approval:'ask' };
export default function AgentPermissions({ value, onChange, user, disabled=false }: { value:Permissions; onChange(value:Permissions):void; user?:User; disabled?:boolean }) {
  const full = user?.isOwner || user?.agentAccess === 'full';
  const scopes = { 'read-only': '只读', 'workspace-write': '工作区', 'full-access': '完全访问' };
  const approvals = { ask: '需要时询问', review: '自动审查', auto: '自动运行' };
  return <WorkspaceDisclosure className="agent-permissions" label={`Agent 权限：${scopes[value.access]}，${approvals[value.approval]}`} summary={<><Shield size={14}/><span>{scopes[value.access]}<span className="permission-divider">·</span>{approvals[value.approval]}</span></>}>
    <h3>任务权限</h3>
    <div className="agent-permission-fields">
      <label><Shield size={14}/><span>访问范围</span><select aria-label="Agent 访问范围" value={value.access} disabled={disabled} onChange={e => onChange({...value,access:e.target.value as Permissions['access']})}>
        <option value="read-only">只读</option><option value="workspace-write">工作区</option>{full && <option value="full-access">完全访问</option>}
      </select></label>
      <label><Zap size={14}/><span>运行方式</span><select aria-label="Agent 运行方式" value={value.approval} disabled={disabled} onChange={e => onChange({...value,approval:e.target.value as Permissions['approval']})}>
        <option value="ask">需要时询问</option><option value="review">自动审查</option><option value="auto">自动运行</option>
      </select></label>
    </div>
    {value.access === 'full-access' && <p className="agent-permission-notice">完全访问可读写执行主机的文件并运行程序。只向可信账号授予此权限。</p>}
    {value.approval === 'auto' && <p className="agent-permission-notice">在所选范围内自动运行，不弹出操作确认；范围外的操作会被拒绝。</p>}
    {value.approval === 'review' && <p className="agent-permission-note">Codex 自动审查命令；音乐和浏览器等主机工具仍需要你确认。</p>}
    {disabled && <p className="agent-permission-note">本次任务的权限已固定，下次任务开始前可以调整。</p>}
  </WorkspaceDisclosure>;
}
