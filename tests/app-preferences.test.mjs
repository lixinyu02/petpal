import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as nativeFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { createAppPreferences } = createRequire(import.meta.url)('../desktop/app-preferences.cjs');
const defaults = { autoLaunch: false, startMinimized: false, showPetOnLaunch: true, closeToTray: true, petAlwaysOnTop: true };
const registrationName = 'com.petpal.desktop';
const failure = error => error.code === 'PETPAL_APP_PREFERENCES' && !error.message.includes('fixture-private');

async function fixture(t, { platform = 'win32', packaged = true, env = {}, failRename, failSetter, failGetter } = {}) {
  const root = await nativeFs.mkdtemp(path.join(tmpdir(), 'petpal-app-preferences-'));
  const userData = path.join(root, 'user data');
  await nativeFs.mkdir(userData);
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.join(tmpdir(), 'petpal-app-preferences-')));
    await nativeFs.rm(root, { recursive: true, force: true });
  });
  const settingsFile = path.join(userData, 'app-preferences.json');
  const autostartFile = path.join(root, 'xdg', 'autostart', 'com.petpal.desktop.desktop');
  const calls = [], items = new Map(), approvals = new Map(), otherRegistrations = [];
  const actual = input => {
    const normalized = String(input).replace(/\\/g, '/');
    return /^\/fixture-xdg(?:\/|$)/.test(normalized) ? path.join(root, 'xdg', normalized.slice('/fixture-xdg'.length)) : input;
  };
  const fs = { ...nativeFs };
  for (const method of ['mkdir', 'lstat', 'readFile', 'chmod', 'open', 'unlink'])
    fs[method] = (file, ...args) => nativeFs[method](actual(file), ...args);
  fs.rename = async (from, to) => {
    if (failRename?.(actual(from), actual(to))) throw Object.assign(new Error('fixture-private-path-and-token'), { code: 'EACCES' });
    await nativeFs.rename(actual(from), actual(to));
  };
  const app = { isPackaged: packaged, getPath: name => name === 'userData' ? userData :
      name === 'home' ? '/fixture-home' : platform === 'win32' ? 'C:\\Program Files\\PetPal\\PetPal.exe' : '/opt/PetPal/petpal',
    getLoginItemSettings(options) {
      calls.push({ operation: 'read', ...structuredClone(options) });
      if (failGetter?.(options)) throw new Error('fixture-private-system-error');
      // Mirror Electron's command-line parsing: a raw path with spaces is cut at
      // the first space, while a quoted query retains the whole executable.
      const queryPath = options.path.startsWith('"') ? options.path.slice(1, options.path.indexOf('"', 1)) : options.path.split(' ')[0];
      const registered = Boolean(items.get(queryPath)), approved = approvals.get(queryPath) !== false;
      return { openAtLogin: registered, executableWillLaunchAtLogin: registered && approved,
        launchItems: [
          ...(registered ? [{ name: registrationName, path: queryPath, args: [...options.args], scope: 'user', enabled: approved }] : []),
          ...otherRegistrations.filter(item => item.path.toLowerCase() === queryPath.toLowerCase()),
        ] };
    },
    setLoginItemSettings(options) {
      calls.push({ operation: 'write', ...structuredClone(options) });
      assert.equal(options.name, registrationName);
      // One fixed Run value is overwritten/removed by name, not by path. Retain
      // other-name/machine registrations separately in tests below.
      for (const executable of items.keys()) { items.delete(executable); approvals.delete(executable); }
      items.set(options.path, options.openAtLogin);
      approvals.set(options.path, options.enabled);
      if (failSetter?.(options)) throw new Error('fixture-private-system-error');
    },
  };
  const options = { app, platform, env: platform === 'linux' ? { XDG_CONFIG_HOME: '/fixture-xdg', ...env } : env, fs };
  return { root, userData, settingsFile, autostartFile, calls, items, approvals, otherRegistrations, app, options, preferences: createAppPreferences(options) };
}

test('missing preferences load defaults without creating any file or enabling login items', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.preferences.load(), { platform: 'win32', autoLaunchSupported: true, ...defaults });
  assert.deepEqual(await nativeFs.readdir(f.userData), []);
  assert.ok(f.calls.every(call => call.operation === 'read'));
  const copy = f.preferences.current(); copy.petAlwaysOnTop = false;
  assert.equal(f.preferences.current().petAlwaysOnTop, true);
});

