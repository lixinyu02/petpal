const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
const sameScope=(left,right)=>!!left&&!!right&&left.instanceId===right.instanceId&&left.userId===right.userId;
const sameSession=(left,right)=>sameScope(left,right)&&left.epoch===right.epoch&&left.url===right.url&&left.token===right.token;
const sessionError=()=>Object.assign(new Error('账号连接已变化，请重新操作。'),{code:'SESSION_CHANGED'});
export function notificationServerUrl(value){
  let url;try{url=new URL(value);}catch{throw new Error('后台任务提醒需要可信的 HTTPS 服务地址。');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('后台任务提醒需要可信的 HTTPS 服务地址。');
  return url.href.replace(/\/+$/,'');
}
export function notificationNavigation(value){
  if(!value||!['agent','chat-agent'].includes(value.source)||!['conversationId','agentConversationId','runId','eventId'].every(key=>safeId(value[key])))throw new Error('通知中的会话定位无效。');
  return Object.fromEntries(['conversationId','agentConversationId','runId','eventId','source'].map(key=>[key,value[key]]));
}

/** Framework/API-independent controller. Credentials never enter its public snapshot. */
export function createTaskNotificationController({native,session,register,revoke,refreshState,fetchConversation,foreground}){
  let generation=0,operation=null,pending=null,processing=null,knownScope=null;
  let value={status:null,busy:false,error:'',navigation:null};
  const listeners=new Set();
  const publish=patch=>{value={...value,...patch};for(const listener of listeners)listener();};
  const current=scope=>sameSession(scope,session());
  const assertCurrent=(scope,revision)=>{if(revision!==generation||!current(scope))throw sessionError();};
  const safeError=error=>error?.code==='SESSION_CHANGED'?'':String(error?.message||'暂时无法连接后台任务提醒。').slice(0,300);
  const refresh=async()=>{
    const revision=generation;
    const status=await native.status();
    if(revision===generation)publish({status});
    return status;
  };
  async function invalidate(){
    generation++;operation?.abort();processing?.controller.abort();operation=null;pending=null;processing=null;knownScope=null;
    publish({status:null,busy:false,error:'',navigation:null});
    const revision=generation;
    // Invoke before awaiting anything: native must invalidate its own generation too.
    try{await native.clearScope();if(revision===generation)await refresh();}
    catch(error){if(revision===generation)publish({error:safeError(error)});}
  }
  async function consume(){
    const scope=session();if(!scope||!foreground())return;
    const revision=generation;
    if(processing?.revision===revision)return processing.promise;
    const controller=new AbortController();
    const promise=(async()=>{
      if(!pending){
        const result=await native.consumeNavigation({instanceId:scope.instanceId,userId:scope.userId});
        assertCurrent(scope,revision);
        if(!result?.navigation)return;
        pending={scope,navigation:notificationNavigation(result.navigation)};
      }
      if(!sameSession(pending.scope,scope)){pending=null;return;}
      const navigation=pending.navigation;
      // Refresh account-owned summaries, then read the exact conversation under the
      // same credentials. An event/URL alone never authorizes opening a conversation.
      const state=await refreshState(controller.signal);assertCurrent(scope,revision);
      if(state?.instanceId!==scope.instanceId||state?.user?.id!==scope.userId)throw sessionError();
      const summary=state.conversations?.find(item=>item.id===navigation.conversationId);
      let conversation;
      try{conversation=await fetchConversation(navigation.conversationId,controller.signal);}
      catch(error){if([403,404,410].includes(error?.status))throw Object.assign(new Error('这个任务对话已删除，或不属于当前账号。'),{terminal:true});throw error;}
      assertCurrent(scope,revision);
      if(conversation?.id!==navigation.conversationId||summary&&conversation.mode!==summary.mode||!['chat','codex'].includes(conversation?.mode))throw Object.assign(new Error('任务对话身份不一致。'),{terminal:true});
      if(navigation.source==='agent'&&(conversation.mode!=='codex'||navigation.agentConversationId!==conversation.id)||navigation.source==='chat-agent'&&conversation.mode!=='chat')throw Object.assign(new Error('任务通知与对话类型不一致。'),{terminal:true});
      // Registered automation results are deliberately omitted from recent history.
      // The authenticated exact read proves ownership; only a real finished run
      // matching this notification may use that narrow exception.
      if(!summary&&(!safeId(conversation.automationId)||navigation.source!=='agent'||conversation.agent?.run?.id!==navigation.runId||!['completed','error'].includes(conversation.agent?.run?.status)))throw Object.assign(new Error('自动化通知没有匹配的已结束任务。'),{terminal:true});
      pending=null;
      publish({error:'',navigation:{...navigation,epoch:scope.epoch,instanceId:scope.instanceId,userId:scope.userId,conversation,state}});
    })().catch(error=>{
      if(revision===generation&&current(scope)){if(error?.terminal)pending=null;publish({error:safeError(error)});}
    }).finally(()=>{if(processing?.promise===promise)processing=null;});
    processing={revision,promise,controller};
    return promise;
  }
  async function reconcile(){
    const scope=session();if(!scope)return;
    if(knownScope&&!sameSession(knownScope,scope))await invalidate();
    const revision=generation;knownScope={...scope};
    const status=await refresh();assertCurrent(scope,revision);
    let mismatch=!sameScope(status,scope);
    if(status.enabled&&status.url)try{mismatch ||= notificationServerUrl(status.url)!==notificationServerUrl(scope.url);}catch{mismatch=true;}
    if(status.enabled&&mismatch){await invalidate();if(!current(scope))return;knownScope={...scope};}
    await consume();
  }
  async function enable(){
    if(value.busy)throw new Error('正在更新提醒设置，请稍候。');
    const scope=session();if(!scope)throw new Error('请先登录账号，再开启后台任务提醒。');
    const url=notificationServerUrl(scope.url);
    if(!foreground())throw new Error('请回到应用前台开启后台任务提醒。');
    const revision=++generation,controller=new AbortController();processing?.controller.abort();processing=null;operation=controller;
    publish({busy:true,error:''});
    let deviceId,registrationAttempted=false;
    try{
      const installation=await native.installation();assertCurrent(scope,revision);
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(installation?.deviceId))throw new Error('无法读取有效的设备标识。');
      deviceId=installation.deviceId;
      if(!foreground())throw new Error('请回到应用前台开启后台任务提醒。');
      registrationAttempted=true;
      const config=await register(deviceId,controller.signal);assertCurrent(scope,revision);
      if(config?.deviceId!==deviceId||!sameScope(config,scope)||typeof config.token!=='string'||!/^[-_A-Za-z0-9]{40,512}$/.test(config.token)||!Number.isSafeInteger(config.cursor)||config.cursor<0||!Number.isFinite(Date.parse(config.expiresAt))||Date.parse(config.expiresAt)<=Date.now())throw new Error('后台任务提醒的设备凭据响应无效。');
      if(!foreground())throw new Error('请回到应用前台开启后台任务提醒。');
      const status=await native.start({url,deviceId:config.deviceId,token:config.token,instanceId:config.instanceId,userId:config.userId,cursor:config.cursor,expiresAt:config.expiresAt});assertCurrent(scope,revision);
      if(!status?.enabled||status.permission!=='granted'||!sameScope(status,scope))throw new Error('未开启任务提醒。请允许通知权限后重试。');
      knownScope={...scope};publish({status,error:''});
    }catch(error){
      if(registrationAttempted){
        // Registration may have committed before an aborted/late response. Use
        // its immutable source-session scope, never the new account's API client.
        if(current(scope)&&revision===generation)await native.clearScope().catch(()=>{});
        await revoke(deviceId,undefined,scope).catch(()=>{});
        if(current(scope)&&revision===generation)await refresh().catch(()=>{});
      }
      if(revision===generation)publish({error:safeError(error)});
      throw error;
    }finally{if(revision===generation){operation=null;publish({busy:false});}}
  }
  async function disable(){
    const scope=session(),deviceId=value.status?.deviceId;
    const revision=generation+1,cleared=invalidate();publish({busy:true});
    try{await cleared;if(scope&&deviceId)await revoke(deviceId,undefined,scope);}
    catch(error){if(revision===generation)publish({error:safeError(error)});}
    finally{if(revision===generation)publish({busy:false});}
  }
  return{
    snapshot:()=>value,
    subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    refresh,reconcile,consume,enable,disable,invalidate,
    takeNavigation(){const navigation=value.navigation;if(!navigation)return null;publish({navigation:null});return navigation;},
  };
}
