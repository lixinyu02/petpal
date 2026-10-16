import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,readFile,open,rename,unlink,chmod,realpath} from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

export const APP_PROXY_PROFILE_LIMITS=Object.freeze({yamlBytes:4*1024*1024,storageBytes:40*1024*1024,profiles:32,groups:128,choices:2048,users:256});
const fail=(status,message)=>Object.assign(new Error(message),{status,code:'app_proxy_profile'});
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const cleanName=value=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\x00-\x1f\x7f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const id=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const modes=new Set(['rule','global','direct']);
const removed=['external-controller','external-controller-tls','external-controller-unix','external-controller-pipe','external-ui','external-ui-url','external-ui-name','external-ui-path','tls','listeners','tunnels','tuic-server','ss-config','vmess-config','iptables','ntp','hosts','geox-url','geodata-mode','geodata-loader','geo-auto-update','geo-update-interval','geodata-path','interface-name','routing-mark','authentication','skip-auth-prefixes','script','external-doh-server','external-controller-cors','external-controller-routing-mark','clash-for-android','experimental'];

function remoteUrl(input){
  try{
    if(typeof input!=='string'||input.length>4096||/[\x00-\x20\x7f\\]/.test(input))throw new Error();
    const value=new URL(input);if(value.protocol!=='https:'||!value.hostname||value.username||value.password||value.hash||value.port==='0')throw new Error();return value.href;
  }catch{throw fail(400,'代理 provider 需要有效的 HTTPS 地址。');}
}