test('window flags persist atomically and reload without writing an OS login item', async t => {
  const f = await fixture(t);
  await f.preferences.load();
  const patch = { startMinimized: true, showPetOnLaunch: false, closeToTray: false, petAlwaysOnTop: false };
  assert.deepEqual(await f.preferences.update(patch), { platform: 'win32', autoLaunchSupported: true, ...defaults, ...patch });
  assert.deepEqual(JSON.parse(await nativeFs.readFile(f.settingsFile, 'utf8')), { ...defaults, ...patch });
  assert.deepEqual(await nativeFs.readdir(f.userData), ['app-preferences.json']);
  const next = createAppPreferences(f.options);
  await next.load();
  assert.deepEqual(next.current(), { ...defaults, ...patch });
  assert.ok(f.calls.every(call => call.operation === 'read'));
});

test('unknown keys, non-boolean values, arrays and primitives are rejected with no mutations', async t => {
  const f = await fixture(t);
  for (const input of [null, [], false, 'true', 1, { autoLaunch: 1 }, { closeToTray: null }, { startMinimized: 'false' },
    { arbitrary: 'fixture-private' }, { __proto__: { inherited: true }, autoLaunch: false }])
    await assert.rejects(f.preferences.update(input), failure);
  assert.deepEqual(f.preferences.current(), defaults);
  assert.deepEqual(await nativeFs.readdir(f.userData), []);
  assert.equal(f.calls.length, 0);
});

test('invalid UTF-8, oversize and malformed settings degrade to defaults without echoing or replacing bytes', async t => {
  const f = await fixture(t);
  for (const bytes of [Buffer.from('{"fixture-private"'), Buffer.from([0xff, 0xfe]), Buffer.alloc(8193, 32),
    Buffer.from(JSON.stringify({ closeToTray: 'fixture-private' })), Buffer.from(JSON.stringify({ apiKey: 'fixture-private' }))]) {
    await nativeFs.writeFile(f.settingsFile, bytes);
    const result = await f.preferences.load();
    assert.deepEqual(f.preferences.current(), defaults);
    assert.match(result.autoLaunchReason, /默认窗口设置/);
    assert.ok(!JSON.stringify(result).includes('fixture-private') && !JSON.stringify(result).includes(f.userData));
    assert.deepEqual(await nativeFs.readFile(f.settingsFile), bytes);
  }
});

test('a directory in place of settings is preserved and does not block application startup', async t => {
  const f = await fixture(t);
  await nativeFs.mkdir(f.settingsFile);
  assert.match((await f.preferences.load()).autoLaunchReason, /默认窗口设置/);
  await assert.rejects(f.preferences.update({ startMinimized: true }), failure);
  assert.ok((await nativeFs.stat(f.settingsFile)).isDirectory());
  assert.deepEqual(f.preferences.current(), defaults);
});

test('Windows portable login registration and queries use the wrapper, never the extracted executable', async t => {
  const wrapper = 'D:\\工具 PetPal\\PetPal-0.9.7-Windows.exe';
  const f = await fixture(t, { env: { PORTABLE_EXECUTABLE_FILE: wrapper, PORTABLE_EXECUTABLE_DIR: 'D:\\工具 PetPal' } });
  await f.preferences.load();
  assert.equal((await f.preferences.update({ autoLaunch: true })).autoLaunch, true);
  assert.deepEqual(f.calls.find(call => call.operation === 'write'),
    { operation: 'write', name: registrationName, openAtLogin: true, enabled: true, path: wrapper, args: ['--petpal-autostart'] });
  assert.ok(f.calls.every(call => call.path === (call.operation === 'read' ? `"${wrapper}"` : wrapper)));
  assert.ok(!JSON.stringify(await f.preferences.status()).includes(wrapper));
  await f.preferences.update({ autoLaunch: false });
  assert.equal(f.items.get(wrapper), false);
});

test('a portable extraction without a wrapper cannot register the temporary executable', async t => {
  const f = await fixture(t, { env: { PORTABLE_EXECUTABLE_DIR: 'D:\\portable' } });
  const result = await f.preferences.load();
  assert.equal(result.autoLaunchSupported, false);
  assert.equal(result.autoLaunch, false);
  assert.match(result.autoLaunchReason, /启动外壳/);
  await assert.rejects(f.preferences.update({ autoLaunch: true }), failure);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.preferences.update({ closeToTray: false })).closeToTray, false);
});

