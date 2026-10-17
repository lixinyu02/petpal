import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,lstat,rm,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {AppProxyProfiles,APP_PROXY_PROFILE_LIMITS,normalizeServerProxyYaml} from '../server/app-proxy-profiles.mjs';

const synthetic='proxies:\n  - {name: 东京, type: socks5, server: proxy.example.test, port: 1080, password: synthetic-profile-password}\nproxy-groups:\n  - {name: 地点, type: select, proxies: [DIRECT, 东京]}\nrules: ["MATCH,地点"]\n';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function fixture(t,options={}){
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-proxy-profiles-')),users=[{id:randomUUID(),disabled:false},{id:randomUUID(),disabled:false},{id:randomUUID(),disabled:false}];
  const repository=await new AppProxyProfiles({dataDir:directory,users:()=>users,...options}).init();
  t.after(async()=>{await repository.close();assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('petpal-proxy-profiles-'));await rm(directory,{recursive:true,force:true});});
  const create=(input={},options={})=>repository.mutate(null,{name:'手机代理',yaml:synthetic,...input},{creatorId:users[0].id,...options});
  return{directory,users,repository,create};
}

test('server profile YAML uses a bounded safe schema and never echoes supplied credentials',()=>{
  const bad=['','[]','secret: synthetic-profile-password\nsecret: again','secret: !!js/function synthetic-profile-password','&loop {next: *loop}','__proto__: {bad: true}','value: .inf','value: .nan','proxies: {}','proxy-groups: {}','rules: [123]','mode: script','proxies: [{name: one}, {name: one}]','proxy-groups: [{name: one,type: select},{name: one,type: select}]','proxy-providers: {p: {type: file, path: /private/credential}}','proxy-providers: {p: {type: http, url: "http://example.test/private"}}','proxies: [{name: one,certificate: /private/credential}]'];
  for(const source of bad)assert.throws(()=>normalizeServerProxyYaml(source),error=>error.status===400&&!error.message.includes('synthetic-profile-password')&&!error.message.includes('/private/credential'));
  let source='a: &a [one,two]\n';for(let index=0;index<20;index++)source+=`${String.fromCharCode(98+index)}: &${String.fromCharCode(98+index)} [*${String.fromCharCode(97+index)},*${String.fromCharCode(97+index)}]\n`;
  assert.throws(()=>normalizeServerProxyYaml(source),{status:400});
  assert.throws(()=>normalizeServerProxyYaml('nested: '.repeat(60)+'yes'),{status:400});
  assert.throws(()=>normalizeServerProxyYaml('secret: '+ 'x'.repeat(APP_PROXY_PROFILE_LIMITS.yamlBytes)),{status:400});
});

test('normalized YAML strips runtime administration and returns exact canonical SHA and selector metadata',()=>{
  const input=synthetic+'external-controller: 0.0.0.0:9090\nauthentication: [synthetic-private]\nlisteners: [{port: 9091}]\ntls: {private-key: /private/file}\ninterface-name: eth0\nscript: arbitrary\nproxy-providers:\n  upstream: {type: http,url: https://fixture.example.test/sub,path: ../../outside}\n';
  const result=normalizeServerProxyYaml(input),parsed=yaml.load(result.yaml);
  for(const key of ['external-controller','authentication','listeners','tls','interface-name','script'])assert.equal(parsed[key],undefined);
  assert.equal(parsed['proxy-providers'].upstream.path,'./providers/proxy-providers-0.yaml');
  assert.equal(result.mode,'rule');assert.equal(result.sha256,createHash('sha256').update(result.yaml).digest('hex'));
  assert.deepEqual(result.groups,[{name:'地点',choices:['DIRECT','东京']}]);assert.match(result.yaml,/synthetic-profile-password/);
  assert.equal(normalizeServerProxyYaml(result.yaml).yaml,result.yaml);
});