/** Never fetches provider URLs or executes a supplied program. The native core validates usability. */
export function normalizeServerProxyYaml(source){
  if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>APP_PROXY_PROFILE_LIMITS.yamlBytes)throw fail(400,'请导入不超过 4 MB 的 Clash YAML 配置。');
  let value;try{value=yaml.load(source,{schema:yaml.JSON_SCHEMA});}catch{throw fail(400,'配置不是有效的 YAML，原配置已保留。');}
  if(!plain(value))throw fail(400,'代理配置必须为 YAML 对象。');
  const ancestors=new Set();let nodes=0,bytes=0;
  function visit(item,depth=0){
    if(++nodes>60000||depth>48)throw fail(400,'代理配置层级或展开内容过多。');
    bytes+=typeof item==='string'?Buffer.byteLength(item):16;if(bytes>APP_PROXY_PROFILE_LIMITS.yamlBytes)throw fail(400,'代理配置展开后超过 4 MB。');
    if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return;
    if(!Array.isArray(item)&&!plain(item))throw fail(400,'代理配置包含不支持的 YAML 类型。');
    if(ancestors.has(item))throw fail(400,'代理配置不支持循环引用。');ancestors.add(item);
    for(const [key,entry]of Object.entries(item)){bytes+=Buffer.byteLength(key);if(['__proto__','constructor','prototype'].includes(key))throw fail(400,'代理配置包含无效字段。');visit(entry,depth+1);}
    ancestors.delete(item);
  }
  visit(value);
  for(const key of removed)delete value[key];
  for(const key of ['proxy-providers','rule-providers']){
    if(value[key]!==undefined&&!plain(value[key]))throw fail(400,'代理 provider 配置无效。');
    let index=0;for(const provider of Object.values(value[key]||{})){
      if(!plain(provider)||!['http','inline'].includes(provider.type))throw fail(400,'仅支持 HTTPS 或内联 provider，请合并文件型 provider。');
      if(provider.type==='http')provider.url=remoteUrl(provider.url);
      else if(!Array.isArray(provider.payload)||provider.payload.length>APP_PROXY_PROFILE_LIMITS.choices||provider.payload.some(proxy=>!plain(proxy)||!cleanName(proxy.name)))throw fail(400,'内联代理 provider 的节点列表无效。');
      provider.path=`./providers/${key}-${index++}.yaml`;
    }
  }
  if(value.proxies!==undefined&&(!Array.isArray(value.proxies)||value.proxies.length>APP_PROXY_PROFILE_LIMITS.choices))throw fail(400,'代理节点数量或格式无效。');
  const nodesByName=new Set();
  for(const proxy of value.proxies||[]){
    if(!plain(proxy)||!cleanName(proxy.name)||nodesByName.has(proxy.name))throw fail(400,'代理节点名称无效或重复。');nodesByName.add(proxy.name);
    for(const key of ['certificate','private-key','ca','client-cert','client-key'])if(proxy[key]!==undefined&&(typeof proxy[key]!=='string'||!proxy[key].includes('-----BEGIN ')))throw fail(400,'代理证书须为内联内容，不能读取本地文件。');
  }
  if(value.rules!==undefined&&(!Array.isArray(value.rules)||value.rules.some(rule=>typeof rule!=='string')))throw fail(400,'代理规则格式无效。');
  if(value['proxy-groups']!==undefined&&(!Array.isArray(value['proxy-groups'])||value['proxy-groups'].length>APP_PROXY_PROFILE_LIMITS.groups))throw fail(400,'代理组数量或格式无效。');
  const groups=[],groupNames=new Set();
  for(const group of value['proxy-groups']||[]){
    if(!plain(group)||!cleanName(group.name)||groupNames.has(group.name)||typeof group.type!=='string')throw fail(400,'代理组名称或类型无效。');groupNames.add(group.name);
    if(group.proxies!==undefined&&(!Array.isArray(group.proxies)||group.proxies.length>APP_PROXY_PROFILE_LIMITS.choices||group.proxies.some(name=>!cleanName(name))))throw fail(400,'代理组节点列表无效。');
    if(group.use!==undefined&&(!Array.isArray(group.use)||group.use.length>APP_PROXY_PROFILE_LIMITS.groups||group.use.some(name=>!cleanName(name)||!Object.hasOwn(value['proxy-providers']||{},name))))throw fail(400,'代理组 provider 列表无效或引用不存在。');
    if(group.type==='select')groups.push({name:group.name,choices:[...new Set(group.proxies||[])],...(group.use?.length?{dynamic:true}:{})});
  }
  const configuredMode=value.mode===undefined?'rule':value.mode;if(!modes.has(configuredMode))throw fail(400,'代理模式只支持 rule、global 或 direct。');
  value.mode=configuredMode;
  let canonical;try{canonical=yaml.dump(value,{schema:yaml.JSON_SCHEMA,noRefs:true,lineWidth:120});}catch{throw fail(400,'代理配置无法规范化，原配置已保留。');}
  if(Buffer.byteLength(canonical)>APP_PROXY_PROFILE_LIMITS.yamlBytes)throw fail(400,'规范化后的代理配置超过 4 MB。');
  return{yaml:canonical,sha256:digest(canonical),mode:configuredMode,groups};
}

function selections(value,groups){
  if(!plain(value)||Object.keys(value).length>APP_PROXY_PROFILE_LIMITS.groups)throw fail(400,'代理默认选择格式无效。');
  const result={};for(const [group,name]of Object.entries(value)){
    if(!cleanName(group)||!cleanName(name)||!groups.some(item=>item.name===group&&(item.choices.includes(name)||item.dynamic===true)))throw fail(400,'代理默认选择不在配置的节点列表中。');
    result[group]=name;
  }return result;
}
function publicProfile(value,admin=false){
  return{id:value.id,name:value.name,revision:value.revision,sha256:value.sha256,updatedAt:value.updatedAt,mode:value.mode,selections:{...value.selections},groups:value.groups.map(group=>({name:group.name,choices:[...group.choices],...(group.dynamic?{dynamic:true}:{})})),...(admin?{userIds:[...value.userIds]}:{})};
}

