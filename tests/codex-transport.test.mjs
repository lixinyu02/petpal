import test from 'node:test';
import assert from 'node:assert/strict';
import {createCodexTransport,ResponsesStreamNormalizer} from '../server/codex-transport.mjs';

const config={mode:'api',baseUrl:'https://fixture.invalid/v1',model:'fixture-model',apiKey:['synthetic','upstream','only'].join('-')};
const frame=value=>`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
const message=(text='本地流测试完成。')=>({id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]});
const completed=(item=message())=>({type:'response.completed',response:{id:'resp_fixture',status:'completed',object:'response',output:[item]}});
const created={type:'response.created',response:{id:'resp_fixture',status:'in_progress',output:[]}};
const delta=text=>({type:'response.output_text.delta',item_id:'msg_fixture',output_index:0,content_index:0,delta:text});
const textDone=text=>({type:'response.output_text.done',item_id:'msg_fixture',output_index:0,content_index:0,text});
const simplified=()=>[created,delta('本地流'),delta('测试完成。'),textDone('本地流测试完成。'),completed(),{type:'response.done',response:completed().response}];
const parse=text=>text.split(/\r?\n\r?\n/).filter(Boolean).map(value=>value.split(/\r?\n/).find(line=>line.startsWith('data: '))).filter(Boolean).map(value=>JSON.parse(value.slice(6)));
const processEvents=values=>{const n=new ResponsesStreamNormalizer();return parse(values.flatMap(value=>n.accept(value)).concat(n.finish()).join(''));};
async function fixture(t,options={}){
  const requests=[];
  const transport=await createCodexTransport({config,fetchImpl:async(url,init)=>{requests.push({url,init});return options.fetch?options.fetch(url,init):new Response(simplified().map(frame).join(''),{headers:{'Content-Type':'text/event-stream'}});},...options});
  t.after(()=>transport.close());
  const request=(overrides={})=>fetch(`${transport.baseUrl}${overrides.path??'/responses'}`,{method:overrides.method??'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${transport.apiKey}`,...overrides.headers},body:overrides.method==='GET'?undefined:overrides.body??JSON.stringify({model:config.model,stream:true,input:[]}),signal:overrides.signal});
  return {transport,requests,request};
}

test('simplified message stream supplies item/part lifecycle once before text and preserves terminal response data',()=>{
  const events=processEvents(simplified()),types=events.map(value=>value.type);
  assert.deepEqual(types,['response.created','response.output_item.added','response.content_part.added','response.output_text.delta','response.output_text.delta','response.output_text.done','response.content_part.done','response.output_item.done','response.completed','response.done']);
  assert.deepEqual(events.find(value=>value.type==='response.output_item.done').item,message());
  assert.deepEqual(events.at(-2),completed());
});

test('complete standard events are passed through unchanged and never duplicated',()=>{
  const item=message(),values=[created,{type:'response.output_item.added',output_index:0,item:{...item,content:[],status:'in_progress'}},{type:'response.content_part.added',output_index:0,item_id:item.id,content_index:0,part:{type:'output_text',text:'',annotations:[]}},delta(item.content[0].text),textDone(item.content[0].text),{type:'response.content_part.done',output_index:0,item_id:item.id,content_index:0,part:item.content[0]},{type:'response.output_item.done',output_index:0,item},completed(item)];
  assert.deepEqual(processEvents(values),values);
});

test('missing function identities stay buffered until a complete final tool item supplies exact name and call_id',()=>{
  const n=new ResponsesStreamNormalizer(),args=JSON.stringify({action:'fixture'}),item={type:'function_call',id:'fc_fixture',name:'synthetic_tool',call_id:'call_fixture',arguments:args,status:'completed'};
  n.accept(created);
  assert.deepEqual(n.accept({type:'response.function_call_arguments.delta',output_index:0,item_id:item.id,delta:args}),[]);
  assert.deepEqual(n.accept({type:'response.function_call_arguments.done',output_index:0,item_id:item.id,arguments:args}),[]);
  assert.deepEqual(n.accept(completed(item)),[]);
  const values=parse(n.finish().join(''));
  assert.equal(values[0].type,'response.output_item.added');assert.equal(values[0].item.name,item.name);assert.equal(values[0].item.call_id,item.call_id);
  assert.equal(values.filter(value=>value.type==='response.function_call_arguments.done').length,1);
  const invalidItem={...item};delete invalidItem.call_id;
  assert.throws(()=>processEvents([created,completed(invalidItem)]));
  assert.equal(processEvents([created,completed(item)]).filter(value=>value.type==='response.output_item.added').length,1);
});

test('empty, incomplete, mismatched identities/text and malformed post-completion events fail before success markers',()=>{
  for(const values of [[created],[created,{...completed(),response:{...completed().response,output:[]}}],[created,completed(message(''))],[created,{type:'response.incomplete'}],[created,delta('different'),completed()],[created,{...delta('x'),item_id:''}],[created,completed(),delta('late')]]){
    const n=new ResponsesStreamNormalizer();const sent=[];
    assert.throws(()=>{for(const value of values)sent.push(...n.accept(value));sent.push(...n.finish());});
    assert.equal(sent.some(value=>value.includes('event: response.completed')),false);
  }
});

