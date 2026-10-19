import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const CLOUD_DOCKER_IMAGE = 'petpal-cloud-agent:0.9.13-codex0.143.0';
export const CLOUD_DOCKER_ASSET_REVISION = '20261020.5';
const failure = (message, code = 'cloud_docker_unavailable') => Object.assign(new Error(message), { status: 409, code });
export function validateLocalTransport(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['wslDistro', 'dockerHost', 'nodeImage', 'debianMirror', 'debianSecurityMirror'].includes(k))) throw failure('Docker 连接配置无效。');
  if (value.wslDistro !== undefined && (typeof value.wslDistro !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value.wslDistro))) throw failure('WSL 发行版配置无效。');
  if (value.dockerHost !== undefined && (typeof value.dockerHost !== 'string' || !/^unix:\/\/[A-Za-z0-9_./-]{1,150}$/.test(value.dockerHost) || value.dockerHost.includes('..'))) throw failure('只支持受信的本机 Docker Unix socket。');
  if(value.nodeImage!==undefined&&(typeof value.nodeImage!=='string'||! /^(?:[A-Za-z0-9.-]+(?::[0-9]+)?\/)?(?:library\/)?node:24\.19\.0-bookworm-slim(?:@sha256:[a-f0-9]{64})?$/.test(value.nodeImage)))throw failure('Node 构建镜像必须保持固定版本。');
  for(const key of ['debianMirror','debianSecurityMirror'])if(value[key]!==undefined&&(typeof value[key]!=='string'||!/^https:\/\/[A-Za-z0-9.-]+\/(?:[A-Za-z0-9_-]+\/)*(?:debian|debian-security)\/?$/.test(value[key])))throw failure('Debian 构建镜像源必须是无凭据、无查询的 HTTPS Debian 源。');
  return { ...value };
}
export function createLocalDocker({ transport = {}, spawnImpl = spawn, image = CLOUD_DOCKER_IMAGE, contextRoot = tmpdir() } = {}) {
  transport = validateLocalTransport(transport);
  if (!/^petpal-cloud-agent:[A-Za-z0-9_.-]+$/.test(image)) throw failure('Docker 镜像配置无效。');
  const command = transport.wslDistro ? { file: 'wsl.exe', args: ['-d', transport.wslDistro, '-u', 'root', '--exec', 'docker'] } : { file: 'docker', args: [] };
  if (transport.dockerHost) command.args.push('-H', transport.dockerHost);
  function launch(args, options = {}) { return spawnImpl(command.file, [...command.args, ...args], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], ...options }); }
  async function run(args, { input, timeout = 30000, max = 2 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
      const child = launch(args), chunks = []; let bytes = 0, done = false;
      const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => { child.kill(); finish(failure('Docker 操作超时；请刷新确认实际状态，不要重复创建。', 'cloud_docker_delivery_uncertain')); }, timeout);
      child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > max) { child.kill(); finish(failure('Docker 返回数据过大。')); } else chunks.push(chunk); });
      child.stderr.on('data', () => {}); child.stdin.on('error', () => {});
      child.once('error', () => finish(failure('未连接到本机 Docker 引擎，请检查 Docker/WSL 设置。')));
      child.once('close', code => finish(code === 0 ? null : failure('Docker 操作未完成，请检查引擎、镜像与容器状态。'), Buffer.concat(chunks).toString('utf8').trim()));
      child.stdin.end(input);
    });
  }
  const json = async args => { try { return JSON.parse(await run(args)); } catch (error) { if (error.status) throw error; throw failure('Docker 返回了无效的状态数据。'); } };
  return {
    image, run, launch, transport,
    async status() { try { const engine = await json(['version', '--format', '{{json .Server}}']); if (engine.Os !== 'linux') throw failure('需要 Linux 容器引擎。'); let present = false; try { const result = await json(['image', 'inspect', image]); present = result[0]?.Config?.Labels?.['top.magicdatou.petpal.agent-protocol'] === '1' && result[0]?.Config?.Labels?.['top.magicdatou.petpal.asset-revision'] === CLOUD_DOCKER_ASSET_REVISION; } catch {} return { available: true, imageAvailable: present, arch: engine.Arch, version: engine.Version }; } catch { return { available: false, imageAvailable: false, message: '本机 Docker 未就绪，请先在服务器配置 Docker 或已运行的 WSL 引擎。' }; } },
    async prepare() {
      const names=['Dockerfile','start.sh','exec.mjs','browser.sh','browser.desktop','README.md'];
      const provenance=JSON.parse(await readFile(new URL('./docker-assets/PROVENANCE.json',import.meta.url),'utf8'));
      if(provenance.schema!=='petpal-cloud-docker-assets.v1'||provenance.assetRevision!==CLOUD_DOCKER_ASSET_REVISION)throw failure('Docker 镜像来源清单无效。');
      const context=await mkdtemp(path.join(contextRoot,'image-'));
      if((await lstat(context)).isSymbolicLink()||(await realpath(context)).toLowerCase()!==context.toLowerCase())throw failure('Docker 构建目录不安全。');
      for(const name of names){const bytes=await readFile(new URL(`./docker-assets/${name}`,import.meta.url));if(createHash('sha256').update(bytes).digest('hex')!==provenance.files[name])throw failure('Docker 镜像资产校验失败，请重新安装完整服务包。');await writeFile(path.join(context,name),bytes,{flag:'wx',mode:0o600});}
      await writeFile(path.join(context,'.dockerignore'),'**\n!Dockerfile\n!start.sh\n!exec.mjs\n!browser.sh\n!browser.desktop\n',{flag:'wx',mode:0o600});
      const inputPath = transport.wslDistro ? '/mnt/' + context[0].toLowerCase() + context.slice(2).replaceAll('\\', '/') : context;
      if (transport.wslDistro && !/^[A-Za-z]:[\\/]/.test(context)) throw failure('WSL 构建目录不可用。');
      const buildArgs=[];for(const [key,name]of [['nodeImage','NODE_IMAGE'],['debianMirror','DEBIAN_MIRROR'],['debianSecurityMirror','DEBIAN_SECURITY_MIRROR']])if(transport[key])buildArgs.push('--build-arg',`${name}=${transport[key]}`);
      await run(['build', '--pull=false', ...buildArgs, '--tag', image, inputPath], { timeout: 20 * 60 * 1000, max: 1024 * 1024 });
      return this.status();
    },
    async inspect(record, instanceId) {
      const result = (await json(['inspect', '--type', 'container', record.containerName]))[0];
      const labels = result?.Config?.Labels;
      if (!result?.Id || labels?.['top.magicdatou.petpal.instance'] !== instanceId || labels?.['top.magicdatou.petpal.host'] !== record.id || labels?.['top.magicdatou.petpal.owner'] !== record.userId || result.HostConfig?.Privileged || result.HostConfig?.NetworkMode === 'host') throw failure('容器身份或隔离配置已变化，已拒绝访问。', 'cloud_docker_identity_changed');
      const mounts=result.Mounts??[], expected=new Set([`${record.containerName}-runtime`,`${record.containerName}-workspace`]);
      if(result.Config.User!=='10001:10001'||result.HostConfig.NetworkMode!=='bridge'||!result.HostConfig.CapDrop?.includes('ALL')||!result.HostConfig.SecurityOpt?.includes('no-new-privileges')||Object.keys(result.HostConfig.PortBindings??{}).length||mounts.length!==2||mounts.some(m=>m.Type!=='volume'||!expected.has(m.Name)||!['/runtime','/workspaces/project'].includes(m.Destination)))throw failure('容器的宿主挂载或权限已变化。','cloud_docker_identity_changed');
      return { id: result.Id, state: result.State?.Running ? 'running' : 'stopped', generation: `${result.Id}:${result.State?.StartedAt ?? ''}`, desktop: labels?.['top.magicdatou.petpal.desktop-protocol'] === '1', arch: result.Platform?.includes('arm') ? 'arm64' : 'x64' };
    },
    async create(record, instanceId) {
      const args = ['create', '--name', record.containerName, '--init', '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '512', '--memory', '2g', '--cpus', '2', '--shm-size', '256m', '--network', 'bridge', '--add-host', 'host.docker.internal:host-gateway', '--label', `top.magicdatou.petpal.instance=${instanceId}`, '--label', `top.magicdatou.petpal.host=${record.id}`, '--label', `top.magicdatou.petpal.owner=${record.userId}`, '--mount', `type=volume,source=${record.containerName}-runtime,target=/runtime`, '--mount', `type=volume,source=${record.containerName}-workspace,target=/workspaces/project`, image];
      await run(args); await run(['start', record.containerName]); return this.inspect(record, instanceId);
    },
    async action(record, instanceId, action) { await this.inspect(record, instanceId); await run([action, ...(action === 'stop' ? ['--time', '10'] : []), record.containerName]); return this.inspect(record, instanceId); },
    async stage(record, instanceId, home, files) {
      await this.inspect(record, instanceId);
      const script = 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{const f=require("fs"),x=JSON.parse(s);f.mkdirSync(x.home,{recursive:true,mode:448});for(const [n,v]of Object.entries(x.files)){const p=x.home+"/"+n;if(f.existsSync(p)&&(!f.lstatSync(p).isFile()||f.lstatSync(p).nlink!==1))throw Error("unsafe");f.writeFileSync(p,v,{mode:384});}});';
      await run(['exec', '-i', '--user', '10001:10001', record.containerName, 'node', '-e', script], { input: JSON.stringify({ home, files }) });
    },
    async process(record, instanceId, { args, home, token }) {
      await this.inspect(record, instanceId);
      const launchId = randomUUID();
      const child = launch(['exec', '-i', '--user', '10001:10001', '-e', `CODEX_HOME=${home}`, '-e', `CODEX_REMOTE_MODEL_PROVIDER_KEY=${token}`, record.containerName, 'node', '/opt/petpal/exec.mjs', launchId, ...args]);
      const ended = new Promise(resolve => child.once('close', resolve));
      child.cloudStop = async () => {
        child.stdin.end();
        const timer = setTimeout(() => { void run(['exec', '--user', '10001:10001', record.containerName, 'node', '-e', 'const f=require("fs");try{const n=Number(f.readFileSync(process.argv[1],"utf8"));if(Number.isSafeInteger(n)&&n>1)process.kill(-n,"SIGKILL");}catch{}', `/runtime/petpal-launch-${launchId}.pid`]).catch(() => {}); }, 3000);
        try { await Promise.race([ended, new Promise((_, reject) => setTimeout(() => reject(failure('容器任务停止状态未知。', 'execution_unknown')), 10000).unref())]); }
        finally { clearTimeout(timer); }
      };
      return child;
    },
    async desktop(record, instanceId) {
      const observed = await this.inspect(record, instanceId); if (observed.state !== 'running' || !observed.desktop) throw failure('图形桌面尚未就绪。');
      const child = launch(['exec', '-i', '--user', '10001:10001', record.containerName, 'node', '-e', 'const n=require("net");const s=n.connect(5900,"127.0.0.1");process.stdin.pipe(s);s.pipe(process.stdout);s.on("error",()=>process.exit(1));process.stdin.on("end",()=>s.end());']);
      child.stderr.on('data', () => {}); child.on('error', () => {});
      return { readable: child.stdout, writable: child.stdin, generation: observed.generation, close: () => { child.stdin.end(); child.kill(); }, child };
    },
  };
}
