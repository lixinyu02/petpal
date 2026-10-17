import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, writeFile, mkdir, cp, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createMemobaseRuntime, memobaseWslPath } from '../server/memobase-runtime.mjs';

const model = { baseUrl: 'https://model.example/v1', apiKey: 'private-model-key', model: 'test-model' };
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-memory-runtime-'));
  const calls = [], docker = { running: false, missing: false, daemon: true, images: true, pulled: new Set(), wrongDigest: false, hang: false, upFailed: false, owned: true };
  const spawnImpl = (file, args, spawnOptions) => {
    assert.equal(file, 'docker'); assert.equal(spawnOptions.shell, false); assert.equal(spawnOptions.windowsHide, true);
    assert.deepEqual(spawnOptions.stdio, ['ignore', 'pipe', 'pipe']);
    calls.push(args); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('close', 137)); return true; };
    setImmediate(() => {
      if (docker.hang && args[0] === 'pull') return;
      if (docker.missing) { child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })); return; }
      if (!docker.daemon) { child.stderr.write('Cannot connect to the Docker daemon'); child.emit('close', 1); return; }
      let output = '', code = 0;
      if (args[0] === 'version') output = '"linux"';
      else if (args[0] === 'compose' && args[1] === 'version') output = '2.22.0-desktop.2';
      else if (args[0] === 'image') { if (docker.images || docker.pulled.has(args.at(-1))) output = JSON.stringify([docker.wrongDigest ? `test@sha256:${'0'.repeat(64)}` : args.at(-1)]); else code = 1; }
      else if (args[0] === 'inspect') { const start = calls.find(args => args.includes('--project-name')); const project = start[start.indexOf('--project-name') + 1]; output = JSON.stringify({ labels: { 'com.docker.compose.project': docker.owned ? project : 'foreign-project', 'com.docker.compose.service': 'api' }, running: docker.running, ports: { '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: '8019' }] } }); }
      else if (args.includes('ps')) output = docker.running ? 'a'.repeat(64) : '';
      else if (args.includes('up')) { if (docker.upFailed) code = 1; else docker.running = true; }
      else if (args.includes('stop')) docker.running = false;
      else if (args[0] === 'pull') docker.pulled.add(args.at(-1));
      if (output) child.stdout.write(output); child.emit('close', code);
    });
    return child;
  };
  const manager = await createMemobaseRuntime({ directory, spawnImpl, imageMirror: '', networkSubnet: '', fetchImpl: async () => Response.json({ errno: 0 }), canBindPort: async () => true, ...options });
  t.after(() => manager.close().catch(() => {}));
  return { directory, manager, calls, docker, spawnImpl };
}

test('creating an optional runtime performs no Docker or network work and missing model stays recoverable', async t => {
  const { manager, calls } = await fixture(t);
  assert.equal(calls.length, 0); assert.equal(manager.status().autoStart, true); assert.equal(manager.status().needsModel, true);
  await assert.rejects(manager.start(), error => error.code === 'PETPAL_MEMOBASE_MODEL');
  assert.equal(calls.length, 0); assert.equal(await manager.connection(), null);
});

test('pinned native images and private compose publish only loopback API and disable telemetry/credential logs', async t => {
  const { manager, calls, directory, docker } = await fixture(t);
  docker.images = false;
  await manager.configureModel({ ...model, baseUrl: 'http://127.0.0.1:8082/v1' });
  assert.equal(calls.length, 0);
  await manager.prepare();
  const document = JSON.parse(await readFile(path.join(directory, 'compose.json')));
  const config = JSON.parse(await readFile(path.join(directory, 'config.yaml')));
  assert.equal(Object.keys(document.services).length, 3);
  for (const service of Object.values(document.services)) { assert.match(service.image, /@sha256:[a-f0-9]{64}$/); assert.equal(service.platform, undefined); assert.equal(service.restart, 'no'); }
  assert.equal(document.services.db.ports, undefined); assert.equal(document.services.redis.ports, undefined);
  assert.equal(document.networks, undefined, 'No explicit subnet leaves Docker network policy untouched');
  assert.deepEqual(document.services.api.ports, [{ target: 8000, published: '8019', host_ip: '127.0.0.1', protocol: 'tcp' }]);
  assert.equal(document.services.api.environment.OTEL_SDK_DISABLED, 'true');
  assert.equal(config.persistent_chat_blobs, true); assert.equal(config.enable_event_embedding, false); assert.equal(config.language, 'zh'); assert.equal(config.use_timezone, 'Asia/Shanghai');
  assert.equal(config.llm_base_url, 'http://host.docker.internal:8082/v1');
  assert.deepEqual([config.best_llm_model, config.thinking_llm_model, config.summary_llm_model], Array(3).fill(model.model));
  assert.equal(JSON.stringify(manager.status()).includes(model.apiKey), false);
  assert.equal(JSON.stringify(document).includes(model.apiKey), false);
  assert.equal(calls.filter(args => args[0] === 'pull').length, 3);
  assert.equal(calls.some(args => args.includes('up')), false);
  const patches = document.services.api.volumes;
  assert.ok(patches.some(item => item.target === '/app/memobase_server/env.py' && item.read_only));
  assert.ok(patches.some(item => item.target.endsWith('/telemetry/open_telemetry.py') && item.read_only));
});

