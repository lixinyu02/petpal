import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
export const profileContentHash=content=>hash(content.trim().replace(/\s+/gu,' '));
export const profileFingerprint=entry=>hash(JSON.stringify([entry.id,entry.content,entry.updatedAt??null]));
export const validProfileId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[45][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
export function validForgetEntries(value){
 return Array.isArray(value)&&value.length<=2000&&new Set(value.map(item=>item?.fingerprint)).size===value.length&&value.every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).every(k=>['id','fingerprint','contentHash','deletedAt','pending','changed'].includes(k))&&validProfileId(item.id)&&/^[a-f0-9]{64}$/.test(item.fingerprint)&&/^[a-f0-9]{64}$/.test(item.contentHash)&&typeof item.deletedAt==='string'&&Number.isFinite(Date.parse(item.deletedAt))&&typeof item.pending==='boolean'&&(item.changed===undefined||typeof item.changed==='boolean'));
}
export function forgottenProfile(entry,forgotten=[]){
 const fingerprint=profileFingerprint(entry),contentHash=profileContentHash(entry.content);
 return forgotten.some(item=>item.fingerprint===fingerprint||item.contentHash===contentHash);
}
export function visibleProfiles(entries,forgotten=[]){return entries.filter(entry=>!forgottenProfile(entry,forgotten));}
export function renderProfileContext(entries,forgotten=[]){
 const lines=[];let size=0;
 for(const entry of visibleProfiles(entries,forgotten)){
  const line=JSON.stringify({topic:entry.topic,subtopic:entry.subtopic,content:entry.content}).replaceAll('<','\\u003c').replaceAll('>','\\u003e');
  if(size+line.length+1>5700)continue;
  lines.push(line);size+=line.length+1;
 }
 return lines.length?lines.join('\n'):'';
}
