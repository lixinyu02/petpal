/** ASR text is cumulative replacement, never a delta. EOF is not completion. */
export async function readAsrEvents(response, { signal, assertCurrent = () => {}, onReady = () => {}, onTranscript = () => {} } = {}) {
  if (!response.body) throw new Error('当前环境不支持识别字幕流。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', ready = false, terminal = false, transcript = '';
  const check = () => { signal?.throwIfAborted(); assertCurrent(); };
  const dispatch = block => {
    check(); let type = '', lines = [];
    for (const line of block.split('\n')) { if (line.startsWith('event:')) type = line.slice(6).trim(); else if (line.startsWith('data:')) lines.push(line.slice(5).trimStart()); }
    if (!lines.length) return;
    const data = JSON.parse(lines.join('\n')); type ||= data.type;
    if (terminal) throw new Error('识别服务在完成后继续发送数据。');
    if (type === 'error') throw new Error(typeof data.error === 'string' ? data.error.slice(0,500) : '语音识别未完成，请重试。');
    if (type === 'ready') { if(ready)throw new Error('识别服务重复启动。');ready=true;onReady(data);return; }
    if (type !== 'transcript' && type !== 'done') return;
    if (!ready || typeof data.text !== 'string' || data.text.length > 12000) throw new Error('识别字幕格式不正确。');
    transcript=data.text;onTranscript(transcript);
    if(type==='done')terminal=true;
  };
  const abort = () => { void reader.cancel(signal?.reason).catch(()=>{}); };
  signal?.addEventListener('abort',abort,{once:true});
  try {
    while(!terminal) {
      check(); const {value,done}=await reader.read();check();if(done)break;
      buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
      if(buffer.length>128*1024)throw new Error('识别字幕流超出大小限制。');
      let at;while((at=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,at);buffer=buffer.slice(at+2);dispatch(block);if(terminal)break;}
    }
    if(!terminal){buffer+=decoder.decode();if(buffer.trim())dispatch(buffer);}
    if(!terminal)throw new Error('识别连接提前断开，尚未收到完整结果。');
    check();return transcript;
  } finally { signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock(); }
}
