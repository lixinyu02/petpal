import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceReportTracker,spokenReportText} from '../src/voice/reports.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const report=(id,content='后台任务已经完成。')=>({id,role:'assistant',status:'complete',assistantTaskId:'task',content});
const conversation=(messages=[],id='conversation')=>({id,messages});

test('spoken reports strip Markdown destinations and HTML while preserving full long results and surrogate pairs',()=>{
  const source='# 完成\n**已完成** [检查](https://private.invalid/secret)\n<script>秘密</script>\n'+('结果😀'.repeat(2000));
  const message=report('long',source),text=spokenReportText(message.content);
  assert.ok(text.length<=800);assert.match(text,/完成 已完成 检查/);assert.match(text,/完整结果请在对话中查看/);
  assert.doesNotMatch(text,/https:|private|script|秘密|\*\*/);assert.equal(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(text),false);
  assert.equal(message.content,source);assert.equal(spokenReportText('**短结果**'),'短结果');assert.throws(()=>spokenReportText('结果',40),/Invalid/);
});

test('each explicit voice session seeds history before first delivery and does not reseed genuine reports on later turns',async()=>{
  const baseline=deferred(),delivered=[],loads=[],tracker=createVoiceReportTracker({isCurrent:()=>true,load:(id,signal)=>{loads.push({id,signal});return baseline.promise;},notify:report=>{delivered.push(report);return true;}});
  tracker.start();const signal=new AbortController().signal,seeding=tracker.seed('conversation',signal);
  tracker.accept(conversation([report('old'),report('new')]));assert.equal(delivered.length,0,'polls before seed cannot replay history or mark new IDs consumed');
  baseline.resolve(conversation([report('old')]));await seeding;
  tracker.accept(conversation([report('old'),report('new')]));assert.deepEqual(delivered.map(report=>report.id),['new']);
  assert.equal(await tracker.seed('conversation',signal),null);assert.equal(loads.length,1);assert.equal(loads[0].signal,signal);
  tracker.accept(conversation([report('old'),report('new'),report('later')]));assert.deepEqual(delivered.map(report=>report.id),['new','later']);tracker.stop();
});

test('paused polls remain readable without speech and reports existing at restart become its new baseline',async()=>{
  const delivered=[];let baseline=conversation([report('old')]);
  const tracker=createVoiceReportTracker({isCurrent:()=>true,load:async()=>baseline,notify:report=>{delivered.push(report);return true;}}),signal=new AbortController().signal;
  tracker.start();await tracker.seed('conversation',signal);tracker.stop();tracker.accept(conversation([report('old'),report('while-paused')]));assert.equal(delivered.length,0);
  baseline=conversation([report('old'),report('while-paused')]);tracker.start();await tracker.seed('conversation',signal);
  tracker.accept(conversation([report('old'),report('while-paused'),report('fresh')]));assert.deepEqual(delivered.map(report=>report.id),['fresh']);tracker.stop();
});

test('a stopped generation cannot seed or deliver after a newer voice session has begun',async()=>{
  const first=deferred(),second=deferred(),delivered=[];let loads=0;
  const tracker=createVoiceReportTracker({isCurrent:()=>true,load:()=>++loads===1?first.promise:second.promise,notify:report=>{delivered.push(report);return true;}}),signal=new AbortController().signal;
  tracker.start();const previous=tracker.seed('conversation',signal);tracker.stop();tracker.start();const next=tracker.seed('conversation',signal);
  second.resolve(conversation([report('new-baseline')]));await next;first.resolve(conversation([report('old-baseline')]));await assert.rejects(previous,{name:'AbortError'});
  tracker.accept(conversation([report('new-baseline'),report('fresh')]));assert.deepEqual(delivered.map(report=>report.id),['fresh']);tracker.stop();
});

test('aborted first-turn baselines are replaced for a barge-in turn while retaining its own request signal',async()=>{
  const first=deferred(),second=deferred(),signals=[];
  const tracker=createVoiceReportTracker({isCurrent:()=>true,load:(id,signal)=>{signals.push(signal);return signals.length===1?first.promise:second.promise;},notify:()=>true});
  tracker.start();const oldTurn=new AbortController(),newTurn=new AbortController(),previous=tracker.seed('conversation',oldTurn.signal);oldTurn.abort();
  const next=tracker.seed('conversation',newTurn.signal);second.resolve(conversation([report('baseline')]));await next;
  first.resolve(conversation());await assert.rejects(previous,{name:'AbortError'});assert.deepEqual(signals,[oldTurn.signal,newTurn.signal]);tracker.stop();
});

test('foreground and queue pressure never swallow fresh reports; only successfully queued IDs are deduplicated',async()=>{
  const delivered=[];let capacity=false;
  const tracker=createVoiceReportTracker({isCurrent:()=>true,load:async()=>conversation(),notify:report=>{if(!capacity)return false;delivered.push(report);return true;}});
  tracker.start();await tracker.seed('conversation',new AbortController().signal);
  const latest=conversation([report('fresh','**结果** '+('字'.repeat(16000)))]);tracker.accept(latest);assert.equal(delivered.length,0);
  capacity=true;tracker.flush();tracker.accept(latest);assert.equal(delivered.length,1);assert.ok(delivered[0].text.length<=800);assert.equal(delivered[0].plainText,true);assert.equal(latest.messages[0].content.length>16000,true);tracker.stop();
});

test('account/provider fences and wrong-conversation baselines fail closed',async()=>{
  let current=true;const pending=deferred(),delivered=[];
  const tracker=createVoiceReportTracker({isCurrent:()=>current,load:()=>pending.promise,notify:report=>{delivered.push(report);return true;}});
  tracker.start();const seeding=tracker.seed('conversation',new AbortController().signal);current=false;pending.resolve(conversation([report('secret')]));await assert.rejects(seeding,{name:'AbortError'});
  tracker.accept(conversation([report('secret')]));assert.equal(delivered.length,0);tracker.stop();
  const wrong=createVoiceReportTracker({isCurrent:()=>true,load:async()=>conversation([], 'another'),notify:()=>true});wrong.start();await assert.rejects(wrong.seed('conversation',new AbortController().signal),/不一致/);wrong.stop();
});
