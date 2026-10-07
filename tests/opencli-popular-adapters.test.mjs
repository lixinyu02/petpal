import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {browserQueryPolicy} from '../server/opencli-browser-policies.mjs';
import {validateOpenCliQuery,describeOpenCliSites} from '../server/opencli-sites.mjs';
import {runBrowserAdapter,browserAdapterNetworkRules,browserAdapterOrigins} from '../server/opencli-browser-adapters.mjs';

const node = ({text='',href=null,fields={},attrs={},shown=true,children=[]}={}) => ({
  textContent:text,innerText:text,children,classList:{contains:()=>false},getClientRects:()=>shown?[{}]:[],closest:()=>null,
  getAttribute:key=>key==='href'?href:attrs[key]??null,
  querySelector:selector=>fields[selector]||null,querySelectorAll:selector=>fields[selector]||[],
});
function fixture({cards=[],modal=null,title='搜索',body='常用网站',fetchImpl,delay=0,timeout=false}={}) {
  const urls=[],requests=[],location=new URL('https://example.test/'); let scans=0,clock=0;
  const document={title,body:{innerText:body},querySelectorAll:selector=>{
    if(selector.includes('geetest'))return [];
    if(selector.includes('login-container'))return modal?[modal]:[];
    scans++;return scans>delay?cards:[];
  }};
  const page={goto:async url=>{urls.push(url);location.href=url;},evaluate:async script=>vm.runInNewContext(script,{
    URL,encodeURIComponent,document,location,Response,Date:timeout?{now:()=>clock+=9000}:Date,
    setTimeout:timeout?fn=>fn():setTimeout,
    fetch:async (url,init)=>{requests.push({url,init});return fetchImpl(url,init);},
  })};
  return {page,urls,requests,get scans(){return scans;}};
}
async function query(site,command,options,f) {
  const args=validateOpenCliQuery({site,command,arguments:options});
  return runBrowserAdapter({args,policy:browserQueryPolicy(site,command),page:f.page});
}

test('seven popular sites expose eleven fixed read commands and no write or execution arguments',async()=>{
  const expected={zhihu:['hot','search'],weibo:['hot','search'],douban:['movie-hot','book-hot','top250'],jd:['search'],taobao:['search'],xiaohongshu:['search'],douyin:['search']};
  for(const [site,commands] of Object.entries(expected)) {
    const catalog=await describeOpenCliSites({site});
    assert.deepEqual(catalog.commands.filter(item=>item.callable).map(item=>item.command).sort(),commands.sort());
    for(const command of commands) {
      const policy=browserQueryPolicy(site,command);assert.equal(policy.engine,'builtin');
      assert.ok(browserAdapterOrigins(policy).length<=2);
      const required=Object.fromEntries(policy.inputSchema.required.map(key=>[key,'猫']));
      for(const field of ['cookie','url','script','sort','page','profileId'])assert.throws(()=>validateOpenCliQuery({site,command,arguments:{...required,[field]:'untrusted'}}));
    }
    assert.throws(()=>validateOpenCliQuery({site,command:'publish',arguments:{}}));
  }
  assert.throws(()=>validateOpenCliQuery({site:'douban',command:'top250',arguments:{limit:26}}));
  assert.ok(['taobao','xiaohongshu','douyin'].every(site=>browserQueryPolicy(site,'search').login==='required'));
});

test('Zhihu preserves long numeric IDs, rejects malformed payloads and deduplicates validated links',async()=>{
  const f=fixture({fetchImpl:async()=>new Response('{"data":[{"target":{"id":1234567890123456789,"title":"猫猫"}},{"target":{"id":1234567890123456789,"title":"重复"}},{"target":{"id":"../wrong","title":"坏链接"}},{"target":{"id":2,"title":"狗狗"}}]}')});
  const rows=await query('zhihu','hot',{limit:2},f);
  assert.deepEqual(Array.from(rows,row=>row.id),['1234567890123456789','2']);
  assert.equal(rows[0].url,'https://www.zhihu.com/question/1234567890123456789');
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].init.credentials,'include');
  for(const payload of [{error:{code:401}},{data:[]},{data:{}},{}])await assert.rejects(query('zhihu','hot',{},fixture({fetchImpl:async()=>Response.json(payload)})),/格式|有效条目/);
});

