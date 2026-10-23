import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {JsonStore} from '../server/store.mjs';
import {hashPassword} from '../server/auth.mjs';
import {createPetServer} from '../server/app.mjs';
const base=path.resolve(process.argv[2]||'');
if(!base.startsWith(path.resolve('.data/deep-fluidity-20261023')+path.sep))throw Error('Owned performance directory required');
const directory=path.join(base,'private-fixture');await mkdir(directory);
const seed=await new JsonStore(directory).init();const owner=seed.state.users[0];
owner.username='syncfixture';owner.displayName='隔离性能验收';owner.password=await hashPassword('SyntheticSync123a');
const provider={id:randomUUID(),name:'合成本地流式模型',protocol:'chat-completions',baseUrl:'http://127.0.0.1:45332/v1',model:'synthetic-performance',apiKey:'synthetic-local-key',supportsImages:false};
seed.state.providers=[provider];seed.state.settings.defaultProviderId=provider.id;
const date='2026-01-01T00:00:00.000Z';
const make=(title,count)=>({id:randomUUID(),userId:owner.id,title,mode:'chat',providerId:provider.id,projectId:null,archivedAt:null,createdAt:date,updatedAt:date,messages:Array.from({length:count},(_,index)=>({id:randomUUID(),role:index%2?'assistant':'user',status:'complete',createdAt:date,content:index%2?`### 合成历史 ${index}\n\n这是仅用于本机性能比较的虚构内容。`.repeat(6)+(index%8===1?'\n\n| 项目 | 内容 |\n| --- | --- |\n| 测量 | 合成数据 |\n\n```js\nconst sample = 1;\n```':''):`合成问题 ${index}：请整理这段没有个人信息的说明。`}))});
const history200=make('性能合成200条',200),history600=make('性能合成600条',600),streams=Array.from({length:3},(_,i)=>make('性能流式'+(i+1),0));
seed.state.conversations=[history600,history200,...streams];await seed.save();
const output='流式合成测量0123456789小伴性能验证。'.repeat(800).slice(0,12500);const sha=value=>createHash('sha256').update(value).digest('hex');
let upstreamRequests=0,audioRequests=0,externalCodeRequests=0;let closing=false;
const upstream=http.createServer(async(req,res)=>{
 if(req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
 for await(const chunk of req){}upstreamRequests++;
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});let index=0;
 const timer=setInterval(()=>{if(res.destroyed){clearInterval(timer);return;}const text=output.slice(index,index+25);index+=25;
  if(text)res.write('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n');
  if(index>=output.length){clearInterval(timer);res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');}
 },10);res.once('close',()=>clearInterval(timer));
});
await new Promise((resolve,reject)=>{upstream.once('error',reject);upstream.listen(45332,'127.0.0.1',resolve);});
const memory={async getContext(){return'';},async status(){return{enabled:false};},async remember(){return{queued:false,reason:'synthetic-performance-fixture'};},async close(){}};
const app=await createPetServer({dataDir:directory,token:'synthetic-performance-bootstrap',allowedOrigins:['https://localhost'],automationOptions:{autoStart:false},companionOptions:{autoStart:false},memoryOptions:{service:memory},codex:{async status(){return{available:false};},async close(){},async run(){externalCodeRequests++;throw Error('No Agent in performance fixture');}}});
app.server.prependListener('request',req=>{if(req.url?.includes('/speech')||req.url?.includes('/asr'))audioRequests++;});
await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(45331,'127.0.0.1',resolve);});
const manifest={history200:{id:history200.id,count:200,lastMessage:history200.messages.at(-1).id},history600:{id:history600.id,count:600,lastMessage:history600.messages.at(-1).id},streams:streams.map(c=>({id:c.id})),outputCharacters:output.length,outputSha256:sha(output),loopbackOnly:true,syntheticOnly:true};
await writeFile(path.join(base,'fixture-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');emit({ready:true,manifest});
async function close(){if(closing)return;closing=true;await app.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));emit({closed:true,upstreamRequests,audioRequests,externalCodeRequests});process.exit(0);}
readline.createInterface({input:process.stdin}).on('line',async line=>{try{const req=JSON.parse(line);if(req.command==='close'){await close();return;}if(req.command!=='verify')throw Error('Unknown command');const state=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8'));const values=streams.map(item=>{const c=state.conversations.find(c=>c.id===item.id),reply=c?.messages.findLast(m=>m.role==='assistant');return{id:item.id,complete:reply?.status==='complete',characters:reply?.content.length||0,sha256:reply?sha(reply.content):'',matches:reply?.content===output};});emit({id:req.id,ok:true,values,upstreamRequests,audioRequests,externalCodeRequests});}catch{emit({ok:false,error:'Synthetic fixture verification failed'});}});
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
