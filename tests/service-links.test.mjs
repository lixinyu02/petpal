import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServiceLinks, normalizeServiceUrl } from '../server/service-links.mjs';
import { createServiceModels } from '../server/service-models.mjs';
import { createHarborAudioService } from '../server/harbor-audio.mjs';

const DP = 'docker-platform', HARBOR = 'api-harbor';
const code = kind => kind === DP ? 'dp-pair-' + 'A'.repeat(32) : 'harbor-connect-' + 'B'.repeat(43);
const connectionId = 'hc-' + 'a'.repeat(64);
const catalog = { schema: 'api-harbor-model-catalog.v1', service: 'api-harbor', models: [{ id: 'luna', protocols: ['responses'], capabilities: { responses: { tools: true, inputModalities: ['text', 'image'], reasoningEfforts: ['max'] } } }], sharedRequestLimit: 3 };
const speechProfile = () => ({ voices: ['alloy'], response_formats: ['wav'], max_input_characters: 4096, max_instruction_characters: 4096,
  speed_min: .5, speed_max: 2, max_response_bytes: 1024 * 1024, response_validation: { mode: 'pcm16_wav_v1', sample_rate_hz: 24000, channels: 1 } });
const streamProfile = () => ({ server_contract: 'vibevoice_streaming_websocket_v1', input_format: 'pcm_f32le_mono_24000', checkpoint_sample_rate: 24000,
  checkpoint_chunk_samples: 48000, max_input_milliseconds: 30000, max_context_characters: 4096, max_tokens_per_chunk: 256, max_response_bytes: 1024 * 1024 });
const mediaCatalog = (speech = speechProfile(), asr = streamProfile()) => ({ ...catalog, models: [...catalog.models,
  { id: 'voice', protocols: ['speech'], capabilities: { speech: { stream: false, nativeProfile: speech } } },
  { id: 'recognition', protocols: ['asr_stream'], capabilities: { asr_stream: { stream: true, nativeProfile: asr } } }] });
