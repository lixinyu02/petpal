import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatRuns} from '../src/chat-runs.mjs';
import {mergeOrganizationSnapshot} from '../src/conversation-organization-sync.mjs';
const begin=(runs,id,n=1)=>runs.begin(id,{requestId:n,clientRequestId:'request-'+n});
test('separate conversations keep independent requests and stopping one does not cancel the other',()=>{
 const runs=createChatRuns(),a=begin(runs,'a'),b=begin(runs,'b',2);
 assert.ok(runs.owns(a)&&runs.owns(b));assert.deepEqual([...runs.pendingIds()],['a','b']);
 a.controller.abort();runs.finish(a,{phase:'cancelled'});assert.equal(b.controller.signal.aborted,false);assert.equal(b.pending,true);assert.equal(runs.get('b'),b);
 assert.throws(()=>begin(runs,'b',3));runs.close();assert.equal(b.controller.signal.aborted,true);assert.equal(runs.owns(b),false);
});
test('only a newer turn in the same conversation retires an old recovery',()=>{
 let cancelled=0;const runs=createChatRuns(),a=begin(runs,'a');runs.finish(a,{unread:true});a.recovery={cancel(){cancelled++;}};
 const b=begin(runs,'b',2);assert.equal(cancelled,0);assert.equal(runs.activity().a,'complete');runs.seen('a');assert.equal(runs.activity().a,undefined);
 const next=begin(runs,'a',3);assert.equal(cancelled,1);assert.equal(runs.owns(a),false);assert.equal(runs.finish(a),false);assert.ok(runs.owns(b)&&runs.owns(next));runs.close();
});
test('provisional creation gets a real ID without changing ownership, and account retirement fences every request',()=>{
 let current=true;const runs=createChatRuns({isCurrent:()=>current}),draft=begin(runs,null);
 runs.attach(draft,'created');assert.equal(runs.get(null),undefined);assert.equal(runs.get('created'),draft);assert.ok(runs.owns(draft));
 current=false;assert.equal(runs.owns(draft),false);assert.equal(runs.finish(draft),false);assert.throws(()=>begin(runs,'foreign'));runs.close();assert.equal(runs.isClosed(),true);
});
test('all resources close even when one recovery cancellation throws',()=>{
 const runs=createChatRuns(),a=begin(runs,'a'),b=begin(runs,'b',2);a.recovery={cancel(){throw Error('synthetic');}};
 runs.close();assert.equal(a.controller.signal.aborted,true);assert.equal(b.controller.signal.aborted,true);assert.equal(runs.pendingIds().size,0);
});
test('ordinary snapshots cannot erase active deltas or a conversation created after the read began',()=>{
 const a={id:'a',mode:'chat',title:'a',messages:[{id:'reply-a',content:'live text'}]},b={id:'b',mode:'chat',title:'b',messages:[{id:'reply-b',content:'new thread'}]};
 const before={conversations:[a,b],projects:[]},incoming={conversations:[{...a,messages:[]}],projects:[]};
 const merged=mergeOrganizationSnapshot(before,incoming,false,new Set(),new Set(['a','b']));assert.equal(merged.conversations[0].messages,a.messages);assert.equal(merged.conversations[1],b);
 const deleted=mergeOrganizationSnapshot(before,incoming,false,new Set(['b']),new Set(['a','b']));assert.deepEqual(deleted.conversations.map(c=>c.id),['a']);
 const idle=mergeOrganizationSnapshot(before,incoming,false,new Set());assert.equal(idle.conversations.length,1);assert.equal(idle.conversations[0].messages.length,0);
});
