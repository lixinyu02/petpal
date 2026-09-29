const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, session, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { canRequestMedia, canCheckMedia } = require('./media-permissions.cjs');
const { readDesktopServiceSettings } = require('./service-settings.cjs');
const { createDesktopRemoteHttp, isPetPalReleaseUrl } = require('./remote-http.cjs');
const { spawn } = require('node:child_process');

let mainWindow, petWindow, mainLoaded, petLoaded, tray, backend, origin, quitting = false, exitCode = 0;
let updates, pendingUpdate, verifyDownloadedUpdate, remoteHttp, executor;
const root = path.resolve(__dirname, '..');
const iconPath = path.join(__dirname, 'assets', 'icon.png');
if (process.argv.includes('--smoke-test') && process.env.PETPAL_SMOKE_PROFILE) {
  const profile = path.resolve(process.env.PETPAL_SMOKE_PROFILE);
  fsSync.mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
}

function isTrusted(event) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (owner !== mainWindow && owner !== petWindow) return false;
  try { return new URL(event.senderFrame.url).origin === origin && event.senderFrame === event.sender.mainFrame; }
  catch { return false; }
}

async function requireUpdateOwner(event, token) {
  if (!isTrusted(event) || event.sender !== mainWindow?.webContents) throw new Error('更新仅允许主窗口');
  if (typeof token !== 'string' || !token || token.length > 8192) throw new Error('请先登录本机管理员账号');
  backend.updates.assertOwnerSession(token, { allowClosing: quitting && Boolean(pendingUpdate) });
  const current = await event.sender.executeJavaScript(`(() => { try { return JSON.parse(sessionStorage.getItem('petpal.connection') || 'null')?.token || ''; } catch { return ''; } })()`);
  if (!isTrusted(event) || typeof current !== 'string') throw new Error('更新账号已变化');
  const left = Buffer.from(token), right = Buffer.from(current);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error('更新账号已变化');
  backend.updates.assertOwnerSession(token, { allowClosing: quitting && Boolean(pendingUpdate) });
}

async function launchPreparedUpdate(prepared) {
  await verifyDownloadedUpdate(prepared.file, prepared.release, { directory: prepared.directory, signal: prepared.signal });
  await prepared.authorize();
  prepared.signal.throwIfAborted();
  const config = backend.updates.statusConfig();
  if (!config.configured || config.revision !== prepared.release.revision || config.repository !== prepared.release.repository) throw new Error('更新源已变化，请重新检查');
  // The old backend is already closed. The new portable keeps the same app ID,
  // so release our lock before launch; neither old executable nor user data is replaced.
  app.releaseSingleInstanceLock();
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:ELECTRON_RUN_AS_NODE|PORTABLE_EXECUTABLE_|PETPAL_SMOKE_)/.test(key)) delete env[key];
  await new Promise((resolve, reject) => {
    const child = spawn(prepared.file, [], { detached: true, stdio: 'ignore', shell: false, windowsHide: false, env });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function queuePortableUpdate(prepared) {
  if (pendingUpdate || quitting) throw new Error('更新交接已开始');
  pendingUpdate = prepared;
  // Finish IPC before shutdown waits on the manager, and allow an intervening
  // cancellation/logout to revoke the queued quit without closing the app.
  setImmediate(() => {
    if (pendingUpdate !== prepared) return;
    if (prepared.signal.aborted) { pendingUpdate = null; return; }
    app.quit();
  });
}

function secureWindow(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    const helpLinks = new Set(['https://github.com/jackwener/opencli', 'https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk']);
    if (win === mainWindow && (helpLinks.has(url) || isPetPalReleaseUrl(url))) void shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    try { if (new URL(target).origin !== origin) { event.preventDefault(); if (win === mainWindow && isPetPalReleaseUrl(target)) void shell.openExternal(target).catch(() => {}); } }
    catch { event.preventDefault(); }
  });
}

