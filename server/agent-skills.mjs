import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {chmod,lstat,mkdir,open,realpath,rename,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export const AGENT_SKILL_NAME='petpal-ncmcli';
export const AGENT_SKILL_FILES=Object.freeze(['LICENSE','PROVENANCE.json','SKILL.md']);
export const AGENT_SKILL_SOURCE_FILES=Object.freeze(AGENT_SKILL_FILES.map(file=>`server/native/skills/${AGENT_SKILL_NAME}/${file}`));
const defaultSourceDirectory=fileURLToPath(new URL(`./native/skills/${AGENT_SKILL_NAME}/`,import.meta.url)).replace(/\.asar([\\/])/i,'.asar.unpacked$1');
const MAX_FILE_BYTES=64*1024,MAX_TOTAL_BYTES=128*1024;
const failure=(message,code='invalid_skill_path')=>Object.assign(new Error(message),{status:409,code});
const canonical=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);

async function inspectPath(target,{create=false,directory=true}={}){
  const resolved=path.resolve(target),root=path.parse(resolved).root,parts=path.relative(root,resolved).split(path.sep).filter(Boolean);
  let cursor=root;
  for(let index=0;index<=parts.length;index++){
    if(index)cursor=path.join(cursor,parts[index-1]);
    let info;try{info=await lstat(cursor);}catch(error){
      if(error.code!=='ENOENT')throw error;
      if(!create)return null;
      try{await mkdir(cursor,{mode:0o700});}catch(creation){if(creation.code!=='EEXIST')throw creation;}
      info=await lstat(cursor);
    }
    const last=index===parts.length;
    if(info.isSymbolicLink()||((!last||directory)?!info.isDirectory():!info.isFile())||canonical(await realpath(cursor))!==canonical(cursor))throw failure('内置技能目录与文件不可经过链接或未知路径。');
    if(last)return info;
  }
}

async function readAsset(sourceDirectory,file){
  const source=path.join(sourceDirectory,file),info=await inspectPath(source,{directory:false});
  if(!info||info.size<1||info.size>MAX_FILE_BYTES)throw failure('内置技能资产缺失或超过大小上限，请安装完整客户端。','invalid_skill_asset');
  const handle=await open(source,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
    const current=await handle.stat();if(!current.isFile()||current.size<1||current.size>MAX_FILE_BYTES)throw failure('内置技能资产大小无效。','invalid_skill_asset');
    const buffer=Buffer.alloc(MAX_FILE_BYTES+1);let bytesRead=0;
    while(bytesRead<buffer.length){const next=await handle.read(buffer,bytesRead,buffer.length-bytesRead,bytesRead);if(next.bytesRead===0)break;bytesRead+=next.bytesRead;}
    if(bytesRead<1||bytesRead>MAX_FILE_BYTES)throw failure('内置技能资产读取超过大小上限。','invalid_skill_asset');
    return buffer.subarray(0,bytesRead);
  }finally{await handle.close();}
}

function verifyAssets(assets){
  let provenance;try{provenance=JSON.parse(assets.find(asset=>asset.file==='PROVENANCE.json').bytes.toString('utf8'));}catch{throw failure('内置技能来源记录格式无效。','invalid_skill_asset');}
  if(!provenance||provenance.upstream!=='https://github.com/NetEase/skills'||!/^[a-f0-9]{40}$/.test(provenance.revision)||provenance.license!=='Apache-2.0'||!Array.isArray(provenance.files)||provenance.files.length!==2)throw failure('内置技能来源记录字段无效。','invalid_skill_asset');
  for(const file of ['LICENSE','SKILL.md']){
    const entries=provenance.files.filter(entry=>entry?.path===file);
    const asset=assets.find(item=>item.file===file);
    if(entries.length!==1||!/^[a-f0-9]{64}$/.test(entries[0].sha256)||createHash('sha256').update(asset.bytes).digest('hex')!==entries[0].sha256)throw failure('内置技能资产校验失败，请安装完整客户端。','invalid_skill_asset');
  }
}

/** Only fixed, project-owned files enter this private Codex home. Other skills survive. */
export async function materializeAgentSkills(codexHome,{sourceDirectory=defaultSourceDirectory}={}){
  if(typeof codexHome!=='string'||!path.isAbsolute(codexHome)||/[\x00-\x1f\x7f]/.test(codexHome)||typeof sourceDirectory!=='string'||!path.isAbsolute(sourceDirectory))throw failure('技能需要明确的私有 Codex 绝对目录。');
  const assets=[];let totalBytes=0;
  // Validate every source before creating the destination; extra members are never read.
  for(const file of AGENT_SKILL_FILES){const bytes=await readAsset(sourceDirectory,file);totalBytes+=bytes.length;if(totalBytes>MAX_TOTAL_BYTES)throw failure('内置技能资产总大小超过上限。','invalid_skill_asset');assets.push({file,bytes});}
  verifyAssets(assets);
  const home=path.resolve(codexHome),skillsDirectory=path.join(home,'skills'),destination=path.join(skillsDirectory,AGENT_SKILL_NAME);
  for(const directory of [home,skillsDirectory,destination]){await inspectPath(directory,{create:true});await chmod(directory,0o700);}
  // Check all existing owned targets before replacing any of them.
  for(const asset of assets)await inspectPath(path.join(destination,asset.file),{directory:false});
  for(const asset of assets){
    const target=path.join(destination,asset.file),temporary=path.join(destination,`${asset.file}.${randomUUID()}.tmp`);let handle;
    try{
      handle=await open(temporary,'wx',0o600);await handle.writeFile(asset.bytes);await handle.sync();await handle.close();handle=null;
      await inspectPath(destination);await inspectPath(target,{directory:false});await rename(temporary,target);await chmod(target,0o600);
    }finally{await handle?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
  }
  return{skill:AGENT_SKILL_NAME,directory:destination,files:assets.map(({file,bytes})=>({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))};
}
