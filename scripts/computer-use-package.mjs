import {readFile,readdir,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectComputerUseElf} from './computer-use-native-verify.mjs';
export const COMPUTER_USE_PACKAGE='node_modules/@zavora-ai/computer-use-mcp';
export const COMPUTER_USE_RUNTIME_FILES=['package.json','LICENSE','dist/server.js','dist/native.js','dist/session/openai-compat.js','libexec/linux-atspi.py'];
const targets=['win32-x64','win32-arm64','linux-x64','linux-arm64','darwin-x64','darwin-arm64'];
export async function filterComputerUseNative(appRoot,{platform,arch}={}){
  const directory=path.join(appRoot,COMPUTER_USE_PACKAGE);
  for(const name of await readdir(directory)){
    if(!name.endsWith('.node'))continue;
    const target=targets.find(t=>name===`computer-use-napi.${t}.node`);
    if(!target)throw Error('Unexpected Computer Use native member');
    if(!target.startsWith(platform+'-')||arch&&target!==`${platform}-${arch}`)await unlink(path.join(directory,name));
  }
}
export async function auditComputerUsePackage(appRoot,{platform,arch,expected}={}){
  if(!targets.includes(`${platform}-${arch}`))throw Error('Unsupported Computer Use target');
  const directory=path.join(appRoot,COMPUTER_USE_PACKAGE),metadata=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
  if(metadata.name!=='@zavora-ai/computer-use-mcp'||metadata.version!=='7.4.0'||metadata.license!=='MIT')throw Error('Computer Use package identity mismatch');
  const files=[];
  for(const relative of [...COMPUTER_USE_RUNTIME_FILES,`computer-use-napi.${platform}-${arch}.node`]){
    const bytes=await readFile(path.join(directory,relative));files.push({path:`${COMPUTER_USE_PACKAGE}/${relative}`,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
  }
  const nativeBytes=await readFile(path.join(directory,`computer-use-napi.${platform}-${arch}.node`));let native;
  if(platform==='linux')native=inspectComputerUseElf(nativeBytes,{arch,maximumGlibc:'2.39'});
  else if(platform==='win32'){
    if(nativeBytes.subarray(0,2).toString()!=='MZ')throw Error('Computer Use native is not PE');
    const offset=nativeBytes.readUInt32LE(60);if(offset+24>nativeBytes.length||nativeBytes.subarray(offset,offset+4).toString('hex')!=='50450000'||nativeBytes.readUInt16LE(offset+4)!==(arch==='x64'?0x8664:0xaa64))throw Error('Computer Use native PE architecture mismatch');
    native={arch,machine:nativeBytes.readUInt16LE(offset+4),sha256:files.at(-1).sha256,bytes:nativeBytes.length};
  }
  if(expected&&files.some(file=>!expected.files.some(item=>item.path===file.path&&item.sha256===file.sha256)))throw Error('Builder changed Computer Use runtime or license');
  for(const relative of COMPUTER_USE_RUNTIME_FILES)if(!(await stat(path.join(directory,relative))).isFile())throw Error('Computer Use required runtime missing');
  return {version:metadata.version,platform,arch,files,native};
}