function createMain() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 800, minWidth: 760, minHeight: 540,
    title: '小伴 PetPal', icon: iconPath, backgroundColor: '#f7f6f2', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  secureWindow(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', event => {
    remoteHttp?.cancelOwner(mainWindow.webContents);
    if (!quitting && tray) { event.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('render-process-gone', () => { void executor?.disconnect().catch(() => {}); });
  mainWindow.webContents.on('destroyed', () => { void executor?.disconnect().catch(() => {}); });
  mainLoaded = mainWindow.loadURL(origin);
}

function showMain() {
  if (!mainWindow) createMain();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}

function showPet() {
  if (!petWindow) {
    const area = screen.getPrimaryDisplay().workArea;
    petWindow = new BrowserWindow({
      width: 300, height: 340, x: area.x + area.width - 320, y: area.y + area.height - 360,
      frame: false, transparent: true, resizable: false, hasShadow: false, alwaysOnTop: true,
      skipTaskbar: true, show: false, title: '小伴桌宠', icon: iconPath,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // Windows requires pop-up-menu to retain the native WS_EX_TOPMOST flag.
    petWindow.setAlwaysOnTop(true, process.platform === 'win32' ? 'pop-up-menu' : 'floating');
    if (process.platform !== 'win32') petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    secureWindow(petWindow);
    petWindow.once('ready-to-show', () => petWindow?.showInactive());
    petWindow.on('closed', () => { petWindow = null; });
    petLoaded = petWindow.loadURL(`${origin}/?pet=1`);
  } else petWindow.showInactive();
}

async function inspectAvatarWindow(win, requireWorld, kind) {
  return win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 25000;
    const check = () => {
      const canvases = document.querySelectorAll('canvas[data-renderer="webgl"]');
      const canvas = canvases[0];
      const ready = ${requireWorld ? `!!document.querySelector('.companion-world[data-ready="true"][data-companion-kind="${kind}"]')` : 'true'};
      const expectedRenderer = ${JSON.stringify(kind)} === 'anime' ? canvas?.dataset.avatarRenderer === 'mesh2d' : canvas?.dataset.avatarRenderer !== 'mesh2d';
      if (ready && expectedRenderer && canvases.length === 1 && canvas.dataset.petCount === '1' && Number(canvas.dataset.renderFrames) >= 2) {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (gl && !gl.isContextLost()) return resolve({
          is3d: ${JSON.stringify(kind)} === 'cat', kind: ${JSON.stringify(kind)}, renderer: canvas.dataset.avatarRenderer || 'three3d', petCount: 1, canvasCount: canvases.length,
          renderFrames: Number(canvas.dataset.renderFrames), glVersion: gl.getParameter(gl.VERSION),
          petAction: canvas.dataset.petAction || 'unknown',
          width: canvas.width, height: canvas.height, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          storedKind: localStorage.getItem('petpal.companionKind'), blink: canvas.dataset.blink, speaking: canvas.dataset.speaking,
          expression: canvas.dataset.expression, mouthShape: canvas.dataset.mouthShape, mouthOpen: canvas.dataset.mouthOpen,
          phase: canvas.dataset.phase, speechSource: canvas.dataset.speechSource
        });
      }
      if (Date.now() >= deadline) reject(new Error('One live WebGL ${kind} avatar did not become ready'));
      else setTimeout(check, 50);
    };
    check();
  })`);
}

async function loginSmokeMain() {
  const guest = await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const check = () => {
      if (document.querySelector('.companion-world,.app-shell,.workspace,.companion-voice,.speech-controls')) return reject(new Error('Fresh desktop mounted protected content before login'));
      const login = document.querySelector('.login-page'), button = document.querySelector('button.auth-owner');
      if (login && button && !button.disabled) {
        let saved; try { saved = JSON.parse(sessionStorage.getItem('petpal.connection') || 'null'); } catch {}
        if (saved?.token) return reject(new Error('Fresh desktop silently accepted an owner token'));
        return resolve({ loginVisible: true, protectedContentAbsent: true, noStoredToken: true });
      }
      if (Date.now() >= deadline) return reject(new Error('Fresh desktop login gate did not appear'));
      setTimeout(check, 40);
    }; check();
  })`);
  if (process.env.PETPAL_SMOKE_DIR) {
    await fs.mkdir(process.env.PETPAL_SMOKE_DIR, { recursive: true });
    await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'login.png'), (await mainWindow.webContents.capturePage()).toPNG());
  }
  await clickSmokeButton('.login-form', '以本机管理员身份登录');
  const authenticated = await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const check = async () => {
      if (document.querySelector('.companion-world')) {
        try {
          const saved = JSON.parse(sessionStorage.getItem('petpal.connection') || 'null');
          const response = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + (saved?.token || '') } });
          const value = await response.json();
          if (!response.ok || !value.instanceId || !value.user?.isOwner) throw new Error('Explicit desktop login did not authenticate the owner');
          return resolve({ explicitOwnerLogin: true, authenticated: true });
        } catch (error) { return reject(error); }
      }
      if (Date.now() >= deadline) return reject(new Error('Explicit desktop owner login timed out'));
      setTimeout(check, 40);
    }; check();
  })`);
  return { ...guest, ...authenticated };
}

async function clickSmokeButton(container, label) {
  return mainWindow.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(container + ' button')})].find(item => item.textContent.trim() === ${JSON.stringify(label)});
    if (!button || button.disabled) throw new Error('Smoke interaction is unavailable');
    button.click();
  })()`);
}

