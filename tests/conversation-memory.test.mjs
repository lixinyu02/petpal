import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationMemory} from '../server/conversation-memory.mjs';

test('ordinary memory remains unchanged when there is no imported evidence',async()=>{
 const content='existing context '.repeat(400),memory={getContext:async()=>content,status:async()=>({enabled:true})};
 const service=createConversationMemory({memory,archives:{getContext:async()=>''}});
 assert.equal(await service.getContext('one'),content);assert.deepEqual(await service.status(),{enabled:true});
});
test('profile and archive receive the same current account/query/signal and bounded dated context',async()=>{
 const calls=[],controller=new AbortController(),options={query:'my latest preference',signal:controller.signal};
 const service=createConversationMemory({memory:{getContext:async(...args)=>{calls.push(args);return 'p'.repeat(6000);}},archives:{getContext:async(...args)=>{calls.push(args);return 'dated-self-evidence '.repeat(400);}}});
 const result=await service.getContext('account-z',options);assert.equal(calls.length,2);for(const call of calls){assert.equal(call[0],'account-z');assert.equal(call[1].query,options.query);assert.ok(call[1].signal instanceof AbortSignal);}
 assert.ok(result.length<=6000);assert.match(result,/当前本人表述和更近的明确更新优先/);assert.match(result,/dated-self-evidence/);
});
test('an archive reader ignoring cancellation cannot withhold available account memory',async()=>{
 let captured;
 const service=createConversationMemory({memory:{getContext:async()=>'available'},archives:{getContext:async(_id,options)=>{captured=options.signal;return new Promise(()=>{});}}});
 const start=Date.now();assert.equal(await service.getContext('one'),'available');assert.ok(Date.now()-start<1500);assert.equal(captured.aborted,true);
});
test('a cut profile cannot leave open data tags or exceed the combined context budget',async()=>{
 const profile='<petpal_user_memory>"\\'.repeat(300),historical='<petpal_history_evidence>dated self</petpal_history_evidence>';
 const service=createConversationMemory({memory:{getContext:async()=>profile},archives:{getContext:async()=>historical}}),result=await service.getContext('one');
 assert.ok(result.length<6000);assert.equal(result.indexOf('<petpal_user_memory>'),-1);assert.ok(result.endsWith(historical));
 const quoted=result.split('现有记忆摘录（JSON字符串）：')[1].split('\n')[0];assert.ok(quoted.length<=2200);assert.ok(profile.startsWith(JSON.parse(quoted)));
});
test('archive unavailability preserves profile and late cancellation discards both sources',async()=>{
 const a=createConversationMemory({memory:{getContext:async()=>'profile'},archives:{getContext:async()=>{throw Error('unavailable');}}});assert.equal(await a.getContext('one'),'profile');
 const controller=new AbortController();const b=createConversationMemory({memory:{getContext:async()=>{controller.abort();return 'private';}},archives:{getContext:async()=>'private archive'}});assert.equal(await b.getContext('one',{signal:controller.signal}),'');
});
for(const first of ['profile','archive'])test(`${first} returning before a clear cannot survive a later combined response`,async()=>{
 let epoch=1,enabled=true,release,arrived;
 const reached=new Promise(r=>{arrived=r;}),gate=new Promise(r=>{release=r;});
 const memory={status:async()=>({enabled,epoch,scope:{instanceId:'instance',userId:'one'}}),getContext:async()=>{if(first==='archive')await gate;else arrived();return 'old profile';}};
 const archives={getContext:async()=>{if(first==='profile')await gate;else arrived();return 'old archive';}};
 const service=createConversationMemory({memory,archives}),result=service.getContext('one');await reached;epoch=2;enabled=false;release();assert.equal(await result,'');
});
test('offline cached profile uses the local scope fence without probing network health',async()=>{
 const memory={contextScope:async()=>({enabled:true,epoch:1,bindingRevision:0,scope:{instanceId:'offline',userId:'one'}}),status:()=>assert.fail('No health probe'),getContext:async()=>'cached profile'};
 const service=createConversationMemory({memory,archives:{getContext:async()=>''}});
 assert.equal(await service.getContext('one'),'cached profile');
});
test('a same-scope binding revision change discards combined evidence',async()=>{
 let revision=0;
 const memory={contextScope:async()=>({enabled:true,epoch:1,bindingRevision:revision,scope:{userId:'one'}}),getContext:async()=>{revision++;return'old cache';}};
 assert.equal(await createConversationMemory({memory,archives:{getContext:async()=>'old archive'}}).getContext('one'),'');
});
