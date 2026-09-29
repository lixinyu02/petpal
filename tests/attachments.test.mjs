import { listenFixture } from './helpers/loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, link, unlink, symlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { createAttachmentService, inspectImage, validateStoredAttachments, IMAGE_LIMIT, USER_IMAGE_LIMIT, USER_IMAGE_COUNT } from '../server/attachments.mjs';

const bootstrap = 'isolated-attachment-owner-token';
function png(width = 1, height = 1) {
  const chunk = (name, data) => { const result = Buffer.alloc(12 + data.length); result.writeUInt32BE(data.length); result.write(name, 4); data.copy(result, 8); let crc = 0xffffffff; for (const byte of result.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; } result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
const picture = png();
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQgJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+UP38//Z', 'base64');
async function until(check) { for (let i = 0; i < 250; i++) { const result = await check(); if (result) return result; await delay(5); } assert.fail('Attachment state did not settle'); }


async function fixture(t, { bridge } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-attachments-')), received = [];
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    received.push({ path: req.url, body: JSON.parse(raw) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.endsWith('/responses') ? { status: 'completed', output_text: 'image fixture reply' } : { choices: [{ message: { content: 'image fixture reply' }, finish_reason: 'stop' }] }));
  });
  await listenFixture(upstream);
  const calls = [], steers = [];
  const codex = bridge ?? { async status() { return { available: true }; }, run(args) { return new Promise((resolve, reject) => { calls.push({ args, resolve, reject }); args.onEvent('turn', { turnId: `image-turn-${calls.length}` }); args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true }); }); }, async steer(args) { steers.push(args); return { turnId: args.expectedTurnId }; }, async close() { for (const call of calls) call.reject(new Error('Fixture close')); } };
  let app = await createPetServer({ dataDir: directory, token: bootstrap, codex });
  await listenFixture(app.server);
  const base = () => `http://127.0.0.1:${app.server.address().port}`;
  const request = (route, { token = bootstrap, method = 'GET', body, raw, mimeType = 'image/png' } = {}) => fetch(base() + '/api' + route, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': raw !== undefined ? mimeType : 'application/json' }, ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (route, options) => { const response = await request(route, options); return { status: response.status, data: await response.json() }; };
  const upload = async (token = bootstrap, raw = picture, mimeType = 'image/png') => { const result = await json('/attachments', { token, method: 'POST', raw, mimeType }); assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data; };
  const provider = async (protocol, extra = {}) => { const result = await json('/providers', { method: 'POST', body: { name: protocol, model: 'vision-fixture', protocol, baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, ...extra } }); assert.equal(result.status, 200); return result.data; };
  const create = async (providerId, token = bootstrap, mode = 'chat') => { const result = await json('/conversations', { token, method: 'POST', body: { mode, ...(providerId ? { providerId } : {}) } }); assert.equal(result.status, 201); return result.data; };
  const member = async name => { const created = await json('/admin/users', { method: 'POST', body: { username: name, password: 'isolated-attachment-password', agentAccess: 'full' } }); assert.equal(created.status, 201); const login = await json('/auth/login', { method: 'POST', token: '', body: { username: name, password: 'isolated-attachment-password' } }); assert.equal(login.status, 200); return { user: created.data.user, token: login.data.token }; };
  t.after(async () => { await app.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-attachments-'))); await rm(directory, { recursive: true, force: true }); });
  return { directory, base, request, json, upload, provider, create, member, received, calls, steers,
    restart: async () => { await app.close(); app = await createPetServer({ dataDir: directory, token: bootstrap, codex }); await listenFixture(app.server); },
  };
}

test('PNG/JPEG/WebP headers and dimensions validate, bad magic/truncation/CRC/limits/SVG reject', () => {
  assert.deepEqual(inspectImage(picture, 'image/png'), { mimeType: 'image/png', size: picture.length, width: 1, height: 1 });
  assert.equal(inspectImage(webp, 'image/webp').width, 1);
  assert.deepEqual(inspectImage(jpeg, 'image/jpeg'), { mimeType: 'image/jpeg', size: jpeg.length, width: 1, height: 1 });
  for (const [bytes, mime] of [[Buffer.from('<svg/>'), 'image/png'], [picture, 'image/jpeg'], [picture.subarray(0, -3), 'image/png'], [Buffer.concat([picture, Buffer.from('extra')]), 'image/png'], [webp.subarray(0, -1), 'image/webp']]) assert.throws(() => inspectImage(bytes, mime), { status: 400 });
  const corrupt = Buffer.from(picture); corrupt[32] ^= 1; assert.throws(() => inspectImage(corrupt, 'image/png'), { status: 400 });
  assert.throws(() => inspectImage(png(8193, 1), 'image/png'), /8192/);
  assert.throws(() => inspectImage(png(8192, 8192), 'image/png'), /32MP/);
  assert.throws(() => inspectImage(Buffer.alloc(IMAGE_LIMIT + 1), 'image/png'), { status: 413 });
  assert.throws(() => inspectImage(Buffer.from('<svg/>'), 'image/svg+xml'), { status: 415 });
});

test('reused image IDs count toward a bounded aggregate history before any disk reads', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-image-context-')); t.after(async () => { assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-image-context-'))); await rm(directory, { recursive: true, force: true }); });
  const store = await new JsonStore(directory).init(), service = await createAttachmentService({ store, dataDir: directory });
  const userId = store.state.ownerId, uploaded = await service.upload(userId, picture, 'image/png', () => {});
  const repeated = count => Array.from({ length: count }, () => ({ role: 'user', content: '', attachmentIds: [uploaded.id] }));
  await unlink(path.join(directory, 'attachments', `${uploaded.id}.png`));
  await assert.rejects(service.messages(userId, repeated(17)), { status: 400 });
  store.state.attachments[0].size = IMAGE_LIMIT;
  await assert.rejects(service.messages(userId, repeated(5)), { status: 400 });
  assert.throws(() => service.metadata(userId, [uploaded.id, uploaded.id]), { status: 400 });
  assert.throws(() => service.metadata(userId, Array.from({ length: 5 }, randomUUID)), { status: 400 });
});