test('a packaged executable inside Windows TEMP without a wrapper is never registered', async t => {
  const f = await fixture(t, { env: { TEMP: 'C:\\FixtureTemp' } });
  const original = f.app.getPath;
  f.app.getPath = name => name === 'exe' ? 'C:\\FixtureTemp\\nsi123\\PetPal.exe' : original(name);
  assert.equal((await f.preferences.load()).autoLaunchSupported, false);
  await assert.rejects(f.preferences.update({ autoLaunch: true }), error => failure(error) && /临时目录/.test(error.message));
  assert.equal(f.calls.length, 0);
});

test('unpackaged and unsupported platforms never touch OS registration but retain window preferences', async t => {
  for (const options of [{ packaged: false }, { platform: 'darwin' }, { platform: 'freebsd' }]) {
    const f = await fixture(t, options);
    const result = await f.preferences.load();
    assert.equal(result.autoLaunchSupported, false);
    await assert.rejects(f.preferences.update({ autoLaunch: true }), failure);
    assert.equal((await f.preferences.update({ autoLaunch: false, startMinimized: true })).startMinimized, true);
    assert.equal(f.calls.length, 0);
  }
});

test('system login status overrides stale persisted settings without silently reenabling a disabled item', async t => {
  const f = await fixture(t);
  await nativeFs.writeFile(f.settingsFile, JSON.stringify({ ...defaults, autoLaunch: true }));
  const result = await f.preferences.load();
  assert.equal(result.autoLaunch, false);
  assert.match(result.autoLaunchReason, /清理旧小伴/);
  assert.ok(f.calls.every(call => call.operation === 'read'));
  f.items.set(f.app.getPath('exe'), true);
  assert.equal((await f.preferences.status()).autoLaunch, true);
  assert.equal((await f.preferences.status()).autoLaunchReason, undefined);
  f.items.set(f.app.getPath('exe'), false);
  assert.equal((await f.preferences.status()).autoLaunch, false);
});

test('updating a portable wrapper reports the disabled current target and never changes the older registration on load', async t => {
  const oldWrapper = 'D:\\PetPal-0.9.6.exe', newWrapper = 'D:\\PetPal-0.9.7.exe';
  const f = await fixture(t, { env: { PORTABLE_EXECUTABLE_FILE: newWrapper } });
  f.items.set(oldWrapper, true);
  await nativeFs.writeFile(f.settingsFile, JSON.stringify({ ...defaults, autoLaunch: true }));
  const result = await f.preferences.load();
  assert.equal(result.autoLaunch, false);
  assert.equal(result.autoLaunchSupported, false);
  assert.match(result.autoLaunchReason, /清理旧小伴/);
  assert.equal(f.items.get(oldWrapper), true);
  assert.ok(f.calls.every(call => call.operation === 'read' && call.path === `"${newWrapper}"`));
});

test('legacy stale registration without private target metadata is not blindly removed or reenrolled', async t => {
  const oldWrapper = 'D:\\PetPal old.exe', newWrapper = 'D:\\PetPal new.exe';
  const f = await fixture(t, { env: { PORTABLE_EXECUTABLE_FILE: newWrapper } });
  f.items.set(oldWrapper, true);
  await nativeFs.writeFile(f.settingsFile, JSON.stringify({ ...defaults, autoLaunch: true }));
  const before = await nativeFs.readFile(f.settingsFile);
  const result = await f.preferences.load();
  assert.equal(result.autoLaunchSupported, false);
  await assert.rejects(f.preferences.update({ autoLaunch: false }), error => failure(error) && /清理旧小伴/.test(error.message));
  await assert.rejects(f.preferences.update({ autoLaunch: true }), error => failure(error) && /清理旧小伴/.test(error.message));
  assert.equal(f.items.get(oldWrapper), true);
  assert.ok(f.calls.every(call => call.operation === 'read'));
  assert.deepEqual(await nativeFs.readFile(f.settingsFile), before);
  await f.preferences.update({ startMinimized: true });
  const stored = JSON.parse(await nativeFs.readFile(f.settingsFile, 'utf8'));
  assert.equal(stored.autoLaunch, true); // Window-only saves retain the unknown legacy intent.
  assert.equal(stored.startMinimized, true);
  assert.equal((await createAppPreferences(f.options).load()).autoLaunchSupported, false);
});

