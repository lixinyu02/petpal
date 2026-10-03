import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OpenCliBrowserSetup, validateOpenCliSetup } from '../server/opencli-browser-setup.mjs';

const extensionUrl = 'https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk';
const downloadPage = 'https://www.google.com/chrome/';
const windowsInstallerUrl = 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi';
const signingKeyUrl = 'https://dl.google.com/linux/linux_signing_key.pub';
const repositoryUrl = 'https://dl.google.com/linux/chrome/deb/dists/stable/';
const packagesUrl = `${repositoryUrl}main/binary-amd64/Packages`;
const fingerprint = 'EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796';
const fixtureTime = Date.parse('2026-10-01T12:00:00Z');
const version = '140.0.7339.80-1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const abortError = () => Object.assign(new Error('fixture download cancelled'), { name: 'AbortError' });
const abortedPromise = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(abortError());
  else signal.addEventListener('abort', () => reject(abortError()), { once: true });
});

function childFixture() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), signals: [], exitCode: null, unreferenced: false,
  });
  child.kill = signal => { child.signals.push(signal); child.emit('kill', signal); return true; };
  child.unref = () => { child.unreferenced = true; };
  child.finish = code => { if (child.exitCode === null) { child.exitCode = code; child.emit('close', code); } };
  return child;
}

function killed(child, signal) {
  if (child.signals.includes(signal)) return Promise.resolve();
  return new Promise(resolve => {
    const listener = actual => { if (actual === signal) { child.removeListener('kill', listener); resolve(); } };
    child.on('kill', listener);
  });
}

async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(location));
    else output.push(location);
  }
  return output.sort();
}

