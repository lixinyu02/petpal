// Reviewed, fixed read adapters for OpenCLI 1.8.8. No user scripts, arbitrary
// request URLs, scrolls, login submission or upstream CLI lifecycle are exposed.
const entries = new Set(['zhihu/hot','zhihu/search','weibo/hot','weibo/search','douban/movie-hot','douban/book-hot','douban/top250','jd/search','taobao/search','xiaohongshu/search','douyin/search']);
export const popularBrowserAdapter = key => entries.has(key);

// Serialized into the lease-owned page. Keep all helpers within this function.
async function readPopularApi(site, command, options) {
  const text = (value, max = 300) => String(value ?? '').replace(/\s+/g,' ').trim().slice(0,max);
  const count = value => Number.isFinite(value) && value >= 0 ? value : undefined;
  const id = value => /^[1-9][0-9]{0,29}$/.test(String(value ?? '')) ? String(value) : '';
  const endpoint = site === 'weibo' ? 'https://weibo.com/ajax/statuses/hot_band' : command === 'hot'
    ? 'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50'
    : 'https://www.zhihu.com/api/v4/search_v3?q=' + encodeURIComponent(options.query) + '&t=general&offset=0&limit=20';
  const response = await fetch(endpoint,{credentials:'include'});
  if (!response.ok) throw new Error(response.status === 429 ? '网站请求过于频繁，请稍后查询。' : '网站 API 拒绝请求，请检查 Chrome 登录或验证状态。');
  let data;
  try { data = JSON.parse((await response.text()).replace(/("id"\s*:\s*)(\d{16,})/g,'$1"$2"')); }
  catch { throw new Error('网站 API 未返回有效 JSON；可能需要登录、验证或接口已变更。'); }
  const items = site === 'weibo' ? data?.data?.band_list : data?.data;
  if (!Array.isArray(items) || (site === 'weibo' && !data.ok) || data.error) throw new Error('网站 API 返回格式或状态无效；请检查登录、访问限制与接口版本。');
  const rows = [], seen = new Set();
  for (const item of items) {
    let row;
    if (site === 'weibo') {
      const title = text(item.word); if (!title) continue;
      row = {title,word:title,heat:count(item.num),label:text(item.label_name),url:'https://s.weibo.com/weibo?q=' + encodeURIComponent('#' + title + '#')};
    } else if (command === 'hot') {
      const target = item.target, key = id(target?.id), title = text(target?.title);
      if (!key || !title) continue;
      row = {id:key,title,heat:text(item.detail_text),answers:count(target.answer_count),url:'https://www.zhihu.com/question/' + key};
    } else {
      const target = item.object, key = id(target?.id), type = target?.type;
      if (item.type !== 'search_result' || !key || !['answer','question','article'].includes(type)) continue;
      const title = text(type === 'answer' ? target.question?.title : target.title).replace(/<[^>]*>/g,'');
      const question = id(target.question?.id); if (!title || (type === 'answer' && !question)) continue;
      const url = type === 'article' ? 'https://zhuanlan.zhihu.com/p/' + key : 'https://www.zhihu.com/question/' + (type === 'answer' ? question + '/answer/' + key : key);
      row = {id:key,title,type,author:text(target.author?.name,100),votes:count(target.voteup_count),url};
    }
    if (seen.has(row.url)) continue;
    seen.add(row.url); rows.push({rank:rows.length + 1,...row,source:command === 'hot' ? 'native-hot' : 'native-search'});
    if (rows.length >= options.limit) break;
  }
  if (!rows.length) throw new Error('网站没有返回有效条目；可能无匹配内容、需要登录或接口已变更。');
  return rows;
}

