import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Check,ChevronDown,ExternalLink,Link2,Loader2,Monitor,RefreshCw,Unplug} from 'lucide-react';
import {getSessionEpoch,isSessionChanged,type User} from './api';
import {computerUseTransport,type ComputerUseConfig,type ComputerUseProfile,type ComputerUseStatus} from './platform/computer-use';
import './computer-use.css';
const profiles:[ComputerUseProfile,string][]=[['core','基础桌面 · 28 项'],['ax','桌面与 Accessibility · 48 项'],['scripting','桌面与脚本 · 31 项'],['windows-admin','Windows 管理 · 40 项'],['full','全部工具 · 70 项']];
export default function ComputerUseSettings({connected,user}:{connected:boolean;user?:User}){
  const transport=useRef(computerUseTransport()).current,epoch=useRef(getSessionEpoch()).current;
  const [config,setConfig]=useState<ComputerUseConfig|null>(null),[draft,setDraft]=useState<ComputerUseConfig|null>(null),[status,setStatus]=useState<ComputerUseStatus|null>(null);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const alive=useRef(false),request=useRef<AbortController|null>(null);
  const allowed=connected&&(transport.native?!!user?.canUseCodex&&(user.isOwner||user.agentAccess==='full'):!!user?.isOwner),allowedNow=useRef(allowed);allowedNow.current=allowed;
  const current=(signal?:AbortSignal)=>alive.current&&allowedNow.current&&getSessionEpoch()===epoch&&!signal?.aborted;
  const dirty=!!config&&!!draft&&(draft.enabled!==config.enabled||draft.profile!==config.profile);
  function apply(value:ComputerUseConfig){setConfig(value);setDraft(value);}
  async function run(label:string,action:(signal:AbortSignal)=>Promise<void>){
    if(!current()||request.current)return;const controller=new AbortController();request.current=controller;setBusy(label);setError('');setNotice('');
    try{await action(controller.signal);}catch(e){if(current(controller.signal)&&!isSessionChanged(e))setError((e as Error).message||'Computer Use 暂不可用。');}
    finally{if(request.current===controller){request.current=null;if(current())setBusy('');}}
  }
  async function refresh(){await run('刷新',async signal=>{const value=await transport.status(signal);if(current(signal)){setStatus(value);apply(value.config);}});}
  useEffect(()=>{alive.current=true;if(allowed)void refresh();return()=>{alive.current=false;request.current?.abort();if(transport.native)void transport.cancel().catch(()=>{});};},[allowed]);
  async function save(event:FormEvent){event.preventDefault();if(!draft)return;await run('保存',async signal=>{const value=await transport.configure(draft,signal);const next=await transport.status(signal);if(current(signal)){apply(value);setStatus(next);setNotice('Computer Use 配置已保存，新 Agent 对话可使用。');}});}
  async function connection(action:'connect'|'disconnect'){await run(action==='connect'?'连接':'断开',async signal=>{const value=await transport[action](signal);if(current(signal)){setStatus(value);setNotice(action==='connect'?'已连接这台电脑的 Zavora MCP。':'已断开桌面控制。');}});}
  const running=!!busy||!!status?.busy;
  return <details className="computer-use-settings"><summary><Monitor size={18}/><span><strong>桌面操作 · Computer Use</strong><small>{transport.native?'这台执行电脑':'服务主机'} · {status?.connected?`已连接 ${status.toolsCount} 项工具`:config?config.enabled?'已启用 · 按任务连接':'已关闭':'读取设置中'}</small></span><ChevronDown size={17}/></summary><div className="computer-use-body">
    <p>让 Agent 识别应用和窗口，读取界面、观察截图，再执行鼠标、键盘或脚本操作。Chat 派发的任务也会使用你选中的执行电脑。</p>
    <p className="field-help">支持的电脑首次配置默认启用，Agent 调用时自动连接；可在下方关闭并保存。已有手动设置会保留。</p>
    {!allowed&&<p className="form-error">{transport.native?'请登录拥有完整 Agent 权限的电脑账号。':'网页仅服务管理员可以配置服务主机；其他账号请在电脑客户端配置自己的执行电脑。'}</p>}{error&&<p className="form-error" role="alert">{error}</p>}
    <form onSubmit={save}><fieldset disabled={!allowed||running||!draft}>
      <label className="computer-use-toggle"><input type="checkbox" checked={draft?.enabled??false} onChange={event=>{setDraft(value=>value?{...value,enabled:event.target.checked}:value);setNotice('');}}/><span>启用这台电脑的桌面操作</span></label>
      <label>可用工具<select value={draft?.profile??'full'} onChange={event=>setDraft(value=>value?{...value,profile:event.target.value as ComputerUseProfile}:value)}>{profiles.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <p className="field-help">需要在 Agent 中选择完整访问；询问模式逐项确认，自动运行按任务执行。脚本与剪贴板也受同一权限约束。</p>
      <div className="computer-use-actions"><button className="primary-button" disabled={!dirty}><Check size={15}/>保存</button><button className="secondary-button" type="button" disabled={dirty||!config?.enabled||!status?.readiness.nativeCompatible||status?.connected} onClick={()=>void connection('connect')}><Link2 size={15}/>连接</button><button className="secondary-button" type="button" disabled={!status?.connected} onClick={()=>void connection('disconnect')}><Unplug size={15}/>断开</button></div>
    </fieldset></form>
    <div className="computer-use-status"><span>{status?.readiness.message||'打开后读取本机状态'}</span><button type="button" className="icon-button" aria-label="刷新 Computer Use 状态" disabled={!allowed||running} onClick={()=>void refresh()}>{running?<Loader2 size={16} className="spin"/>:<RefreshCw size={16}/>}</button></div>
    <p className="field-help">Windows 需要已登录的桌面。Ubuntu 建议 X11，需截图、输入与 AT-SPI 组件；内置 x64 / ARM64 兼容模块支持 Ubuntu 22.04。ARM64 尚未完成真实桌面验收。旧安装包尚不包含此功能。</p>
    <a href="https://github.com/zavora-ai/computer-use-mcp" target="_blank" rel="noreferrer">Zavora 项目与平台说明 <ExternalLink size={13}/></a>
    {notice&&<p className="assistant-message" role="status"><Check size={15}/>{notice}</p>}
  </div></details>;
}
