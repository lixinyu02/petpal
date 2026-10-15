import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createExecutors } from '../server/executors.mjs';
import { DesktopExecutor } from '../desktop/executor.mjs';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { listenFixture } from './helpers/loopback.mjs';

async function until(check) { for (let index=0;index<200;index++) { const value=await check();if(value)return value;await delay(2); } assert.fail('Remote input fixture did not settle'); }
const questions = [{ id:'choice',header:'选择',question:'接下来怎么办？',options:[{label:'继续',description:'执行下一步'},{label:'停止',description:'结束当前任务'}] }];
const dates = (ttl=300000) => ({ requestedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+ttl).toISOString() });
const answer = {answers:{choice:{answers:['继续']}}};
function central(t, options={}) {
  const userId=randomUUID(),otherId=randomUUID(),auth={userId,sessionHash:'session-one',bootstrap:false};
  const config={mode:'api',model:'qwen3.8-flash',revision:randomUUID(),baseUrl:'https://synthetic.example/v1',apiKey:'synthetic-central-key'};
  const store={state:{users:[{id:userId,role:'user',disabled:false},{id:otherId,role:'user',disabled:false}],executionHosts:[]},async save(){}};
  const manager=createExecutors({store,getConfig:()=>config,authorizeSession:value=>{if(![userId,otherId].includes(value.userId)||value.sessionHash!=='session-one')throw Object.assign(new Error('Unauthorized fixture'),{status:401});},authorizeEntry:entry=>{if(entry.auth.userId!==userId)throw Object.assign(new Error('Wrong user'),{status:403});},pollMs:5,commandMs:100,stopMs:10,...options});
  t.after(()=>manager.close());
  const register=(capabilities={projectDirectory:true,userInput:true})=>manager.register(auth,{deviceId:randomUUID(),name:'Synthetic input PC',platform:'win32',arch:'x64',...(capabilities?{capabilities}:{})});
  const begin=async registration=>{const entry={id:randomUUID(),conversationId:randomUUID(),auth,hostId:registration.hostId,model:config.model,effort:'',codexRevision:config.revision,attachmentIds:[]},bridge=manager.bind(entry),controller=new AbortController(),events=[];
    const completion=bridge.run({conversationId:entry.conversationId,prompt:'Synthetic task',permissions:{access:'read-only',approval:'ask'},signal:controller.signal,onEvent:(name,data)=>events.push({name,data})});completion.catch(()=>{});
    const command=(await manager.poll(registration.connectionId,auth)).commands[0];let sequence=0;
    const event=(name,data={})=>{const next=sequence+1,result=manager.events(registration.connectionId,auth,{runId:entry.id,sequence:next,event:name,data});sequence=next;return result;};event('started');
    return {entry,bridge,controller,events,command,completion,event};};
  return {manager,config,store,auth,userId,otherId,register,begin};
}

test('remote questions require negotiated support and preserve the legacy registration path',async t=>{
  const f=central(t),old=await f.register(null),run=await f.begin(old);
  assert.equal(old.capabilities,undefined);assert.equal(f.manager.list(f.userId)[0].codex.userInput,false);
  assert.throws(()=>run.event('user-input',{id:'native-old',questions,...dates()}),{code:'user_input_unsupported'});
  await assert.rejects(run.bridge.replyUserInput('anything',answer),{code:'user_input_unsupported'});
  run.event('complete',{text:'legacy completed'});await run.completion;
  const modern=await f.register();assert.equal(modern.capabilities.userInput,true);assert.equal(f.manager.list(f.userId).find(item=>item.id===modern.hostId).codex.userInput,true);
});