async function readPopularDom(site, command, limit) {
  const normalize = value => String(value ?? '').replace(/\s+/g,' ').trim();
  const value = (node, selector, max = 300) => normalize(node.querySelector(selector)?.textContent).slice(0,max);
  const visible = node => Boolean(node && node.getClientRects().length && !node.closest('[hidden], [aria-hidden="true"]'));
  const link = (node, selector, hosts) => {
    const element = node.querySelector(selector); if (!element) return null;
    let url; try { url = new URL(element.getAttribute('href'),location.href); } catch { return null; }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port || !hosts.includes(url.hostname)) return null;
    return {element,url};
  };
  const expected = site === 'douban' ? (command === 'top250' ? /^\/top250\/?$/ : /^\/chart\/?$/)
    : site === 'jd' ? /^\/Search\/?$/ : site === 'taobao' ? /^\/search\/?$/
    : site === 'xiaohongshu' ? /^\/search_result\/?$/ : site === 'douyin' ? /^\/search\// : /^\/weibo\/?$/;
  const selectors = {
    weibo:'.card-wrap',douban:command === 'book-hot' ? '.media.clearfix' : '.item',
    jd:'div[data-sku], #J_goodsList li[data-sku]',taobao:'[class*="doubleCard--"]',
    xiaohongshu:'section.note-item',douyin:'[data-e2e="scroll-list"] li',
  };
  const deadline = Date.now() + 8000;
  while (true) {
    if (/\/(?:signin|login)(?:\/|$)/i.test(location.pathname)) throw new Error('网站已转到登录页，请先在所选 Chrome 档案登录。');
    if (!expected.test(location.pathname)) throw new Error('网站没有停留在查询页面；请检查登录、验证或网页跳转。');
    const challenge = [...document.querySelectorAll('.geetest_panel, #captcha, .nc-container, [class*="captcha-container"]')].some(visible);
    if (challenge || /安全验证|异常请求|访问验证|人机验证|captcha/i.test(document.title || '')) throw new Error('网站要求手动安全验证，请在 Chrome 完成后重新查询。');
    const loginModal = [...document.querySelectorAll('.login-container, .login-modal, .login-mask, [class*="loginModal"], [class*="login-panel"], [role="dialog"]')].some(node=>visible(node) && /登录|登陆|扫码|sign in/i.test(node.innerText || node.textContent || ''));
    if (loginModal) throw new Error('网站显示登录窗口，请先在所选 Chrome 档案手动登录。');
    const rows = [], seen = new Set();
    for (const node of document.querySelectorAll(selectors[site])) {
      if (!visible(node)) continue;
      let row;
      if (site === 'weibo') {
        const target = link(node,'.from a[href]',['weibo.com','www.weibo.com']);
        if (!target || !/^\/(?:\d+\/|detail\/|status\/)[A-Za-z0-9]+\/?$/.test(target.url.pathname)) continue;
        const title = value(node,'[node-type="feed_list_content_full"], [node-type="feed_list_content"], .txt');
        if (!title) continue;
        row = {title,author:value(node,'.info .name, .name',100),time:value(node,'.from a',100),url:'https://weibo.com' + target.url.pathname};
      } else if (site === 'douban') {
        const host = command === 'book-hot' ? 'book.douban.com' : 'movie.douban.com';
        const target = link(node,command === 'book-hot' ? 'h2 a[href*="/subject/"]' : command === 'top250' ? 'a[href*="/subject/"]' : '.pl2 a[href*="/subject/"]',[host]);
        const key = target?.url.pathname.match(/^\/subject\/([1-9][0-9]*)\/?$/)?.[1];
        const title = command === 'top250' ? value(node,'.title') : normalize(target?.element.textContent).slice(0,300);
        if (!key || !title) continue;
        const rating = Number.parseFloat(value(node,'.rating_nums, .rating_num, .subject-rating .font-small, .rating',40));
        row = {id:key,title,...(Number.isFinite(rating) && rating >= 0 && rating <= 10 ? {rating} : {}),url:'https://' + host + '/subject/' + key + '/'};
      } else if (site === 'jd') {
        const key = node.getAttribute('data-sku'); if (!/^[1-9][0-9]{0,24}$/.test(key || '')) continue;
        const target = link(node,'a[href*="item.jd.com/"]',['item.jd.com']);
        if (target && target.url.pathname !== '/' + key + '.html') continue;
        const title = value(node,'.p-name em, .p-name a, [class*="title"]') || normalize(target?.element.getAttribute('title') || target?.element.textContent).slice(0,300);
        if (!title) continue;
        row = {sku:key,title,price:value(node,'.p-price, [class*="price"]',80),shop:value(node,'.p-shop, [class*="shop"]',100),url:'https://item.jd.com/' + key + '.html'};
      } else if (site === 'taobao') {
        const target = link(node,'a[href*="item.htm"]',['item.taobao.com','detail.tmall.com']);
        const key = target?.url.searchParams.get('id'), title = value(node,'[class*="title--"]');
        if (!target || target.url.pathname !== '/item.htm' || !/^[1-9][0-9]{0,24}$/.test(key || '') || !title) continue;
        const integer = value(node,'[class*="priceInt--"]',40), fraction = value(node,'[class*="priceFloat--"]',10);
        row = {id:key,title,price:integer ? '¥' + integer + fraction : '',shop:value(node,'[class*="shopName--"]',100),url:target.url.origin + '/item.htm?id=' + key};
      } else if (site === 'xiaohongshu') {
        if (node.classList.contains('query-note-item')) continue;
        const target = link(node,'a[href*="/search_result/"], a[href*="/explore/"]',['www.xiaohongshu.com']);
        const key = target?.url.pathname.match(/^\/(?:search_result|explore)\/([a-f0-9]{24})\/?$/i)?.[1];
        const title = value(node,'.title, .note-title, .footer .title span');
        if (!key || !title) continue;
        row = {id:key,title,author:value(node,'.author .name, .name',100),url:'https://www.xiaohongshu.com/explore/' + key,detailHint:'详情可能需要从原搜索结果打开'};
      } else if (site === 'douyin') {
        const target = link(node,'a[href*="/video/"]',['www.douyin.com']);
        const key = target?.url.pathname.match(/^\/video\/([1-9][0-9]{0,29})\/?$/)?.[1];
        if (!key) continue;
        let title = normalize(target.element.getAttribute('title') || target.element.getAttribute('aria-label')).slice(0,300);
        if (!title) title = [...node.querySelectorAll('span,p')].filter(item=>!item.children.length).map(item=>normalize(item.textContent)).filter(text=>text && !/^(?:@|\d{1,2}:\d{2}|\d+(?:\.\d+)?(?:万|亿)?$|\d+天前|\d{4}[/-])/.test(text)).sort((a,b)=>b.length-a.length)[0]?.slice(0,300) || '';
        if (!title) continue;
        row = {id:key,title,url:'https://www.douyin.com/video/' + key};
      }
      if (!row || seen.has(row.url)) continue;
      seen.add(row.url); rows.push({rank:rows.length + 1,...row,source:site === 'douban' ? 'visible-chart' : 'native-search'});
      if (rows.length >= limit) break;
    }
    if (rows.length) return rows;
    const body = document.body?.innerText || '';
    if (/登录后(?:查看|浏览|搜索)|请(?:先)?登录(?:后|以|再)|扫码登录后/i.test(body)) throw new Error('该查询需要登录，请先在所选 Chrome 档案登录。');
    if (/请完成(?:安全|人机)验证|拖动滑块|访问过于频繁|请求异常|verify you are human/i.test(body)) throw new Error('网站要求手动验证或暂时限流，请在 Chrome 检查后重新查询。');
    if (site !== 'douban' && /(?:^|\n)\s*(?:暂无(?:相关)?(?:搜索)?结果|没有找到(?:相关)?结果|未找到相关(?:内容|商品|视频)|抱歉，没有找到相关的宝贝)\s*[。！!]?\s*(?:$|\n)/.test(body)) return [];
    if (Date.now() >= deadline) throw new Error('未读取到有效条目；页面可能尚未加载、需要登录/验证或结构已变更，请在 Chrome 检查。');
    await new Promise(resolve=>setTimeout(resolve,200));
  }
}