async function waitForPose(action) {
  return mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 25000;
    let since = 0;
    const check = () => {
      const canvas = document.querySelector('canvas[data-renderer="webgl"]');
      if (canvas?.dataset.petAction === ${JSON.stringify(action)}) {
        since ||= Date.now();
        if (Date.now() - since >= 700) return resolve({ action: canvas.dataset.petAction, renderFrames: Number(canvas.dataset.renderFrames), x: canvas.dataset.petX, blink: canvas.dataset.blink, speaking: canvas.dataset.speaking });
      } else since = 0;
      if (Date.now() >= deadline) reject(new Error('Expected review pose did not appear'));
      else setTimeout(check, 40);
    };
    check();
  })`);
}

async function inspectSystemSpeech(win) {
  // Real browser events only: no synthetic onstart/onboundary/onend callbacks.
  return win.webContents.executeJavaScript(`(async () => {
    const result = { supported: 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function', voices: [], events: [], audioAudibilityVerified: false };
    if (!result.supported) return { ...result, outcome: 'unsupported' };
    if (!speechSynthesis.getVoices().length) await new Promise(resolve => {
      const done = () => { speechSynthesis.removeEventListener('voiceschanged', done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 3000); speechSynthesis.addEventListener('voiceschanged', done);
    });
    const voices = speechSynthesis.getVoices();
    result.voices = voices.map(voice => ({ name: voice.name, lang: voice.lang, localService: voice.localService }));
    const voice = voices.find(voice => voice.localService === true && /^zh(?:-|_)/i.test(voice.lang));
    if (!voice) return { ...result, outcome: 'no-local-chinese-voice' };
    result.voice = { name: voice.name, lang: voice.lang }; result.text = '你好，我是小伴。';
    return new Promise(resolve => {
      const utterance = new SpeechSynthesisUtterance(result.text), start = performance.now();
      utterance.voice = voice; utterance.lang = voice.lang;
      let complete = false;
      const finish = outcome => { if (complete) return; complete = true; clearTimeout(timer); utterance.onstart = utterance.onboundary = utterance.onend = utterance.onerror = null; speechSynthesis.cancel(); resolve({ ...result, outcome }); };
      const record = (type, event) => result.events.push({ type, milliseconds: Math.round(performance.now()-start), charIndex: event.charIndex, charLength: event.charLength, name: event.name, error: event.error });
      utterance.onstart = event => record('start', event); utterance.onboundary = event => record('boundary', event);
      utterance.onend = event => { record('end', event); finish('ended'); };
      utterance.onerror = event => { record('error', event); finish('error'); };
      const timer = setTimeout(() => finish('timeout'), 12000);
      try { speechSynthesis.speak(utterance); } catch (error) { result.error = error.message; finish('threw'); }
    });
  })()`, true);
}

async function inspectResponse(expression) {
  mainWindow.show(); mainWindow.focus();
  await mainWindow.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('select[aria-label="回应心情"]');
    if (!select) throw new Error('Response select missing');
    select.value = ${JSON.stringify(expression)}; select.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await clickSmokeButton('.companion-response-row', '说句话');
  const rendered = await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject) => {
    const started = performance.now(), frames = [];
    const check = () => {
      const canvas = document.querySelector('canvas[data-avatar-renderer="mesh2d"]');
      if (canvas) frames.push({ time: Math.round(performance.now()-started), expression: canvas.dataset.expression, shape: canvas.dataset.mouthShape, open: Number(canvas.dataset.mouthOpen), phase: canvas.dataset.phase, source: canvas.dataset.speechSource });
      if (performance.now()-started > 700 && canvas?.dataset.expression === ${JSON.stringify(expression)} && Number(canvas.dataset.mouthOpen) > .25) return resolve({ expression: ${JSON.stringify(expression)}, frames });
      if (performance.now()-started > 6000) return reject(new Error('Response expression/mouth was not rendered: ${expression}: '+JSON.stringify({hidden:document.hidden,frames:frames.slice(-3)})));
      setTimeout(check, 25);
    }; check();
  })`);
  if (process.env.PETPAL_SMOKE_DIR) await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, `anime-${expression}.png`), (await mainWindow.webContents.capturePage()).toPNG());
  await mainWindow.webContents.executeJavaScript(`document.querySelector('button[aria-label="停止说话"]').click()`);
  rendered.stopped = await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject) => {
    const start = performance.now(); const check = () => {
      const c = document.querySelector('canvas[data-avatar-renderer="mesh2d"]');
      if (c?.dataset.phase === 'idle' && Number(c.dataset.mouthOpen) === 0) return resolve({phase:c.dataset.phase,open:Number(c.dataset.mouthOpen),milliseconds:Math.round(performance.now()-start)});
      if (performance.now()-start > 1500) return reject(new Error('Stop did not close mouth'));
      setTimeout(check, 20);
    }; check();
  })`);
  return rendered;
}

async function inspectSpeechUi() {
  const initial = await mainWindow.webContents.executeJavaScript(`(() => {
    const toggle = document.querySelector('.voice-toggle input');
    if (!toggle || toggle.disabled) return {available:false,caption:document.querySelector('.voice-caption')?.textContent};
    const result = {available:true,defaultOff:!toggle.checked};
    window.__petpalSmokeSpeech = {events:[],utterances:0};
    window.__petpalOriginalSpeak = speechSynthesis.speak;
    speechSynthesis.speak = function(utterance) {
      const index = ++window.__petpalSmokeSpeech.utterances;
      for(const type of ['start','boundary','end','error']) utterance.addEventListener(type,event => window.__petpalSmokeSpeech.events.push({type,index,charIndex:event.charIndex,error:event.error,time:Math.round(performance.now())}));
      return window.__petpalOriginalSpeak.call(this,utterance);
    };
    if(!toggle.checked) toggle.click();
    const select = document.querySelector('select[aria-label="回应心情"]');select.value='warm';select.dispatchEvent(new Event('change',{bubbles:true}));
    return result;
  })()`, true);
  if (!initial.available) return initial;
  if (!initial.defaultOff) throw new Error('Speech should be off by default');
  try {
    await clickSmokeButton('.companion-response-row', '说句话');
    const live = await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const start=performance.now(),frames=[];
      const check=()=>{const c=document.querySelector('canvas[data-avatar-renderer="mesh2d"]');frames.push({phase:c?.dataset.phase,source:c?.dataset.speechSource,shape:c?.dataset.mouthShape,open:Number(c?.dataset.mouthOpen)});
      if(c?.dataset.speechSource==='playback-progress'&&Number(c.dataset.mouthOpen)>.25&&window.__petpalSmokeSpeech.events.some(e=>e.type==='boundary'&&e.charIndex>0)) return resolve({frames,caption:document.querySelector('.voice-caption')?.textContent});
      if(performance.now()-start>12000)return reject(new Error('Actual UI playback did not drive boundary mouth'));setTimeout(check,25);};check();})`);
    if (process.env.PETPAL_SMOKE_DIR) await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'anime-system-speech.png'), (await mainWindow.webContents.capturePage()).toPNG());
    const completed = await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const start=performance.now();const check=()=>{const c=document.querySelector('canvas[data-avatar-renderer="mesh2d"]');const log=window.__petpalSmokeSpeech;
      if(log.events.filter(e=>e.type==='end').length>=2&&!speechSynthesis.speaking&&!speechSynthesis.pending&&c?.dataset.phase==='idle'&&Number(c.dataset.mouthOpen)===0)return resolve({events:log.events.slice(),utterances:log.utterances,phase:c.dataset.phase,open:Number(c.dataset.mouthOpen)});
      if(log.events.some(e=>e.type==='error'))return reject(new Error('System speech UI emitted an error'));if(performance.now()-start>20000)return reject(new Error('System speech UI did not finish'));setTimeout(check,50);};check();})`);
    const stopped = await inspectResponse('warm');
    await mainWindow.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,1000))');
    stopped.after = await mainWindow.webContents.executeJavaScript(`({speaking:speechSynthesis.speaking,pending:speechSynthesis.pending,events:window.__petpalSmokeSpeech.events.slice(),phase:document.querySelector('canvas[data-avatar-renderer="mesh2d"]').dataset.phase,open:Number(document.querySelector('canvas[data-avatar-renderer="mesh2d"]').dataset.mouthOpen)})`);
    if (stopped.after.speaking || stopped.after.pending || stopped.after.open !== 0 || stopped.after.phase !== 'idle') throw new Error('Stopped speech resumed');
    await clickSmokeButton('.companion-response-row', '说句话');
    await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=performance.now();const check=()=>{if(speechSynthesis.speaking)return resolve();if(performance.now()-start>12000)return reject(new Error('Visibility speech did not begin'));setTimeout(check,50);};check();})`);
    mainWindow.hide();
    const hidden = await mainWindow.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(()=>resolve({hidden:document.hidden,speaking:speechSynthesis.speaking,pending:speechSynthesis.pending}),500))`);
    mainWindow.show(); mainWindow.focus();
    if (!hidden.hidden || hidden.speaking || hidden.pending) throw new Error('Hidden window did not cancel system speech');
    return { ...initial, live, completed, stopped, hidden, audioAudibilityVerified:false };
  } finally {
    mainWindow.show();
    await mainWindow.webContents.executeJavaScript(`(()=>{document.querySelector('button[aria-label="停止说话"]')?.click();const toggle=document.querySelector('.voice-toggle input');if(toggle?.checked)toggle.click();speechSynthesis.speak=window.__petpalOriginalSpeak;delete window.__petpalOriginalSpeak;})()`);
  }
}

async function inspectAppFixture() {
  // Isolated renderer fixture: a single SSE read deliberately contains delta + done.
  // This does not call a model and is not evidence of a live upstream provider.
  await fetch(`${origin}/api/providers`, { method:'POST', headers:{Authorization:`Bearer ${backend.token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'Isolated UI fixture',protocol:'chat-completions',baseUrl:'http://127.0.0.1:1/v1',model:'fixture',apiKey:''}) }).then(async response=>{if(!response.ok)throw new Error(await response.text());});
  await mainWindow.loadURL(`${origin}/?chat=1`); mainWindow.show();mainWindow.focus();
  await inspectAvatarWindow(mainWindow,false,'anime');
  await mainWindow.webContents.executeJavaScript(`(async()=>{
    const nativeFetch=window.fetch.bind(window), connection=await window.petpal.connection();
    const state=await nativeFetch(connection.url+'/api/state',{headers:{Authorization:'Bearer '+connection.token}}).then(r=>r.json());
    window.__appFixture={state,chunks:[],speechEvents:[],utterances:0};
    const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
    window.fetch=async(input,options={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href), fixture=window.__appFixture;
      if(url.origin!==location.origin)return nativeFetch(input,options);
      if(url.pathname==='/api/state')return json(fixture.state);
      if(url.pathname==='/api/conversations'&&options.method==='POST'){
        const values=JSON.parse(options.body),conversation={id:'app-fixture',title:'Fixture',mode:'chat',providerId:values.providerId,messages:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};fixture.state.conversations=[conversation];return json(conversation);
      }
      if(url.pathname==='/api/conversations/app-fixture/messages'){
        const values=JSON.parse(options.body),conversation=fixture.state.conversations[0],index=conversation.messages.length;
        const reply={id:'fixture-assistant-'+index,role:'assistant',content:'谢谢你。',status:'complete'};
        conversation.messages.push({id:'fixture-user-'+index,role:'user',content:values.content,status:'complete'},reply);
        const payload='event: meta\\ndata: {}\\n\\nevent: delta\\ndata: '+JSON.stringify({text:reply.content})+'\\n\\nevent: done\\ndata: '+JSON.stringify({conversation})+'\\n\\n';
        const stream=new ReadableStream({start(controller){fixture.chunks.push({request:values.content,chunks:1,events:['meta','delta','done']});controller.enqueue(new TextEncoder().encode(payload));controller.close();}});
        return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
      }
      return nativeFetch(input,options);
    };
    if('speechSynthesis' in window){const original=speechSynthesis.speak;speechSynthesis.speak=function(utterance){const index=++window.__appFixture.utterances;for(const type of ['start','boundary','end','error'])utterance.addEventListener(type,event=>window.__appFixture.speechEvents.push({type,index,charIndex:event.charIndex,error:event.error}));return original.call(this,utterance);};}
  })()`);
  const send = async text => {
    await mainWindow.webContents.executeJavaScript(`(()=>{const field=document.querySelector('textarea[aria-label="消息"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(text)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await mainWindow.webContents.executeJavaScript(`document.querySelector('button[aria-label="发送消息"]').click()`);
  };
  const observe = expression => mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const started=performance.now();const check=()=>{const canvas=document.querySelector('canvas[data-avatar-renderer="mesh2d"]');const fixture=window.__appFixture;if(${expression})return resolve({phase:canvas?.dataset.phase,action:canvas?.dataset.petAction,expression:canvas?.dataset.expression,mouthOpen:Number(canvas?.dataset.mouthOpen),speaking:window.speechSynthesis?.speaking,utterances:fixture.utterances,events:fixture.speechEvents.slice(),chunks:fixture.chunks.slice(),hidden:document.hidden});if(performance.now()-started>12000)return reject(new Error('App fixture condition timed out: '+JSON.stringify({hidden:document.hidden,phase:canvas?.dataset.phase,mouthOpen:canvas?.dataset.mouthOpen,body:document.body.innerText.slice(-900)})));setTimeout(check,20);};check();})`);
  await send('单块完成测试');
  const singleChunk = await observe(`fixture.chunks.length===1&&!document.querySelector('button[aria-label="停止生成"]')&&Number(canvas?.dataset.mouthOpen)>.15&&canvas?.dataset.expression==='warm'`);
  if(singleChunk.utterances!==0)throw new Error('Default-off app spoke automatically');
  if(process.env.PETPAL_SMOKE_DIR)await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR,'app-singlechunk-response.png'),(await mainWindow.webContents.capturePage()).toPNG());
  const settled = await observe(`fixture.chunks.length===1&&canvas?.dataset.phase==='idle'&&Number(canvas?.dataset.mouthOpen)===0`);
  const localVoice=await mainWindow.webContents.executeJavaScript(`'speechSynthesis' in window&&speechSynthesis.getVoices().some(v=>v.localService&&/^zh(?:-|_)/i.test(v.lang))`);
  if(!localVoice)return{fixture:true,upstreamModelCalled:false,singleChunk,settled,sleepSpeech:'no-local-voice'};
  await clickSmokeButton('.speech-controls','朗读上一条');
  const manual=await observe(`fixture.speechEvents.some(event=>event.type==='start')&&speechSynthesis.speaking`);
  await clickSmokeButton('.pet-actions','歇一会');
  const sleepCancelled=await observe(`canvas?.dataset.petAction==='sleep'&&Number(canvas?.dataset.mouthOpen)===0&&!speechSynthesis.speaking&&!speechSynthesis.pending`);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('.speech-toggle input').click()`);
  await send('睡眠期间完成测试');
  await observe(`fixture.chunks.length===2&&!document.querySelector('button[aria-label="停止生成"]')`);
  await mainWindow.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,1200))');
  const sleepingReply=await observe(`canvas?.dataset.petAction==='sleep'&&Number(canvas?.dataset.mouthOpen)===0&&!speechSynthesis.speaking&&!speechSynthesis.pending`);
  if(sleepingReply.utterances!==manual.utterances)throw new Error('Sleeping app auto-read a completed reply');
  if(process.env.PETPAL_SMOKE_DIR)await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR,'app-sleep-quiet.png'),(await mainWindow.webContents.capturePage()).toPNG());
  return{fixture:true,upstreamModelCalled:false,singleChunk,settled,manual,sleepCancelled,sleepingReply};
}

async function boot() {
  const { createPetServer } = await import(pathToFileURL(path.join(root, 'server', 'app.mjs')).href);
  const serviceSettings = await readDesktopServiceSettings(app.getPath('userData'));
  const workspaceRoot = process.env.PETPAL_WORKSPACE || path.join(app.getPath('userData'), 'workspace');
  await fs.mkdir(workspaceRoot, { recursive: true });
  backend = await createPetServer({
    dataDir: path.join(app.getPath('userData'), 'data'),
    token: crypto.randomBytes(32).toString('hex'),
    staticDir: path.join(root, 'dist'),
    allowedOrigins: [],
    workspaceRoot,
    codexHttpOrigins: serviceSettings.codexHttpOrigins,
  });
  await new Promise((resolve, reject) => {
    backend.server.once('error', reject);
    backend.server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${backend.server.address().port}`;
  const executorModule = await import(pathToFileURL(path.join(__dirname, 'executor.mjs')).href);
  executor = new executorModule.DesktopExecutor({ dataDir: path.join(app.getPath('userData'), 'executor') });
  for (const [channel, handler] of Object.entries(executorModule.createExecutorHandlers(executor,
    event => isTrusted(event) && event.sender === mainWindow?.webContents && !quitting))) ipcMain.handle(channel, handler);
  remoteHttp = createDesktopRemoteHttp({ isAllowed: event => isTrusted(event) && event.sender === mainWindow?.webContents });
  ipcMain.handle('petpal:remote:request', (event, request) => remoteHttp.request(event, request));
  ipcMain.handle('petpal:remote:abort', (event, id) => remoteHttp.abort(event, id));
  ipcMain.handle('petpal:remote:ack', (event, id, sequence) => remoteHttp.acknowledge(event, id, sequence));
  const updaterModule = await import(pathToFileURL(path.join(__dirname, 'updates.mjs')).href);
  verifyDownloadedUpdate = updaterModule.verifyDownloadedUpdate;
  updates = new updaterModule.DesktopUpdateManager({
    service: backend.updates, dataDir: app.getPath('userData'), currentVersion: app.getVersion(),
    platform: process.platform, arch: process.arch,
    launchPortable: queuePortableUpdate,
    revealArchive: file => shell.showItemInFolder(file),
  });
  for (const [channel, handler] of Object.entries(updaterModule.createDesktopUpdateHandlers(updates,
    event => isTrusted(event) && event.sender === mainWindow?.webContents, requireUpdateOwner))) ipcMain.handle(channel, handler);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) =>
    callback(canRequestMedia({webContents, mainWindow, origin}, permission, details)));
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    canCheckMedia({webContents, mainWindow, origin}, permission, requestingOrigin, details));
  for (const [channel, handler] of Object.entries({
    'petpal:connection': () => ({ url: origin, token: backend.token }),
    'petpal:show-pet': showPet,
    'petpal:show-main': showMain,
    'petpal:hide-pet': () => petWindow?.hide(),
  })) ipcMain.handle(channel, (event) => {
    if (!isTrusted(event)) throw new Error('Untrusted window');
    if (channel === 'petpal:connection' && event.sender !== mainWindow?.webContents) throw new Error('Credentials belong to the main window');
    return handler();
  });
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 }));
  tray.setToolTip('小伴 PetPal');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开小伴', click: showMain },
    { label: '显示桌宠', click: showPet },
    { label: '隐藏桌宠', click: () => petWindow?.hide() },
    { type: 'separator' },
    { label: '退出小伴', click: () => app.quit() },
  ]));
  tray.on('double-click', showMain);
  createMain();
  showPet();
  if (process.argv.includes('--smoke-test')) {
    await Promise.all([mainLoaded, petLoaded]);
    const loginGate = await loginSmokeMain();
    const health = await fetch(`${origin}/api/health`).then(r => r.json());
    const bridge = await mainWindow.webContents.executeJavaScript('window.petpal.connection().then(c => ({url: c.url, hasToken: !!c.token}))');
    const executorBridge = await mainWindow.webContents.executeJavaScript(`(async () => {
      const value = window.petpal.executor;
      if (!value || !['connect', 'disconnect', 'status'].every(key => typeof value[key] === 'function')) throw new Error('Executor preload facade is unavailable');
      return { available: true, ...(await value.status()) };
    })()`);
    const codex = await fetch(`${origin}/api/codex/status`, { headers: { Authorization: `Bearer ${backend.token}` } }).then(r => r.json());
    const desktopTools = await fetch(`${origin}/api/desktop-tools/status`, { headers: { Authorization: `Bearer ${backend.token}` } }).then(async response => {
      if (!response.ok) throw new Error('Desktop tools status is unavailable');
      return response.json();
    });
    const [animeMain, animePet] = await Promise.all([inspectAvatarWindow(mainWindow, true, 'anime'), inspectAvatarWindow(petWindow, false, 'anime')]);
    await mainWindow.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    const result = { event: 'desktop-smoke', health, loginGate, bridge: { url: bridge.url, hasToken: bridge.hasToken }, executor: executorBridge, uiReady: true,
      runtimeRoot: path.dirname(process.execPath), electronVersion: process.versions.electron,
      desktopTools: { toolVersion: desktopTools.toolVersion, music: desktopTools.music,
        opencli: { available: desktopTools.opencli.available, version: desktopTools.opencli.version,
          runtime: desktopTools.opencli.runtime, daemonState: desktopTools.opencli.daemon?.state,
          extensionConnected: desktopTools.opencli.extension?.connected, readOnlyProbe: true } },
      avatars: { anime: { main: animeMain, pet: animePet } }, defaultAvatar: 'anime',
      codex: { available: codex.available, running: codex.running, authenticated: codex.authenticated, sandbox: codex.sandbox },
      pet: { alwaysOnTop: petWindow.isAlwaysOnTop(), transparent: true } };
    result.systemSpeech = await inspectSystemSpeech(mainWindow);
    if (process.env.PETPAL_SMOKE_DIR) {
      await fs.mkdir(process.env.PETPAL_SMOKE_DIR, { recursive: true });
      await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'main.png'), (await mainWindow.webContents.capturePage()).toPNG());
      await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'pet.png'), (await petWindow.webContents.capturePage()).toPNG());
      if (process.env.PETPAL_SMOKE_POSES === '1') {
        const desktopBounds = mainWindow.getBounds();
        mainWindow.setMinimumSize(0, 0);
        let requestedWidth = 390, requestedHeight = 844;
        for (let attempt = 0; attempt < 3; attempt++) {
          mainWindow.setContentSize(requestedWidth, requestedHeight);
          const viewport = await mainWindow.webContents.executeJavaScript('new Promise(resolve => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve({width:innerWidth,height:innerHeight}))), 250))');
          if (viewport.width === 390 && viewport.height === 844) break;
          requestedWidth += 390 - viewport.width; requestedHeight += 844 - viewport.height;
        }
        const mobile = await inspectAvatarWindow(mainWindow, true, 'anime');
        if (mobile.viewport.width !== 390 || mobile.viewport.height !== 844) throw new Error(`Mobile viewport differs: ${JSON.stringify(mobile.viewport)}`);
        await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'anime-mobile.png'), (await mainWindow.webContents.capturePage()).toPNG());
        mainWindow.setBounds(desktopBounds);
        mainWindow.setMinimumSize(760, 540);
        await mainWindow.webContents.executeJavaScript('new Promise(resolve => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 250))');
        await clickSmokeButton('.companion-controls', '分享点心');
        const talk = await waitForPose('eat');
        await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'anime-talk.png'), (await mainWindow.webContents.capturePage()).toPNG());
        const responses = [];
        for (const expression of ['warm', 'curious', 'thoughtful', 'surprised', 'shy']) responses.push(await inspectResponse(expression));
        result.responsePerformance = responses;
        result.speechUi = await inspectSpeechUi();
        await clickSmokeButton('.companion-controls', '睡一会');
        const sleep = await waitForPose('sleep');
        if (Number(sleep.blink) < 0.9) throw new Error('Anime sleep eyes are not closed');
        await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'anime-sleep.png'), (await mainWindow.webContents.capturePage()).toPNG());
        result.poses = { mobile, talk, sleep };
      }
    }
    await clickSmokeButton('.companion-switch', '3D 小猫');
    const [catMain, catPet] = await Promise.all([inspectAvatarWindow(mainWindow, true, 'cat'), inspectAvatarWindow(petWindow, false, 'cat')]);
    if (catMain.storedKind !== 'cat' || catPet.storedKind !== 'cat') throw new Error('Avatar storage selection did not synchronize');
    result.is3d = true; result.renderer = { main: catMain, pet: catPet }; result.avatars.cat = result.renderer;
    if (process.env.PETPAL_SMOKE_DIR) {
      await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'cat-main.png'), (await mainWindow.webContents.capturePage()).toPNG());
      await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'cat-pet.png'), (await petWindow.webContents.capturePage()).toPNG());
      if (process.env.PETPAL_SMOKE_POSES === '1') {
        result.poses.walk = await waitForPose('walk');
        await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'cat-walk.png'), (await mainWindow.webContents.capturePage()).toPNG());
      }
    }
    await clickSmokeButton('.companion-switch', '二次元伙伴');
    const [returnMain, returnPet] = await Promise.all([inspectAvatarWindow(mainWindow, true, 'anime'), inspectAvatarWindow(petWindow, false, 'anime')]);
    result.switchSynced = returnMain.storedKind === 'anime' && returnPet.storedKind === 'anime';
    if (!result.switchSynced) throw new Error('Avatar storage return transition did not synchronize');
    if (process.env.PETPAL_SMOKE_APP === '1') result.appFixture = await inspectAppFixture();
    const hashBundle = async relative => {
      const absolute = path.join(root, relative);
      if ((await fs.stat(absolute)).isDirectory()) {
        return (await Promise.all((await fs.readdir(absolute)).sort().map(name => hashBundle(path.join(relative, name))))).flat();
      }
      const bytes = await fs.readFile(absolute);
      return [{ path: relative.split(path.sep).join('/'), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }];
    };
    result.bundleFiles = (await Promise.all(['dist', 'server', 'desktop/main.cjs', 'desktop/preload.cjs', 'desktop/updates.mjs', 'desktop/media-permissions.cjs', 'desktop/service-settings.cjs', 'desktop/remote-http.cjs', 'desktop/executor.mjs', 'package.json', 'node_modules/@jackwener/opencli/package.json', 'node_modules/@jackwener/opencli/dist/src/main.js', 'node_modules/@jackwener/opencli/dist/src/daemon.js', 'node_modules/@jackwener/opencli/LICENSE'].map(hashBundle))).flat();
    if (process.env.PETPAL_SMOKE_DIR) await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (!health.ok || !bridge.hasToken || !codex.available || !desktopTools.opencli.available || desktopTools.opencli.version !== '1.8.8') exitCode = 1;
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (origin) showMain(); });
  app.whenReady().then(boot).catch(error => {
    console.error('PetPal startup failed:', error.message);
    if (error.code === 'PETPAL_DESKTOP_SERVICE_SETTINGS' && !process.argv.includes('--smoke-test')) dialog.showErrorBox('小伴启动失败', error.message);
    exitCode = 1;
    app.quit();
  });
  app.on('activate', () => { if (origin) showMain(); });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    tray?.destroy(); tray = null;
    (async () => {
      const outcomes = await Promise.allSettled([executor?.close(), remoteHttp?.close(), updates?.close({ preserveHandoff: Boolean(pendingUpdate) }), backend?.close()]);
      const failed = outcomes.find(outcome => outcome.status === 'rejected');
      if (failed) throw failed.reason;
      if (pendingUpdate) await launchPreparedUpdate(pendingUpdate);
    })().catch(error => { console.error('PetPal shutdown/update handoff:', error.message); exitCode = 1; }).finally(() => app.exit(exitCode));
  });
}
