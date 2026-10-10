import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,stat,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AGENT_SKILL_FILES,AGENT_SKILL_NAME,materializeAgentSkills} from '../server/agent-skills.mjs';
import {CODEX_TOOL_VERSION,defaultCodexConfig,prepareCodexRuntime} from '../server/codex-config.mjs';
import {CodexBridge,resolveBundledCodex} from '../server/codex.mjs';

const exec=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceDirectory=fileURLToPath(new URL('../server/native/skills/petpal-ncmcli/',import.meta.url));
async function setup(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'petpal-agent-skills-'));
  t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());assert.match(path.basename(directory),/^petpal-agent-skills-/);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  return{directory,home:path.join(directory,'codex','fixture'),source:path.join(directory,'source')};
}
async function assets(source,{skill='---\nname: petpal-ncmcli\ndescription: Isolated fixture.\n---\nUse petpal_ncmcli.\n',license='Fixture license.\n'}={}){
  await mkdir(source,{recursive:true});await writeFile(path.join(source,'SKILL.md'),skill);await writeFile(path.join(source,'LICENSE'),license);
  await writeFile(path.join(source,'PROVENANCE.json'),JSON.stringify({upstream:'https://github.com/NetEase/skills',revision:'a'.repeat(40),license:'Apache-2.0',files:[{path:'SKILL.md',sha256:hash(skill)},{path:'LICENSE',sha256:hash(license)}]}));
}

test('fixed three assets materialize byte-for-byte, with receipts and private modes',async t=>{
  const f=await setup(t),receipt=await materializeAgentSkills(f.home);
  assert.equal(receipt.skill,AGENT_SKILL_NAME);assert.equal(receipt.directory,path.join(f.home,'skills',AGENT_SKILL_NAME));assert.equal(receipt.files.length,3);
  assert.deepEqual((await readdir(receipt.directory)).sort(),[...AGENT_SKILL_FILES].sort());
  for(const file of AGENT_SKILL_FILES){const source=await readFile(path.join(sourceDirectory,file)),destination=await readFile(path.join(receipt.directory,file));assert.deepEqual(destination,source);assert.equal(receipt.files.find(item=>item.file===file).sha256,hash(source));}
  if(process.platform!=='win32'){assert.equal((await stat(receipt.directory)).mode&0o777,0o700);for(const file of AGENT_SKILL_FILES)assert.equal((await stat(path.join(receipt.directory,file))).mode&0o777,0o600);}
});

test('repeated materialization updates only owned files and preserves unrelated skills and notes',async t=>{
  const f=await setup(t);await assets(f.source);await materializeAgentSkills(f.home,{sourceDirectory:f.source});
  const other=path.join(f.home,'skills','other','SKILL.md'),note=path.join(f.home,'skills',AGENT_SKILL_NAME,'notes.txt');await mkdir(path.dirname(other));await writeFile(other,'user skill preserved');await writeFile(note,'user notes preserved');
  await writeFile(path.join(f.source,'credential.json'),'must not be copied');await assets(f.source,{skill:'---\nname: petpal-ncmcli\ndescription: New fixture.\n---\nUpdated fixture.\n'});
  const receipt=await materializeAgentSkills(f.home,{sourceDirectory:f.source});assert.match(await readFile(path.join(receipt.directory,'SKILL.md'),'utf8'),/Updated fixture/);assert.equal(await readFile(other,'utf8'),'user skill preserved');assert.equal(await readFile(note,'utf8'),'user notes preserved');
  assert.deepEqual((await readdir(receipt.directory)).sort(),[...AGENT_SKILL_FILES,'notes.txt'].sort());assert.ok(!(await readdir(receipt.directory)).some(file=>file.endsWith('.tmp')));
});

test('missing, oversized or hash-mismatched source fails before creating a private home',async t=>{
  const f=await setup(t);await assets(f.source);await rm(path.join(f.source,'LICENSE'));await assert.rejects(materializeAgentSkills(f.home,{sourceDirectory:f.source}),error=>error.code==='invalid_skill_asset');assert.deepEqual(await readdir(f.directory),['source']);
  await assets(f.source,{skill:'x'.repeat(65537)});await assert.rejects(materializeAgentSkills(f.home,{sourceDirectory:f.source}),error=>error.code==='invalid_skill_asset');assert.deepEqual(await readdir(f.directory),['source']);
  await assets(f.source);await writeFile(path.join(f.source,'SKILL.md'),'tampered');await assert.rejects(materializeAgentSkills(f.home,{sourceDirectory:f.source}),error=>error.code==='invalid_skill_asset');assert.deepEqual(await readdir(f.directory),['source']);
  await assets(f.source);await writeFile(path.join(f.source,'PROVENANCE.json'),'not JSON');await assert.rejects(materializeAgentSkills(f.home,{sourceDirectory:f.source}),error=>error.code==='invalid_skill_asset');
});

test('source size budget bounds the complete asset set and malformed provenance is rejected',async t=>{
  const f=await setup(t);await assets(f.source,{skill:'s'.repeat(65536),license:'l'.repeat(65536)});await assert.rejects(materializeAgentSkills(f.home,{sourceDirectory:f.source}),error=>error.code==='invalid_skill_asset');
  await assets(f.source);const provenance=JSON.parse(await readFile(path.join(f.source,'PROVENANCE.json'),'utf8'));provenance.files.push(provenance.files[0]);await writeFile(path.join(f.source,'PROVENANCE.json'),JSON.stringify(provenance));await assert.rejects(materializeAgentSkills(f.home,{sourceDirectory:f.source}),error=>error.code==='invalid_skill_asset');
  await assert.rejects(materializeAgentSkills('relative/home',{sourceDirectory:f.source}),error=>error.code==='invalid_skill_path');
});

