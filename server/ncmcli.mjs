import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chmod,lstat,mkdir,open,readFile,realpath,rename,unlink} from 'node:fs/promises';

export const NCMCLI_VERSION='0.1.7';
export const NCMCLI_PACKAGE='@music163/ncm-cli';
export const NCMCLI_COMMANDS=Object.freeze(['--version','--help','help','commands','search','playlist','login']);
const applicationUrl='https://developer.music.163.com/st/developer/apply/account?type=INDIVIDUAL';
const failure=(status,message,code)=>Object.assign(new Error(message),{status,code});
const aborted=()=>Object.assign(failure(499,'网易云操作已停止。','cancelled'),{name:'AbortError'});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const canonical=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
// Executor reconnects can replace managers while a failed termination is pending.
// Keep ownership until the original child really closes, across manager instances.
const scopeOperations=new Map();
const sensitive=/^(?:private[_-]?key|app[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|cookies?|authorization|password|MUSIC_U|__csrf)$/i;

export function validateNcmCliCall(value){
  if(!object(value)||Object.keys(value).some(key=>!['action','args'].includes(key))||!['status','prepare','run'].includes(value.action))throw failure(400,'网易云CLI操作参数无效。','invalid_arguments');
  if(value.action!=='run'){if(Object.hasOwn(value,'args'))throw failure(400,'此操作不接受命令参数。','invalid_arguments');return{action:value.action};}
  if(!Array.isArray(value.args)||!value.args.length||value.args.length>40||value.args.some(arg=>typeof arg!=='string'||!arg||arg.length>2048||/[\x00-\x1f\x7f]/.test(arg))||Buffer.byteLength(JSON.stringify(value.args))>6000)throw failure(400,'网易云命令须是大小受限的参数数组。','invalid_arguments');
  const [command,...args]=value.args;
  if(!NCMCLI_COMMANDS.includes(command))throw failure(400,'此入口开放官方云端音乐查询和歌单；本地播控请使用现有桌面音乐工具，配置、升级、上传和诊断由用户操作。','unsupported_command');
  if(command==='login'&&(args.length!==1||args[0]!=='--check'))throw failure(400,'扫码登录由用户操作；Agent仅允许login --check（可能续期）。','interactive_command');
  if(['--version','--help'].includes(command)&&args.length)throw failure(400,'版本和总览帮助不接受附加参数。','invalid_arguments');
  if(command==='commands'&&(args.length>1||args.length===1&&args[0]!=='--help'))throw failure(400,'命令目录仅接受无参数或--help。','invalid_arguments');
  if(command==='help'&&(args.length>1||args.length===1&&!NCMCLI_COMMANDS.includes(args[0])))throw failure(400,'请查询开放的音乐命令帮助。','unsupported_command');
  if(value.args.some(arg=>/^--(?:app[-_]?id|private[-_]?key|app[-_]?secret|token|cookie|config(?:[-_]?path)?|api[-_]?key|base[-_]?url|manifest(?:[-_]?url)?)(?:=|$)/i.test(arg)))throw failure(400,'凭据与账号配置由用户在本机向导设置，不能通过Agent命令覆盖。','credential_arguments');
  const fileField=name=>/(?:file|upload|download|cover|image|imgs?|video|audio|folder|directory|background)/i.test(name.replaceAll('-','').replaceAll('_',''));
  const optionIndex=args.findIndex(arg=>arg.startsWith('-')),subcommands=args.slice(0,optionIndex<0?args.length:optionIndex);
  if(subcommands.some(fileField)||args.some(arg=>arg.startsWith('--')&&fileField(arg.slice(2).split('=')[0])))throw failure(400,'此入口未适配本地文件读取、上传、下载或后台派生任务。','file_arguments');
  if(['search','playlist'].includes(command)&&!args.includes('--help')){
    const index=args.indexOf('--userInput'),inline=args.find(arg=>arg.startsWith('--userInput='));
    if(!(index>=0&&args[index+1]&&!args[index+1].startsWith('--'))&&!(inline&&inline.length>12))throw failure(400,'云端命令须附--userInput和本次音乐需求的简短摘要，不发送全部对话。','user_input_required');
  }
  return{action:'run',args:[...value.args]};
}

/** Provider secrets, alternate loaders, proxies and host music state are excluded. */
export function ncmCliEnvironment(profile,source=process.env){
  const allowed=/^(?:path|systemroot|windir|systemdrive|comspec|pathext|lang|lc_[a-z_]+|display|wayland_display|xdg_runtime_dir|dbus_session_bus_address)$/i;
  const env=Object.fromEntries(Object.entries(source).filter(([key,value])=>allowed.test(key)&&typeof value==='string'));
  return Object.assign(env,{HOME:profile,USERPROFILE:profile,APPDATA:path.join(profile,'AppData','Roaming'),LOCALAPPDATA:path.join(profile,'AppData','Local'),XDG_CONFIG_HOME:path.join(profile,'.config'),XDG_DATA_HOME:path.join(profile,'.local','share'),TEMP:path.join(profile,'tmp'),TMP:path.join(profile,'tmp'),TMPDIR:path.join(profile,'tmp'),ELECTRON_RUN_AS_NODE:'1',NO_COLOR:'1'});
}

export function redactNcmCliOutput(value){
  const clean=text=>String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,'[已隐藏私钥]')
    .replace(/\bBearer\s+[^\s"',;]+/gi,'Bearer [已隐藏]')
    .replace(/((["']?(?:private[_-]?key|app[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|cookies?|authorization|password|MUSIC_U|__csrf)["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;}]+)/gi,'$1[已隐藏]')
    .replace(/([?&#](?:token|key|code|session|auth|cookie)[^=&#]*=)[^&#\s"']+/gi,'$1[已隐藏]');
  const sanitize=item=>Array.isArray(item)?item.map(sanitize):object(item)?Object.fromEntries(Object.entries(item).map(([key,value])=>[key,sensitive.test(key)?'[已隐藏]':sanitize(value)])):typeof item==='string'?clean(item):item;
  let result;try{result=JSON.stringify(sanitize(JSON.parse(String(value))));}catch{result=clean(value);}
  return result.slice(0,48000);
}

/** Inspect each ancestor before creating or accessing the next component. */
async function safePath(target,{create=false,directory=true}={}){
  const resolved=path.resolve(target),root=path.parse(resolved).root;
  let cursor=root;
  const components=path.relative(root,resolved).split(path.sep).filter(Boolean);
  for(let index=0;index<=components.length;index++){
    if(index)cursor=path.join(cursor,components[index-1]);
    let info;try{info=await lstat(cursor);}catch(error){
      if(error.code!=='ENOENT')throw error;
      if(!create)return null;
      try{await mkdir(cursor,{mode:0o700});}catch(creation){if(creation.code!=='EEXIST')throw creation;}
      info=await lstat(cursor);
    }
    const last=index===components.length;
    if(info.isSymbolicLink()||((!last||directory)?!info.isDirectory():!info.isFile())||canonical(await realpath(cursor))!==canonical(cursor))throw failure(409,'网易云账号或运行时路径不可经过链接或未知文件。','invalid_path');
    if(last)return info;
  }
}

async function runtimeAt(metadataPath){
  try{await lstat(metadataPath);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const info=await safePath(metadataPath,{directory:false});if(!info)return null;
  if(info.size<1||info.size>32768)throw failure(409,'网易云CLI包元数据无效。','invalid_runtime');
  let metadata;try{metadata=JSON.parse(await readFile(metadataPath,'utf8'));}catch{throw failure(409,'网易云CLI包元数据无法读取。','invalid_runtime');}
  if(metadata.name!==NCMCLI_PACKAGE||metadata.version!==NCMCLI_VERSION||metadata.bin?.['ncm-cli']!=='dist/index.js')throw failure(409,'请安装固定的官方 @music163/ncm-cli@0.1.7。','invalid_runtime');
  const entry=path.join(path.dirname(metadataPath),'dist','index.js'),entryInfo=await safePath(entry,{directory:false});
  if(!entryInfo||entryInfo.size<1||entryInfo.size>25*1024*1024)throw failure(409,'官方网易云CLI入口缺失或无效。','invalid_runtime');
  return{entry,version:metadata.version,packageJsonPath:metadataPath};
}

/** Optional account runtime first; global candidates are package files, never PATH .cmd. */
export async function resolveNcmCli({runtimeDirectory,env=process.env,platform=process.platform,globalPackageJsonPath}={}){
  const candidates=[];
  if(runtimeDirectory)candidates.push({metadataPath:path.join(runtimeDirectory,'node_modules','@music163','ncm-cli','package.json')});
  if(globalPackageJsonPath)candidates.push({metadataPath:path.resolve(globalPackageJsonPath)});
  const developmentMetadata=path.join(fileURLToPath(new URL('../',import.meta.url)),'node_modules','@music163','ncm-cli','package.json');
  for(const directory of String(env.PATH||env.Path||'').split(platform==='win32'?';':':').filter(Boolean)){
    const resolved=path.resolve(directory.replace(/^"|"$/g,''));
    const metadataPath=platform==='win32'?path.join(resolved,'node_modules','@music163','ncm-cli','package.json'):path.join(path.dirname(resolved),'lib','node_modules','@music163','ncm-cli','package.json');
    if(canonical(metadataPath)===canonical(developmentMetadata))continue;
    const bin=path.join(resolved,platform==='win32'?'ncm-cli.cmd':'ncm-cli');
    let binInfo;try{binInfo=await lstat(bin);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(platform==='win32'&&(!binInfo.isFile()||binInfo.isSymbolicLink()))continue;
    candidates.push({metadataPath,bin});
  }
  const seen=new Set();
  for(const candidate of candidates){
    if(seen.has(candidate.metadataPath))continue;seen.add(candidate.metadataPath);
    const runtime=await runtimeAt(candidate.metadataPath);if(!runtime)continue;
    if(candidate.bin&&platform!=='win32'&&canonical(await realpath(candidate.bin))!==canonical(runtime.entry))continue;
    return runtime;
  }
  return null;
}

/** Bounded child ownership is retained when termination cannot be confirmed. */
export function runNcmCliProcess(file,args,{signal,env,cwd,timeoutMs=30000,shutdownTimeoutMs=2000,maxOutputBytes=128*1024,spawnProcess=spawn,platform=process.platform}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(aborted());
    let child,error,size=0,stdout=[],stderr=[],settled=false,killing=false,timer,force,deadline;
    let release;const ownedCompletion=new Promise(done=>{release=done;});
    const finish=(code,spawnError)=>{
      release();clearTimeout(timer);clearTimeout(force);clearTimeout(deadline);signal?.removeEventListener('abort',cancel);
      if(settled)return;settled=true;
      if(error||spawnError)reject(error||failure(502,'网易云CLI运行环境不可用。','spawn_error'));
      else resolve({exitCode:code,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')});
    };
    const terminate=()=>{
      if(killing||!child)return;killing=true;
      if(platform==='win32'&&Number.isSafeInteger(child.pid)){
        const root=env?.SystemRoot||env?.SYSTEMROOT||env?.systemroot||process.env.SystemRoot||'C:\\Windows';
        try{const killer=spawnProcess(path.join(root,'System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});killer.on('error',()=>{try{child.kill();}catch{}});}catch{try{child.kill();}catch{}}
      }else try{process.kill(-child.pid,'SIGTERM');}catch{try{child.kill('SIGTERM');}catch{}}
      if(settled)return;
      force=setTimeout(()=>{try{if(platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}},shutdownTimeoutMs);
      deadline=setTimeout(()=>{
        if(settled)return;settled=true;
        const pending=failure(502,'网易云命令停止未能确认；当前入口保持占用，待本机进程关闭。','shutdown_failed');pending.ownedCompletion=ownedCompletion;reject(pending);
      },shutdownTimeoutMs*2);
    };
    const cancel=()=>{error=aborted();terminate();};
    timer=setTimeout(()=>{error=failure(504,'网易云CLI响应超时，已停止此次命令。','timeout');terminate();},timeoutMs);
    try{child=spawnProcess(file,args,{env,cwd,shell:false,windowsHide:true,detached:platform!=='win32',stdio:['ignore','pipe','pipe']});}
    catch(spawnError){finish(null,spawnError);return;}
    const capture=(chunks,bytes)=>{size+=Buffer.byteLength(bytes);if(size>maxOutputBytes){error=failure(502,'网易云返回内容超过上限，请缩小查询。','output_limit');terminate();}else chunks.push(Buffer.from(bytes));};
    child.stdout.on('data',bytes=>capture(stdout,bytes));child.stderr.on('data',bytes=>capture(stderr,bytes));
    child.once('error',()=>{error=failure(502,'网易云CLI运行环境不可用。','spawn_error');terminate();});child.once('close',code=>finish(code));
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  });
}

export class NcmCliManager{
  constructor({dataDir,scope='local',env=process.env,platform=process.platform,node=process.execPath,resolve=resolveNcmCli,run=runNcmCliProcess,globalPackageJsonPath,timeoutMs=30000,shutdownTimeoutMs=2000}={}){
    if(typeof dataDir!=='string'||!dataDir||/[\x00-\x1f\x7f]/.test(dataDir)||platform==='win32'&&dataDir.includes('"')||typeof scope!=='string'||!scope||scope.length>2048||/[\x00-\x1f\x7f]/.test(scope)||!path.isAbsolute(node)||/[\x00-\x1f\x7f"]/.test(node)||!['win32','linux','darwin'].includes(platform))throw new Error('无法确认网易云账号目录或运行环境。');
    for(const value of [timeoutMs,shutdownTimeoutMs])if(!Number.isInteger(value)||value<1||value>300000)throw new Error('网易云超时配置无效。');
    this.dataDir=path.resolve(dataDir);this.env=env;this.platform=platform;this.node=node;this.resolve=resolve;this.run=run;this.globalPackageJsonPath=globalPackageJsonPath;this.timeoutMs=timeoutMs;this.shutdownTimeoutMs=shutdownTimeoutMs;
    this.root=path.join(this.dataDir,'ncmcli',createHash('sha256').update(scope).digest('hex'));this.profile=path.join(this.root,'profile');this.runtimeDirectory=path.join(this.root,'runtime');this.active=null;this.closed=false;
  }
  _check(operation){if(this.closed||operation.controller.signal.aborted)throw aborted();}
  async _operation(work,{signal}={}){
    const scopeKey=canonical(this.root);
    if(this.closed||signal?.aborted)throw aborted();if(this.active||scopeOperations.has(scopeKey))throw failure(409,'另一项网易云操作正在执行，请稍后重试。','busy');
    let finish;const operation={controller:new AbortController(),done:new Promise(resolve=>{finish=resolve;}),retained:null};operation.finish=finish;this.active=operation;
    scopeOperations.set(scopeKey,operation);
    const release=()=>{if(this.active===operation)this.active=null;if(scopeOperations.get(scopeKey)===operation)scopeOperations.delete(scopeKey);operation.finish();};
    const cancel=()=>operation.controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    try{const result=await work(operation);this._check(operation);return result;}
    catch(error){if(error.ownedCompletion){operation.retained=error.ownedCompletion;error.ownedCompletion.finally(release);}throw error;}
    finally{signal?.removeEventListener('abort',cancel);if(!operation.retained)release();}
  }
  async _ensure(operation){
    for(const directory of [this.dataDir,path.join(this.dataDir,'ncmcli'),this.root,this.profile,...['tmp','AppData/Roaming','AppData/Local','.config/ncm-cli','.local/share'].map(relative=>path.join(this.profile,relative))]){
      this._check(operation);await safePath(directory,{create:true});this._check(operation);await chmod(directory,0o700);
    }
  }
  async _runtime(operation){const runtime=await this.resolve({runtimeDirectory:this.runtimeDirectory,env:this.env,platform:this.platform,globalPackageJsonPath:this.globalPackageJsonPath});this._check(operation);return runtime;}
  async _status(operation){
    await safePath(this.root);this._check(operation);
    const runtime=await this._runtime(operation);const credentials=await safePath(path.join(this.profile,'.config','ncm-cli','credentials.enc.json'),{directory:false});this._check(operation);
    return{available:Boolean(runtime),version:runtime?.version||'',credentialsPresent:Boolean(credentials?.size),loginVerified:false,profileDirectory:this.profile,runtimeDirectory:this.runtimeDirectory,requiresUserSetup:!runtime||!credentials?.size,applicationUrl,playbackSupported:false,
      message:!runtime?'官方CLI未安装。请准备本机向导，由用户运行固定版本安装脚本。':!credentials?.size?'请准备本机向导，由用户申请API凭据、配置并扫码。':'已发现本机凭据文件；未在线验证。login --check可能续期。本地播放使用现有桌面音乐工具。'};
  }
  status(options={}){return this._operation(operation=>this._status(operation),options);}
  async _prepare(operation){
    const runtime=await this._runtime(operation);await this._ensure(operation);
    const launcher=path.join(this.root,'launch.mjs'),environment=ncmCliEnvironment(this.profile,this.env);
    const candidates=[path.join(this.runtimeDirectory,'node_modules','@music163','ncm-cli','package.json'),...(runtime?[runtime.packageJsonPath||path.join(path.dirname(path.dirname(runtime.entry)),'package.json')]:[])];
    const script=`import {spawn} from 'node:child_process';\nimport {lstat,readFile,realpath} from 'node:fs/promises';\nimport path from 'node:path';\nconst command=process.argv[2];\nif(!['configure','login'].includes(command))throw new Error('Choose configure or login');\nconst candidates=${JSON.stringify(candidates)};\nconst canonical=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);\nasync function check(file,directory=false){let cursor=path.parse(file).root;const parts=path.relative(cursor,file).split(path.sep).filter(Boolean);for(let i=0;i<=parts.length;i++){if(i)cursor=path.join(cursor,parts[i-1]);const info=await lstat(cursor);if(info.isSymbolicLink()||((i<parts.length||directory)?!info.isDirectory():!info.isFile())||canonical(await realpath(cursor))!==canonical(cursor))throw new Error('Runtime path must not use links');}}\nlet entry;for(const metadataPath of candidates){try{await check(metadataPath);const metadata=JSON.parse(await readFile(metadataPath,'utf8'));if(metadata.name!==${JSON.stringify(NCMCLI_PACKAGE)}||metadata.version!==${JSON.stringify(NCMCLI_VERSION)}||metadata.bin?.['ncm-cli']!=='dist/index.js')throw new Error('Install official pinned CLI first');entry=path.join(path.dirname(metadataPath),'dist/index.js');await check(entry);break;}catch(error){if(error.code!=='ENOENT')throw error;}}\nif(!entry)throw new Error('请先由用户运行 install 脚本，再打开配置或登录向导。');\nconst child=spawn(process.execPath,[entry,command],{env:${JSON.stringify(environment)},cwd:${JSON.stringify(this.profile)},shell:false,stdio:'inherit',windowsHide:false});\nchild.on('error',()=>{console.error('无法启动网易云配置向导');process.exitCode=1;});\nchild.on('exit',code=>{process.exitCode=code??1;});\n`;
    const quote=value=>`'${value.replaceAll("'","'\\''")}'`,windows=value=>value.replaceAll('%','%%');
    const launchers={},files=[['launch.mjs',"if(process.argv.length!==3)throw new Error('Choose one fixed setup action');\n"+script]];
    for(const command of ['install','configure','login']){
      const name=command+(this.platform==='win32'?'.cmd':'.sh');launchers[command]=path.join(this.root,name);
      const installArgs=`install --prefix ${this.platform==='win32'?`"${windows(this.runtimeDirectory)}"`:quote(this.runtimeDirectory)} --ignore-scripts --save-exact --registry=https://registry.npmjs.org ${NCMCLI_PACKAGE}@${NCMCLI_VERSION}`;
      const content=this.platform==='win32'?`@echo off\r\nsetlocal DisableDelayedExpansion\r\n${command==='install'?`npm ${installArgs}`:`set "ELECTRON_RUN_AS_NODE=1"\r\nnode "%~dp0launch.mjs" ${command}`}\r\nif errorlevel 1 (echo Operation failed. Please check Node.js and npm. & pause & exit /b 1)\r\npause\r\n`:`#!/bin/sh\nset -eu\n${command==='install'?`npm ${installArgs}`:`ELECTRON_RUN_AS_NODE=1 exec node ${quote(launcher)} ${command}`}\n`;
      files.push([name,content]);
    }
    for(const [name,content]of files){
      this._check(operation);const file=path.join(this.root,name);await safePath(file,{directory:false});this._check(operation);
      const temporary=path.join(this.root,`${name}.${randomUUID()}.tmp`);let handle;
      try{handle=await open(temporary,'wx',this.platform==='win32'?0o600:0o700);await handle.writeFile(content);await handle.sync();await handle.close();handle=null;this._check(operation);await safePath(this.root);await safePath(file,{directory:false});this._check(operation);await rename(temporary,file);await chmod(file,this.platform==='win32'?0o600:0o700);}
      finally{await handle?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
    }
    return{ok:true,prepared:true,installed:Boolean(runtime),version:runtime?.version||'',launchers,applicationUrl,profileDirectory:this.profile,runtimeDirectory:this.runtimeDirectory,
      message:'由用户在所选执行电脑运行install脚本（需Node.js/npm，独立安装固定官方版本且禁用安装脚本），申请开放平台appId/privateKey，再运行configure、login扫码。不要在聊天发送私钥。准备完成不表示已经安装、登录、搜索或播放。'};
  }
  prepare(options={}){return this._operation(operation=>this._prepare(operation),options);}
  execute(value,options={}){
    const request=validateNcmCliCall(value);if(request.action==='status')return this.status(options);if(request.action==='prepare')return this.prepare(options);
    return this._operation(async operation=>{
      const runtime=await this._runtime(operation);if(!runtime)throw failure(409,'官方网易云CLI尚未安装，请准备本机用户安装向导。','runtime_missing');
      await this._ensure(operation);this._check(operation);
      const result=await this.run(this.node,[runtime.entry,...request.args],{signal:operation.controller.signal,env:ncmCliEnvironment(this.profile,this.env),cwd:this.profile,timeoutMs:this.timeoutMs,shutdownTimeoutMs:this.shutdownTimeoutMs,platform:this.platform});this._check(operation);
      return{ok:result.exitCode===0,exitCode:result.exitCode,stdout:redactNcmCliOutput(result.stdout),stderr:redactNcmCliOutput(result.stderr),requiresUserSetup:/API key 未设置|请先登录|未授权|未登录/.test(result.stdout+result.stderr),playbackVerified:false};
    },options);
  }
  async cancel(){const active=this.active;active?.controller.abort();if(active)await this._awaitClosed(active);}
  async _awaitClosed(active){let timer;try{await Promise.race([active.done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure(502,'网易云自有进程尚未确认关闭；当前保持占用。','shutdown_failed')),this.shutdownTimeoutMs*3);})]);}finally{clearTimeout(timer);}}
  async close(){this.closed=true;const active=this.active;active?.controller.abort();if(active)await this._awaitClosed(active);}
}
