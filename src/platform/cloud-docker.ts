import type {AgentHost} from '../api';

export type ServiceLinkKind='docker-platform'|'api-harbor';
export type ServiceLink={kind:ServiceLinkKind;state:string;baseUrl?:string|null;paired?:boolean;error?:string;lastError?:string;catalogUpdatedAt?:string;updatedAt?:string};
export type CloudResources={cpus:number;memoryMiB:number;pids?:number};
export type CloudNode={id:string;name:string;available?:boolean;ready?:boolean;message?:string;runtimeKind?:'docker'|'kubernetes';templates?:{id:string;available?:boolean}[];kubernetesConstraints?:{pidsLimit:number;pidsConfigured:boolean;pidsVerifiedAtCreate:boolean;persistentStorage:boolean;graphical:boolean;gpu:boolean;publishedPorts:boolean}};
export type CloudDockerHost=AgentHost&{userId?:string;requestId?:string;capabilities?:{images?:boolean;independentReviewModel?:boolean};state?:string;source?:'local'|'platform';bundle?:'desktop'|'agent';desktopAvailable?:boolean;docker?:{runtimeKind?:'docker'|'kubernetes';resources?:CloudResources;state?:string;source?:'local'|'platform';bundle?:'desktop'|'agent';desktopAvailable?:boolean;generation?:string;requestId?:string}};
export type CloudDockerCatalog={sources?:{id:'local'|'platform';name?:string;available?:boolean;imageAvailable?:boolean;message?:string}[];local?:{available?:boolean;imageAvailable?:boolean;message?:string};nodes?:CloudNode[];templates?:{id:string;name?:string}[]};
export type DesktopTicket={ticket:string;expiresAt:string|number;path:string};
export const serviceLinkName=(kind:ServiceLinkKind)=>kind==='docker-platform'?'Docker 平台':'API Harbor';
export function dockerStateLabel(host:CloudDockerHost){
  if(host.online)return '运行中';
  const state=host.docker?.state||host.state||'stopped';
  return ({running:'连接执行器中',starting:'启动中',creating:'创建中',create_failed:'创建待恢复',stopping:'停止中',stopped:'已停止',error:'暂不可用',unknown:'状态待确认'} as Record<string,string>)[state]||'未连接';
}
export const dockerHasDesktop=(host:CloudDockerHost)=>host.docker?.desktopAvailable===true||host.desktopAvailable===true||(host.docker?.bundle||host.bundle)==='desktop';
export const dockerDesktopReady=(host:CloudDockerHost)=>host.online&&dockerHasDesktop(host)&&(host.docker?.desktopAvailable??host.desktopAvailable)!==false;
export const serviceLinkPaired=(link?:ServiceLink)=>link?.paired===true||link?.state==='ready';
export const serviceLinkState=(link?:ServiceLink)=>serviceLinkPaired(link)?'已配对':({pending:'等待确认',confirming:'正在确认',offline:'连接中断',revoking:'正在断开',revoked:'已断开'} as Record<string,string>)[link?.state||'']||'未配对';
export function normalizeServiceLinks(value:ServiceLink[]|Record<string,ServiceLink>|undefined){return (Array.isArray(value)?value:Object.values(value??{})).filter(link=>link&&['docker-platform','api-harbor'].includes(link.kind));}

export const cloudNodeReady=(node?:CloudNode)=>!!node&&node.available!==false&&(node.runtimeKind!=='kubernetes'||node.ready===true);
export const cloudRuntimeName=(kind?:string)=>kind==='kubernetes'?'K3s / Kubernetes':'Docker';
