/** Already behind the service's account middleware; only this host's owner manages Python. */
export function mountMusicMcpRoutes({app,manager,requireAdmin,requireCurrentAuth,probes}) {
  const prefix='/api/desktop-tools/music-mcp';
  const owner=(req,res,next)=>{requireAdmin(req.user);if(!manager)throw Object.assign(new Error('此服务未提供音乐MCP管理。'),{status:501});next();};
  app.get(prefix+'/config',owner,async(req,res)=>{const value=await manager.config();requireCurrentAuth(req);res.json(value);});
  app.get(prefix+'/status',owner,async(req,res)=>{const value=await manager.status();requireCurrentAuth(req);res.json(value);});
  app.patch(prefix+'/config',owner,async(req,res)=>{requireCurrentAuth(req);const value=await manager.configure(req.body);requireCurrentAuth(req);res.json(value);});
  for(const action of ['prepare','connect','disconnect'])app.post(prefix+'/'+action,owner,async(req,res)=>{
    if(!req.body||Object.keys(req.body).length!==1||!['netease','qqmusic'].includes(req.body.player))throw Object.assign(new Error('请选择有效的音乐MCP。'),{status:400});
    const controller=new AbortController();let finish;const done=new Promise(resolve=>{finish=resolve;});
    const probe={controller,done,userId:req.user.id,sessionHash:req.sessionHash,mode:'music-mcp'};probes.add(probe);
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{
      requireCurrentAuth(req);controller.signal.throwIfAborted();
      if(action==='prepare')await manager.prepare(req.body,{signal:controller.signal});
      else await manager[action](req.body.player,{signal:controller.signal});
      requireCurrentAuth(req);controller.signal.throwIfAborted();
      const value=await manager.status();requireCurrentAuth(req);controller.signal.throwIfAborted();res.json(value);
    }catch(error){if(!res.destroyed)res.status(error.status??502).json({error:controller.signal.aborted?'音乐MCP操作已停止。':String(error.message).slice(0,500)});}
    finally{probes.delete(probe);finish();}
  });
}