test('valid remote or inline providers allow dynamic default nodes while static and missing-provider groups stay strict',async t=>{
  const f=await fixture(t),providerYaml='proxy-providers:\n  remote: {type: http, url: https://fixture.example.test/sub}\n  inline: {type: inline, payload: []}\nproxy-groups:\n  - {name: 动态地点, type: select, use: [remote]}\n  - {name: 混合地点, type: select, use: [inline], proxies: [DIRECT]}\n  - {name: 静态地点, type: select, proxies: [DIRECT]}\nrules: ["MATCH,动态地点"]\n';
  const profile=await f.create({yaml:providerYaml,selections:{动态地点:'东京-动态节点',混合地点:'大阪-动态节点',静态地点:'DIRECT'}});
  assert.deepEqual(profile.groups,[{name:'动态地点',choices:[],dynamic:true},{name:'混合地点',choices:['DIRECT'],dynamic:true},{name:'静态地点',choices:['DIRECT']}]);
  assert.equal(profile.selections.动态地点,'东京-动态节点');assert.equal(profile.selections.混合地点,'大阪-动态节点');
  await assert.rejects(f.create({yaml:providerYaml,selections:{静态地点:'东京-动态节点'}}),{status:400});
  assert.throws(()=>normalizeServerProxyYaml('proxy-groups: [{name: 无效组, type: select, use: [missing]}]'),{status:400});
  assert.throws(()=>normalizeServerProxyYaml('proxy-providers: {inline: {type: inline}}\nproxy-groups: [{name: 无效组, type: select, use: [inline]}]'),{status:400});
  const reloaded=await new AppProxyProfiles({dataDir:f.directory,users:()=>f.users}).init();assert.deepEqual(reloaded.listAdmin().profiles[0],profile);await reloaded.close();
  const saved=JSON.parse(await readFile(f.repository.file,'utf8'));for(const group of saved.profiles[0].groups)delete group.dynamic;
  await writeFile(f.repository.file,JSON.stringify(saved));const legacy=await new AppProxyProfiles({dataDir:f.directory,users:()=>f.users}).init();assert.deepEqual(legacy.listAdmin().profiles[0].groups,profile.groups);await legacy.close();
});

test('profile grants are explicit and metadata exposes no YAML credentials or unauthorized IDs',async t=>{
  const f=await fixture(t),created=await f.create({mode:'global',selections:{地点:'东京'}});
  assert.equal(created.allUsers,false);
  assert.deepEqual(created.userIds,[f.users[0].id]);assert.equal(created.mode,'global');assert.deepEqual(created.selections,{地点:'东京'});
  assert.equal(f.repository.list(f.users[0].id).profiles.length,1);assert.deepEqual(f.repository.list(f.users[1].id),{profiles:[]});
  assert.throws(()=>f.repository.get(created.id,f.users[1].id),{status:404});assert.throws(()=>f.repository.config(created.id,f.users[1].id,created.revision),{status:404});
  for(const response of [created,f.repository.listAdmin(),f.repository.list(f.users[0].id),f.repository.get(created.id,f.users[0].id)])assert.doesNotMatch(JSON.stringify(response),/yaml|synthetic-profile-password|proxy\.example\.test/);
  assert.equal(Object.hasOwn(f.repository.get(created.id,f.users[0].id),'userIds'),false);assert.equal(Object.hasOwn(f.repository.get(created.id,f.users[0].id),'allUsers'),false);
  assert.match(f.repository.config(created.id,f.users[0].id,created.revision).yaml,/synthetic-profile-password/);
  const nobody=await f.create({name:'未分配',userIds:[]});assert.equal(f.repository.list(f.users[0].id).profiles.some(value=>value.id===nobody.id),false);
  const granted=await f.create({name:'明确分配',userIds:[f.users[1].id,f.users[1].id]});assert.deepEqual(granted.userIds,[f.users[1].id]);
});

test('all-user grants follow the live active account table without copying IDs or widening other profiles',async t=>{
  const f=await fixture(t),privateProfile=await f.create(),shared=await f.create({name:'所有账号可用',allUsers:true}),saved=await readFile(f.repository.file,'utf8');
  assert.equal(shared.allUsers,true);assert.deepEqual(shared.userIds,[f.users[0].id]);
  assert.deepEqual(f.repository.list(f.users[1].id).profiles.map(profile=>profile.id),[shared.id]);
  const newcomer={id:randomUUID(),disabled:false};f.users.push(newcomer);
  assert.deepEqual(f.repository.list(newcomer.id).profiles.map(profile=>profile.id),[shared.id]);
  const metadata=f.repository.get(shared.id,newcomer.id);assert.equal(Object.hasOwn(metadata,'allUsers'),false);assert.equal(Object.hasOwn(metadata,'userIds'),false);
  assert.equal(f.repository.config(shared.id,newcomer.id,shared.revision).sha256,shared.sha256);assert.throws(()=>f.repository.get(privateProfile.id,newcomer.id),{status:404});
  for(const invalid of [undefined,null,'',randomUUID()]){assert.deepEqual(f.repository.list(invalid),{profiles:[]});assert.throws(()=>f.repository.config(shared.id,invalid,shared.revision),{status:404});}
  newcomer.disabled=true;assert.deepEqual(f.repository.list(newcomer.id),{profiles:[]});assert.throws(()=>f.repository.get(shared.id,newcomer.id),{status:404});assert.throws(()=>f.repository.config(shared.id,newcomer.id,shared.revision),{status:404});
  newcomer.disabled=false;assert.equal(f.repository.get(shared.id,newcomer.id).id,shared.id);
  f.users.splice(f.users.indexOf(newcomer),1);assert.throws(()=>f.repository.get(shared.id,newcomer.id),{status:404});
  assert.equal(await readFile(f.repository.file,'utf8'),saved);assert.deepEqual(f.repository.listAdmin().profiles[1].userIds,[f.users[0].id]);
});