function fixture() {
  const calls = []; const clientId = randomUUID(); let exchange; let broken = null, advertisedCatalog = structuredClone(catalog);
  const fetchImpl = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    const call = { url, method: options.method, headers: options.headers, body }; calls.push(call);
    if (broken) { const result = broken(call); if (result !== undefined) return result; }
    const suffix = new URL(url).pathname;
    const reply = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    if (suffix === '/v1/pair') return reply({ schema: 'docker-platform-link.v1', clientId, state: 'pending' });
    if (suffix === '/v1/confirm') return reply({ clientId, state: 'active' });
    if (suffix === '/v1/link') return reply({ state: 'revoked' });
    if (options.method === 'DELETE') return reply({ state: 'revoked', connectionId });
    if (suffix === '/v1/hosts') return reply({ hosts: [] });
    if (suffix.endsWith('/exchange')) exchange = body;
    if (suffix.startsWith('/integrations/')) return reply({ schema: 'service-link-receipt.v1', issuerType: 'api-harbor', issuerInstanceId: 'issuer-1', connectionId, receiverType: 'petpal', receiverInstanceId: exchange.receiverInstanceId, redemptionId: exchange.redemptionId, state: suffix.endsWith('/confirm') ? 'ready' : 'pairing', catalog: advertisedCatalog });
    throw new Error('unexpected request');
  };
  return { calls, fetchImpl, setBroken(value) { broken = value; }, setCatalog(value) { advertisedCatalog = value; } };
}
async function setup(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'petpal-links-')); const f = fixture();
  let service = await createServiceLinks({ dataDir, fetchImpl: f.fetchImpl });
  t.after(async () => { await service.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, f, get service() { return service; }, async reopen() { await service.close(); service = await createServiceLinks({ dataDir, fetchImpl: f.fetchImpl }); return service; } };
}
test('URL policy accepts HTTPS and explicit private HTTP, rejects credentials and external HTTP', () => {
  assert.equal(normalizeServiceUrl('https://example.com/v1/', HARBOR), 'https://example.com');
  assert.equal(normalizeServiceUrl('http://127.0.0.1:9780/', DP), 'http://127.0.0.1:9780');
  assert.equal(normalizeServiceUrl('http://platform:9780/', DP), 'http://platform:9780');
  for (const value of ['http://example.com', 'https://u:p@example.com', 'https://example.com/?token=x', 'http://169.254.169.254', 'https://example.com/#x', 'https://example.com/a%2f..%2fb', 'https://example.com/a\\b']) assert.throws(() => normalizeServiceUrl(value, DP), /SERVICE_LINK_INVALID_URL/);
});
test('DP pairing is backend authenticated, confirmed, encrypted and restart stable', async t => {
  const h = await setup(t);
  const result = await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  assert.equal(result.state, 'ready');
  const { credential, instanceId, clientId } = await h.service.credential(DP);
  assert.match(credential, /^dp-client-[A-Za-z0-9_-]{43}$/);
  assert.equal(h.f.calls[0].body.instanceId, instanceId);
  assert.equal(h.f.calls[0].body.credential, credential);
  assert.equal(h.f.calls[1].headers.Authorization, 'Bearer ' + credential);
  assert.equal(h.f.calls[0].headers.Origin, undefined);
  const serialized = JSON.stringify(await h.service.status());
  assert.ok(!serialized.includes(credential) && !serialized.includes(code(DP)));
  const disk = await readFile(path.join(h.dataDir, 'service-links', 'links.json'), 'utf8');
  assert.ok(!disk.includes(credential) && !disk.includes(code(DP)));
  await h.reopen();
  assert.equal((await h.service.credential(DP)).clientId, clientId);
  assert.equal((await h.service.credential(DP)).credential, credential);
});
test('unknown exchange delivery persists identical operation through restart', async t => {
  const h = await setup(t); h.f.setBroken(call => { if (call.url.endsWith('/v1/pair')) throw new Error('secret-upstream-address'); });
  await assert.rejects(h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) }), /SERVICE_LINK_UNAVAILABLE/);
  const original = h.f.calls[0].body;
  await h.reopen(); h.f.setBroken(null); await h.service.refresh(DP);
  assert.deepEqual(h.f.calls[1].body, original);
  assert.equal((await h.service.status()).links[DP].state, 'ready');
});
test('unknown confirmation does not exchange again and never replaces pending identity', async t => {
  const h = await setup(t); h.f.setBroken(call => { if (call.url.endsWith('/v1/confirm')) throw new Error('lost'); });
  await assert.rejects(h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) }));
  await assert.rejects(h.service.pair(DP, { baseUrl: 'http://different:9780', code: code(DP) }), /RECOVERY_PENDING/);
  await assert.rejects(h.service.disconnect(DP), /RECOVERY_PENDING/);
  await h.reopen(); h.f.setBroken(null); await h.service.refresh(DP);
  assert.equal(h.f.calls.filter(c => c.url.endsWith('/v1/pair')).length, 1);
  assert.equal(h.service.isReady(DP), true);assert.ok((await h.service.credential(DP)).credential);
});

