import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {JsonStore,defaultSettings} from '../server/store.mjs';
import {newSession} from '../server/auth.mjs';
import {defaultVoiceSettings} from '../server/voice.mjs';
import {createPetServer} from '../server/app.mjs';
import {listenFixture} from './helpers/loopback.mjs';

const synthetic='proxies: [{name: 东京, type: socks5, server: fixture.example.test, port: 1080, password: synthetic-http-profile-password}]\nproxy-groups: [{name: 地点, type: select, proxies: [DIRECT, 东京]}]\nrules: ["MATCH,地点"]\n';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function fixture(t,options={}){
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-proxy-profile-http-')),store=await new JsonStore(directory).init();
  const ownerId=store.state.ownerId,user={id:randomUUID(),username:'profile-user',displayName:'测试用户',role:'user',agentAccess:'full',disabled:false,providerIds:[],password:null,settings:defaultSettings(),voice:defaultVoiceSettings(),createdAt:new Date().toISOString()};
  const delegated={...user,id:randomUUID(),username:'profile-admin',displayName:'测试管理员',role:'admin',providerIds:[],settings:defaultSettings(),voice:defaultVoiceSettings()};
  store.state.users.push(user,delegated);const userSession=newSession(user.id),adminSession=newSession(ownerId),delegatedSession=newSession(delegated.id);store.state.sessions.push(userSession.session,adminSession.session,delegatedSession.session);await store.save();
  const app=await createPetServer({dataDir:directory,token:'isolated-profile-http-bootstrap',automationOptions:{autoStart:false},codex:{async status(){return{available:false};},async close(){}},...options});await listenFixture(app.server);
  const base=`http://127.0.0.1:${app.server.address().port}/api`,request=(route,{token=adminSession.token,method='GET',body,headers={}}={})=>fetch(base+route,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  t.after(async()=>{await app.close();assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('petpal-proxy-profile-http-'));await rm(directory,{recursive:true,force:true});});
  const create=async(body={})=>{const response=await request('/app-proxy/profiles',{method:'POST',body:{name:'手机配置',yaml:synthetic,...body}});assert.equal(response.status,201,await response.clone().text());return(await response.json()).profile;};
  return{directory,app,ownerId,userId:user.id,userToken:userSession.token,adminToken:adminSession.token,delegatedId:delegated.id,delegatedToken:delegatedSession.token,request,create};
}

test('profile HTTP routes require login and an administrator for mutations and admin catalog',async t=>{
  const f=await fixture(t),profile=await f.create();
  for(const route of ['/app-proxy/profiles','/app-proxy/admin/profiles',`/app-proxy/profiles/${profile.id}`,`/app-proxy/profiles/${profile.id}/config`]){
    const response=await f.request(route,{token:''});assert.equal(response.status,401);await response.arrayBuffer();
  }
  for(const [method,route,body]of [['POST','/app-proxy/profiles',{name:'拒绝',yaml:synthetic,allUsers:true}],['PUT',`/app-proxy/profiles/${profile.id}`,{revision:profile.revision,name:'拒绝',allUsers:true}],['DELETE',`/app-proxy/profiles/${profile.id}`,{revision:profile.revision}],['GET','/app-proxy/admin/profiles',undefined]]){
    const response=await f.request(route,{token:f.userToken,method,body});assert.equal(response.status,403);await response.arrayBuffer();
  }
  assert.equal((await(await f.request('/app-proxy/profiles')).json()).profiles.length,1);
});