test('mapped remote question answers validate, stay scoped, and idempotently deliver exactly once',async t=>{
  const f=central(t),registration=await f.register(),run=await f.begin(registration);
  run.event('user-input',{id:'native-question',questions,...dates()});const mapped=run.events.find(item=>item.name==='user-input').data;
  assert.notEqual(mapped.id,'native-question');assert.equal(mapped.questions[0].isSecret,false);
  await assert.rejects(run.bridge.replyUserInput('foreign-id',answer),{status:404});
  await assert.rejects(run.bridge.replyUserInput(mapped.id,{answers:{choice:{answers:['invented']}}}),{code:'user_input_invalid'});
  const first=run.bridge.replyUserInput(mapped.id,answer),second=run.bridge.replyUserInput(mapped.id,answer);
  await assert.rejects(run.bridge.replyUserInput(mapped.id,{skip:true}),{code:'user_input_conflict'});
  const command=(await f.manager.poll(registration.connectionId,f.auth)).commands[0];assert.equal(command.type,'user-input');assert.equal(command.inputId,'native-question');assert.deepEqual(command.answer,answer);
  assert.deepEqual((await f.manager.poll(registration.connectionId,f.auth)).commands,[]);
  assert.throws(()=>f.manager.events(registration.connectionId,{...f.auth,userId:f.otherId},{runId:run.entry.id,sequence:100,event:'user-input-resolved',data:{id:'native-question'}}),{status:404});
  run.event('user-input-resolved',{id:'native-question'});run.event('command-result',{commandId:command.id,ok:true});
  assert.deepEqual(await first,{ok:true});assert.deepEqual(await second,{ok:true});assert.deepEqual(await run.bridge.replyUserInput(mapped.id,answer),{ok:true});
  assert.equal(run.events.filter(item=>item.name==='user-input-resolved').length,1);
  assert.doesNotMatch(JSON.stringify(f.store.state),/native-question|继续|answers/);run.event('complete',{text:'done'});await run.completion;
});

test('skip is explicit and uncertain answer delivery is never resent',async t=>{
  const f=central(t),registration=await f.register(),run=await f.begin(registration);
  run.event('user-input',{id:'native-skip',questions,...dates()});const id=run.events.find(item=>item.name==='user-input').data.id;
  const pending=run.bridge.replyUserInput(id,{skip:true}),rejected=assert.rejects(pending,{code:'command_delivery_uncertain'});
  const command=(await f.manager.poll(registration.connectionId,f.auth)).commands[0];assert.deepEqual(command.answer,{skip:true});await rejected;
  await assert.rejects(run.bridge.replyUserInput(id,{skip:true}),{code:'command_delivery_uncertain'});assert.deepEqual((await f.manager.poll(registration.connectionId,f.auth)).commands,[]);
  run.event('complete',{text:'done'});await run.completion;
});

test('expiry, stop and disconnect retire mapped questions without answering them',async t=>{
  const f=central(t),registration=await f.register(),run=await f.begin(registration);
  run.event('user-input',{id:'native-expire',questions,...dates(20)});const id=run.events.find(item=>item.name==='user-input').data.id;await delay(25);
  await assert.rejects(run.bridge.replyUserInput(id,answer));assert.ok(run.events.some(item=>item.name==='user-input-resolved'&&item.data.id===id));
  const stop=(await f.manager.poll(registration.connectionId,f.auth)).commands[0];assert.equal(stop.type,'stop');run.event('stopped');await assert.rejects(run.completion);
  const other=await f.register(),second=await f.begin(other);second.event('user-input',{id:'native-disconnect',questions,...dates()});const secondId=second.events.find(item=>item.name==='user-input').data.id;
  f.manager.disconnect(other.connectionId,f.auth);await assert.rejects(second.completion,{code:'execution_unknown'});await assert.rejects(second.bridge.replyUserInput(secondId,answer));
});

test('central expiry requests a real stop under host clock skew and missing stop acknowledgement remains unknown',async t=>{
  const f=central(t,{clock:()=>Date.now()+60000,stopMs:30}),registration=await f.register(),run=await f.begin(registration);
  run.event('user-input',{id:'slow-host-clock',questions,...dates(1000)});
  const stop=await until(async()=>{const item=(await f.manager.poll(registration.connectionId,f.auth)).commands[0];return item?.type==='stop'&&item;});assert.equal(stop.runId,run.entry.id);
  await assert.rejects(run.completion,{code:'execution_unknown'});assert.equal(run.events.some(item=>item.name==='stopped'),false);
});

test('remote approval metadata is optional for legacy clients but enforces expiry and cannot-accept',async t=>{
  const f=central(t),registration=await f.register(),run=await f.begin(registration);
  run.event('approval',{id:'native-deny',kind:'command',description:'Sensitive operation',canAccept:false,...dates()});const card=run.events.find(item=>item.name==='approval').data;
  assert.equal(card.canAccept,false);await assert.rejects(run.bridge.approve(card.id,'accept'),{status:400});
  const declining=run.bridge.approve(card.id,'decline');const command=(await f.manager.poll(registration.connectionId,f.auth)).commands[0];assert.equal(command.decision,'decline');run.event('command-result',{commandId:command.id,ok:true});await declining;
  run.event('complete',{text:'done'});await run.completion;
});