test('rejected pending disconnect does not fence a subsequently recovered pairing in the same process', async t => {
  for(const kind of [DP,HARBOR]){
    const h=await setup(t);h.f.setBroken(call=>call.url.endsWith(kind===DP?'/v1/pair':'/exchange')?Promise.reject(new Error('lost exchange receipt')):undefined);
    await assert.rejects(h.service.pair(kind,{baseUrl:'https://pairing.example',code:code(kind)}));await assert.rejects(h.service.disconnect(kind),/RECOVERY_PENDING/);
    h.f.setBroken(null);assert.equal((await h.service.refresh(kind)).state,'ready');assert.equal(h.service.isReady(kind),true);assert.ok((await h.service.credential(kind)).credential);
  }
});
test('Harbor uses explicit petpal identity, imports filtered capability catalog and confirms', async t => {
  const h = await setup(t);
  const result = await h.service.pair(HARBOR, { baseUrl: 'https://harbor.example/v1', code: code(HARBOR) });
  const exchange = h.f.calls[0].body;
  assert.equal(exchange.receiverType, 'petpal'); assert.match(exchange.credentialHash, /^[0-9a-f]{64}$/);
  assert.equal(exchange.credential, undefined);
  assert.equal(result.state, 'ready'); assert.equal(result.connectionId, connectionId);
  assert.deepEqual(result.catalog.models[0].capabilities.responses.inputModalities, ['text', 'image']);
  assert.equal(result.catalog.models[0].verified, false);
  assert.equal(h.f.calls[1].headers['X-Service-Link-Receiver-Instance'], exchange.receiverInstanceId);
  await h.service.refresh(HARBOR);
  assert.equal(h.f.calls.filter(c => c.url.endsWith('/exchange')).length, 1);
  assert.ok(h.f.calls.some(c => c.url.includes('/receipts/' + exchange.redemptionId)));
});
test('Harbor rejects wrong receiver receipt before confirmation and retains original recovery tuple', async t => {
  const h = await setup(t); h.f.setBroken(call => call.url.endsWith('/exchange') ? new Response(JSON.stringify({ schema: 'service-link-receipt.v1', receiverType: 'codex-remote' })) : undefined);
  await assert.rejects(h.service.pair(HARBOR, { baseUrl: 'https://harbor.example', code: code(HARBOR) }), /INVALID_RECEIPT/);
  assert.equal(h.f.calls.length, 1); assert.equal((await h.service.status()).links[HARBOR].state, 'pending');
});

test('mixed Harbor catalogs retain known media metadata and safely ignore future protocol extensions', async t => {
  const h = await setup(t);
  h.f.setCatalog({ ...catalog, models: [catalog.models[0], { id: 'media', protocols: ['speech', 'transcribe', 'asr_stream', 'embeddings', 'future_video'], capabilities: { speech: { nativeProfile: 'cosyvoice_native', stream: true, voices: ['sample'], endpoint: 'https://untrusted.invalid' }, transcribe: { nativeProfile: null }, asr_stream: { nativeProfile: 'https://unsafe.invalid' } } }, { id: 'future', protocols: ['future_video'] }] });
  const result = await h.service.pair(HARBOR, { baseUrl: 'https://harbor.example', code: code(HARBOR) });
  assert.deepEqual(result.catalog.models.map(model => model.id), ['luna', 'media']);
  assert.deepEqual(result.catalog.models[1].protocols, ['speech', 'transcribe', 'asr_stream', 'embeddings']);
  assert.deepEqual(result.catalog.models[1].capabilities.speech, { stream: true, voices: ['sample'], nativeProfile: 'cosyvoice_native' });
  assert.equal(result.catalog.models[1].capabilities.transcribe.nativeProfile, null);assert.equal(result.catalog.models[1].capabilities.asr_stream.nativeProfile, undefined);
});