test('shared profile authorization covers future accounts while keeping private profiles and grants unchanged',async t=>{
  const f=await fixture(t),privateProfile=await f.create(),shared=await f.create({name:'共享配置',allUsers:true,userIds:[f.ownerId,f.userId]}),file=path.join(f.directory,'app-proxy-profiles','profiles.json'),saved=await readFile(file,'utf8');
  assert.equal(privateProfile.allUsers,false);assert.equal(shared.allUsers,true);
  const ordinary=(await(await f.request('/app-proxy/profiles',{token:f.userToken})).json()).profiles;assert.deepEqual(ordinary.map(profile=>profile.id),[shared.id]);assert.equal(Object.hasOwn(ordinary[0],'allUsers'),false);assert.equal(Object.hasOwn(ordinary[0],'userIds'),false);
  const account=await f.request('/admin/users',{method:'POST',body:{username:'new-shared-member',password:'isolated-shared-password-123',role:'user'}});assert.equal(account.status,201);const userId=(await account.json()).user.id;
  const login=await f.request('/auth/login',{token:'',method:'POST',body:{username:'new-shared-member',password:'isolated-shared-password-123'}});assert.equal(login.status,200);const token=(await login.json()).token;
  assert.deepEqual((await(await f.request('/app-proxy/profiles',{token})).json()).profiles.map(profile=>profile.id),[shared.id]);assert.equal(await readFile(file,'utf8'),saved);
  const hidden=await f.request(`/app-proxy/profiles/${privateProfile.id}`,{token});assert.equal(hidden.status,404);await hidden.arrayBuffer();
  const download=await f.request(`/app-proxy/profiles/${shared.id}/config`,{token,headers:{'If-Match':`"${shared.revision}"`}});assert.equal(download.status,200);assert.equal(createHash('sha256').update(await download.text()).digest('hex'),shared.sha256);
  const disable=await f.request(`/admin/users/${userId}`,{method:'PATCH',body:{disabled:true}});assert.equal(disable.status,200);await disable.arrayBuffer();
  for(const route of ['/app-proxy/profiles',`/app-proxy/profiles/${shared.id}`,`/app-proxy/profiles/${shared.id}/config`]){const response=await f.request(route,{token,headers:{'If-Match':`"${shared.revision}"`}});assert.equal(response.status,401);await response.arrayBuffer();}
  const revoke=await f.request(`/app-proxy/profiles/${shared.id}`,{method:'PUT',body:{revision:shared.revision,allUsers:false}});assert.equal(revoke.status,200);const revoked=(await revoke.json()).profile;
  assert.equal(revoked.allUsers,false);assert.deepEqual(revoked.userIds,shared.userIds);assert.equal(revoked.sha256,shared.sha256);
  assert.deepEqual((await(await f.request('/app-proxy/profiles',{token:f.userToken})).json()).profiles.map(profile=>profile.id),[shared.id]);
  const delegatedDenied=await f.request(`/app-proxy/profiles/${shared.id}/config`,{token:f.delegatedToken,headers:{'If-Match':`"${revoked.revision}"`}});assert.equal(delegatedDenied.status,404);await delegatedDenied.arrayBuffer();
  const anonymous=await f.request(`/app-proxy/profiles/${shared.id}/config`,{token:'',headers:{'If-Match':`"${revoked.revision}"`}});assert.equal(anonymous.status,401);await anonymous.arrayBuffer();
});

test('sharing flags reject non-booleans and remain visible only in administrator metadata',async t=>{
  const f=await fixture(t),shared=await f.create({allUsers:true}),file=path.join(f.directory,'app-proxy-profiles','profiles.json'),saved=await readFile(file,'utf8');
  for(const value of [null,'true','false',1,0,[],{}])for(const [method,route,body]of [['POST','/app-proxy/profiles',{name:'无效授权',yaml:synthetic,allUsers:value}],['PUT',`/app-proxy/profiles/${shared.id}`,{revision:shared.revision,allUsers:value}]]){
    const response=await f.request(route,{method,body});assert.equal(response.status,400);assert.doesNotMatch(await response.text(),/synthetic-http-profile-password/);
  }
  assert.equal(await readFile(file,'utf8'),saved);
  const admins=(await(await f.request('/app-proxy/admin/profiles')).json()).profiles;assert.equal(admins[0].allUsers,true);assert.deepEqual(admins[0].userIds,shared.userIds);
  for(const route of ['/app-proxy/profiles',`/app-proxy/profiles/${shared.id}`]){const response=await f.request(route,{token:f.userToken});assert.equal(response.status,200);const text=await response.text();assert.doesNotMatch(text,/allUsers|userIds|"yaml"|synthetic-http-profile-password/);}
});

test('grants hide existence including config preconditions and never leak YAML into metadata or bootstrap',async t=>{
  const f=await fixture(t),profile=await f.create();
  assert.deepEqual(await(await f.request('/app-proxy/profiles',{token:f.userToken})).json(),{profiles:[]});
  for(const suffix of ['', '/config'])for(const profileId of [profile.id,randomUUID()]){
    const response=await f.request(`/app-proxy/profiles/${profileId}${suffix}`,{token:f.userToken});assert.equal(response.status,404);await response.arrayBuffer();
  }
  for(const route of ['/app-proxy/profiles','/app-proxy/admin/profiles',`/app-proxy/profiles/${profile.id}`,'/bootstrap']){
    const response=await f.request(route);assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/synthetic-http-profile-password|fixture\.example\.test|"yaml"/);
  }
  const update=await f.request(`/app-proxy/profiles/${profile.id}`,{method:'PUT',body:{revision:profile.revision,userIds:[f.userId]}});assert.equal(update.status,200);const next=(await update.json()).profile;
  const metadata=await f.request(`/app-proxy/profiles/${profile.id}`,{token:f.userToken});assert.equal(metadata.headers.get('cache-control'),'no-store');const visible=(await metadata.json()).profile;
  assert.equal(visible.id,profile.id);assert.equal(visible.userIds,undefined);assert.equal(visible.revision,next.revision);
});

