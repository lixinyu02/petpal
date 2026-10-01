import test from 'node:test';
import assert from 'node:assert/strict';
import {CumulativeMessageAdapter,needsCumulativeMessageMapping} from '../server/response-message-segments.mjs';
import {ResponsesStreamNormalizer} from '../server/codex-transport.mjs';
import {createExecutorRelayRedactor} from '../server/executor-relay.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const prefix='查到了 3 条。';
const sourceId='msg_cumulative_fixture';
const responseId='resp_cumulative_fixture';
const textPart=text=>({type:'output_text',text,annotations:[],provider_annotation:'fixture-only'});
const message=(text,id=sourceId)=>({id,type:'message',role:'assistant',status:'completed',content:[textPart(text)],provider_extension:'preserved'});
const reasoning={id:'rs_fixture',type:'reasoning',status:'completed',summary:[]};
const tool={id:'fc_fixture',type:'function_call',name:'petpal_opencli_query',call_id:'call_fixture',arguments:'{"limit":3}',status:'completed',provider_extension:'tool-preserved'};
const created=()=>({type:'response.created',response:{id:responseId,status:'in_progress',output:[]}});
const added=(output_index,item)=>({type:'response.output_item.added',output_index,item:{...item,status:'in_progress',...(item.type==='message'?{content:[]}:{}),...(item.type==='function_call'?{arguments:''}:{})}});
const itemDone=(output_index,item)=>({type:'response.output_item.done',output_index,item});
const partAdded=output_index=>({type:'response.content_part.added',output_index,item_id:sourceId,content_index:0,part:textPart('')});
const delta=(output_index,text)=>({type:'response.output_text.delta',output_index,item_id:sourceId,content_index:0,delta:text});
const textDone=(output_index,text)=>({type:'response.output_text.done',output_index,item_id:sourceId,content_index:0,text});
const partDone=(output_index,text)=>({type:'response.content_part.done',output_index,item_id:sourceId,content_index:0,part:textPart(text)});
const toolDelta=text=>({type:'response.function_call_arguments.delta',output_index:2,item_id:tool.id,delta:text});
const toolDone=()=>({type:'response.function_call_arguments.done',output_index:2,item_id:tool.id,arguments:tool.arguments});
const completed=()=>({type:'response.completed',response:{id:responseId,object:'response',status:'completed',output:[clone(reasoning),message(prefix),clone(tool),message(`${prefix}\n`)],usage:{input_tokens:12,output_tokens:8}}});
const fixture=()=>{
  const end=completed();
  return [created(),added(0,reasoning),itemDone(0,reasoning),
    added(1,message(prefix)),partAdded(1),delta(1,'查到了 '),delta(1,'3 条。'),textDone(1,prefix),partDone(1,prefix),itemDone(1,message(prefix)),
    added(2,tool),toolDelta('{"limit":'),toolDelta('3}'),toolDone(),
    added(3,message(`${prefix}\n`)),partAdded(3),delta(3,'\n'),textDone(3,`${prefix}\n`),partDone(3,`${prefix}\n`),itemDone(3,message(`${prefix}\n`)),
    itemDone(2,tool),end,{type:'response.done',response:clone(end.response)}];
};
const mapEvents=values=>{const adapter=new CumulativeMessageAdapter();return values.map(value=>adapter.map(value));};
const parse=text=>text.split(/\r?\n\r?\n/).filter(Boolean).map(frame=>frame.split(/\r?\n/).find(line=>line.startsWith('data: '))).filter(Boolean).map(line=>JSON.parse(line.slice(6)));
const normalize=values=>{const normalizer=new ResponsesStreamNormalizer();return parse(values.flatMap(value=>normalizer.accept(value)).concat(normalizer.finish()).join(''));};
const terminal=values=>values.find(value=>value.type==='response.completed').response;
const relayEvents=(values,model)=>{
  const redactor=createExecutorRelayRedactor({secret:['fixture','key','for','segments'].join('-'),model});
  const bytes=Buffer.from(values.map(value=>`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join('')),output=[];
  for(let offset=0;offset<bytes.length;offset+=3)output.push(...redactor.push(bytes.subarray(offset,offset+3)));
  output.push(...redactor.finish());
  return parse(output.join(''));
};
const rejectBeforeSuccess=values=>{
  const adapter=new CumulativeMessageAdapter(),normalizer=new ResponsesStreamNormalizer(),sent=[];
  assert.throws(()=>{for(const value of values)sent.push(...normalizer.accept(adapter.map(value)));sent.push(...normalizer.finish());});
  assert.equal(parse(sent.join('')).some(value=>value.type==='response.completed'||value.type==='response.done'),false);
};

test('cumulative mapping is enabled only for explicit Qwen model identities',()=>{
  for(const model of ['qwen3.8flash','qwen3.8-flash','halogen-qwen3.8-flash-next','QWEN3.8-FLASH','qwen'])assert.equal(needsCumulativeMessageMapping(model),true,model);
  for(const model of ['gpt-6.1-sol','deepseek-flash','my-qwen3.8-flash','qwenish','halogen-qwenish','',undefined,null,42])assert.equal(needsCumulativeMessageMapping(model),false,String(model));
});

test('repeated assistant IDs at output indices 1 and 3 receive unique references and per-segment snapshots',()=>{
  const values=fixture(),before=clone(values),mapped=mapEvents(values),secondAdded=mapped.find(value=>value.type==='response.output_item.added'&&value.output_index===3),newId=secondAdded.item.id;
  assert.notEqual(newId,sourceId);
  assert.equal(terminal(mapped).output[1].id,sourceId);
  assert.equal(terminal(mapped).output[1].content[0].text,prefix);
  assert.equal(terminal(mapped).output[3].id,newId);
  assert.equal(terminal(mapped).output[3].content[0].text,'\n');
  assert.equal(new Set(terminal(mapped).output.map(item=>item.id)).size,4);
  for(const value of mapped.filter(value=>value.output_index===3)){
    if(value.item)assert.equal(value.item.id,newId);
    if(value.item_id)assert.equal(value.item_id,newId);
  }
  assert.equal(mapped.find(value=>value.type==='response.output_text.delta'&&value.output_index===3).delta,'\n');
  assert.equal(mapped.find(value=>value.type==='response.output_text.done'&&value.output_index===3).text,'\n');
  assert.deepEqual(mapped.find(value=>value.type==='response.content_part.done'&&value.output_index===3).part,textPart('\n'));
  assert.deepEqual(mapped.find(value=>value.type==='response.output_item.done'&&value.output_index===3).item,message('\n',newId));
  assert.deepEqual(values,before,'the provider events must not be mutated');
});

test('interleaved tool identities and arguments are unchanged while the strict normalizer fully closes each message segment',()=>{
  const values=fixture(),mapped=mapEvents(values);
  assert.deepEqual(mapped.filter(value=>value.output_index===2),values.filter(value=>value.output_index===2));
  assert.deepEqual(terminal(mapped).output[2],tool);
  assert.deepEqual(terminal(mapped).usage,terminal(values).usage);
  const normalized=normalize(mapped);
  assert.deepEqual(normalized,mapped);
  assert.equal(normalized.filter(value=>value.type==='response.output_item.done').length,4);
  assert.equal(normalized.filter(value=>value.type==='response.output_text.done').length,2);
  assert.equal(normalized.at(-2).type,'response.completed');
  assert.equal(normalized.at(-1).type,'response.done');
  assert.equal(normalized.at(-1).response.output[3].content[0].text,'\n');
});

test('Qwen central relay supplies standard frames to an older desktop normalizer without a second adapter',()=>{
  const values=fixture(),relayed=relayEvents(values,'halogen-qwen3.8-flash-next'),normalized=normalize(relayed);
  assert.deepEqual(normalized,relayed);
  const final=terminal(normalized),messages=normalized.filter(value=>value.type==='response.output_item.added'&&value.item.type==='message');
  assert.equal(messages.length,2);
  assert.equal(new Set(messages.map(value=>value.item.id)).size,2);
  assert.equal(new Set(final.output.map(value=>value.id)).size,4);
  assert.deepEqual(final.output.filter(item=>item.type==='message').map(item=>item.content[0].text),[prefix,'\n']);
  assert.deepEqual(relayed.filter(value=>value.output_index===2),values.filter(value=>value.output_index===2));
  assert.deepEqual(final.output[2],tool);
  assert.equal(normalized.at(-2).type,'response.completed');
  assert.equal(normalized.at(-1).type,'response.done');
});

test('a GPT central relay keeps the same malformed source stream subject to strict rejection',()=>{
  const values=fixture(),relayed=relayEvents(values,'gpt-6.1-sol'),normalizer=new ResponsesStreamNormalizer(),sent=[];
  assert.deepEqual(relayed,values,'non-Qwen streams must not receive cumulative compatibility mapping');
  assert.throws(()=>{for(const value of relayed)sent.push(...normalizer.accept(value));sent.push(...normalizer.finish());});
  assert.equal(parse(sent.join('')).some(value=>value.type==='response.completed'||value.type==='response.done'),false);
});

test('mapping through two independent adapters is idempotent',()=>{
  const once=mapEvents(fixture()),twice=mapEvents(clone(once));
  assert.deepEqual(twice,once);
  assert.deepEqual(normalize(twice),normalize(once));
});

test('three cumulative segments retain earlier snapshots and strip the full preceding cumulative prefix',()=>{
  const values=fixture(),tail='附加结果。',cumulative=`${prefix}\n${tail}`;
  const end=values.find(value=>value.type==='response.completed');
  end.response.output.push(message(cumulative));
  values.splice(values.findIndex(value=>value.type==='response.completed'),0,
    added(4,message(cumulative)),partAdded(4),delta(4,tail),textDone(4,cumulative),partDone(4,cumulative),itemDone(4,message(cumulative)));
  values.at(-1).response=clone(end.response);
  const mapped=mapEvents(values),output=terminal(mapped).output;
  assert.deepEqual(output.filter(item=>item.type==='message').map(item=>item.content[0].text),[prefix,'\n',tail]);
  assert.equal(new Set(output.map(item=>item.id)).size,5);
  assert.deepEqual(normalize(mapped),mapped);
  assert.deepEqual(mapEvents(clone(mapped)),mapped);
});

test('empty successor deltas are explicit and valid while missing successor deltas are rejected',()=>{
  const values=fixture().map(value=>{
    if(value.output_index===3){
      if(value.type==='response.output_text.delta')return {...value,delta:''};
      if(value.type==='response.output_text.done')return {...value,text:prefix};
      if(value.type==='response.content_part.done')return {...value,part:textPart(prefix)};
      if(value.type==='response.output_item.done')return {...value,item:message(prefix)};
    }
    if(value.type==='response.completed'||value.type==='response.done'){const result=clone(value);result.response.output[3]=message(prefix);return result;}
    return value;
  });
  const mapped=mapEvents(values);
  assert.equal(terminal(mapped).output[3].content[0].text,'');
  assert.deepEqual(normalize(mapped),mapped);
  rejectBeforeSuccess(fixture().filter(value=>!(value.type==='response.output_text.delta'&&value.output_index===3)));
});

test('the mapper does not supply a terminal success when the provider stream is incomplete',()=>{
  const values=fixture().filter(value=>value.type!=='response.completed'&&value.type!=='response.done');
  const adapter=new CumulativeMessageAdapter(),normalizer=new ResponsesStreamNormalizer(),sent=values.flatMap(value=>normalizer.accept(adapter.map(value)));
  assert.throws(()=>normalizer.finish());
  assert.equal(parse(sent.join('')).some(value=>value.type==='response.completed'||value.type==='response.done'),false);
});

test('a cumulative successor cannot start before the preceding source message has completed',()=>{
  rejectBeforeSuccess(fixture().filter(value=>!(value.type==='response.output_item.done'&&value.output_index===1)));
});

test('conflicting cumulative prefixes or observed deltas cannot be used to repair a successor',()=>{
  for(const corrupt of [
    value=>value.type==='response.output_text.done'&&value.output_index===3?{...value,text:'changed prefix\n'}:value,
    value=>value.type==='response.output_text.delta'&&value.output_index===3?{...value,delta:'!'}:value,
    value=>value.type==='response.content_part.done'&&value.output_index===3?{...value,part:textPart(`${prefix}!`)}:value,
  ])rejectBeforeSuccess(fixture().map(corrupt));
});

test('cumulative successor annotations cannot retain offsets from the discarded prefix',()=>{
  const annotations=[{type:'url_citation',start_index:0,end_index:2,url:'https://fixture.invalid',title:'fixture citation'}];
  for(const type of ['response.content_part.done','response.output_item.done','response.completed','response.done']){
    const values=fixture().map(value=>{
      if(value.type!==type)return value;
      if(value.output_index===3){
        if(type==='response.content_part.done')return {...value,part:{...value.part,annotations}};
        if(type==='response.output_item.done')return {...value,item:{...value.item,content:value.item.content.map(part=>({...part,annotations}))}};
      }
      if(type==='response.completed'||type==='response.done'){
        const result=clone(value);result.response.output[3].content[0].annotations=annotations;return result;
      }
      return value;
    });
    rejectBeforeSuccess(values);
  }
});

test('cumulative successor content parts cannot publish nonempty initial text before deltas',()=>{
  for(const text of [prefix,`${prefix}\n`,'\n']){
    rejectBeforeSuccess(fixture().map(value=>value.type==='response.content_part.added'&&value.output_index===3?{...value,part:{...value.part,text}}:value));
  }
});

test('omitted annotations and omitted initial text remain valid for a cumulative successor',()=>{
  const values=fixture().map(value=>{
    if(value.output_index===3){
      const result=clone(value);
      if(result.part){delete result.part.annotations;if(result.type==='response.content_part.added')delete result.part.text;}
      if(result.item)delete result.item.content[0]?.annotations;
      return result;
    }
    if(value.type==='response.completed'||value.type==='response.done'){const result=clone(value);delete result.response.output[3].content[0].annotations;return result;}
    return value;
  });
  const mapped=mapEvents(values);
  assert.equal(terminal(mapped).output[3].content[0].text,'\n');
  assert.deepEqual(normalize(mapped),mapped);
});

test('a final completed snapshot cannot change an already finished message or segment',()=>{
  for(const index of [1,3]){
    const values=fixture(),end=values.find(value=>value.type==='response.completed');
    end.response.output[index].content[0].text+=' changed after done';
    rejectBeforeSuccess(values);
  }
  const values=fixture();
  values.find(value=>value.type==='response.completed').response.output[3].provider_extension='changed after done';
  rejectBeforeSuccess(values);
});

test('response.done cannot change cumulative output after response.completed',()=>{
  const values=fixture();
  values.at(-1).response.output[3].content[0].text+='late suffix';
  rejectBeforeSuccess(values);
});

test('changing a source ID at an existing output index cannot be treated as a new segment',()=>{
  rejectBeforeSuccess(fixture().map(value=>value.type==='response.output_text.delta'&&value.output_index===3?{...value,item_id:'msg_different_fixture'}:value));
  rejectBeforeSuccess(fixture().map(value=>value.type==='response.output_item.done'&&value.output_index===3?{...value,item:{...value.item,id:'msg_different_fixture'}}:value));
});

test('non-message IDs cannot be reused as cumulative assistant IDs',()=>{
  for(const id of [reasoning.id,tool.id]){
    const values=fixture().map(value=>{
      if(value.output_index===3)return {...value,...(value.item_id?{item_id:id}:{}),...(value.item?{item:{...value.item,id}}:{})};
      if(value.type==='response.completed'||value.type==='response.done'){const result=clone(value);result.response.output[3].id=id;return result;}
      return value;
    });
    rejectBeforeSuccess(values);
  }
});

test('a synthesized segment ID cannot collide with a provider item ID',()=>{
  const synthesized=mapEvents(fixture()).find(value=>value.type==='response.output_item.added'&&value.output_index===3).item.id;
  const values=fixture().map(value=>{
    if(value.output_index===0)return {...value,item:{...value.item,id:synthesized}};
    if(value.type==='response.completed'||value.type==='response.done'){const result=clone(value);result.response.output[0].id=synthesized;return result;}
    return value;
  });
  rejectBeforeSuccess(values);
});

test('strict tool name, call_id and argument gates remain active after message mapping',()=>{
  for(const change of [{name:'different_tool'},{call_id:'different_call'},{arguments:'{"limit":4}'}]){
    const values=fixture().map(value=>value.type==='response.output_item.done'&&value.output_index===2?{...value,item:{...value.item,...change}}:value);
    rejectBeforeSuccess(values);
  }
});