function repository(options = {}) {
  const packageBytes = Buffer.from('synthetic Google Chrome Debian installer\n');
  const filename = options.filename ?? `pool/main/g/google-chrome-stable/google-chrome-stable_${version}_amd64.deb`;
  const packages = [
    'Package: google-chrome-stable', 'Architecture: amd64', `Version: ${version}`,
    `Filename: ${filename}`, `Size: ${packageBytes.length}`, `SHA256: ${sha256(packageBytes)}`, '', '',
  ].join('\n');
  const release = [
    'Origin: Google LLC', 'Label: Google Chrome', 'Suite: stable', 'Codename: stable',
    'Date: Thu, 01 Oct 2026 00:00:00 UTC',
    `Valid-Until: ${options.validUntil ?? 'Thu, 08 Oct 2026 00:00:00 UTC'}`,
    'Architectures: amd64', 'Components: main', 'SHA256:',
    ` ${sha256(packages)} ${Buffer.byteLength(packages)} main/binary-amd64/Packages`, '',
  ].join('\n');
  return {
    packageBytes, filename, packages, release,
    responses: new Map([
      [signingKeyUrl, '-----BEGIN PGP PUBLIC KEY BLOCK-----\nfixture-key\n-----END PGP PUBLIC KEY BLOCK-----\n'],
      [`${repositoryUrl}InRelease`, '-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\nfixture-signature\n'],
      [packagesUrl, options.packagesBytes ?? packages],
      [`https://dl.google.com/linux/chrome/deb/${filename}`, options.downloadedBytes ?? packageBytes],
    ]),
  };
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-opencli-browser-setup-'));
  const downloads = [], commands = [], launches = [], inspections = [], toolLookups = [];
  const repo = repository(options.repository);
  const installer = Buffer.from('synthetic signed Google Chrome MSI\n');
  const setupDirectory = options.prepareDirectory ? await options.prepareDirectory(directory) : directory;
  const manager = new OpenCliBrowserSetup({
    dataDir: setupDirectory, platform: options.platform ?? 'win32', arch: options.arch ?? 'x64',
    now: () => fixtureTime, timeoutMs: options.timeoutMs ?? 1000,
    spawnCommand: options.spawnCommand,
    commandTimeoutMs: options.commandTimeoutMs ?? 15000,
    terminationGraceMs: options.terminationGraceMs ?? 1000,
    exitConfirmationMs: options.exitConfirmationMs ?? 3000,
    inspectChrome: async () => {
      inspections.push(true);
      return options.inspectChrome ? options.inspectChrome() : { installed: false, path: null };
    },
    findTool: async name => {
      toolLookups.push(name);
      return options.findTool ? options.findTool(name) : `/usr/bin/${name}`;
    },
    transport: async (url, settings) => {
      downloads.push({ url: String(url), settings });
      assert.equal(settings.redirect, 'manual'); assert.equal(settings.credentials, 'omit');
      assert.equal(new Headers(settings.headers).get('accept-encoding'), 'identity');
      assert.ok(settings.signal instanceof AbortSignal);
      if (options.transport) return options.transport(String(url), settings, { repo, installer });
      if (String(url) === windowsInstallerUrl) return new Response(installer);
      if (repo.responses.has(String(url))) return new Response(repo.responses.get(String(url)));
      throw new Error(`Unexpected fixture URL: ${url}; real network is forbidden`);
    },
    runCommand: options.nativeCommands ? undefined : async (file, args, settings) => {
      commands.push({ file, args: [...args], settings });
      assert.equal(settings.shell, false); assert.ok(settings.signal instanceof AbortSignal);
      assert.ok(Number.isFinite(settings.timeoutMs) && settings.timeoutMs > 0);
      assert.ok(Number.isFinite(settings.maxOutputBytes) && settings.maxOutputBytes > 0);
      for (const name of ['NODE_OPTIONS', 'OPENAI_API_KEY', 'PETPAL_TOKEN', 'HTTPS_PROXY', 'OPENCLI_PROFILE']) {
        assert.equal(settings.env?.[name], undefined);
      }
      assert.doesNotMatch(String(file), /(?:msiexec|winget|apt-get|sudo|setup\.exe)/i);
      if (options.runCommand) {
        const result = await options.runCommand(file, args, settings, { repo });
        if (result !== undefined) return result;
      }
      if (String(file).toLowerCase().endsWith('powershell.exe')) {
        const action = args[args.indexOf('-Action') + 1];
        assert.ok(['secure-directory', 'verify-installer'].includes(action));
        return { code: 0, stdout: JSON.stringify(action === 'verify-installer' ? { valid: true, publisher: 'Google LLC' } : { secured: true }), stderr: '' };
      }
      if (String(file).endsWith('/gpg')) {
        if (args.includes('--show-keys')) return { code: 0, stdout: `pub:-:4096:1:7721F63BD38B4796:0:0:::\nfpr:::::::::${fingerprint}:\n`, stderr: '' };
        if (args.includes('--dearmor')) return { code: 0, stdout: '', stderr: '' };
      }
      if (String(file).endsWith('/gpgv')) {
        const output = args[args.indexOf('--output') + 1];
        assert.equal(typeof output, 'string'); await writeFile(output, repo.release);
        return { code: 0, stdout: `[GNUPG:] VALIDSIG ${fingerprint} 2026-10-01 1790816322 0 4 0 1 8 01 ${fingerprint}\n`, stderr: '' };
      }
      if (String(file).endsWith('/dpkg-deb')) {
        assert.ok(args.includes('--showformat=${Package}\t${Architecture}\t${Version}\n'));
        return { code: 0, stdout: `google-chrome-stable\tamd64\t${version}\n`, stderr: '' };
      }
      throw new Error(`Unexpected fixture command: ${file}; real processes are forbidden`);
    },
    launchChrome: async (chrome, settings) => {
      launches.push({ chrome, settings });
      assert.ok(settings.signal instanceof AbortSignal);
      if (options.launchChrome) return options.launchChrome(chrome, settings);
    },
  });
  t.after(async () => {
    await manager.close();
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('petpal-opencli-browser-setup-'));
    await rm(resolved, { recursive: true, force: true });
  });
  return { manager, directory, setupDirectory, downloads, commands, launches, inspections, toolLookups, repo, installer };
}

test('setup accepts only one own data property containing one of the three reviewed actions', () => {
  for (const action of ['status', 'install-browser', 'open-extension']) {
    assert.deepEqual(validateOpenCliSetup({ action }), { action });
    assert.deepEqual(validateOpenCliSetup(Object.freeze({ action })), { action });
    assert.deepEqual(validateOpenCliSetup(Object.assign(Object.create(null), { action })), { action });
  }
  let reads = 0;
  const accessor = Object.defineProperty({}, 'action', { enumerable: true, get() { reads++; return 'status'; } });
  const hiddenExtra = Object.defineProperty({ action: 'status' }, 'url', { value: 'https://untrusted.example' });
  const symbolExtra = { action: 'status', [Symbol('command')]: 'launch' };
  for (const value of [undefined, null, [], {}, 'status', true, 1, () => {},
    Object.create({ action: 'status' }), accessor, hiddenExtra, symbolExtra,
    { action: 'status', url: downloadPage }, { action: 'install-browser', path: 'custom.msi' },
    { action: 'open-extension', profile: 'another-account' }, { action: 'status', args: [] },
    { action: '' }, { action: 'install' }, { action: 'shell' }, { action: 1 },
  ]) assert.throws(() => validateOpenCliSetup(value));
  assert.equal(reads, 0, 'argument validation must not execute getters');
});

