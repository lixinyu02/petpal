import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { OPENCLI_BROWSER_POLICIES, browserQueryPolicy, notebookWebsiteCatalog, normalizeSiteOrigins } from './opencli-browser-policies.mjs';

export const OPENCLI_VERSION = '1.8.8';
const require = createRequire(import.meta.url);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const invalid = message => Object.assign(new Error(message), { status: 400, code: 'invalid_arguments' });
const text = (maxLength = 300, extra = {}) => ({ type: 'string', minLength: 1, maxLength, ...extra });
const limit = (maximum = 20, initial = 5) => ({ type: 'integer', minimum: 1, maximum, default: initial });
const choice = (values, initial) => ({ type: 'string', enum: values, ...(initial !== undefined ? { default: initial } : {}) });
const languages = ['en', 'zh', 'ja', 'de', 'fr', 'es', 'ru', 'ko', 'pt', 'it', 'simple'];
const locales = ['en-US', 'de', 'es', 'fr', 'ja', 'ko', 'pt-BR', 'ru', 'zh-CN', 'zh-TW'];
const define = (site, command, properties, required = [], hosts = []) => ({ site, command, modulePath: `${site}/${command}.js`, hosts, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
const freeze = value => { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };

// Reviewed pinned modules. PUBLIC metadata alone is deliberately insufficient.
export const OPENCLI_QUERY_POLICIES = freeze([
  define('36kr', 'news', { limit: limit() }, [], ['www.36kr.com']),
  ...['hot', 'latest'].map(command => define('v2ex', command, { limit: limit() }, [], ['www.v2ex.com'])),
  define('v2ex', 'topic', { id: text(12, { pattern: '^\\d{1,12}$' }) }, ['id'], ['www.v2ex.com']),
  define('hackernews', 'top', { limit: limit() }, [], ['hacker-news.firebaseio.com']),
  define('hackernews', 'search', { query: text(), limit: limit(), sort: choice(['relevance', 'date'], 'relevance') }, ['query'], ['hn.algolia.com']),
  define('hackernews', 'read', { id: text(12, { pattern: '^\\d{1,12}$' }), limit: limit(5, 3), depth: limit(2, 1), replies: limit(3, 2), 'max-length': { type: 'integer', minimum: 100, maximum: 2000, default: 1000 } }, ['id'], ['hacker-news.firebaseio.com']),
  define('npm', 'package', { name: text(214, { pattern: '^(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$' }) }, ['name'], ['registry.npmjs.org']),
  define('npm', 'search', { query: text(), limit: limit() }, ['query'], ['registry.npmjs.org']),
  define('github-trending', 'repos', { since: choice(['daily', 'weekly', 'monthly'], 'daily'), language: { type: 'string', maxLength: 40, pattern: '^[a-zA-Z0-9+#._-]*$', default: '' }, limit: limit() }, [], ['github.com']),
  define('wikipedia', 'search', { query: text(), limit: limit(), lang: choice(languages, 'en') }, ['query'], languages.map(lang => `${lang}.wikipedia.org`)),
  define('wikipedia', 'summary', { title: text(), lang: choice(languages, 'en') }, ['title'], languages.map(lang => `${lang}.wikipedia.org`)),
  define('arxiv', 'search', { query: text(), limit: limit() }, ['query'], ['export.arxiv.org']),
  define('arxiv', 'recent', { category: text(40, { pattern: '^[a-z]+(?:-[a-z]+)*(?:\\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)?$' }), limit: limit() }, ['category'], ['export.arxiv.org']),
  define('arxiv', 'paper', { id: text(40, { pattern: '^(?:\\d{4}\\.\\d{4,5}|[a-z-]+(?:\\.[A-Z]{2})?/\\d{7})(?:v\\d{1,3})?$' }) }, ['id'], ['export.arxiv.org']),
  define('bbc', 'news', { limit: limit() }, [], ['feeds.bbci.co.uk']),
  define('juejin', 'hot', { category: choice(['backend', 'frontend', 'android', 'ios', 'ai'], 'backend'), limit: limit() }, [], ['api.juejin.cn']),
  define('juejin', 'recommend', { cursor: text(24, { pattern: '^(0|[1-9]\\d*)$', default: '0' }), limit: limit() }, [], ['api.juejin.cn']),
  define('toutiao', 'hot', { limit: limit() }, [], ['www.toutiao.com']),
  define('steam', 'search', { query: text(), limit: limit(), currency: choice(['us', 'cn', 'jp', 'de', 'gb', 'fr', 'kr', 'au', 'ca'], 'us') }, ['query'], ['store.steampowered.com']),
  define('steam', 'app', { id: text(12, { pattern: '^\\d{1,12}$' }), currency: choice(['us', 'cn', 'jp', 'de', 'gb', 'fr', 'kr', 'au', 'ca'], 'us') }, ['id'], ['store.steampowered.com']),
  define('steam', 'top-sellers', { limit: limit() }, [], ['store.steampowered.com']),
  define('mdn', 'search', { query: text(), limit: limit(), locale: choice(locales, 'en-US') }, ['query'], ['developer.mozilla.org']),
]);
const policies = new Map(OPENCLI_QUERY_POLICIES.map(policy => [`${policy.site}/${policy.command}`, policy]));
const clone = value => JSON.parse(JSON.stringify(value));

export function openCliQueryPolicy(site, command) { const policy = policies.get(`${site}/${command}`); return policy ? { ...clone(policy), mode: 'public' } : browserQueryPolicy(site, command); }
export function validateOpenCliSites(body = {}) {
  if (!object(body) || Object.keys(body).some(key => !['site', 'command'].includes(key))) throw invalid('OpenCLI 网站查询参数无效。');
  for (const key of ['site', 'command']) if (body[key] !== undefined && (typeof body[key] !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(body[key]))) throw invalid(`OpenCLI ${key} 无效。`);
  if (body.command !== undefined && body.site === undefined) throw invalid('查询命令需要指定网站。');
  return { ...(body.site === undefined ? {} : { site: body.site }), ...(body.command === undefined ? {} : { command: body.command }) };
}
export function validateOpenCliQuery(body) {
  if (!object(body) || Object.keys(body).some(key => !['site', 'command', 'arguments'].includes(key))) throw invalid('OpenCLI 查询含未支持的字段。');
  const policy = typeof body.site === 'string' && typeof body.command === 'string' ? openCliQueryPolicy(body.site, body.command) : null;
  if (!policy) throw invalid('此网站命令未开放；请先查看 OpenCLI 网站清单。');
  const args = body.arguments ?? {};
  if (!object(args) || Object.keys(args).some(key => !Object.hasOwn(policy.inputSchema.properties, key))) throw invalid('OpenCLI arguments 含未支持的字段。');
  const result = {};
  for (const [name, schema] of Object.entries(policy.inputSchema.properties)) {
    let value = args[name];
    if (value === undefined) value = schema.default;
    if (value === undefined) { if (policy.inputSchema.required.includes(name)) throw invalid(`OpenCLI 缺少 ${name}。`); continue; }
    if (schema.type === 'integer') {
      if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) throw invalid(`OpenCLI ${name} 须为 ${schema.minimum}–${schema.maximum} 的整数。`);
    } else {
      if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) throw invalid(`OpenCLI ${name} 文本无效。`);
      value = value.trim();
      if (value.length < (schema.minLength ?? 0) || value.length > schema.maxLength || (schema.pattern && !new RegExp(schema.pattern).test(value)) || (schema.enum && !schema.enum.includes(value))) throw invalid(`OpenCLI ${name} 不在允许范围内。`);
    }
    result[name] = value;
  }
  return { site: policy.site, command: policy.command, arguments: result };
}

