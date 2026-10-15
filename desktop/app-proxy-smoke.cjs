'use strict';
const path=require('node:path');
const fs=require('node:fs/promises');
const http=require('node:http');

module.exports=async function smokeAppProxy({mainWindow,loginSmokeMain,origin,session,directory}){
  if(!directory)throw new Error('Proxy smoke requires isolated evidence');
  const call=(action,input)=>mainWindow.webContents.executeJavaScript(`window.petpal.appProxy.${action}(${input===undefined?'':JSON.stringify(input)})`);
  const guestDenied=await mainWindow.webContents.executeJavaScript('(async()=>{try{await window.petpal.appProxy.status();return false;}catch{return true;}})()');
  const login=await loginSmokeMain();
  const initial=await call('status');
  if(initial.running||initial.configured)throw new Error('Proxy smoke requires a fresh empty private profile');
  const sockets=new Set();let leakedAuth=false;
  const reply=(request,response)=>{leakedAuth ||= !!request.headers['proxy-authorization'];response.setHeader('Access-Control-Allow-Origin','*');response.end('app proxy verified');};
  const fixture=http.createServer(reply);
  fixture.on('connect',(request,socket)=>{leakedAuth ||= !!request.headers['proxy-authorization'];sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.once('data',()=>socket.end('HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\nContent-Length: 18\r\n\r\napp proxy verified'));});
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  try{
  const yaml=`proxies:\n  - name: 本机验收节点\n    type: http\n    server: 127.0.0.1\n    port: ${fixture.address().port}\nproxy-groups:\n  - name: 代理选择\n    type: select\n    proxies: [本机验收节点]\nrules:\n  - MATCH,代理选择\n`;
  const imported=await call('importText',{yaml});
  const started=await call('start');
  const publicRoute=await session.resolveProxy('https://example.com'),localRoute=await session.resolveProxy(origin),lanRoute=await session.resolveProxy('http://192.168.60.10:40000');
  const preferences=await call('preferences',{autoStart:true});
  const rendererForwarded=await mainWindow.webContents.executeJavaScript(`fetch('http://app-proxy-check.example/renderer',{signal:AbortSignal.timeout(10000)}).then(response=>response.text()).then(text=>text==='app proxy verified')`);
  const nodeForwarded=await fetch('http://app-proxy-check.example/node',{signal:AbortSignal.timeout(10000)}).then(response=>response.text()).then(text=>text==='app proxy verified');
  await mainWindow.loadURL(`${origin}/?chat=1&settings=1`);
  await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
    const deadline=Date.now()+25000;const check=()=>{const button=[...document.querySelectorAll('.settings-tabs button')].find(item=>item.textContent.includes('设备连接'));if(button){button.click();return resolve(true);}if(Date.now()>deadline)return reject(new Error('Settings tab unavailable'));setTimeout(check,50);};check();
  })`);
  const visible=await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
    const deadline=Date.now()+25000;const check=()=>{const panel=document.querySelector('.app-proxy-settings');if(panel&&panel.textContent.includes('1.19.32')){panel.scrollIntoView({block:'start'});return resolve(true);}if(Date.now()>deadline)return reject(new Error('Proxy settings unavailable'));setTimeout(check,50);};check();
  })`);
  await mainWindow.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'proxy-running.png'),(await mainWindow.webContents.capturePage()).toPNG());
  await call('preferences',{autoStart:false});const stopped=await call('stop');
  const finalRoute=await session.resolveProxy('https://example.com');
  const result={platform:process.platform,arch:process.arch,guestDenied,explicitOwnerLogin:login.explicitOwnerLogin===true,initiallyDisabled:initial.state==='stopped',configured:imported.configured,
    started:started.running,selectorVisible:started.groups.length>0,autoStartSaved:preferences.autoStart,settingsVisible:visible,rendererForwarded,nodeForwarded,proxyAuthNotForwarded:!leakedAuth,
    publicUsesOwnProxy:/^PROXY 127\.0\.0\.1:\d+$/.test(publicRoute),loopbackDirect:localRoute==='DIRECT',lanDirect:lanRoute==='DIRECT',
    stopped:stopped.state==='stopped',disabledDirect:finalRoute==='DIRECT',autoStartReset:stopped.autoStart===false};
  await fs.writeFile(path.join(directory,'proxy-result.json'),JSON.stringify(result,null,2));
  if(Object.values(result).some(value=>value===false))throw new Error('Native app proxy acceptance failed');
  return result;
  }finally{for(const socket of sockets)socket.destroy();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}
};
