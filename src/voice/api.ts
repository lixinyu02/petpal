import { api, getConnection, getSessionEpoch, getIdentity, subscribeSession, SessionChangedError } from '../api';
import { connectionFetch } from '../auth/native-fetch';
import { openAsrTransport, type AsrSession } from './asr-session.mjs';
export type { AsrSession };

export function openAsrSession(signal:AbortSignal,onTranscript:(text:string)=>void):Promise<AsrSession> {
  const epoch=getSessionEpoch(),connection={...getConnection()},fence=new AbortController();
  const assertCurrent=()=>{if(epoch!==getSessionEpoch()||!getIdentity())throw new SessionChangedError();};
  const unsubscribe=subscribeSession(()=>{if(epoch!==getSessionEpoch())fence.abort(new SessionChangedError());});
  return openAsrTransport({
    signal:AbortSignal.any([signal,fence.signal]),assertCurrent,onTranscript,onClose:unsubscribe,request:api,
    openEvents:(id,activeSignal)=>connectionFetch(`${connection.url}/api/voice/asr/sessions/${encodeURIComponent(id)}/events`,{headers:{Authorization:`Bearer ${connection.token}`,Accept:'text/event-stream'},signal:activeSignal}),
    remove:id=>connectionFetch(`${connection.url}/api/voice/asr/sessions/${encodeURIComponent(id)}`,{method:'DELETE',headers:{Authorization:`Bearer ${connection.token}`},signal:AbortSignal.timeout(4000)}),
  });
}