test('status inspects Chrome without downloading, preparing directories, launching or executing commands', async t => {
  const f = await fixture(t);
  const result = await f.manager.execute({ action: 'status' });
  assert.equal(result.platform, 'win32'); assert.equal(result.arch, 'x64');
  assert.equal(result.supported, true); assert.equal(result.installerSupported, true);
  assert.equal(result.chromeInstalled, false); assert.equal(result.extensionUrl, extensionUrl);
  assert.equal(result.downloadPage, downloadPage); assert.ok(result.message);
  assert.deepEqual(Object.keys(result).sort(), ['arch', 'chromeInstalled', 'downloadPage', 'extensionUrl', 'installerSupported', 'message', 'platform', 'supported']);
  assert.equal(f.inspections.length, 1); assert.deepEqual(f.downloads, []);
  assert.deepEqual(f.commands, []); assert.deepEqual(f.launches, []); assert.deepEqual(await files(f.directory), []);
});

test('invalid setup requests fail before runtime lookup or any side effect', async t => {
  const f = await fixture(t);
  for (const value of [null, {}, { action: 'install-browser', command: 'winget' }, { action: 'open-extension', url: 'https://example.com' }]) {
    await assert.rejects(f.manager.execute(value));
  }
  assert.deepEqual(f.inspections, []); assert.deepEqual(f.toolLookups, []);
  assert.deepEqual(f.downloads, []); assert.deepEqual(f.commands, []); assert.deepEqual(f.launches, []);
});

test('Windows preparation verifies Google Authenticode and returns an installer requiring user action', async t => {
  const f = await fixture(t);
  const result = await f.manager.execute({ action: 'install-browser' });
  assert.equal(result.state, 'prepared'); assert.equal(result.installed, false);
  assert.equal(result.userActionRequired, true); assert.equal(result.sha256, sha256(f.installer));
  assert.deepEqual(await readFile(result.path), f.installer);
  assert.ok(path.relative(f.directory, result.path) && !path.relative(f.directory, result.path).startsWith('..'));
  assert.deepEqual(f.downloads.map(call => call.url), [windowsInstallerUrl]);
  assert.deepEqual(f.commands.map(call => call.args[call.args.indexOf('-Action') + 1]), ['secure-directory', 'verify-installer']);
  assert.deepEqual(f.launches, []);
  for (const call of f.commands) {
    assert.match(call.file, /powershell\.exe$/i); assert.ok(call.args.includes('-File'));
    assert.ok(!call.args.includes('-Command')); assert.ok(!call.args.includes('-EncodedCommand'));
  }
});

test('preparation uses a new private directory without overwriting an earlier verified installer', async t => {
  const f = await fixture(t);
  const first = await f.manager.execute({ action: 'install-browser' });
  const second = await f.manager.execute({ action: 'install-browser' });
  assert.notEqual(first.path, second.path); assert.notEqual(path.dirname(first.path), path.dirname(second.path));
  await f.manager.close();
  assert.deepEqual(await readFile(first.path), f.installer); assert.deepEqual(await readFile(second.path), f.installer);
  assert.deepEqual(f.launches, []);
});

test('already installed Chrome is reported without downloading or preparing another installer', async t => {
  const f = await fixture(t, { inspectChrome: () => ({ installed: true, path: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }) });
  const result = await f.manager.execute({ action: 'install-browser' });
  assert.equal(result.state, 'installed'); assert.equal(result.installed, true);
  assert.equal(result.userActionRequired, false); assert.deepEqual(f.downloads, []);
  assert.deepEqual(f.commands, []); assert.deepEqual(f.launches, []); assert.deepEqual(await files(f.directory), []);
});

test('linked data directories and linked ancestors are rejected before writing outside the setup directory', async t => {
  for (const kind of ['data-directory', 'ancestor', 'internal-directory']) {
    let outside;
    const f = await fixture(t, { prepareDirectory: async root => {
      outside = path.join(root, 'outside'); await mkdir(outside);
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      if (kind === 'data-directory') {
        const link = path.join(root, 'account-data'); await symlink(outside, link, linkType); return link;
      }
      if (kind === 'ancestor') {
        const link = path.join(root, 'ancestor'); await symlink(outside, link, linkType); return path.join(link, 'account-data');
      }
      const data = path.join(root, 'account-data'); await mkdir(data);
      await symlink(outside, path.join(data, 'opencli'), linkType); return data;
    } });
    await assert.rejects(f.manager.execute({ action: 'install-browser' }));
    assert.deepEqual(await readdir(outside), [], `${kind} must not receive files or directories`);
    assert.deepEqual(f.downloads, []); assert.deepEqual(f.commands, []); assert.deepEqual(f.launches, []);
  }
});

