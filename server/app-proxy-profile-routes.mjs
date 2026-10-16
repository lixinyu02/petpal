const fail=(status,message)=>Object.assign(new Error(message),{status});
/** Mounted after account authentication. Config bodies never enter general account state. */
export function mountAppProxyProfileRoutes({app,profiles,requireAdmin,requireCurrentAuth}){
  const prefix='/api/app-proxy/profiles';
  const guard=(req,admin=false)=>{
    requireCurrentAuth(req);if(admin)requireAdmin(req.user);
    if(Object.keys(req.query).length)throw fail(400,'服务器代理配置接口不接受查询字段。');
  };
  const noBody=req=>{if(Object.keys(req.body).length)throw fail(400,'此代理配置请求不接受正文。');};
  const privateResponse=res=>res.set({'Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'});
  app.get('/api/app-proxy/admin/profiles',(req,res)=>{guard(req,true);noBody(req);privateResponse(res).json(profiles.listAdmin());});
  app.get(prefix,(req,res)=>{guard(req);noBody(req);privateResponse(res).json(profiles.list(req.user.id));});
  app.get(prefix+'/:id',(req,res)=>{guard(req);noBody(req);privateResponse(res).json({profile:profiles.get(req.params.id,req.user.id)});});
  app.get(prefix+'/:id/config',(req,res)=>{
    guard(req);noBody(req);
    // Existence/grant is checked before preconditions to hide unassigned IDs.
    profiles.get(req.params.id,req.user.id);
    const match=req.headers['if-match'];if(typeof match!=='string'||!/^"[a-f0-9-]{36}"$/.test(match))throw fail(400,'下载配置需要当前修订号，请刷新后重试。');
    const value=profiles.config(req.params.id,req.user.id,match.slice(1,-1));guard(req);
    privateResponse(res).set({'Content-Type':'application/yaml; charset=utf-8','Content-Security-Policy':"default-src 'none'; sandbox",'ETag':`"${value.revision}"`,'X-Content-SHA256':value.sha256}).send(value.yaml);
  });
  app.post(prefix,async(req,res)=>{guard(req,true);const profile=await profiles.mutate(null,req.body,{creatorId:req.user.id,authorize:()=>guard(req,true)});guard(req,true);privateResponse(res).status(201).json({profile});});
  app.put(prefix+'/:id',async(req,res)=>{guard(req,true);const profile=await profiles.mutate(req.params.id,req.body,{creatorId:req.user.id,authorize:()=>guard(req,true)});guard(req,true);privateResponse(res).json({profile});});
  app.delete(prefix+'/:id',async(req,res)=>{guard(req,true);const result=await profiles.remove(req.params.id,req.body,{authorize:()=>guard(req,true)});guard(req,true);privateResponse(res).json(result);});
}