test('start uses owned containers and verified image digests; stop/close preserve remembered volumes', async t => {
  const { manager, calls, directory, docker } = await fixture(t);
  await manager.configureModel(model); await manager.start();
  assert.equal(manager.status().running, true); assert.equal(docker.running, true);
  assert.match((await manager.connection()).apiKey, /^[a-f0-9]{64}$/);
  assert.equal(calls.filter(args => args[0] === 'pull').length, 0, 'Verified installed images do not require a network pull on each client launch');
  const secrets = await readFile(path.join(directory, 'secrets.json'), 'utf8');
  await manager.stop(); assert.equal(manager.status().running, false); assert.equal(docker.running, false);
  assert.equal(await readFile(path.join(directory, 'secrets.json'), 'utf8'), secrets);
  await manager.close(); await assert.rejects(manager.start(), error => error.code === 'PETPAL_MEMOBASE_CLOSED');
  for (const command of calls) assert.equal(command.includes('down') || command.includes('--volumes') || command.includes('-v'), false);
});

test('missing Docker and stopped daemon are distinct public errors and can be retried', async t => {
  const { manager, docker } = await fixture(t); await manager.configureModel(model);
  docker.missing = true; await assert.rejects(manager.prepare(), error => error.code === 'PETPAL_MEMOBASE_DOCKER_MISSING');
  assert.equal(manager.status().dockerAvailable, false);
  docker.missing = false; docker.daemon = false; await assert.rejects(manager.prepare(), error => error.code === 'PETPAL_MEMOBASE_DAEMON');
  assert.equal(manager.status().dockerAvailable, true); assert.equal(manager.status().daemonAvailable, false);
  docker.daemon = true; await manager.prepare(); assert.equal(manager.status().prepared, true);
});

test('occupied API port is not probed or adopted and no foreign process is controlled', async t => {
  let healthCalls = 0;
  const { manager, calls } = await fixture(t, { canBindPort: async () => false, fetchImpl: async () => { healthCalls++; return Response.json({ errno: 0 }); } });
  await manager.configureModel(model); await assert.rejects(manager.start(), error => error.code === 'PETPAL_MEMOBASE_PORT');
  assert.equal(healthCalls, 0); assert.equal(calls.some(args => args.includes('up')), false); assert.equal(await manager.connection(), null);
});

test('Windows/Linux ARM64 use the multiarch image without forced amd64 and preferences survive restart', async t => {
  for (const platform of ['win32', 'linux']) {
    const { manager, directory } = await fixture(t, { platform, arch: 'arm64' });
    assert.equal(manager.status().supported, true); await manager.preferences({ autoStart: false }); await manager.configureModel(model);
    const restored = await createMemobaseRuntime({ directory, platform, arch: 'arm64' });
    assert.equal(restored.status().autoStart, false); assert.equal(restored.status().configured, true); assert.equal(restored.status().needsModel, false);
  }
  const { manager } = await fixture(t, { platform: 'darwin', arch: 'arm64' });
  assert.equal(manager.status().supported, false); await assert.rejects(manager.prepare(), /暂不支持/);
});