test('partial tool metadata is repaired only from matching final identity and inconsistent names/arguments are rejected',()=>{
  const item={type:'function_call',id:'fc_fixture',name:'synthetic_tool',call_id:'call_fixture',arguments:'{}',status:'completed'};
  const partial={type:'response.output_item.added',output_index:0,item:{id:item.id,type:'function_call',arguments:''}};
  const result=processEvents([created,partial,completed(item)]);
  assert.equal(result.filter(value=>value.type==='response.output_item.added').length,1);
  assert.equal(result.find(value=>value.type==='response.output_item.added').item.call_id,item.call_id);
  for(const changed of [{...item,name:'different_tool'},{...item,call_id:'different_call'}])assert.throws(()=>processEvents([created,{...partial,item:{...item,arguments:'',status:'in_progress'}},completed(changed)]));
  assert.throws(()=>processEvents([created,{type:'response.function_call_arguments.done',output_index:0,item_id:item.id,arguments:'{"x":1}'},completed(item)]));
});

test('loopback endpoint requires its private token and fixed method/path, sends only fixed upstream headers and does not follow redirects',async t=>{
  const f=await fixture(t);
  assert.match(f.transport.baseUrl,/^http:\/\/127\.0\.0\.1:\d+$/);assert.notEqual(f.transport.apiKey,config.apiKey);
  for(const request of [{headers:{Authorization:'Bearer invalid'}},{path:'/other'},{path:'/responses?url=https://other.invalid'},{method:'GET'},{headers:{Origin:'http://foreign.invalid'}}])assert.ok((await f.request(request)).status>=400);
  assert.equal(f.requests.length,0);
  const response=await f.request({headers:{Cookie:'test-cookie', 'X-Api-Key':'client-other-value','X-Customer-Header':'do-not-forward'}});
  assert.equal(response.status,200);assert.ok(parse(await response.text()).some(value=>value.type==='response.completed'));
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,`${config.baseUrl}/responses`);
  const init=f.requests[0].init;assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.headers.Authorization,`Bearer ${config.apiKey}`);
  assert.equal(Object.keys(init.headers).some(key=>/cookie|customer|x-api-key/i.test(key)),false);
  assert.equal(response.headers.get('set-cookie'),null);
});

test('upstream redirects, raw errors, wrong content type and oversized headers are rejected without echoing provider details',async t=>{
  for(const response of [new Response('private upstream diagnostics',{status:302,headers:{Location:'https://other.invalid'}}),new Response('private upstream diagnostics',{status:401}),new Response('{}',{headers:{'Content-Type':'application/json'}}),new Response('',{headers:{'Content-Type':'text/event-stream','X-Huge':'a'.repeat(17000)}})]){
    const f=await fixture(t,{fetch:()=>response}),result=await f.request(),body=await result.text();
    assert.ok(result.status>=400);assert.doesNotMatch(body,/private upstream|fixture\.invalid|synthetic-upstream/);assert.equal(f.requests.length,1);
  }
});

test('bounded request bodies/model/encoding are rejected before upstream fetch',async t=>{
  const f=await fixture(t,{limits:{requestBytes:128}});
  for(const options of [{body:'x'.repeat(129)},{body:JSON.stringify({model:'different',stream:true})},{body:JSON.stringify({model:config.model,stream:false})},{body:'{bad json'},{headers:{'Content-Encoding':'gzip'}}])assert.ok((await f.request(options)).status>=400);
  assert.equal(f.requests.length,0);
});

test('SSE parser handles UTF-8 chunk boundaries but rejects invalid JSON, truncation, oversized output and trailing corruption',async t=>{
  const content=simplified().map(frame).join(''),bytes=new TextEncoder().encode(content);
  const f=await fixture(t,{fetch:()=>new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.subarray(i,i+3));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}})});
  assert.ok(parse(await (await f.request()).text()).some(value=>value.type==='response.completed'));
  for(const body of ['event: response.created\ndata: {bad}\n\n',frame(created)+frame(delta('partial')),content+'data: {bad}\n\n',content.trimEnd()]){
    const bad=await fixture(t,{fetch:()=>new Response(body,{headers:{'Content-Type':'text/event-stream'}})}),events=parse(await (await bad.request()).text());
    assert.equal(events.some(value=>value.type==='response.completed'),false);assert.equal(events.at(-1).type,'error');
  }
  const bounded=await fixture(t,{limits:{outputBytes:100},fetch:()=>new Response(content,{headers:{'Content-Type':'text/event-stream'}})});
  assert.equal(parse(await (await bounded.request()).text()).at(-1).type,'error');
});

test('idle timeout and close abort pending upstream streams and drain owned requests',async t=>{
  for(const action of ['timeout','close','cancel']){
    let aborted=false,entered;
    const ready=new Promise(resolve=>{entered=resolve;});
    const f=await fixture(t,{idleTimeoutMs:action==='timeout'?25:1000,requestTimeoutMs:2000,fetch:(_url,init)=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(frame(created)));init.signal.addEventListener('abort',()=>{aborted=true;controller.error(new Error('stopped'));},{once:true});entered();},cancel(){aborted=true;}}),{headers:{'Content-Type':'text/event-stream'}})});
    const response=f.request().then(value=>value.text()).catch(()=>null);await ready;
    if(action==='close')await f.transport.close();else if(action==='cancel')await f.transport.cancelAll();
    await response;assert.equal(aborted,true);assert.equal(f.transport.activeRequests,0);
    if(action==='close')await assert.rejects(fetch(f.transport.baseUrl));
  }
});

test('disconnecting the authenticated client cancels its upstream request',async t=>{
  let canceled=0,entered;const ready=new Promise(resolve=>{entered=resolve;});
  const f=await fixture(t,{fetch:()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(frame(created)));entered();},cancel(){canceled++;}}),{headers:{'Content-Type':'text/event-stream'}})});
  const controller=new AbortController(),response=f.request({signal:controller.signal}).then(value=>value.text()).catch(()=>null);await ready;controller.abort();await response;
  for(let i=0;i<50&&f.transport.activeRequests;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(canceled,1);assert.equal(f.transport.activeRequests,0);
});
