import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
export const profileContentHash=content=>hash(content.trim().replace(/\s+/gu,' '));
export const profileFingerprint=entry=>hash(JSON.stringify([entry.id,entry.content,entry.updatedAt??null,...(entry.manualRevision?[entry.manualRevision]:[])]));
export const validProfileId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[45][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
export function validForgetEntries(value){
 return Array.isArray(value)&&value.length<=2000&&new Set(value.map(item=>item?.fingerprint)).size===value.length&&value.every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).every(k=>['id','fingerprint','contentHash','deletedAt','pending','changed'].includes(k))&&validProfileId(item.id)&&/^[a-f0-9]{64}$/.test(item.fingerprint)&&/^[a-f0-9]{64}$/.test(item.contentHash)&&typeof item.deletedAt==='string'&&Number.isFinite(Date.parse(item.deletedAt))&&typeof item.pending==='boolean'&&(item.changed===undefined||typeof item.changed==='boolean'));
}
export function forgottenProfile(entry,forgotten=[]){
 const fingerprint=profileFingerprint(entry),contentHash=profileContentHash(entry.content);
 return forgotten.some(item=>item.fingerprint===fingerprint||item.contentHash===contentHash);
}
export function visibleProfiles(entries,forgotten=[]){return entries.filter(entry=>!forgottenProfile(entry,forgotten));}
export function validCorrections(entries,revision){
 return Number.isSafeInteger(revision)&&revision>=0&&Array.isArray(entries)&&entries.length<=2000&&new Set(entries.map(e=>e?.id)).size===entries.length&&entries.every(e=>e&&validProfileId(e.id)&&typeof e.content==='string'&&!!e.content.trim()&&e.content.length<=6000&&typeof e.topic==='string'&&e.topic.length<=160&&typeof e.subtopic==='string'&&e.subtopic.length<=160&&(e.createdAt===null||typeof e.createdAt==='string'&&Number.isFinite(Date.parse(e.createdAt)))&&typeof e.updatedAt==='string'&&Number.isFinite(Date.parse(e.updatedAt))&&Number.isSafeInteger(e.manualRevision)&&e.manualRevision>0&&e.manualRevision<=revision);
}
export function effectiveProfiles(entries,forgotten=[],corrections=[]){
 const manualIds=new Set(corrections.map(e=>e.id));
 return [...corrections,...visibleProfiles(entries,forgotten).filter(e=>!manualIds.has(e.id))];
}
export function renderProfileContext(entries,forgotten=[],corrections=[]){
 const lines=[];let size=0;
 for(const entry of effectiveProfiles(entries,forgotten,corrections)){
  const line=JSON.stringify({topic:entry.topic,subtopic:entry.subtopic,content:entry.content,...(entry.manualRevision?{manuallyCorrected:true,correctedAt:entry.updatedAt}:{})}).replaceAll('<','\\u003c').replaceAll('>','\\u003e');
  if(!entry.manualRevision&&size+line.length+1>5700)continue;
  lines.push(line);size+=line.length+1;
 }
 return lines.length?lines.join('\n'):'';
}
