import path from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import readline from 'node:readline';
import {JsonStore} from '../server/store.mjs';
import {hashPassword} from '../server/auth.mjs';
import {createPetServer} from '../server/app.mjs';
const base=path.resolve(process.argv[2]||'');
if(!base.startsWith(path.resolve('.data/deep-fluidity-20261023')+path.sep))throw Error('Owned synthetic session directory required');
const dataDir=path.join(base,'private-session-fixture');await mkdir(dataDir);
const seed=await new JsonStore(dataDir).init();seed.state.users[0].username='syncfixture';seed.state.users[0].displayName='隔离长期登录验收';seed.state.users[0].password=await hashPassword('SyntheticSync123a');await seed.save();
const realNow=Date.now.bind(Date);let offset=0,baseline,loginCount=0,authMeRequests=0,authMeSuccess=0;Date.now=()=>realNow()+offset;
const memory={async getContext(){return'';},async status(){return{enabled:false};},async remember(){return{queued:false};},async close(){}};
const app=await createPetServer({dataDir,token:'synthetic-session-bootstrap-never-production',allowedOrigins:['https://localhost'],automationOptions:{autoStart:false},companionOptions:{autoStart:false},memoryOptions:{service:memory},codex:{async status(){return{available:false};},async close(){}}});
app.server.prependListener('request',(req,res)=>{if(req.method==='POST'&&req.url==='/api/auth/login')loginCount++;if(req.url==='/api/auth/me'){authMeRequests++;res.once('finish',()=>{if(res.statusCode===200)authMeSuccess++;});}});
await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(45321,'127.0.0.1',resolve);});
const output=value=>process.stdout.write(JSON.stringify(value)+'\n');output({ready:true,loopbackOnly:true,syntheticOnly:true});let closing=false;
async function snapshot(label){const state=JSON.parse(await readFile(path.join(dataDir,'state.json'),'utf8'));const session=state.sessions[0];
 if(label==='baseline'){if(!session||state.sessions.length!==1||loginCount!==1||session.rememberDevice!==true)throw Error('Synthetic baseline invalid');baseline={hash:session.tokenHash,created:session.createdAt};}
 return{label,loginCount,authMeRequests,authMeSuccess,exactlyOneLogin:loginCount===1,sessionPresent:!!session,sessionCount:state.sessions.length,sameTokenHash:!!session&&session.tokenHash===baseline?.hash,createdAtUnchanged:!!session&&session.createdAt===baseline?.created,rememberDevice:session?.rememberDevice===true,expiryFuture:!!session&&session.expiresAt>Date.now(),renewedAfterEightDays:!!session&&offset>=8*86400000&&session.expiresAt>Date.now()+89*86400000,fakeClockEightDays:offset>=8*86400000,machineClockUnchanged:true};}
async function close(){if(closing)return;closing=true;await app.close();output({closed:true,authMeRequests,authMeSuccess});process.exit(0);}
readline.createInterface({input:process.stdin}).on('line',async line=>{try{const request=JSON.parse(line);if(request.command==='close'){await close();return;}if(request.command==='advance8d')offset+=8*86400000;else if(request.command!=='snapshot')throw Error('Invalid fixture command');output({id:request.id,ok:true,...await snapshot(request.label)});}catch{output({ok:false,error:'Synthetic session fixture command failed'});}});
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
