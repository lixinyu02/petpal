import { listenFixture } from './helpers/loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPetServer } from '../server/app.mjs';

const { readDesktopServiceSettings } = createRequire(import.meta.url)('../desktop/service-settings.cjs');
const example = 'http://gateway.example:8080';
async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-desktop-settings-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.join(tmpdir(), 'petpal-desktop-settings-')));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, file: path.join(directory, 'service-settings.json') };
}
const invalidSettings = error => error.code === 'PETPAL_DESKTOP_SERVICE_SETTINGS' && /service-settings\.json/.test(error.message);

test('missing desktop settings explicitly disable external HTTP without creating any file', async t => {
  const f = await setup(t);
  assert.deepEqual(await readDesktopServiceSettings(f.directory, { env: {} }), { codexHttpOrigins: '' });
  assert.deepEqual(await readdir(f.directory), []);
});

test('desktop loads only the fixed UTF-8 settings file, including Windows BOM', async t => {
  const f = await setup(t), value = `${example},http://models.example:8081`;
  await writeFile(f.file, '\ufeff' + JSON.stringify({ codexHttpOrigins: value }));
  assert.deepEqual(await readDesktopServiceSettings(f.directory, { env: {} }), { codexHttpOrigins: value });
  await writeFile(f.file, JSON.stringify({ codexHttpOrigins: '' }));
  assert.deepEqual(await readDesktopServiceSettings(f.directory, { env: {} }), { codexHttpOrigins: '' });
});

test('an explicit environment value including empty takes precedence without reading the file', async t => {
  const f = await setup(t);
  await writeFile(f.file, 'malformed private file');
  for (const value of [example, '']) assert.deepEqual(
    await readDesktopServiceSettings(f.directory, { env: { PETPAL_CODEX_HTTP_ORIGINS: value } }), { codexHttpOrigins: value });
  await writeFile(f.file, JSON.stringify({ codexHttpOrigins: example }));
  await assert.rejects(readDesktopServiceSettings(f.directory, { env: { PETPAL_CODEX_HTTP_ORIGINS: 'http://gateway.example/v1' } }),
    error => error.code === 'PETPAL_DESKTOP_SERVICE_SETTINGS' && /PETPAL_CODEX_HTTP_ORIGINS/.test(error.message));
  assert.deepEqual(await readDesktopServiceSettings(f.directory, { env: { PETPAL_CODEX_HTTP_ORIGINS: undefined } }), { codexHttpOrigins: example });
});

test('settings reject unsupported fields and invalid origins without echoing private content', async t => {
  const f = await setup(t), marker = 'fixture-private-content';
  const invalid = [null, [], {}, 'text', { codexHttpOrigins: [] }, { codexHttpOrigins: 1 },
    { codexHttpOrigins: example, apiKey: marker }, { codexHttpOrigins: example, arbitraryPath: marker },
    ...['http://gateway.example/', 'http://gateway.example/v1', 'https://gateway.example', `http://${marker}@gateway.example`, 'http://*.example', 'http://gateway.example:70000', 'http://gateway.example,'].map(codexHttpOrigins => ({ codexHttpOrigins }))];
  for (const settings of invalid) {
    await writeFile(f.file, JSON.stringify(settings));
    await assert.rejects(readDesktopServiceSettings(f.directory, { env: {} }), error => invalidSettings(error) && !error.message.includes(marker));
  }
});

test('malformed, oversized, non-UTF-8 and non-file settings fail clearly and preserve bytes', async t => {
  const f = await setup(t), marker = 'fixture-private-content';
  for (const bytes of [Buffer.from(`{"codexHttpOrigins": "${marker}`), Buffer.from([0xff, 0xfe, 0x80]), Buffer.alloc(64 * 1024 + 1, 32)]) {
    await writeFile(f.file, bytes);
    await assert.rejects(readDesktopServiceSettings(f.directory, { env: {} }), error => invalidSettings(error) && !error.message.includes(marker));
    assert.deepEqual(await readFile(f.file), bytes);
  }
  const nested = path.join(f.directory, 'nested');
  await mkdir(path.join(nested, 'service-settings.json'), { recursive: true });
  await assert.rejects(readDesktopServiceSettings(nested, { env: {} }), invalidSettings);
});

test('persisted desktop HTTP configuration reloads from file, but explicit empty env fails closed', async t => {
  const f = await setup(t);
  await writeFile(f.file, JSON.stringify({ codexHttpOrigins: example }));
  const options = { dataDir: path.join(f.directory, 'data'), token: 'desktop-settings-fixture-token',
    desktopTools: { async close() {} }, codexFactory: () => ({ async close() {} }) };
  let app = await createPetServer({ ...options, ...await readDesktopServiceSettings(f.directory, { env: {} }) });
  t.after(() => app.close());
  await listenFixture(app.server);
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/codex/config`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'api', baseUrl: `${example}/v1`, model: 'fixture-model', apiKey: '' }),
  });
  assert.equal(response.status, 200);
  await app.close();
  app = await createPetServer({ ...options, ...await readDesktopServiceSettings(f.directory, { env: {} }) });
  await app.close();
  const before = await readFile(path.join(options.dataDir, 'state.json'));
  await assert.rejects(createPetServer({ ...options, ...await readDesktopServiceSettings(f.directory, { env: { PETPAL_CODEX_HTTP_ORIGINS: '' } }) }), /HTTPS/);
  assert.deepEqual(await readFile(path.join(options.dataDir, 'state.json')), before);
});