test('private Windows target metadata permits an explicit disable after moving a portable wrapper', async t => {
  const oldWrapper = 'D:\\PetPal old.exe', newWrapper = 'E:\\New folder\\PetPal new.exe';
  const env = { PORTABLE_EXECUTABLE_FILE: oldWrapper };
  const f = await fixture(t, { env });
  await f.preferences.load();
  await f.preferences.update({ autoLaunch: true });
  const stored = JSON.parse(await nativeFs.readFile(f.settingsFile, 'utf8'));
  assert.deepEqual(stored._windowsAutoLaunchTarget,
    { platform: 'win32', name: registrationName, path: oldWrapper, args: ['--petpal-autostart'] });
  assert.ok(!JSON.stringify(f.preferences.current()).includes(oldWrapper));
  assert.ok(!JSON.stringify(await f.preferences.status()).includes(oldWrapper));
  env.PORTABLE_EXECUTABLE_FILE = newWrapper;
  const moved = createAppPreferences(f.options), writes = f.calls.filter(call => call.operation === 'write').length;
  const status = await moved.load();
  assert.equal(status.autoLaunchSupported, true);
  assert.equal(status.autoLaunch, true);
  assert.match(status.autoLaunchReason, /旧位置/);
  assert.equal(f.calls.filter(call => call.operation === 'write').length, writes); // No migration during load.
  assert.equal((await moved.update({ autoLaunch: false })).autoLaunch, false);
  assert.equal(f.items.get(oldWrapper), undefined);
  assert.equal(f.items.get(newWrapper), false);
  assert.equal(JSON.parse(await nativeFs.readFile(f.settingsFile, 'utf8'))._windowsAutoLaunchTarget, undefined);
});

test('a failed save after moving a Windows wrapper restores the previous exact owned registration and metadata', async t => {
  for (const approved of [true, false]) {
    let reject = false;
    const env = { PORTABLE_EXECUTABLE_FILE: 'D:\\Old PetPal\\PetPal.exe' };
    const f = await fixture(t, { env, failRename: (_from, to) => reject && to === f.settingsFile });
    await f.preferences.load();
    await f.preferences.update({ autoLaunch: true });
    const oldWrapper = env.PORTABLE_EXECUTABLE_FILE;
    f.approvals.set(oldWrapper, approved);
    const bytes = await nativeFs.readFile(f.settingsFile);
    env.PORTABLE_EXECUTABLE_FILE = 'E:\\Current PetPal\\PetPal.exe';
    const moved = createAppPreferences(f.options);
    await moved.load();
    reject = true;
    await assert.rejects(moved.update({ autoLaunch: false, startMinimized: true }), failure);
    assert.equal(f.items.get(oldWrapper), true);
    assert.equal(f.approvals.get(oldWrapper), approved);
    assert.equal(f.items.get(env.PORTABLE_EXECUTABLE_FILE), undefined);
    assert.deepEqual(await nativeFs.readFile(f.settingsFile), bytes);
    const restored = await moved.status();
    assert.equal(restored.autoLaunchSupported, true);
    assert.equal(restored.autoLaunch, approved);
  }
});

test('a partially applied Windows disable error restores the old portable target after a move', async t => {
  let rejectDisable = false;
  const env = { PORTABLE_EXECUTABLE_FILE: 'D:\\Old PetPal.exe' };
  const f = await fixture(t, { env, failSetter: settings => rejectDisable && !settings.openAtLogin });
  await f.preferences.load();
  await f.preferences.update({ autoLaunch: true });
  const oldWrapper = env.PORTABLE_EXECUTABLE_FILE, bytes = await nativeFs.readFile(f.settingsFile);
  env.PORTABLE_EXECUTABLE_FILE = 'E:\\New PetPal.exe';
  const moved = createAppPreferences(f.options);
  await moved.load();
  rejectDisable = true;
  await assert.rejects(moved.update({ autoLaunch: false }), failure);
  assert.equal(f.items.get(oldWrapper), true);
  assert.equal(f.approvals.get(oldWrapper), true);
  assert.equal(f.items.get(env.PORTABLE_EXECUTABLE_FILE), undefined);
  assert.deepEqual(await nativeFs.readFile(f.settingsFile), bytes);
});

