import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CODEX_CATALOG_SHA256, CODEX_CATALOG_SOURCE_FILES, codexApprovalCatalog, codexToml, defaultCodexConfig, patchCodexConfig, prepareCodexRuntime } from '../server/codex-config.mjs';

const sourceUrl = new URL('../server/native/codex-review/models-0.143.0.json', import.meta.url);

test('fixed official 0.143 catalog removes only the preferred automatic reviewer and preserves every other field', async () => {
  const bytes = await readFile(sourceUrl), source = JSON.parse(bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), CODEX_CATALOG_SHA256);
  const next = codexApprovalCatalog(bytes);
  assert.deepEqual(next, { ...source, models: source.models.filter(model => model.slug !== 'codex-auto-review') });
  assert.equal(source.models.length, 6); assert.equal(next.models.length, 5);
  assert.equal(next.models.some(model => /qwen/i.test(model.slug)), false, 'unknown custom models must keep native fallback metadata');
  assert.equal(next.models.some(model => model.auto_review_model_override), false);
  const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
  assert.throws(() => codexApprovalCatalog(changed), /校验失败/);
  assert.throws(() => codexApprovalCatalog(Buffer.from(JSON.stringify(next))), /校验失败/);
  assert.throws(() => codexApprovalCatalog(bytes.toString()), /校验失败/);
});

test('catalog provenance and retained Apache license describe the exact original bytes and pinned source', async () => {
  const provenance = JSON.parse(await readFile(new URL('../server/native/codex-review/PROVENANCE.json', import.meta.url)));
  assert.equal(provenance.version, '0.143.0'); assert.equal(provenance.commit, 'c4d748f586a84a3ed5b6aceb82e9a1db4abb1cda');
  assert.equal(provenance.license, 'Apache-2.0'); assert.equal(provenance.sources.length, 2);
  const sums = await readFile(new URL('../server/native/codex-review/SHA256SUMS', import.meta.url), 'utf8');
  for (const entry of provenance.sources) {
    const bytes = await readFile(new URL('../server/native/codex-review/' + entry.file, import.meta.url));
    assert.equal(bytes.length, entry.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(entry.url, `https://raw.githubusercontent.com/openai/codex/${provenance.commit}/${entry.source}`);
    assert.ok(sums.includes(`${entry.sha256}  ${entry.file}\n`));
  }
  assert.match(await readFile(new URL('../server/native/codex-review/LICENSE', import.meta.url), 'utf8'), /Apache License/);
  assert.equal(CODEX_CATALOG_SOURCE_FILES.length, 4);
});

test('only API private runtime installs the filtered startup catalog and host mode does not change native reviewer configuration', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'petpal-review-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const api = patchCodexConfig(defaultCodexConfig(), { mode: 'api', model: 'qwen3.8flash', baseUrl: 'http://127.0.0.1:9234/v1', apiKey: 'fixture-key' });
  const runtime = await prepareCodexRuntime(api, root), file = path.join(runtime.env.CODEX_HOME, 'approval-models.json');
  const catalog = JSON.parse(await readFile(file)), contents = await readFile(path.join(runtime.env.CODEX_HOME, 'config.toml'), 'utf8');
  assert.deepEqual(catalog, codexApprovalCatalog(await readFile(sourceUrl)));
  assert.ok(contents.includes(`model_catalog_json = ${JSON.stringify(file)}`));
  assert.doesNotMatch(contents, /review_model|fixture-key/); assert.equal(api.model, 'qwen3.8flash');
  assert.equal(contents, codexToml(api, { modelCatalogPath: file }));
  const host = defaultCodexConfig(), hostRuntime = await prepareCodexRuntime(host, root);
  assert.doesNotMatch(await readFile(path.join(hostRuntime.env.CODEX_HOME, 'config.toml'), 'utf8'), /model_catalog_json|review_model/);
  await assert.rejects(stat(path.join(hostRuntime.env.CODEX_HOME, 'approval-models.json')), error => error.code === 'ENOENT');
  assert.doesNotMatch(codexToml(host, { modelCatalogPath: file }), /model_catalog_json/);
  for (const modelCatalogPath of ['relative.json', '\x00bad', 42]) assert.throws(() => codexToml(api, { modelCatalogPath }), /绝对路径/);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});
