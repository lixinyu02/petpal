import {executionPlatform} from './execution-hosts.mjs';

const groupLabels={local:'此电脑',online:'在线电脑',central:'中央服务器',offline:'离线或未连接'};
const text=value=>typeof value==='string'?value:'';
const folded=value=>text(value).trim().toLocaleLowerCase();

/** Presentation only. Availability, permissions and frozen task targets remain owned by the caller. */
export function executionHostChoices(hosts=[],value='',localHostId=''){
  const choices=hosts.map(host=>{
    const isLocal=host.kind==='desktop'&&!!localHostId&&host.id===localHostId;
    const online=host.online===true,kind=host.kind==='central'?'central':'desktop';
    const platformLabel=kind==='central'?'服务器':executionPlatform(host.platform);
    const note=kind==='central'?'任务在服务器执行；操作电脑软件请选择桌面客户端。':!online?'请在这台电脑登录同一账号，并保持客户端运行。':host.codex?.available===false?'电脑已连接，Codex CLI 暂不可用。':host.codex?.configured===false?'主机默认模型未配置；可以选择账号可用的 Agent 模型。':host.codex?.available===true?'Codex CLI 可用。':'发送任务时将检查 Agent 状态。';
    return{id:host.id,name:text(host.name)||'未命名电脑',kind,online,isLocal,missing:false,platformLabel,note,
      group:!online?'offline':isLocal?'local':kind==='central'?'central':'online',
      search:folded(`${host.name||''} ${platformLabel} ${host.platform||''} ${isLocal?'此电脑':''} ${kind==='central'?'中央服务器':''}`)};
  });
  const names=new Map();for(const choice of choices){const key=folded(`${choice.name} ${choice.platformLabel}`);names.set(key,(names.get(key)||0)+1);}
  for(const choice of choices)choice.disambiguator=names.get(folded(`${choice.name} ${choice.platformLabel}`))>1?text(choice.id).replace(/[^a-z0-9]/gi,'').slice(-6):'';
  if(value&&!choices.some(choice=>choice.id===value))choices.push({id:value,name:'此前选择的电脑',kind:'desktop',online:false,isLocal:false,missing:true,disambiguator:'',platformLabel:'未连接',note:'保留此前选择，连接恢复后再发送；不会自动切换到其他电脑。',group:'offline',search:folded('此前选择的电脑 未连接 离线')});
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
