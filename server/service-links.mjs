import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, realpath, open, rename, unlink, chmod } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';

const KINDS = new Set(['docker-platform', 'api-harbor']);
const LIMIT = 4 * 1024 * 1024;
const MACHINE = '/integrations/service-links/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const STATES = new Set(['pending', 'confirming', 'ready', 'offline', 'revoking', 'revoked']);
export const serviceLinkFailure = (status, code) => Object.assign(new Error(code), { status, code });
const fail = serviceLinkFailure;
const clone = value => structuredClone(value);

export function normalizeServiceUrl(value, kind) {
  try {
    if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20\\]/.test(value)) throw 0;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw 0;
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === '169.254.169.254' || host === '0.0.0.0' || host === '::' || host.startsWith('fe80:')) throw 0;
    if (url.protocol === 'http:') {
      const privateIp = net.isIP(host) === 4 && (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host));
      const privateV6 = host === '::1' || /^(fc|fd)[0-9a-f]{2}:/.test(host);
      const localName = !net.isIP(host) && (host === 'localhost' || !host.includes('.') || /\.(localhost|lan|local|internal)$/.test(host));
      if (!privateIp && !privateV6 && !localName) throw 0;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.split('/').some(part => part === '..' || part === '.') || /[\\\x00-\x20]/.test(pathname)) throw 0;
    if (kind === 'api-harbor') pathname = pathname.replace(/\/v1\/?$/, '');
    url.pathname = pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch { throw fail(400, 'SERVICE_LINK_INVALID_URL'); }
}

function checkKind(kind) { if (!KINDS.has(kind)) throw fail(400, 'SERVICE_LINK_INVALID_KIND'); }
function checkedState(value) {
  if (!value || value.schema !== 'petpal-service-links.v1' || !UUID.test(value.instanceId) || typeof value.links !== 'object' || !value.links || Array.isArray(value.links)) throw 0;
  for (const [kind, entry] of Object.entries(value.links)) {
    checkKind(kind);
    if (!entry || entry.kind !== kind || !STATES.has(entry.state) || !UUID.test(entry.requestId)
      || normalizeServiceUrl(entry.baseUrl, kind) !== entry.baseUrl || typeof entry.credential !== 'string'
      || !(kind === 'docker-platform' ? /^dp-client-[A-Za-z0-9_-]{43}$/ : /^sk-harbor-[A-Za-z0-9_-]{43}$/).test(entry.credential)
      || entry.receiverInstanceId !== undefined && !UUID.test(entry.receiverInstanceId)
      || (entry.code !== null && typeof entry.code !== 'string')) throw 0;
  }
  return value;
}