test('Windows rejects an invalid signature or non-Google publisher and removes only the new preparation', async t => {
  for (const verification of [{ valid: false, publisher: 'Google LLC' }, { valid: true, publisher: 'Untrusted Vendor' }, { valid: true }, 'not-json']) {
    const f = await fixture(t, { runCommand: async (_file, args) => ({ code: 0, stderr: '', stdout: args.includes('verify-installer') ? (typeof verification === 'string' ? verification : JSON.stringify(verification)) : JSON.stringify({ secured: true }) }) });
    const preserved = path.join(f.directory, 'already-prepared', 'approved.msi');
    await mkdir(path.dirname(preserved)); await writeFile(preserved, 'previous verified payload');
    await assert.rejects(f.manager.execute({ action: 'install-browser' }));
    assert.deepEqual(await files(f.directory), [preserved]); assert.deepEqual(f.launches, []);
  }
});

test('redirected or failed official installer requests are not followed, retried or retained', async t => {
  for (const response of [() => new Response(null, { status: 302, headers: { location: 'https://untrusted.example/chrome.msi' } }), () => new Response('failure', { status: 503 })]) {
    const f = await fixture(t, { transport: response });
    await assert.rejects(f.manager.execute({ action: 'install-browser' }));
    assert.deepEqual(f.downloads.map(call => call.url), [windowsInstallerUrl]);
    assert.ok(f.commands.every(call => !call.args.includes('verify-installer')));
    assert.deepEqual(await files(f.directory), []); assert.deepEqual(f.launches, []);
  }
});

test('every download requests identity encoding, including official redirects and all Linux repository members', async t => {
  const redirectedInstaller = 'https://dl.google.com/dl/chrome/install/googlechrome-identity-fixture.msi';
  // This verifies encoding across two platforms, not the preparation deadline.
  const windows = await fixture(t, { timeoutMs: 10000, transport: async (url, _settings, { installer }) => {
    if (url === windowsInstallerUrl) return new Response(null, { status: 302, headers: { location: redirectedInstaller } });
    assert.equal(url, redirectedInstaller); return new Response(installer);
  } });
  const windowsResult = await windows.manager.execute({ action: 'install-browser' });
  assert.equal(windowsResult.state, 'prepared'); assert.equal(windowsResult.sha256, sha256(windows.installer));
  assert.deepEqual(windows.downloads.map(call => call.url), [windowsInstallerUrl, redirectedInstaller]);
  const linux = await fixture(t, { platform: 'linux', timeoutMs: 10000 });
  const linuxResult = await linux.manager.execute({ action: 'install-browser' });
  assert.equal(linuxResult.state, 'prepared'); assert.equal(linuxResult.sha256, sha256(linux.repo.packageBytes));
  assert.equal(linux.downloads.length, 4);
  for (const call of [...windows.downloads, ...linux.downloads]) assert.equal(new Headers(call.settings.headers).get('accept-encoding'), 'identity');
});

test('a server that still returns gzip fails explicitly instead of ignoring compressed length or retaining an installer', async t => {
  const f = await fixture(t, { transport: async (_url, _settings, { installer }) => new Response(installer, {
    // Simulate Node fetch exposing decoded bytes while the response still
    // reports the encoding and shorter on-wire Content-Length.
    headers: { 'content-encoding': 'gzip', 'content-length': String(Math.floor(installer.length / 2)) },
  }) });
  await assert.rejects(f.manager.execute({ action: 'install-browser' }), /原始安装包字节/);
  assert.equal(f.downloads.length, 1); assert.ok(f.commands.every(call => !call.args.includes('verify-installer')));
  assert.deepEqual(await files(f.directory), []); assert.deepEqual(f.launches, []);
});

test('an oversized declared installer is rejected before its untrusted bytes are retained', async t => {
  const f = await fixture(t, { transport: () => new Response('fixture', { headers: { 'content-length': '999999999999' } }) });
  await assert.rejects(f.manager.execute({ action: 'install-browser' }));
  assert.deepEqual(await files(f.directory), []); assert.deepEqual(f.launches, []);
});

