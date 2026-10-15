import {spawn} from 'node:child_process';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, readFile, writeFile, rename, rm, lstat, chmod} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import yaml from 'js-yaml';
import {normalizeRemoteConfigUrl,downloadProxyConfiguration,PROXY_DOWNLOAD_ERRORS} from './app-proxy-download.mjs';

const VERSION='1.19.32',MAX_CONFIG=4*1024*1024;
const REMOTE_PREFIX='# petpal-remote-source: ',MAX_REMOTE_HEADER=32768;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const fail=(message,code='PETPAL_PROXY')=>Object.assign(new Error(message),{code});
const cleanName=value=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\x00-\x1f\x7f]/.test(value);
const sleep=(ms,signal)=>new Promise((resolve,reject)=>{
  const stopped=()=>{clearTimeout(timer);reject(fail('代理操作已取消。'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',stopped);resolve();},ms);
  signal?.addEventListener('abort',stopped,{once:true});if(signal?.aborted)stopped();
});
async function privateDirectory(directory){
  await mkdir(directory,{recursive:true,mode:0o700});
  const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw fail('代理私有目录无效，请保留文件后检查目录权限。');
  await chmod(directory,0o700);
}
async function privateRead(file,max=MAX_CONFIG){
  const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>max)throw fail('代理配置文件无效或过大，原文件已保留。');
  return readFile(file,'utf8');
}
async function privateWrite(file,value,{beforeCommit=async()=>{}}={}){
  const info=await lstat(file).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(info&&(info.isSymbolicLink()||!info.isFile()))throw fail('代理配置目标无效，原文件已保留。');
  const temporary=path.join(path.dirname(file),`.${path.basename(file)}-${randomUUID()}.tmp`);
  let committed=false;
  try{await writeFile(temporary,value,{flag:'wx',mode:0o600});await chmod(temporary,0o600);await beforeCommit();await rename(temporary,file);committed=true;}
  finally{if(!committed)await rm(temporary,{force:true}).catch(()=>{});}
}

export function parseProxyConfiguration(source){
  if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>MAX_CONFIG)throw fail('请导入不超过 4 MB 的 Clash YAML 配置。');
  let value;try{value=yaml.load(source,{schema:yaml.JSON_SCHEMA});}catch{throw fail('配置不是有效的 YAML，未覆盖原配置。');}
  if(!plain(value))throw fail('代理配置必须为 YAML 对象。');
  let nodes=0,expandedBytes=0;const ancestors=new Set();
  const visit=(item,depth=0)=>{
    if(++nodes>60000||depth>48)throw fail('代理配置层级或展开内容过多。');
    expandedBytes+=typeof item==='string'?Buffer.byteLength(item):16;
    if(expandedBytes>MAX_CONFIG)throw fail('代理配置层级或展开内容过多。');
    if(item===null||['string','boolean'].includes(typeof item))return;
    if(typeof item==='number'&&Number.isFinite(item))return;
    if(!Array.isArray(item)&&!plain(item))throw fail('代理配置包含不支持的 YAML 类型。');
    if(ancestors.has(item))throw fail('代理配置不支持循环引用。');ancestors.add(item);
    for(const [key,entry] of Object.entries(item)){expandedBytes+=Buffer.byteLength(key);if(['__proto__','constructor','prototype'].includes(key))throw fail('代理配置包含无效字段。');visit(entry,depth+1);}
    ancestors.delete(item);
  };visit(value);
  for(const key of ['proxy-providers','rule-providers']){
    if(value[key]!==undefined&&!plain(value[key]))throw fail('代理 provider 配置无效。');
    let index=0;for(const provider of Object.values(value[key]||{})){
      if(!plain(provider))throw fail('代理 provider 配置无效。');
      if(provider.type==='file')throw fail('文件型 provider 请先合并到单个 YAML；小伴不会读取配置目录以外的文件。');
      if(provider.path!==undefined)provider.path=`./providers/${key}-${index++}.yaml`;
    }
  }
  // All file paths are confined to this private runtime. These options can
  // otherwise create listeners, change host DNS/routes or read external files.
  for(const key of ['external-controller','external-controller-tls','external-controller-unix','external-controller-pipe','external-ui','external-ui-url','external-ui-name','external-ui-path','tls','listeners','tunnels','tuic-server','ss-config','vmess-config','iptables','ntp','hosts','geox-url','geodata-mode','geodata-loader','geo-auto-update','geo-update-interval','geodata-path'])delete value[key];
  return value;
}

function canonicalConfiguration(config){
  const source=yaml.dump(config,{schema:yaml.JSON_SCHEMA,noRefs:true,lineWidth:120});
  if(Buffer.byteLength(source)>MAX_CONFIG)throw fail('规范化后的代理配置超过 4 MB，原配置已保留。');
  return source;
}

function sourceHeader(remote){
  if(!remote)return '';
  const header=REMOTE_PREFIX+Buffer.from(JSON.stringify({version:1,url:remote.url,updatedAt:remote.updatedAt})).toString('base64url')+'\n';
  if(Buffer.byteLength(header)>MAX_REMOTE_HEADER)throw fail('远程配置来源记录无效，原配置已保留。');
  return header;
}

// Only files written by this manager may carry source metadata. Imported YAML
// always passes through parse + dump first, so a fetched/manual comment cannot
// become a saved URL. A malformed private header disables refresh, never guesses.
async function storedConfiguration(file){
  let source=await privateRead(file,MAX_CONFIG+MAX_REMOTE_HEADER),remote=null;
  if(source.startsWith(REMOTE_PREFIX)){
    const end=source.indexOf('\n');
    if(end<0||Buffer.byteLength(source.slice(0,end+1))>MAX_REMOTE_HEADER)throw fail('远程配置来源记录无效，原配置已保留。');
    const encoded=source.slice(REMOTE_PREFIX.length,end);
    if(!/^[A-Za-z0-9_-]+$/.test(encoded))throw fail('远程配置来源记录无效，原配置已保留。');
    try{
      const bytes=Buffer.from(encoded,'base64url');if(bytes.toString('base64url')!==encoded)throw new Error();
      const value=JSON.parse(bytes.toString('utf8'));
      if(!plain(value)||Object.keys(value).length!==3||value.version!==1||typeof value.url!=='string'||typeof value.updatedAt!=='string'||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.updatedAt)||new Date(value.updatedAt).toISOString()!==value.updatedAt||normalizeRemoteConfigUrl(value.url)!==value.url)throw new Error();
      remote={url:value.url,updatedAt:value.updatedAt};
    }catch{throw fail('远程配置来源记录无效，原配置已保留。');}
    source=source.slice(end+1);
  }
  return{config:parseProxyConfiguration(source),remote};
}

