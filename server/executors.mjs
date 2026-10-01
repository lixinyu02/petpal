import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tokenHash, secureEqual } from './auth.mjs';
import { createExecutorRelayRedactor } from './executor-relay.mjs';
import { MODEL_REQUEST_BYTES } from './model-request-limits.mjs';

const failure = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const unknown = () => failure(409, '执行电脑已断开，任务执行状态未知；队列已暂停，不会自动重试。', 'execution_unknown');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const text = (value, maximum = 256) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
const contentText = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = () => new Date().toISOString();

export function validateExecutionHosts(state) {
  if (state.executionHosts === undefined) { state.executionHosts = []; return true; }
  if (!Array.isArray(state.executionHosts) || state.executionHosts.length > state.users.length * 32) throw new Error('执行电脑索引无效。');
  const ids = new Set(), devices = new Set();
  for (const host of state.executionHosts) {
    const device = `${host?.userId}:${host?.deviceId}`;
    if (!fields(host, ['id','userId','deviceId','name','platform','arch','createdAt','lastSeenAt']) || !uuid(host.id) || !uuid(host.deviceId) || !state.users.some(user => user.id === host.userId) || !text(host.name, 120) || !['win32','linux','darwin'].includes(host.platform) || !text(host.arch, 32) || !text(host.createdAt, 40) || !text(host.lastSeenAt, 40) || ids.has(host.id) || devices.has(device)) throw new Error('执行电脑归属或数据无效。');
    ids.add(host.id); devices.add(device);
  }
  return false;
}

