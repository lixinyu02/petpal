import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { restoreTargetConnection } from '../src/auth/connection-targets.mjs';

const native = { url: 'http://127.0.0.1:60002', token: 'native-owner-secret' };

test('remote target restoration never rewrites destination or replaces credentials with local owner', () => {
  for (const credentialKind of ['session', 'pairing', 'none']) {
    const saved = { url: 'https://remote.example', token: credentialKind === 'none' ? '' : 'remote-token', credentialKind, target: 'remote' };
    assert.deepEqual(restoreTargetConnection(saved, native), { target: 'remote', credentialKind, connection: { url: saved.url, token: saved.token } });
  }
  const saved = { url: native.url, token: 'explicit-remote-session', credentialKind: 'session', target: 'remote' };
  assert.equal(restoreTargetConnection(saved, native).connection.token, 'explicit-remote-session');
  assert.equal(restoreTargetConnection(saved, native).target, 'remote');
});

test('explicit local profiles rebind only the matching loopback host while preserving member identity or logout', () => {
  for (const [credentialKind, token, expected] of [['session', 'local-member', 'local-member'], ['pairing', 'old-pairing', native.token], ['none', '', '']]) {
    const saved = { url: 'http://127.0.0.1:60001', token, credentialKind, target: 'local' };
    assert.deepEqual(restoreTargetConnection(saved, native), { target: 'local', credentialKind, connection: { url: native.url, token: expected } });
  }
});

test('damaged local profiles cannot bind a remote token or wrong loopback hostname to native owner', () => {
  for (const url of ['https://remote.example', 'http://remote.example', 'http://localhost:60001', 'http://[::1]:60001', 'https://127.0.0.1:60001', 'http://user:pass@127.0.0.1:60001', 'not a url']) {
    assert.equal(restoreTargetConnection({ target: 'local', url, token: 'different-server-session', credentialKind: 'session' }, native), null, url);
  }
  for (const target of ['other', '', null, true]) assert.equal(restoreTargetConnection({ target, url: native.url, token: 'stale', credentialKind: 'session' }, native), null);
});

test('unknown credential kinds fail closed instead of upgrading to native pairing credentials', () => {
  for (const credentialKind of ['owner', 'future-kind', null, true]) {
    assert.equal(restoreTargetConnection({ target: 'local', url: native.url, token: 'member-token', credentialKind }, native), null);
  }
});

test('legacy exact-origin profiles retain their credential kind and malformed records are ignored', () => {
  const saved = { url: native.url, token: 'local-member', credentialKind: 'session' };
  assert.deepEqual(restoreTargetConnection(saved, native), { target: 'local', credentialKind: 'session', connection: { url: native.url, token: 'local-member' } });
  assert.deepEqual(restoreTargetConnection({ url: 'https://older.example', token: 'pairing' }, native), { target: 'remote', credentialKind: 'pairing', connection: { url: 'https://older.example', token: 'pairing' } });
  for (const value of [null, [], {}, { url: 7, token: 'x' }, { url: native.url, token: 7 }]) assert.equal(restoreTargetConnection(value, native), null);
});

test('asynchronous native target discovery cannot overwrite a later logout or target selection', async t => {
  const originals = new Map(['window', 'location', 'history', 'sessionStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const install = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const dataModule = value => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`;
  const nativeModule = dataModule(await fs.readFile(new URL('../src/auth/native-fetch.ts', import.meta.url), 'utf8'));
  const source = (await fs.readFile(new URL('../src/api.ts', import.meta.url), 'utf8'))
    .replaceAll("'./auth/native-fetch'", JSON.stringify(nativeModule))
    .replaceAll("'./avatar/speech-stream.mjs'", JSON.stringify(new URL('../src/avatar/speech-stream.mjs', import.meta.url).href))
    .replaceAll("'./avatar/speech-emotion.mjs'", JSON.stringify(new URL('../src/avatar/speech-emotion.mjs', import.meta.url).href))
    .replaceAll("'./auth/request-scope.mjs'", JSON.stringify(new URL('../src/auth/request-scope.mjs', import.meta.url).href))
    .replaceAll("'./auth/connection-targets.mjs'", JSON.stringify(new URL('../src/auth/connection-targets.mjs', import.meta.url).href));
  const disk = new Map(), window = new EventTarget();
  window.speechSynthesis = { cancel() {} };
  install('window', window); install('location', { origin: native.url, hash: '', pathname: '/', search: '' }); install('history', { replaceState() {} });
  install('sessionStorage', { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value), removeItem: key => disk.delete(key) });
  install('fetch', async () => new Response('{}'));
  try {
    for (const action of ['logout', 'remote-selection']) await t.test(action, async () => {
      disk.clear(); window.petpal = { connection: async () => native };
      const api = await import(dataModule(source + `\n// instance ${action}`)); await api.initConnection();
      api.setConnection({ url: native.url, token: 'previous-local-member' }, 'session', 'local');
      api.setConnection({ url: 'https://remote.example', token: 'remote-member' }, 'session', 'remote');
      let release; window.petpal.connection = () => new Promise(resolve => { release = resolve; });
      const pending = api.switchExecutionTarget('local');
      if (action === 'logout') api.logout(); else await api.switchExecutionTarget('remote');
      const rejected = assert.rejects(pending, api.SessionChangedError); release(native); await rejected;
      assert.equal(api.getExecutionTarget(), 'remote');
      assert.deepEqual(api.getConnection(), { url: 'https://remote.example', token: action === 'logout' ? '' : 'remote-member' });
    });
  } finally {
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