test('paired object profiles reach real model and audio selection without exposing private descriptor fields', async t => {
  const h = await setup(t), speech = speechProfile(), asr = streamProfile(), privateMarker = ['fixture', 'private', 'metadata'].join('-');
  const advertised = mediaCatalog({ ...speech, endpoint: 'https://untrusted.invalid', apiKey: privateMarker, voice_map: { alloy: privateMarker },
    response_validation: { ...speech.response_validation, privateExtension: privateMarker } }, { ...asr, futureExtension: { privateMarker } });
  advertised.models.push({ id: 'future', protocols: ['future_video'], capabilities: { future_video: { nativeProfile: { endpoint: 'https://untrusted.invalid' } } } });
  h.f.setCatalog(advertised);
  const paired = await h.service.pair(HARBOR, { baseUrl: 'https://harbor.example', code: code(HARBOR) });
  assert.deepEqual(paired.catalog.models[1].capabilities.speech.nativeProfile, speech);
  assert.deepEqual(paired.catalog.models[2].capabilities.asr_stream.nativeProfile, asr);
  assert.ok(!JSON.stringify(paired).includes(privateMarker)); assert.ok(!JSON.stringify(paired).includes('untrusted.invalid'));
  paired.catalog.models[1].capabilities.speech.nativeProfile.voices[0] = 'changed-return-copy';
  assert.deepEqual((await h.service.status()).links[HARBOR].catalog.models[1].capabilities.speech.nativeProfile, speech);
  await h.reopen();
  const store = { state: { providers: [] }, async save() {} }, models = createServiceModels({ store, links: h.service });
  await models.synchronize();
  const captured = models.forProtocol('speech'); assert.deepEqual(captured.capabilities.nativeProfile, speech);
  assert.deepEqual(models.forProtocol('asr_stream').capabilities.nativeProfile, asr);
  const credential = await h.service.credential(HARBOR);
  assert.ok(!JSON.stringify(store.state).includes(credential.credential)); assert.ok(!JSON.stringify(await h.service.status()).includes(credential.credential));
  const wav = Buffer.alloc(44 + 4800); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(4800, 40); for (let offset = 44; offset < wav.length; offset += 2) wav.writeInt16LE(1000, offset);
  let calls = 0;
  const audio = createHarborAudioService({ serviceModels: models, cosyvoice: { publicConfig: () => ({ configured: false }), synthesize() { throw new Error('valid Harbor profile must not fall back'); } },
    async fetchImpl(url, options) { calls++; assert.equal(url, 'https://harbor.example/v1/audio/speech'); assert.equal(options.headers.Authorization, `Bearer ${credential.credential}`);
      assert.equal(JSON.parse(options.body).model, 'voice'); return new Response(wav, { headers: { 'Content-Type': 'audio/wav' } }); } });
  t.after(async () => { await audio.close(); await models.close(); });
  assert.equal(audio.publicConfig().source, 'api-harbor'); assert.ok(!JSON.stringify(audio.publicConfig()).includes(credential.credential));
  const result = await audio.synthesize({ userId: 'profile-fixture', text: 'Hello' });
  assert.equal(result.audioSource, 'api-harbor'); assert.equal(result.equals(wav), true); assert.equal(calls, 1);
  const transport = audio.resolveAsrTransport(); assert.equal(transport.url, 'wss://harbor.example/v1/stream'); assert.deepEqual(transport.profile, asr); transport.assertCurrent();
  const deleting = h.service.disconnect(HARBOR);
  assert.throws(() => captured.authorize(), /连接已变化/); assert.throws(() => transport.assertCurrent(), /连接或模型已变化/);
  assert.equal(models.forProtocol('speech'), undefined); await deleting; assert.equal(calls, 1);
});

