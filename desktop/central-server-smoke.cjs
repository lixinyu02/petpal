'use strict';

// Opt-in isolated Electron acceptance; no upstream models or user profiles.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

module.exports = async function centralServerSmoke({ backend, centralServer, origin, mainWindow,
  loginSmokeMain, clickSmokeButton, directory, restore = false }) {
  if (!process.argv.includes('--smoke-test') || !process.env.PETPAL_SMOKE_PROFILE || !directory)
    throw new Error('Central smoke requires an explicit isolated profile and output directory');
  await fs.mkdir(directory, { recursive: true });
  await loginSmokeMain();
  const initial = await centralServer.status();
  assert.equal(initial.supported, true);
  assert.equal(initial.enabled, restore);
  assert.equal(initial.listening, restore);
  const nodeApi = async (base, suffix, token, options = {}) => {
    const response = await fetch(`${base}/api${suffix}`, { ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
      signal: AbortSignal.timeout(15000) });
    const value = await response.json();
    return { status: response.status, value };
  };
  const until = expression => mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
    const deadline=Date.now()+15000;const check=()=>{try{if(${expression})return resolve(true);}catch{}
    if(Date.now()>deadline)return reject(new Error('Central settings UI did not settle'));setTimeout(check,40);};check();})`);
  const openSettings = async () => {
    await mainWindow.loadURL(`${origin}/?chat=1&settings=1`);
    await until(`[...document.querySelectorAll('.settings-tabs button')].some(b=>b.textContent.trim()==='设备连接')`);
    await clickSmokeButton('.settings-tabs', '设备连接');
    await until(`!!document.querySelector('.central-server-state')&&!document.querySelector('.central-server-settings[aria-busy="true"]')`);
  };
  const fill = async (label, value) => {
    await mainWindow.webContents.executeJavaScript(`(()=>{const input=document.querySelector('.central-server-settings input[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');
      if(!input||input.disabled)throw new Error('Central form input unavailable');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  };
  const enabled = async next => {
    await mainWindow.webContents.executeJavaScript(`(()=>{const input=document.querySelector('.central-server-settings input[aria-label="启用中央服务器"]');
      if(!input||input.disabled)throw new Error('Central switch unavailable');if(input.checked!==${JSON.stringify(next)})input.click();})()`);
  };
  const save = () => clickSmokeButton('.central-server-form', '保存服务设置');
  const listeningUi = () => until(`!!document.querySelector('.central-server-state.is-listening')&&!document.querySelector('.central-server-settings[aria-busy="true"]')`);
  const bridgeStatus = () => mainWindow.webContents.executeJavaScript('window.petpal.centralServer.status()');
  const capture = async name => fs.writeFile(path.join(directory, name), (await mainWindow.webContents.capturePage()).toPNG());
  await openSettings();
  if (restore) {
    const restored = await bridgeStatus();
    assert.equal(restored.listening, true);
    const response = await fetch(`http://127.0.0.1:${restored.port}/api/health`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    await capture('restored-desktop.png');
    await enabled(false); await save();
    await until(`!!document.querySelector('.central-server-state')&&!document.querySelector('.central-server-state.is-listening')&&!document.querySelector('.central-server-settings[aria-busy="true"]')`);
    assert.equal((await bridgeStatus()).enabled, false);
    assert.equal((await nodeApi(origin, '/auth/me', backend.token)).status, 200);
    await assert.rejects(fetch(`http://127.0.0.1:${restored.port}/api/health`, { signal: AbortSignal.timeout(1500) }));
    const receipt = { phase: 'restore-and-disable', startupRestored: true, listeningBeforeLogin: initial.listening,
      samePort: initial.port === restored.port, actualUiDisabled: true, loopbackSurvived: true, port: restored.port };
    await fs.writeFile(path.join(directory, 'restore.json'), JSON.stringify(receipt, null, 2));
    return receipt;
  }
  assert.equal(initial.ownerHasPassword, false);
  const gate = await mainWindow.webContents.executeJavaScript(`({ passwordRequired:!!document.querySelector('.central-server-password'),
    enableDisabled:document.querySelector('.central-server-toggle input')?.disabled===true })`);
  assert.equal(gate.passwordRequired && gate.enableDisabled, true);
  await capture('password-required.png');
  const fixturePassword = crypto.randomBytes(24).toString('base64url');
  const ownerId = backend.hosting.assertOwnerSession(backend.token).userId;
  const passwordSaved = await nodeApi(origin, `/admin/users/${ownerId}`, backend.token,
    { method: 'PATCH', body: JSON.stringify({ password: fixturePassword }) });
  assert.equal(passwordSaved.status, 200);
  await clickSmokeButton('.central-server-settings', '重新读取');
  await until(`!!document.querySelector('.central-server-toggle input')&&!document.querySelector('.central-server-toggle input').disabled&&!document.querySelector('.central-server-settings[aria-busy="true"]')`);
  const reserve = async () => {
    const server = http.createServer((_req, res) => res.end('fixture'));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', resolve); });
    return server;
  };
  let allocated = await reserve(), selectedPort = allocated.address().port;
  await new Promise(resolve => allocated.close(resolve));
  if (selectedPort < 1024 || [6000,6566,6665,6666,6667,6668,6669,6697,10080].includes(selectedPort)) throw new Error('Fixture selected restricted port');
  await fill('局域网端口', String(selectedPort)); await enabled(true); await save(); await listeningUi();
  const running = await bridgeStatus(); assert.equal(running.port, selectedPort); assert.equal(running.listening, true);
  const lan = `http://127.0.0.1:${selectedPort}`;
  assert.equal((await nodeApi(lan, '/state', '')).status, 401);
  assert.equal((await nodeApi(lan, '/state', backend.token)).status, 403);
  const loggedIn = await nodeApi(lan, '/auth/login', '', { method: 'POST', body: JSON.stringify({ username: 'owner', password: fixturePassword }) });
  assert.equal(loggedIn.status, 200);
  const remoteState = await nodeApi(lan, '/state', loggedIn.value.token);
  assert.equal(remoteState.status, 200); assert.equal(remoteState.value.instanceId, backend.hosting.status().instanceId);
  allocated = await reserve();
  try {
    await fill('局域网端口', String(allocated.address().port)); await save();
    await until(`document.querySelector('.central-server-settings .form-error')?.textContent.includes('端口已被占用')`);
    assert.equal((await bridgeStatus()).port, selectedPort);
    assert.equal((await fetch(`${lan}/api/health`)).status, 200);
    await capture('port-conflict.png');
  } finally { await new Promise(resolve => allocated.close(resolve)); }
  await clickSmokeButton('.central-server-settings', '重新读取'); await listeningUi();
  await fill('HTTPS 访问地址（可选）', 'https://petpal-smoke.example:44318'); await save(); await listeningUi();
  const policyChanged = await bridgeStatus(); assert.equal(policyChanged.port, selectedPort);
  assert.equal(policyChanged.publicUrl, 'https://petpal-smoke.example:44318');
  await capture('central-desktop.png');
  let mobile;
  mainWindow.webContents.debugger.attach('1.3');
  try {
    await mainWindow.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 412, height: 960, deviceScaleFactor: 1, mobile: true });
    await until(`innerWidth===412&&innerHeight===960`);
    await mainWindow.webContents.executeJavaScript(`document.querySelector('.central-server-settings').scrollIntoView({block:'start'})`);
    mobile = await mainWindow.webContents.executeJavaScript(`({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
      urlRows:document.querySelectorAll('.central-server-access li').length,displayedPort:document.querySelector('.central-server-fields input')?.value})`);
    assert.equal(mobile.scrollWidth <= mobile.width, true); assert.equal(mobile.displayedPort, String(selectedPort));
    await capture('central-mobile.png');
  } finally { await mainWindow.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride'); mainWindow.webContents.debugger.detach(); }
  const receipt = { phase: 'configure', passwordGate: gate, nativeBridge: true, actualUiSaved: true,
    unauthenticatedRejected: true, bootstrapRejected: true, passwordLogin: true, sameInstance: true,
    portConflictRolledBack: true, hotPublicOriginChange: true, originUnchanged: await mainWindow.webContents.executeJavaScript('location.origin') === origin,
    mobile, port: selectedPort, savedForStartupRestore: true, upstreamModelCalled: false };
  await fs.writeFile(path.join(directory, 'configure.json'), JSON.stringify(receipt, null, 2));
  return receipt;
};