test('native verifier failure or excessive output is rejected without a prepared installer', async t => {
  for (const output of [{ code: 1, stdout: JSON.stringify({ valid: true, publisher: 'Google LLC' }), stderr: '' },
    { code: 0, stdout: 'x'.repeat(65537), stderr: '' },
  ]) {
    const f = await fixture(t, { runCommand: async (_file, args) => args.includes('verify-installer') ? output : undefined });
    await assert.rejects(f.manager.execute({ action: 'install-browser' }));
    assert.equal(f.downloads.length, 1); assert.deepEqual(await files(f.directory), []); assert.deepEqual(f.launches, []);
  }
});

test('native commands do not inherit Node injection, provider keys, session tokens or credentialed proxies', async t => {
  const poisoned = { NODE_OPTIONS: '--require untrusted-fixture.js', OPENAI_API_KEY: 'synthetic-provider-key', PETPAL_TOKEN: 'synthetic-session-token', HTTPS_PROXY: 'http://fixture-user:fixture-password@proxy.invalid', OPENCLI_PROFILE: 'untrusted-profile' };
  const previous = new Map(Object.keys(poisoned).map(name => [name, process.env[name]]));
  t.after(() => { for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  Object.assign(process.env, poisoned);
  const f = await fixture(t); await f.manager.execute({ action: 'install-browser' });
  assert.ok(f.commands.length > 0);
  for (const call of f.commands) assert.ok(!Object.values(call.settings.env).some(value => Object.values(poisoned).includes(value)));
});

test('unsupported systems and Linux without native verification tools return manual guidance without downloads', async t => {
  for (const options of [{ platform: 'darwin', arch: 'arm64' }, { platform: 'win32', arch: 'arm64' },
    { platform: 'linux', arch: 'ia32' },
    ...['gpg', 'gpgv', 'dpkg-deb'].map(missing => ({ platform: 'linux', arch: 'x64', findTool: name => name === missing ? null : `/usr/bin/${name}` })),
  ]) {
    const f = await fixture(t, options);
    const result = await f.manager.execute({ action: 'install-browser' });
    assert.equal(result.state, 'manual'); assert.equal(result.installed, false);
    assert.equal(result.userActionRequired, true); assert.equal(result.downloadPage, downloadPage);
    assert.deepEqual(f.downloads, []); assert.deepEqual(f.commands, []); assert.deepEqual(f.launches, []);
    assert.deepEqual(await files(f.directory), []);
  }
});

test('Linux verifies a pinned Google signing key, signed Release, index digest, package digest and package identity', async t => {
  const f = await fixture(t, { platform: 'linux' });
  const result = await f.manager.execute({ action: 'install-browser' });
  assert.equal(result.state, 'prepared'); assert.equal(result.installed, false);
  assert.equal(result.userActionRequired, true); assert.equal(result.sha256, sha256(f.repo.packageBytes));
  assert.deepEqual(await readFile(result.path), f.repo.packageBytes);
  assert.deepEqual(f.downloads.map(call => call.url), [signingKeyUrl, `${repositoryUrl}InRelease`, packagesUrl, `https://dl.google.com/linux/chrome/deb/${f.repo.filename}`]);
  assert.deepEqual(f.toolLookups.sort(), ['dpkg-deb', 'gpg', 'gpgv']);
  assert.ok(f.commands.some(call => call.file.endsWith('/gpg') && call.args.includes('--show-keys')));
  assert.ok(f.commands.some(call => call.file.endsWith('/gpgv') && call.args.includes('--status-fd')));
  assert.ok(f.commands.some(call => call.file.endsWith('/dpkg-deb')));
  assert.deepEqual(f.launches, []);
  if (process.platform !== 'win32') assert.equal((await stat(path.dirname(result.path))).mode & 0o777, 0o700);
});

test('Linux rejects an unpinned key before downloading a repository or installer', async t => {
  const f = await fixture(t, { platform: 'linux', runCommand: async () => ({ code: 0, stderr: '', stdout: 'pub:-:4096:1:BAD:0:0:::\nfpr:::::::::0000000000000000000000000000000000000000:\n' }) });
  await assert.rejects(f.manager.execute({ action: 'install-browser' }));
  assert.deepEqual(f.downloads.map(call => call.url), [signingKeyUrl]);
  assert.deepEqual(await files(f.directory), []); assert.deepEqual(f.launches, []);
});

test('Linux allows the official key bundle containing an older primary key and exactly one pinned primary', async t => {
  const oldFingerprint = '4CCA1EAF950CEE4AB83976DCA040830F7FAC5991';
  const f = await fixture(t, { platform: 'linux', runCommand: async (file, args) => {
    if (!file.endsWith('/gpg') || !args.includes('--show-keys')) return undefined;
    return { code: 0, stderr: '', stdout: [
      'pub:-:1024:17:A040830F7FAC5991:0:0:::', `fpr:::::::::${oldFingerprint}:`,
      'pub:-:4096:1:7721F63BD38B4796:0:0:::', `fpr:::::::::${fingerprint}:`, '',
    ].join('\n') };
  } });
  const result = await f.manager.execute({ action: 'install-browser' });
  assert.equal(result.state, 'prepared'); assert.deepEqual(await readFile(result.path), f.repo.packageBytes);
  assert.equal(f.downloads.length, 4); assert.deepEqual(f.launches, []);
});

test('Linux rejects official key bundles with no pinned primary or a duplicate pinned primary', async t => {
  for (const fingerprints of [['4CCA1EAF950CEE4AB83976DCA040830F7FAC5991'], [fingerprint, fingerprint]]) {
    const f = await fixture(t, { platform: 'linux', runCommand: async (file, args) => {
      if (!file.endsWith('/gpg') || !args.includes('--show-keys')) return undefined;
      return { code: 0, stderr: '', stdout: fingerprints.map(value => `pub:-:4096:1:FIXTURE:0:0:::\nfpr:::::::::${value}:\n`).join('') };
    } });
    await assert.rejects(f.manager.execute({ action: 'install-browser' }));
    assert.deepEqual(f.downloads.map(call => call.url), [signingKeyUrl]);
    assert.deepEqual(await files(f.directory), []); assert.deepEqual(f.launches, []);
  }
});

test('Linux rejects an unsigned Release even when a verifier exits successfully', async t => {
  const f = await fixture(t, { platform: 'linux', runCommand: async (file, args, _settings, { repo }) => {
    if (file.endsWith('/gpg')) return { code: 0, stderr: '', stdout: args.includes('--show-keys') ? `pub:-:4096:1:7721F63BD38B4796:0:0:::\nfpr:::::::::${fingerprint}:\n` : '' };
    if (file.endsWith('/gpgv')) { await writeFile(args[args.indexOf('--output') + 1], repo.release); return { code: 0, stderr: '', stdout: '[GNUPG:] GOODSIG unpinned signer\n' }; }
    throw new Error('must reject before inspecting package');
  } });
  await assert.rejects(f.manager.execute({ action: 'install-browser' }));
  assert.deepEqual(f.downloads.map(call => call.url), [signingKeyUrl, `${repositoryUrl}InRelease`]);
  assert.deepEqual(await files(f.directory), []);
});

test('Linux rejects signatures from another primary key or a weak digest before reading Packages', async t => {
  for (const signature of [`[GNUPG:] VALIDSIG ${'0'.repeat(40)} 2026-10-01 1790816322 0 4 0 1 8 01 ${'0'.repeat(40)}\n`,
    `[GNUPG:] VALIDSIG ${fingerprint} 2026-10-01 1790816322 0 4 0 1 2 01 ${fingerprint}\n`,
  ]) {
    const f = await fixture(t, { platform: 'linux', runCommand: async (file, args, _settings, { repo }) => {
      if (!file.endsWith('/gpgv')) return undefined;
      await writeFile(args[args.indexOf('--output') + 1], repo.release);
      return { code: 0, stderr: '', stdout: signature };
    } });
    await assert.rejects(f.manager.execute({ action: 'install-browser' }));
    assert.deepEqual(f.downloads.map(call => call.url), [signingKeyUrl, `${repositoryUrl}InRelease`]);
    assert.deepEqual(await files(f.directory), []);
  }
});

test('Linux rejects expired signed repository metadata before downloading Packages', async t => {
  const f = await fixture(t, { platform: 'linux', repository: { validUntil: 'Wed, 30 Sep 2026 00:00:00 UTC' } });
  await assert.rejects(f.manager.execute({ action: 'install-browser' }));
  assert.deepEqual(f.downloads.map(call => call.url), [signingKeyUrl, `${repositoryUrl}InRelease`]);
  assert.deepEqual(await files(f.directory), []);
});

test('Linux rejects mismatched signed index or installer bytes without running package metadata inspection', async t => {
  for (const repositoryOptions of [{ packagesBytes: 'untrusted changed index\n' }, { downloadedBytes: Buffer.from('altered installer bytes\n') }]) {
    const f = await fixture(t, { platform: 'linux', repository: repositoryOptions });
    await assert.rejects(f.manager.execute({ action: 'install-browser' }));
    assert.ok(!f.commands.some(call => call.file.endsWith('/dpkg-deb')));
    assert.deepEqual(await files(f.directory), []); assert.deepEqual(f.launches, []);
  }
});

test('Linux signed package records cannot redirect the download through traversal, another host or an arbitrary package', async t => {
  for (const filename of ['../../chrome.deb', 'https://untrusted.example/chrome.deb', 'pool/main/g/google-chrome-stable/../../chrome.deb', 'pool/main/e/evil/evil_1_amd64.deb']) {
    const f = await fixture(t, { platform: 'linux', repository: { filename } });
    await assert.rejects(f.manager.execute({ action: 'install-browser' }));
    assert.ok(f.downloads.every(call => [signingKeyUrl, `${repositoryUrl}InRelease`, packagesUrl].includes(call.url)));
    assert.deepEqual(await files(f.directory), []); assert.deepEqual(f.launches, []);
  }
});

test('Linux rejects DEB internals that do not match the signed package, architecture and version', async t => {
  for (const metadata of [`untrusted-browser\tamd64\t${version}\n`, `google-chrome-stable\tarm64\t${version}\n`, 'google-chrome-stable\tamd64\t1.0-1\n']) {
    const f = await fixture(t, { platform: 'linux', runCommand: async file => file.endsWith('/dpkg-deb') ? { code: 0, stderr: '', stdout: metadata } : undefined });
    await assert.rejects(f.manager.execute({ action: 'install-browser' }));
    assert.equal(f.downloads.length, 4); assert.deepEqual(await files(f.directory), []); assert.deepEqual(f.launches, []);
  }
});

test('extension opening requires installed Chrome and reports only the reviewed Web Store URL', async t => {
  const absent = await fixture(t);
  await assert.rejects(absent.manager.execute({ action: 'open-extension' }));
  assert.deepEqual(absent.launches, []); assert.deepEqual(absent.downloads, []); assert.deepEqual(absent.commands, []);
  const installed = await fixture(t, { inspectChrome: () => ({ installed: true, path: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }) });
  const result = await installed.manager.execute({ action: 'open-extension' });
  assert.equal(result.state, 'opened'); assert.equal(result.userActionRequired, true);
  assert.equal(result.extensionUrl, extensionUrl); assert.equal(installed.launches.length, 1);
  assert.equal(installed.launches[0].chrome.path, 'C:/Program Files/Google/Chrome/Application/chrome.exe');
  assert.deepEqual(Object.keys(installed.launches[0].chrome).sort(), ['installed', 'path']);
  assert.equal(installed.launches[0].settings.url, extensionUrl);
  assert.deepEqual(installed.downloads, []); assert.deepEqual(installed.commands, []);
});

test('pre-aborted setup cannot prepare, launch or inspect runtime', async t => {
  const f = await fixture(t); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.manager.execute({ action: 'install-browser' }, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(f.inspections, []); assert.deepEqual(f.downloads, []); assert.deepEqual(f.commands, []);
  assert.deepEqual(f.launches, []); assert.deepEqual(await files(f.directory), []);
});

test('caller cancellation aborts the active download and deletes its incomplete directory', async t => {
  const entered = deferred(); let capturedSignal;
  const f = await fixture(t, { transport: async (_url, { signal }) => { capturedSignal = signal; entered.resolve(); return abortedPromise(signal); } });
  const preserved = path.join(f.directory, 'previous-install.msi'); await writeFile(preserved, 'previous');
  const controller = new AbortController();
  const pending = f.manager.execute({ action: 'install-browser' }, { signal: controller.signal });
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise; controller.abort(); await cancelled;
  assert.equal(capturedSignal.aborted, true); assert.equal(f.downloads.length, 1);
  assert.deepEqual(await files(f.directory), [preserved]); assert.deepEqual(f.launches, []);
});

test('the preparation deadline cancels the active download without retrying or retaining partial files', async t => {
  let capturedSignal;
  const f = await fixture(t, { timeoutMs: 25, transport: async (_url, { signal }) => { capturedSignal = signal; return abortedPromise(signal); } });
  await assert.rejects(f.manager.execute({ action: 'install-browser' }), { name: 'AbortError' });
  assert.equal(capturedSignal.aborted, true); assert.equal(f.downloads.length, 1);
  assert.deepEqual(await files(f.directory), []); assert.deepEqual(f.launches, []);
});

test('concurrent preparation is rejected without starting a second download', async t => {
  const entered = deferred();
  const f = await fixture(t, { transport: async (_url, { signal }) => { entered.resolve(); return abortedPromise(signal); } });
  const controller = new AbortController();
  const pending = f.manager.execute({ action: 'install-browser' }, { signal: controller.signal });
  const cancelled = assert.rejects(pending, { name: 'AbortError' }); await entered.promise;
  await assert.rejects(f.manager.execute({ action: 'install-browser' }));
  await assert.rejects(f.manager.execute({ action: 'open-extension' }));
  assert.equal(f.downloads.length, 1); assert.deepEqual(f.launches, []);
  controller.abort(); await cancelled; assert.deepEqual(await files(f.directory), []);
});

test('closing aborts an active preparation while preserving all previously prepared files', async t => {
  const entered = deferred(); let capturedSignal, hold = false;
  const f = await fixture(t, { transport: async (_url, { signal }, { installer }) => {
    if (!hold) return new Response(installer);
    capturedSignal = signal; entered.resolve(); return abortedPromise(signal);
  } });
  const prepared = await f.manager.execute({ action: 'install-browser' });
  const previous = await files(f.directory); hold = true;
  const pending = f.manager.execute({ action: 'install-browser' });
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise; await f.manager.close(); await cancelled;
  assert.equal(capturedSignal.aborted, true); assert.deepEqual(await files(f.directory), previous);
  assert.deepEqual(await readFile(prepared.path), f.installer);
});

test('close waits for the cancelled operation to finish cleanup before resolving', async t => {
  const entered = deferred(), aborted = deferred(), release = deferred();
  const f = await fixture(t, { transport: async (_url, { signal }) => {
    entered.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    aborted.resolve(); await release.promise; throw abortError();
  } });
  const pending = f.manager.execute({ action: 'install-browser' });
  const cancelled = assert.rejects(pending, { name: 'AbortError' }); await entered.promise;
  let retired = false; const closing = f.manager.close().then(() => { retired = true; });
  try {
    await aborted.promise; await new Promise(resolve => setImmediate(resolve));
    assert.equal(retired, false, 'close must retain ownership while download cancellation is still pending');
  } finally { release.resolve(); await closing; await cancelled; }
  assert.equal(retired, true); assert.deepEqual(await files(f.directory), []);
});

test('a native command timeout sends TERM then KILL and retains ownership until child exit is confirmed', async t => {
  const entered = deferred(), children = [];
  const f = await fixture(t, {
    nativeCommands: true, commandTimeoutMs: 15, terminationGraceMs: 5, exitConfirmationMs: 1000,
    spawnCommand: (file, args, settings) => {
      assert.match(file, /powershell\.exe$/i); assert.equal(settings.shell, false);
      assert.deepEqual(settings.stdio, ['ignore', 'pipe', 'pipe']); assert.ok(args.includes('secure-directory'));
      const child = childFixture(); children.push(child); entered.resolve(child); return child;
    },
  });
  let settled = false;
  const pending = f.manager.execute({ action: 'install-browser' }).finally(() => { settled = true; });
  const failed = assert.rejects(pending, /超时/); const child = await entered.promise;
  try {
    await killed(child, 'SIGKILL');
    assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']); assert.equal(settled, false);
    await assert.rejects(f.manager.execute({ action: 'install-browser' }));
    assert.equal(children.length, 1); assert.deepEqual(f.downloads, []);
  } finally { child.finish(1); await failed; }
  assert.equal(settled, true); assert.equal(f.manager.unconfirmedProcess, false);
  assert.deepEqual(await files(f.directory), []);
});

test('unconfirmed native process exit blocks every later preparation instead of retrying or overlapping', async t => {
  const entered = deferred(), children = [];
  const f = await fixture(t, {
    nativeCommands: true, commandTimeoutMs: 10, terminationGraceMs: 5, exitConfirmationMs: 30,
    spawnCommand: () => { const child = childFixture(); children.push(child); entered.resolve(child); return child; },
  });
  const pending = f.manager.execute({ action: 'install-browser' });
  const failed = assert.rejects(pending, error => error.processStillRunning === true);
  const child = await entered.promise; await failed;
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']); assert.equal(child.unreferenced, true);
  assert.equal(child.stdout.destroyed, true); assert.equal(child.stderr.destroyed, true);
  for (const action of ['install-browser', 'open-extension', 'install-browser']) await assert.rejects(f.manager.execute({ action }));
  assert.equal((await f.manager.status()).installerSupported, false); assert.equal(children.length, 1);
  child.finish(1);
  await assert.rejects(f.manager.execute({ action: 'install-browser' }));
  assert.equal(children.length, 1); assert.deepEqual(f.downloads, []); assert.deepEqual(f.launches, []);
});