test('invalid native objects are ignored per protocol while valid media, legacy metadata and text survive', async t => {
  const h = await setup(t); h.f.setCatalog(mediaCatalog()); await h.service.pair(HARBOR, { baseUrl: 'https://harbor.example', code: code(HARBOR) });
  const invalidSpeech = [[], {}, { voices: [] }, { voices: Array(33).fill('alloy') }, { voices: ['alloy', 'alloy'] }, { voices: ['a'.repeat(129)] }, { voices: ['bad\nvoice'] },
    { response_formats: [] }, { response_formats: ['unsafe'] }, { max_input_characters: 4097 }, { max_instruction_characters: -1 }, { max_response_bytes: 8 * 1024 * 1024 + 1 },
    { speed_min: '0.5' }, { speed_max: 5 }, { response_validation: { mode: 'unknown', sample_rate_hz: 24000, channels: 1 } },
    { response_validation: { mode: 'pcm16_wav_v1', sample_rate_hz: 48001, channels: 1 } }, { response_formats: ['wav_pcm16_v1'], response_validation: undefined },
    { adapter: 'future_adapter' }, { adapter: 'cosyvoice_sft', pcm_sample_rate: 24000, pcm_encoding: 's16le' }];
  for (const [index, patch] of invalidSpeech.entries()) {
    const profile = Array.isArray(patch) || !Object.keys(patch).length ? patch : { ...speechProfile(), ...patch };
    h.f.setCatalog(mediaCatalog(profile)); const result = await h.service.refresh(HARBOR);
    assert.equal(result.catalog.models[1].capabilities.speech.nativeProfile, undefined, `invalid speech ${index}`);
    assert.deepEqual(result.catalog.models[2].capabilities.asr_stream.nativeProfile, streamProfile()); assert.equal(result.catalog.models[0].id, 'luna');
  }
  const invalidAsr = [{ server_contract: 'future_contract' }, { input_format: 'wav' }, { checkpoint_sample_rate: 16000 }, { checkpoint_chunk_samples: 24000 },
    { max_input_milliseconds: 30001 }, { max_context_characters: -1 }, { max_tokens_per_chunk: 257 }, { max_response_bytes: 1024 * 1024 + 1 }];
  for (const patch of invalidAsr) {
    h.f.setCatalog(mediaCatalog(speechProfile(), { ...streamProfile(), ...patch })); const result = await h.service.refresh(HARBOR);
    assert.deepEqual(result.catalog.models[1].capabilities.speech.nativeProfile, speechProfile()); assert.equal(result.catalog.models[2].capabilities.asr_stream.nativeProfile, undefined);
    assert.equal(result.catalog.models[0].id, 'luna');
  }
  const cosy = { ...speechProfile(), voices: ['cosy-sft-demo'], adapter: 'cosyvoice_sft', pcm_sample_rate: 24000, pcm_encoding: 's16le',
    max_instruction_characters: 0, speed_min: 1, speed_max: 1 }; delete cosy.response_validation;
  h.f.setCatalog(mediaCatalog(cosy, { ...streamProfile(), checkpoint_chunk_samples: 70400 }));
  const result = await h.service.refresh(HARBOR); assert.deepEqual(result.catalog.models[1].capabilities.speech.nativeProfile, cosy);
  assert.equal(result.catalog.models[2].capabilities.asr_stream.nativeProfile.checkpoint_chunk_samples, 70400);
});

test('same-identity capability catalog updates fence previously captured runtime credentials before model synchronization',async t=>{
 const h=await setup(t);await h.service.pair(HARBOR,{baseUrl:'https://harbor.example',code:code(HARBOR)});const before=await h.service.credential(HARBOR);assert.equal(h.service.isReady(HARBOR,before),true);
 h.f.setCatalog({...catalog,models:[{...catalog.models[0],capabilities:{responses:{tools:false}}}]});await h.service.refresh(HARBOR);const after=await h.service.credential(HARBOR);
 assert.equal(after.credential,before.credential);assert.equal(after.connectionId,before.connectionId);assert.notEqual(after.catalogRevision,before.catalogRevision);assert.equal(h.service.isReady(HARBOR,before),false);assert.equal(h.service.isReady(HARBOR,after),true);
});

test('unknown protocols do not excuse invalid catalog schema, duplicate or unsafe model identity', async t => {
  const h = await setup(t);
  for (const value of [{ ...catalog, schema: 'wrong' }, { ...catalog, models: [{ id: 'bad\nmodel', protocols: ['future_video'] }] }, { ...catalog, models: [catalog.models[0], catalog.models[0]] }]) {
    h.f.setCatalog(value);
    await assert.rejects(h.service.pair(HARBOR, { baseUrl: 'https://harbor.example', code: code(HARBOR) }), /INVALID_CATALOG/);
  }
});

