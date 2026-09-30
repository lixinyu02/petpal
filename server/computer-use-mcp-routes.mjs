/** Only the authenticated owner manages Computer Use on the service host. */
export function mountComputerUseMcpRoutes({app,manager,requireAdmin,requireCurrentAuth,probes}) {
  const prefix='/api/desktop-tools/computer-use';
  const owner=(req,res,next)=>{requireAdmin(req.user);if(!manager)throw Object.assign(new Error('此服务未提供 Computer Use 管理。'),{status:501});next();};
  for(const action of ['config','status'])app.get(`${prefix}/${action}`,owner,async(req,res)=>{const value=await manager[action]();requireCurrentAuth(req);res.json(value);});
  app.patch(`${prefix}/config`,owner,async(req,res)=>{requireCurrentAuth(req);const value=await manager.configure(req.body);requireCurrentAuth(req);res.json(value);});
  for(const action of ['connect','disconnect'])app.post(`${prefix}/${action}`,owner,async(req,res)=>{
    if(req.body!==undefined&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length))throw Object.assign(new Error('连接操作不接受额外参数。'),{status:400});
    const controller=new AbortController();let finish;const done=new Promise(resolve=>{finish=resolve;});
    const probe={controller,done,userId:req.user.id,sessionHash:req.sessionHash,mode:'computer-use'};probes.add(probe);
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{requireCurrentAuth(req);controller.signal.throwIfAborted();await manager[action]({signal:controller.signal});requireCurrentAuth(req);controller.signal.throwIfAborted();const value=await manager.status();requireCurrentAuth(req);controller.signal.throwIfAborted();res.json(value);}
    catch(error){if(!res.destroyed)res.status(error.status??502).json({error:controller.signal.aborted?'电脑助手操作已停止。':String(error.message).slice(0,500)});}
    finally{probes.delete(probe);finish();}
  });
}
