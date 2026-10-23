import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createWriteStream} from 'node:fs';
import {mkdir,writeFile,readFile,stat,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import readline from 'node:readline';
import path from 'node:path';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {summarizeSample} from './android-fluidity-metrics.mjs';

// Deliberately opt-in. Only a named synthetic emulator and loopback fixture are used.
const root=path.resolve('.');
const options={};const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){if(args[i]==='--summarize-only'){options.summarizeOnly=true;continue;}if(args[i].startsWith('--')){const key=args[i].slice(2);assert.ok(['output','apk','audit','web','expected-apk-sha','phase'].includes(key),'Known CLI option');assert.ok(args[i+1]&&!args[i+1].startsWith('--'),'Option requires a value');options[key]=args[++i];}else{assert.equal(options.output,undefined,'One output directory');options.output=args[i];}}
const base=path.resolve(options.output||'.data/deep-fluidity-20261023/android-baseline');
assert.ok(base.startsWith(path.resolve('.data/deep-fluidity-20261023')+path.sep),'Owned evidence directory required');
const baseline=path.join(root,'.data/android-deep-stability-20261023');
const auditFile=path.resolve(options.audit||path.join(baseline,'native-final-03/apk-audit/android-apk-audit.json'));
const appApk=path.resolve(options.apk||path.join(baseline,'apk-final-03/PetPal-0.9.14-Android-debug.apk'));
const frozen=path.resolve(options.web||path.join(baseline,'web-final-03'));
const expectedAppSha=options['expected-apk-sha']||'f3765e0ad48227bb63d2709cf9f10cee4c9e92350c6d726da8267313680e6d85';
const phase=options.phase||'baseline';assert.ok(['baseline','candidate'].includes(phase),'Known phase');
assert.match(expectedAppSha,/^[a-f0-9]{64}$/,'Explicit APK SHA256');
if(options.apk)assert.ok(options.audit&&options.web&&options['expected-apk-sha'],'Custom candidate requires its own audit, frozen web and explicit APK SHA');
if(phase==='candidate'&&!options.summarizeOnly)assert.ok(options.apk&&options.audit&&options.web&&options['expected-apk-sha'],'Candidate phase cannot silently measure the default baseline APK');
const testApk=path.join(root,'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk');
const adb='E:/Android/Sdk/platform-tools/adb.exe',emulator='E:/Android/Sdk/emulator/emulator.exe';
const avd='PetPal_Permissions_API36_20261023',serial='emulator-5592',port=5592;
const runner='com.petpal.app.test/androidx.test.runner.AndroidJUnitRunner';
const ext='/sdcard/Android/data/com.petpal.app/files';
const exec=promisify(execFile);
const run=(file,args,timeout=30000)=>exec(file,args,{cwd:root,encoding:'utf8',timeout,maxBuffer:32*1024*1024,windowsHide:true});
const ad=(args,timeout)=>run(adb,['-s',serial,...args],timeout);
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const json=async(name,value)=>writeFile(path.join(base,name),JSON.stringify(value,null,2)+'\n');
async function ownedProcesses(){
 const script="$items=@(Get-CimInstance Win32_Process -Filter \"Name = 'qemu-system-x86_64.exe' OR Name = 'emulator.exe'\" | Where-Object { $_.CommandLine -match '(?:^|\\s)-avd\\s+PetPal_Permissions_API36_20261023(?:\\s|$)' } | Select-Object ProcessId,ParentProcessId,Name); ConvertTo-Json -InputObject $items -Compress";
 return JSON.parse((await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script])).stdout||'[]');
}
async function until(label,probe,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){if(await probe())return;await delay(300);}throw Error('Timeout: '+label);}
async function listening(number){return new Promise(resolve=>{const socket=net.connect({port:number,host:'127.0.0.1'});socket.setTimeout(500);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});}
if(options.summarizeOnly){
 const previous=JSON.parse(await readFile(path.join(base,'result.json'),'utf8')),samples=[];
 for(const stage of['startup','scroll','stream'])for(let iteration=1;iteration<=3;iteration++){
  const name=stage+'-'+iteration,result=JSON.parse(await readFile(path.join(base,name+'.json'),'utf8'));
  assert.equal(result.passed,true);assert.equal(result.valid,true);assert.equal(result.nativeForeground,true);
  const gfxText=await readFile(path.join(base,name+'-gfx.txt'),'utf8'),after=await readFile(path.join(base,name+'-memory-after.txt'),'utf8');let before;try{before=await readFile(path.join(base,name+'-memory-before.txt'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  samples.push(summarizeSample(result,gfxText,before,after));
 }
 await json('result.json',{...previous,samples,aggregationVersion:2});await json('partial-result.json',{samples,aggregationVersion:2});console.log(JSON.stringify({reaggregated:true,samples:samples.length,rawMeasurementsModified:false}));process.exit(0);
}
await mkdir(base); // Never overwrite an earlier successful or failed collection.
let em,fixture,deviceVerified=false,fixtureReady,fixtureClosed,fixtureId=0;
const responses=new Map(),samples=[];
const cleanup={};let failure;
async function verifyDevice(){assert.match((await ad(['emu','avd','name'])).stdout.trim(),new RegExp('^'+avd+'\\s+OK$'));assert.match((await ad(['shell','getprop','ro.hardware'])).stdout,/ranchu|goldfish/);assert.equal((await ad(['shell','getprop','ro.build.version.sdk'])).stdout.trim(),'36');deviceVerified=true;}
async function pull(file,required=true){try{await ad(['pull',`${ext}/${file}`,path.join(base,file)]);return file.endsWith('.json')?JSON.parse(await readFile(path.join(base,file),'utf8')):await readFile(path.join(base,file),'utf8');}catch(error){if(required)throw error;return null;}}
async function command(command){const id=++fixtureId;fixture.stdin.write(JSON.stringify({id,command})+'\n');await until('synthetic fixture response',()=>responses.has(id),15000);const value=responses.get(id);assert.equal(value.ok,true);return value;}
async function measure(stage,iteration,extra={}){
 const name=stage+'-'+iteration;await verifyDevice();await ad(['shell','am','force-stop','com.petpal.app']);await ad(['logcat','-c']);
 const args=['shell','am','instrument','-w','-r','-e','class','com.petpal.app.AndroidFluidityRuntimeTest','-e','petpalFluidityRuntime','true','-e','perfStage',stage,'-e','iteration',String(iteration)];
 for(const[key,value]of Object.entries(extra))args.push('-e',key,String(value));args.push(runner);
 let output;
 try{output=await ad(args,180000);}catch(error){output={stdout:error.stdout||'',stderr:(error.stderr||'')+'\n'+error.message};}
 await writeFile(path.join(base,name+'-instrumentation.log'),output.stdout+output.stderr);
 await writeFile(path.join(base,name+'-logcat.log'),(await ad(['logcat','-d','-v','threadtime'])).stdout);
 if(!/OK \(1 test\)/.test(output.stdout)||/FAILURES!!!|INSTRUMENTATION_FAILED|Test run failed to complete/.test(output.stdout)){
  await pull(name+'-failure.json',false);await pull(name+'-failure.png',false);throw Error('Failed Android sample '+name+'; raw instrumentation retained');
 }
 const result=await pull(name+'.json');assert.equal(result.passed,true,name);assert.equal(result.valid,true,'Visible measurement only');assert.equal(result.nativeForeground,true,'Foreground measurement only');
 if(stage==='login'){console.log(JSON.stringify({stage,setupOnly:true,passed:true}));return;}
 const gfxText=await pull(name+'-gfx.txt'),after=await pull(name+'-memory-after.txt'),before=await pull(name+'-memory-before.txt',false);
 if(stage==='scroll'||stage==='stream')await pull(name+'-gfx-reset.txt');
 const summary=summarizeSample(result,gfxText,before,after);
 samples.push(summary);await json('partial-result.json',{samples});console.log(JSON.stringify({stage,iteration,passed:true,durationMs:summary.durationMs,rafP95Ms:summary.raf.p95Ms,longTaskMaxMs:summary.longTaskMaxMs}));
}
try{
 const audit=JSON.parse(await readFile(auditFile,'utf8'));
 assert.equal(sha(await readFile(appApk)),expectedAppSha);assert.equal(audit.passed,true);assert.equal(audit.app.sha256,expectedAppSha);
 assert.equal((await stat(appApk)).size,audit.app.bytes);
 for(const input of audit.nativeSourceInputs)assert.equal(sha(await readFile(path.join(root,input.path))),input.sha256,'Baseline native source '+input.path);
 for(const asset of audit.assetDigests)assert.equal(sha(await readFile(path.join(frozen,asset.file))),asset.sha256,'Baseline web '+asset.file);
 const backendFiles=(await run('rg',['--files','server','-g','*.mjs'])).stdout.trim().split(/\r?\n/),backend=[];
 for(const file of backendFiles)backend.push({file:file.replaceAll('\\','/'),sha256:sha(await readFile(path.join(root,file)))});
 await copyFile(testApk,path.join(base,'instrumentation.apk'));
 await json('baseline-identity.json',{phase,head:(await run('git',['rev-parse','HEAD'])).stdout.trim(),app:{...audit.app,file:appApk,sha256:expectedAppSha},testApkSha256:sha(await readFile(testApk)),nativeSourceInputs:audit.nativeSourceInputs,assetDigests:audit.assetDigests,backendSourceInputs:backend,frozenWebDirectory:frozen,syntheticOnly:true,formalPackagesModified:false});
 assert.ok(!(await run(adb,['devices'])).stdout.includes(serial),'Dedicated serial unused');
 assert.equal((await ownedProcesses()).length,0,'Dedicated AVD process unused');
 for(const number of[port,port+1,45331,45332])assert.equal(await listening(number),false,'Dedicated port unused '+number);
 fixture=spawn(process.execPath,[path.join(root,'scripts/android-fluidity-fixture.mjs'),base],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 const fixtureLog=createWriteStream(path.join(base,'fixture.log'));fixture.stderr.pipe(createWriteStream(path.join(base,'fixture.err.log')));
 readline.createInterface({input:fixture.stdout}).on('line',line=>{fixtureLog.write(line+'\n');let value;try{value=JSON.parse(line);}catch{return;}if(value.ready)fixtureReady=value.manifest;if(value.closed)fixtureClosed=value;if(value.id)responses.set(value.id,value);});
 await until('synthetic fixture ready',()=>{if(fixture.exitCode!==null)throw Error('Fixture exited');return!!fixtureReady;},30000);
 em=spawn(emulator,['-avd',avd,'-port',String(port),'-no-window','-no-audio','-no-snapshot','-no-boot-anim','-gpu','swiftshader_indirect'],{cwd:root,windowsHide:true,env:{...process.env,ANDROID_AVD_HOME:'E:/Android/Avd',ANDROID_USER_HOME:'E:/Android/AndroidUser'},stdio:['ignore','pipe','pipe']});
 em.stdout.pipe(createWriteStream(path.join(base,'emulator.out.log')));em.stderr.pipe(createWriteStream(path.join(base,'emulator.err.log')));
 await until('dedicated API36 boot',async()=>{if(em.exitCode!==null)throw Error('Emulator exited');try{return(await ad(['shell','getprop','sys.boot_completed'])).stdout.trim()==='1';}catch{return false;}},240000);
 await verifyDevice();await ad(['shell','input','keyevent','82']);await ad(['shell','svc','power','stayon','true']);await ad(['shell','wm','size','412x960']);await ad(['shell','wm','density','160']);await ad(['shell','settings','put','system','font_scale','1.0']);await ad(['shell','settings','put','secure','show_ime_with_hard_keyboard','1']);
 await json('device.json',{avd,serial,api:36,hardware:(await ad(['shell','getprop','ro.hardware'])).stdout.trim(),screen:(await ad(['shell','wm','size'])).stdout.trim(),density:(await ad(['shell','wm','density'])).stdout.trim(),fontScale:(await ad(['shell','settings','get','system','font_scale'])).stdout.trim(),softwareGpu:true,physicalOem:false,monitorOverhead:'Document-start rAF/PerformanceObserver and React commit counter; no duration profiler or HTML/state replacement',startupDefinition:'Cold app process to visible usable real login controls; no server authentication or home avatar included'});
 await ad(['install','-r',appApk],120000);await ad(['install','-r',testApk],120000);await verifyDevice();await ad(['shell','am','force-stop','com.petpal.app']);assert.match((await ad(['shell','pm','clear','com.petpal.app'])).stdout,/Success/);await ad(['reverse','tcp:45331','tcp:45331']);
 for(let i=1;i<=3;i++)await measure('startup',i);
 await measure('login',1);
 for(let i=1;i<=3;i++)await measure('scroll',i,{conversation:fixtureReady.history600.id,lastMessage:fixtureReady.history600.lastMessage});
 for(let i=1;i<=3;i++)await measure('stream',i,{conversation:fixtureReady.streams[i-1].id,expectedSha:fixtureReady.outputSha256});
 const verified=await command('verify');assert.equal(verified.values.length,3);for(const item of verified.values){assert.equal(item.complete,true);assert.equal(item.matches,true);assert.equal(item.characters,12500);}assert.equal(verified.upstreamRequests,3);assert.equal(verified.audioRequests,0);assert.equal(verified.externalCodeRequests,0);await json('fixture-verification.json',verified);
 await json('result.json',{passed:true,phase,aggregationVersion:2,samples,syntheticOnly:true,physicalDevice:false,productionAcceptance:false,formalPackagesModified:false,visibleSamplesOnly:true,hiddenSamplesAccepted:0,startupDefinition:'Cold app process to usable unauthenticated real login form',limitations:['API36 x86_64 emulator/software GPU is not physical OEM or ARM performance','rAF and native gfx completion measure different pipelines; neither is a physical FPS guarantee','React commit count only; production commit duration profiling unsupported','Avatar, authenticated home startup and audio workloads not measured in this first baseline']});
}catch(error){failure=error;await json('failure.json',{failed:true,error:error.message,completedSamples:samples.length});console.error(error.message);}
finally{
 if(fixture&&fixture.exitCode===null){fixture.stdin.write(JSON.stringify({command:'close'})+'\n');await until('fixture stopped',()=>fixture.exitCode!==null,30000).catch(()=>{fixture.kill();});}cleanup.fixtureClosed=fixtureClosed||null;
 if(deviceVerified){try{await verifyDevice();await ad(['reverse','--remove','tcp:45331']);cleanup.reverseRemoved=true;await ad(['shell','am','force-stop','com.petpal.app']);await ad(['shell','sync']);await ad(['emu','kill']);}catch(error){cleanup.deviceStopError=error.message;}}
 if(em)await until('owned emulator process stopped',()=>em.exitCode!==null,45000).catch(()=>{cleanup.emulatorProcessStopTimedOut=true;});
 cleanup.emulatorProcessExited=!em||em.exitCode!==null;
 cleanup.remainingOwnedProcesses=await ownedProcesses();
 cleanup.ports={};for(const number of[port,port+1,45331,45332])cleanup.ports[number]=await listening(number);
 // ADB may retain a stale transport; disconnect only our stopped process, after checking both emulator ports.
 if(em&&cleanup.emulatorProcessExited&&!cleanup.remainingOwnedProcesses.length&&!cleanup.ports[port]&&!cleanup.ports[port+1]&&(await run(adb,['devices'])).stdout.includes(serial)){await run(adb,['disconnect',serial]);cleanup.staleOwnedTransportDisconnected=true;}
 cleanup.ownedTransportAbsent=!(await run(adb,['devices'])).stdout.includes(serial);
 cleanup.measuredAppApkUnchanged=sha(await readFile(appApk))===expectedAppSha;
 await json('cleanup.json',cleanup);
 if(cleanup.remainingOwnedProcesses.length||Object.values(cleanup.ports).some(Boolean)||!cleanup.ownedTransportAbsent||!cleanup.measuredAppApkUnchanged){console.error('Owned runtime cleanup was incomplete; inspect cleanup.json');process.exitCode=1;}
}
if(failure)process.exitCode=1;