test('raw uploads require authentication before reading bodies and preserve owned bytes across restart', async t => {
  const f = await fixture(t);
  const denied = await new Promise((resolve, reject) => {
    const req = http.request(`${f.base()}/api/attachments`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'Content-Length': IMAGE_LIMIT } }, response => { resolve(response.statusCode); response.resume(); req.destroy(); });
    req.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); }); req.setTimeout(2000, () => { req.destroy(); reject(new Error('Unauthenticated upload waited for a body')); }); req.flushHeaders();
  });
  assert.equal(denied, 401); assert.deepEqual(await readdir(path.join(f.directory, 'attachments')), []);
  const image = await f.upload(); assert.equal(image.size, picture.length); assert.equal(image.mimeType, 'image/png'); assert.equal(image.width, 1);
  assert.deepEqual(Object.keys(image).sort(), ['height', 'id', 'mimeType', 'name', 'size', 'width']);
  let response = await f.request(`/attachments/${image.id}`); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png'); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), picture);
  await f.restart(); response = await f.request(`/attachments/${image.id}`); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), picture);
});

test('other users cannot fetch or attach uploaded IDs and malformed uploads never enter storage', async t => {
  const f = await fixture(t), alice = await f.member('imagealice'), bob = await f.member('imagebob');
  const image = await f.upload(alice.token), chat = await f.create(null, bob.token, 'codex');
  assert.equal((await f.request(`/attachments/${image.id}`, { token: bob.token })).status, 404);
  assert.equal((await f.request(`/attachments/${image.id}`)).status, 404, 'owner cannot read another user image through the attachment API');
  const blocked = await f.json(`/conversations/${chat.id}/agent/submit`, { token: bob.token, method: 'POST', body: { submissionId: randomUUID(), attachmentIds: [image.id] } }); assert.equal(blocked.status, 404); assert.equal(f.calls.length, 0);
  for (const [raw, mimeType, status] of [[Buffer.from('<svg/>'), 'image/svg+xml', 415], [picture, 'image/jpeg', 400], [Buffer.alloc(0), 'image/png', 400], [Buffer.alloc(IMAGE_LIMIT + 1), 'image/png', 413]]) assert.equal((await f.request('/attachments', { method: 'POST', raw, mimeType })).status, status);
  assert.equal((await readdir(path.join(f.directory, 'attachments'))).length, 1);
});