test('Zhihu search handles answer identities and escaped query without executing input or pagination URLs',async()=>{
  const queryText='猫 " ); throw new Error("injection"); //';
  const f=fixture({fetchImpl:async()=>Response.json({data:[
    {type:'search_result',object:{type:'answer',id:'12345678901234567890',question:{id:'30',title:'<em>猫</em>的日常'},author:{name:'作者'}}},
    {type:'search_result',object:{type:'answer',id:'2',question:{title:'缺少问题id'}}},
    {type:'search_result',object:{type:'article',id:'5',title:'养猫'}},
    {type:'ad',object:{type:'question',id:'8',title:'广告'}},
  ],paging:{next:'https://evil.test/private'}})});
  const rows=await query('zhihu','search',{query:queryText},f);
  assert.equal(new URL(f.requests[0].url).searchParams.get('q'),queryText);
  assert.equal(rows.length,2);assert.equal(rows[0].url,'https://www.zhihu.com/question/30/answer/12345678901234567890');
  assert.equal(rows[0].title,'猫的日常');assert.equal(rows[1].url,'https://zhuanlan.zhihu.com/p/5');assert.equal(f.requests.length,1);
});

test('Weibo hot rejects API errors and only adds the three fixed GET paths for these sites',async()=>{
  const f=fixture({fetchImpl:async()=>Response.json({ok:1,data:{band_list:[{word:'猫咪日常',num:123}, {word:''}]}})});
  const rows=await query('weibo','hot',{},f);assert.equal(rows.length,1);assert.equal(rows[0].heat,123);
  assert.equal(new URL(rows[0].url).searchParams.get('q'),'#猫咪日常#');
  await assert.rejects(query('weibo','hot',{},fixture({fetchImpl:async()=>Response.json({ok:0,data:{band_list:[]}})})),/状态/);
  for(const site of ['zhihu','weibo'])assert.ok(browserAdapterNetworkRules(site).every(rule=>rule.methods.length===1&&rule.methods[0]==='GET'&&rule.paths.every(path=>!path.includes('*'))));
  assert.equal(browserAdapterNetworkRules('zhihu').flatMap(rule=>rule.paths).length,2);
  assert.equal(browserAdapterNetworkRules('weibo').flatMap(rule=>rule.paths).length,1);
  for(const site of ['douban','jd','taobao','xiaohongshu','douyin'])assert.deepEqual(browserAdapterNetworkRules(site),[]);
});

test('DOM search waits for actual cards and verifies identity links; navigation and spoofed result URLs are excluded',async()=>{
  const card=url=>node({fields:{'.from a[href]':node({href:url}), '[node-type="feed_list_content_full"], [node-type="feed_list_content"], .txt':node({text:'猫咪日常'}),'.info .name, .name':node({text:'作者'})}});
  const f=fixture({delay:2,cards:[card('https://weibo.com.evil.test/detail/1'),card('https://weibo.com/login'),card('https://weibo.com/123/Abc1?token=private'),card('https://weibo.com/123/Abc1')]});
  const rows=await query('weibo','search',{keyword:'验证 登录 安全',limit:5},f);
  assert.equal(rows.length,1);assert.equal(rows[0].url,'https://weibo.com/123/Abc1');assert.ok(f.scans>=3);
  assert.equal(new URL(f.urls[0]).searchParams.get('q'),'验证 登录 安全');
});

test('Douban charts validate subject links and never invent missing scores',async()=>{
  for(const command of ['movie-hot','book-hot','top250']) {
    const host=command==='book-hot'?'book':'movie', selector=command==='book-hot'?'h2 a[href*="/subject/"]':command==='top250'?'a[href*="/subject/"]':'.pl2 a[href*="/subject/"]';
    const card=node({fields:{[selector]:node({text:'测试作品',href:`https://${host}.douban.com/subject/123/`}),'.title':node({text:'测试作品'})}});
    const rows=await query('douban',command,{limit:1},fixture({cards:[card]}));
    assert.equal(rows[0].id,'123');assert.equal(rows[0].rating,undefined);
  }
});