test('only an explicit enable migrates a known old Windows registration and commits its new private target', async t => {
  const env = { PORTABLE_EXECUTABLE_FILE: 'D:\\Old PetPal.exe' };
  const f = await fixture(t, { env });
  await f.preferences.load();
  await f.preferences.update({ autoLaunch: true });
  const oldWrapper = env.PORTABLE_EXECUTABLE_FILE;
  env.PORTABLE_EXECUTABLE_FILE = 'E:\\New PetPal.exe';
  const moved = createAppPreferences(f.options);
  await moved.load();
  assert.equal(f.items.get(oldWrapper), true);
  await moved.update({ autoLaunch: true });
  assert.equal(f.items.get(oldWrapper), undefined);
  assert.equal(f.items.get(env.PORTABLE_EXECUTABLE_FILE), true);
  assert.equal(JSON.parse(await nativeFs.readFile(f.settingsFile, 'utf8'))._windowsAutoLaunchTarget.path, env.PORTABLE_EXECUTABLE_FILE);
});

test('private startup metadata rejects arbitrary names, arguments, relative paths and cross-platform data', async t => {
  const f = await fixture(t);
  const valid = { platform: 'win32', name: registrationName, path: 'D:\\PetPal.exe', args: ['--petpal-autostart'] };
  for (const metadata of [null, [], { ...valid, name: 'another-app' }, { ...valid, args: ['--arbitrary'] },
    { ...valid, path: 'relative.exe' }, { ...valid, path: '/opt/PetPal.exe' }, { ...valid, path: '\\rooted.exe' },
    { ...valid, path: '\\\\?\\C:\\PetPal.exe' }, { ...valid, path: 'D:\\Pet"Pal.exe' },
    { ...valid, platform: 'linux' }, { ...valid, extra: true }]) {
    const bytes = Buffer.from(JSON.stringify({ ...defaults, _windowsAutoLaunchTarget: metadata }));
    await nativeFs.writeFile(f.settingsFile, bytes);
    const loaded = await f.preferences.load();
    assert.match(loaded.autoLaunchReason, /默认窗口设置/);
    assert.deepEqual(f.preferences.current(), defaults);
    assert.deepEqual(await nativeFs.readFile(f.settingsFile), bytes);
  }
  await assert.rejects(f.preferences.update({ _windowsAutoLaunchTarget: valid }), failure);
  const linux = await fixture(t, { platform: 'linux' });
  await nativeFs.writeFile(linux.settingsFile, JSON.stringify({ ...defaults, _windowsAutoLaunchTarget: valid }));
  assert.match((await linux.preferences.load()).autoLaunchReason, /默认窗口设置/);
});

test('Windows disabling touches only the fixed owned user registration, preserving same-path other names and machine entries', async t => {
  const f = await fixture(t), executable = f.app.getPath('exe');
  f.otherRegistrations.push(
    { name: 'another-app', path: executable, args: ['--petpal-autostart'], scope: 'user', enabled: true },
    { name: registrationName, path: executable, args: ['--petpal-autostart'], scope: 'machine', enabled: true });
  const others = structuredClone(f.otherRegistrations);
  await f.preferences.load();
  await f.preferences.update({ autoLaunch: true });
  await f.preferences.update({ autoLaunch: false });
  assert.deepEqual(f.otherRegistrations, others);
  assert.ok(f.calls.filter(call => call.operation === 'write').every(call => call.name === registrationName));
});

test('Windows Task Manager disabled entries remain disabled on load and require explicit enabling', async t => {
  const f = await fixture(t), executable = f.app.getPath('exe');
  f.items.set(executable, true);
  f.approvals.set(executable, false);
  await nativeFs.writeFile(f.settingsFile, JSON.stringify({ ...defaults, autoLaunch: true }));
  const result = await f.preferences.load();
  assert.equal(result.autoLaunch, false);
  assert.match(result.autoLaunchReason, /系统启动应用中禁用/);
  assert.ok(f.calls.every(call => call.operation === 'read'));
  await f.preferences.update({ closeToTray: false });
  assert.equal(f.approvals.get(executable), false);
  assert.equal((await f.preferences.update({ autoLaunch: true })).autoLaunch, true);
  assert.equal(f.approvals.get(executable), true);
});