async function privateStore(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const identity = await lstat(directory); const resolved = await realpath(directory);
  if (!identity.isDirectory() || identity.isSymbolicLink() || path.resolve(resolved).toLowerCase() !== path.resolve(directory).toLowerCase()) throw fail(500, 'SERVICE_LINK_STORAGE_UNSAFE');
  await chmod(directory, 0o700);
  async function guard() {
    const now = await lstat(directory);
    if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== identity.dev || now.ino !== identity.ino || (await realpath(directory)) !== resolved) throw fail(500, 'SERVICE_LINK_STORAGE_UNSAFE');
  }
  async function read(name, limit = LIMIT) {
    await guard(); const file = path.join(directory, name);
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > limit) throw fail(500, 'SERVICE_LINK_STORAGE_UNSAFE');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const now = await handle.stat();
      if (now.ino !== before.ino || now.dev !== before.dev || now.nlink !== 1 || now.size > limit) throw fail(500, 'SERVICE_LINK_STORAGE_UNSAFE');
      return await handle.readFile();
    } finally { await handle.close(); }
  }
  async function write(name, bytes, exclusive = false) {
    await guard(); const file = path.join(directory, name);
    if (!exclusive) {
      try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw fail(500, 'SERVICE_LINK_STORAGE_UNSAFE'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const temp = exclusive ? file : `${file}.${randomUUID()}.tmp`;
    let handle; let written = false;
    try {
      handle = await open(temp, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      await guard(); if (!exclusive) await rename(temp, file); written = true;
      await chmod(file, 0o600);
    } finally { await handle?.close(); if (!written && !exclusive) await unlink(temp).catch(() => {}); }
  }
  return { read, write };
}

function publicLink(kind, entry) {
  if (!entry) return { kind, state: 'unpaired', baseUrl: null };
  return {
    kind, state: entry.state, baseUrl: entry.baseUrl, updatedAt: entry.updatedAt,
    ...(entry.clientId ? { clientId: entry.clientId } : {}),
    ...(entry.connectionId ? { connectionId: entry.connectionId, issuerInstanceId: entry.issuerInstanceId } : {}),
    ...(entry.catalog ? { catalog: clone(entry.catalog) } : {}),
    ...(entry.lastError ? { lastError: entry.lastError } : {}),
  };
}

function checkedCatalog(value) {
  if (!value || value.schema !== 'api-harbor-model-catalog.v1' || value.service !== 'api-harbor' || !Array.isArray(value.models) || value.models.length > 512) throw fail(502, 'SERVICE_LINK_INVALID_CATALOG');
  const models = value.models.map(model => {
    if (!model || typeof model.id !== 'string' || !model.id || model.id.length > 200 || !Array.isArray(model.protocols) || !model.protocols.length || model.protocols.some(p => !['responses', 'chat'].includes(p))) throw fail(502, 'SERVICE_LINK_INVALID_CATALOG');
    const capabilities = {};
    for (const protocol of model.protocols) {
      const source = model.capabilities?.[protocol]; const target = {};
      for (const key of ['stream', 'tools', 'customTools']) if (typeof source?.[key] === 'boolean' || source?.[key] === null) target[key] = source[key];
      for (const key of ['reasoningEfforts', 'inputModalities', 'structuredOutput']) if (source?.[key] === null || Array.isArray(source?.[key]) && source[key].every(v => typeof v === 'string' && v.length <= 100) && source[key].length <= 32) target[key] = clone(source[key]);
      if (Number.isSafeInteger(source?.maxConcurrentRequests) && source.maxConcurrentRequests >= 1 && source.maxConcurrentRequests <= 4096) target.maxConcurrentRequests = source.maxConcurrentRequests;
      capabilities[protocol] = target;
    }
    return { id: model.id, protocols: [...new Set(model.protocols)], capabilities, verified: false, capabilitySource: 'configured',
      ...(typeof model.defaultReasoningEffort === 'string' && model.defaultReasoningEffort.length <= 100 ? { defaultReasoningEffort: model.defaultReasoningEffort } : {}) };
  });
  return { schema: value.schema, service: value.service, models,
    ...(Number.isSafeInteger(value.sharedRequestLimit) && value.sharedRequestLimit >= 1 && value.sharedRequestLimit <= 4096 ? { sharedRequestLimit: value.sharedRequestLimit } : {}) };
}

export async function createServiceLinks({ dataDir, fetchImpl = globalThis.fetch, clock = Date.now }) {
  if (!path.isAbsolute(dataDir)) throw fail(500, 'SERVICE_LINK_INVALID_DIRECTORY');
  const storage = await privateStore(path.join(dataDir, 'service-links'));
  let key, state; let closed = false; let serial = Promise.resolve(); const active = new Set();
  try {
    let ciphertext; let createdKey = false;
    try { ciphertext = await storage.read('links.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { key = await storage.read('master.key', 32); }
    catch (error) {
      if (error.code !== 'ENOENT' || ciphertext) throw error;
      key = randomBytes(32); await storage.write('master.key', key, true); createdKey = true;
    }
    if (key.length !== 32) throw 0;
    if (ciphertext) {
      const envelope = JSON.parse(ciphertext);
      if (envelope.schema !== 'petpal-service-links-encrypted.v1') throw 0;
      const nonce = Buffer.from(envelope.nonce, 'base64'); const tag = Buffer.from(envelope.tag, 'base64');
      if (nonce.length !== 12 || tag.length !== 16) throw 0;
      const decipher = createDecipheriv('aes-256-gcm', key, nonce); decipher.setAAD(Buffer.from('petpal-service-links.v1')); decipher.setAuthTag(tag);
      state = checkedState(JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])));
    } else {
      if (!createdKey) throw 0; // A retained key without its state is incomplete recovery, never a new instance.
      state = { schema: 'petpal-service-links.v1', instanceId: randomUUID(), links: {} };
    }
  } catch (error) { if (error?.code === 'SERVICE_LINK_STORAGE_UNSAFE') throw error; throw fail(503, 'SERVICE_LINK_STORAGE_RECOVERY_REQUIRED'); }
  const ensureOpen = () => { if (closed) throw fail(503, 'SERVICE_LINK_CLOSED'); };
  async function save(next) {
    ensureOpen(); checkedState(next); const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from('petpal-service-links.v1'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(next)), cipher.final()]);
    await storage.write('links.json', JSON.stringify({ schema: 'petpal-service-links-encrypted.v1', nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
    state = next;
  }
  await save(state);
  function lock(operation) {
    const job = serial.then(() => { ensureOpen(); return operation(); }); serial = job.catch(() => {}); return job;
  }
  async function upstream(kind, entry, suffix, { method = 'GET', body, signal, authorized = true } = {}) {
    ensureOpen();
    if (typeof suffix !== 'string' || !suffix.startsWith('/') || suffix.startsWith('//') || suffix.includes('://') || /[\\\x00-\x20#]/.test(suffix) || decodeURIComponent(suffix).split(/[/?]/).includes('..')) throw fail(400, 'SERVICE_LINK_INVALID_PATH');
    const controller = new AbortController(); active.add(controller); const timeout = setTimeout(() => controller.abort(), 15000);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      const headers = { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
      if (authorized) { headers.Authorization = `Bearer ${entry.credential}`; if (kind === 'api-harbor') headers['X-Service-Link-Receiver-Instance'] = state.instanceId; }
      const response = await fetchImpl(entry.baseUrl + suffix, { method, headers, redirect: 'error', signal: combined, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (Number(response.headers?.get?.('content-length')) > LIMIT) throw fail(502, 'SERVICE_LINK_INVALID_RESPONSE');
      let bytes = 0; const chunks = [];
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        try { for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > LIMIT) { await reader.cancel(); throw fail(502, 'SERVICE_LINK_INVALID_RESPONSE'); } chunks.push(Buffer.from(item.value)); } }
        finally { reader.releaseLock(); }
      } else { const raw = await response.text(); if (Buffer.byteLength(raw) > LIMIT) throw fail(502, 'SERVICE_LINK_INVALID_RESPONSE'); chunks.push(Buffer.from(raw)); }
      let value; try { value = JSON.parse(Buffer.concat(chunks)); } catch { throw fail(502, 'SERVICE_LINK_INVALID_RESPONSE'); }
      if (!response.ok) {
        const publicCode = kind === 'docker-platform' && typeof value?.errorCode === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value.errorCode) ? value.errorCode : null;
        const error = fail(response.status >= 400 && response.status < 600 ? response.status : 502, publicCode || (response.status === 422 && kind === 'api-harbor' ? 'SERVICE_LINK_RECEIVER_UNSUPPORTED' : 'SERVICE_LINK_UPSTREAM_REJECTED'));
        error.serviceLink = true;
        // Only a precisely bound issuer proof can permit replacing pending identity.
        if (kind === 'api-harbor' && response.status === 401 && response.headers?.get?.('cache-control')?.includes('no-store') && value?.error?.code === 'service_link_code_rejected') error.noEffect = true;
        const proof = value?.error?.details;
        if (kind === 'api-harbor' && response.status === 401 && value?.error?.code === 'service_link_connection_revoked'
          && proof?.schema === 'service-link-revocation.v1' && proof.issuerType === 'api-harbor' && proof.receiverType === 'petpal'
          && proof.issuerInstanceId === entry.issuerInstanceId && proof.connectionId === entry.connectionId
          && proof.receiverInstanceId === state.instanceId && proof.redemptionId === entry.requestId && proof.state === 'revoked') error.revoked = true;
        throw error;
      }
      return value;
    } catch (error) {
      if (signal?.aborted) throw fail(499, 'SERVICE_LINK_CANCELLED');
      if (closed) throw fail(503, 'SERVICE_LINK_CLOSED');
      if (controller.signal.aborted) throw fail(504, 'SERVICE_LINK_TIMEOUT');
      if (error?.serviceLink || error?.code?.startsWith('SERVICE_LINK_')) throw error;
      throw fail(502, 'SERVICE_LINK_UNAVAILABLE');
    } finally { clearTimeout(timeout); active.delete(controller); }
  }
  function harborReceipt(value, entry) {
    if (value?.schema !== 'service-link-receipt.v1' || value.issuerType !== 'api-harbor' || value.receiverType !== 'petpal' || value.receiverInstanceId !== state.instanceId || value.redemptionId !== entry.requestId
      || !/^hc-[0-9a-f]{64}$/.test(value.connectionId) || !ID.test(value.issuerInstanceId) || !['pairing', 'ready'].includes(value.state)
      || entry.connectionId && value.connectionId !== entry.connectionId || entry.issuerInstanceId && value.issuerInstanceId !== entry.issuerInstanceId) throw fail(502, 'SERVICE_LINK_INVALID_RECEIPT');
    const catalog = checkedCatalog(value.catalog);
    return { connectionId: value.connectionId, issuerInstanceId: value.issuerInstanceId, catalog };
  }
  async function advance(kind) {
    const entry = clone(state.links[kind]);
    if (!entry) throw fail(409, 'SERVICE_LINK_NOT_PAIRED');
    try {
      if (entry.state === 'revoking') {
        const receipt = await upstream(kind, entry, kind === 'docker-platform' ? '/v1/link' : `${MACHINE}/connections/${entry.connectionId}`, { method: 'DELETE' });
        if (receipt?.state !== 'revoked' || kind === 'api-harbor' && receipt.connectionId !== entry.connectionId) throw fail(502, 'SERVICE_LINK_INVALID_RECEIPT');
        entry.state = 'revoked'; entry.code = null;
      } else if (kind === 'docker-platform') {
        if (!entry.clientId) {
          const receipt = await upstream(kind, entry, '/v1/pair', { method: 'POST', authorized: false, body: { code: entry.code, credential: entry.credential, instanceId: entry.receiverInstanceId || state.instanceId, requestId: entry.requestId, name: entry.name } });
          if (receipt?.schema !== 'docker-platform-link.v1' || !UUID.test(receipt.clientId) || !['pending', 'active'].includes(receipt.state)) throw fail(502, 'SERVICE_LINK_INVALID_RECEIPT');
          entry.clientId = receipt.clientId; entry.state = 'confirming'; await save({ ...state, links: { ...state.links, [kind]: clone(entry) } });
        }
        const receipt = await upstream(kind, entry, '/v1/confirm', { method: 'POST', body: {} });
        if (receipt?.clientId !== entry.clientId || receipt?.state !== 'active') throw fail(502, 'SERVICE_LINK_INVALID_RECEIPT');
        entry.state = 'ready'; entry.code = null;
      } else {
        let receipt;
        if (entry.connectionId) receipt = await upstream(kind, entry, `${MACHINE}/receipts/${entry.requestId}`);
        else receipt = await upstream(kind, entry, `${MACHINE}/exchange`, { method: 'POST', authorized: false, body: { schema: 'service-link-exchange.v1', code: entry.code, receiverType: 'petpal', receiverInstanceId: state.instanceId, redemptionId: entry.requestId, credentialHash: createHash('sha256').update(entry.credential).digest('hex') } });
        Object.assign(entry, harborReceipt(receipt, entry), { state: 'confirming' }); await save({ ...state, links: { ...state.links, [kind]: clone(entry) } });
        receipt = await upstream(kind, entry, `${MACHINE}/confirm`, { method: 'POST', body: { schema: 'service-link-confirm.v1', connectionId: entry.connectionId, receiverInstanceId: state.instanceId, redemptionId: entry.requestId } });
        if (receipt?.state !== 'ready') throw fail(502, 'SERVICE_LINK_INVALID_RECEIPT');
        Object.assign(entry, harborReceipt(receipt, entry), { state: 'ready', code: null });
      }
      entry.lastError = null; entry.updatedAt = new Date(clock()).toISOString(); await save({ ...state, links: { ...state.links, [kind]: entry } });
      return publicLink(kind, entry);
    } catch (error) {
      if (!closed) {
        entry.lastError = error?.serviceLink || error?.code?.startsWith('SERVICE_LINK_') ? error.code : 'SERVICE_LINK_UNAVAILABLE';
        entry.updatedAt = new Date(clock()).toISOString();
        if (error.revoked || error.noEffect && !entry.connectionId) { entry.state = 'revoked'; entry.code = null; }
        else if (entry.state === 'ready') entry.state = 'offline';
        await save({ ...state, links: { ...state.links, [kind]: entry } });
      }
      throw error;
    }
  }
  return {
    async status() { ensureOpen(); return { instanceId: state.instanceId, links: Object.fromEntries([...KINDS].map(kind => [kind, publicLink(kind, state.links[kind])])) }; },
    async pair(kind, { baseUrl, code, name = '小伴', publicUrl } = {}) {
      checkKind(kind); baseUrl = normalizeServiceUrl(baseUrl, kind);
      if (typeof code !== 'string' || !(kind === 'api-harbor' ? /^harbor-connect-[A-Za-z0-9_-]{43}$/ : /^dp-pair-[A-Za-z0-9_-]{20,100}$/).test(code)) throw fail(400, 'SERVICE_LINK_INVALID_CODE');
      if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\x00-\x1f]/.test(name)) throw fail(400, 'SERVICE_LINK_INVALID_NAME');
      if (publicUrl !== undefined) normalizeServiceUrl(publicUrl, kind);
      return lock(async () => {
        const current = state.links[kind];
        if (current && current.state !== 'revoked') {
          if (current.baseUrl !== baseUrl || current.code && current.code !== code) throw fail(409, 'SERVICE_LINK_RECOVERY_PENDING');
          if (current.state === 'ready') return publicLink(kind, current);
        } else {
          const entry = { kind, baseUrl, name: name.trim(), code, receiverInstanceId: kind === 'docker-platform' && current?.state === 'revoked' ? randomUUID() : state.instanceId, credential: (kind === 'docker-platform' ? 'dp-client-' : 'sk-harbor-') + randomBytes(32).toString('base64url'), requestId: randomUUID(), state: 'pending', updatedAt: new Date(clock()).toISOString() };
          await save({ ...state, links: { ...state.links, [kind]: entry } });
        }
        return advance(kind);
      });
    },
    async refresh(kind) { checkKind(kind); return lock(() => advance(kind)); },
    async disconnect(kind) { checkKind(kind); return lock(async () => {
      const entry = state.links[kind]; if (!entry || entry.state === 'revoked') return publicLink(kind, entry);
      if (kind === 'api-harbor' && !entry.connectionId) throw fail(409, 'SERVICE_LINK_RECOVERY_PENDING');
      if (kind === 'docker-platform' && entry.code !== null) throw fail(409, 'SERVICE_LINK_RECOVERY_PENDING');
      await save({ ...state, links: { ...state.links, [kind]: { ...entry, state: 'revoking' } } }); return advance(kind);
    }); },
    async request(kind, suffix, options = {}) {
      checkKind(kind); ensureOpen(); const entry = clone(state.links[kind]);
      if (!entry || entry.state !== 'ready') throw fail(409, 'SERVICE_LINK_NOT_READY');
      const { expectedClientId, ...requestOptions } = options;
      if (expectedClientId !== undefined && (kind !== 'docker-platform' || entry.clientId !== expectedClientId)) throw fail(409, 'cloud_docker_identity_changed');
      const result = await upstream(kind, entry, suffix, requestOptions);
      const current = state.links[kind];
      if (!current || current.state !== 'ready' || current.requestId !== entry.requestId || current.credential !== entry.credential) throw fail(409, 'cloud_docker_identity_changed');
      return result;
    },
    async credential(kind) {
      checkKind(kind); ensureOpen(); const entry = state.links[kind]; if (!entry || entry.state !== 'ready') throw fail(409, 'SERVICE_LINK_NOT_READY');
      return { baseUrl: entry.baseUrl, credential: entry.credential, clientId: entry.clientId, connectionId: entry.connectionId, instanceId: entry.receiverInstanceId || state.instanceId };
    },
    async close() { closed = true; for (const controller of active) controller.abort(); await serial; key.fill(0); },
  };
}
