const abortError = () => Object.assign(new Error('语音回复已取消。'), { name: 'AbortError' });

export function createSpeechAwaiter() {
  let waiting = null, latest = null;
  const settle = (job,error) => {
    if(waiting!==job)return;waiting=null;job.signal?.removeEventListener('abort',job.abort);
    if(error)job.reject(error);else job.resolve();
  };
  return {
    begin(id,signal,onAbort) {
      if(waiting)settle(waiting,abortError());
      return new Promise((resolve,reject)=>{
        const job={id,resolve,reject,signal,abort:()=>{settle(job,signal?.reason||abortError());onAbort?.();}};
        waiting=job;if(signal?.aborted){job.abort();return;}signal?.addEventListener('abort',job.abort,{once:true});
      });
    },
    observe(state) {
      latest=state;const job=waiting;
      if(!job||state.utteranceId!==job.id||!state.ended||state.active||state.pending)return;
      // Controllers may publish "stopped" then the concrete error in the same turn.
      queueMicrotask(()=>{const current=latest;if(waiting!==job||current?.utteranceId!==job.id||!current.ended||current.active||current.pending)return;
        settle(job,current.error?new Error(current.error):current.charIndex>=current.text.length?undefined:abortError());});
    },
    cancel(error=abortError()){if(waiting)settle(waiting,error);},
  };
}

/** Bounded sentence pieces are emitted once, with surrogate pairs kept intact. */
export function createSentenceSplitter(maxChars=180) {
  if(!Number.isInteger(maxChars)||maxChars<20||maxChars>500)throw new Error('Invalid sentence bound.');
  let pending='';
  function drain(final) {
    const result=[];
    while(pending.length) {
      let end=-1;
      for(let i=0;i<Math.min(pending.length,maxChars);i++)if(/[。！？!?；;\n]/u.test(pending[i])&&(i>=7||final)){end=i+1;break;}
      if(end<0&&pending.length>=maxChars){end=maxChars;if(/^[\uDC00-\uDFFF]$/u.test(pending[end]||''))end--;}
      if(end<0){if(!final)break;end=pending.length;}
      const piece=pending.slice(0,end).trim();pending=pending.slice(end);if(piece)result.push(piece);
    }
    return result;
  }
  return {push(delta){if(typeof delta!=='string'||delta.length>20000)throw new Error('回复分段格式或长度不正确。');pending+=delta;return drain(false);},finish(){return drain(true);}};
}

export function createSpeechQueue({ play, signal, maxChars=4000, maxItems=32, onError=()=>{} }) {
  let queue=[],count=0,running=false,ended=false,closed=false,resolve,reject;
  const done=new Promise((yes,no)=>{resolve=yes;reject=no;});void done.catch(()=>{});
  const fail=error=>{if(closed)return;closed=true;queue=[];count=0;signal?.removeEventListener('abort',cancel);reject(error);onError(error);};
  const cancel=()=>fail(signal?.reason||abortError());
  const complete=()=>{if(ended&&!running&&!queue.length&&!closed){closed=true;signal?.removeEventListener('abort',cancel);resolve();}};
  async function pump(){
    if(running||closed)return;running=true;
    try{while(queue.length&&!closed){const text=queue.shift();await play(text);if(closed)return;count-=text.length;}}
    catch(error){fail(error);}finally{running=false;complete();}
  }
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  return {
    enqueue(text){if(closed||ended)throw abortError();if(typeof text!=='string'||!text.trim())return;
      if(count+text.length>maxChars||queue.length+(running?1:0)>=maxItems){const error=new Error('回复较长，语音队列已达上限，请通过文字继续。');fail(error);throw error;}
      count+=text.length;queue.push(text);void pump();},
    finish(){ended=true;complete();return done;},
    cancel,
  };
}