test('JD and Taobao use stable product identities and visible price only; tracking IDs cannot replace item IDs',async()=>{
  const jd=node({attrs:{'data-sku':'123'},fields:{'.p-name em, .p-name a, [class*="title"]':node({text:'耳机'}),'.p-price, [class*="price"]':node({text:'¥99.00'})}});
  const rows=await query('jd','search',{query:'耳机'},fixture({cards:[jd]}));
  assert.equal(rows[0].url,'https://item.jd.com/123.html');assert.equal(rows[0].price,'¥99.00');
  const taobao=id=>node({attrs:{'data-spm-act-id':'998877'},fields:{'a[href*="item.htm"]':node({href:'https://item.taobao.com/item.htm?id='+id+'&token=private'}),'[class*="title--"]':node({text:'猫粮'})}});
  const products=await query('taobao','search',{query:'猫粮'},fixture({cards:[taobao('not-an-id'),taobao('456')]}));
  assert.equal(products.length,1);assert.equal(products[0].id,'456');assert.equal(products[0].url,'https://item.taobao.com/item.htm?id=456');
  const rootCard=node({href:'https://item.taobao.com/item.htm?id=789',fields:{'[class*="title--"]':node({text:'猫零食'})}});
  rootCard.matches=selector=>selector==='a[href*="item.htm"]';
  assert.equal((await query('taobao','search',{query:'猫'},fixture({cards:[rootCard]})))[0].id,'789');
});

test('Xiaohongshu and Douyin return validated note/video links without leaking signature or guessing counters',async()=>{
  const note=node({fields:{'a[href*="/search_result/"], a[href*="/explore/"]':node({href:'https://www.xiaohongshu.com/search_result/abcde1234567890123456789?xsec_token=private'}),'.title, .note-title, .footer .title span':node({text:'萌猫'})}});
  const rows=await query('xiaohongshu','search',{query:'萌猫'},fixture({cards:[note]}));
  assert.equal(rows.length,1);assert.doesNotMatch(JSON.stringify(rows),/private|xsec_token/);assert.ok(rows[0].detailHint);
  const video=node({fields:{'a[href*="/video/"]':node({href:'https://www.douyin.com/video/1234567890123456789',attrs:{title:'萌猫日常'}})}});
  const videos=await query('douyin','search',{query:'萌猫'},fixture({cards:[video]}));
  assert.equal(videos[0].id,'1234567890123456789');assert.equal(videos[0].plays,undefined);
});

test('visible login overlays and verification titles stop reads, while hidden overlays and header login text do not',async()=>{
  const modal=node({text:'扫码登录'});
  await assert.rejects(query('taobao','search',{query:'猫'},fixture({modal})),/登录窗口/);
  await assert.rejects(query('jd','search',{query:'猫'},fixture({title:'安全验证'})),/手动安全验证/);
  await assert.rejects(query('douyin','search',{query:'猫'},fixture({body:'登录后即可搜索更多精彩视频'})),/需要登录/);
  const card=node({fields:{'.from a[href]':node({href:'https://weibo.com/detail/123'}),'[node-type="feed_list_content_full"], [node-type="feed_list_content"], .txt':node({text:'如何辨认验证码'})}});
  assert.equal((await query('weibo','search',{keyword:'验证码'},fixture({cards:[card],body:'登录 注册',modal:node({text:'登录',shown:false})}))).length,1);
  assert.equal((await query('jd','search',{query:'no-match'},fixture({body:'暂无相关结果'}))).length,0);
  await assert.rejects(query('jd','search',{query:'not-loaded'},fixture({timeout:true})),/未读取到有效条目/);
  await assert.rejects(query('douban','book-hot',{},fixture({timeout:true,body:'暂无相关结果'})),/未读取到有效条目/);
});