test('Windows approval status is matched by executable and exact autostart arguments', async t => {
  const f = await fixture(t), executable = f.app.getPath('exe');
  f.app.getLoginItemSettings = () => ({ openAtLogin: true, executableWillLaunchAtLogin: true,
    launchItems: [
      { name: 'another-app', scope: 'user', path: executable, args: ['--different-mode'], enabled: true },
      { name: registrationName, scope: 'user', path: executable.toLowerCase(), args: ['--petpal-autostart'], enabled: false },
    ] });
  assert.equal((await f.preferences.load()).autoLaunch, false);
});

test('a failed Windows enable restores the original registered but Task Manager disabled state', async t => {
  let reject = false;
  const f = await fixture(t, { failRename: (_from, to) => reject && to === f.settingsFile });
  const executable = f.app.getPath('exe');
  f.items.set(executable, true);
  f.approvals.set(executable, false);
  await f.preferences.load();
  reject = true;
  await assert.rejects(f.preferences.update({ autoLaunch: true }), failure);
  assert.equal(f.items.get(executable), true);
  assert.equal(f.approvals.get(executable), false);
  assert.equal((await f.preferences.status()).autoLaunch, false);
});

test('Windows OS write errors roll back a partially applied login item and retain preferences', async t => {
  const f = await fixture(t, { failSetter: settings => settings.openAtLogin });
  await f.preferences.load();
  await assert.rejects(f.preferences.update({ autoLaunch: true, startMinimized: true }), failure);
  assert.equal(f.items.get(f.app.getPath('exe')), false);
  assert.deepEqual(f.preferences.current(), defaults);
  await assert.rejects(nativeFs.stat(f.settingsFile), { code: 'ENOENT' });
});

test('saving errors roll back Windows registration and leave the complete previous preference file', async t => {
  let reject = false;
  const f = await fixture(t, { failRename: (_from, to) => reject && to === f.settingsFile });
  await f.preferences.load();
  await f.preferences.update({ showPetOnLaunch: false });
  const previous = await nativeFs.readFile(f.settingsFile);
  reject = true;
  await assert.rejects(f.preferences.update({ autoLaunch: true, startMinimized: true }), failure);
  assert.equal(f.items.get(f.app.getPath('exe')), false);
  assert.deepEqual(await nativeFs.readFile(f.settingsFile), previous);
  assert.equal(f.preferences.current().startMinimized, false);
  assert.equal(f.preferences.current().showPetOnLaunch, false);
  assert.deepEqual(await nativeFs.readdir(f.userData), ['app-preferences.json']);
});

test('an OS rollback failure is reported explicitly without private error content', async t => {
  const f = await fixture(t, { failSetter: () => true });
  await f.preferences.load();
  await assert.rejects(f.preferences.update({ autoLaunch: true }), error => failure(error) && /回滚未完成/.test(error.message));
});

test('system read failure is fail-closed and blocks startup changes without blocking load or window-only edits', async t => {
  const f = await fixture(t, { failGetter: () => true });
  const result = await f.preferences.load();
  assert.equal(result.autoLaunch, false);
  assert.match(result.autoLaunchReason, /读取系统/);
  await assert.rejects(f.preferences.update({ autoLaunch: true }), failure);
  assert.equal((await f.preferences.update({ closeToTray: false })).closeToTray, false);
  assert.ok(f.calls.every(call => call.operation === 'read'));
});

test('a temporary Windows login-item read error marks status unavailable and recovers to the real enabled state', async t => {
  let unreadable = false;
  const f = await fixture(t, { failGetter: () => unreadable });
  f.items.set(f.app.getPath('exe'), true);
  const initial = await f.preferences.load();
  assert.equal(initial.autoLaunchSupported, true);
  assert.equal(initial.autoLaunch, true);
  unreadable = true;
  const unavailable = await f.preferences.status();
  assert.equal(unavailable.autoLaunchSupported, false);
  assert.equal(unavailable.autoLaunch, false);
  assert.match(unavailable.autoLaunchReason, /无法读取系统开机启动项/);
  assert.ok(!JSON.stringify(unavailable).includes('fixture-private'));
  assert.ok(!JSON.stringify(unavailable).includes(f.userData));
  unreadable = false;
  const recovered = await f.preferences.status();
  assert.equal(recovered.autoLaunchSupported, true);
  assert.equal(recovered.autoLaunch, true);
  assert.equal(recovered.autoLaunchReason, undefined);
  assert.ok(f.calls.every(call => call.operation === 'read'));
  assert.deepEqual(await nativeFs.readdir(f.userData), []);
});