export function runtimeProxyConfiguration(value,{port,controllerPort,username,password,secret}){
  const config=structuredClone(value);
  Object.assign(config,{'mixed-port':port,port:0,'socks-port':0,'redir-port':0,'tproxy-port':0,'allow-lan':false,'bind-address':'127.0.0.1',ipv6:false,
    authentication:[`${username}:${password}`],'skip-auth-prefixes':[],
    'external-controller':`127.0.0.1:${controllerPort}`,secret,'log-level':'silent',
    tun:{enable:false},dns:{enable:false},sniffer:{enable:false},'find-process-mode':'off','profile':{'store-selected':false,'store-fake-ip':false}});
  const direct=['IP-CIDR,127.0.0.0/8,DIRECT,no-resolve','IP-CIDR,10.0.0.0/8,DIRECT,no-resolve','IP-CIDR,172.16.0.0/12,DIRECT,no-resolve','IP-CIDR,192.168.0.0/16,DIRECT,no-resolve','IP-CIDR,169.254.0.0/16,DIRECT,no-resolve','IP-CIDR6,::1/128,DIRECT,no-resolve','IP-CIDR6,fc00::/7,DIRECT,no-resolve','IP-CIDR6,fe80::/10,DIRECT,no-resolve','DOMAIN,localhost,DIRECT','DOMAIN-SUFFIX,local,DIRECT'];
  config.rules=[...direct,...(Array.isArray(config.rules)?config.rules:[])];
  return yaml.dump(config,{schema:yaml.JSON_SCHEMA,noRefs:true,lineWidth:120});
}

