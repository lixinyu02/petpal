import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {HISTORY_IMPORT_FILES} from '../../server/history-archives.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function makeHistoryBundle(directory,{records,personName='测试人物',personId=randomUUID(),ownerId=randomUUID(),selfCount=24,longOther=true,datasetId}={}){
 await mkdir(directory,{recursive:true});
 records??=[{msg_id:randomUUID(),source_participant:ownerId,speaker:'owner',occurred_at:'2025-02-01T09:00:00+08:00',original_text:longOther?'对方完整档案。'.repeat(10000):'另一位真人的发言',clean_text:'另一位真人的发言',kind:'text',type_code:1,source:{serial:0,local_id:0,shard:'synthetic.db',sort_seq:0},attachments:[],selection:'excluded'},...Array.from({length:selfCount},(_,i)=>({msg_id:randomUUID(),source_participant:personId,speaker:'subject',occurred_at:new Date(Date.parse('2025-02-01T10:00:00+08:00')+i*60000).toISOString().replace('Z','+00:00'),original_text:`本人历史自述${i}。`+'合成资料。'.repeat(70),clean_text:`本人历史自述${i}。`+'合成资料。'.repeat(70),kind:'text',type_code:1,source:{serial:i+1,local_id:i+1,shard:'synthetic.db',sort_seq:i+1},attachments:[],selection:'evidence_only_requires_extraction'}))];
 datasetId??=sha(JSON.stringify(records));const selected=records.filter(r=>r.selection==='evidence_only_requires_extraction'),maps=selected.map(row=>({chunk_id:sha(row.msg_id),dataset_id:datasetId,payload_budget_bytes:4000,parts:[{msg_id:row.msg_id,part_index:1,part_count:1,part_text:row.clean_text,part_sha256:sha(row.clean_text),selected_text_sha256:sha(row.clean_text),occurred_at:row.occurred_at,source:row.source}]})),requests=maps.map((chunk,i)=>({fields:{chunk_id:chunk.chunk_id,dataset_id:datasetId},messages:[{role:'user',alias:personName,created_at:selected[i].occurred_at,content:selected[i].clean_text}]}));
 const jsonl=items=>items.map(v=>JSON.stringify(v)).join('\n')+'\n';
 const values={'canonical.jsonl':jsonl(records),'source_map.jsonl':jsonl(maps),'memobase/requests.jsonl':jsonl(requests),'person.json':JSON.stringify({person_id:personId,owner_participant_id:ownerId,display_name:personName,dataset_id:datasetId})};
 const manifest={schema_version:'wechat-person-evidence-v1',status:'complete',dataset_id:datasetId,config:{subject_name:personName},statistics:{all:records.length,selected:selected.length,chunks:maps.length},files:{}};
 for(const name of HISTORY_IMPORT_FILES){const content=Buffer.from(values[name]||'synthetic fixture only\n');await mkdir(path.dirname(path.join(directory,name)),{recursive:true});await writeFile(path.join(directory,name),content);manifest.files[name]={bytes:content.length,sha256:sha(content)};}
 await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest));return{directory,manifest,datasetId,personName,personId,ownerId,records,maps,manifestSha256:sha(JSON.stringify(manifest))};
}
