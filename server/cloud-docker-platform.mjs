import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { randomUUID, createHash } from 'node:crypto';
import WebSocket from 'ws';
import {platformNode, platformOptions} from './cloud-platform-options.mjs';

const failure = (message, code = 'cloud_docker_platform_unavailable') => Object.assign(new Error(message), { status: 409, code });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function createPlatformDocker(serviceLinks, { socketFactory = (url, options) => new WebSocket(url, options) } = {}) {
  const owner = record => ({ type: 'user', id: record.userId });
  const bundle = record => record.bundle === 'agent' ? 'full' : record.bundle;
  let currentClientId = null;
  async function credential(record) {
    const connection = await serviceLinks.credential('docker-platform');
    currentClientId = connection?.clientId ?? null;
    if (!connection || record && connection.clientId !== record.clientId) throw failure('Docker Platform 连接已变化；旧环境不会改派到新平台。', 'cloud_docker_identity_changed');
    return connection;
  }
  async function call(record, operation, payload = {}, requestId = randomUUID()) {
    await credential(record);
    return serviceLinks.request('docker-platform', `/v1/projects/${record.projectId}/call`, { method: 'POST', expectedClientId: record.clientId, body: { owner: owner(record), operation, payload, requestId } });
  }
  async function stream(record, sessionId) {
    const connection = await credential(record);
    if (!/^[a-f0-9]{32}$/.test(sessionId)) throw failure('平台执行会话无效。');
    const url = new URL(connection.baseUrl); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/exec/${sessionId}`;
    const socket = socketFactory(url.href, { headers: { Authorization: `Bearer ${connection.credential}` }, maxPayload: 262144, followRedirects: false, handshakeTimeout: 10000, perMessageDeflate: false });
    const child = new EventEmitter(), stdout = new PassThrough({ highWaterMark: 65536 }), stderr = new PassThrough({ highWaterMark: 65536 });
    let settled = false, stopping, finished = false; child.killed = false;
    const done = new Promise(resolve => child.once('close', resolve));
    const finish = code => { if (finished) return; finished = true; stdout.end(); stderr.end(); child.stdin.destroy(); child.emit('exit', code); child.emit('close', code); };
    child.stdout = stdout; child.stderr = stderr;
    child.stdin = new Writable({ highWaterMark: 65536, write(chunk, _encoding, callback) {
      if (settled || socket.readyState !== 1 || socket.bufferedAmount > 262144) return callback(failure('平台输入已断开。', 'execution_unknown'));
      let offset = 0;
      const send = () => { if (offset >= chunk.length) return callback(); const part = chunk.subarray(offset, offset + 65536); offset += part.length; socket.send(Buffer.concat([Buffer.from('i'), part]), { binary: true }, error => error ? callback(failure('平台输入未确认。', 'execution_unknown')) : send()); }; send();
    } });
    stdout.on('drain', () => socket.resume?.()); stderr.on('drain', () => socket.resume?.());
    socket.on('message', (data, binary) => {
      try {
        if (binary) {
          if (data.length > 65537 || ![111, 101].includes(data[0])) throw failure('平台输出格式无效。');
          if (!(data[0] === 111 ? stdout : stderr).write(data.subarray(1))) socket.pause?.();
        } else {
          const event = JSON.parse(data.toString());
          if (event.type === 'exit') {
            settled = true; child.cleanupConfirmed = event.cleanupConfirmed === true; socket.close(); finish(child.cleanupConfirmed && Number.isInteger(event.exitCode) ? event.exitCode : 1);
          } else if (event.type !== 'started') throw failure('平台控制帧无效。');
        }
      } catch { child.emit('error', failure('平台执行连接格式错误。', 'execution_unknown')); socket.terminate(); }
    });
    socket.on('close', () => { if (!settled) { child.cleanupConfirmed = false; finish(1); } });
    socket.on('error', () => { child.cleanupConfirmed = false; child.emit('error', failure('平台执行连接中断。', 'execution_unknown')); finish(1); });
    child.cloudStop = () => stopping ??= (async () => {
      child.killed = true;
      try { const reply = await call(record, 'exec.stop', { sessionId }); child.cleanupConfirmed = reply.cleanupConfirmed === true || reply.stopped === true; }
      finally { settled = true; socket.close(); finish(child.cleanupConfirmed ? 0 : 1); }
      if (!child.cleanupConfirmed) throw failure('平台尚未确认任务已停止。', 'execution_unknown');
      await done;
    })();
    child.kill = () => { void child.cloudStop().catch(() => {}); return true; };
    // During the handshake no consumer can yet attach its error handler.
    const suppress = () => {}; child.on('error', suppress);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', () => reject(failure('平台执行连接失败。', 'execution_unknown'))); socket.once('close', () => reject(failure('平台执行连接在握手中断开。', 'execution_unknown'))); });
    return child;
  }
  return {
    credential, call, identity(record) { if (currentClientId && currentClientId !== record.clientId) throw failure('Docker Platform 连接已变化。', 'cloud_docker_identity_changed'); },
    async prepare(record, resources) {
      await credential(record);
      if (!record.nodeId) return {runtimeKind:'docker',resources:platformOptions({available:true,runtimeKind:'docker'},record,resources).resources};
      const result = await serviceLinks.request('docker-platform','/v1/hosts',{expectedClientId:record.clientId});
      const host = result.hosts?.find(h => h.id === record.nodeId);
      if (!host) throw failure('执行节点不存在或当前配对无权使用。','cloud_platform_node_unavailable');
      return platformOptions(platformNode(host),record,resources);
    },
    async catalog() {
      try { const connection=await credential(); const result = await serviceLinks.request('docker-platform', '/v1/hosts',{expectedClientId:connection.clientId}); if(!Array.isArray(result.hosts)||result.hosts.length>1024)throw failure('平台节点目录无效。'); return { available: true, nodes: result.hosts.filter(h => h && UUID.test(h.id)).map(platformNode) }; } catch(error) { return { available: false, nodes: [], message: error.code==='cloud_platform_metadata_invalid'?'平台节点能力声明无效，请联系平台管理员。':'请先在服务互联中配对 Docker Platform，或检查平台连接。' }; }
    },
    async create(record) {
      await credential(record);
      if(record.runtimeKind){const current=await this.prepare(record,record.resources);if(current.runtimeKind!==record.runtimeKind||JSON.stringify(current.resources)!==JSON.stringify(record.resources))throw failure('节点运行时或固定进程限制已变化，原申请已保留。','cloud_docker_identity_changed');}
      const requestedNodeId = Object.hasOwn(record,'requestedNodeId') ? record.requestedNodeId : record.nodeId;
      const reply = await serviceLinks.request('docker-platform', '/v1/projects', { method: 'POST', expectedClientId: record.clientId, body: { owner: owner(record), hostId: requestedNodeId || null, projectId: record.projectId, name: record.name, bundle: bundle(record), resources: record.resources ?? {}, network: 'public', requestId: record.requestId } });
      if (reply.id !== record.projectId || record.nodeId && reply.hostId !== record.nodeId || !UUID.test(reply.hostId)) throw failure('平台创建回执不匹配，已保留原请求供恢复。', 'cloud_docker_identity_changed');
      return { ...reply, nodeId: reply.hostId };
    },
    async inspect(record) {
      const reply = await call(record, 'project.inspect');
      if (reply.id !== record.projectId || reply.hostId !== record.nodeId || !Number.isSafeInteger(reply.revision) || reply.revision < 1 || reply.bundle && reply.bundle !== bundle(record)) throw failure('平台环境身份或版本已变化。', 'cloud_docker_identity_changed');
      if(record.runtimeKind==='kubernetes'){
        const result=await serviceLinks.request('docker-platform','/v1/hosts',{expectedClientId:record.clientId});
        const host=result.hosts?.find(h=>h.id===record.nodeId), node=host&&platformNode(host);
        if(!node||node.runtimeKind!=='kubernetes'||node.kubernetesConstraints.pidsLimit!==record.resources?.pids||reply.resources?.pids!==record.resources?.pids)throw failure('平台运行时身份或固定进程限制已变化。','cloud_docker_identity_changed');
      }else if(record.runtimeKind==='docker'&&reply.runtimeKind&&reply.runtimeKind!=='docker')throw failure('平台运行时身份已变化。','cloud_docker_identity_changed');
      return { state: reply.phase === 'running' && reply.dockerState !== 'stopped' ? 'running' : 'stopped', generation: JSON.stringify([reply.revision, reply.generation ?? '', reply.containerId ?? '', reply.observation?.startedAt ?? '']), desktop: record.bundle === 'desktop' && String(reply.desktopProtocol ?? '1') === '1', arch: 'x64' };
    },
    async action(record, action) { await this.inspect(record); await call(record, `project.${action}`); return this.inspect(record); },
    async stage(record, home, files) {
      const relative = home.replace(/^\/runtime\//, '');
      for (const [name, contents] of Object.entries(files)) {
        const target = `${relative}/${name}`, bytes = Buffer.from(contents); let parent = '';
        for (const part of relative.split('/')) { parent = parent ? `${parent}/${part}` : part; try { await call(record, 'state.mkdir', { path: parent }); } catch (e) { if (!['file_exists', 'file_already_exists', 'file_path_exists'].includes(e.code)) throw e; } }
        const upload = await call(record, 'state.write', { phase: 'begin', path: target, total: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), overwrite: true });
        if (!/^[a-f0-9-]{32,36}$/.test(upload.uploadId)) throw failure('平台文件回执无效。');
        try { await call(record, 'state.write', { phase: 'chunk', uploadId: upload.uploadId, offset: 0, data: bytes.toString('base64') }); await call(record, 'state.write', { phase: 'commit', uploadId: upload.uploadId }); }
        catch (error) { await call(record, 'state.write', { phase: 'abort', uploadId: upload.uploadId }).catch(() => {}); throw error; }
      }
    },
    async process(record, { args, home, token, cwd = '/workspaces/project' }) {
      await this.inspect(record);
      const opened = await call(record, 'exec.open', { backend: 'openai-codex', arguments: args, environment: { CODEX_HOME: home, CODEX_REMOTE_MODEL_PROVIDER_KEY: token }, cwd });
      try { return await stream(record, opened.sessionId); } catch (error) { await call(record, 'exec.stop', { sessionId: opened.sessionId }).catch(() => {}); throw error; }
    },
    async desktop(record) {
      const observed = await this.inspect(record); if (observed.state !== 'running' || !observed.desktop) throw failure('平台图形桌面尚未就绪。');
      const opened = await call(record, 'exec.open', { backend: 'service-vnc', arguments: [], environment: {}, cwd: '/workspaces/project' });
      let child; try { child = await stream(record, opened.sessionId); } catch (error) { await call(record, 'exec.stop', { sessionId: opened.sessionId }).catch(() => {}); throw error; }
      return { readable: child.stdout, writable: child.stdin, generation: observed.generation, child, close: () => child.cloudStop() };
    },
  };
}