export async function resolveBundledMihomo({root,resourcesPath,packaged=false,platform=process.platform,arch=process.arch}){
  if(!['win32','linux'].includes(platform)||!['x64','arm64'].includes(arch))throw fail('此平台暂无内置代理内核。');
  const directory=packaged?path.join(resourcesPath,'mihomo'):path.join(root,'.tools','mihomo',`v${VERSION}`,`${platform}-${arch}`);
  let audit,pinned;try{audit=JSON.parse(await privateRead(path.join(directory,'audit.json'),65536));pinned=JSON.parse(await readFile(new URL('./native/mihomo/manifest.json',import.meta.url),'utf8')).targets[`${platform}-${arch}`]?.executable;}catch{throw fail('内置代理内核尚未准备好，请更新完整客户端。');}
  const name=platform==='win32'?'mihomo.exe':'mihomo';
  if(audit.version!==VERSION||audit.platform!==platform||audit.arch!==arch||audit.executable!==name||!Number.isSafeInteger(audit.bytes)||!/^[a-f0-9]{64}$/.test(audit.sha256||'')||pinned?.name!==name||pinned?.sha256!==audit.sha256||pinned?.bytes!==audit.bytes)throw fail('内置代理内核清单不匹配。');
  const executable=path.join(directory,name),info=await lstat(executable);
  if(!info.isFile()||info.isSymbolicLink()||info.size!==audit.bytes)throw fail('内置代理内核文件不匹配。');
  const hash=createHash('sha256');for await(const chunk of createReadStream(executable))hash.update(chunk);
  if(hash.digest('hex')!==audit.sha256)throw fail('内置代理内核校验失败，请重新下载完整客户端。');
  return{executable,version:VERSION,platform,arch};
}

function reservePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}
export function mihomoEnvironment(env=process.env){
  const allowed=['SystemRoot','WINDIR','PATH','TEMP','TMP','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR'];
  return Object.fromEntries(allowed.filter(key=>typeof env[key]==='string').map(key=>[key,env[key]]));
}