/** Independent private repository; failed or revoked writes never change committed memory. */
export class AppProxyProfiles{
  constructor({dataDir,users=()=>[],beforeCommit=async()=>{}}={}){
    if(!path.isAbsolute(dataDir||'')||typeof users!=='function'||typeof beforeCommit!=='function')throw new TypeError('Invalid proxy profile repository');
    this.directory=path.join(dataDir,'app-proxy-profiles');this.file=path.join(this.directory,'profiles.json');this.users=users;this.beforeCommit=beforeCommit;this.profiles=[];this.queue=Promise.resolve();this.closed=false;
  }
  async init(){
    try{
      await mkdir(this.directory,{recursive:true,mode:0o700});const directory=await lstat(this.directory);
      const canonical=path.resolve(await realpath(this.directory)),expected=path.resolve(this.directory);
      if(!directory.isDirectory()||directory.isSymbolicLink()||(process.platform==='win32'?canonical.toLowerCase()!==expected.toLowerCase():canonical!==expected))throw new Error();
      await chmod(this.directory,0o700);
      let info;try{info=await lstat(this.file);}catch(error){if(error.code==='ENOENT')return this;throw error;}
      if(!info.isFile()||info.isSymbolicLink()||info.size>APP_PROXY_PROFILE_LIMITS.storageBytes)throw new Error();
      const saved=JSON.parse(await readFile(this.file,'utf8'));
      if(!plain(saved)||Object.keys(saved).length!==2||saved.version!==1||!Array.isArray(saved.profiles)||saved.profiles.length>APP_PROXY_PROFILE_LIMITS.profiles)throw new Error();
      const ids=new Set();for(const entry of saved.profiles){
        if(!plain(entry)||Object.keys(entry).length!==10||!id(entry.id)||ids.has(entry.id)||!id(entry.revision)||!cleanName(entry.name)||!modes.has(entry.mode)||typeof entry.updatedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.updatedAt)||new Date(entry.updatedAt).toISOString()!==entry.updatedAt||!Array.isArray(entry.userIds)||entry.userIds.length>APP_PROXY_PROFILE_LIMITS.users||entry.userIds.some(userId=>!id(userId))||new Set(entry.userIds).size!==entry.userIds.length)throw new Error();
        const normalized=normalizeServerProxyYaml(entry.yaml),legacyGroups=normalized.groups.map(({name,choices})=>({name,choices}));
        if(normalized.yaml!==entry.yaml||entry.sha256!==normalized.sha256||![JSON.stringify(normalized.groups),JSON.stringify(legacyGroups)].includes(JSON.stringify(entry.groups)))throw new Error();
        entry.groups=normalized.groups;
        selections(entry.selections,normalized.groups);ids.add(entry.id);
      }this.profiles=saved.profiles;return this;
    }catch{throw fail(500,'服务器代理配置存储无法读取，请保留原文件并检查备份。');}
  }
  _available(){if(this.closed)throw fail(503,'服务器正在退出。');}
  _visible(profile,userId){return profile&&profile.userIds.includes(userId);}
  list(userId){this._available();return{profiles:this.profiles.filter(profile=>this._visible(profile,userId)).map(profile=>publicProfile(profile))};}
  listAdmin(){this._available();return{profiles:this.profiles.map(profile=>publicProfile(profile,true))};}
  get(profileId,userId){this._available();const profile=this.profiles.find(value=>value.id===profileId);if(!this._visible(profile,userId))throw fail(404,'服务器代理配置不存在或未分配给此账号。');return publicProfile(profile);}
  config(profileId,userId,revision){
    this.get(profileId,userId);const profile=this.profiles.find(value=>value.id===profileId);
    if(profile.revision!==revision)throw fail(409,'服务器代理配置已更新，请刷新后重试。');return{yaml:profile.yaml,revision:profile.revision,sha256:profile.sha256};
  }
  _serialize(work){const pending=this.queue.catch(()=>{}).then(()=>{this._available();return work();});this.queue=pending;return pending;}
  _userIds(value){
    if(!Array.isArray(value)||value.length>APP_PROXY_PROFILE_LIMITS.users||value.some(userId=>!id(userId)||!this.users().some(user=>user.id===userId&&!user.disabled)))throw fail(400,'请选择有效的代理配置授权账号。');
    return[...new Set(value)];
  }
  async _save(next,authorize,validate=()=>{}){
    const contents=JSON.stringify({version:1,profiles:next});if(Buffer.byteLength(contents)>APP_PROXY_PROFILE_LIMITS.storageBytes)throw fail(400,'服务器代理配置总量已达上限，请先整理已有配置。');
    const temporary=path.join(this.directory,`.profiles-${randomUUID()}.tmp`);let written=false;
    try{
      await authorize();this._available();
      const info=await lstat(this.file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info&&(!info.isFile()||info.isSymbolicLink()))throw fail(500,'服务器代理配置保存失败，原配置已保留。');
      const handle=await open(temporary,'wx',0o600);
      try{await handle.writeFile(contents,'utf8');await handle.sync();}finally{await handle.close();}
      await chmod(temporary,0o600);await this.beforeCommit();await authorize();this._available();
      // Recheck newly assigned targets at the final boundary without blocking removal of old grants.
      validate();
      await rename(temporary,this.file);written=true;this.profiles=next;
    }catch(error){if(error?.code==='app_proxy_profile'||[401,403,503].includes(error?.status))throw error;throw fail(500,'服务器代理配置保存失败，原配置已保留。');}
    finally{if(!written)await unlink(temporary).catch(()=>{});}
  }
  mutate(profileId,input,{creatorId,authorize=()=>{}}={}){return this._serialize(async()=>{
    await authorize();const existing=profileId?this.profiles.find(profile=>profile.id===profileId):null;
    if(profileId&&!existing)throw fail(404,'服务器代理配置不存在。');
    const allowed=['name','yaml','mode','selections','userIds',...(existing?['revision']:[])];
    if(!plain(input)||Object.keys(input).some(key=>!allowed.includes(key)))throw fail(400,'服务器代理配置请求格式无效。');
    if(existing&&(!id(input.revision)||input.revision!==existing.revision))throw fail(409,'服务器代理配置已更新，请刷新后重试。');
    if(!existing&&this.profiles.length>=APP_PROXY_PROFILE_LIMITS.profiles)throw fail(400,'服务器代理配置数量已达上限。');
    const name=input.name??existing?.name;if(!cleanName(name)||name!==name.trim())throw fail(400,'配置名称须为 1 至 160 个可见字符。');
    const normalized=normalizeServerProxyYaml(input.yaml??existing?.yaml),mode=input.mode??existing?.mode??normalized.mode;
    if(!modes.has(mode))throw fail(400,'代理模式只支持 rule、global 或 direct。');
    const selected=selections(input.selections??existing?.selections??{},normalized.groups);
    const userIds=this._userIds(input.userIds??existing?.userIds??[creatorId]);
    const profile={id:existing?.id||randomUUID(),name,revision:randomUUID(),sha256:normalized.sha256,updatedAt:new Date().toISOString(),mode,selections:selected,groups:normalized.groups,userIds,yaml:normalized.yaml};
    const next=existing?this.profiles.map(value=>value.id===existing.id?profile:value):[...this.profiles,profile];
    await this._save(next,authorize,()=>this._userIds(userIds));return publicProfile(profile,true);
  });}
  remove(profileId,input,{authorize=()=>{}}={}){return this._serialize(async()=>{
    await authorize();const existing=this.profiles.find(value=>value.id===profileId);if(!existing)throw fail(404,'服务器代理配置不存在。');
    if(!plain(input)||Object.keys(input).length!==1||!Object.hasOwn(input,'revision'))throw fail(400,'删除代理配置需要当前修订号。');
    if(!id(input.revision)||input.revision!==existing.revision)throw fail(409,'服务器代理配置已更新，请刷新后重试。');
    await this._save(this.profiles.filter(value=>value.id!==profileId),authorize);return{ok:true};
  });}
  async close(){this.closed=true;await this.queue.catch(()=>{});}
}