test('config download is fixed-path, authenticated and bound to exact revision and canonical SHA256',async t=>{
  const f=await fixture(t),profile=await f.create({userIds:[f.ownerId,f.userId]});
  for(const headers of [{},{'If-Match':'*'},{'If-Match':`W/"${profile.revision}"`}]){const response=await f.request(`/app-proxy/profiles/${profile.id}/config`,{token:f.userToken,headers});assert.equal(response.status,400);await response.arrayBuffer();}
  const stale=await f.request(`/app-proxy/profiles/${profile.id}/config`,{token:f.userToken,headers:{'If-Match':`"${randomUUID()}"`}});assert.equal(stale.status,409);await stale.arrayBuffer();
  const response=await f.request(`/app-proxy/profiles/${profile.id}/config`,{token:f.userToken,headers:{'If-Match':`"${profile.revision}"`}});assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('etag'),`"${profile.revision}"`);assert.match(response.headers.get('content-type'),/^application\/yaml/);
  const body=await response.text();assert.match(body,/synthetic-http-profile-password/);assert.equal(createHash('sha256').update(body).digest('hex'),profile.sha256);assert.equal(response.headers.get('x-content-sha256'),profile.sha256);
  const arbitrary=await f.request(`/app-proxy/profiles/${profile.id}/config?url=https://private.example.test`,{headers:{'If-Match':`"${profile.revision}"`}});assert.equal(arbitrary.status,400);await arbitrary.arrayBuffer();
});

test('config edits preserve YAML on omitted input, rotate revision for strategy changes and delete is revision checked',async t=>{
  const f=await fixture(t),profile=await f.create();
  const response=await f.request(`/app-proxy/profiles/${profile.id}`,{method:'PUT',body:{revision:profile.revision,mode:'global',selections:{地点:'东京'}}});assert.equal(response.status,200);const next=(await response.json()).profile;
  assert.equal(next.sha256,profile.sha256);assert.notEqual(next.revision,profile.revision);assert.deepEqual(next.selections,{地点:'东京'});
  for(const method of ['PUT','DELETE']){const stale=await f.request(`/app-proxy/profiles/${profile.id}`,{method,body:{revision:profile.revision}});assert.equal(stale.status,409);await stale.arrayBuffer();}
  const removed=await f.request(`/app-proxy/profiles/${profile.id}`,{method:'DELETE',body:{revision:next.revision}});assert.equal(removed.status,200);assert.deepEqual(await removed.json(),{ok:true});
});

test('large valid configuration uses dedicated body parser while over-limit and malformed bodies remain safe failures',async t=>{
  const f=await fixture(t),large=synthetic+'\n# '+ 'x'.repeat(160*1024);await f.create({yaml:large});
  const response=await f.request('/app-proxy/profiles',{method:'POST',body:{name:'太大',yaml:synthetic+'\n# '+ 'synthetic-http-profile-password'.repeat(160000)}});assert.equal(response.status,400);assert.doesNotMatch(await response.text(),/synthetic-http-profile-password/);
  const invalid=await f.request('/app-proxy/profiles',{method:'POST',body:{name:'坏配置',yaml:'credential: synthetic-http-profile-password\ncredential: duplicate'}});assert.equal(invalid.status,400);assert.doesNotMatch(await invalid.text(),/synthetic-http-profile-password/);
});

test('logout during atomic profile IO prevents a late mutation and leaves no granted configuration',async t=>{
  const arrived=deferred(),release=deferred();let block=false;
  const f=await fixture(t,{appProxyProfilesOptions:{beforeCommit:async()=>{if(block){arrived.resolve();await release.promise;}}}});const first=await f.create(),file=path.join(f.directory,'app-proxy-profiles','profiles.json'),saved=await readFile(file,'utf8');
  block=true;const updating=f.request(`/app-proxy/profiles/${first.id}`,{method:'PUT',body:{revision:first.revision,allUsers:true}});await arrived.promise;
  const logout=await f.request('/auth/logout',{method:'POST'});assert.equal(logout.status,200);await logout.arrayBuffer();release.resolve();
  const response=await updating;assert.equal(response.status,401);await response.arrayBuffer();assert.equal(await readFile(file,'utf8'),saved);
  assert.deepEqual(await(await f.request('/app-proxy/profiles',{token:f.userToken})).json(),{profiles:[]});
});

test('demoting a delegated administrator during IO cannot commit a pending profile grant',async t=>{
  const arrived=deferred(),release=deferred();let block=false;
  const f=await fixture(t,{appProxyProfilesOptions:{beforeCommit:async()=>{if(block){arrived.resolve();await release.promise;}}}}),first=await f.create(),file=path.join(f.directory,'app-proxy-profiles','profiles.json'),saved=await readFile(file,'utf8');
  block=true;const updating=f.request(`/app-proxy/profiles/${first.id}`,{token:f.delegatedToken,method:'PUT',body:{revision:first.revision,allUsers:true}});await arrived.promise;
  const demoted=await f.request(`/admin/users/${f.delegatedId}`,{method:'PATCH',body:{role:'user'}});assert.equal(demoted.status,200);await demoted.arrayBuffer();release.resolve();
  const response=await updating;assert.equal(response.status,401);await response.arrayBuffer();assert.equal(await readFile(file,'utf8'),saved);
});

test('trusted-origin preflight supports managed profile PUT and revision headers',async t=>{
  const f=await fixture(t,{allowedOrigins:['https://localhost']});
  const response=await f.request('/app-proxy/profiles/'+randomUUID(),{method:'OPTIONS',headers:{Origin:'https://localhost','Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'Authorization,Content-Type,If-Match'}});
  assert.equal(response.status,204);assert.match(response.headers.get('access-control-allow-methods'),/PUT/);assert.match(response.headers.get('access-control-allow-headers'),/If-Match/);await response.arrayBuffer();
});