for (const protocol of ['chat-completions', 'responses']) test(`${protocol} sends actual owned image bytes in pure-image input and all follow-up history`, async t => {
  const f = await fixture(t), provider = await f.provider(protocol), chat = await f.create(provider.id), image = await f.upload();
  const route = `/conversations/${chat.id}/messages`;
  let response = await f.request(route, { method: 'POST', body: { attachmentIds: [image.id] } }); assert.equal(response.status, 200); assert.match(await response.text(), /event: done/);
  const first = f.received[0].body, messages = protocol === 'responses' ? first.input : first.messages;
  const part = messages.find(message => message.role === 'user').content[0];
  assert.deepEqual(part, protocol === 'responses' ? { type: 'input_image', image_url: `data:image/png;base64,${picture.toString('base64')}` } : { type: 'image_url', image_url: { url: `data:image/png;base64,${picture.toString('base64')}` } });
  response = await f.request(route, { method: 'POST', body: { content: 'Remember the image' } }); assert.match(await response.text(), /event: done/);
  const next = protocol === 'responses' ? f.received[1].body.input : f.received[1].body.messages; assert.deepEqual(next.find(message => message.role === 'user').content[0], part); assert.equal(next.at(-1).content, 'Remember the image');
  const visible = (await f.json(`/conversations/${chat.id}`)).data;
  assert.equal(visible.messages[0].content, ''); assert.deepEqual(visible.messages[0].attachments, [image]); assert.doesNotMatch(JSON.stringify(visible), /data:image|base64|sessionHash|[A-Z]:\\/);
  await f.restart(); const restored = (await f.json(`/conversations/${chat.id}`)).data; assert.deepEqual(restored.messages[0].attachments, [image]);
});

test('text-only model switching and sends reject before discarding image history', async t => {
  const f = await fixture(t), vision = await f.provider('responses'), text = await f.provider('responses', { model: 'halogen-qwen3.8-flash-next', supportsImages: true });
  assert.equal(text.supportsImages, false); const chat = await f.create(vision.id), image = await f.upload();
  await (await f.request(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: 'Inspect', attachmentIds: [image.id] } })).text();
  assert.equal((await f.json(`/conversations/${chat.id}`, { method: 'PATCH', body: { providerId: text.id } })).status, 400);
  const unchanged = (await f.json(`/conversations/${chat.id}`)).data; assert.equal(unchanged.providerId, vision.id); assert.deepEqual(unchanged.messages[0].attachments, [image]);
  const textChat = await f.create(text.id); assert.equal((await f.json(`/conversations/${textChat.id}/messages`, { method: 'POST', body: { attachmentIds: [image.id] } })).status, 400);
  assert.equal((await f.json(`/conversations/${textChat.id}`)).data.messages.length, 0); assert.equal(f.received.length, 1);
});

test('Agent run, steer, queued edits and restart use owned paths and retain image metadata', async t => {
  const f = await fixture(t), chat = await f.create(null, bootstrap, 'codex'), first = await f.upload(), second = await f.upload(bootstrap, webp, 'image/webp');
  const route = `/conversations/${chat.id}/agent`, submit = async body => f.json(`${route}/submit`, { method: 'POST', body: { submissionId: randomUUID(), ...body } });
  assert.equal((await submit({ attachmentIds: [first.id] })).status, 200); await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].args.prompt, ''); assert.equal(f.calls[0].args.images.length, 1); assert.equal(path.dirname(f.calls[0].args.images[0].path), path.join(f.directory, 'attachments')); assert.deepEqual(await readFile(f.calls[0].args.images[0].path), picture);
  const steer = await f.json(`${route}/steer`, { method: 'POST', body: { submissionId: randomUUID(), expectedTurnId: 'image-turn-1', attachmentIds: [second.id] } }); assert.equal(steer.status, 200); assert.equal(steer.data.submission.status, 'steered'); assert.deepEqual(await readFile(f.steers[0].images[0].path), webp);
  const queued = await submit({ content: 'queued image', attachmentIds: [first.id] }); const entry = queued.data.conversation.agent.queue[0];
  const edited = await f.json(`${route}/queue/${entry.id}`, { method: 'PATCH', body: { revision: entry.revision, content: '', attachmentIds: [second.id] } }); assert.equal(edited.status, 200); assert.deepEqual(edited.data.conversation.agent.queue[0].attachmentIds, [second.id]);
  await f.restart(); const state = (await f.json(`/conversations/${chat.id}`)).data; assert.deepEqual(state.agent.queue[0].attachmentIds, [second.id]); assert.equal(state.agent.paused, true); assert.deepEqual(state.messages[0].attachments, [first]);
  await f.json(`${route}/queue/resume`, { method: 'POST', body: {} }); await until(() => f.calls.length === 2); assert.equal(f.calls[1].args.prompt, ''); assert.deepEqual(await readFile(f.calls[1].args.images[0].path), webp);
});

