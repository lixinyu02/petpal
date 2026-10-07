import net from 'node:net';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const invalid = message => Object.assign(new Error(message), {status:400,code:'invalid_arguments'});
const text = (maxLength = 300, extra = {}) => ({type:'string',minLength:1,maxLength,...extra});
const limit = (maximum = 20, initial = 5) => ({type:'integer',minimum:1,maximum,default:initial});
const depth = {type:'integer',minimum:0,maximum:1,default:0};
const passcode = {type:'string',minLength:0,maxLength:8,pattern:'^[a-zA-Z0-9]*$',default:''};
const bvid = text(12,{pattern:'^BV[0-9A-Za-z]{10}$'});
const freeze = value => {if(value && typeof value === 'object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

export const NOTEBOOK_WEBSITES = freeze([
  {site:'dyyj',label:'电影云集',origins:['https://bbs.dyyjv.com','https://bbs.dyyjmax.org'],maxOrigins:2,login:'optional'},
  {site:'baidu-pan',label:'百度网盘',origins:['https://pan.baidu.com'],login:'share'},
  {site:'switch520',label:'Switch520',origins:['https://www.520switch.com','https://520switch.com'],maxOrigins:1,login:'optional'},
  {site:'gamer520',label:'Gamer520',origins:['https://www.gamer520.com','https://gamer520.com'],maxOrigins:1,login:'optional'},
  {site:'bing',label:'必应',origins:['https://www.bing.com','https://cn.bing.com'],login:'optional'},
  {site:'dygang',label:'电影港',origins:['https://dygangs.me'],maxOrigins:1,login:'optional'},
  {site:'wlgo',label:'围炉Go',origins:['https://www.wlgooo.com','https://wlgooo.com'],maxOrigins:1,login:'optional'},
  {site:'baidu-search',label:'百度搜索',origins:['https://www.baidu.com'],login:'optional'},
  {site:'fire-exam',label:'消防职业技能鉴定考试网',origins:['https://xfhyjd.119.gov.cn'],maxOrigins:1,login:'optional'},
  {site:'tieba',label:'百度贴吧',origins:['https://tieba.baidu.com'],login:'optional'},
  {site:'bilibili',label:'哔哩哔哩',origins:['https://www.bilibili.com','https://search.bilibili.com'],login:'optional'},
  {site:'quark',label:'夸克网盘',origins:['https://pan.quark.cn'],login:'required'},
  {site:'xunlei-pan',label:'迅雷云盘',origins:['https://pan.xunlei.com'],login:'share'},
  {site:'zhihu',label:'知乎',origins:['https://www.zhihu.com'],login:'optional'},
  {site:'weibo',label:'微博',origins:['https://weibo.com','https://s.weibo.com'],login:'optional'},
  {site:'douban',label:'豆瓣',origins:['https://movie.douban.com','https://book.douban.com'],login:'optional'},
  {site:'jd',label:'京东',origins:['https://search.jd.com'],login:'optional'},
  {site:'taobao',label:'淘宝',origins:['https://s.taobao.com'],login:'required'},
  {site:'xiaohongshu',label:'小红书',origins:['https://www.xiaohongshu.com'],login:'required'},
  {site:'douyin',label:'抖音',origins:['https://www.douyin.com'],login:'required'},
]);
const configured = new Map(NOTEBOOK_WEBSITES.filter(site => site.maxOrigins).map(site => [site.site,site]));

/** Only a human-facing config endpoint accepts these addresses. Agent arguments cannot expand them. */
export function normalizeSiteOrigins(value = {}) {
  if(!object(value)||Object.keys(value).some(key=>!configured.has(key)))throw invalid('网站网址配置含未支持的站点。');
  const result={};
  for(const [site,values] of Object.entries(value)){
    if(!Array.isArray(values)||values.length>configured.get(site).maxOrigins)throw invalid('网站网址数量超出范围。');
    const origins=[];
    for(const input of values){
      if(typeof input!=='string'||input.length>256||/[\x00-\x20\x7f]/.test(input))throw invalid('请填写完整的 HTTPS 网站源地址。');
      let url;try{url=new URL(input);}catch{throw invalid('请填写完整的 HTTPS 网站源地址。');}
      if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||net.isIP(url.hostname)||url.hostname.startsWith('[')||!url.hostname.includes('.')||/(?:^|\.)(?:localhost|local|internal|lan|invalid)$/.test(url.hostname))throw invalid('网站只接受公网 HTTPS 源地址，例如 https://www.example.com，不含路径、端口或登录信息。');
      if(!origins.includes(url.origin))origins.push(url.origin);
    }
    if(origins.length)result[site]=origins;
  }
  return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}

const define=(site,command,description,properties,required=[],extra={})=>({site,command,description,engine:'builtin',mode:'browser',origins:NOTEBOOK_WEBSITES.find(entry=>entry.site===site).origins,login:NOTEBOOK_WEBSITES.find(entry=>entry.site===site).login,inputSchema:{type:'object',properties,required,additionalProperties:false},...extra});
export const OPENCLI_BROWSER_POLICIES = freeze([
  define('baidu-search','search','百度网页搜索结果',{query:text(),limit:limit()},['query']),
  define('bing','search','必应网页搜索结果',{query:text(),limit:limit()},['query']),
  define('zhihu','hot','知乎热榜；读取首批话题与来源链接',{limit:limit()}),
  define('zhihu','search','知乎原生综合搜索；首批最多 20 项，可能需要登录',{query:text(),limit:limit()},['query']),
  define('weibo','hot','微博热搜与热度；可能需要 Chrome 登录',{limit:limit(50,10)},[],{loginOrigins:['https://passport.weibo.com','https://passport.weibo.cn']}),
  define('weibo','search','微博原生搜索；读取当前页的博文、作者、时间与链接',{keyword:text(),limit:limit()},['keyword'],{loginOrigins:['https://passport.weibo.com','https://passport.weibo.cn']}),
  ...['movie-hot','book-hot','top250'].map(command=>define('douban',command,command==='book-hot'?'豆瓣图书榜；读取书名、评分与书籍链接':command==='movie-hot'?'豆瓣电影榜；读取片名、评分与电影链接':'豆瓣电影 Top250；读取第一页，最多 25 项',{limit:limit(command==='top250'?25:20)},[],{origins:[command==='book-hot'?'https://book.douban.com':'https://movie.douban.com'],loginOrigins:['https://accounts.douban.com'],verificationOrigins:['https://sec.douban.com']})),
  define('jd','search','京东原生商品搜索；首屏可见商品、价格与店铺，不下单',{query:text(),limit:limit(20)},['query'],{loginOrigins:['https://passport.jd.com'],verificationOrigins:['https://cfe.m.jd.com']}),
  define('taobao','search','淘宝原生综合商品搜索；登录后读取首屏，不下单',{query:text(),limit:limit()},['query'],{loginOrigins:['https://login.taobao.com']}),
  define('xiaohongshu','search','小红书原生综合笔记搜索；登录后读取首屏，不更改筛选',{query:text(),limit:limit()},['query']),
  define('douyin','search','抖音原生视频搜索；登录后读取首屏，不播放或下载',{query:text(),limit:limit()},['query']),
  ...['share-info','share-tree'].map(command=>define('baidu-pan',command,command==='share-info'?'读取分享标题和有效状态；不返回登录信息':'读取分享根目录与文件信息（depth=0）；不会下载或保存文件',{url:text(2048),passcode,...(command==='share-tree'?{depth:{type:'integer',minimum:0,maximum:0,default:0}}:{}),limit:limit(50,20)},['url'],{secretFields:['passcode','url']})),
  ...['share-info','share-tree'].map(command=>define('xunlei-pan',command,command==='share-info'?'读取分享页面可见信息':'读取分享根目录可见文件（depth=0）；不会保存或下载',{url:text(2048),passcode,...(command==='share-tree'?{depth:{type:'integer',minimum:0,maximum:0,default:0}}:{}),limit:limit(50,20)},['url'],{secretFields:['passcode','url']})),
  define('tieba','hot','贴吧热议话题',{limit:limit()},[],{engine:'upstream',modulePath:'tieba/hot.js'}),
  define('tieba','search','搜索贴吧帖子',{keyword:text(),page:{type:'integer',minimum:1,maximum:1,default:1},limit:limit()},['keyword'],{engine:'upstream',modulePath:'tieba/search.js'}),
  define('tieba','read','读取一个帖子及回复',{id:text(20,{pattern:'^[1-9][0-9]{0,19}$'}),page:{type:'integer',minimum:1,maximum:1,default:1},limit:limit(30,20)},['id'],{engine:'upstream',modulePath:'tieba/read.js'}),
  define('bilibili','search','搜索视频或用户',{query:text(),type:{type:'string',maxLength:5,enum:['video','user'],default:'video'},page:{type:'integer',minimum:1,maximum:1,default:1},limit:limit()},['query'],{engine:'upstream',modulePath:'bilibili/search.js'}),
  ...['hot','ranking'].map(command=>define('bilibili',command,command==='hot'?'热门视频':'视频排行榜',{limit:limit()},[],{engine:'upstream',modulePath:`bilibili/${command}.js`})),
  define('bilibili','video','读取 BV 视频信息',{bvid},['bvid'],{engine:'upstream',modulePath:'bilibili/video.js'}),
  define('bilibili','comments','读取视频评论',{bvid,parent:text(16,{pattern:'^[1-9][0-9]{0,15}$'}),limit:limit(50,20)},['bvid'],{engine:'upstream',modulePath:'bilibili/comments.js'}),
  define('bilibili','history','读取当前登录账号的观看历史',{limit:limit()},[],{engine:'upstream',modulePath:'bilibili/history.js',login:'required'}),
  define('bilibili','favorite','读取当前登录账号的收藏视频；只读，不能新增或移除收藏',{limit:limit()},[],{login:'required'}),
  define('quark','share-tree','有界读取分享目录，最多一层子目录；不会转存或下载',{url:text(2048),passcode,depth,limit:limit(50,20)},['url'],{secretFields:['passcode','url']}),
  define('quark','ls','读取当前登录账号的文件目录；不会修改文件',{path:{type:'string',minLength:0,maxLength:200,default:''},depth,limit:limit(50,20)},[],{login:'required'}),
  ...[...configured.keys()].flatMap(site=>[
    define(site,'read','读取已配置网站的页面文本与链接',{url:text(2048),limit:limit()},['url'],{engine:'configured',mode:'configured'}),
    define(site,'search',site==='switch520'?'使用网站原生搜索读取结果':'通过必应 site: 搜索已配置网站（非网站原生搜索）',{query:text(),limit:limit()},['query'],{engine:'configured',mode:'configured'}),
    ...(site==='fire-exam'?[
      define(site,'notice','读取当前首页可见公告',{limit:limit()},[],{engine:'configured',mode:'configured'}),
      define(site,'status','读取指定状态页的实际可见文字；需要用户登录，不自动提交或推断报名结果',{url:text(2048),limit:limit()},['url'],{engine:'configured',mode:'configured',login:'required',secretFields:['url']}),
    ]:[
      define(site,'latest','读取首页或常用分类当前可见的帖子/文章列表',{limit:limit()},[],{engine:'configured',mode:'configured'}),
      ...(site==='dyyj'?[]:[define(site,'detail','读取指定详情页',{url:text(2048),limit:limit()},['url'],{engine:'configured',mode:'configured'})]),
      define(site,'links','提取指定页面已有的资源链接；保留来源，不访问跳转目标',{url:text(2048),limit:limit()},['url'],{engine:'configured',mode:'configured'}),
    ]),
  ]),
]);
const policies=new Map(OPENCLI_BROWSER_POLICIES.map(policy=>[`${policy.site}/${policy.command}`,policy]));
export function browserQueryPolicy(site,command){const value=policies.get(`${site}/${command}`);return value?JSON.parse(JSON.stringify(value)):null;}

export function validateBrowserQueryUrl(args,siteOrigins={}) {
  const policy=browserQueryPolicy(args.site,args.command);
  if(!policy)return;
  const origins=policy.engine==='configured'?(siteOrigins[args.site]||policy.origins):policy.origins;
  if(!origins.length)throw Object.assign(new Error('此网站尚未配置网址，请在选中执行电脑的 OpenCLI 设置中填写。'),{status:409,code:'site_url_required'});
  if(!args.arguments.url)return;
  let url;try{url=new URL(args.arguments.url);}catch{throw invalid('网站查询需要有效的 HTTPS 页面地址。');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!origins.includes(url.origin)||/[\x00-\x20\x7f]/.test(args.arguments.url))throw invalid('页面地址不在此网站已配置的 HTTPS 范围内。');
  if(args.site==='baidu-pan'&&!/^\/s\/1[\w-]{5,100}\/?$/.test(url.pathname)&&!/^\/share\/(?:init|link)$/.test(url.pathname))throw invalid('请提供百度网盘的 /s/1… 或 /share/… 分享地址。');
  if(args.site==='quark'&&!/^\/s\/[a-zA-Z0-9]{6,64}\/?$/.test(url.pathname))throw invalid('请提供夸克网盘的 /s/… 分享地址。');
  if(args.site==='xunlei-pan'&&!/^\/s\/[\w-]{6,128}\/?$/.test(url.pathname))throw invalid('请提供迅雷云盘的 /s/… 分享地址。');
  if(['baidu-pan','quark','xunlei-pan'].includes(args.site)&&(url.hash||[...url.searchParams.keys()].some(key=>!['pwd',...(args.site==='baidu-pan'?['surl','shareid','uk']:[])].includes(key))|| (url.searchParams.has('pwd')&&!/^[a-zA-Z0-9]{1,8}$/.test(url.searchParams.get('pwd')))))throw invalid('分享地址含未支持的参数，请使用 passcode 参数提供提取码。');
}

export function notebookWebsiteCatalog(siteOrigins={}) {
  return NOTEBOOK_WEBSITES.map(({site,label,origins,login})=>({site,label,origins:siteOrigins[site]||[...origins],status:(siteOrigins[site]||origins).length?'ready':'needs-url',commands:OPENCLI_BROWSER_POLICIES.filter(policy=>policy.site===site).map(policy=>policy.command),login}));
}

export function describeOpenCliQueryArguments(args){
  const policy=browserQueryPolicy(args.site,args.command);
  const entries=Object.entries(args.arguments).map(([key,value])=>[key,policy?.secretFields?.includes(key)?'[已隐藏]':value]);
  return JSON.stringify(Object.fromEntries(entries));
}