test('disconnect fences credentials before DELETE completes and recovery resumes the original operation', async t => {
  const h = await setup(t); await h.service.pair(HARBOR, { baseUrl: 'https://harbor.example', code: code(HARBOR) });
  const original = await h.service.credential(HARBOR);let rejectDelete;
  h.f.setBroken(call => call.method === 'DELETE' ? new Promise((_resolve,reject) => { rejectDelete = reject; }) : undefined);
  const deleting = h.service.disconnect(HARBOR),handled=assert.rejects(deleting,/SERVICE_LINK_UNAVAILABLE/);
  assert.equal(h.service.isReady(HARBOR, original), false);
  await assert.rejects(h.service.credential(HARBOR), /NOT_READY/);
  while (!rejectDelete) await new Promise(resolve => setTimeout(resolve, 1));
  rejectDelete(new Error('lost delete receipt'));await handled;
  assert.equal((await h.service.status()).links[HARBOR].state, 'revoking');
  const firstDelete=h.f.calls.find(call=>call.method==='DELETE');await h.reopen();h.f.setBroken(null);
  assert.equal((await h.service.refresh(HARBOR)).state, 'revoked');
  const lastDelete=h.f.calls.filter(call=>call.method==='DELETE').at(-1);assert.deepEqual(lastDelete,firstDelete);
});
test('revocation is persisted before delivery and retries DELETE after restart', async t => {
  const h = await setup(t); await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  h.f.setBroken(call => { if (call.method === 'DELETE') throw new Error('offline'); });
  await assert.rejects(h.service.disconnect(DP));
  assert.equal((await h.service.status()).links[DP].state, 'revoking');
  await assert.rejects(h.service.request(DP, '/v1/hosts'), /NOT_READY/);
  await h.reopen(); h.f.setBroken(null); assert.equal((await h.service.refresh(DP)).state, 'revoked');
});
test('only a confirmed revocation permits a fresh platform registration identity', async t => {
  const h = await setup(t); await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  const original = h.f.calls[0].body;
  h.f.setBroken(call => call.method === 'DELETE' ? new Response('{}') : undefined);
  await assert.rejects(h.service.disconnect(DP), /INVALID_RECEIPT/);
  assert.equal((await h.service.status()).links[DP].state, 'revoking');
  h.f.setBroken(null); await h.service.refresh(DP);
  await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  const newPair = h.f.calls.filter(call => call.url.endsWith('/v1/pair')).at(-1).body;
  assert.notEqual(newPair.instanceId, original.instanceId); assert.notEqual(newPair.credential, original.credential);
});
test('Harbor permanent revocation proof must bind issuer, receiver, original operation and connection', async t => {
  const h = await setup(t); await h.service.pair(HARBOR, { baseUrl: 'https://harbor.example', code: code(HARBOR) });
  const exchange = h.f.calls[0].body;
  const proof = { schema: 'service-link-revocation.v1', issuerType: 'api-harbor', issuerInstanceId: 'issuer-1', connectionId, receiverType: 'petpal', receiverInstanceId: exchange.receiverInstanceId, redemptionId: exchange.redemptionId, state: 'revoked' };
  h.f.setBroken(() => new Response(JSON.stringify({ error: { code: 'service_link_connection_revoked', details: { ...proof, redemptionId: 'wrong' } } }), { status: 401 }));
  await assert.rejects(h.service.refresh(HARBOR)); assert.equal((await h.service.status()).links[HARBOR].state, 'offline');
  h.f.setBroken(() => new Response(JSON.stringify({ error: { code: 'service_link_connection_revoked', details: proof } }), { status: 401 }));
  await assert.rejects(h.service.refresh(HARBOR)); assert.equal((await h.service.status()).links[HARBOR].state, 'revoked');
});
test('missing master key fails closed without creating replacement identity', async t => {
  const h = await setup(t); await h.service.close();
  await unlink(path.join(h.dataDir, 'service-links', 'master.key'));
  await assert.rejects(createServiceLinks({ dataDir: h.dataDir }), /STORAGE_RECOVERY_REQUIRED/);
  await assert.rejects(readFile(path.join(h.dataDir, 'service-links', 'master.key')), { code: 'ENOENT' });
});
test('authenticated ciphertext tampering cannot reset or reveal the saved connection', async t => {
  const h = await setup(t); await h.service.close();
  const filename = path.join(h.dataDir, 'service-links', 'links.json');
  const envelope = JSON.parse(await readFile(filename, 'utf8'));
  const encrypted = Buffer.from(envelope.ciphertext, 'base64'); encrypted[0] ^= 1;
  envelope.ciphertext = encrypted.toString('base64'); await writeFile(filename, JSON.stringify(envelope));
  await assert.rejects(createServiceLinks({ dataDir: h.dataDir }), /STORAGE_RECOVERY_REQUIRED/);
});
test('retained key without encrypted state requires recovery rather than a new instance', async t => {
  const h = await setup(t); await h.service.close(); await unlink(path.join(h.dataDir, 'service-links', 'links.json'));
  await assert.rejects(createServiceLinks({ dataDir: h.dataDir }), /STORAGE_RECOVERY_REQUIRED/);
});
test('platform request validates the expected client before sending and after awaiting response', async t => {
  const h = await setup(t); await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  const { clientId } = await h.service.credential(DP); const count = h.f.calls.length;
  await assert.rejects(h.service.request(DP, '/v1/hosts', { expectedClientId: randomUUID() }), /cloud_docker_identity_changed/);
  assert.equal(h.f.calls.length, count);
  let finish;
  h.f.setBroken(call => call.url.endsWith('/v1/hosts') ? new Promise(resolve => { finish = () => resolve(new Response('{"hosts":[]}')); }) : undefined);
  const pending = h.service.request(DP, '/v1/hosts', { expectedClientId: clientId });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  await h.service.disconnect(DP); finish();
  await assert.rejects(pending, /cloud_docker_identity_changed/);
});
test('oversize and malformed responses are sanitized without public upstream diagnostics', async t => {
  const h = await setup(t); h.f.setBroken(() => new Response('secret-not-json'));
  await assert.rejects(h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) }), /INVALID_RESPONSE/);
  assert.ok(!JSON.stringify(await h.service.status()).includes('secret-not-json'));
  h.f.setBroken(() => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024) } }));
  await assert.rejects(h.service.refresh(DP), /INVALID_RESPONSE/);
});
test('private request cannot send credential to another origin or traversal endpoint', async t => {
  const h = await setup(t); await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  for (const suffix of ['https://evil.example', '//evil.example', '/v1/../bad', '/v1/%2e%2e/bad']) await assert.rejects(h.service.request(DP, suffix), /INVALID_PATH/);
  assert.deepEqual(await h.service.request(DP, '/v1/hosts'), { hosts: [] });
});
test('fixed Docker protocol error codes remain usable without reflecting diagnostic bodies', async t => {
  const h = await setup(t); await h.service.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  h.f.setBroken(() => new Response(JSON.stringify({ errorCode: 'file_exists', message: 'secret native path' }), { status: 409 }));
  await assert.rejects(h.service.request(DP, '/v1/projects'), error => error.code === 'file_exists' && error.message === 'file_exists');
});
test('close aborts an in-flight request and never saves a late result', async t => {
  const h = await setup(t); let observed;
  h.f.setBroken(call => { if (call.url.endsWith('/v1/pair')) return new Promise(() => {}); });
  const fetchImpl = (url, options) => new Promise((resolve, reject) => { observed = options.signal; options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
  const otherDir = await mkdtemp(path.join(os.tmpdir(), 'petpal-links-close-'));
  const other = await createServiceLinks({ dataDir: otherDir, fetchImpl });
  const pending = other.pair(DP, { baseUrl: 'http://localhost:9780', code: code(DP) });
  while (!observed) await new Promise(resolve => setTimeout(resolve, 1));
  const handled = assert.rejects(pending, /SERVICE_LINK_CLOSED/);
  await other.close(); await handled; assert.equal(observed.aborted, true);
  await rm(otherDir, { recursive: true, force: true });
});
