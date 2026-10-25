import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMemobaseClient, memoryJson, normalizeMemobaseUrl } from '../server/memobase-client.mjs';

const ok = data => Response.json({ errno: 0, errmsg: '', data });
const token = 'synthetic-only-memory-key';

test('profile reads validate rows and only expose allowed fields; deletion is scoped and idempotent',async()=>{
 const user=randomUUID(),id=randomUUID(),calls=[];let malformed=false;
 const client=createMemobaseClient({baseUrl:'http://memory.test',apiKey:token,fetchImpl:async(url,options)=>{
  calls.push({url,options});if(options.method==='DELETE')return Response.json({errno:404,errmsg:'private'});
  return ok({profiles:[{id:malformed?'../other':id,content:'合成偏好',attributes:{topic:'偏好',sub_topic:'饮品',private:'not exposed'},created_at:'2025-01-01T00:00:00Z',updated_at:'2025-01-02T00:00:00Z',internal:'not exposed'}]});
 }});
 assert.deepEqual(await client.profiles(user),[{id,content:'合成偏好',topic:'偏好',subtopic:'饮品',createdAt:'2025-01-01T00:00:00.000Z',updatedAt:'2025-01-02T00:00:00.000Z'}]);
 await client.deleteProfile(user,id);assert.equal(new URL(calls[1].url).pathname,`/api/v1/users/profile/${user}/${id}`);assert.equal(calls[1].options.method,'DELETE');assert.equal(calls[1].options.redirect,'error');
 malformed=true;await assert.rejects(client.profiles(user),{code:'MEMORY_INVALID_RESPONSE'});
 await assert.rejects(client.deleteProfile(user,'../other'),{code:'MEMORY_INVALID_ID'});
});

test('Memobase URL and Bearer configuration reject credential-bearing or non-HTTP URLs', () => {
  assert.equal(normalizeMemobaseUrl('http://127.0.0.1:8019/api/v1/'), 'http://127.0.0.1:8019');
  for (const value of ['file:///tmp/private', 'https://user:password@example.test', 'https://example.test/?api_key=private', 'https://example.test/#token']) assert.throws(() => normalizeMemobaseUrl(value), { code: 'MEMORY_INVALID_URL' });
  assert.throws(() => createMemobaseClient({ baseUrl: 'http://127.0.0.1', apiKey: 'bad\r\nprivate' }), { code: 'MEMORY_MISSING_KEY' });
});

test('Memobase checks errno in HTTP 200 responses and never echoes upstream secrets', async () => {
  const client = createMemobaseClient({ baseUrl: 'http://memory.test', apiKey: token, fetchImpl: async () => Response.json({ errno: 401, errmsg: token }) });
  await assert.rejects(client.context(randomUUID()), error => error.status === 401 && error.code === 'MEMORY_API_ERROR' && !JSON.stringify(error).includes(token) && !error.message.includes(token));
  const invalid = createMemobaseClient({ baseUrl: 'http://memory.test', apiKey: token, fetchImpl: async () => Response.json({ context: 'not an envelope' }) });
  await assert.rejects(invalid.context(randomUUID()), { code: 'MEMORY_API_ERROR' });
});

test('Memobase ensures a deterministic UUID user and sends only supported chat text', async () => {
  const uid = randomUUID(), bid = randomUUID(), calls = [];
  const client = createMemobaseClient({ baseUrl: 'http://memory.test', apiKey: token, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return Response.json({ errno: 404, errmsg: 'not found' });
    return ok({ id: calls.length === 2 ? uid : bid });
  } });
  await client.ensureUser(uid);
  assert.equal(JSON.parse(calls[1].options.body).id, uid);
  assert.equal(await client.insert(uid, { id: 'event-one', epoch: 2, fingerprint: 'fingerprint', userText: '我喜欢绿茶', assistantText: '记住了', private: 'not sent' }), bid);
  const body = JSON.parse(calls[2].options.body);
  assert.deepEqual(body.blob_data.messages, [{ role: 'user', content: '我喜欢绿茶' }, { role: 'assistant', content: '记住了' }]);
  assert.deepEqual(body.fields, { source: 'petpal', eventId: 'event-one', epoch: 2, payloadHash: 'fingerprint' });
  assert.equal(calls[2].options.redirect, 'error'); assert.equal(calls[2].options.headers.Authorization, `Bearer ${token}`);
});

test('Memobase timestamps every message and only historical inserts wait for extraction with a bounded long deadline', async t => {
  const calls=[],timeouts=[],schedule=globalThis.setTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>{timeouts.push(ms);return schedule(callback,ms,...args);});
  const client=createMemobaseClient({baseUrl:'http://memory.test',apiKey:token,fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return ok({id:randomUUID()});}});
  const createdAt='2018-07-20T10:00:00.000Z',value={id:'ordinary-dated',epoch:1,fingerprint:'fixed',userText:'历史自述',assistantText:'历史回复',createdAt};
  await client.insert(randomUUID(),value);await client.insert(randomUUID(),{...value,id:'history.wechat:dated'});
  assert.equal(new URL(calls[0].url).searchParams.get('wait_process'),'false');assert.equal(new URL(calls[1].url).searchParams.get('wait_process'),'true');
  assert.deepEqual(timeouts,[10000,120000]);
  for(const call of calls){assert.deepEqual(call.body.blob_data.messages.map(m=>m.created_at),[createdAt,createdAt]);assert.equal(call.body.fields.sourceCreatedAt,createdAt);}
});

