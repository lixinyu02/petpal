/** Auth middleware is already mounted. Only this service's owner manages its OpenCLI. */
export function mountOpenCliRoutes({app,manager,requireAdmin,requireCurrentAuth,probes}) {
  const prefix='/api/desktop-tools/opencli';
  const owner=(req,res,next)=>{requireAdmin(req.user);if(!manager)throw Object.assign(new Error('此服务未提供 OpenCLI 管理。'),{status:501});next();};
  for(const action of ['config','status'])app.get(`${prefix}/${action}`,owner,async(req,res)=>{const value=await manager[action]();requireCurrentAuth(req);res.json(value);});
  app.get(`${prefix}/sites`,owner,async(req,res)=>{const value=await manager.sites(req.query);requireCurrentAuth(req);res.json(value);});
  app.patch(`${prefix}/config`,owner,async(req,res)=>{requireCurrentAuth(req);const value=await manager.configure(req.body);requireCurrentAuth(req);res.json(value);});
  app.post(`${prefix}/action`,owner,async(req,res)=>{
    const controller=new AbortController();let finish;const done=new Promise(resolve=>{finish=resolve;});
    const probe={controller,done,userId:req.user.id,sessionHash:req.sessionHash,mode:'opencli'};probes.add(probe);
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{requireCurrentAuth(req);controller.signal.throwIfAborted();const value=await manager.executeBrowser(req.body,{signal:controller.signal});requireCurrentAuth(req);controller.signal.throwIfAborted();res.json(value);}
    catch(error){if(!res.destroyed)res.status(error.status??502).json({error:controller.signal.aborted?'网页操作已停止。':String(error.message).slice(0,500)});}
    finally{probes.delete(probe);finish();}
  });
}
