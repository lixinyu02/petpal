import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createCloudDesktop} from '../server/cloud-desktop.mjs';
import {listenFixture} from './helpers/loopback.mjs';

const id='0b11552b-e36b-49f9-a679-d7498cc50008';
async function fixture(t,{opening}={}){
 let active=true,gen='one',opened=0,ended=0,clock=1000;const streams=[],closed=Promise.withResolvers();
 const cloud={hostFor(userId,target){if(userId!=='a'||target!==id)throw Object.assign(new Error('forbidden'),{status:403});return{id,docker:{generation:gen,desktopAvailable:true}};},target(){if(!active)throw Object.assign(new Error('offline'),{status:409});},async openDesktop(){opened++;const readable=new PassThrough(),writable=new PassThrough();writable.on('data',bytes=>readable.write(bytes));const stream={readable,writable,close(){ended++;readable.destroy();writable.destroy();closed.resolve();},assertAuthorized(){if(!active)throw 0;}};streams.push(stream);return stream;}};
 if(opening){const original=cloud.openDesktop;cloud.openDesktop=async()=>{opening.started.resolve();await opening.release.promise;return original();};}
 const broker=createCloudDesktop({cloud,authorize:auth=>{if(!active||auth.session!=='valid')throw Object.assign(new Error('revoked'),{status:401});},allowOrigin:req=>req.headers.origin==='https://petpal.test',clock:()=>clock,checkMs:10});
 const server=http.createServer();server.on('upgrade',(req,socket,head)=>void broker.upgrade(req,socket,head));await listenFixture(server);const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await broker.close();for(const s of streams){s.readable.destroy();s.writable.destroy();}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const connect=(ticket,origin='https://petpal.test')=>new WebSocket(base.replace('http:','ws:')+`/api/cloud-docker/${id}/desktop/ws?ticket=${ticket}`,{origin});
 const rejected=async ws=>{let code;ws.on('unexpected-response',(_r,res)=>{code=res.statusCode;res.resume();ws.terminate();});ws.on('error',()=>{});await new Promise(resolve=>ws.once('close',resolve));return code;};
 return{broker,connect,rejected,closed:closed.promise,get opened(){return opened;},get ended(){return ended;},revoke(){active=false;},advance(){clock+=31000;},rebuild(){gen='two';}};
}
test('desktop tickets isolate users, expire and reject foreign origins before opening a stream',async t=>{
 const f=await fixture(t);assert.throws(()=>f.broker.issue({userId:'b',session:'valid'},id),/forbidden/);
 const expired=f.broker.issue({userId:'a',session:'valid'},id);f.advance();assert.equal(await f.rejected(f.connect(expired.ticket)),401);
 const origin=f.broker.issue({userId:'a',session:'valid'},id);assert.equal(await f.rejected(f.connect(origin.ticket,'https://evil.test')),403);assert.equal(f.opened,0);
});
test('one-use desktop ticket relays real binary frames and cannot reconnect',async t=>{
 const f=await fixture(t),ticket=f.broker.issue({userId:'a',session:'valid'},id),ws=f.connect(ticket.ticket);ws.on('error',()=>{});await once(ws,'open');
 const message=once(ws,'message');ws.send(Buffer.from('RFB 003.008\n'));assert.equal((await message)[0].toString(),'RFB 003.008\n');
 assert.equal(await f.rejected(f.connect(ticket.ticket)),401);ws.close();await once(ws,'close');await f.closed;assert.equal(f.opened,1);assert.equal(f.ended,1);
});
test('logout and container generation changes invalidate existing desktops and pending tickets',async t=>{
 const f=await fixture(t),ticket=f.broker.issue({userId:'a',session:'valid'},id),ws=f.connect(ticket.ticket);ws.on('error',()=>{});await once(ws,'open');f.revoke();await once(ws,'close');assert.equal(f.ended,1);
});
test('rebuilding a container cannot redeem a ticket from its old generation',async t=>{
 const f=await fixture(t),ticket=f.broker.issue({userId:'a',session:'valid'},id);f.rebuild();assert.equal(await f.rejected(f.connect(ticket.ticket)),409);assert.equal(f.opened,0);
});

test('shutdown rejects a pending desktop and closes its late stream',async t=>{
 const opening={started:Promise.withResolvers(),release:Promise.withResolvers()},f=await fixture(t,{opening});
 const ticket=f.broker.issue({userId:'a',session:'valid'},id),ws=f.connect(ticket.ticket);ws.on('error',()=>{});
 const disconnected=new Promise(resolve=>ws.once('close',resolve));await opening.started.promise;await f.broker.close();await disconnected;
 opening.release.resolve();await f.closed;assert.equal(f.ended,1);assert.notEqual(ws.readyState,WebSocket.OPEN);
});