test('local runtime stops on cancellation and revocation after up, keeping credentials out of errors', async t => {
  const { manager, docker } = await fixture(t); await manager.configureModel(model);
  let guards = 0;
  await assert.rejects(manager.start({ authorize: async () => { guards++; if (docker.running) throw new Error('revoked-private-token'); } }), error => !error.message.includes('revoked-private-token'));
  assert.ok(guards > 1); assert.equal(docker.running, false); assert.equal(await manager.connection(), null);
});

test('tampered runtime assets and symlinked private files fail closed without overwriting originals', async t => {
  const assets = await mkdtemp(path.join(os.tmpdir(), 'petpal-memory-assets-'));
  await cp(new URL('../server/memobase-assets/', import.meta.url), assets, { recursive: true });
  await writeFile(path.join(assets, 'env.py'), 'tampered');
  const { manager, calls } = await fixture(t, { assetDirectory: assets });
  await assert.rejects(manager.prepare(), error => error.code === 'PETPAL_MEMOBASE_ASSETS'); assert.equal(calls.length, 0);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-memory-private-'));
  await mkdir(path.join(directory, 'settings.json'));
  const invalid = await createMemobaseRuntime({ directory });
  assert.equal(invalid.status().state, 'error'); await assert.rejects(invalid.preferences({ autoStart: false }), /安全读取或保存/);
});

test('trusted Windows WSL transport uses fixed arguments and translated host paths without a shell', async t => {
  assert.equal(memobaseWslPath('E:\\My Project\\memory'), '/mnt/e/My Project/memory');
  assert.throws(() => memobaseWslPath('\\\\server\\share\\memory'), /安全读取或保存/);
  assert.throws(() => memobaseWslPath('/tmp/memory'), /安全读取或保存/);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-memory-wsl-'));
  await assert.rejects(createMemobaseRuntime({ directory, platform: 'win32', wslDistro: 'Ubuntu;echo secret' }), /安全读取或保存/);
  await assert.rejects(createMemobaseRuntime({ directory, platform: 'linux', wslDistro: 'Ubuntu' }), /安全读取或保存/);
  // Actual Windows host paths are required for the WSL mount transport.
  if (process.platform !== 'win32') return;
  const calls = [];
  const manager = await createMemobaseRuntime({ directory, platform: 'win32', wslDistro: 'QwenMM-Ubuntu-24.04', spawnImpl: (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    setImmediate(() => { if (args.includes('version') && args.includes('--short')) child.stdout.write('2.22.0'); else if (args.includes('version')) child.stdout.write('"linux"'); else if (args.includes('inspect')) child.stdout.write(JSON.stringify([args.at(-1)])); child.emit('close', 0); }); return child;
  } });
  await manager.configureModel(model); await manager.prepare();
  for (const call of calls) {
    assert.equal(call.file, 'wsl.exe'); assert.deepEqual(call.args.slice(0, 6), ['-d', 'QwenMM-Ubuntu-24.04', '--cd', memobaseWslPath(directory), '--exec', 'docker']);
    assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true);
  }
  const compose = JSON.parse(await readFile(path.join(directory, 'compose.json')));
  for (const mount of compose.services.api.volumes) assert.ok(mount.source.startsWith('/mnt/'));
  assert.equal(compose.services.api.volumes.some(value => value.source.includes('.asar')), false);
});

test('trusted Docker mirror resolves Hub images with the identical official digest and leaves GHCR unchanged', async t => {
  const { manager, directory, calls, docker } = await fixture(t, { imageMirror: 'docker.1ms.run' });
  const provenance = JSON.parse(await readFile(new URL('../server/memobase-assets/PROVENANCE.json', import.meta.url)));
  docker.images = false; docker.pulled.add(provenance.images.api);
  await manager.prepare();
  const pulled = calls.filter(args => args[0] === 'pull').map(args => args[1]);
  assert.deepEqual(pulled, [
    `docker.1ms.run/${provenance.images.db}`,
    `docker.1ms.run/library/${provenance.images.redis}`,
  ]);
  for (const reference of pulled) assert.ok(reference.endsWith(provenance.images[reference.includes('/library/') ? 'redis' : 'db'].split('@')[1]));
  const compose = JSON.parse(await readFile(path.join(directory, 'compose.json')));
  assert.equal(compose.services.api.image, provenance.images.api);
  assert.equal(compose.services.db.image, pulled[0]); assert.equal(compose.services.redis.image, pulled[1]);
  await manager.configureModel(model); await manager.start();
  assert.equal(calls.filter(args => args[0] === 'pull').length, 2, 'Prepared mirror references are reused without blind canonical network pulls');
});