test('historical extraction deadline aborts the request and exposes only a safe timeout',async t=>{
  const timeouts=[],schedule=globalThis.setTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>{timeouts.push(ms);return schedule(callback,ms===120000?1:ms,...args);});
  let signal;
  const client=createMemobaseClient({baseUrl:'http://memory.test',apiKey:token,fetchImpl:async(_url,options)=>new Promise((_,reject)=>{
    signal=options.signal;const abort=()=>reject(new Error(token));
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  })});
  // Keep one referenced handle because memoryJson deliberately unrefs its timer.
  const hold=schedule(()=>{},1000);t.after(()=>clearTimeout(hold));
  await assert.rejects(client.insert(randomUUID(),{id:'history.wechat:deadline',epoch:1,fingerprint:'fixed',userText:'合成历史自述',assistantText:'',createdAt:'2020-01-01T00:00:00.000Z'}),error=>error.code==='MEMORY_TIMEOUT'&&error.status===504&&!error.message.includes(token));
  assert.deepEqual(timeouts,[120000]);assert.equal(signal.aborted,true);
});

test('Memobase buffer inspection validates identities and reports idle, processing and failed separately',async()=>{
  const id=randomUUID(),seen=[];let invalid=false;
  const client=createMemobaseClient({baseUrl:'http://memory.test',apiKey:token,fetchImpl:async url=>{const status=new URL(url).searchParams.get('status');seen.push(status);return ok({ids:invalid?[id,id]:status==='processing'?[id]:[]});}});
  assert.deepEqual(await client.bufferStatus(randomUUID()),{idle:0,processing:1,failed:0});assert.deepEqual(seen,['idle','processing','failed']);
  invalid=true;await assert.rejects(client.bufferStatus(randomUUID()),{code:'MEMORY_INVALID_RESPONSE'});
});

test('Memobase ambiguous create is resolved by GET rather than repeated POST', async () => {
  const calls = [], uid = randomUUID();
  const client = createMemobaseClient({ baseUrl: 'http://memory.test', apiKey: token, fetchImpl: async (url, options) => { calls.push(options.method); if (calls.length === 1) return Response.json({ errno: 404 }); if (options.method === 'POST') throw new Error(token); return ok({ data: {} }); } });
  await client.ensureUser(uid); assert.deepEqual(calls, ['GET','POST','GET']);
});

test('Memobase unknown write lookup confirms event, epoch and fingerprint, including pagination', async () => {
  const uid = randomUUID(), blobIds = Array.from({ length: 51 }, () => randomUUID()), event = { id: 'stable-event', epoch: 3, fingerprint: 'expected' };
  const client = createMemobaseClient({ baseUrl: 'http://memory.test', apiKey: token, fetchImpl: async url => {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/users/blobs/')) return ok({ ids: parsed.searchParams.get('page') === '0' ? blobIds.slice(0,50) : blobIds.slice(50) });
    return ok({ fields: parsed.pathname.endsWith(blobIds[50]) ? { source: 'petpal', eventId: event.id, epoch: 3, payloadHash: 'expected' } : { source: 'petpal', eventId: event.id, epoch: 2, payloadHash: 'expected' } });
  } });
  assert.deepEqual(await client.findEvent(uid, event), { found: true, id: blobIds[50] });
  await assert.rejects(client.findEvent(uid, { ...event, fingerprint: 'wrong' }), { code: 'MEMORY_EVENT_CONFLICT' });
});

test('Memobase transport supports caller cancellation and bounded response sizes without leaking errors', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(memoryJson(async () => { throw new Error(token); }, 'http://memory.test', { token, signal: controller.signal }), { code: 'MEMORY_CANCELLED' });
  await assert.rejects(memoryJson(async () => { throw new Error(token); }, 'http://memory.test', { token }), error => error.code === 'MEMORY_UNAVAILABLE' && !error.message.includes(token));
  await assert.rejects(memoryJson(async () => new Response('secret', { headers: { 'content-length': '9999999' } }), 'http://memory.test', { token }), { code: 'MEMORY_INVALID_RESPONSE' });
  await assert.rejects(memoryJson(async () => new Response(token), 'http://memory.test', { token }), { code: 'MEMORY_INVALID_RESPONSE' });
});

test('Memobase deletion treats an absent user as already cleared', async () => {
  const client = createMemobaseClient({ baseUrl: 'http://memory.test', apiKey: token, fetchImpl: async () => Response.json({ errno: 404 }) });
  await client.deleteUser(randomUUID());
});