test('destination ancestor links are rejected without changing the outside target',async t=>{
  const f=await setup(t),outside=path.join(f.directory,'outside');await assets(f.source);await mkdir(outside);await mkdir(path.dirname(f.home),{recursive:true});await symlink(outside,f.home,process.platform==='win32'?'junction':'dir');
  await assert.rejects(materializeAgentSkills(f.home,{sourceDirectory:f.source}),error=>error.code==='invalid_skill_path');assert.deepEqual(await readdir(outside),[]);
});

test('linked skills directory and owned file are preserved rather than followed',async t=>{
  const f=await setup(t),outside=path.join(f.directory,'outside');await assets(f.source);await mkdir(f.home,{recursive:true});await mkdir(outside);await symlink(outside,path.join(f.home,'skills'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(materializeAgentSkills(f.home,{sourceDirectory:f.source}),error=>error.code==='invalid_skill_path');assert.deepEqual(await readdir(outside),[]);
  await rm(path.join(f.home,'skills'));const receipt=await materializeAgentSkills(f.home,{sourceDirectory:f.source}),target=path.join(receipt.directory,'SKILL.md'),victim=path.join(outside,'victim');await rm(target);await writeFile(victim,'preserved');
  try{await symlink(victim,target,'file');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.diagnostic('file symlink permission unavailable; directory junction verified');return;}throw error;}
  const license=await readFile(path.join(receipt.directory,'LICENSE'));await assets(f.source,{license:'changed license'});await assert.rejects(materializeAgentSkills(f.home,{sourceDirectory:f.source}),error=>error.code==='invalid_skill_path');assert.equal(await readFile(victim,'utf8'),'preserved');assert.deepEqual(await readFile(path.join(receipt.directory,'LICENSE')),license);
});

test('source ancestor and asset links are rejected and extra source secrets remain uncopied',async t=>{
  const f=await setup(t);await assets(f.source);const alias=path.join(f.directory,'source-link');await symlink(f.source,alias,process.platform==='win32'?'junction':'dir');await assert.rejects(materializeAgentSkills(f.home,{sourceDirectory:alias}),error=>error.code==='invalid_skill_path');
  const victim=path.join(f.directory,'secret-source');await writeFile(victim,'secret-not-readable');await rm(path.join(f.source,'LICENSE'));
  try{await symlink(victim,path.join(f.source,'LICENSE'),'file');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.diagnostic('file symlink permission unavailable; source directory junction verified');return;}throw error;}
  await assert.rejects(materializeAgentSkills(f.home,{sourceDirectory:f.source}),error=>error.code==='invalid_skill_path');assert.ok(!(await readdir(f.directory)).includes('codex'));
});

test('prepareCodexRuntime installs private skill across revisions without changing host skills',async t=>{
  const f=await setup(t),first={...defaultCodexConfig(),mode:'api',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-model',apiKey:'synthetic-fixture-key'},second={...first,revision:defaultCodexConfig().revision};
  const one=await prepareCodexRuntime(first,f.directory),two=await prepareCodexRuntime(second,f.directory);assert.notEqual(one.env.CODEX_HOME,two.env.CODEX_HOME);assert.equal(CODEX_TOOL_VERSION,'petpal-ncmcli-v1');
  for(const runtime of [one,two]){assert.ok(runtime.env.CODEX_HOME.startsWith(path.join(f.directory,'codex')));assert.equal(runtime.env.HOME,path.join(runtime.env.CODEX_HOME,'profile'));for(const file of AGENT_SKILL_FILES)assert.deepEqual(await readFile(path.join(runtime.env.CODEX_HOME,'skills',AGENT_SKILL_NAME,file)),await readFile(path.join(sourceDirectory,file)));}
  assert.ok(!(await readdir(f.directory)).includes('.codex'));
});

test('real Codex 0.143 discovers the skill from isolated CODEX_HOME without a model request', {timeout:45000}, async t=>{
  const f=await setup(t),binary=await resolveBundledCodex();assert.ok(binary?.file,'bundled Codex is required for this acceptance');const version=await exec(binary.file,[...binary.args,'--version']);assert.match(version.stdout,/codex-cli 0\.143\.0/);
  let upstreamRequests=0;const config={...defaultCodexConfig(),mode:'api',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-model',apiKey:'synthetic-fixture-key'};
  const bridge=new CodexBridge({dataDir:f.directory,config,command:binary.file,transportFetch:async()=>{upstreamRequests++;throw Error('skills discovery must not call a model');}});
  t.after(async()=>{await bridge.close();});
  try{
    await bridge._ensureStarted();const result=await bridge._rpc('skills/list',{cwds:[bridge.workspaceRoot],forceReload:true});
    const groups=result.data??result.results??[],skills=groups.flatMap(group=>group.skills??[]),skill=skills.find(item=>item.name===AGENT_SKILL_NAME);
    assert.ok(skill,`Skill missing from actual Codex response: ${JSON.stringify(result)}`);assert.match(skill.description,/网易云/);assert.equal(path.resolve(skill.path),path.join(f.directory,'codex',config.revision,'skills',AGENT_SKILL_NAME,'SKILL.md'));assert.equal(upstreamRequests,0);
    assert.ok(!JSON.stringify(result).includes(config.apiKey));
  }finally{await bridge.close();}
});