test('a configured mirror is not used when canonical images are ready and mismatched digests never become prepared', async t => {
  const ready = await fixture(t, { imageMirror: 'docker.1ms.run' }); await ready.manager.prepare();
  assert.equal(ready.calls.filter(args => args[0] === 'pull').length, 0);
  const document = JSON.parse(await readFile(path.join(ready.directory, 'compose.json')));
  assert.equal(document.services.db.image.startsWith('docker.1ms.run/'), false);
  const invalid = await fixture(t, { imageMirror: 'docker.1ms.run' }); invalid.docker.wrongDigest = true;
  await assert.rejects(invalid.manager.prepare(), error => error.code === 'PETPAL_MEMOBASE_PREPARE');
  assert.equal(invalid.manager.status().prepared, false);
});

test('mirror configuration rejects schemes, paths, credentials, controls and shell syntax', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-memory-mirror-'));
  for (const imageMirror of ['https://docker.example', 'docker.example/path', 'user:secret@docker.example', 'docker.example; whoami', 'docker.example\n', 'docker.example:65536', '-host.example', 'host_example', true, { host: 'docker.example' }]) {
    await assert.rejects(createMemobaseRuntime({ directory, imageMirror }), /安全读取或保存/);
  }
});

test('trusted transport persists and cold construction restores it without spawning Docker or making network calls', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-memory-transport-'));
  const names = ['PETPAL_MEMOBASE_WSL_DISTRO', 'PETPAL_MEMOBASE_DOCKER_MIRROR', 'PETPAL_MEMOBASE_SUBNET'];
  const previous = names.map(name => process.env[name]); let calls = 0;
  const options = { directory, platform: process.platform === 'win32' ? 'win32' : 'linux', spawnImpl: () => { calls++; throw new Error('no cold spawn'); }, fetchImpl: async () => { calls++; throw new Error('no cold network'); } };
  try {
    for (const name of names) delete process.env[name];
    const expected = { version: 1, wslDistro: process.platform === 'win32' ? 'QwenMM-Ubuntu-24.04' : '', imageMirror: 'docker.1ms.run' };
    await createMemobaseRuntime({ ...options, wslDistro: expected.wslDistro, imageMirror: expected.imageMirror });
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'transport.json'))), expected);
    const restored = await createMemobaseRuntime(options);
    assert.equal(restored.status().state, 'stopped'); assert.equal(calls, 0);
    process.env.PETPAL_MEMOBASE_DOCKER_MIRROR = 'env.registry.example';
    process.env.PETPAL_MEMOBASE_SUBNET = '10.253.204.0/24';
    await createMemobaseRuntime(options);
    assert.equal(JSON.parse(await readFile(path.join(directory, 'transport.json'))).imageMirror, 'env.registry.example');
    assert.equal(JSON.parse(await readFile(path.join(directory, 'transport.json'))).networkSubnet, '10.253.204.0/24');
    await createMemobaseRuntime({ ...options, wslDistro: '', imageMirror: '', networkSubnet: '' });
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'transport.json'))), { version: 1, wslDistro: '', imageMirror: '' });
    assert.equal(calls, 0);
  } finally { for (let i = 0; i < names.length; i++) { if (previous[i] === undefined) delete process.env[names[i]]; else process.env[names[i]] = previous[i]; } }
});

