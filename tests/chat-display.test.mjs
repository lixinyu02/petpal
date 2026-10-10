import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatDisplay} from '../src/chat-display.mjs';

function fixture() {
  const events=[],timers=new Map(),all=[];let sequence=0,current=true;
  const display=createChatDisplay({onText:text=>events.push(text),isCurrent:()=>current,schedule:callback=>{const id=++sequence;timers.set(id,callback);all.push(callback);return id;},cancel:id=>timers.delete(id)});
  return {display,events,timers,all,setCurrent:value=>{current=value;},tick:()=>{for(const [id,callback] of [...timers]){timers.delete(id);callback();}}};
}
test('first text is immediate while a burst becomes one ordered display update',()=>{
  const f=fixture();f.display.push('首');assert.deepEqual(f.events,['首']);
  for(const text of ['段','🙂','\n','**','后续','**'])f.display.push(text);
  assert.equal(f.timers.size,1);assert.deepEqual(f.events,['首']);f.tick();
  assert.deepEqual(f.events,['首','段🙂\n**后续**']);assert.equal(f.timers.size,0);
  f.display.push('下一段');assert.equal(f.timers.size,1);f.tick();assert.equal(f.events.join(''),'首段🙂\n**后续**下一段');
});
for(const event of ['status','approval','task','done','error'])test(`flush before ${event} preserves protocol order and cancels the delayed write`,()=>{
  const f=fixture();f.display.push('A');f.display.push('B');f.display.flush();f.events.push(event);
  if(['done','error'].includes(event))f.display.close();f.tick();
  assert.deepEqual(f.events,['A','B',event]);
});
test('the authoritative terminal snapshot cannot receive a late pending append',()=>{
  const f=fixture();let content='';
  const pending=f.display;pending.push('A');pending.push('B');const delayed=f.all.at(-1);
  pending.flush();content=f.events.join('');pending.close();content='authoritative AB';
  delayed();pending.push('C');assert.equal(content,'authoritative AB');assert.deepEqual(f.events,['A','B']);
});
for(const cause of ['abort','account-change','request-replacement','unmount'])test(`${cause} drops pending text, including an already-queued timer`,()=>{
  const f=fixture();f.display.push('accepted');f.display.push('stale');const delayed=f.all.at(-1);
  if(cause==='unmount'||cause==='abort')f.display.close();else f.setCurrent(false);
  delayed();f.display.flush();f.display.push('later');assert.deepEqual(f.events,['accepted']);
});
test('a broken stream flushes accepted partial text before reporting failure',()=>{
  const f=fixture();f.display.push('部分');f.display.push('回复');f.display.flush();f.events.push('network-error');f.display.close();f.tick();
  assert.deepEqual(f.events,['部分','回复','network-error']);
});
test('empty deltas do not consume the immediate first-text update',()=>{
  const f=fixture();f.display.push('');f.display.push('真实首段');assert.deepEqual(f.events,['真实首段']);assert.equal(f.timers.size,0);
});

test('long replies schedule fewer presentations while explicit delays and immediate flushes remain supported',()=>{
  const events=[],delays=[],timers=new Map();let sequence=0;
  const display=createChatDisplay({onText:text=>events.push(text),schedule:(callback,delay)=>{const id=++sequence;delays.push(delay);timers.set(id,callback);return id;},cancel:id=>timers.delete(id)});
  display.push('首');assert.equal(events.length,1);
  for(const text of ['短回复','a'.repeat(4000),'b'.repeat(4000)]){display.push(text);display.flush();assert.equal(timers.size,0);}
  assert.deepEqual(delays,[50,100,120]);assert.equal(events.join(''),'首短回复'+'a'.repeat(4000)+'b'.repeat(4000));
  display.close();
  const fixed=createChatDisplay({onText(){},delayMs:25,schedule:(_callback,delay)=>{assert.equal(delay,25);return 1;},cancel(){}});
  fixed.push('c'.repeat(12000));fixed.push('more');fixed.close();
});

test('an existing deadline is not extended when new deltas cross the long-reply threshold',()=>{
  const delays=[],timers=[],events=[];
  const display=createChatDisplay({onText:text=>events.push(text),schedule:(callback,delay)=>{delays.push(delay);timers.push(callback);return timers.length;},cancel(){}});
  display.push('首');display.push('a'.repeat(3998));display.push('到达门槛');
  assert.deepEqual(delays,[50]);timers[0]();assert.equal(events.length,2);
  display.push('之后');assert.deepEqual(delays,[50,100]);display.flush();display.close();
});
