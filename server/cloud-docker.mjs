import path from 'node:path';
import { mkdir, readFile, writeFile, rename, lstat, realpath, unlink, chmod } from 'node:fs/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { CodexBridge } from './codex.mjs';
import { codexToml, codexApprovalCatalog } from './codex-config.mjs';
import { createLocalDocker, validateLocalTransport } from './cloud-docker-local.mjs';
import { createPlatformDocker } from './cloud-docker-platform.mjs';
import {cloudResources} from './cloud-platform-options.mjs';
import { approvalReviewCapability } from './approval-review.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const failure = (status, message, code = 'cloud_docker_unavailable') => Object.assign(new Error(message), { status, code });
const stamp = () => new Date().toISOString();
const hash = value => createHash('sha256').update(value).digest('hex');
const fields = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k));
const text = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
export function cloudProjectDirectory(value) {
  if (value === undefined || value === '') return '/workspaces/project';
  if (!text(value, 4096) || value.includes('\\') || value.split('/').includes('..') || !(value === '/workspaces/project' || value.startsWith('/workspaces/project/'))) throw failure(400, '云端项目目录必须位于 /workspaces/project 内。', 'project_directory_invalid');
  return path.posix.normalize(value);
}
function origin(value) {
  let url; try { url = new URL(value); } catch { throw failure(409, '请先配置容器能够访问的小伴服务地址。', 'cloud_docker_model_origin_required'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) throw failure(409, '容器回连地址需要可达的 HTTP(S) 服务根地址。', 'cloud_docker_model_origin_required');
  return url.origin;
}

/** Independent ownership journal. It never imports desktop/central host records. */
export async function createCloudDocker({ dataDir, serviceLinks, authorizeUser, authorizeEntry = () => {}, getConfig, publicOrigin, localTransport, localDriver, platformDriver, bridgeFactory = options => new CodexBridge(options), fetchImpl = fetch, clock = Date.now, refreshMs = 15000 } = {}) {
  if (!dataDir || typeof authorizeUser !== 'function' || typeof getConfig !== 'function' || typeof publicOrigin !== 'function') throw new Error('云端环境需要独立目录、账号授权与模型配置。');
  const directory = path.resolve(dataDir, 'cloud-docker'), file = path.join(directory, 'state.json');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const initialDir = await lstat(directory), resolvedDirectory = await realpath(directory);
  if (!initialDir.isDirectory() || initialDir.isSymbolicLink() || resolvedDirectory.toLowerCase() !== directory.toLowerCase()) throw failure(503, '云端环境私有目录需要人工检查。', 'cloud_docker_storage_invalid');
  if (process.platform !== 'win32') await chmod(directory, 0o700);
  const guard = async () => { const current = await lstat(directory); if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== initialDir.dev || current.ino !== initialDir.ino) throw failure(503, '云端环境目录身份发生变化。', 'cloud_docker_storage_invalid'); };
  let state;
  try { const meta = await lstat(file); if (!meta.isFile() || meta.isSymbolicLink() || meta.nlink !== 1 || meta.size > 2 * 1024 * 1024) throw new Error(); state = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw failure(503, '云端环境状态需要恢复，请保留原文件。', 'cloud_docker_storage_invalid'); state = { schema: 'petpal-cloud-docker.v1', instanceId: randomUUID(), localTransport: validateLocalTransport(localTransport), records: [] }; }
  if (state.schema !== 'petpal-cloud-docker.v1' || !UUID.test(state.instanceId) || !Array.isArray(state.records) || state.records.length > 4096) throw failure(503, '云端环境状态无效。', 'cloud_docker_storage_invalid');
  const ids = new Set();
  for (const r of state.records) { if (!fields(r, ['id','userId','name','source','nodeId','requestedNodeId','bundle','state','generation','desktopAvailable','createdAt','updatedAt','containerName','projectId','requestId','clientId','errorCode','executionUncertain','creationPending','runtimeKind','resources','requestedResources']) || !UUID.test(r.id) || ids.has(r.id) || !text(r.userId,160) || !text(r.name,120) || !['local','platform'].includes(r.source) || !['agent','desktop'].includes(r.bundle) || !UUID.test(r.requestId) || r.source === 'local' && r.containerName !== `petpal-${state.instanceId.slice(0,8)}-${r.id}` || r.source === 'platform' && (!UUID.test(r.projectId) || !UUID.test(r.clientId) || r.nodeId && !UUID.test(r.nodeId))) throw failure(503, '云端环境归属无效。', 'cloud_docker_storage_invalid'); if(r.runtimeKind!==undefined&&(!['docker','kubernetes'].includes(r.runtimeKind)||r.source!=='platform'||!r.resources||r.runtimeKind==='kubernetes'&&(r.bundle!=='agent'||!r.nodeId)))throw failure(503,'云端运行时状态无效。','cloud_docker_storage_invalid');if(r.resources)cloudResources(r.resources);if(r.requestedResources)cloudResources(r.requestedResources);ids.add(r.id); if(r.creationPending===undefined && (['creating','create_failed'].includes(r.state)||!r.generation||r.source==='local'&&String(r.generation).includes(':0001-01-01')))r.creationPending=true; r.state = 'unknown'; r.desktopAvailable = false; }
  if (localTransport !== undefined) state.localTransport = validateLocalTransport(localTransport);
  state.localTransport = validateLocalTransport(state.localTransport);
  const local = localDriver ?? createLocalDocker({ transport: state.localTransport, contextRoot: directory }), platform = platformDriver ?? createPlatformDocker(serviceLinks);
  let closed = false, saving = Promise.resolve(), refreshing;
  const operations = new Set(), creationRequests = new Set(), bindings = new Set(), tokens = new Map(), desktops = new Set();
  const checkUser = userId => { if (closed) throw failure(503, '云端环境后台已关闭。'); const user = authorizeUser(userId); if (!user || user.disabled || user.enabled === false) throw failure(403, '账号不可用。', 'cloud_docker_forbidden'); return user; };
  const get = (userId, id) => { const user = checkUser(userId), record = state.records.find(r => r.id === id); if (!record || record.userId !== userId && !user.isAdmin) throw failure(404, '云端环境不存在或不属于当前账号。', 'cloud_docker_forbidden'); return record; };
  async function save() {
    const bytes = JSON.stringify(state) + '\n';
    const job = saving.catch(() => {}).then(async () => { await guard(); try { const prior = await lstat(file); if (!prior.isFile() || prior.isSymbolicLink() || prior.nlink !== 1) throw failure(503, '云端环境状态文件不安全。', 'cloud_docker_storage_invalid'); } catch (e) { if (e.code !== 'ENOENT') throw e; } const temporary = `${file}.${randomUUID()}.tmp`; try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await guard(); await rename(temporary, file); } finally { await unlink(temporary).catch(() => {}); } });
    saving = job; return job;
  }
  await save();
  const driver = r => r.source === 'local' ? local : platform;
  const capabilities = Object.freeze({ projectDirectory: true, steering: true, userInput: true, approvalReview: true, independentReviewModel: false, images: false, automations: false });
  function publicHost(r, viewerUserId) {
    const online=r.state==='running'&&!r.creationPending;
    return { id: r.id, requestId: r.requestId, userId: r.userId, isOwn: r.userId === viewerUserId, name: r.name, kind: 'docker', platform: 'linux', arch: 'unknown', online, capabilities,
      codex: { available: online, authenticated: online, configured: true, supportsSteer: true, images: false, independentReviewModel: false, approvalReview: approvalReviewCapability(true,online,false) },
      docker: { state: r.state, source: r.source, bundle: r.bundle, runtimeKind:r.runtimeKind??'docker', ...(r.resources?{resources:{...r.resources}}:{}), creationPending: r.creationPending === true, desktopAvailable: r.desktopAvailable === true && r.state === 'running', generation: r.generation ?? '', ...(r.errorCode ? { errorCode: r.errorCode } : {}) } };
  }
  const list = userId => { const u = checkUser(userId); return state.records.filter(r => r.userId === userId || u.isAdmin).map(r=>publicHost(r,userId)); };
  const hostFor = (userId, id) => publicHost(get(userId, id),userId);
  const isBusy = (userId, id) => { get(userId,id); return operations.has(id) || [...bindings].some(b => b.record.id === id && (b.running || b.closing)); };
  function target(userId,id,directory,permissions,entry) {
    const r = get(userId,id); cloudProjectDirectory(directory);
    if (r.state !== 'running' || r.creationPending || operations.has(id)) throw failure(409, '云端环境未运行或正在变更，请先启动并刷新。', 'executor_offline');
    if (r.source === 'platform') platform.identity?.(r);
    if (entry && (entry.auth?.userId !== userId || entry.hostId !== id)) throw failure(403, '任务目标或账号发生变化。', 'cloud_docker_forbidden');
    if (permissions?.approval === 'review' && permissions.reviewProviderId) throw failure(409, '云端环境暂不支持独立命令审查模型，请沿用主模型或选择实体机。', 'executor_review_model_unsupported');
    if (entry?.attachmentIds?.length) throw failure(409, '云端环境暂不支持图片附件，请选择实体机执行。', 'executor_images_unsupported');
    return { hostId: r.id, hostName: r.name };
  }
  async function observe(r) {
    const before = r.generation;
    try { const observed = r.source === 'local' ? await local.inspect(r,state.instanceId) : await platform.inspect(r); r.state = observed.state; r.generation = observed.generation; r.desktopAvailable = observed.desktop === true; delete r.errorCode; }
    catch (error) { r.state = 'offline'; r.desktopAvailable = false; r.errorCode = error.code === 'cloud_docker_identity_changed' ? error.code : 'cloud_docker_unavailable'; }
    if(r.executionUncertain){r.state='unknown';r.desktopAvailable=false;r.errorCode='execution_unknown';}
    r.updatedAt = stamp();
    for (const d of desktops) if (d.record === r && (r.state !== 'running' || before && before !== r.generation)) void d.close();
    for (const b of bindings) if (b.record === r && (r.state !== 'running' || before && before !== r.generation)) void b.close();
  }
  async function refresh(userId) {
    const user = checkUser(userId); const selected = state.records.filter(r => r.userId === userId || user.isAdmin);
    await Promise.all(selected.filter(r => !operations.has(r.id)).map(r => observe(r))); checkUser(userId); await save(); return list(userId);
  }
  async function catalog(userId) {
    checkUser(userId); const [engine, remote] = await Promise.all([local.status(), platform.catalog()]); checkUser(userId);
    return { sources: [{ id:'local',name:'中央服务器 Docker',available:engine.available === true,imageAvailable:engine.imageAvailable === true,...(engine.message ? {message:engine.message}: {}) }, {id:'platform',name:'Docker Platform',available:remote.available === true,...(remote.message?{message:remote.message}:{})}], nodes: (remote.nodes ?? []).map(n=>({...n,source:'platform'})), bundles:[{id:'agent',name:'Agent 命令行'},{id:'desktop',name:'Agent 与图形桌面'}] };
  }
  async function recoverCreate(r) {
    if (r.source === 'local') {
      let existing; try { existing = await local.inspect(r,state.instanceId); } catch {}
      if (existing) { if (existing.state !== 'running') await local.action(r,state.instanceId,'start'); }
      else { const engine = await local.status(); if (!engine.available) throw failure(409,'本机 Docker 尚未就绪。'); if (!engine.imageAvailable) await local.prepare(); await local.create(r,state.instanceId); }
    } else {
      const reply = await platform.create(r); r.nodeId = reply.nodeId; await save();
      const actual = await platform.inspect(r); if (actual.state !== 'running') await platform.action(r,'start');
    }
    await observe(r);
    if (r.state !== 'running') throw failure(409,'创建回执已保留，但环境尚未运行；请刷新后启动恢复。');
    delete r.creationPending;
  }
  async function create(userId, options) {
    checkUser(userId);
    if (!fields(options,['name','source','nodeId','bundle','requestId','resources']) || !text(options.name,120) || !['local','platform'].includes(options.source) || options.bundle !== undefined && !['agent','desktop'].includes(options.bundle) || options.nodeId !== undefined && !UUID.test(options.nodeId) || options.requestId !== undefined && !UUID.test(options.requestId)) throw failure(400,'云端环境配置无效。');
    if(options.resources!==undefined){if(options.source!=='platform')throw failure(400,'自定义资源仅适用于平台环境。');cloudResources(options.resources);}
    const requestId=options.requestId??randomUUID(),key=`${userId}:${requestId}`;
    if(creationRequests.has(key))throw failure(409,'此创建请求仍在执行，请等待结果后恢复原请求。','executor_busy');
    creationRequests.add(key);
    try{return await createReserved(userId,options,requestId);}finally{creationRequests.delete(key);}
  }
  async function completeCreation(userId,r) {
    if(operations.has(r.id))throw failure(409,'环境正在恢复，请等待原请求。','executor_busy');
    operations.add(r.id);
    try { await save(); get(userId,r.id); await recoverCreate(r); get(userId,r.id); await save(); return publicHost(r,userId); }
    catch(error) { r.creationPending=true;r.state='create_failed'; r.errorCode=error.code??'cloud_docker_unavailable'; await save(); throw error; }
    finally { operations.delete(r.id); }
  }
  async function createReserved(userId,options,requestId) {
    const existing=state.records.find(r=>r.userId===userId&&r.requestId===requestId);
    if(existing){
      const originalNode=Object.hasOwn(existing,'requestedNodeId')?existing.requestedNodeId:existing.nodeId;
      if(JSON.stringify(existing.requestedResources??null)!==JSON.stringify(options.resources===undefined?null:cloudResources(options.resources)))throw failure(409,'该申请已绑定另一份资源配置。');
      if(existing.name!==options.name.trim()||existing.source!==options.source||existing.bundle!==(options.bundle??'desktop')||existing.source==='platform'&&(originalNode??null)!==(options.nodeId??null))throw failure(409,'该创建请求已绑定另一份配置。');
      return existing.creationPending?completeCreation(userId,existing):hostFor(userId,existing.id);
    }
    if (state.records.filter(r=>r.userId===userId).length >= 8) throw failure(409,'每个账号最多创建 8 个云端环境。');
    const r = { id:randomUUID(),userId,name:options.name.trim(),source:options.source,bundle:options.bundle??'desktop',creationPending:true,state:'creating',generation:'',desktopAvailable:false,createdAt:stamp(),updatedAt:stamp(),requestId };
    if (r.source === 'local') r.containerName = `petpal-${state.instanceId.slice(0,8)}-${r.id}`;
    else { const connection=await platform.credential(); checkUser(userId); r.clientId=connection.clientId; r.projectId=randomUUID(); r.requestedNodeId=options.nodeId??null; if(options.nodeId)r.nodeId=options.nodeId;if(options.resources!==undefined)r.requestedResources=cloudResources(options.resources);if(platform.prepare){Object.assign(r,await platform.prepare(r,options.resources));checkUser(userId);} }
    state.records.push(r);return completeCreation(userId,r);
  }
  async function action(userId,id,action) {
    if(!['start','stop'].includes(action))throw failure(400,'仅支持启动或停止云端环境。');
    const r=get(userId,id); if(isBusy(userId,id))throw failure(409,'环境正在执行任务或变更，请等待完成。','executor_busy');
    if(action==='start'&&r.executionUncertain)throw failure(409,'上次任务停止状态未知，请先停止整个环境确认收尾，再重新启动。','execution_unknown');
    operations.add(id);
    try { if(action==='start' && r.creationPending) await recoverCreate(r); else { if(action==='stop') for(const d of [...desktops])if(d.record===r)await d.close(); const observed=r.source==='local'?await local.action(r,state.instanceId,action):await platform.action(r,action); if(action==='stop'&&observed?.state==='stopped')delete r.executionUncertain; await observe(r); } get(userId,id); await save(); return publicHost(r,userId); }
    finally { operations.delete(id); }
  }
  function bind(entry) {
    target(entry.auth?.userId,entry.hostId,entry.projectDirectory,entry.permissions,entry);
    const record=get(entry.auth.userId,entry.hostId), generation=record.generation; let bridge, token, closedBinding=false, monitor, closing;
    const assert = () => { authorizeEntry(entry); target(entry.auth.userId,entry.hostId,entry.projectDirectory,entry.permissions,entry); if(closedBinding||record.generation!==generation)throw failure(409,'云端环境已切换，原任务不会改派。','execution_unknown'); };
    const binding = { record, userId:entry.auth.userId, assert, running:false, closing:false, hostId:record.id, connectionId:`${record.id}:${hash(generation).slice(0,16)}`,
      async run(args) {
        assert(); if(binding.running||isBusy(entry.auth.userId,record.id))throw failure(409,'此云端环境正在执行其他任务。','executor_busy');
        if(args.images?.length || args.reviewConfig)throw failure(409,'云端暂不支持图片和独立审查模型，请选择实体机。','executor_images_unsupported');
        if(args.projectDirectory!==undefined && cloudProjectDirectory(args.projectDirectory)!==cloudProjectDirectory(entry.projectDirectory))throw failure(409,'项目目录已变化，请重新提交。');
        const config = getConfig(entry); if(config?.mode!=='api'||!text(config.model,160)||!UUID.test(config.revision))throw failure(409,'云端环境需要已授权的 API 模型；暂不接管实体机官方账号。','cloud_docker_api_required');
        const base=origin(publicOrigin()); binding.running=true;
        monitor=setInterval(()=>{try{assert();}catch{void binding.close().catch(()=>{});}},2000);monitor.unref();
        try {
          bridge ??= bridgeFactory({ config:{...config},dataDir:path.join(directory,'bridges',record.id),
            developerInstructions:'当前执行环境是账号独立的 Linux Docker 容器，工作区为 /workspaces/project。它不是用户的实体电脑，不能操作宿主或其他容器。使用本轮实际提供的 Codex shell/文件能力；容器未接入 petpal_* 动态工具、OpenCLI 浏览器扩展、原生 Computer Use MCP 或自动化创建工具，不要声称拥有这些工具。本机 Docker 图形镜像提供 /opt/petpal/browser.sh、xdotool、wmctrl 与 Chromium，浏览器档案仅属于当前容器；Docker Platform 镜像能力以实际执行探测为准，不凭名称猜测。网页登录、验证码和新增协议授权需用户参与。桌面操作前读取当前窗口或截图，执行后检查实际结果；返回链接不代表已经打开或播放。替我审批的原生审查沿用本轮Agent模型。权限拒绝、审批超时、未知执行和断线不应绕过或重复执行。失败应如实报告，不转到实体机或中央执行。',
            resolveDirectory:async value=>{assert();return cloudProjectDirectory(value);},
            processFactory:async ({args:launchArguments,transport})=>{
              assert(); const liveRecord=record.source==='local'?await local.inspect(record,state.instanceId):await platform.inspect(record); assert();
              if(liveRecord.state!=='running'||liveRecord.generation!==generation)throw failure(409,'云端执行环境代次已变化。','execution_unknown');
              token=randomBytes(32).toString('base64url');tokens.set(hash(token),{binding,transport,expiresAt:clock()+60*60*1000});
              const home=`/runtime/petpal/${record.id}/${config.revision}`;
              const catalog=codexApprovalCatalog(await readFile(new URL('./native/codex-review/models-0.143.0.json',import.meta.url)));
              const files={'config.toml':codexToml({...config,apiKey:token,baseUrl:`${base}/api/cloud-docker/model/v1`},{modelCatalogPath:`${home}/approval-models.json`}).replaceAll('PETPAL_CODEX_API_KEY','CODEX_REMOTE_MODEL_PROVIDER_KEY'),'approval-models.json':JSON.stringify(catalog)};
              if(record.source==='local')await local.stage(record,state.instanceId,home,files);else await platform.stage(record,home,files); assert();
              const child=record.source==='local'?await local.process(record,state.instanceId,{args:launchArguments,home,token}):await platform.process(record,{args:launchArguments,home,token,cwd:cloudProjectDirectory(entry.projectDirectory)});
              try { assert(); const after = record.source==='local'?await local.inspect(record,state.instanceId):await platform.inspect(record); if(after.state!=='running'||after.generation!==generation)throw failure(409,'执行环境在启动期间发生变化。','execution_unknown'); }
              catch(error){await child.cloudStop?.().catch(()=>{});throw error;}
              binding.child=child;child.executionWorkspaceRoot='/workspaces/project'; return child;
            },terminateProcess:async child=>{
              try{if(child.cloudStop)await child.cloudStop();else{child.stdin.end();child.kill();}}
              catch(error){record.executionUncertain=true;record.state='unknown';record.errorCode='execution_unknown';record.desktopAvailable=false;await save();throw error;}
            },
          });
          try{return await bridge.run({...args,projectDirectory:cloudProjectDirectory(entry.projectDirectory),projectAccess:'workspace'});}
          catch(error){if(!args.signal?.aborted&&binding.child?.cleanupConfirmed===false)throw failure(409,'云端任务连接中断，执行状态未知；不会自动重试。','execution_unknown');throw error;}
        } finally {
          clearInterval(monitor);
          try { await binding.close(); }
          finally { binding.running=false; }
          if(record.executionUncertain)throw failure(409,'云端任务停止状态未确认；请先停止整个环境，不会自动重试。','execution_unknown');
        }
      },
      async steer(args){assert();if(args.images?.length||args.attachmentIds?.length)throw failure(409,'云端引导暂不支持图片。','executor_images_unsupported');if(!bridge)throw failure(409,'任务尚未启动。','turn_not_active');return bridge.steer(args);},
      async approve(...args){assert();if(!bridge)throw failure(404,'审批已失效。');return bridge.approve(...args);},
      async replyUserInput(...args){assert();if(!bridge)throw failure(404,'提问已失效。');return bridge.replyUserInput(...args);},
      close(){if(closing)return closing;closedBinding=true;binding.closing=true;clearInterval(monitor);if(token)tokens.delete(hash(token));closing=(async()=>{try{await bridge?.close();}finally{binding.closing=false;bindings.delete(binding);}})();return closing;},
    };
    bindings.add(binding); return binding;
  }
  async function modelRequest({authorization,path:requestPath,headers={},body,signal}) {
    if(requestPath!=='/responses'||typeof authorization!=='string'||!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)||!Buffer.isBuffer(body)||body.length>32*1024*1024)throw failure(401,'模型代理请求未授权。','cloud_docker_model_denied');
    const entry=tokens.get(hash(authorization.slice(7))); if(!entry||entry.expiresAt<=clock()||!entry.binding.running)throw failure(401,'模型代理票据已失效。','cloud_docker_model_denied');
    const b=entry.binding; b.assert();
    const forwarded={'content-type':'application/json',authorization:`Bearer ${entry.transport.apiKey}`};
    for(const [key,value]of Object.entries(headers))if((/^x-codex-/i.test(key)||['thread-id','session-id','x-client-request-id','x-openai-subagent'].includes(key.toLowerCase()))&&typeof value==='string'&&value.length<=12000)forwarded[key.toLowerCase()]=value;
    const controller=new AbortController(), combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    const verify=()=>{if(entry.expiresAt<=clock()||!b.running)throw failure(401,'模型代理票据已失效。','cloud_docker_model_denied');b.assert();};
    const timer=setInterval(()=>{try{verify();}catch{controller.abort();}},2000);timer.unref();
    let response;try{response=await fetchImpl(`${entry.transport.baseUrl}/responses`,{method:'POST',headers:forwarded,body,signal:combined,redirect:'error'});verify();}catch(error){clearInterval(timer);controller.abort();throw error;}
    if(!response.body){clearInterval(timer);return response;}
    const reader=response.body.getReader();
    const stream=new ReadableStream({async pull(output){try{verify();const result=await reader.read();verify();if(result.done){clearInterval(timer);output.close();}else output.enqueue(result.value);}catch(error){clearInterval(timer);controller.abort();await reader.cancel().catch(()=>{});output.error(error);}},async cancel(){clearInterval(timer);controller.abort();await reader.cancel().catch(()=>{});}});
    return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
  }
  async function openDesktop(userId,id) {
    target(userId,id);const record=get(userId,id);if(!record.desktopAvailable)throw failure(409,'此环境未启用图形桌面。','desktop_not_supported');
    if([...desktops].filter(d=>d.userId===userId).length>=2||desktops.size>=16)throw failure(429,'桌面连接已达到上限。');
    const generation=record.generation,stream=record.source==='local'?await local.desktop(record,state.instanceId):await platform.desktop(record);let released=false;
    if(stream.generation!==generation){await stream.close();throw failure(409,'桌面在连接期间发生变化，请刷新。','desktop_environment_changed');}
    const d={...stream,userId,record,generation,assertAuthorized(){target(userId,id);if(released||record.generation!==generation)throw failure(409,'桌面环境已变化。','desktop_environment_changed');},async close(){if(released)return;released=true;clearInterval(timer);desktops.delete(d);await stream.close();}};
    const timer=setInterval(()=>{try{d.assertAuthorized();}catch{void d.close();}},2000);timer.unref();desktops.add(d);try{d.assertAuthorized();}catch(e){await d.close();throw e;}return d;
  }
  let timer;
  if(refreshMs>0){timer=setInterval(()=>{if(refreshing||closed)return;refreshing=(async()=>{for(const r of state.records){try{checkUser(r.userId);if(!operations.has(r.id))await observe(r);}catch{}}await save();})().catch(()=>{}).finally(()=>refreshing=null);},Math.max(2000,refreshMs));timer.unref();}
  return {has:id=>state.records.some(r=>r.id===id),list,hostFor,target,isBusy,catalog,create,action,refresh,bind,modelRequest,openDesktop,
    async prepare(userId){if(!checkUser(userId).isAdmin)throw failure(403,'只有管理员可以准备服务器镜像。');return local.prepare();},
    async close(){if(closed)return;closed=true;clearInterval(timer);for(const token of tokens.keys())tokens.delete(token);await Promise.allSettled([...bindings].map(b=>b.close()).concat([...desktops].map(d=>d.close())));await refreshing;await saving;},
  };
}