export async function resolveOpenCliQueryBundle(packageJsonPath) {
  const metadataPath = packageJsonPath || path.resolve(path.dirname(require.resolve('@jackwener/opencli')), '..', '..', 'package.json');
  const root = path.dirname(metadataPath.replace(/\.asar([\\/])/i, '.asar.unpacked$1'));
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (metadata.name !== '@jackwener/opencli' || metadata.version !== OPENCLI_VERSION) throw new Error('内置 OpenCLI 版本不匹配。');
  for (const file of ['cli-manifest.json', 'dist/src/execution.js', 'dist/src/registry.js', 'LICENSE']) if (!(await stat(path.join(root, file))).isFile()) throw new Error('内置 OpenCLI 查询资源不完整。');
  return { root, version: metadata.version };
}

export async function loadOpenCliCatalog(packageJsonPath, siteOrigins = {}) {
  siteOrigins = normalizeSiteOrigins(siteOrigins);
  const notebookSites = notebookWebsiteCatalog(siteOrigins);
  const websites = new Map(notebookSites.map(site => [site.site, site]));
  const bundle = await resolveOpenCliQueryBundle(packageJsonPath);
  const raw = await readFile(path.join(bundle.root, 'cli-manifest.json'), 'utf8');
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('OpenCLI 清单过大。');
  const manifest = JSON.parse(raw);
  if (!Array.isArray(manifest) || manifest.length > 5000) throw new Error('OpenCLI 清单无效。');
  const records = manifest.map(entry => {
    if (!entry || typeof entry.site !== 'string' || typeof entry.name !== 'string') throw new Error('OpenCLI 命令清单无效。');
    const policy = openCliQueryPolicy(entry.site, entry.name);
    if (policy?.mode === 'public' && (entry.access !== 'read' || entry.strategy !== 'public' || entry.browser !== false || entry.modulePath !== policy.modulePath)) throw new Error('已开放 OpenCLI 命令与固定清单不匹配。');
    if (policy?.engine === 'upstream' && (entry.access !== 'read' || entry.browser !== true || entry.modulePath !== policy.modulePath)) throw new Error('已开放浏览器命令与固定清单不匹配。');
    return { site: entry.site, command: entry.name, description: String(policy?.description || entry.description || '').slice(0, 600), access: policy?.engine === 'builtin' ? 'read' : entry.access, strategy: policy?.engine === 'builtin' ? 'browser' : entry.strategy, browser: policy?.engine === 'builtin' || entry.browser === true, domain: entry.domain || null, mode: policy?.mode || 'inventory', callable: Boolean(policy), ...(policy ? { inputSchema: clone(policy.inputSchema), ...(policy.login ? { login: policy.login } : {}) } : {}) };
  });
  if (records.filter(entry => entry.mode === 'public').length !== policies.size || records.filter(entry => entry.mode === 'browser').length !== OPENCLI_BROWSER_POLICIES.filter(policy => manifest.some(entry => entry.site === policy.site && entry.name === policy.command)).length) throw new Error('已开放 OpenCLI 命令缺失。');
  for (const policy of OPENCLI_BROWSER_POLICIES) {
    if (records.some(entry => entry.site === policy.site && entry.command === policy.command)) continue;
    const website = websites.get(policy.site), ready = website.status === 'ready';
    records.push({ site: policy.site, command: policy.command, description: policy.description, access: 'read', strategy: 'browser', browser: true, domain: website.origins[0] ? new URL(website.origins[0]).hostname : null, mode: policy.mode, callable: ready, inputSchema: clone(policy.inputSchema), login: policy.login, configRequired: !ready });
  }
  const sites = [...new Set(records.map(entry => entry.site))].sort().map(site => {
    const entries = records.filter(entry => entry.site === site), domains = [...new Set(entries.map(entry => entry.domain).filter(Boolean))].sort();
    const enabledCommands = entries.filter(entry => entry.callable).map(entry => entry.command).sort();
    const browserCommands = entries.filter(entry => entry.browser).length;
    const website = websites.get(site);
    if (website) domains.splice(0, domains.length, ...website.origins.map(origin => new URL(origin).hostname));
    return { id: site, site, domains, commands: entries.length, queryCommands: enabledCommands.length, enabledCommands, browserCommands, needsBrowserBridge: browserCommands > 0, local: domains.length > 0 && domains.every(domain => ['127.0.0.1', 'localhost', 'doubao-app'].includes(domain)), mode: entries.find(entry => entry.mode !== 'inventory')?.mode || 'inventory', ...(website ? { label: website.label, websiteStatus: website.status, login: website.login } : {}) };
  });
  const summary = { adapterNamespaces: sites.length, totalCommands: records.length, readCommands: records.filter(entry => entry.access === 'read').length, writeCommands: records.filter(entry => entry.access === 'write').length, browserCommands: records.filter(entry => entry.browser).length, querySites: sites.filter(site => site.queryCommands > 0).length, queryCommands: records.filter(entry => entry.callable).length, publicQueryCommands: policies.size, browserQueryCommands: records.filter(entry => entry.callable && entry.browser).length, configuredSites: notebookSites.filter(site => site.status === 'ready').length };
  return { version: OPENCLI_VERSION, summary, sites, records, notebookSites };
}

export async function describeOpenCliSites(body = {}, packageJsonPath, siteOrigins = {}) {
  const args = validateOpenCliSites(body), catalog = await loadOpenCliCatalog(packageJsonPath, siteOrigins);
  if (!args.site) return { version: catalog.version, summary: catalog.summary, sites: catalog.sites, notebookSites: catalog.notebookSites };
  const commands = catalog.records.filter(entry => entry.site === args.site && (!args.command || entry.command === args.command));
  if (!commands.length) throw invalid('此 OpenCLI 网站或命令不在内置清单内。');
  return { version: catalog.version, summary: catalog.summary, site: args.site, sites: catalog.sites.filter(site => site.site === args.site), commands };
}