test('secret answers are removed across split event deltas and cumulative model SSE for overlapping values',async t=>{
  const encode=value=>`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
  const full='prefix long-secret-password / secret-password suffix';
  const item=text=>({id:'message',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]});
  const final=full+' and synthetic-central-key';
  const sse=[{type:'response.created',response:{id:'response'}},{type:'response.output_item.added',output_index:0,item:{id:'message',type:'message',role:'assistant',content:[]}},
    ...['prefix long-sec','ret-password / sec','ret-password suffix'].map(delta=>({type:'response.output_text.delta',item_id:'message',output_index:0,content_index:0,delta})),
    {type:'response.output_text.done',item_id:'message',output_index:0,content_index:0,text:full},{type:'response.output_item.done',output_index:0,item:item(full)},
    {type:'response.output_item.added',output_index:1,item:{id:'message',type:'message',role:'assistant',content:[]}},
    {type:'response.output_text.delta',item_id:'message',output_index:1,content_index:0,delta:' and synthetic-central-key'},
    {type:'response.output_text.done',item_id:'message',output_index:1,content_index:0,text:final},{type:'response.output_item.done',output_index:1,item:item(final)},
    {type:'response.completed',response:{id:'response',status:'completed',output:[item(full),item(final)]}}].map(encode).join('');
  const f=central(t,{fetchImpl:async()=>new Response(sse,{headers:{'Content-Type':'text/event-stream'}})}),registration=await f.register(),run=await f.begin(registration);
  const secretQuestions=[{id:'long',header:'秘密',question:'输入密码',isSecret:true},{id:'short',header:'秘密',question:'输入另一个密码',isSecret:true}];
  run.event('user-input',{id:'native-secret',questions:secretQuestions,...dates()});const id=run.events.find(item=>item.name==='user-input').data.id;
  const pending=run.bridge.replyUserInput(id,{answers:{long:{answers:['long-secret-password']},short:{answers:['secret-password']}}});
  const command=(await f.manager.poll(registration.connectionId,f.auth)).commands[0];run.event('command-result',{commandId:command.id,ok:true});await pending;
  for(const text of ['prefix long-sec','ret-password / sec','ret-password suffix'])run.event('delta',{text});
  const req={params:{connectionId:registration.connectionId,runId:run.entry.id},headers:{authorization:`Bearer ${run.command.relayToken}`},body:Buffer.from(JSON.stringify({model:f.config.model,stream:true,input:'synthetic secret echo'}))};
  let wire='';const res=Object.assign(new EventEmitter(),{writableEnded:false,headersSent:false,status(){return this;},set(){this.headersSent=true;return this;},json(value){wire+=JSON.stringify(value);return this;},write(value){wire+=value;return true;},end(){this.writableEnded=true;},destroy(){this.writableEnded=true;}});
  await f.manager.relay(req,res);assert.equal(res.writableEnded,true);assert.doesNotMatch(wire,/long-secret-password|secret-password|synthetic-central-key/);
  const deltas=wire.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6))).filter(value=>value.type==='response.output_text.delta').map(value=>value.delta).join('');assert.equal(deltas,'prefix [已隐藏] / [已隐藏] suffix and [已隐藏]');
  run.event('complete',{text:''});await run.completion;assert.equal(run.events.filter(item=>item.name==='delta').map(item=>item.data.text).join(''),'prefix [已隐藏] / [已隐藏] suffix');
});

class ManualWorker extends DesktopExecutor { _start() {} }
const runCommand = () => ({id:'run-command',type:'run',runId:'run-one',conversationId:'conversation-one',prompt:'Synthetic prompt',permissions:{access:'read-only',approval:'ask'},model:'fixture-model',effort:'',codexRevision:randomUUID(),relayToken:'synthetic-run-only-token',attachments:[]});
async function desktop(t,{modern=true,ttl=300000,approval=false}={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-remote-input-desktop-')),events=[],replies=[];let native,finish;
  const worker=new ManualWorker({dataDir:directory,resolveCommand:async()=>({file:'synthetic-codex'}),toolsFactory:()=>({specs:[],async close(){}}),bridgeFactory:()=>({
    run(args){native=args;args.onEvent(approval?'approval':'user-input',approval?{id:'native-input',kind:'command',description:'Synthetic permission',canAccept:false,...dates(ttl)}:{id:'native-input',questions:[{id:'secret',header:'密码',question:'输入值',isSecret:true}],...dates(ttl)});if(args.signal.aborted)return Promise.reject(args.signal.reason);return new Promise((resolve,reject)=>{finish=resolve;args.signal.addEventListener('abort',()=>reject(args.signal.reason),{once:true});});},
    async replyUserInput(id,body){replies.push({id,body});native.onEvent('user-input-resolved',{id});return {answer:'must not echo sensitive output'};},async close(){finish?.({threadId:'synthetic-thread',text:'Done'});},
  }),fetchImpl:async(url,init)=>{
    if(url.endsWith('/auth/me'))return Response.json({instanceId:'fixture-instance',user:{id:'fixture-user',canUseCodex:true,agentAccess:'full'}});
    if(url.endsWith('/register'))return Response.json({hostId:'fixture-host',connectionId:'fixture-connection',leaseMs:30000,pollMs:20000,...(modern?{capabilities:{userInput:true}}:{})});
    if(url.endsWith('/events')){events.push(JSON.parse(init.body));return Response.json({ok:true});}if(init.method==='DELETE')return Response.json({ok:true});return new Response('',{status:404});
  }});
  await worker.connect({url:'https://synthetic.example',token:'synthetic-login',instanceId:'fixture-instance',userId:'fixture-user'});
  t.after(async()=>{await worker.close();await rm(directory,{recursive:true,force:true});});
  const ctx=worker.current;await worker._command(ctx,runCommand());await until(()=>events.some(item=>item.event===(approval?'approval':modern?'user-input':'status')));
  return {worker,ctx,events,replies,directory,finish:()=>finish?.({threadId:'synthetic-thread',text:'Done'})};
}

test('desktop forwards normalized input, answers once, and writes only command fingerprints to disk',async t=>{
  const f=await desktop(t),body={answers:{secret:{answers:['sensitive-whitespace password ']}}};
  const command={id:'answer-command',type:'user-input',runId:'run-one',inputId:'native-input',answer:body};
  await f.worker._command(f.ctx,command);await f.worker._command(f.ctx,command);await f.worker._command(f.ctx,{...command,id:'same-answer-new-command'});
  assert.equal(f.replies.length,1);assert.deepEqual(f.replies[0].body,body);
  await f.worker._command(f.ctx,{...command,id:'conflict-command',answer:{skip:true}});assert.equal(f.replies.length,1);
  assert.ok(f.events.some(item=>item.event==='command-result'&&item.data.code==='user_input_conflict'));
  assert.doesNotMatch(JSON.stringify(f.events),/sensitive-whitespace|must not echo/);
  const receipts=await readdir(path.join(f.ctx.directory,'receipts'));for(const name of receipts)assert.doesNotMatch(await readFile(path.join(f.ctx.directory,'receipts',name),'utf8'),/sensitive-whitespace|answers|password/);
  f.finish();await f.ctx.run.done;
});

test('desktop refuses expired input and stops unsupported old-central questions without automatically answering',async t=>{
  const f=await desktop(t,{ttl:15});await delay(20);await f.worker._command(f.ctx,{id:'expired-answer',type:'user-input',runId:'run-one',inputId:'native-input',answer:{skip:true}});
  assert.equal(f.replies.length,0);assert.ok(f.events.some(item=>item.event==='command-result'&&item.data.code==='user_input_expired'));f.finish();await f.ctx.run.done;
  const older=await desktop(t,{modern:false});await until(()=>older.events.some(item=>item.event==='stopped'));assert.equal(older.replies.length,0);assert.equal(older.events.some(item=>item.event==='user-input'),false);assert.ok(older.events.some(item=>item.event==='status'&&/不会代答/.test(item.data.message)));
});

test('desktop only adds approval metadata after both sides negotiated user input support',async t=>{
  for(const modern of [false,true]){
    const f=await desktop(t,{modern,approval:true}),card=f.events.find(item=>item.event==='approval').data;
    assert.equal(Object.hasOwn(card,'canAccept'),modern);assert.equal(Object.hasOwn(card,'requestedAt'),modern);assert.equal(Object.hasOwn(card,'expiresAt'),modern);if(modern)assert.equal(card.canAccept,false);
    f.finish();await f.ctx.run.done;
  }
});

test('real HTTP central/desktop loop restores a question on refresh and keeps secret answers out of history and disk',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-remote-question-http-')),dataDir=path.join(directory,'central'),token=randomUUID(),answers=[];
  const seed=await new JsonStore(dataDir).init();seed.state.codexConfig={...defaultCodexConfig(),mode:'api',baseUrl:'https://synthetic-model.invalid/v1',model:'fixture-question-model',apiKey:'synthetic-model-key'};await seed.save();
  const service=await createPetServer({dataDir,token,codex:{async status(){return{available:true,authenticated:true};},async run(){throw new Error('Central fixture must not invoke a model');},async close(){}},desktopTools:{specs:[],async close(){}},automationOptions:{autoStart:false},executorsOptions:{pollMs:1000,commandMs:1000,stopMs:100}});
  await listenFixture(service.server);const origin=`http://127.0.0.1:${service.server.address().port}`;
  let native,finish;
  const worker=new DesktopExecutor({dataDir:path.join(directory,'desktop'),name:'Synthetic remote question PC',resolveCommand:async()=>({file:'no-real-cli'}),toolsFactory:()=>({specs:[],async close(){}}),bridgeFactory:()=>({
    run(args){native=args;args.onEvent('thread',{threadId:'http-native-thread'});args.onEvent('turn',{turnId:'http-native-turn'});args.onEvent('user-input',{id:'http-native-input',questions:[{id:'password',header:'确认',question:'填写测试值',isSecret:true}],...dates()});return new Promise((resolve,reject)=>{finish=resolve;args.signal.addEventListener('abort',()=>reject(args.signal.reason),{once:true});});},
    async replyUserInput(id,body){answers.push({id,body});const value=body.answers.password.answers[0],half=Math.floor(value.length/2);native.onEvent('delta',{text:value.slice(0,half)});native.onEvent('delta',{text:value.slice(half)});native.onEvent('user-input-resolved',{id});return {ok:true};},async close(){},
  })});
  t.after(async()=>{await worker.close();await service.close();await rm(directory,{recursive:true,force:true});});
  const request=async(route,{method='GET',body}={})=>{const response=await fetch(origin+'/api'+route,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:await response.json()};};
  const identity=(await request('/auth/me')).data,online=await worker.connect({url:origin,token,instanceId:identity.instanceId,userId:identity.user.id});assert.equal(online.state,'online');
  const conversation=(await request('/conversations',{method:'POST',body:{mode:'codex'}})).data;
  assert.equal((await request(`/conversations/${conversation.id}/agent/submit`,{method:'POST',body:{submissionId:randomUUID(),hostId:online.hostId,content:'Synthetic question only'}})).status,200);
  const first=await until(async()=>{const value=(await request(`/conversations/${conversation.id}`)).data;return value.agent?.userInputs?.length&&value;});
  const refreshed=(await request(`/conversations/${conversation.id}`)).data;assert.deepEqual(refreshed.agent.userInputs,first.agent.userInputs);
  const id=first.agent.userInputs[0].id,secret='Synthetic-Personal-Secret-987';
  const reply=await request(`/codex/user-inputs/${id}`,{method:'POST',body:{answers:{password:{answers:[secret]}}}});assert.equal(reply.status,200);assert.equal(answers.length,1);assert.equal(answers[0].id,'http-native-input');
  const after=(await request(`/conversations/${conversation.id}`)).data;assert.deepEqual(after.agent.userInputs,[]);assert.equal(JSON.stringify(after).includes(secret),false);assert.equal(after.messages.at(-1).content,'[已隐藏]');
  finish({threadId:'http-native-thread',text:''});await until(async()=>(await request(`/conversations/${conversation.id}`)).data.agent.run.status==='completed');
  assert.equal((await readFile(path.join(dataDir,'state.json'),'utf8')).includes(secret),false);
  const receiptDir=path.join(worker.current.directory,'receipts');for(const name of await readdir(receiptDir))assert.equal((await readFile(path.join(receiptDir,name),'utf8')).includes(secret),false);
});
