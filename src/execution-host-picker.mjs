import {executionPlatform} from './execution-hosts.mjs';

const groupLabels={local:'此电脑',online:'在线电脑',docker:'云端 Docker',central:'中央服务器',offline:'离线或未连接'};
const text=value=>typeof value==='string'?value:'';
const folded=value=>text(value).trim().toLocaleLowerCase();

/** Presentation only. Availability, permissions and frozen task targets remain owned by the caller. */
export function executionHostChoices(hosts=[],value='',localHostId='',canAccessAllHosts=true){
  const choices=hosts.filter(host=>canAccessAllHosts||host.kind!=='central'&&host.isOwn!==false).map(host=>{
    const isLocal=host.kind==='desktop'&&!!localHostId&&host.id===localHostId;
    const online=host.online===true,kind=host.kind==='central'?'central':host.kind==='docker'?'docker':'desktop';
    const platformLabel=kind==='central'?'服务器':kind==='docker'?'Docker · Linux':executionPlatform(host.platform);
    const note=kind==='central'?'任务在服务器执行；操作电脑软件请选择桌面客户端。':kind==='docker'?(!online?'启动这个云端环境后再执行；不会切换到实体机。':host.codex?.available===false?'容器已启动，Codex 执行器正在连接。':'任务在独立容器内执行，可在侧栏查看远程桌面。'):!online?'请在这台电脑登录同一账号，并保持客户端运行。':host.codex?.available===false?'电脑已连接，Codex CLI 暂不可用。':host.codex?.configured===false?'主机默认模型未配置；可以选择账号可用的 Agent 模型。':host.codex?.available===true?'Codex CLI 可用。':'发送任务时将检查 Agent 状态。';
    const ownerLabel=host.owner?`${text(host.owner.displayName)||text(host.owner.username)}${host.owner.username?` · @${text(host.owner.username)}`:''}`:'',isOwn=host.isOwn===true;
    return{id:host.id,name:text(host.name)||'未命名电脑',kind,online,isLocal,missing:false,platformLabel,note,ownerLabel,isOwn,
      group:kind==='docker'?'docker':!online?'offline':isLocal?'local':kind==='central'?'central':'online',
      search:folded(`${host.name||''} ${platformLabel} ${host.platform||''} ${ownerLabel} ${isOwn?'我的电脑':''} ${isLocal?'此电脑':''} ${kind==='central'?'中央服务器':''}`)};
  });
  const names=new Map();for(const choice of choices){const key=folded(`${choice.name} ${choice.platformLabel}`);names.set(key,(names.get(key)||0)+1);}
  for(const choice of choices)choice.disambiguator=names.get(folded(`${choice.name} ${choice.platformLabel}`))>1?text(choice.id).replace(/[^a-z0-9]/gi,'').slice(-6):'';
  if(canAccessAllHosts&&value&&!choices.some(choice=>choice.id===value)){
    choices.push({id:value,name:value==='central'?'中央服务器':'此前选择的电脑',kind:value==='central'?'central':'desktop',online:false,isLocal:false,missing:true,disambiguator:'',ownerLabel:'',isOwn:false,platformLabel:'未连接',note:'保留此前选择，连接恢复后再发送；不会自动切换到其他电脑。',group:'offline',search:folded(value==='central'?'中央服务器 未连接 离线':'此前选择的电脑 未连接 离线')});
  }
  return choices;
}

export function groupExecutionHosts(choices,query=''){
  const tokens=folded(query).split(/\s+/).filter(Boolean);
  return Object.entries(groupLabels).map(([id,label])=>({id,label,choices:choices.filter(choice=>choice.group===id&&tokens.every(token=>choice.search.includes(token)))})).filter(group=>group.choices.length);
}

/** A connected host remains selectable when its default configuration is missing.
 * The selected provider and native execution checks decide whether a task can run.
 */
export function canSelectExecutionHost(choice,disabled=false){
  return !disabled&&choice?.online===true&&choice?.missing===false;
}