export class AppProxyManager{
  constructor({directory,resolveCore,network,spawnImpl=spawn,fetchImpl=fetch,downloadImpl=downloadProxyConfiguration,env=process.env,startTimeoutMs=20000,testTimeoutMs=20000,terminateTimeoutMs=2000,killTimeoutMs=3000}={}){
    if(!path.isAbsolute(directory||'')||typeof resolveCore!=='function'||!network)throw new Error('Invalid application proxy setup');
    Object.assign(this,{directory,resolveCore,network,spawnImpl,fetch:fetchImpl,download:downloadImpl,env,startTimeoutMs,testTimeoutMs,terminateTimeoutMs,killTimeoutMs});
    this.preferences={autoStart:false};this.state='stopped';this.configured=false;this.error='';this.pending=Promise.resolve();this.child=null;this.closed=false;this.controller=null;this.core=null;this.runtime=null;this.groups=[];
    this.epoch=0;this.cancelGeneration=0;this.children=new WeakMap();this.deactivation=Promise.resolve();this.closing=null;
    this.remoteSource=null;
  }
  _queue(work){const task=this.pending.then(()=>{if(this.closed)throw fail('代理正在退出。');return work();});this.pending=task.catch(()=>{});return task;}
  _queueConfiguration(work){const generation=this.cancelGeneration;return this._queue(()=>{if(generation!==this.cancelGeneration)throw fail('代理操作已取消。');return work();});}
  status(){return{supported:true,state:this.state,configured:this.configured,autoStart:this.preferences.autoStart,version:VERSION,platform:process.platform,arch:process.arch,
    running:this.state==='running',remoteConfigured:!!this.remoteSource,...(this.remoteSource?{remoteUpdatedAt:this.remoteSource.updatedAt}:{}),groups:this.groups.map(group=>({...group,choices:[...group.choices]})),...(this.error?{error:this.error}:{})};}
  async load(){
    await privateDirectory(this.directory);
    try{const value=JSON.parse(await privateRead(path.join(this.directory,'settings.json'),4096));if(!plain(value)||Object.keys(value).some(key=>key!=='autoStart')||typeof value.autoStart!=='boolean')throw new Error();this.preferences=value;}
    catch(error){if(error.code!=='ENOENT')this.error='代理启动偏好读取失败，已保持关闭，原文件未覆盖。';}
    this.configured=false;this.remoteSource=null;
    try{const stored=await storedConfiguration(path.join(this.directory,'config.yaml'));this.remoteSource=stored.remote;this.configured=true;}
    catch(error){if(error.code!=='ENOENT')this.error='代理配置读取失败，已保持关闭，原文件未覆盖。';}
    return this.status();
  }
  _active(controller,epoch,child){
    if(this.closed||controller.signal.aborted||this.epoch!==epoch)throw fail('代理操作已取消。');
    if(child&&!this._alive(child))throw fail('代理内核已退出，小伴已恢复直连；任务不会自动重试。');
  }
  _alive(child){const state=this.children.get(child);return !!state&&!state.exited&&!state.closed&&child.exitCode===null;}
  async _terminate(child){
    const state=this.children.get(child);if(state?.closed)return;
    try{child.kill();}catch{}
    const wait=async ms=>{let timer;try{return await Promise.race([child.done.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]);}finally{clearTimeout(timer);}};
    if(await wait(this.terminateTimeoutMs))return;
    try{child.kill('SIGKILL');}catch{}
    if(!await wait(this.killTimeoutMs))throw fail('代理内核退出尚未确认，请退出小伴后重试。');
  }
  async _launch(executable,args,signal,validate=false){
    if(this.child&&!this.children.get(this.child)?.closed)throw fail('上一个代理内核退出尚未确认，请关闭代理后重试。');
    const child=this.spawnImpl(executable,args,{cwd:this.directory,env:mihomoEnvironment(this.env),stdio:['ignore','ignore','ignore'],shell:false,windowsHide:true});
    const state={exited:false,closed:false};this.children.set(child,state);this.child=child;
    let exit;child.done=new Promise(resolve=>{child.once('error',()=>{state.exited=true;exit=-1;});child.once('exit',()=>{state.exited=true;});child.once('close',code=>{state.exited=true;state.closed=true;exit=exit===-1?-1:code;resolve();});});
    if(!validate)child.once('close',()=>{if(this.child===child&&['starting','running'].includes(this.state)){
      this.epoch++;this.child=null;this.runtime=null;this.groups=[];this.state='error';this.error='代理内核已退出，小伴已恢复直连；任务不会自动重试。';
      this.deactivation=Promise.resolve().then(()=>this.network.disable({cancelActive:true})).catch(()=>{this.error='代理内核已退出；小伴恢复直连尚未确认，请关闭代理后重试。';});
    }});
    const abort=()=>{try{child.kill();}catch{}};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    if(validate){
      let timer,cancel;
      try{
        await Promise.race([child.done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('配置校验超时，请检查节点、规则及远程 provider 是否可用。')),this.testTimeoutMs);cancel=()=>reject(fail('代理操作已取消。'));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();})]);
        if(signal.aborted)throw fail('代理操作已取消。');if(exit!==0)throw fail('配置校验未通过，请检查节点、规则及远程 provider 是否可用。');
      }finally{
        clearTimeout(timer);signal.removeEventListener('abort',abort);if(cancel)signal.removeEventListener('abort',cancel);
        await this._terminate(child);if(this.child===child)this.child=null;
      }
    }else child.done.finally(()=>signal.removeEventListener('abort',abort));
    return child;
  }
  async _replaceConfiguration(readSource,{authorize=async()=>{},remoteUrl=null}={}){
    if(this.state==='running')throw fail('请先关闭代理，再更换配置。');
    const controller=new AbortController(),epoch=++this.epoch;this.controller=controller;
    const candidate=path.join(this.directory,`candidate-${randomUUID()}.yaml`);this.state='checking';this.error='';
    try{
      await authorize();this._active(controller,epoch);const source=await readSource(controller.signal);
      await authorize();this._active(controller,epoch);
      const config=parseProxyConfiguration(source),canonical=canonicalConfiguration(config),core=await this.resolveCore();this._active(controller,epoch);
      const ports={port:await reservePort(),controllerPort:await reservePort(),username:'petpal',password:randomBytes(24).toString('hex'),secret:randomBytes(24).toString('hex')};
      await privateWrite(candidate,runtimeProxyConfiguration(config,ports));
      await authorize();this._active(controller,epoch);await this._launch(core.executable,['-t','-d',this.directory,'-f',candidate],controller.signal,true);await authorize();this._active(controller,epoch);
      await rm(candidate,{force:true});
      const remote=remoteUrl?{url:remoteUrl,updatedAt:new Date().toISOString()}:null;
      await privateWrite(path.join(this.directory,'config.yaml'),sourceHeader(remote)+canonical,{beforeCommit:async()=>{await authorize();this._active(controller,epoch);}});
      this.configured=true;this.remoteSource=remote;this.state='stopped';return this.status();
    }catch(error){this.state='error';this.error=error?.code==='PETPAL_PROXY'?error.message:'代理配置保存失败，原配置已保留。';throw fail(this.error);}
    finally{await rm(candidate,{force:true}).catch(()=>{});if(this.controller===controller)this.controller=null;}
  }
  importConfiguration(source,{authorize=async()=>{}}={}){return this._queueConfiguration(()=>this._replaceConfiguration(async()=>source,{authorize}));}
  async _downloadRemote(url,signal){
    try{return(await this.download(url,{signal})).yaml;}
    catch(error){if(signal.aborted)throw fail('代理操作已取消。');if(error?.code==='PETPAL_PROXY'&&Object.values(PROXY_DOWNLOAD_ERRORS).includes(error.message))throw error;throw fail(PROXY_DOWNLOAD_ERRORS.FAILED);}
  }
  importRemoteConfiguration(url,{authorize=async()=>{}}={}){return this._queueConfiguration(()=>{
    const remoteUrl=normalizeRemoteConfigUrl(url);
    return this._replaceConfiguration(signal=>this._downloadRemote(remoteUrl,signal),{authorize,remoteUrl});
  });}
  updateRemoteConfiguration({authorize=async()=>{}}={}){return this._queueConfiguration(()=>{
    if(!this.remoteSource)throw fail('尚未保存远程配置来源，请先通过链接导入。');
    const remoteUrl=this.remoteSource.url;
    return this._replaceConfiguration(signal=>this._downloadRemote(remoteUrl,signal),{authorize,remoteUrl});
  });}
  async updatePreferences(patch,{authorize=async()=>{}}={}){return this._queue(async()=>{
    if(!plain(patch)||Object.keys(patch).length!==1||typeof patch.autoStart!=='boolean')throw fail('代理启动选项无效。');
    await authorize();await privateWrite(path.join(this.directory,'settings.json'),JSON.stringify(patch));this.preferences={...patch};return this.status();
  });}
  async _controller(pathname,{method='GET',body,signal}={}){
    if(!this.runtime)throw fail('代理内核尚未就绪。');
    const response=await this.fetch(`http://127.0.0.1:${this.runtime.controllerPort}${pathname}`,{method,headers:{Authorization:`Bearer ${this.runtime.secret}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:signal||AbortSignal.timeout(2500)});
    if(!response.ok)throw fail('代理内核暂未就绪，请刷新状态。');
    if(response.status===204)return{};const text=await response.text();if(Buffer.byteLength(text)>1024*1024)throw fail('代理内核状态过大。');return JSON.parse(text);
  }
  async _groups(){
    const runtime=this.runtime,result=await this._controller('/proxies');if(this.runtime!==runtime)return;this.groups=Object.entries(result.proxies||{}).filter(([name,value])=>cleanName(name)&&value.type==='Selector'&&Array.isArray(value.all)).slice(0,128)
      .map(([name,value])=>({name,selected:cleanName(value.now)?value.now:'',choices:value.all.filter(cleanName).slice(0,2048)}));
  }
  start({authorize=async()=>{}}={}){return this._queue(async()=>{
    if(this.state==='running')return this.status();if(!this.configured)throw fail('请先导入 Clash YAML 配置。');await authorize();
    this.state='starting';this.error='';const controller=new AbortController(),epoch=++this.epoch;this.controller=controller;
    try{
      await this.deactivation;this._active(controller,epoch);
      const {config}=await storedConfiguration(path.join(this.directory,'config.yaml')),core=await this.resolveCore();await authorize();this._active(controller,epoch);
      const runtime=this.runtime={port:await reservePort(),controllerPort:await reservePort(),username:'petpal',password:randomBytes(24).toString('hex'),secret:randomBytes(24).toString('hex')};
      const file=path.join(this.directory,'runtime.yaml');await privateWrite(file,runtimeProxyConfiguration(config,runtime));
      this._active(controller,epoch);const child=await this._launch(core.executable,['-d',this.directory,'-f',file],controller.signal),deadline=Date.now()+this.startTimeoutMs;
      let ready=false;while(Date.now()<deadline&&!controller.signal.aborted&&this._alive(child)){try{const info=await this._controller('/version',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(1000)])});if(String(info.version).replace(/^v/,'')===VERSION){ready=true;break;}}catch{}await sleep(120,controller.signal);}
      if(!ready)throw fail('代理内核启动失败，检查配置与节点资源后重试。');await authorize();this._active(controller,epoch,child);
      await this.network.enable({url:`http://${runtime.username}:${runtime.password}@127.0.0.1:${runtime.port}`});this._active(controller,epoch,child);await authorize();this._active(controller,epoch,child);
      this.state='running';await this._groups().catch(()=>{});this._active(controller,epoch,child);return this.status();
    }catch(error){let cleanupError;try{await this._stop();}catch(stopped){cleanupError=stopped;}this.state='error';this.error=cleanupError?.message||(error?.code==='PETPAL_PROXY'?error.message:'代理未能启用，小伴已恢复直连。');throw fail(this.error);}
    finally{if(this.controller===controller)this.controller=null;}
  });}
  async _stop(){
    this.state='stopping';this.epoch++;this.controller?.abort();await this.deactivation;
    let failure;try{await this.network.disable({cancelActive:true});}catch{failure=fail('恢复直连尚未确认，请关闭代理后重试。');}
    const child=this.child;if(child){try{await this._terminate(child);if(this.child===child)this.child=null;}catch(error){failure=error;}}
    this.runtime=null;this.groups=[];
    try{await rm(path.join(this.directory,'runtime.yaml'),{force:true});}catch{failure||=fail('代理运行配置清理失败，请退出小伴后检查私有目录。');}
    if(failure){this.state='error';this.error=failure.message;throw failure;}this.state='stopped';
  }
  async stop({authorize=async()=>{}}={}){await authorize();this.cancelGeneration++;this.epoch++;this.controller?.abort();return this._queue(async()=>{await authorize();await this._stop();this.error='';return this.status();});}
  select(group,name,{authorize=async()=>{}}={}){return this._queue(async()=>{
    await authorize();if(this.state!=='running'||!cleanName(group)||!cleanName(name))throw fail('请先启用代理并选择有效节点。');await this._groups();
    if(!this.groups.some(item=>item.name===group&&item.choices.includes(name)))throw fail('节点列表已变化，请刷新后再选。');await authorize();
    await this._controller(`/proxies/${encodeURIComponent(group)}`,{method:'PUT',body:{name}});await authorize();await this._groups();return this.status();
  });}
  async refresh(){if(this.state==='running')await this._groups().catch(()=>{});return this.status();}
  close(){if(this.closing)return this.closing;this.closed=true;this.cancelGeneration++;this.epoch++;this.controller?.abort();this.closing=(async()=>{await this.pending;try{await this._stop();}finally{await this.network.close();}})();return this.closing;}
}

export const MIHOMO_VERSION=VERSION;