test('malicious or structurally invalid persisted transport fails closed and preserves the file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-memory-transport-invalid-'));
  let commands = 0;
  for (const value of [
    { version: 1, wslDistro: 'Ubuntu;whoami', imageMirror: '' },
    { version: 1, wslDistro: '', imageMirror: 'https://registry.example/path' },
    { version: 2, wslDistro: '', imageMirror: '' },
    { version: 1, wslDistro: '', imageMirror: '', command: 'arbitrary' },
    { version: 1, wslDistro: '', imageMirror: '', networkSubnet: '10.0.0.0/8' },
  ]) {
    const original = JSON.stringify(value); await writeFile(path.join(directory, 'transport.json'), original);
    const runtime = await createMemobaseRuntime({ directory, wslDistro: '', imageMirror: '', spawnImpl: () => { commands++; throw new Error(); } });
    assert.equal(runtime.status().state, 'error');
    await assert.rejects(runtime.prepare(), error => error.code === 'PETPAL_MEMOBASE_STORAGE');
    assert.equal(await readFile(path.join(directory, 'transport.json'), 'utf8'), original);
  }
  assert.equal(commands, 0);
});

test('only explicit private IPv4 /24 network ranges are accepted and restored without changing daemon pools', async t => {
  for (const networkSubnet of ['10.253.204.0/24', '172.16.21.0/24', '172.31.255.0/24', '192.168.250.0/24']) {
    const { manager, directory, calls } = await fixture(t, { networkSubnet });
    await manager.prepare();
    const compose = JSON.parse(await readFile(path.join(directory, 'compose.json')));
    assert.deepEqual(compose.networks, { default: { ipam: { config: [{ subnet: networkSubnet }] } } });
    assert.equal(JSON.parse(await readFile(path.join(directory, 'transport.json'))).networkSubnet, networkSubnet);
    const restored = await createMemobaseRuntime({ directory, spawnImpl: () => { throw new Error('Cold construction must not spawn'); } });
    assert.equal(restored.status().state, 'stopped');
    for (const command of calls) assert.equal(command.includes('network') || command.includes('prune') || command.includes('daemon'), false);
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-memory-subnet-invalid-'));
  for (const networkSubnet of ['10.0.0.0/8', '172.16.0.0/16', '0.0.0.0/0', '8.8.8.0/24', '172.15.8.0/24', '172.32.8.0/24', '192.169.1.0/24', '10.253.204.1/24', '10.256.1.0/24', '010.1.2.0/24', '10.2.3.0/24;whoami', '10.2.3.0/24\n', true, null, { subnet: '10.2.3.0/24' }]) {
    await assert.rejects(createMemobaseRuntime({ directory, networkSubnet }), /安全读取或保存/);
  }
});

test('a fresh headless Node process stays alive across bounded health retries until startup completes', async () => {
  const source = `
    import { EventEmitter } from 'node:events';
    import { PassThrough } from 'node:stream';
    import { mkdtemp } from 'node:fs/promises';
    import os from 'node:os';
    import path from 'node:path';
    import { createMemobaseRuntime } from ${JSON.stringify(new URL('../server/memobase-runtime.mjs', import.meta.url).href)};
    const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-memory-headless-'));
    let running = false, project = '', healthCalls = 0;
    const runtime = await createMemobaseRuntime({ directory, wslDistro: '', imageMirror: '', networkSubnet: '',
      canBindPort: async () => true,
      fetchImpl: async () => Response.json({ errno: ++healthCalls === 1 ? 1 : 0 }),
      spawnImpl: (_file, args) => {
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
        setImmediate(() => {
          let value = '';
          if (args[0] === 'version') value = '"linux"';
          else if (args[0] === 'compose' && args[1] === 'version') value = '2.39.4';
          else if (args[0] === 'image') value = JSON.stringify([args.at(-1)]);
          else if (args.includes('ps')) { project = args[args.indexOf('--project-name') + 1]; value = running ? 'a'.repeat(64) : ''; }
          else if (args[0] === 'inspect') value = JSON.stringify({ labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': 'api' }, running, ports: { '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: '8019' }] } });
          else if (args.includes('up')) running = true;
          else if (args.includes('stop')) running = false;
          if (value) child.stdout.write(value); child.emit('close', 0);
        }); return child;
      },
    });
    await runtime.configureModel({ baseUrl: 'https://model.example/v1', apiKey: 'fixture-private', model: 'fixture' });
    const status = await runtime.start();
    console.log(JSON.stringify({ success: status.running, healthCalls }));
    await runtime.close();
  `;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', source], { timeout: 10000, windowsHide: true });
  assert.deepEqual(JSON.parse(result.stdout), { success: true, healthCalls: 2 });
  assert.equal(result.stderr.includes('unsettled top-level await'), false);
});
