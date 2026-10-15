import {useEffect,useId,useSyncExternalStore} from 'react';
import {CheckCircle2,ExternalLink,Loader2,LogOut,RefreshCw,UserRound,X} from 'lucide-react';
import {nativeOfficialAccount,officialAccountIsLocal,officialAccountSnapshot,performOfficialAccount,readOfficialAccount,subscribeOfficialAccount,type OfficialAccountAction} from './platform/official-account';
import './official-account.css';
const usageLabels={unverified:'尚未验证',available:'最近验证可用','limit-reached':'套餐额度已受限','temporarily-unavailable':'暂时不可用','not-eligible':'账号或工作区暂不具备使用资格'};
const usageNumbers=new Intl.NumberFormat('zh-CN');

export default function OfficialAccountSettings({connected,onConnect}:{connected:boolean;onConnect():void}){
  const snapshot=useSyncExternalStore(subscribeOfficialAccount,officialAccountSnapshot,officialAccountSnapshot),id=useId();
  const bridge=nativeOfficialAccount(),local=officialAccountIsLocal();
  const status=snapshot.status,busy=!!snapshot.busy,pending=status?.state==='signing-in'||snapshot.busy==='start';
  const signedIn=status?.state==='signed-in'||!!status?.profiles.some(profile=>profile.id===status.activeProfileId&&profile.signedIn);
  const active=status?.profiles.find(profile=>profile.id===status.activeProfileId),enabled=connected&&local&&!!bridge;
  const usage=status?.usage,needsConsent=!status?.planUsageEnabled||!!status?.error;
  useEffect(()=>{if(enabled)void readOfficialAccount().catch(()=>{});},[enabled,snapshot.scope]);
  useEffect(()=>{
    if(!enabled||!signedIn||pending||!usage)return;
    let disposed=false,timer:ReturnType<typeof setTimeout>|null=null;
    const stop=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
    const schedule=()=>{stop();if(!disposed&&!document.hidden)timer=setTimeout(()=>{timer=null;void readOfficialAccount().catch(()=>{}).finally(schedule);},15000);};
    document.addEventListener('visibilitychange',schedule);schedule();
    return()=>{disposed=true;stop();document.removeEventListener('visibilitychange',schedule);};
  },[enabled,signedIn,pending,snapshot.scope,!!usage]);
  if(!bridge)return null;
  const action=(kind:OfficialAccountAction,input?:string)=>{if(enabled)void performOfficialAccount(kind,input).catch(()=>{});};
  return <section className="official-account-settings" aria-labelledby={`${id}-title`}>
    <div className="official-account-heading"><div className="official-account-title"><span className="official-account-symbol"><UserRound size={21} aria-hidden="true"/></span><div><h3 id={`${id}-title`}>ChatGPT 官方账号</h3><p>使用官方账号与套餐中的可用模型。</p></div></div>{enabled&&<button type="button" className="icon-button" aria-label="刷新官方账号状态" disabled={busy||pending} onClick={()=>action('refresh')}><RefreshCw size={16} className={snapshot.busy==='refresh'?'spin':undefined} aria-hidden="true"/></button>}</div>
    {!connected?<p className="official-account-note">先登录这台电脑的小伴账号，再连接 ChatGPT。</p>:!local?<div className="official-account-local"><p>官方账号保存在这台电脑。当前连接的是远程服务，请切换到客户端的本机服务后登录。</p><button type="button" className="secondary-button" onClick={onConnect}>更改服务连接</button></div>:<>
      <div className="official-account-state" role="status">{pending?<><Loader2 size={17} className="spin" aria-hidden="true"/><span>等待你在系统浏览器中完成官方登录…</span></>:snapshot.busy==='status'&&!status?<><Loader2 size={17} className="spin" aria-hidden="true"/><span>正在读取这台电脑的官方账号…</span></>:signedIn?<><CheckCircle2 size={17} aria-hidden="true"/><span>{active?.email||active?.label||'官方账号已连接'}<small>{status?.planUsageEnabled?'ChatGPT 套餐已授权':'尚未授权使用 ChatGPT 套餐'}</small></span></>:<><UserRound size={17} aria-hidden="true"/><span>尚未连接官方账号</span></>}</div>
      {status?.profiles.length? <label className="official-account-profile">官方账号<select aria-label="切换官方账号" value={status.activeProfileId||''} disabled={busy||pending} onChange={event=>{const profile=status.profiles.find(item=>item.id===event.target.value);if(profile)action(profile.signedIn?'select':'start',profile.id);}}><option value="" disabled>选择已添加的账号</option>{status.profiles.map(profile=><option value={profile.id} key={profile.id}>{profile.email||profile.label||'官方账号'}{profile.signedIn?'':' · 需要登录'}</option>)}</select></label>:null}
      {(snapshot.error||status?.error||status?.modelsError)&&<p className="form-error" role="alert">{snapshot.error||status?.error||status?.modelsError}</p>}
      {status?.models.length? <details className="official-account-models"><summary>{status.models.length} 个官方模型可用 · 支持 Chat 与 Agent</summary><ul>{status.models.map(model=><li key={model.id}><span>{model.displayName}<small>{model.model}</small></span><span>{model.supportsImages?'图文':'文字'}</span></li>)}</ul></details>:signedIn&&!pending&&!busy&&status?.planUsageEnabled&&!status.modelsError?<p className="official-account-note">官方账号暂未返回可用模型，可以稍后刷新。</p>:null}
      {signedIn&&!pending&&<section className="official-account-usage" aria-labelledby={`${id}-usage`}><div className="official-usage-heading"><h4 id={`${id}-usage`}>官方额度与用量</h4><button type="button" className="secondary-button" aria-label="刷新官方用量状态" disabled={busy} onClick={()=>action('status')}><RefreshCw size={13} aria-hidden="true"/>刷新状态</button></div>{usage?<><p className={`official-usage-state is-${usage.state}`} role="status">{usageLabels[usage.state]}</p><dl><div><dt>上次请求验证</dt><dd>{usage.checkedAt?new Date(usage.checkedAt).toLocaleString('zh-CN',{hour12:false}):'尚未发出模型请求'}</dd></div>{usage.lastModel&&<div><dt>最近模型</dt><dd>{usage.lastModel}</dd></div>}<div><dt>本次连接已完成</dt><dd>{usageNumbers.format(usage.completedRequests)} 次请求</dd></div><div><dt>本次连接 Token 统计</dt><dd>输入 {usageNumbers.format(usage.inputTokens)} · 输出 {usageNumbers.format(usage.outputTokens)} · 合计 {usageNumbers.format(usage.totalTokens)}</dd></div></dl>{bridge.resumeUsage&&['limit-reached','temporarily-unavailable'].includes(usage.state)&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>action('resumeUsage')}>额度恢复后重试</button>}</>:<p className="official-account-note">此客户端暂未提供请求用量状态，请更新客户端后查看。</p>}<p className="official-account-note">官方暂未开放套餐余额读取。这里是本次连接的已完成请求统计，不代表套餐剩余额度。<a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">查看官方用量 <ExternalLink size={12} aria-hidden="true"/></a></p></section>}
      <div className="official-account-actions">{pending?<button type="button" className="secondary-button" disabled={snapshot.busy==='cancel'} onClick={()=>action('cancel')}>{snapshot.busy==='cancel'?<Loader2 size={15} className="spin" aria-hidden="true"/>:<X size={15} aria-hidden="true"/>}取消登录</button>:<button type="button" className="primary-button" disabled={busy||!status} onClick={()=>action('start',signedIn&&needsConsent?status?.activeProfileId||undefined:undefined)}><ExternalLink size={15} aria-hidden="true"/>{signedIn?needsConsent?'重新授权':'添加官方账号':'使用 ChatGPT 登录'}</button>}{signedIn&&!pending&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>action('logout')}><LogOut size={15} aria-hidden="true"/>退出官方账号</button>}{snapshot.error&&!pending&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>action('status')}>重新读取</button>}</div>
      <p className="official-account-note">在系统浏览器完成授权。登录信息仅保存在此电脑，原有 API 连接继续保留。</p>
    </>}
  </section>;
}
