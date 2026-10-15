import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import yaml from 'js-yaml';
import {ProxyAgent} from 'undici';
import {AppProxyManager,parseProxyConfiguration,runtimeProxyConfiguration,mihomoEnvironment,resolveBundledMihomo} from '../desktop/app-proxy.mjs';

const config='proxies: []\nproxy-groups: []\nrules: [MATCH,DIRECT]\n';
const valid='proxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n';
async function fixture(t,{exit=0,authorize,ready=true,...options}={}){
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-app-proxy-'));
  t.after(async()=>{await manager.close();assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('petpal-app-proxy-'));await rm(directory,{recursive:true,force:true});});
  const children=[],routes=[],network={async enable(value){routes.push({enabled:true,...value});},async disable(){routes.push({enabled:false});},async close(){}};
  const spawnImpl=(executable,args,opts)=>{
    const child=new EventEmitter();Object.assign(child,{exitCode:null,pid:100+children.length,kill(){if(child.exitCode===null){child.exitCode=0;queueMicrotask(()=>child.emit('close',0));}return true;}});
    children.push({executable,args,opts,child});if(args.includes('-t'))queueMicrotask(()=>{child.exitCode=exit;child.emit('close',exit);});return child;
  };
  const manager=new AppProxyManager({directory,resolveCore:async()=>({executable:'fixed-mihomo'}),network,spawnImpl,startTimeoutMs:300,fetchImpl:async url=>{
    if(!ready)throw new Error('private-upstream-diagnostic');
    return new Response(JSON.stringify(url.endsWith('/version')?{version:'v1.19.32'}:{proxies:{'选择节点':{type:'Selector',now:'DIRECT',all:['DIRECT','节点一']}}}),{headers:{'Content-Type':'application/json'}});
  },...options});
  await manager.load();return{manager,directory,children,routes};
}

test('proxy YAML rejects duplicate, cyclic, excessively expanded or external-file configurations without echoing secrets',()=>{
  for(const value of ['',config.replace('proxies: []','proxies: !!js/function "private-secret"'),'secret: private-secret\nsecret: second','&a {alias: *a}','__proto__: {polluted: true}','proxy-providers: {x: {type: file, path: /private/password}}','[one,two]']){
    assert.throws(()=>parseProxyConfiguration(value),error=>!error.message.includes('private-secret'));
  }
  let source='a: &a [one, two]\n';for(let i=0;i<20;i++)source+=`${String.fromCharCode(98+i)}: &${String.fromCharCode(98+i)} [*${String.fromCharCode(97+i)}, *${String.fromCharCode(97+i)}]\n`;
  assert.throws(()=>parseProxyConfiguration(source),/展开/);
});

test('runtime overrides listeners, host routing and credentials while retaining user nodes and rules in the private directory',()=>{
  const parsed=parseProxyConfiguration('tun: {enable: true}\nallow-lan: true\nlisteners: [{port: 9999}]\ntunnels: [bad]\ntuic-server: {enable: true, listen: "0.0.0.0:9998"}\nss-config: ss://unsafe\nvmess-config: vmess://unsafe\niptables: {enable: true}\nntp: {enable: true, write-to-system: true}\nexternal-controller-unix: /tmp/private\nproxy-providers: {p: {type: http, url: https://fixture.invalid/sub, path: ../../secret}}\nproxies: [{name: test, type: socks5, server: example.invalid, port: 1080, password: private-secret}]\nrules: ["MATCH,test"]');
  const output=yaml.load(runtimeProxyConfiguration(parsed,{port:12345,controllerPort:12346,username:'petpal',password:'generated',secret:'control'}));
  assert.equal(output['allow-lan'],false);assert.equal(output['bind-address'],'127.0.0.1');assert.deepEqual(output.tun,{enable:false});assert.deepEqual(output.dns,{enable:false});
  for(const name of ['listeners','tunnels','tuic-server','ss-config','vmess-config','iptables','ntp','external-controller-unix'])assert.equal(output[name],undefined);
  assert.equal(output['proxy-providers'].p.path,'./providers/proxy-providers-0.yaml');assert.deepEqual(output.authentication,['petpal:generated']);
  assert.ok(output.rules.includes('IP-CIDR,192.168.0.0/16,DIRECT,no-resolve'));assert.equal(output.proxies[0].password,'private-secret');
});

test('core environment drops all inherited hooks, overrides and unrelated API credentials',()=>{
  const result=mihomoEnvironment({SystemRoot:'C:/Windows',PATH:'path',CLASH_POST_UP:'bad',CLASH_CONFIG_STRING:'bad',SAFE_PATHS:'/',SKIP_SAFE_PATH_CHECK:'1',HTTP_PROXY:'secret',OPENAI_API_KEY:'secret'});
  assert.deepEqual(result,{SystemRoot:'C:/Windows',PATH:'path'});
});

