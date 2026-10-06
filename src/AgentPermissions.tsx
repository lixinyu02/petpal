import { Shield, Zap } from 'lucide-react';
import type { AgentPermissions as Permissions, ApprovalReviewCapability, AgentApprovalReview, Provider, User } from './api';
import {approvalReviewLabel,canUseApprovalReview,canUseIndependentApprovalReview} from './approval-review-ui.mjs';
import WorkspaceDisclosure from './WorkspaceDisclosure';
import './agent-controls.css';

export const defaultAgentPermissions: Permissions = { access:'read-only', approval:'ask' };
export default function AgentPermissions({ value, onChange, user, disabled=false, reviewCapability, reviewProviders=[], reviewProgress }: { value:Permissions; onChange(value:Permissions):void; user?:User; disabled?:boolean;reviewCapability?:ApprovalReviewCapability;reviewModel?:string;reviewProviders?:Provider[];reviewProgress?:AgentApprovalReview }) {
  const full = user?.isOwner || user?.agentAccess === 'full';
  const scopes = { 'read-only': '只读', 'workspace-write': '工作区', 'full-access': '完全访问' };
  const approvals = { ask: '需要时询问', review: '自动审查', auto: '自动运行' };
  const independentReview=canUseIndependentApprovalReview(reviewCapability),providers=reviewProviders.filter(provider=>provider.protocol==='responses');
  const selectedReview=value.reviewProviderId||'',missingReview=selectedReview&&!providers.some(provider=>provider.id===selectedReview);
  return <WorkspaceDisclosure className="agent-permissions" label={`Agent 权限：${scopes[value.access]}，${approvals[value.approval]}`} summary={<><Shield size={14}/><span>{scopes[value.access]}<span className="permission-divider">·</span>{approvals[value.approval]}</span></>}>
    <h3>任务权限</h3>
    <div className="agent-permission-fields">
      <label><Shield size={14}/><span>访问范围</span><select aria-label="Agent 访问范围" value={value.access} disabled={disabled} onChange={e => {if(!disabled)onChange({...value,access:e.target.value as Permissions['access']});}}>
        <option value="read-only">只读</option><option value="workspace-write">工作区</option>{full && <option value="full-access">完全访问</option>}
      </select></label>
      <label><Zap size={14}/><span>运行方式</span><select aria-label="Agent 运行方式" value={value.approval} disabled={disabled} onChange={e => {const approval=e.target.value as Permissions['approval'];if(disabled||approval==='review'&&!canUseApprovalReview(reviewCapability))return;onChange({...value,approval});}}>
        <option value="ask">需要时询问</option><option value="review" disabled={!canUseApprovalReview(reviewCapability)}>{canUseApprovalReview(reviewCapability)?'自动审查':'自动审查（不可用）'}</option><option value="auto">自动运行</option>
      </select></label>
      {value.approval==='review'&&<label><Shield size={14}/><span>命令审查模型</span><select aria-label="命令审查模型" value={selectedReview} disabled={disabled||!canUseApprovalReview(reviewCapability)} onChange={e=>{const reviewProviderId=e.target.value;if(disabled||!canUseApprovalReview(reviewCapability)||reviewProviderId&&(!independentReview||!providers.some(provider=>provider.id===reviewProviderId)))return;onChange({...value,reviewProviderId:reviewProviderId||null});}}>
        <option value="">跟随 Agent</option>{missingReview&&<option value={selectedReview} disabled>已选审查模型（不可用）</option>}{providers.map(provider=><option key={provider.id} value={provider.id} disabled={!independentReview}>{provider.name} · {provider.model}{!independentReview?'（不可用）':''}</option>)}
      </select></label>}
    </div>
    {value.approval === 'review' && approvalReviewLabel(reviewProgress) && <p className="agent-permission-note" role="status">{approvalReviewLabel(reviewProgress)}{reviewProgress?.rationale&&<>：{reviewProgress.rationale}</>}</p>}
  </WorkspaceDisclosure>;
}