test('Linux AppImage autostart uses the outer image, correctly escapes Exec and preserves other entries', async t => {
  const image = '/opt/Pet Pal/A "gent" \\`$% App.AppImage';
  const f = await fixture(t, { platform: 'linux', env: { APPIMAGE: image } });
  await f.preferences.load();
  assert.equal((await f.preferences.update({ autoLaunch: true })).autoLaunch, true);
  const desktop = await nativeFs.readFile(f.autostartFile, 'utf8');
  const encoded = image.replace(/["`$\\]/g, '\\$&').replace(/\\/g, '\\\\').replace(/%/g, '%%');
  assert.ok(desktop.includes(`Exec="${encoded}" --petpal-autostart\n`));
  // Parse both Desktop Entry escaping and Exec quoting, not merely the encoder.
  const value = desktop.match(/^Exec=(.+)$/m)[1].replace(/\\\\/g, '\\');
  const executable = value.match(/^"((?:\\.|[^"\\])*)" --petpal-autostart$/)[1]
    .replace(/\\(["`$\\])/g, '$1').replace(/%%/g, '%');
  assert.equal(executable, image);
  const other = path.join(path.dirname(f.autostartFile), 'other-app.desktop');
  await nativeFs.writeFile(other, '[Desktop Entry]\nName=Keep me\n');
  await f.preferences.update({ autoLaunch: false });
  assert.equal(await nativeFs.readFile(other, 'utf8'), '[Desktop Entry]\nName=Keep me\n');
  await assert.rejects(nativeFs.stat(f.autostartFile), { code: 'ENOENT' });
  if (process.platform !== 'win32') {
    assert.equal((await nativeFs.stat(f.settingsFile)).mode & 0o777, 0o600);
    assert.equal((await nativeFs.stat(path.dirname(f.autostartFile))).mode & 0o777, 0o700);
  }
});

test('Linux status respects external disabling and a stale executable', async t => {
  const f = await fixture(t, { platform: 'linux' });
  await f.preferences.load();
  await f.preferences.update({ autoLaunch: true });
  const original = await nativeFs.readFile(f.autostartFile, 'utf8');
  await nativeFs.writeFile(f.autostartFile, original + 'Hidden=true\n');
  assert.equal((await f.preferences.status()).autoLaunch, false);
  await nativeFs.writeFile(f.autostartFile, original.replace('enabled=true', 'enabled=false'));
  assert.equal((await f.preferences.status()).autoLaunch, false);
  await nativeFs.writeFile(f.autostartFile, original.replace('/opt/PetPal/petpal', '/opt/OldPetPal/petpal'));
  assert.match((await f.preferences.status()).autoLaunchReason, /旧位置/);
  await f.preferences.update({ autoLaunch: true });
  assert.equal(await nativeFs.readFile(f.autostartFile, 'utf8'), original);
  await nativeFs.writeFile(f.autostartFile, original.replace('/opt/PetPal/petpal', '/opt/OldPetPal/petpal'));
  await f.preferences.update({ autoLaunch: false });
  await assert.rejects(nativeFs.stat(f.autostartFile), { code: 'ENOENT' });
});

test('invalid executable paths cannot inject Desktop Entry directives or register Windows relative paths', async t => {
  for (const env of [{ APPIMAGE: '/opt/app\nHidden=false' }, { APPIMAGE: 'relative.AppImage' }, { XDG_CONFIG_HOME: 'relative' }]) {
    const f = await fixture(t, { platform: 'linux', env });
    assert.equal((await f.preferences.load()).autoLaunchSupported, false);
    await assert.rejects(f.preferences.update({ autoLaunch: true }), failure);
  }
  const f = await fixture(t, { env: { PORTABLE_EXECUTABLE_FILE: 'relative.exe' } });
  assert.equal((await f.preferences.load()).autoLaunchSupported, false);
  await assert.rejects(f.preferences.update({ autoLaunch: true }), failure);
  assert.equal(f.calls.length, 0);
});

test('a Linux persistence failure restores the exact previous disabled desktop entry', async t => {
  let reject = false;
  const f = await fixture(t, { platform: 'linux', failRename: (_from, to) => reject && to === f.settingsFile });
  await f.preferences.load();
  await f.preferences.update({ autoLaunch: true });
  const original = Buffer.from((await nativeFs.readFile(f.autostartFile, 'utf8')) + 'Hidden=true\n# retain user comment\n');
  await nativeFs.writeFile(f.autostartFile, original);
  const previousSettings = await nativeFs.readFile(f.settingsFile);
  reject = true;
  await assert.rejects(f.preferences.update({ autoLaunch: true }), failure);
  assert.deepEqual(await nativeFs.readFile(f.autostartFile), original);
  assert.deepEqual(await nativeFs.readFile(f.settingsFile), previousSettings);
  assert.equal(f.preferences.current().autoLaunch, false);
});

test('concurrent preference patches are serialized and preserve both sets of edits', async t => {
  const f = await fixture(t);
  await f.preferences.load();
  const [first, second] = await Promise.all([
    f.preferences.update({ startMinimized: true }), f.preferences.update({ petAlwaysOnTop: false }),
  ]);
  assert.equal(first.startMinimized, true);
  assert.equal(first.petAlwaysOnTop, true);
  assert.equal(second.startMinimized, true);
  assert.equal(second.petAlwaysOnTop, false);
  assert.deepEqual(JSON.parse(await nativeFs.readFile(f.settingsFile, 'utf8')), { ...defaults, startMinimized: true, petAlwaysOnTop: false });
});

test('a queued update rechecks authorization before any OS or file mutations', async t => {
  const f = await fixture(t);
  await f.preferences.load();
  const baselineReads = f.calls.length;
  await assert.rejects(f.preferences.update({ autoLaunch: true }, { authorize: async () => { throw new Error('fixture-private-session'); } }),
    error => failure(error) && /登录状态/.test(error.message));
  assert.equal(f.calls.length, baselineReads);
  assert.deepEqual(await nativeFs.readdir(f.userData), []);
});

test('authorization loss after OS mutation restores registration and does not save preferences', async t => {
  const f = await fixture(t);
  await f.preferences.load();
  let checks = 0;
  await assert.rejects(f.preferences.update({ autoLaunch: true }, { authorize: async () => {
    if (++checks === 2) throw new Error('fixture-private-session');
  } }), error => failure(error) && /登录状态/.test(error.message));
  assert.equal(f.items.get(f.app.getPath('exe')), false);
  assert.deepEqual(f.preferences.current(), defaults);
  assert.deepEqual(await nativeFs.readdir(f.userData), []);
});

test('authorization is checked at atomic commit so a window-only save cannot outlive its session', async t => {
  const f = await fixture(t);
  await f.preferences.load();
  let checks = 0;
  await assert.rejects(f.preferences.update({ closeToTray: false }, { authorize: async () => {
    if (++checks === 2) throw new Error('fixture-private-session');
  } }), error => failure(error) && /登录状态/.test(error.message));
  assert.equal(f.preferences.current().closeToTray, true);
  assert.deepEqual(await nativeFs.readdir(f.userData), []);
});

test('closing waits for an inflight startup change to roll back and prevents any new preferences update', async t => {
  const f = await fixture(t);
  await f.preferences.load();
  let resume, started;
  const authorizationGate = new Promise(resolve => { resume = resolve; });
  const secondAuthorization = new Promise(resolve => { started = resolve; });
  let checks = 0;
  const update = f.preferences.update({ autoLaunch: true }, { authorize: async () => {
    if (++checks === 2) { started(); await authorizationGate; }
  } });
  // Attach the rejection handler before releasing the paused authorization.
  const rejection = assert.rejects(update, error => failure(error) && /正在退出/.test(error.message));
  await secondAuthorization;
  assert.equal(f.items.get(f.app.getPath('exe')), true);
  let closed = false;
  const close = f.preferences.close().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  const operations = f.calls.length;
  await assert.rejects(f.preferences.update({ closeToTray: false }), error => failure(error) && /正在退出/.test(error.message));
  assert.equal(f.calls.length, operations);
  resume();
  await rejection;
  await close;
  assert.equal(f.items.get(f.app.getPath('exe')), false);
  assert.deepEqual(f.preferences.current(), defaults);
  assert.deepEqual(await nativeFs.readdir(f.userData), []);
});