test('revoking all-user sharing retains explicit grants, YAML and default strategies',async t=>{
  const f=await fixture(t),shared=await f.create({allUsers:true,userIds:[f.users[0].id,f.users[1].id],selections:{地点:'东京'}}),yaml=f.repository.config(shared.id,f.users[2].id,shared.revision).yaml;
  const revoked=await f.repository.mutate(shared.id,{revision:shared.revision,allUsers:false});
  assert.equal(revoked.allUsers,false);assert.deepEqual(revoked.userIds,shared.userIds);assert.equal(revoked.sha256,shared.sha256);assert.deepEqual(revoked.selections,shared.selections);assert.notEqual(revoked.revision,shared.revision);
  assert.equal(f.repository.config(shared.id,f.users[1].id,revoked.revision).yaml,yaml);assert.deepEqual(f.repository.list(f.users[2].id),{profiles:[]});assert.throws(()=>f.repository.config(shared.id,f.users[2].id,revoked.revision),{status:404});
  f.users[1].disabled=true;assert.throws(()=>f.repository.get(shared.id,f.users[1].id),{status:404});assert.deepEqual(f.repository.list(f.users[1].id),{profiles:[]});
  f.users[1].disabled=false;assert.equal(f.repository.get(shared.id,f.users[1].id).id,shared.id);
});

test('all-user flags require a boolean and omitted updates retain the existing authorization',async t=>{
  const f=await fixture(t),first=await f.create({allUsers:true}),saved=await readFile(f.repository.file,'utf8');
  for(const invalid of [null,undefined,'true','false',1,0,[],{}]){
    await assert.rejects(f.create({allUsers:invalid}),{status:400});await assert.rejects(f.repository.mutate(first.id,{revision:first.revision,allUsers:invalid}),{status:400});
  }
  assert.equal(await readFile(f.repository.file,'utf8'),saved);
  const renamed=await f.repository.mutate(first.id,{revision:first.revision,name:'只改名称'});assert.equal(renamed.allUsers,true);assert.deepEqual(renamed.userIds,first.userIds);
});

test('legacy ten-field storage stays private and upgrades only on an authorized write',async t=>{
  const f=await fixture(t),first=await f.create(),saved=JSON.parse(await readFile(f.repository.file,'utf8'));delete saved.profiles[0].allUsers;assert.equal(Object.keys(saved.profiles[0]).length,10);
  const legacyBytes=JSON.stringify(saved);await writeFile(f.repository.file,legacyBytes);
  const legacy=await new AppProxyProfiles({dataDir:f.directory,users:()=>f.users}).init();
  try{
    assert.equal(legacy.listAdmin().profiles[0].allUsers,false);assert.deepEqual(legacy.list(f.users[1].id),{profiles:[]});assert.equal(await readFile(f.repository.file,'utf8'),legacyBytes);
    const shared=await legacy.mutate(first.id,{revision:first.revision,allUsers:true});assert.equal(Object.keys(JSON.parse(await readFile(legacy.file,'utf8')).profiles[0]).length,11);
    const restarted=await new AppProxyProfiles({dataDir:f.directory,users:()=>f.users}).init();
    try{assert.deepEqual(restarted.listAdmin().profiles,[shared]);const newcomer={id:randomUUID(),disabled:false};f.users.push(newcomer);assert.equal(restarted.get(shared.id,newcomer.id).id,shared.id);}finally{await restarted.close();}
  }finally{await legacy.close();}
});