test('first launch stays disabled and import validates the actual fixed core before committing private YAML',async t=>{
  const f=await fixture(t);assert.equal(f.manager.status().configured,false);assert.equal(f.children.length,0);
  await f.manager.importConfiguration(valid);assert.equal(f.children.length,1);assert.ok(f.children[0].args.includes('-t'));
  assert.equal(f.manager.status().configured,true);assert.equal(f.manager.status().running,false);assert.equal(f.routes.length,0);
  assert.doesNotMatch(JSON.stringify(f.manager.status()),/secret|authentication|127\.0\.0\.1/);
});

test('failed import or stale authorization leaves the previous configuration intact',async t=>{
  const f=await fixture(t,{exit:1});await writeFile(path.join(f.directory,'config.yaml'),'previous-private-config');
  await assert.rejects(f.manager.importConfiguration(valid),/校验未通过/);assert.equal(await readFile(path.join(f.directory,'config.yaml'),'utf8'),'previous-private-config');
  const next=await fixture(t);let checks=0;
  await assert.rejects(next.manager.importConfiguration(valid,{authorize:async()=>{if(++checks>1)throw new Error('private-session-detail');}}),/保存失败/);
  await assert.rejects(readFile(path.join(next.directory,'config.yaml')),{code:'ENOENT'});
});

test('start enables only authenticated loopback after readiness; stop restores direct and never retries a task',async t=>{
  const f=await fixture(t);await f.manager.importConfiguration(valid);const result=await f.manager.start();
  assert.equal(result.state,'running');assert.equal(f.routes.filter(item=>item.enabled).length,1);
  const endpoint=new URL(f.routes.find(item=>item.enabled).url);assert.equal(endpoint.hostname,'127.0.0.1');assert.equal(endpoint.username,'petpal');assert.equal(endpoint.password.length,48);
  assert.doesNotMatch(JSON.stringify(result),new RegExp(endpoint.password));assert.deepEqual(result.groups[0].choices,['DIRECT','节点一']);
  await f.manager.stop();assert.equal(f.manager.status().running,false);assert.equal(f.children.at(-1).child.exitCode,0);assert.equal(f.routes.at(-1).enabled,false);
  await assert.rejects(readFile(path.join(f.directory,'runtime.yaml')),{code:'ENOENT'});
});

test('core crash clears running status and restores direct without replaying any request',async t=>{
  const f=await fixture(t);await f.manager.importConfiguration(valid);await f.manager.start();const child=f.children.at(-1).child;
  child.exitCode=2;child.emit('close',2);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.manager.status().state,'error');assert.equal(f.routes.at(-1).enabled,false);assert.equal(f.routes.filter(item=>item.enabled).length,1);
});

test('failed readiness does not install proxy and preference persistence never enables it implicitly',async t=>{
  const f=await fixture(t,{ready:false});await f.manager.importConfiguration(valid);await assert.rejects(f.manager.start(),/启动失败/);
  assert.equal(f.routes.some(item=>item.enabled),false);await f.manager.updatePreferences({autoStart:true});
  assert.deepEqual(JSON.parse(await readFile(path.join(f.directory,'settings.json'),'utf8')),{autoStart:true});
  await assert.rejects(f.manager.updatePreferences({autoStart:true,port:8888}),/无效/);
});

test('validation timeout force-terminates a core that ignores its first kill and releases the operation queue',async t=>{
  const signals=[];let child;
  const f=await fixture(t,{testTimeoutMs:15,terminateTimeoutMs:10,killTimeoutMs:30,spawnImpl:()=>{
    child=new EventEmitter();Object.assign(child,{exitCode:null,kill(signal){signals.push(signal||'SIGTERM');if(signal==='SIGKILL'){child.exitCode=1;queueMicrotask(()=>child.emit('close',1));}return true;}});return child;
  }});
  await assert.rejects(f.manager.importConfiguration(valid),/校验超时/);assert.ok(signals.includes('SIGKILL'));assert.equal(f.manager.child,null);
  assert.equal((await f.manager.stop()).state,'stopped');
});

test('an unconfirmed core exit is bounded and retains ownership until a later stop confirms it',async t=>{
  let child,spawns=0;
  const f=await fixture(t,{testTimeoutMs:10,terminateTimeoutMs:10,killTimeoutMs:10,spawnImpl:()=>{
    spawns++;child=new EventEmitter();Object.assign(child,{exitCode:null,kill(){return false;}});return child;
  }});
  await assert.rejects(f.manager.importConfiguration(valid),/退出尚未确认/);assert.equal(f.manager.child,child);
  await assert.rejects(f.manager.importConfiguration(valid),/上一个代理内核/);assert.equal(spawns,1);
  child.exitCode=1;child.emit('close',1);assert.equal((await f.manager.stop()).state,'stopped');assert.equal(f.manager.child,null);
});