test('a missing file produces a recoverable error while retaining owned message metadata', async t => {
  const f = await fixture(t), provider = await f.provider('responses'), chat = await f.create(provider.id), image = await f.upload();
  await unlink(path.join(f.directory, 'attachments', `${image.id}.png`));
  const response = await f.request(`/conversations/${chat.id}/messages`, { method: 'POST', body: { attachmentIds: [image.id] } }); const stream = await response.text(); assert.match(stream, /event: error/); assert.doesNotMatch(stream, /event: done/);
  const visible = (await f.json(`/conversations/${chat.id}`)).data; assert.deepEqual(visible.messages[0].attachments, [image]); assert.equal(visible.messages.at(-1).status, 'error'); assert.equal(f.received.length, 0);
});

test('storage quotas include unsubmitted images and indexes reject cross-user/path corruption', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-attachment-quota-')); t.after(async () => { assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-attachment-quota-'))); await rm(directory, { recursive: true, force: true }); });
  const store = await new JsonStore(directory).init(), userId = store.state.ownerId, service = await createAttachmentService({ store, dataDir: directory });
  const uploaded = await service.upload(userId, picture, 'image/png', () => {}); assert.equal(store.state.conversations.length, 0); assert.equal(store.state.attachments.length, 1);
  const sample = store.state.attachments[0];
  store.state.attachments = Array.from({ length: USER_IMAGE_COUNT }, () => ({ ...sample, id: randomUUID() })); assert.throws(() => service.begin(userId), { status: 413 });
  store.state.attachments = Array.from({ length: USER_IMAGE_LIMIT / IMAGE_LIMIT }, () => ({ ...sample, id: randomUUID(), size: IMAGE_LIMIT }));
  store.state.attachments.push({ ...sample, id: randomUUID(), size: IMAGE_LIMIT / 2 }); assert.throws(() => service.begin(userId), { status: 413 });
  store.state.attachments = [{ ...sample, id: uploaded.id, path: 'C:/private-file' }]; assert.throws(() => validateStoredAttachments(store.state), /无效/);
  store.state.attachments = [{ ...sample, userId: 'unknown-owner' }]; assert.throws(() => validateStoredAttachments(store.state), /无效/);
  store.state.attachments = [sample]; const release1 = service.begin(userId), release2 = service.begin(userId); assert.throws(() => service.begin(userId), { status: 429 }); release1(); release1(); const release3 = service.begin(userId); release2(); release3();
});

test('hard-linked files and symlinked attachment directories cannot become model inputs', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-attachment-path-')); t.after(async () => { assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-attachment-path-'))); await rm(directory, { recursive: true, force: true }); });
  const store = await new JsonStore(directory).init(), service = await createAttachmentService({ store, dataDir: directory }), userId = store.state.ownerId;
  const uploaded = await service.upload(userId, picture, 'image/png', () => {}), filename = path.join(directory, 'attachments', `${uploaded.id}.png`);
  const outside = path.join(directory, 'other.png'); await link(filename, outside); await assert.rejects(service.images(userId, [uploaded.id]), { status: 409 }); await unlink(outside);
  const separate = path.join(directory, 'separate'); await mkdir(separate); const linkedData = path.join(directory, 'linked-data'); await mkdir(linkedData);
  await symlink(separate, path.join(linkedData, 'attachments'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createAttachmentService({ store, dataDir: linkedData }), /符号链接/);
});

test('logout during an upload rollback leaves neither a record nor unowned file', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-attachment-revoke-')); t.after(async () => { assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-attachment-revoke-'))); await rm(directory, { recursive: true, force: true }); });
  const store = await new JsonStore(directory).init(), service = await createAttachmentService({ store, dataDir: directory }); let checks = 0;
  await assert.rejects(service.upload(store.state.ownerId, picture, 'image/png', () => { if (++checks > 1) throw Object.assign(new Error('Logged out'), { status: 401 }); }), { status: 401 });
  assert.deepEqual(store.state.attachments, []); assert.deepEqual(await readdir(path.join(directory, 'attachments')), []);
});
