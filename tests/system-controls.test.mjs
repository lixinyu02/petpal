import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SystemControls, validateSystemAudioCommand, validateSystemSettingsCommand, systemControlEnvironment, parseWpctlEndpoint, parseWpctlVolume, parsePactlVolume, runSystemControlProcess } from '../server/system-controls.mjs';
import { createDesktopTools, desktopToolSpecs } from '../server/desktop-tools.mjs';

test('system audio accepts complete fixed actions and rejects extra fields and implicit toggles', () => {
  for (const value of [{ action: 'status' }, { action: 'set-volume', volumePercent: 0 }, { action: 'set-volume', volumePercent: 100 }, { action: 'adjust-volume', delta: -20 }, { action: 'adjust-volume', delta: 20 }, { action: 'set-muted', muted: false }]) assert.deepEqual(validateSystemAudioCommand(value), value);
  for (const value of [null, [], {}, { action: 'unknown' }, { action: 'status', volumePercent: 30 }, { action: 'status', hostId: 'elsewhere' }, { action: 'set-volume' }, { action: 'set-volume', volumePercent: -1 }, { action: 'set-volume', volumePercent: 101 }, { action: 'set-volume', volumePercent: 12.5 }, { action: 'set-volume', volumePercent: '50' }, { action: 'set-volume', volumePercent: 50, delta: 1 }, { action: 'adjust-volume', delta: 0 }, { action: 'adjust-volume', delta: 21 }, { action: 'adjust-volume', delta: -21 }, { action: 'adjust-volume', delta: 1.5 }, { action: 'set-muted', muted: 'toggle' }, { action: 'set-muted', muted: true, command: 'evil' }]) assert.throws(() => validateSystemAudioCommand(value), { code: 'invalid_arguments' });
});
test('settings allow exactly sound and display, never arbitrary URI or process', () => {
  for (const section of ['sound', 'display']) assert.deepEqual(validateSystemSettingsCommand({ section }), { section });
  for (const args of [null, [], {}, { section: 'privacy' }, { section: 'ms-settings:sound' }, { section: 'sound', uri: 'custom:' }, { section: 'display', command: 'evil' }]) assert.throws(() => validateSystemSettingsCommand(args));
});
test('audio environment retains user audio/desktop context but excludes API and scripting settings', () => {
  const env = systemControlEnvironment({ PATH: '/usr/bin', DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', XDG_RUNTIME_DIR: '/run/user/1000', PULSE_SERVER: 'unix:/run/user/1000/pulse/native', PIPEWIRE_REMOTE: 'pipewire-0', PETPAL_CODEX_API_KEY: 'secret', OPENAI_API_KEY: 'secret', NODE_OPTIONS: '--require evil', PYTHONPATH: 'evil', LANG: 'zh_CN', LC_ALL: 'evil' });
  assert.equal(env.DISPLAY, ':0'); assert.equal(env.PULSE_SERVER, 'unix:/run/user/1000/pulse/native'); assert.equal(env.PIPEWIRE_REMOTE, 'pipewire-0'); assert.equal(env.LC_ALL, 'C'); assert.equal(env.LANG, 'C');
  for (const name of ['PETPAL_CODEX_API_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'PYTHONPATH']) assert.equal(env[name], undefined);
});
test('audio parsers reject malformed or ambiguous values instead of inferring success', () => {
  assert.equal(parseWpctlEndpoint('id 42, type PipeWire:Interface:Node\n node.name = "alsa_output.test"'), '42');
  assert.deepEqual(parseWpctlVolume('Volume: 0.42 [MUTED]'), { volumePercent: 42, muted: true });
  assert.deepEqual(parsePactlVolume('Volume: front-left: 26214 / 40% / -23 dB, front-right: 32768 / 50% / -18 dB', 'Mute: no'), { volumePercent: 50, muted: false });
  for (const value of ['id 0, type PipeWire:Interface:Node', 'id 42, type PipeWire:Interface:Device', 'unknown']) assert.throws(() => parseWpctlEndpoint(value));
  for (const value of ['Volume: 0.42\nCommand: unsafe', 'Volume: NaN', 'Volume: -0.3', 'Volume: 11']) assert.throws(() => parseWpctlVolume(value));
  assert.throws(() => parsePactlVolume('unknown', 'Mute: no')); assert.throws(() => parsePactlVolume('Volume: front: 0 / 40% / 0 dB', 'Mute: maybe'));
});

function linuxFixture({ pipewire = true, dependencies = true, volume = 40, muted = false, defaultChanges = false, preflightChanges = false, mismatch = false, missingAfter = false, failWrite = false } = {}) {
  const calls = [], finds = []; let reads = 0, endpointQueries = 0, written = false, currentVolume = volume, currentMute = muted;
  const endpoint = pipewire ? '42' : 'alsa_output.fixture';
  const controller = new SystemControls({ platform: 'linux', env: { PATH: '/usr/bin', XDG_RUNTIME_DIR: '/run/user/1000' }, find: async names => {
    finds.push(names); return !dependencies ? null : names[0] === 'wpctl' && pipewire ? '/usr/bin/wpctl' : names[0] === 'pactl' && !pipewire ? '/usr/bin/pactl' : null;
  }, run: async (file, args, options) => {
    calls.push({ file, args, options }); assert.equal(options.timeoutMs, 12000); assert.equal(options.env.LC_ALL, 'C');
    const changedEndpoint = preflightChanges && endpointQueries >= 1 || defaultChanges && written;
    if (args[0] === 'inspect') { endpointQueries++; return `id ${changedEndpoint ? '43' : '42'}, type PipeWire:Interface:Node`; }
    if (args[0] === 'get-default-sink') { endpointQueries++; return changedEndpoint ? 'alsa_output.changed' : endpoint; }
    if (args[0] === 'get-volume') { assert.equal(args[1], endpoint); if (written && missingAfter) throw new Error('fixture endpoint vanished'); reads++; return `Volume: ${currentVolume / 100}${currentMute ? ' [MUTED]' : ''}`; }
    if (args[0] === 'get-sink-volume') { assert.equal(args[1], endpoint); if (written && missingAfter) throw new Error('fixture endpoint vanished'); reads++; return `Volume: front-left: 1 / ${currentVolume}% / -3 dB`; }
    if (args[0] === 'get-sink-mute') { assert.equal(args[1], endpoint); return `Mute: ${currentMute ? 'yes' : 'no'}`; }
    written = true; if (failWrite) throw Object.assign(new Error('fixture write result unknown'), { code: 'system_control_timeout' });
    if (args[0] === 'set-volume') { assert.deepEqual(args.slice(0, 3), ['set-volume', '--limit', '1.0']); assert.equal(args[3], endpoint); if (!mismatch) currentVolume = Number(args[4].replace('%', '')); }
    else if (args[0] === 'set-sink-volume') { assert.equal(args[1], endpoint); if (!mismatch) currentVolume = Number(args[2].replace('%', '')); }
    else if (['set-mute', 'set-sink-mute'].includes(args[0])) { assert.equal(args[1], endpoint); if (!mismatch) currentMute = args[2] === '1'; }
    else throw new Error('unexpected fixture call'); return '';
  } });
  return { controller, calls, finds, reads: () => reads, written: () => written };
}
test('Linux status reads one resolved output device and never sets volume or mute', async () => {
  for (const pipewire of [true, false]) {
    const f = linuxFixture({ pipewire, muted: true }), state = await f.controller.audio({ action: 'status' });
    assert.equal(state.ok, true); assert.equal(state.volumePercent, 40); assert.equal(state.muted, true); assert.equal(state.verified, true); assert.equal(f.written(), false); assert.equal(f.reads(), 1);
  }
});
test('Linux mutations pin the original device, preserve the other audio property and verify readback', async () => {
  for (const pipewire of [true, false]) for (const args of [{ action: 'set-volume', volumePercent: 52 }, { action: 'adjust-volume', delta: -8 }, { action: 'set-muted', muted: true }]) {
    const f = linuxFixture({ pipewire }), result = await f.controller.audio(args);
    assert.equal(result.ok, true); assert.equal(result.verified, true); assert.equal(result.defaultEndpointChanged, false); assert.equal(result.before.volumePercent, 40);
    assert.equal(result.volumePercent, args.action === 'set-volume' ? 52 : args.action === 'adjust-volume' ? 32 : 40); assert.equal(result.muted, args.action === 'set-muted');
    const mutations = f.calls.filter(call => call.args[0].startsWith('set-')); assert.equal(mutations.length, 1); assert.equal(f.reads(), 2);
    assert.equal(mutations.some(call => call.args.includes('@DEFAULT_AUDIO_SINK@')), false);
  }
});
test('relative adjustments clamp at zero and 100 without changing mute', async () => {
  for (const [volume, delta, expected] of [[98, 10, 100], [3, -10, 0]]) {
    const f = linuxFixture({ volume, muted: true }), result = await f.controller.audio({ action: 'adjust-volume', delta });
    assert.equal(result.ok, true); assert.equal(result.volumePercent, expected); assert.equal(result.muted, true);
  }
});
test('boosted Linux output is readable but relative operations cannot disguise a large clamp', async () => {
  const f = linuxFixture({ volume: 140 }), status = await f.controller.audio({ action: 'status' });
  assert.equal(status.volumePercent, 140); const result = await f.controller.audio({ action: 'adjust-volume', delta: 1 });
  assert.equal(result.ok, false); assert.equal(result.code, 'amplified_volume'); assert.equal(f.written(), false);
});
test('default output change before mutation refuses dispatch, change after mutation reports original device', async () => {
  for (const pipewire of [true, false]) {
    const before = linuxFixture({ pipewire, preflightChanges: true }), refused = await before.controller.audio({ action: 'set-volume', volumePercent: 41 });
    assert.equal(refused.ok, false); assert.equal(refused.defaultEndpointChanged, true); assert.equal(before.written(), false);
    const after = linuxFixture({ pipewire, defaultChanges: true }), changed = await after.controller.audio({ action: 'set-volume', volumePercent: 41 });
    assert.equal(changed.ok, false); assert.equal(changed.verified, true); assert.equal(changed.defaultEndpointChanged, true); assert.equal(changed.code, 'default_endpoint_changed'); assert.equal(changed.endpoint, changed.before.endpoint);
    assert.equal(after.calls.filter(call => call.args[0].startsWith('set-')).length, 1);
  }
});
test('missing dependencies, timeout, unknown write result and mismatched readback never fall back or retry', async () => {
  const missing = linuxFixture({ dependencies: false }), state = await missing.controller.audio({ action: 'status' }); assert.equal(state.code, 'dependency_missing'); assert.equal(missing.calls.length, 0);
  for (const options of [{ mismatch: true }, { missingAfter: true }, { failWrite: true }]) {
    const f = linuxFixture(options), result = await f.controller.audio({ action: 'set-volume', volumePercent: 41 });
    assert.equal(result.ok, false); assert.equal(f.calls.filter(call => call.args[0].startsWith('set-')).length, 1); assert.deepEqual(f.finds, [['wpctl']]);
    if (options.missingAfter || options.failWrite) { assert.equal(result.mutationOutcome, 'unknown'); assert.match(result.message, /结果未知.*不会自动重试/); }
  }
});
test('malicious or unrecognized pactl endpoint is rejected before write', async () => {
  let calls = 0; const controller = new SystemControls({ platform: 'linux', env: {}, find: async names => names[0] === 'pactl' ? '/usr/bin/pactl' : null, run: async () => { calls++; return 'sink; touch /tmp/evil'; } });
  const result = await controller.audio({ action: 'set-volume', volumePercent: 50 }); assert.equal(result.ok, false); assert.equal(result.code, 'invalid_output'); assert.equal(calls, 1);
});
test('abort before dispatch and after a late read cannot produce a successful action', async () => {
  const f = linuxFixture(); await assert.rejects(f.controller.audio({ action: 'status' }, { signal: AbortSignal.abort() }), { name: 'AbortError' }); assert.equal(f.calls.length, 0);
  const cancellation = new AbortController(); let calls = 0;
  const controller = new SystemControls({ platform: 'linux', env: {}, find: async () => '/usr/bin/wpctl', run: async () => { calls++; cancellation.abort(); return 'id 42, type PipeWire:Interface:Node'; } });
  await assert.rejects(controller.audio({ action: 'set-volume', volumePercent: 50 }, { signal: cancellation.signal }), { name: 'AbortError' }); assert.equal(calls, 1);
});
test('Windows uses fixed native helper argv and verifies endpoint and both audio properties', async () => {
  const calls = [], controller = new SystemControls({ platform: 'win32', env: { SystemRoot: 'C:\\Windows', PETPAL_CODEX_API_KEY: 'secret' }, run: async (file, args, options) => {
    calls.push({ file, args, options }); assert.equal(file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'); assert.equal(options.env.PETPAL_CODEX_API_KEY, undefined); assert.ok(args[args.indexOf('-File') + 1].endsWith('system-windows.ps1'));
    const action = args[args.indexOf('-Action') + 1];
    return JSON.stringify({ ok: true, endpoint: 'fixed-windows-endpoint', volumePercent: action === 'set-volume' ? 55 : 40, muted: action === 'set-muted', before: { endpoint: 'fixed-windows-endpoint', volumePercent: 40, muted: false }, defaultEndpointChanged: false });
  } });
  for (const args of [{ action: 'status' }, { action: 'set-volume', volumePercent: 55 }, { action: 'set-muted', muted: true }]) assert.equal((await controller.audio(args)).ok, true);
  assert.deepEqual(calls[1].args.slice(-4), ['-Action', 'set-volume', '-VolumePercent', '55']); assert.deepEqual(calls[2].args.slice(-4), ['-Action', 'set-muted', '-Muted', 'true']);
});
test('Windows native unavailable/changed endpoint/readback mismatch remain failures', async () => {
  const before = { endpoint: 'fixed', volumePercent: 40, muted: false };
  for (const native of [{ ok: false, code: 'default_endpoint_changed', defaultEndpointChanged: true }, { ok: true, ...before, before: { ...before, endpoint: 'other' } }, { ok: true, ...before, before }, { ok: true, ...before, before, volumePercent: 41, muted: true }]) {
    const controller = new SystemControls({ platform: 'win32', env: {}, run: async () => JSON.stringify(native) });
    assert.equal((await controller.audio({ action: 'set-volume', volumePercent: 41 })).ok, false);
  }
});
test('unsupported platforms do not start any process', async () => {
  const controller = new SystemControls({ platform: 'darwin', run: () => { throw new Error('must not spawn'); } });
  assert.equal((await controller.audio({ action: 'status' })).code, 'platform_unsupported'); assert.equal((await controller.settings({ section: 'sound' })).code, 'platform_unsupported');
});
test('Linux settings use only fixed desktop command/argv and explicitly do not claim visible UI', async () => {
  for (const [section, command] of [['sound', 'pavucontrol'], ['display', 'xfce4-display-settings']]) {
    const calls = []; const controller = new SystemControls({ platform: 'linux', env: { DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' }, find: async names => names[0] === command ? `/usr/bin/${command}` : null, launch: async (file, args) => calls.push({ file, args }) });
    const result = await controller.settings({ section }); assert.equal(result.ok, true); assert.equal(result.requested, true); assert.equal(result.verified, false); assert.deepEqual(calls, [{ file: `/usr/bin/${command}`, args: [] }]);
  }
  const controller = new SystemControls({ platform: 'linux', env: {}, find: () => { throw new Error('headless must not find/spawn'); } }); assert.equal((await controller.settings({ section: 'sound' })).code, 'desktop_unavailable');
});
test('Windows settings helper opens only the fixed selected section, no model URI', async () => {
  let called = false; const controller = new SystemControls({ platform: 'win32', env: {}, run: async (_file, args) => { called = true; assert.deepEqual(args.slice(-4), ['-Action', 'open-settings', '-Section', 'display']); return JSON.stringify({ ok: true, requested: true, verified: false, section: 'display' }); } });
  const result = await controller.settings({ section: 'display' }); assert.equal(result.ok, true); assert.equal(result.verified, false); assert.equal(called, true);
});
test('bounded process runner times out and aborts its own child without reporting success', async () => {
  await assert.rejects(runSystemControlProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100, env: systemControlEnvironment() }), { code: 'system_control_timeout' });
  const controller = new AbortController(); const pending = runSystemControlProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal, timeoutMs: 1000, env: systemControlEnvironment() }); setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, { name: 'AbortError' });
});
test('Windows helper contains fixed CoreAudio endpoint methods and never global media keys or elevation', async () => {
  const source = await readFile(new URL('../server/native/system-windows.ps1', import.meta.url), 'utf8');
  for (const token of ['GetDefaultAudioEndpoint(0, 1', 'GetMasterVolumeLevelScalar', 'SetMasterVolumeLevelScalar', 'GetMute', 'SetMute', 'DefaultEndpointChanged', '$audio.Dispose()']) assert.ok(source.includes(token));
  assert.doesNotMatch(source, /keybd_event|SendKeys|RunAs|ExecutionPolicy\s+Bypass|Set-ExecutionPolicy|Register-ScheduledTask/i);
});

function registry(systemControls) {
  return createDesktopTools({ dataDir: '.unused-system-fixture', systemControls, music: { status: async () => ({}), close: async () => {} }, musicMcp: { status: async () => ({}), close: async () => {} }, computerUseMcp: { status: async () => ({}), close: async () => {} }, opencli: { status: async () => ({}), close: async () => {} } });
}
test('system registry descriptions are strict, readable and keep every mutation/settings approval', async () => {
  const tools = registry({ audio: async () => ({ ok: true }), settings: async () => ({ ok: true }) });
  assert.equal(tools.describe('petpal_system_audio', { action: 'status' }).approvalRequired, false);
  for (const args of [{ action: 'set-volume', volumePercent: 50 }, { action: 'adjust-volume', delta: -5 }, { action: 'set-muted', muted: false }]) assert.equal(tools.describe('petpal_system_audio', args).approvalRequired, true);
  assert.equal(tools.describe('petpal_system_settings', { section: 'sound' }).approvalRequired, true); assert.match(tools.describe('petpal_system_audio', { action: 'adjust-volume', delta: -5 }).description, /所选执行电脑.*降低 5%/);
  const spec = desktopToolSpecs.find(spec => spec.name === 'petpal_system_audio'); assert.equal(spec.inputSchema.additionalProperties, false);
  assert.throws(() => tools.describe('petpal_system_audio', { action: 'set-muted', muted: true, hostId: 'wrong' })); await tools.close();
});
test('system registry reuses cross-tool serialization and close cancellation; it dispatches no host override', async () => {
  let release, signal, argsSeen; const tools = registry({ audio: async (args, options) => { argsSeen = args; signal = options.signal; return new Promise((resolve, reject) => { release = resolve; signal.addEventListener('abort', () => reject(Object.assign(new Error('stop'), { name: 'AbortError' })), { once: true }); }); }, settings: async () => ({ ok: true }) });
  const first = tools.execute('petpal_system_audio', { action: 'set-volume', volumePercent: 41 }); const rejected = assert.rejects(first, { name: 'AbortError' });
  assert.deepEqual(argsSeen, { action: 'set-volume', volumePercent: 41 }); await assert.rejects(tools.execute('petpal_system_settings', { section: 'sound' }), { status: 409 });
  await tools.close(); await rejected; assert.equal(signal.aborted, true); release({ ok: true });
  await assert.rejects(tools.execute('petpal_system_audio', { action: 'status' }), { name: 'AbortError' });
});
