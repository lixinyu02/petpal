/** Request ownership is per conversation; selection only controls presentation. */
export function createChatRuns({isCurrent=()=>true,onChange=()=>{}}={}){
 const runs=new Map();let closed=false;
 const current=()=>!closed&&isCurrent();
 const owns=run=>current()&&runs.get(run.conversationId)===run;
 const dispose=run=>{try{run.recovery?.cancel();}catch{}try{run.display?.close();}catch{}run.controller.abort();};
 return{
  isClosed:()=>closed,
  owns,
  get:id=>runs.get(id),
  begin(conversationId,{requestId,clientRequestId}){
   if(!current())throw new Error('Chat account is no longer active.');
   const previous=runs.get(conversationId);
   if(previous?.pending)throw new Error('This conversation is already replying.');
   if(previous){runs.delete(conversationId);dispose(previous);}
   const run={conversationId,requestId,clientRequestId,controller:new AbortController(),pending:true,phase:'running',status:'正在想怎么回答你…',error:'',approvals:[],unread:false,retryDraft:''};
   runs.set(conversationId,run);onChange();return run;
  },
  attach(run,id){
   if(!owns(run)||!id)throw new Error('Chat request ownership changed.');
   const previous=runs.get(id);if(previous&&previous!==run){if(previous.pending)throw new Error('This conversation is already replying.');runs.delete(id);dispose(previous);}
   runs.delete(run.conversationId);run.conversationId=id;runs.set(id,run);onChange();
  },
  finish(run,{phase='complete',unread=false}={}){
   if(!owns(run)||!run.pending)return false;
   run.pending=false;run.phase=phase;run.status='';run.unread=unread;onChange();return true;
  },
  seen(id){const run=runs.get(id);if(current()&&run?.unread){run.unread=false;onChange();}},
  pendingIds(){return new Set([...runs].filter(([id,run])=>id&&run.pending).map(([id])=>id));},
  activity(){return Object.fromEntries([...runs].filter(([id,run])=>id&&(run.pending||run.unread)).map(([id,run])=>[id,run.phase]));},
  discard(id){const run=runs.get(id);if(!run)return;runs.delete(id);dispose(run);if(current())onChange();},
  close(){if(closed)return;closed=true;const all=[...runs.values()];runs.clear();for(const run of all)dispose(run);},
 };
}
