import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {listenFixture} from './helpers/loopback.mjs';
import {CodexBridge,resolveBundledCodex} from '../server/codex.mjs';
import {defaultCodexConfig,patchCodexConfig} from '../server/codex-config.mjs';
import {createDesktopTools} from '../server/desktop-tools.mjs';
import {NcmCliManager,NCMCLI_VERSION,ncmCliEnvironment} from '../server/ncmcli.mjs';

const exec=promisify(execFile);
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Research residue is explicitly injected only by this optional test. It is not
// a supported production dependency or a claimed installed global runtime.
const researchPackage=path.join(repository,'node_modules','@music163','ncm-cli','package.json');
async function exists(file){try{return(await stat(file)).isFile();}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function removeOwned(directory){
  assert.equal(path.resolve(path.dirname(directory)),path.resolve(tmpdir()));
  assert.match(path.basename(directory),/^petpal-ncmcli-real-(?:agent|electron)-/);
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
const scopedProfile=(directory,scope)=>path.join(directory,'ncmcli',createHash('sha256').update(scope).digest('hex'),'profile');

test('real Codex 0.143 calls actual scoped ncm-cli with read-only status and explicit run approvals', {timeout:90000}, async t=>{
  if(!await exists(researchPackage)){t.skip('Optional research ncm-cli 0.1.7 is absent; no package was installed by this test.');return;}
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-ncmcli-real-agent-'));
  const requests=[],errors=[],executions=[],managers=[];
  let sequence=0,approvalCount=0,request={action:'status'};
  const scopes={'alice-chat':'fixture:alice','alice-second-chat':'fixture:alice','bob-chat':'fixture:bob'};
  const tools=createDesktopTools({dataDir:directory,musicMcpScope:'fixture:owner',scopeForConversation:id=>scopes[id],
    musicMcp:{close:async()=>{}},computerUseMcp:{close:async()=>{}},opencliManager:{close:async()=>{}},
    ncmCliFactory:options=>{
      const manager=new NcmCliManager({...options,globalPackageJsonPath:researchPackage,timeoutMs:15000});
      managers.push({scope:options.scope,manager});return manager;
    }});
  const execute=tools.execute.bind(tools);
  tools.execute=async(name,args,options)=>{
    const result=await execute(name,args,options);
    executions.push({name,args,conversationId:options.conversationId,result});return result;
  };
  const server=http.createServer(async(req,res)=>{
    try{
      assert.equal(req.method,'POST');assert.equal(req.url,'/v1/responses');
      assert.equal(req.headers.authorization,'Bearer synthetic-ncmcli-loopback-key');
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
      assert.equal(body.model,'gpt-5.4');
      const previous=body.input?.some(item=>item.type==='function_call_output');
      const id=`resp_ncmcli_${++sequence}`;
      const item=previous
        ?{id:`msg_${sequence}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Isolated ncm-cli fixture completed.',annotations:[]}]}
        :{id:`fc_${sequence}`,type:'function_call',call_id:`call_${sequence}`,name:'petpal_ncmcli',arguments:JSON.stringify(request),status:'completed'};
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
      const send=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
      send('response.created',{response:{id,object:'response',model:body.model,status:'in_progress',output:[]}});
      if(previous){
        send('response.output_item.added',{output_index:0,item:{...item,content:[],status:'in_progress'}});
        send('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
        send('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:item.content[0].text});
        send('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text:item.content[0].text});
      }else{
        send('response.output_item.added',{output_index:0,item:{...item,arguments:'',status:'in_progress'}});
        send('response.function_call_arguments.delta',{item_id:item.id,output_index:0,delta:item.arguments});
        send('response.function_call_arguments.done',{item_id:item.id,output_index:0,arguments:item.arguments});
      }
      send('response.output_item.done',{output_index:0,item});
      send('response.completed',{response:{id,object:'response',model:body.model,status:'completed',output:[item],usage:{input_tokens:20,output_tokens:10,total_tokens:30}}});res.end();
    }catch(error){errors.push(error);res.writeHead(500);res.end('{}');}
  });
  let bridge;
  t.after(async()=>{await bridge?.close();await tools.close();server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));await removeOwned(directory);});
  await listenFixture(server);
  const config=patchCodexConfig(defaultCodexConfig(),{mode:'api',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'gpt-5.4',apiKey:'synthetic-ncmcli-loopback-key'});
  const binary=await resolveBundledCodex();assert.ok(binary?.file);
  const version=await exec(binary.file,['--version'],{timeout:10000,windowsHide:true});assert.match(version.stdout,/0\.143\.0/);
  bridge=new CodexBridge({dataDir:directory,config,command:binary.file,desktopTools:tools});
  assert.equal((await bridge.status()).available,true);assert.equal(requests.length,0);
  const run=async(conversationId,permissions)=>{
    const result=await bridge.run({conversationId,prompt:'Only execute the local fixture tool call and report the fixture text.',permissions,signal:AbortSignal.timeout(15000),onEvent:(event,data)=>{
      if(event==='approval'){approvalCount++;assert.match(data.description,/网易云/);bridge.approve(data.id,'accept');}
    }});
    assert.equal(result.text,'Isolated ncm-cli fixture completed.');
  };
  for(const conversationId of ['alice-chat','alice-second-chat','bob-chat'])await run(conversationId,{access:'read-only',approval:'ask'});
  assert.equal(approvalCount,0);assert.equal(executions.length,3);
  for(let index=0;index<executions.length;index++){
    const observed=executions[index],scope=scopes[observed.conversationId];
    assert.equal(observed.result.profileDirectory,scopedProfile(directory,scope));
    assert.equal(observed.result.available,true);assert.equal(observed.result.version,NCMCLI_VERSION);
    assert.equal(observed.result.credentialsPresent,false);assert.equal(observed.result.loginVerified,false);
    assert.equal(observed.result.playbackSupported,false);
  }
  assert.equal(executions[0].result.profileDirectory,executions[1].result.profileDirectory);
  assert.notEqual(executions[0].result.profileDirectory,executions[2].result.profileDirectory);
  assert.equal(managers.length,3,'owner context plus one actual manager per account');
  await assert.rejects(stat(executions[0].result.profileDirectory),error=>error.code==='ENOENT');
  request={action:'run',args:['--version']};await run('alice-chat',{access:'read-only',approval:'auto'});
  assert.equal(executions.length,3,'read-only run must be denied before executing the real CLI');assert.equal(approvalCount,0);
  assert.ok(requests.some(body=>body.input?.some(item=>item.type==='function_call_output'&&/完全访问/.test(JSON.stringify(item.output)))));
  await run('alice-chat',{access:'full-access',approval:'ask'});
  assert.equal(executions.length,4);assert.equal(approvalCount,1);
  assert.equal(executions[3].result.ok,true);assert.equal(executions[3].result.exitCode,0);assert.match(executions[3].result.stdout,/0\.1\.7/);
  request={action:'run',args:['--help']};await run('alice-chat',{access:'full-access',approval:'ask'});
  assert.equal(executions.length,5);assert.equal(approvalCount,2);
  assert.equal(executions[4].result.ok,false);assert.equal(executions[4].result.requiresUserSetup,true);
  assert.match(executions[4].result.stdout+executions[4].result.stderr,/API key 未设置/);
  assert.equal(executions[4].result.playbackVerified,false);
  await assert.rejects(stat(path.join(scopedProfile(directory,'fixture:alice'),'.config','ncm-cli','credentials.enc.json')),error=>error.code==='ENOENT');
  const toml=await readFile(path.join(directory,'codex',config.revision,'config.toml'),'utf8');assert.ok(!toml.includes(config.apiKey));
  assert.equal(errors.length,0,errors.map(error=>error.message).join('; '));
  assert.equal(requests.length,12);assert.ok(requests.every(body=>JSON.stringify(body.tools).includes('petpal_ncmcli')));
  t.diagnostic('Real Codex 0.143.0 -> actual createDesktopTools -> real NcmCliManager verified 3 scoped offline statuses, read-only run refusal, 2 explicit approvals, official CLI 0.1.7 version and unconfigured help. All model Responses stayed on loopback; no online music operation occurred.');
});

test('real Electron-as-Node launches official ncm-cli offline in isolated empty account home', {timeout:30000}, async t=>{
  const electron=path.join(repository,'node_modules','electron','dist',process.platform==='win32'?'electron.exe':'electron');
  if(process.platform!=='win32'||!await exists(electron)||!await exists(researchPackage)){
    t.skip('Windows research Electron/official CLI are optional and were not installed by this test.');return;
  }
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-ncmcli-real-electron-'));
  const manager=new NcmCliManager({dataDir:directory,scope:'fixture:electron-account',node:electron,globalPackageJsonPath:researchPackage,timeoutMs:10000});
  t.after(async()=>{await manager.close();await removeOwned(directory);});
  const runtimeVersion=await exec(electron,['-e','console.log(process.versions.electron)'],{cwd:directory,env:ncmCliEnvironment(directory),timeout:10000,windowsHide:true});
  assert.match(runtimeVersion.stdout,/39\.8\.10/);
  const version=await manager.execute({action:'run',args:['--version']});
  assert.equal(version.ok,true);assert.equal(version.exitCode,0);assert.match(version.stdout,/0\.1\.7/);
  const help=await manager.execute({action:'run',args:['--help']});
  assert.equal(help.ok,false);assert.equal(help.requiresUserSetup,true);assert.match(help.stdout+help.stderr,/API key 未设置/);
  assert.equal(help.playbackVerified,false);
  assert.equal((await manager.status()).credentialsPresent,false);
  t.diagnostic('Actual Electron 39.8.10 binary ran the real official CLI via ELECTRON_RUN_AS_NODE; --version=0.1.7 and --help requires user setup. This is a local runtime smoke, not Windows/Ubuntu installation-package acceptance.');
});
