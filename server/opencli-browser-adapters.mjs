import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const configuredSites = new Set(['dyyj', 'switch520', 'gamer520', 'dygang', 'wlgo', 'fire-exam']);
const upstreamModules = new Map([
  ...['hot', 'search', 'read'].map(command => [`tieba/${command}`, `tieba/${command}.js`]),
  ...['search', 'hot', 'ranking', 'video', 'comments', 'history'].map(command => [`bilibili/${command}`, `bilibili/${command}.js`]),
]);
const invalid = message => Object.assign(new Error(message), { status: 400, code: 'invalid_arguments' });
const json = value => JSON.stringify(value);
const boundedLimit = value => { if (!Number.isInteger(value) || value < 1 || value > 50) throw invalid('网站查询 limit 须为 1–50 的整数。'); return value; };
const safeText = (value, maximum = 300) => { if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) throw invalid('网站查询文本无效。'); return value.trim(); };

export function assertBrowserAdapterUrl(value, origins) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) throw invalid('网站查询需要有效的 HTTPS 地址。');
  let url; try { url = new URL(value); } catch { throw invalid('网站查询需要有效的 HTTPS 地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !origins.includes(url.origin)) throw invalid('网站页面不在此查询允许的范围内。');
  return url.href;
}

/** Server-owned policy only. Configured addresses never come from Agent arguments. */
export function browserAdapterOrigins(policy, siteOrigins = {}) {
  const origins = policy.engine === 'configured' ? siteOrigins[policy.site] || policy.origins : policy.origins;
  if (!Array.isArray(origins) || !origins.length || origins.length > 2) throw Object.assign(new Error('此网站尚未配置网址，请在选中执行电脑的 OpenCLI 设置中填写。'), { status: 409, code: 'site_url_required' });
  for (const origin of origins) if (assertBrowserAdapterUrl(origin, origins) !== `${origin}/`) throw invalid('网站来源配置无效。');
  return policy.engine === 'configured' && policy.command === 'search' && policy.site !== 'switch520' ? ['https://www.bing.com', 'https://cn.bing.com'] : [...origins];
}

/** Limits browser fetch to the reviewed read APIs; no Node cookie/fetch interface is provided. */
export function browserAdapterNetworkRules(site) {
  if (site === 'bilibili') return [{ origin: 'https://api.bilibili.com', methods: ['GET'], paths: ['/x/web-interface/nav', '/x/web-interface/wbi/search/type', '/x/web-interface/view', '/x/web-interface/popular', '/x/web-interface/ranking/v2', '/x/web-interface/history/cursor', '/x/v3/fav/folder/created/list-all', '/x/v3/fav/resource/list', '/x/v2/reply/main', '/x/v2/reply/reply'] }];
  if (site === 'quark') return [
    { origin: 'https://drive-h.quark.cn', methods: ['POST'], paths: ['/1/clouddrive/share/sharepage/token'] },
    { origin: 'https://drive-h.quark.cn', methods: ['GET'], paths: ['/1/clouddrive/share/sharepage/detail'] },
    { origin: 'https://drive-pc.quark.cn', methods: ['GET'], paths: ['/1/clouddrive/file/sort'] },
  ];
  return [];
}

export function cleanBrowserAdapterRows(value, args = {}) {
  if (!Array.isArray(value) || value.length > 50) throw new Error('网站查询返回的条目数量无效或超过 50 项。');
  const secretValues = [args.passcode, ...(args.url ? [new URL(args.url).searchParams.get('pwd')] : [])].filter(value => typeof value === 'string' && value.length);
  const clean = (item, depth = 0) => {
    if (depth > 12) throw new Error('网站查询响应层级过深。');
    if (Array.isArray(item)) return item.map(child => clean(child, depth + 1));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([key]) => !/(?:token|cookie|authorization|password|passcode|secret|csrf|credential|api[_-]?key)/i.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)).map(([key, child]) => [key, clean(child, depth + 1)]));
    if (typeof item !== 'string') return item;
    let text = item.replace(/(Bearer\s+)[^\s"']+/gi, '$1[已隐藏]').replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|authorization)\s*[=:]\s*["']?)[^\s"',;&]+/gi, '$1[已隐藏]').replace(/([?&#](?:pwd|token|key|code|session|auth)[^=&#]*=)[^&#\s"']+/gi, '$1[已隐藏]');
    for (const secret of secretValues) text = text.split(secret).join('[已隐藏]');
    return text;
  };
  const rows = clean(value);
  if (Buffer.byteLength(JSON.stringify(rows)) > 128 * 1024) throw new Error('网站查询响应超过 128 KiB。');
  return rows;
}

async function runUpstream({ args, policy, page, bundleRoot }) {
  const key = `${args.site}/${args.command}`, expected = upstreamModules.get(key);
  if (!expected || policy.modulePath !== expected) throw invalid('此浏览器适配器未开放。');
  if (args.site === 'bilibili' && ['video', 'comments'].includes(args.command) && !/^BV[0-9A-Za-z]{10}$/.test(args.arguments.bvid || '')) throw invalid('请提供完整 BV 视频 ID，不接受短链接。');
  const manifest = JSON.parse(await readFile(path.join(bundleRoot, 'cli-manifest.json'), 'utf8'));
  const entry = manifest.find(item => item.site === args.site && item.name === args.command);
  if (!entry || entry.modulePath !== expected || entry.access !== 'read' || entry.browser !== true) throw new Error('内置浏览器适配器与已审阅版本不匹配。');
  const root = await realpath(path.join(bundleRoot, 'clis')), module = await realpath(path.join(root, expected));
  const relative = path.relative(root, module);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('内置浏览器模块路径越界。');
  const registry = await import(pathToFileURL(path.join(bundleRoot, 'dist/src/registry.js')).href);
  await import(pathToFileURL(module).href);
  const command = registry.getRegistry().get(key);
  if (!command || command.access !== 'read' || command.browser !== true) throw new Error('内置浏览器命令无效。');
  if (policy.login === 'required') {
    await page.goto(policy.origins[0] + '/');
    const loggedIn = await page.evaluate(`(async () => { const response = await fetch('https://api.bilibili.com/x/web-interface/nav',{credentials:'include'}); const data = await response.json(); return data.code === 0 && data.data?.isLogin === true; })()`);
    if (!loggedIn) throw new Error('请先在所选 Chrome 档案登录 B站。');
  }
  // Never use executeCommand(): its default profile, session creation and retry lifecycle
  // would bypass the runner's explicitly selected profile and per-query lease.
  if (command.func) return command.func(page, args.arguments);
  if (command.pipeline) {
    const { executePipeline } = await import(pathToFileURL(path.join(bundleRoot, 'dist/src/pipeline/index.js')).href);
    return executePipeline(page, command.pipeline, { args: args.arguments, debug: false });
  }
  throw new Error('内置浏览器命令没有执行实现。');
}

async function search(page, query, limit, engine, targetOrigins = []) {
  const origin = engine === 'baidu' ? 'https://www.baidu.com' : 'https://www.bing.com';
  const searchQuery = targetOrigins.length ? `(${targetOrigins.map(origin => `site:${new URL(origin).hostname}`).join(' OR ')}) ${query}` : query;
  await page.goto(`${origin}${engine === 'baidu' ? '/s?wd=' : '/search?q='}${encodeURIComponent(searchQuery)}`);
  const rows = await page.evaluate(`(async () => {
    const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
    const targets = ${json(targetOrigins)}, limit = ${limit};
    let nodes = []; const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      nodes = document.querySelectorAll(${json(engine === 'baidu' ? '#content_left .result, #content_left .result-op, #content_left .c-container' : '#b_results > li.b_algo')});
      if (nodes.length || /验证码|安全验证|人机验证|captcha|verify you are human/i.test(document.body?.innerText || '')) break;
      await new Promise(resolve => setTimeout(resolve,100));
    }
    const seen = new Set(), rows = [];
    for (const node of nodes) {
      const link = node.querySelector('h2 a, h3 a'); if (!link) continue;
      let url; try { url = new URL(link.href); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      // Decode the source without visiting Bing's outbound redirect. Recheck
      // protocol and credentials after decoding, even for an allowed origin.
      if (['www.bing.com','cn.bing.com'].includes(url.hostname) && url.pathname === '/ck/a') {
        const wrapped = url.searchParams.get('u');
        if (wrapped?.startsWith('a1')) { try { url = new URL(atob(wrapped.slice(2).replace(/-/g, '+').replace(/_/g, '/'))); } catch { continue; } }
      }
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password || (targets.length && !targets.includes(url.origin))) continue;
      const title = normalize(link.textContent).slice(0, 300); if (!title || seen.has(url.href)) continue;
      seen.add(url.href); rows.push({rank:rows.length + 1,title,url:url.href,source:${json(engine === 'baidu' ? 'baidu-search' : 'bing-search')},snippet:normalize(node.querySelector('.b_caption p, .c-abstract, .content-right_8Zs40')?.textContent || node.textContent).slice(0, 1000)});
      if (rows.length >= limit) break;
    }
    if (!rows.length && /验证码|安全验证|人机验证|captcha|verify you are human/i.test(document.body?.innerText || '')) throw new Error('网站要求手动验证，请在浏览器完成后重新查询。');
    return rows;
  })()`);
  if (!rows.length) throw new Error('未读取到搜索结果；网站可能无匹配内容、要求验证或页面结构已变更。');
  return rows;
}

async function readPage(page, url, limit, onlyLinks = false, externalLinks = false, latest = false) {
  await page.goto(url);
  return page.evaluate(`(async () => {
    const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
    let root, text = ''; const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      root = document.querySelector('main, [role="main"]') || document.querySelector('#primary, .site-main, .content-area, .App-content, .PostStream, .DiscussionList, #content, article') || document.body;
      const copy = root?.cloneNode(true);
      for (const node of copy?.querySelectorAll('header,footer,nav,aside,form,script,style,input,textarea') || []) node.remove();
      text = normalize(copy?.innerText || copy?.textContent).slice(0, 6000);
      if (text.length >= 12 && !/^(加载中|正在加载|Loading\\.{0,3})$/i.test(text)) break;
      await new Promise(resolve => setTimeout(resolve,100));
    }
    if (text.length < 12) throw new Error('页面正文尚未加载或没有可读取的内容。');
    if (/安全验证|人机验证|verify you are human|captcha/i.test(text)) throw new Error('网站要求手动验证，请在浏览器完成后重新查询。');
    if (${latest}) {
      const items = root.querySelectorAll('.DiscussionListItem-main, article h1 a[href], article h2 a[href], article h3 a[href], .entry-title a[href], .post-title a[href]');
      const rows = [], seen = new Set();
      for (const node of items) {
        let url; try { url = new URL(node.href); } catch { continue; }
        const title = normalize(node.querySelector?.('.DiscussionListItem-title')?.textContent || node.textContent).slice(0,300);
        if (!title || node.closest?.('header,footer,nav,aside,form') || /^(登录|注册|登陆|Login|Sign in)$/i.test(title) || url.pathname.split('/').some(part => ['login','register','oauth','authorize'].includes(part.toLowerCase())) || url.protocol !== 'https:' || url.origin !== location.origin || url.username || url.password || seen.has(url.href)) continue;
        seen.add(url.href); rows.push({title,url:url.href,source:'visible-list'}); if (rows.length >= ${limit}) break;
      }
      return rows.length ? rows : [{title:normalize(document.title).slice(0,300),url:location.href,text,source:'visible-page',message:'未识别到帖子或文章列表，返回当前页面信息。'}];
    }
    const rows = ${onlyLinks} ? [] : [{title:normalize(document.title).slice(0,300),url:location.href,text}];
    const seen = new Set();
    for (const node of root.querySelectorAll('a[href]')) {
      let url; try { url = new URL(node.href); } catch { continue; }
      const title = normalize(node.textContent).slice(0,300);
      if (node.closest('header,footer,nav,aside,form') || /^(登录|注册|登陆|Login|Sign in|注册账号)$/i.test(title) || url.pathname.split('/').some(part => ['login','register','oauth','oauth2.0','authorize','connect'].includes(part.toLowerCase())) || ['qq.com','weixin.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) continue;
      if (!title || !['https:','http:'].includes(url.protocol) || url.username || url.password || (!${externalLinks} && url.origin !== location.origin) || seen.has(url.href)) continue;
      seen.add(url.href); rows.push({title,url:url.href,...(url.origin !== location.origin ? {external:true} : {})}); if (rows.length >= ${limit}) break;
    }
    return rows.slice(0,${limit});
  })()`);
}

async function baiduShare(page, options, limit, info = false) {
  const url = new URL(options.url), passcode = options.passcode || url.searchParams.get('pwd') || '';
  url.searchParams.delete('pwd'); url.hash = ''; await page.goto(url.href);
  return page.evaluate(`(async () => {
    const limit = ${limit}, passcode = ${json(passcode)};
    const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
    const input = document.querySelector('#accessCode, input[placeholder*="提取码"]');
    if (input) {
      if (!passcode) { if (${info}) return [{title:normalize(document.title).slice(0,300),status:'requires-passcode',available:null}]; throw new Error('此分享需要提取码，请在 passcode 参数中提供。'); }
      const submit = [...document.querySelectorAll('button,a.g-button')].find(node => /^(提取文件|提取|查看文件)$/.test(normalize(node.textContent)));
      if (!submit) throw new Error('无法识别分享页的提取入口，请手动打开分享。');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,passcode);
      input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); submit.click();
    }
    const deadline = Date.now() + 4000; let nodes = [];
    while (Date.now() < deadline) {
      nodes = [...document.querySelectorAll('.list-view-item, .grid-view-item, [data-fsid]')];
      if (nodes.length) break;
      if (/提取码错误|分享已取消|分享已过期|链接不存在/.test(document.body?.innerText || '')) { if (${info}) return [{title:normalize(document.title).slice(0,300),status:'unavailable',available:false}]; throw new Error('分享不可用或提取码不正确。'); }
      await new Promise(resolve => setTimeout(resolve,100));
    }
    const seen = new Set(), rows = [];
    for (const node of nodes) {
      const nameNode = node.querySelector('.file-name, .filename, [data-filename]');
      const name = normalize(node.getAttribute('data-filename') || nameNode?.getAttribute('title') || nameNode?.textContent).slice(0,500);
      if (!name || seen.has(name)) continue; seen.add(name);
      rows.push({name,size:normalize(node.querySelector('.file-size, .size')?.textContent).slice(0,80),modified:normalize(node.querySelector('.file-time, .ctime')?.textContent).slice(0,80)});
      if (rows.length >= limit) break;
    }
    if (${info}) return [{title:normalize(document.title).slice(0,300),status:rows.length?'visible-files':'unverified',available:rows.length?true:null,visibleFiles:rows.length}];
    if (!rows.length) throw new Error('没有读取到分享文件；请检查登录、验证、提取码和页面状态。');
    return rows;
  })()`);
}

async function xunleiShare(page, options, limit, info = false) {
  const url = new URL(options.url), passcode = options.passcode || url.searchParams.get('pwd') || '';
  url.search = ''; url.hash = ''; await page.goto(url.href);
  return page.evaluate(`(async () => {
    const normalize = text => String(text || '').replace(/\\s+/g,' ').trim(), passcode = ${json(passcode)};
    const input = document.querySelector('input[placeholder*="提取码"], input[placeholder*="访问码"], input[placeholder*="密码"]');
    if (input) {
      if (!passcode) { if (${info}) return [{title:normalize(document.title).slice(0,300),status:'requires-passcode',available:null}]; throw new Error('此迅雷分享需要提取码，请提供 passcode。'); }
      const submit = [...document.querySelectorAll('button,[role="button"]')].find(node => /^(提取文件|提取|访问|确认|查看文件)$/.test(normalize(node.textContent)));
      if (!submit) throw new Error('无法识别迅雷分享提取入口，请手动打开分享。');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,passcode);
      input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); submit.click();
    }
    const deadline = Date.now() + 4000; let nodes = [];
    while (Date.now() < deadline) {
      nodes = [...document.querySelectorAll('[data-file-id], [data-fileid], .file-list-item, .file-item, .resource-list-item')];
      if (nodes.length) break;
      if (/提取码错误|分享已取消|分享已过期|链接不存在/.test(document.body?.innerText || '')) { if (${info}) return [{title:normalize(document.title).slice(0,300),status:'unavailable',available:false}]; throw new Error('迅雷分享不可用或提取码不正确。'); }
      await new Promise(resolve => setTimeout(resolve,100));
    }
    const rows = [], seen = new Set();
    for (const node of nodes) {
      const element = node.querySelector('.file-name,.name,[data-file-name],[title]');
      const name = normalize(node.getAttribute('data-file-name') || element?.getAttribute('title') || element?.textContent).slice(0,500);
      if (!name || seen.has(name)) continue; seen.add(name);
      rows.push({name,size:normalize(node.querySelector('.file-size,.size')?.textContent).slice(0,80)});
      if (rows.length >= ${limit}) break;
    }
    if (${info}) return [{title:normalize(document.title).slice(0,300),status:rows.length?'visible-files':'unverified',available:rows.length?true:null,visibleFiles:rows.length}];
    if (!rows.length) throw new Error('没有读取到迅雷分享文件；请检查登录、提取码、验证与页面结构。');
    return rows;
  })()`);
}

async function bilibiliFavorite(page, options, limit, bundleRoot) {
  // The 1.8.8 favorite module declares access=write, so it is deliberately not
  // loaded as a reviewed read adapter. Only these fixed GET APIs are used.
  const { apiGet } = await import(pathToFileURL(path.join(bundleRoot, 'clis/bilibili/utils.js')).href);
  await page.goto('https://www.bilibili.com/');
  const checked = async (endpoint, params = {}, signed = false) => {
    const payload = await apiGet(page, endpoint, { params, signed });
    if (!payload || payload.code !== 0) throw new Error('B站收藏读取要求有效登录或服务暂不可用。');
    return payload.data;
  };
  const nav = await checked('/x/web-interface/nav');
  if (!nav?.isLogin || !nav.mid) throw new Error('请先在所选 Chrome 档案登录 B站。');
  let fid = options.fid;
  if (!fid) {
    const folders = await checked('/x/v3/fav/folder/created/list-all', { up_mid: nav.mid }, true);
    fid = folders?.list?.[0]?.id;
    if (!fid) return [];
  }
  const data = await checked('/x/v3/fav/resource/list', { media_id: fid, pn: 1, ps: Math.min(limit, 40) }, true);
  return (data?.medias || []).slice(0, limit).map((item, index) => ({rank:index + 1,title:String(item.title || '').slice(0,500),author:String(item.upper?.name || '').slice(0,200),url:/^BV[0-9A-Za-z]{10}$/.test(item.bvid || '') ? `https://www.bilibili.com/video/${item.bvid}` : ''}));
}

async function quark(page, command, options, limit) {
  const depth = options.depth ?? 0;
  if (!Number.isInteger(depth) || depth < 0 || depth > 1) throw invalid('夸克目录 depth 只支持 0 或 1。');
  const share = command === 'share-tree', url = share ? new URL(options.url) : null;
  const pwdId = url?.pathname.match(/^\/s\/([a-zA-Z0-9]{6,64})\/?$/)?.[1];
  if (share && !pwdId) throw invalid('请提供完整夸克分享地址。');
  const passcode = options.passcode || url?.searchParams.get('pwd') || '';
  const folderPath = options.path || '';
  if (typeof folderPath !== 'string' || folderPath.length > 200 || /[\x00-\x1f]/.test(folderPath) || folderPath.split('/').filter(Boolean).length > 4) throw invalid('夸克目录路径最多支持四层。');
  await page.goto('https://pan.quark.cn/');
  return page.evaluate(`(async () => {
    const share = ${share}, pwdId = ${json(pwdId || '')}, passcode = ${json(passcode)}, folderPath = ${json(folderPath)}, depth = ${depth}, limit = ${limit};
    const shareApi = 'https://drive-h.quark.cn/1/clouddrive/share/sharepage';
    const fileApi = 'https://drive-pc.quark.cn/1/clouddrive/file/sort';
    let requests = 0;
    const api = async (url, init = {}) => {
      if (++requests > 55) throw new Error('夸克目录请求达到限制。');
      const response = await fetch(url,{...init,credentials:'include',headers:{'Content-Type':'application/json'}});
      if (!response.ok) throw new Error('夸克服务暂不可用或需要登录。');
      const payload = await response.json();
      if (payload.status !== 200) throw new Error('夸克要求登录、提取码不正确或分享不可用。');
      return payload.data || {};
    };
    let stoken;
    if (share) stoken = (await api(shareApi + '/token?pr=ucpro&fr=pc',{method:'POST',body:JSON.stringify({pwd_id:pwdId,passcode,support_visit_limit_private_share:true})})).stoken;
    if (share && typeof stoken !== 'string') throw new Error('夸克没有返回有效的分享许可。');
    const list = async fid => {
      const params = new URLSearchParams({pr:'ucpro',fr:'pc',pdir_fid:fid,_page:'1',_size:String(limit),_fetch_total:'1',_sort:'file_type:asc,file_name:asc'});
      if (share) { params.set('pwd_id',pwdId); params.set('stoken',stoken); }
      const data = await api((share ? shareApi + '/detail' : fileApi) + '?' + params);
      if (!Array.isArray(data.list)) throw new Error('夸克文件列表格式无效。');
      return data.list.slice(0,limit);
    };
    let root = '0';
    for (const part of folderPath.split('/').filter(Boolean)) {
      const entry = (await list(root)).find(item => item.dir && item.file_name === part);
      if (!entry) throw new Error('首批有界文件列表中没有找到该目录；请检查路径。');
      root = String(entry.fid);
    }
    const rows = [], first = await list(root);
    const add = (file,parent) => {
      const name = String(file.file_name || '').slice(0,500); if (!name) return;
      rows.push({name,fid:String(file.fid || '').slice(0,128),is_dir:Boolean(file.dir),size:Number.isFinite(Number(file.size))?Number(file.size):0,path:(parent ? parent + '/' : '') + name});
    };
    for (const file of first) { add(file,folderPath); if (rows.length >= limit) break; }
    if (depth === 1 && rows.length < limit) for (const folder of first.filter(file => file.dir)) {
      if (rows.length >= limit) break;
      for (const file of await list(String(folder.fid))) { add(file,(folderPath ? folderPath + '/' : '') + String(folder.file_name)); if (rows.length >= limit) break; }
    }
    return rows;
  })()`);
}

/** Fixed adapter entry. page is a lease-bound, origin-checked interface, not a user script. */
export async function runBrowserAdapter({ args, policy, page, bundleRoot, siteOrigins = {} }) {
  if (!args || !policy || args.site !== policy.site || args.command !== policy.command || !args.arguments || typeof args.arguments !== 'object') throw invalid('浏览器查询参数无效。');
  const key = `${args.site}/${args.command}`, options = args.arguments;
  browserAdapterOrigins(policy, siteOrigins);
  let rows;
  if (policy.engine === 'upstream') rows = await runUpstream({ args, policy, page, bundleRoot });
  else if (policy.engine === 'configured' && configuredSites.has(args.site)) {
    const origins = siteOrigins[args.site] || policy.origins;
    if (['read','detail','latest','links','notice','status'].includes(args.command)) rows = await readPage(page, assertBrowserAdapterUrl(options.url || `${origins[0]}/${args.site === 'fire-exam' && args.command === 'notice' ? '#/tzgg' : ''}`, origins), boundedLimit(options.limit ?? 20), ['links','latest'].includes(args.command), args.command === 'links', args.command === 'latest');
    else if (args.command === 'search' && args.site === 'switch520') rows = (await readPage(page, `${origins[0]}/search/${encodeURIComponent(safeText(options.query))}/`, boundedLimit(options.limit ?? 5), true)).map(row => ({...row,source:'native-search'}));
    else if (args.command === 'search') rows = await search(page, safeText(options.query), boundedLimit(options.limit ?? 5), 'bing', origins);
    else throw invalid('此网站命令未开放。');
  } else if (policy.engine === 'builtin' && ['baidu-search/search', 'bing/search'].includes(key)) rows = await search(page, safeText(options.query), boundedLimit(options.limit ?? 5), args.site === 'baidu-search' ? 'baidu' : 'bing');
  else if (policy.engine === 'builtin' && ['baidu-pan/share-files','baidu-pan/share-info','baidu-pan/share-tree'].includes(key)) {
    assertBrowserAdapterUrl(options.url, policy.origins); rows = await baiduShare(page, options, boundedLimit(options.limit ?? 20), args.command === 'share-info');
  } else if (policy.engine === 'builtin' && ['xunlei-pan/share-info','xunlei-pan/share-tree'].includes(key)) {
    assertBrowserAdapterUrl(options.url, policy.origins); rows = await xunleiShare(page, options, boundedLimit(options.limit ?? 20), args.command === 'share-info');
  } else if (policy.engine === 'builtin' && key === 'bilibili/favorite') rows = await bilibiliFavorite(page, options, boundedLimit(options.limit ?? 20), bundleRoot);
  else if (policy.engine === 'builtin' && ['quark/ls', 'quark/share-tree'].includes(key)) {
    if (options.url) assertBrowserAdapterUrl(options.url, policy.origins);
    rows = await quark(page, args.command, options, boundedLimit(options.limit ?? 20));
  } else throw invalid('此浏览器适配器未开放。');
  return cleanBrowserAdapterRows(rows, options);
}
