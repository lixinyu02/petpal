import {randomBytes} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';

const failure=(status,message)=>Object.assign(new Error(message),{status});
const generation=host=>String(host?.docker?.generation??host?.generation??'');
const MAX_FRAME=256*1024;

/** Browser tickets have no platform credential and authorize exactly one owned desktop. */
export function createCloudDesktop({cloud,authorize,allowOrigin,clock=Date.now,ttlMs=30000,checkMs=1000}={}){
 const tickets=new Map(),connections=new Set(),wss=new WebSocketServer({noServer:true,maxPayload:MAX_FRAME,perMessageDeflate:false});let closed=false;
 const check=(auth,id,expected)=>{
  if(closed)throw failure(503,'桌面服务正在退出。');authorize(auth);
  const host=cloud.hostFor(auth.userId,id);cloud.target(auth.userId,id);
  if(expected!==undefined&&generation(host)!==expected)throw failure(409,'执行环境已变更，请重新打开桌面。');return host;
 };
 const sweep=()=>{for(const [key,item]of tickets)if(item.expiresAt<=clock())tickets.delete(key);};
 const timer=setInterval(sweep,1000);timer.unref?.();
 return {
  issue(auth,id){
   sweep();const host=check(auth,id);if(host.docker?.desktopAvailable===false)throw failure(409,'这个环境没有图形桌面，请选择桌面模板。');
   if(tickets.size>=128||[...connections].filter(c=>c.auth.userId===auth.userId).length>=2)throw failure(429,'打开的桌面连接过多，请先关闭一个。');
   const ticket=randomBytes(32).toString('base64url'),expiresAt=clock()+ttlMs;tickets.set(ticket,{auth:{...auth},id,generation:generation(host),expiresAt});
   return{ticket,expiresAt:new Date(expiresAt).toISOString(),path:`/api/cloud-docker/${id}/desktop/ws`};
  },
  async upgrade(req,socket,head){
   let stream,record,ws;
   const reject=status=>{if(!socket.destroyed){socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);socket.destroy();}};
   try{
    const url=new URL(req.url,'http://petpal.invalid'),match=/^\/api\/cloud-docker\/([a-f0-9-]{36})\/desktop\/ws$/.exec(url.pathname);
    if(!match||url.searchParams.size!==1||!url.searchParams.has('ticket')||!allowOrigin(req))throw failure(403,'桌面连接来源无效。');
    const key=url.searchParams.get('ticket'),item=tickets.get(key);tickets.delete(key);
    if(!item||item.id!==match[1]||item.expiresAt<=clock())throw failure(401,'桌面连接已过期。');
    check(item.auth,item.id,item.generation);
    if(connections.size>=16||[...connections].filter(c=>c.auth.userId===item.auth.userId).length>=2)throw failure(429,'桌面连接过多。');
    let pendingClosed=false;
    record={auth:item.auth,close:()=>{pendingClosed=true;socket.destroy();if(stream)Promise.resolve(stream.close()).catch(()=>{});}};connections.add(record);
    stream=await cloud.openDesktop(item.auth.userId,item.id);check(item.auth,item.id,item.generation);stream.assertAuthorized?.();
    if(pendingClosed||socket.destroyed)throw failure(499,'连接已关闭。');
    wss.handleUpgrade(req,socket,head,client=>{
     ws=client;let finished=false,watch;
     const end=()=>{if(finished)return;finished=true;clearInterval(watch);connections.delete(record);try{ws.close(1000);}catch{}Promise.resolve(stream.close()).catch(()=>{});};record.close=end;
     watch=setInterval(()=>{try{check(item.auth,item.id,item.generation);stream.assertAuthorized?.();}catch{end();}},checkMs);watch.unref?.();
     ws.on('message',(bytes,binary)=>{try{check(item.auth,item.id,item.generation);stream.assertAuthorized?.();if(!binary||bytes.length>MAX_FRAME)throw 0;if(!stream.writable.write(bytes))ws.pause();}catch{end();}});
     stream.writable.on('drain',()=>ws.resume());stream.writable.on('error',end);
     stream.readable.on('data',bytes=>{if(ws.readyState!==WebSocket.OPEN)return;try{check(item.auth,item.id,item.generation);if(ws.bufferedAmount>1024*1024)throw 0;for(let at=0;at<bytes.length;at+=MAX_FRAME)ws.send(bytes.subarray(at,at+MAX_FRAME),{binary:true},error=>{if(error)end();});}catch{end();}});
     stream.readable.on('end',end);stream.readable.on('error',end);ws.on('close',end);ws.on('error',end);
    });
   }catch(error){connections.delete(record);if(stream)await Promise.resolve(stream.close()).catch(()=>{});if(ws)ws.close();else reject(error?.status>=400&&error?.status<600?error.status:502);}
  },
  async close(){if(closed)return;closed=true;clearInterval(timer);tickets.clear();for(const item of connections)item.close();connections.clear();wss.close();},
 };
}
