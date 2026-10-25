import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';

// SQLite's durable COMMIT can block for hundreds of milliseconds on Windows.
// Keep the complete transaction on this worker, with an authorization handshake
// before every bounded batch and immediately before its single atomic commit.
const {dbFile,job,archiveId,sourceStart,sourceEnd,messageCount}=workerData;
let database,transaction=false,finished=false,ordinal=0;
const safeCode=error=>/^(?:HISTORY|MEMORY)_[A-Z0-9_]{1,90}$/.test(error?.code||'')?error.code:'HISTORY_STORAGE_UNAVAILABLE';
function close(){try{database?.close();}catch{}database=null;parentPort.close();}
function abort(error){if(finished)return;finished=true;if(transaction){try{database.exec('ROLLBACK');}catch{}transaction=false;}parentPort.postMessage({type:'error',code:safeCode(error)});close();}
try{
 database=new DatabaseSync(dbFile);database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');transaction=true;
 database.prepare('INSERT INTO archives(id,account_id,dataset_id,manifest_sha,person_name,source_start,source_end,message_count,imported_at,memory_epoch) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,dataset_id) DO UPDATE SET memory_epoch=excluded.memory_epoch').run(archiveId,job.account_id,job.dataset_id,job.manifest_sha,job.person_name,sourceStart,sourceEnd,messageCount,new Date().toISOString(),job.epoch);
 const existing=database.prepare('SELECT id,payload_sha FROM messages WHERE account_id=? AND source=? AND msg_id=?'),insert=database.prepare('INSERT INTO messages(account_id,source,msg_id,payload_sha,speaker,occurred_at,occurred_ms,kind,selection,clean_text,original_text,record_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'),link=database.prepare('INSERT OR IGNORE INTO archive_messages(archive_id,message_id,ordinal) VALUES(?,?,?)');
 parentPort.on('message',message=>{
  if(finished)return;
  try{
   if(message.type==='abort'){abort({code:message.code});return;}
   if(message.type==='batch'){
    for(const {row,payload,json}of message.rows){let old=existing.get(job.account_id,'wechat',row.msg_id);if(old&&old.payload_sha!==payload)throw Object.assign(new Error(),{code:'HISTORY_MESSAGE_CONFLICT'});if(!old){const result=insert.run(job.account_id,'wechat',row.msg_id,payload,row.speaker,row.occurred_at,Date.parse(row.occurred_at),row.kind,row.selection,row.clean_text,row.original_text,json);old={id:result.lastInsertRowid};}link.run(archiveId,old.id,ordinal++);}
    parentPort.postMessage({type:'next'});return;
   }
   if(message.type==='finish'){
    if(ordinal!==messageCount)throw Object.assign(new Error(),{code:'HISTORY_INVALID_COUNT'});
    const reserve=database.prepare('INSERT OR IGNORE INTO memory_message_map(account_id,epoch,source,msg_id,event_id) VALUES(?,?,?,?,?)');for(const event of message.events)for(const msgId of event.messageIds)reserve.run(job.account_id,job.epoch,'wechat',msgId,event.id);
    database.prepare('UPDATE jobs SET state=?,archive_id=?,memory_total=?,plan_json=?,updated_at=?,error_code=NULL WHERE id=?').run('prepared',archiveId,message.events.length,JSON.stringify(message.events.map(({messageIds,...event})=>event)),new Date().toISOString(),job.id);
    parentPort.postMessage({type:'commit-ready'});return;
   }
   if(message.type==='commit'){database.exec('COMMIT');transaction=false;finished=true;parentPort.postMessage({type:'done'});close();return;}
   throw Object.assign(new Error(),{code:'HISTORY_WRITER_PROTOCOL'});
  }catch(error){abort(error);}
 });
 parentPort.postMessage({type:'next'});
}catch(error){abort(error);}
