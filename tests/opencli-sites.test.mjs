import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describeOpenCliSites, loadOpenCliCatalog, openCliQueryPolicy, validateOpenCliSites, validateOpenCliQuery } from '../server/opencli-sites.mjs';

test('pinned inventory separates 179 namespaces from 12 reviewed query sites', async () => {
  const catalog = await loadOpenCliCatalog();
  assert.equal(catalog.version, '1.8.8');
  assert.deepEqual(catalog.summary, { adapterNamespaces: 179, totalCommands: 1366, readCommands: 1009, writeCommands: 357, browserCommands: 1042, querySites: 12, queryCommands: 23 });
  const bilibili = catalog.sites.find(site => site.site === 'bilibili');
  assert.equal(bilibili.queryCommands, 0); assert.equal(bilibili.needsBrowserBridge, true);
  assert.equal(catalog.sites.find(site => site.site === 'codex').local, true);
  const details = await describeOpenCliSites({ site: 'npm', command: 'package' });
  assert.equal(details.commands[0].callable, true); assert.equal(details.commands[0].inputSchema.additionalProperties, false);
  const browser = await describeOpenCliSites({ site: 'bilibili', command: 'search' });
  assert.equal(browser.commands[0].callable, false); assert.equal(browser.commands[0].inputSchema, undefined);
});

test('inventory accepts fixed identifiers only and rejects unknown entries', async () => {
  assert.deepEqual(validateOpenCliSites(), {});
  for (const value of [null, [], { command: 'search' }, { site: '../../home' }, { site: 'npm', source: 'plugins' }, { site: 'npm', command: 'search;echo' }]) assert.throws(() => validateOpenCliSites(value));
  await assert.rejects(describeOpenCliSites({ site: 'unknown-site' }), /不在内置清单/);
});

test('query accepts reviewed schemas and preserves explicit typed bounds', () => {
  assert.deepEqual(validateOpenCliQuery({ site: 'npm', command: 'package', arguments: { name: '@jackwener/opencli' } }), { site: 'npm', command: 'package', arguments: { name: '@jackwener/opencli' } });
  assert.deepEqual(validateOpenCliQuery({ site: '36kr', command: 'news' }).arguments, { limit: 5 });
  const wiki = validateOpenCliQuery({ site: 'wikipedia', command: 'search', arguments: { query: ' 软件 ', lang: 'zh', limit: 3 } });
  assert.deepEqual(wiki.arguments, { query: '软件', limit: 3, lang: 'zh' });
  assert.equal(openCliQueryPolicy('arxiv', 'paper').modulePath, 'arxiv/paper.js');
});

test('query refuses plugin paths, credentials, write/browser commands and hostname injection', () => {
  for (const value of [
    null, [], { site: 'bilibili', command: 'search', arguments: { query: 'cat' } },
    { site: 'confluence', command: 'search', arguments: { cql: 'type=page' } },
    { site: 'npm', command: 'package', arguments: { name: 'react', token: 'secret' } },
    { site: 'npm', command: 'package', arguments: { name: 'react' }, modulePath: '../../evil' },
    { site: 'npm', command: 'package', arguments: { name: 'https://localhost/' } },
    { site: 'wikipedia', command: 'summary', arguments: { title: 'Cat', lang: 'evil.test/..' } },
    { site: 'v2ex', command: 'topic', arguments: { id: '../admin' } },
    { site: 'hackernews', command: 'read', arguments: { id: '1234', depth: 3 } },
    { site: 'mdn', command: 'search', arguments: { query: 'fetch', locale: 'evil' } },
    { site: 'steam', command: 'search', arguments: { query: 'cat', limit: '3' } },
    { site: '36kr', command: 'news', arguments: { limit: 0 } },
    { site: 'arxiv', command: 'paper', arguments: { id: 'file:///etc/passwd' } },
    { site: 'npm', command: 'search', arguments: { query: 'a'.repeat(301) } },
    { site: 'npm', command: 'search', arguments: { query: 'a\nSECRET' } },
  ]) assert.throws(() => validateOpenCliQuery(value));
  const schema = openCliQueryPolicy('npm', 'package'); schema.modulePath = 'evil';
  assert.equal(openCliQueryPolicy('npm', 'package').modulePath, 'npm/package.js');
});

test('worker excludes CLI entry and user discovery and validates fixed module metadata', async () => {
  const source = await readFile(new URL('../server/opencli-worker.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /import\([^)]*(?:main\.js|discovery\.js)|discoverPlugins\(|discoverClis\(/);
  assert.match(source, /entry\.modulePath !== policy\.modulePath/);
  assert.match(source, /command\.browser !== false/);
  assert.match(source, /hosts\.has\(url\.hostname\)/);
  assert.match(source, /authorization.*cookie.*proxy-authorization/);
  assert.doesNotMatch(source, /process\.exit\(/);
  assert.match(source, /finally \{ clearTimeout\(deadline\); \}/);
});