/** Central coordinator. Sessions are credentials; client type is never authorization. */
export function createExecutors({ store, authorizeSession, authorizeEntry, readAttachment, getConfig, redact = value => value,
  fetchImpl = fetch, leaseMs = 30000, pollMs = 20000, commandMs = 20000, stopMs = 10000, clock = Date.now } = {}) {
  const connections = new Map(), current = new Map();
  let closed = false, registration = Promise.resolve();
  const localHost = { id: 'central', name: '中央服务器', kind: 'central', platform: process.platform, online: true };
  const hostFor = (userId, id) => {
    if (id === 'central') return localHost;
    const host = store.state.executionHosts.find(item => item.id === id && item.userId === userId);
    if (!host) throw failure(404, '执行电脑不存在或不属于当前账号。');
    return host;
  };
  const live = connection => {
    if (closed || !connection || current.get(connection.host.id) !== connection.id || connection.expiresAt <= clock()) throw failure(409, '执行电脑连接已过期，请重新登录客户端。', 'executor_offline');
    authorizeSession(connection.auth);
    return connection;
  };
  const verify = (id, auth) => {
    const connection = connections.get(id);
    if (!connection || connection.auth.userId !== auth.userId || connection.auth.sessionHash !== auth.sessionHash) throw failure(404, '执行电脑连接不存在。');
    return live(connection);
  };
  const wake = connection => { connection.waiter?.(); };
  const settle = (run, error, result) => {
    if (run.settled) return;
    run.settled = true; clearTimeout(run.ackTimer); clearTimeout(run.stopTimer); clearTimeout(run.expiryTimer);
    run.args.signal?.removeEventListener('abort', run.abort);
    for (const request of run.relays) request.abort();
    for (const command of run.pending.values()) { clearTimeout(command.timer); command.reject(error ?? failure(409, '任务已结束。')); }
    run.pending.clear(); run.connection.commands = run.connection.commands.filter(command => command.runId !== run.id);
    if (run.connection.run === run) run.connection.run = null;
    run.tokenHash = ''; run.attachments.clear();
    if (error) run.reject(error); else run.resolve(result);
  };
  const offline = connection => {
    if (!connection) return;
    connection.host.lastSeenAt = connection.lastSeenAt;
    if (current.get(connection.host.id) === connection.id) current.delete(connection.host.id);
    if (connection.run) settle(connection.run, unknown());
    connection.commands = []; wake(connection);
    connections.delete(connection.id);
    // Persist once at disconnect, not for every heartbeat. A metadata write
    // failure does not authorize reconnect/replay; live state remains offline.
    void store.save().catch(() => {});
  };
  const checkRun = (run, { stopping = false } = {}) => {
    live(run.connection); authorizeEntry(run.entry);
    if (run.settled || (!stopping && run.stopping) || run.expiresAt <= clock()) throw failure(409, '执行凭据已失效。');
    if (getConfig().revision !== run.entry.codexRevision) throw failure(409, '模型配置已变化。');
  };
  const sweep = () => { for (const connection of connections.values()) { try { live(connection); } catch { offline(connection); } } };
  const timer = setInterval(sweep, Math.min(1000, leaseMs)); timer.unref();
  const list = userId => {
    sweep();
    return [localHost, ...store.state.executionHosts.filter(host => host.userId === userId).map(host => ({ id: host.id, name: host.name, platform: host.platform, kind: 'desktop', online: current.has(host.id), lastSeenAt: current.has(host.id) ? connections.get(current.get(host.id)).lastSeenAt : host.lastSeenAt,
      codex: { available: current.has(host.id), authenticated: current.has(host.id), configured: getConfig().mode === 'api' && Boolean(getConfig().model), supportsSteer: true, mode: 'api', model: getConfig().model, executionMode: 'remote-cli' } }))];
  };
  const target = (userId, id = 'central') => {
    const host = hostFor(userId, id);
    if (id !== 'central') { live(connections.get(current.get(id))); if (getConfig().mode !== 'api' || !getConfig().model) throw failure(409, '远程电脑执行需要中央配置 Responses API 模型。'); }
    return { hostId: host.id, hostName: host.name };
  };
  async function register(auth, body) {
    if (!fields(body, ['deviceId','name','platform','arch']) || !uuid(body.deviceId) || !text(body.name, 120) || !['win32','linux','darwin'].includes(body.platform) || !text(body.arch, 32)) throw failure(400, '执行电脑注册字段无效。');
    const work = registration.catch(() => {}).then(async () => {
      authorizeSession(auth); if (closed) throw failure(503, '执行服务正在退出。');
      let host = store.state.executionHosts.find(item => item.userId === auth.userId && item.deviceId === body.deviceId);
      if (!host) {
        if (store.state.executionHosts.filter(item => item.userId === auth.userId).length >= 32) throw failure(409, '每个账号最多登记 32 台执行电脑。');
        host = { id: randomUUID(), userId: auth.userId, ...body, createdAt: stamp(), lastSeenAt: stamp() }; store.state.executionHosts.push(host);
      } else Object.assign(host, body, { lastSeenAt: stamp() });
      // Superseding a connection is a stop boundary, never permission to replay.
      offline(connections.get(current.get(host.id)));
      host.lastSeenAt = stamp();
      await store.save(); authorizeSession(auth); if (closed) throw failure(503, '执行服务正在退出。');
      const connection = { id: randomUUID(), host, auth: { ...auth }, expiresAt: clock()+leaseMs, lastSeenAt: stamp(), commands: [], run: null, recent: new Map(), waiter: null, polling: false };
      connections.set(connection.id, connection); current.set(host.id, connection.id);
      return { hostId: host.id, connectionId: connection.id, leaseMs, pollMs };
    }); registration = work; return work;
  }
  const heartbeat = (id, auth) => { const connection = verify(id, auth); connection.expiresAt = clock()+leaseMs; connection.lastSeenAt = stamp(); return { ok: true, leaseMs }; };
  async function poll(id, auth, signal) {
    const connection = verify(id, auth);
    if (connection.polling) throw failure(409, '此执行连接已有取件请求。');
    connection.polling = true;
    try {
      if (!connection.commands.length) await new Promise(resolve => {
        let waitTimer;
        const finish = () => { clearTimeout(waitTimer); signal?.removeEventListener('abort', finish); if (connection.waiter === finish) connection.waiter = null; resolve(); };
        connection.waiter = finish; waitTimer = setTimeout(finish, pollMs); signal?.addEventListener('abort', finish, { once: true }); if (signal?.aborted) finish();
      });
      verify(id, auth); signal?.throwIfAborted();
      const command = connection.commands.shift();
      if (command?.type === 'run' && connection.run?.id === command.runId) connection.run.dispatched = true;
      return { commands: command ? [command] : [] };
    } finally { connection.polling = false; }
  }
  const disconnect = (id, auth) => { const connection = verify(id, auth); offline(connection); return { ok: true }; };
  const descriptors = async (run, ids) => {
    const result = [];
    for (const id of ids) {
      const { record, bytes } = await readAttachment(run.entry.auth.userId, id);
      checkRun(run); const item = { id, mimeType: record.mimeType, size: bytes.length, sha256: hash(bytes) };
      run.attachments.set(id, item); result.push(item);
    }
    return result;
  };
  const enqueue = (run, command) => {
    live(run.connection);
    if (run.connection.commands.length >= 8) throw failure(429, '执行电脑命令队列已满。');
    run.connection.commands.push(command); wake(run.connection);
  };
  const rpc = (run, type, data) => {
    checkRun(run); const id = randomUUID();
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject, timer: setTimeout(() => { run.pending.delete(id); run.connection.commands = run.connection.commands.filter(command => command.id !== id); reject(failure(409, '无法确认命令是否已送达，不会自动重试。', 'command_delivery_uncertain')); }, commandMs) };
      run.pending.set(id, pending);
      try { enqueue(run, { id, type, runId: run.id, ...data }); } catch (error) { clearTimeout(pending.timer); run.pending.delete(id); reject(error); }
    });
  };
  function bind(entry) {
    target(entry.auth.userId, entry.hostId);
    const connection = live(connections.get(current.get(entry.hostId)));
    let boundRun;
    return {
      hostId: entry.hostId, connectionId: connection.id,
      async run(args) {
        live(connection); authorizeEntry(entry);
        if (connection.run) throw failure(409, '这台电脑正在执行其他任务，请稍后重试。');
        let resolve, reject; const done = new Promise((yes, no) => { resolve = yes; reject = no; }); done.catch(() => {});
        const token = randomBytes(32).toString('base64url');
        const run = boundRun = { id: entry.id, connection, entry, args, resolve, reject, done, tokenHash: tokenHash(token), expiresAt: clock()+60*60*1000, attachments: new Map(), relays: new Set(), pending: new Map(), approvals: new Map(), sequence: 0, eventHash: '', started: false, dispatched: false, stopping: false, settled: false };
        connection.run = run; connection.recent.set(run.id, run); while (connection.recent.size > 32) connection.recent.delete(connection.recent.keys().next().value);
        run.abort = () => {
          if (run.settled || run.stopping) return; run.stopping = true;
          for (const request of run.relays) request.abort();
          if (!run.dispatched) { settle(run, Object.assign(new Error('任务派发前已停止。'), { name: 'AbortError' })); return; }
          try { enqueue(run, { id: randomUUID(), type: 'stop', runId: run.id }); } catch { settle(run, unknown()); return; }
          run.stopTimer = setTimeout(() => settle(run, unknown()), stopMs);
        };
        args.signal?.addEventListener('abort', run.abort, { once: true });
        run.expiryTimer = setTimeout(run.abort, 60*60*1000);
        try {
          checkRun(run); args.signal?.throwIfAborted();
          const attachments = await descriptors(run, entry.attachmentIds);
          checkRun(run); args.signal?.throwIfAborted();
          enqueue(run, { id: randomUUID(), type: 'run', runId: run.id, conversationId: args.conversationId, prompt: args.prompt, ...(args.threadId ? { threadId: args.threadId } : {}), permissions: args.permissions, model: entry.model, effort: entry.effort, codexRevision: entry.codexRevision, relayToken: token, attachments });
          run.ackTimer = setTimeout(() => settle(run, run.dispatched ? unknown() : failure(409, '执行电脑未领取任务；任务未自动重试。')), commandMs);
        } catch (error) { settle(run, error); }
        return done;
      },
      async steer({ expectedTurnId, content, attachmentIds = [] }) {
        const run = boundRun; if (!run || run.settled) throw failure(409, '此任务已结束。', 'turn_not_active');
        checkRun(run); const attachments = await descriptors(run, attachmentIds); return rpc(run, 'steer', { expectedTurnId, content, attachments });
      },
      async approve(id, decision) {
        const run = boundRun, approvalId = run?.approvals.get(id);
        if (!approvalId) throw failure(404, '审批请求已失效。');
        const result = rpc(run, 'approve', { approvalId, decision });
        // One decision attempt consumes the central approval. An uncertain
        // acknowledgement must not leave a button that resends the operation.
        run.approvals.delete(id); run.args.onEvent?.('approval-resolved', { id });
        return result;
      },
    };
  }
  function events(id, auth, body) {
    const connection = verify(id, auth);
    if (!fields(body, ['runId','sequence','event','data']) || !uuid(body.runId) || !Number.isSafeInteger(body.sequence) || body.sequence < 1 || !text(body.event, 40) || !object(body.data) || JSON.stringify(body).length > 65536) throw failure(400, '执行事件格式无效。');
    const run = connection.recent.get(body.runId);
    if (!run) throw failure(404, '执行任务不存在。');
    const digest = hash(JSON.stringify(body));
    if (body.sequence === run.sequence && digest === run.eventHash) return { ok: true };
    if (run.settled || body.sequence !== run.sequence+1) throw failure(409, '执行事件序号无效或任务已经结束。');
    const { event, data } = body;
    if (!run.started && event !== 'started' && event !== 'error' && event !== 'stopped') throw failure(409, '执行器必须先确认领取任务。');
    if (!run.stopping) checkRun(run);
    const emit = (name, value) => { if (!run.stopping) run.args.onEvent?.(name, redact(value)); };
    // Validate every variant before applying its sequence or touching callbacks.
    if (event === 'started') { if (run.started || Object.keys(data).length) throw failure(400, '任务领取回执无效。'); }
    else if (event === 'thread' || event === 'turn') { const key = event+'Id'; if (!fields(data,[key]) || !text(data[key],200)) throw failure(400,'执行标识无效。'); }
    else if (event === 'delta') { if (!fields(data,['text']) || typeof data.text !== 'string' || data.text.length > 32000) throw failure(400,'执行文本无效。'); }
    else if (event === 'status') { if (!fields(data,['message','text','state']) || Object.values(data).some(value => typeof value !== 'string' || value.length > 1000)) throw failure(400,'执行状态无效。'); }
    else if (event === 'approval') { if (!fields(data,['id','kind','description']) || !text(data.id,200) || !text(data.kind,80) || !contentText(data.description,8000)) throw failure(400,'执行审批无效。'); }
    else if (event === 'approval-resolved') { if (!fields(data,['id']) || !text(data.id,200)) throw failure(400,'执行审批回执无效。'); }
    else if (event === 'complete') { if (!fields(data,['threadId','text']) || (data.threadId !== undefined && !text(data.threadId,200)) || (data.text !== undefined && (typeof data.text !== 'string' || data.text.length > 32000))) throw failure(400,'完成回执无效。'); }
    else if (event === 'error') { if (!fields(data,['message']) || !contentText(data.message,500)) throw failure(400,'失败回执无效。'); }
    else if (event === 'stopped') { if (Object.keys(data).length) throw failure(400,'停止回执无效。'); }
    else if (event === 'command-result') { if (!fields(data,['commandId','ok','code','message','turnId']) || !uuid(data.commandId) || typeof data.ok !== 'boolean' || (data.code !== undefined && !text(data.code,80)) || (data.message !== undefined && !text(data.message,500)) || (data.turnId !== undefined && !text(data.turnId,200))) throw failure(400,'命令回执无效。'); }
    else throw failure(400,'不支持的执行事件。');
    run.sequence = body.sequence; run.eventHash = digest;
    if (event === 'started') { run.started = true; clearTimeout(run.ackTimer); }
    else if (event === 'complete') settle(run, run.stopping ? Object.assign(new Error('任务已停止。'),{name:'AbortError'}) : null, redact(data));
    else if (event === 'error') settle(run, failure(502, String(redact(data.message)).slice(0,500)));
    else if (event === 'stopped') settle(run, Object.assign(new Error('执行电脑已确认任务停止。'),{name:'AbortError'}));
    else if (event === 'command-result') {
      const pending = run.pending.get(data.commandId);
      if (pending) { clearTimeout(pending.timer); run.pending.delete(data.commandId); if (data.ok) pending.resolve({ok:true,...(data.turnId ? {turnId:data.turnId} : {})}); else pending.reject(failure(409, '执行命令未完成。', data.code === 'turn_not_active' ? data.code : 'command_delivery_uncertain')); }
    } else if (event === 'approval') {
      if (run.approvals.size >= 128 || [...run.approvals.values()].includes(data.id)) { settle(run, unknown()); throw failure(409,'审批标识重复或超过上限。'); }
      const approval = randomUUID(); run.approvals.set(approval,data.id); emit(event,{...data,id:approval});
    } else if (event === 'approval-resolved') { const approval = [...run.approvals].find(([,remote]) => remote === data.id)?.[0]; if (approval) { run.approvals.delete(approval); emit(event,{id:approval}); } }
    else emit(event,data);
    return { ok: true };
  }
  const bearerRun = (connectionId, runId, authorization) => {
    const run = connections.get(connectionId)?.run;
    if (!run || run.id !== runId || typeof authorization !== 'string' || !authorization.startsWith('Bearer ') || authorization.length > 200 || !secureEqual(tokenHash(authorization.slice(7)),run.tokenHash)) throw failure(401,'执行凭据无效或已过期。');
    checkRun(run); return run;
  };
  async function attachment(connectionId, runId, id, authorization) {
    const run = bearerRun(connectionId,runId,authorization), expected = run.attachments.get(id);
    if (!expected) throw failure(404,'图片不属于当前任务。');
    const value = await readAttachment(run.entry.auth.userId,id); checkRun(run);
    if (hash(value.bytes) !== expected.sha256) throw failure(409,'图片已变化。'); return value;
  }
  async function relay(req,res) {
    const run = bearerRun(req.params.connectionId,req.params.runId,req.headers.authorization);
    if (!Buffer.isBuffer(req.body) || req.body.length > MODEL_REQUEST_BYTES || req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw failure(400,'模型请求格式无效。');
    let body; try { body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(req.body)); } catch { throw failure(400,'模型请求格式无效。'); }
    if (!object(body) || body.stream !== true || body.model !== run.entry.model || run.relays.size >= 2) throw failure(400,'模型请求不属于当前任务。');
    const config=getConfig(); if(config.mode!=='api') throw failure(409,'中央 API 模型不可用。');
    const controller=new AbortController(), signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);run.relays.add(controller);
    const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnected);
    let idle=setTimeout(()=>controller.abort(),30000), output=0, safeOutput=0;
    const reset=()=>{clearTimeout(idle);idle=setTimeout(()=>controller.abort(),30000);};
    const redactor=createExecutorRelayRedactor({secret:config.apiKey,model:run.entry.model});
    const write=async frame=>{
      checkRun(run);signal.throwIfAborted();safeOutput+=Buffer.byteLength(frame);if(safeOutput>24*1024*1024)throw failure(502,'模型响应超过限制。');
      if(!res.write(frame))await new Promise((resolve,reject)=>{const cleanup=()=>{res.off('drain',ready);signal.removeEventListener('abort',cancel);};const ready=()=>{cleanup();resolve();};const cancel=()=>{cleanup();reject(new Error('模型请求停止。'));};res.once('drain',ready);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
    };
    try {
      const response=await fetchImpl(`${config.baseUrl.replace(/\/$/,'')}/responses`,{method:'POST',redirect:'manual',credentials:'omit',signal,headers:{'Content-Type':'application/json',Accept:'text/event-stream','Accept-Encoding':'identity',...(config.apiKey?{Authorization:`Bearer ${config.apiKey}`}:{})},body:JSON.stringify(body)});
      checkRun(run);reset();
      if(response.status!==200||response.redirected||!response.body||!/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw failure(502,'中央模型服务没有返回有效流。');}
      res.status(200).set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
      for await(const chunk of response.body){checkRun(run);signal.throwIfAborted();reset();output+=chunk.length;if(output>24*1024*1024)throw failure(502,'模型响应超过限制。');for(const frame of redactor.push(chunk))await write(frame);}
      for(const frame of redactor.finish())await write(frame);
      checkRun(run);res.end();
    }catch{if(!res.headersSent)res.status(502).json({error:'中央模型请求未完成。'});else res.destroy();}
    finally{clearTimeout(idle);controller.abort();res.off('close',disconnected);run.relays.delete(controller);}
  }
  const revoke = predicate => { for (const connection of [...connections.values()]) if (predicate(connection.auth)) offline(connection); };
  const close = async () => { closed=true;clearInterval(timer);for(const connection of [...connections.values()])offline(connection);await registration.catch(()=>{}); };
  return { register,heartbeat,poll,disconnect,events,list,target,bind,attachment,relay,revoke,close,hostFor };
}
