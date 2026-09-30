import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatScroll,isNearChatBottom} from '../src/chat-scroll.mjs';

function fixture(){
  const metrics={scrollHeight:1000,clientHeight:300,scrollTop:700},changes=[],frames=new Map(),all=[];let id=0,writes=0,current=true;
  const follow=createChatScroll({read:()=>metrics,scrollBottom:()=>{writes++;metrics.scrollTop=metrics.scrollHeight-metrics.clientHeight;},onFollowing:value=>changes.push(value),isCurrent:()=>current,schedule:callback=>{frames.set(++id,callback);all.push(callback);return id;},cancel:id=>frames.delete(id)});
  return {follow,metrics,changes,frames,all,writes:()=>writes,setCurrent:value=>{current=value;},tick:()=>{for(const [id,callback] of [...frames]){frames.delete(id);callback();}}};
}
test('bottom threshold handles short messages and fractional browser scroll positions',()=>{
  assert.equal(isNearChatBottom({scrollHeight:200,clientHeight:400,scrollTop:0}),true);
  assert.equal(isNearChatBottom({scrollHeight:1000,clientHeight:300,scrollTop:619.5}),false);
  assert.equal(isNearChatBottom({scrollHeight:1000,clientHeight:300,scrollTop:620}),true);
});
test('stream, table and image resizes coalesce into one latest-layout scroll',()=>{
  const f=fixture();for(let i=0;i<30;i++){f.metrics.scrollHeight+=10;f.follow.contentChanged();}
  assert.equal(f.frames.size,1);f.tick();assert.equal(f.writes(),1);assert.equal(f.metrics.scrollTop,1000);
});
test('content growth may emit native scroll before the follow frame without a user scrolling up',()=>{
  const f=fixture();f.metrics.scrollHeight+=400;f.follow.contentChanged();
  f.follow.userScrolled();assert.deepEqual(f.changes,[]);f.tick();
  assert.equal(f.metrics.scrollTop,1100);assert.equal(f.writes(),1);
  f.metrics.scrollHeight+=600;f.follow.userScrolled();f.follow.contentChanged();f.tick();
  assert.equal(f.metrics.scrollTop,1700);assert.equal(f.writes(),2);assert.deepEqual(f.changes,[]);
});
test('automatic scrolling records its final position and downward resize anchoring remains followed',()=>{
  const f=fixture();f.metrics.scrollHeight=1600;f.metrics.scrollTop=740;
  f.follow.userScrolled();f.follow.contentChanged();f.tick();f.follow.userScrolled();
  assert.equal(f.metrics.scrollTop,1300);assert.deepEqual(f.changes,[]);
  f.metrics.clientHeight=200;f.follow.userScrolled();f.follow.contentChanged();f.tick();
  assert.equal(f.metrics.scrollTop,1400);assert.deepEqual(f.changes,[]);
  // Expanding a viewport clamps its scroll position upward, but it is still at bottom.
  f.metrics.clientHeight=500;f.metrics.scrollTop=1100;f.follow.userScrolled();
  assert.deepEqual(f.changes,[]);
  f.metrics.scrollTop=400;f.follow.userScrolled();assert.deepEqual(f.changes,[false]);
});
test('reading history interrupts a pending follow and subsequent content does not move the reader',()=>{
  const f=fixture();f.follow.contentChanged();f.metrics.scrollTop=100;f.follow.userScrolled();f.tick();
  f.metrics.scrollHeight+=200;f.follow.contentChanged();f.tick();
  assert.equal(f.writes(),0);assert.equal(f.metrics.scrollTop,100);assert.deepEqual(f.changes,[false]);
});
test('scrolling near the bottom resumes follow, while send/return-latest explicitly restores it',()=>{
  const f=fixture();f.metrics.scrollTop=0;f.follow.userScrolled();f.metrics.scrollTop=680;f.follow.userScrolled();f.follow.contentChanged();f.tick();assert.equal(f.writes(),1);
  f.metrics.scrollTop=0;f.follow.userScrolled();f.follow.latest();f.tick();assert.equal(f.writes(),2);assert.deepEqual(f.changes,[false,true,false,true]);
});
for(const cause of ['close','switch-account'])test(`${cause} prevents even an already-queued frame from moving another view`,()=>{
  const f=fixture();f.follow.latest();const callback=f.all.at(-1);if(cause==='close')f.follow.close();else f.setCurrent(false);callback();assert.equal(f.writes(),0);
});