test('invalid sharing flags and unknown storage fields fail closed without rewriting stored bytes',async t=>{
  const f=await fixture(t);await f.create();const original=JSON.parse(await readFile(f.repository.file,'utf8'));
  for(const invalid of [null,'true',1,[],{}]){
    const saved=structuredClone(original);saved.profiles[0].allUsers=invalid;const bytes=JSON.stringify(saved);await writeFile(f.repository.file,bytes);
    await assert.rejects(new AppProxyProfiles({dataDir:f.directory,users:()=>f.users}).init(),{status:500});assert.equal(await readFile(f.repository.file,'utf8'),bytes);
  }
  for(const corrupt of [profile=>{profile.unrecognized=true;},profile=>{delete profile.yaml;profile.unrecognized='synthetic-profile-password';}]){
    const saved=structuredClone(original);corrupt(saved.profiles[0]);const bytes=JSON.stringify(saved);await writeFile(f.repository.file,bytes);
    await assert.rejects(new AppProxyProfiles({dataDir:f.directory,users:()=>f.users}).init(),error=>error.status===500&&!error.message.includes('synthetic-profile-password'));assert.equal(await readFile(f.repository.file,'utf8'),bytes);
  }
});

test('metadata-only edits retain exact YAML, change revision, enforce revision-bound downloads and revoke grants',async t=>{
  const f=await fixture(t),first=await f.create({userIds:[f.users[0].id,f.users[1].id]}),body=f.repository.config(first.id,f.users[0].id,first.revision).yaml;
  const next=await f.repository.mutate(first.id,{revision:first.revision,name:'新名称',mode:'direct',userIds:[f.users[0].id]});
  assert.equal(next.sha256,first.sha256);assert.notEqual(next.revision,first.revision);assert.equal(next.mode,'direct');
  assert.equal(f.repository.config(first.id,f.users[0].id,next.revision).yaml,body);
  assert.throws(()=>f.repository.config(first.id,f.users[0].id,first.revision),{status:409});
  assert.throws(()=>f.repository.config(first.id,f.users[1].id,next.revision),{status:404});
  assert.deepEqual(f.repository.list(f.users[1].id),{profiles:[]});
});

test('concurrent updates serialize against the durable revision and stale deletes cannot remove a new revision',async t=>{
  const f=await fixture(t),first=await f.create();
  const results=await Promise.allSettled(['甲','乙'].map(name=>f.repository.mutate(first.id,{revision:first.revision,name})));
  assert.equal(results.filter(value=>value.status==='fulfilled').length,1);assert.equal(results.find(value=>value.status==='rejected').reason.status,409);
  const latest=f.repository.listAdmin().profiles[0];assert.notEqual(latest.revision,first.revision);
  await assert.rejects(f.repository.remove(first.id,{revision:first.revision}),{status:409});
  const persisted=JSON.parse(await readFile(f.repository.file,'utf8'));assert.equal(persisted.profiles[0].revision,latest.revision);
  assert.deepEqual(await f.repository.remove(first.id,{revision:latest.revision}),{ok:true});assert.deepEqual(f.repository.listAdmin(),{profiles:[]});
});

test('default selections and assignment bounds reject invalid input without mutating the committed file',async t=>{
  const f=await fixture(t),first=await f.create(),saved=await readFile(f.repository.file,'utf8');
  for(const input of [{selections:{地点:'missing'}},{selections:{missing:'DIRECT'}},{userIds:[randomUUID()]},{userIds:'all'},{mode:'vpn'},{name:'\nprivate'},{name:' name '},{endpoint:'https://arbitrary.example.test'}, {yaml:'[]'}])await assert.rejects(f.repository.mutate(first.id,{revision:first.revision,...input}),{status:400});
  await assert.rejects(f.repository.remove(first.id,{revision:first.revision,extra:true}),{status:400});
  await assert.rejects(f.create({revision:randomUUID()}),{status:400});
  assert.equal(await readFile(f.repository.file,'utf8'),saved);assert.equal(f.repository.listAdmin().profiles[0].revision,first.revision);
});