test('stop cancels pending core resolution without launching or committing a configuration',async t=>{
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const f=await fixture(t,{resolveCore:async()=>{entered();await gate;return{executable:'fixed-mihomo'};}});
  const importing=f.manager.importConfiguration(valid);await started;const stopping=f.manager.stop();await new Promise(resolve=>setImmediate(resolve));release();
  await assert.rejects(importing,/取消/);assert.equal((await stopping).state,'stopped');assert.equal(f.children.length,0);
  await assert.rejects(readFile(path.join(f.directory,'config.yaml')),{code:'ENOENT'});
});

test('a core exit during readiness cannot install a dead proxy or return running',async t=>{
  let f;
  f=await fixture(t,{fetchImpl:async()=>{
    const child=f.children.at(-1).child;child.exitCode=2;child.emit('close',2);return new Response(JSON.stringify({version:'v1.19.32'}));
  }});
  await f.manager.importConfiguration(valid);await assert.rejects(f.manager.start(),/取消|退出/);
  assert.equal(f.manager.status().running,false);assert.equal(f.routes.some(item=>item.enabled),false);assert.equal(f.routes.at(-1).enabled,false);
});

test('a core exit while route installation is pending always rolls back before start returns',async t=>{
  const routes=[];let f;
  const network={async enable(){routes.push(true);const child=f.children.at(-1).child;child.exitCode=2;child.emit('close',2);await new Promise(resolve=>setImmediate(resolve));},async disable(){routes.push(false);},async close(){}};
  f=await fixture(t,{network});await f.manager.importConfiguration(valid);await assert.rejects(f.manager.start(),/取消|退出/);
  assert.equal(f.manager.status().running,false);assert.equal(routes.at(-1),false);assert.equal(routes.filter(Boolean).length,1);
});

test('stop during route installation cancels startup and waits for rollback',async t=>{
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;}),routes=[];
  const f=await fixture(t,{network:{async enable(){routes.push(true);entered();await gate;},async disable(){routes.push(false);},async close(){}}});
  await f.manager.importConfiguration(valid);const starting=f.manager.start();await started;const stopping=f.manager.stop();await new Promise(resolve=>setImmediate(resolve));release();
  await assert.rejects(starting,/取消/);assert.equal((await stopping).state,'stopped');assert.equal(routes.at(-1),false);assert.equal(f.children.at(-1).child.exitCode,0);
});

test('concurrent close is idempotent and prevents startup from restoring a route after shutdown',async t=>{
  let release,entered,networkCloses=0;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;}),routes=[];
  const f=await fixture(t,{network:{async enable(){routes.push(true);entered();await gate;},async disable(){routes.push(false);},async close(){networkCloses++;}}});
  await f.manager.importConfiguration(valid);const starting=f.manager.start();await started;
  const closing=f.manager.close();assert.equal(f.manager.close(),closing);release();
  await assert.rejects(starting,/取消/);await closing;assert.equal(networkCloses,1);assert.equal(routes.at(-1),false);assert.equal(f.manager.status().state,'stopped');
  await assert.rejects(f.manager.start(),/退出/);
});

test('failed route removal reports error while still terminating the owned core; close always releases the network',async t=>{
  let failDisable=false,closed=0;
  const f=await fixture(t,{network:{async enable(){},async disable(){if(failDisable)throw new Error('private-route-secret');},async close(){closed++;}}});
  await f.manager.importConfiguration(valid);await f.manager.start();failDisable=true;
  await assert.rejects(f.manager.stop(),/恢复直连尚未确认/);assert.equal(f.manager.status().state,'error');assert.equal(f.children.at(-1).child.exitCode,0);
  await assert.rejects(f.manager.close(),/恢复直连尚未确认/);assert.equal(closed,1);failDisable=false;
  // The fixture's final close reuses the same rejected shutdown result.
  f.manager.close=async()=>{};
});

test('real bundled native core validates, binds loopback and forwards authenticated HTTP without upstream proxy credentials',{
  timeout:45000,skip:process.env.PETPAL_TEST_MIHOMO_CORE!=='1'
},async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-app-proxy-real-'));
  const network={url:null,async enable(value){this.url=value.url;},async disable(){this.url=null;},async close(){}};
  const manager=new AppProxyManager({directory,network,resolveCore:()=>resolveBundledMihomo({root:path.resolve('.')} )});
  const upstream=http.createServer((req,res)=>{assert.equal(req.headers['proxy-authorization'],undefined);res.end('native proxy verified');});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  let agent;
  t.after(async()=>{await agent?.close();await manager.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('petpal-app-proxy-real-'));await rm(directory,{recursive:true,force:true});});
  await manager.load();await manager.importConfiguration(valid);await manager.start();assert.equal(manager.status().running,true);
  agent=new ProxyAgent(network.url);const response=await fetch(`http://127.0.0.1:${upstream.address().port}/`,{dispatcher:agent,signal:AbortSignal.timeout(5000)});
  assert.equal(await response.text(),'native proxy verified');assert.equal(response.status,200);
});