export async function runPopularBrowserAdapter({args,page}) {
  const {site,command} = args, options = {...args.arguments,limit:args.arguments.limit ?? 5};
  if (!popularBrowserAdapter(`${site}/${command}`)) throw new Error('常用网站命令未开放。');
  const maximum = site === 'weibo' && command === 'hot' ? 50 : command === 'top250' ? 25 : 20;
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > maximum) throw new Error('常用网站查询数量超出范围。');
  if (command === 'search' && (typeof (options.query || options.keyword) !== 'string' || !(options.query || options.keyword).trim() || (options.query || options.keyword).length > 300 || /[\x00-\x1f\x7f]/.test(options.query || options.keyword))) throw new Error('常用网站搜索词无效。');
  if (site === 'zhihu' || (site === 'weibo' && command === 'hot')) {
    await page.goto(site === 'zhihu' ? 'https://www.zhihu.com/' : 'https://weibo.com/');
    return page.evaluate(`(${readPopularApi.toString()})(${JSON.stringify(site)},${JSON.stringify(command)},${JSON.stringify(options)})`);
  }
  const query = encodeURIComponent(options.query || options.keyword || '');
  const url = site === 'weibo' ? `https://s.weibo.com/weibo?q=${query}`
    : site === 'douban' ? `https://${command === 'book-hot' ? 'book' : 'movie'}.douban.com/${command === 'top250' ? 'top250' : 'chart'}`
    : site === 'jd' ? `https://search.jd.com/Search?keyword=${query}&enc=utf-8`
    : site === 'taobao' ? `https://s.taobao.com/search?q=${query}`
    : site === 'xiaohongshu' ? `https://www.xiaohongshu.com/search_result?keyword=${query}&source=web_search_result_notes`
    : `https://www.douyin.com/search/${query}?type=video`;
  await page.goto(url);
  return page.evaluate(`(${readPopularDom.toString()})(${JSON.stringify(site)},${JSON.stringify(command)},${options.limit})`);
}