test('precommit authorization loss and IO failure preserve exact previous bytes and leave no temporary files',async t=>{
  const arrived=deferred(),release=deferred();let blocking=false,throwIo=false;
  const f=await fixture(t,{beforeCommit:async()=>{if(throwIo)throw new Error('/private/synthetic-profile-password');if(blocking){arrived.resolve();await release.promise;}}});
  const first=await f.create(),saved=await readFile(f.repository.file,'utf8');let authorized=true;blocking=true;
  const mutation=f.repository.mutate(first.id,{revision:first.revision,name:'拒绝迟到写入',allUsers:true},{authorize:()=>{if(!authorized)throw Object.assign(new Error('登录失效'),{status:401});}});
  await arrived.promise;authorized=false;release.resolve();await assert.rejects(mutation,{status:401});blocking=false;
  assert.equal(await readFile(f.repository.file,'utf8'),saved);assert.equal(f.repository.listAdmin().profiles[0].name,first.name);assert.equal(f.repository.listAdmin().profiles[0].allUsers,false);assert.deepEqual(f.repository.list(f.users[1].id),{profiles:[]});
  throwIo=true;await assert.rejects(f.repository.mutate(first.id,{revision:first.revision,name:'磁盘错误'}),error=>error.status===500&&!error.message.includes('/private/'));
  assert.equal(await readFile(f.repository.file,'utf8'),saved);assert.deepEqual(await readdir(f.repository.directory),['profiles.json']);
  throwIo=false;assert.equal((await f.repository.mutate(first.id,{revision:first.revision,name:'后续正常写入'})).name,'后续正常写入');
});

test('account disabled while writing cannot gain a new grant',async t=>{
  const arrived=deferred(),release=deferred();let blocking=false;
  const f=await fixture(t,{beforeCommit:async()=>{if(blocking){arrived.resolve();await release.promise;}}}),first=await f.create(),saved=await readFile(f.repository.file,'utf8');
  blocking=true;const mutation=f.repository.mutate(first.id,{revision:first.revision,userIds:[f.users[1].id]});
  await arrived.promise;f.users[1].disabled=true;release.resolve();await assert.rejects(mutation,{status:400});assert.equal(await readFile(f.repository.file,'utf8'),saved);
});

test('private repository survives restart and rejects corrupt files without replacing them',async t=>{
  const f=await fixture(t),first=await f.create({selections:{地点:'东京'}});const saved=await readFile(f.repository.file,'utf8');
  const reloaded=await new AppProxyProfiles({dataDir:f.directory,users:()=>f.users}).init();assert.deepEqual(reloaded.listAdmin().profiles,[first]);
  if(process.platform!=='win32'){assert.equal((await lstat(f.repository.file)).mode&0o777,0o600);assert.equal((await lstat(f.repository.directory)).mode&0o777,0o700);}
  await reloaded.close();await writeFile(f.repository.file,'{"version":1,"profiles":[{"yaml":"synthetic-profile-password"}]}');
  await assert.rejects(new AppProxyProfiles({dataDir:f.directory,users:()=>f.users}).init(),error=>error.status===500&&!error.message.includes('synthetic-profile-password'));
  assert.notEqual(await readFile(f.repository.file,'utf8'),saved);
});

test('profile count limit rejects without consuming another revision',async t=>{
  const f=await fixture(t);for(let index=0;index<APP_PROXY_PROFILE_LIMITS.profiles;index++)await f.create({name:`节点配置 ${index}`});
  const saved=await readFile(f.repository.file,'utf8');await assert.rejects(f.create(),{status:400});assert.equal(await readFile(f.repository.file,'utf8'),saved);
});

test('group, choice and assignment limits are enforced before persisting input',async t=>{
  const f=await fixture(t);
  assert.throws(()=>normalizeServerProxyYaml(yaml.dump({'proxy-groups':Array.from({length:129},(_,index)=>({name:`组${index}`,type:'select',proxies:['DIRECT']}))})),{status:400});
  assert.throws(()=>normalizeServerProxyYaml(yaml.dump({'proxy-groups':[{name:'大量节点',type:'select',proxies:Array.from({length:2049},(_,index)=>`节点${index}`)}]})),{status:400});
  await assert.rejects(f.create({userIds:Array.from({length:257},()=>f.users[0].id)}),{status:400});
  assert.deepEqual(f.repository.listAdmin(),{profiles:[]});await assert.rejects(readFile(f.repository.file),{code:'ENOENT'});
});

test('repository does not follow a symlink directory or config file',async t=>{
  const f=await fixture(t),outside=path.join(f.directory,'outside');await mkdir(outside);
  try{await symlink(outside,f.repository.file,process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES','UNKNOWN'].includes(error.code)){t.skip('OS does not permit test symlinks');return;}throw error;}
  await assert.rejects(new AppProxyProfiles({dataDir:f.directory,users:()=>f.users}).init(),{status:500});
  await assert.rejects(f.create(),{status:500});assert.deepEqual(await readdir(outside),[]);
});
