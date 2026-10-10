import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createDesktopTools} from '../server/desktop-tools.mjs';

function fixture(options={}){
  const calls=[],managers=[];
  const tools=createDesktopTools({dataDir:path.resolve('.unused-fixture'),music:{},musicMcp:{close:async()=>{}},computerUseMcp:{close:async()=>{}},opencliManager:{close:async()=>{}},
    ncmCliFactory:configuration=>{
      const manager={configuration,closed:false,execute:async(value,{signal})=>{calls.push({configuration,value,signal});return{ok:true,scope:configuration.scope};},close:async()=>{manager.closed=true;}};
      managers.push(manager);return manager;
    },...options});
  return{tools,calls,managers};
}

test('official music tool exposes offline status and inherits full-access approval for prepare/run',async()=>{
  const {tools,calls}=fixture();
  assert.equal(tools.specs.filter(spec=>spec.name==='petpal_ncmcli').length,1);
  assert.equal(tools.describe('petpal_ncmcli',{action:'status'}).approvalRequired,false);
  assert.equal(tools.describe('petpal_ncmcli',{action:'prepare'}).approvalRequired,true);
  assert.equal(tools.describe('petpal_ncmcli',{action:'run',args:['login','--check']}).approvalRequired,true);
  assert.equal(tools.describe('petpal_ncmcli',{action:'run',args:['--version']}).approvalRequired,true);
  for(const value of [{action:'prepare',args:['config']},{action:'run',args:['play']},{action:'run',args:['config','set','privateKey','fixture']}])await assert.rejects(tools.execute('petpal_ncmcli',value));
  assert.equal(calls.length,0);await tools.close();
});

test('selected executor reuses only current account manager and never falls back when conversation is missing',async()=>{
  const {tools,calls,managers}=fixture({musicMcpScope:'instance:owner',scopeForConversation:id=>({'alice-chat':'instance:alice','alice-agent':'instance:alice','bob-chat':'instance:bob'})[id]});
  const alice=await tools.execute('petpal_ncmcli',{action:'status'},{conversationId:'alice-chat'});
  assert.equal(alice.scope,'instance:alice');
  await tools.execute('petpal_ncmcli',{action:'prepare'},{conversationId:'bob-chat'});
  await tools.execute('petpal_ncmcli',{action:'run',args:['--version']},{conversationId:'alice-agent'});
  assert.equal(calls[0].configuration,calls[2].configuration);
  assert.notEqual(calls[0].configuration,calls[1].configuration);
  assert.equal(calls[0].configuration.dataDir,path.resolve('.unused-fixture'));
  await assert.rejects(tools.execute('petpal_ncmcli',{action:'status'},{conversationId:'unknown'}),/所属账号/);
  assert.equal(calls.length,3);assert.equal(managers.length,3);
  await tools.close();assert.ok(managers.every(manager=>manager.closed));
});

test('registry cancellation stops the official music call and closes its scoped managers before reuse',async()=>{
  let started;const ready=new Promise(resolve=>{started=resolve;});
  const manager={execute:async(_value,{signal})=>{started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{name:'AbortError'})),{once:true}));},close:async()=>{}};
  const {tools}=fixture({ncmcli:manager});
  const controller=new AbortController();
  const pending=tools.execute('petpal_ncmcli',{action:'run',args:['commands']},{signal:controller.signal});
  const rejected=assert.rejects(pending,{name:'AbortError'});await ready;
  await assert.rejects(tools.execute('petpal_ncmcli',{action:'status'}),error=>error.status===409);
  controller.abort();await rejected;await tools.close();
  await assert.rejects(tools.execute('petpal_ncmcli',{action:'status'}),{name:'AbortError'});
});

test('official command approvals do not echo structured secrets in user input',async()=>{
  const {tools}=fixture();
  const description=tools.describe('petpal_ncmcli',{action:'run',args:['search','song','--keyword','xxx','--userInput','cookie=synthetic-private-value']}).description;
  assert.doesNotMatch(description,/synthetic-private-value/);
  await tools.close();
});
