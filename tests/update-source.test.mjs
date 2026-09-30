import test from 'node:test';
import assert from 'node:assert/strict';
import { validateServerManifestUrl, validateServerAssetUrl, validateServerRedirect } from '../server/update-source.mjs';

const manifest = 'https://updates.example.test:44318/updates/stable/petpal-update.json';
const asset = 'https://updates.example.test:44318/updates/stable/v0.10.0/PetPal-Windows+x64.exe';

test('server manifest URLs require the shared HTTPS filename/path contract and support explicit ports', () => {
  assert.equal(validateServerManifestUrl(manifest), manifest);
  assert.equal(validateServerManifestUrl('HTTPS://UPDATES.EXAMPLE.TEST:443/petpal-update.json'), 'https://updates.example.test/petpal-update.json');
  assert.throws(() => validateServerManifestUrl(manifest.replace(':44318', ':0')), { status: 400 });
  for (const value of [null, {}, '', 'http://updates.example.test/petpal-update.json', '//updates.example.test/petpal-update.json', 'https://updates.example.test', manifest + '?', manifest + '?token=private', manifest + '#', manifest.replace('updates.example.test', 'user:private@updates.example.test'), manifest.replace('updates.example.test', '@updates.example.test'), manifest.replace('petpal-update.json', 'latest.json'), manifest.replace('petpal-update.json', 'PetPal-update.json'), manifest + '/', manifest.replace('/stable/', '//stable/'), manifest.replace('/stable/', '/./stable/'), manifest.replace('/stable/', '/other/../stable/'), manifest.replace('/stable/', '/%73table/'), manifest.replace('/stable/', '/%2e%2e/stable/'), manifest.replace('/stable/', '/%252e%252e/stable/'), manifest.replace('/stable/', '/%2fstable/'), manifest.replace('/stable/', '/%5cstable/'), manifest.replace('/stable/', '/.stable/'), manifest.replace('/stable/', '/中文/'), manifest.replace('/stable/', '/stable\\/'), manifest + '\n']) {
    assert.throws(() => validateServerManifestUrl(value), error => error.status === 400 && !/private/.test(error.message));
  }
});

test('server assets stay within the exact manifest origin and directory, including child directories', () => {
  assert.equal(validateServerAssetUrl(asset, manifest), asset);
  assert.equal(validateServerAssetUrl('https://updates.example.test:44318/updates/stable/PetPal.apk', manifest), 'https://updates.example.test:44318/updates/stable/PetPal.apk');
  assert.equal(validateServerAssetUrl('https://updates.example.test:44318/PetPal.apk', 'https://updates.example.test:44318/petpal-update.json'), 'https://updates.example.test:44318/PetPal.apk');
  for (const value of [asset.replace(':44318', ':44319'), asset.replace('updates.example.test', 'foreign.example.test'), asset.replace('/stable/', '/stable-other/'), asset.replace('/stable/', '/other/'), asset.replace('/v0.10.0/', '/v0.10.0/../../stable/'), asset.replace('/v0.10.0/', '/%2e%2e/'), asset.replace('/v0.10.0/', '/%252e%252e/'), asset.replace('/v0.10.0/', '/%2fv0.10.0/'), asset.replace('/v0.10.0/', '//v0.10.0/'), asset.replace('/v0.10.0/', '/.hidden/'), asset + '?private=token', asset + '#', asset.replace('https://', 'http://')]) assert.throws(() => validateServerAssetUrl(value, manifest), { status: 400 });
});

test('server redirects validate raw Location before URL resolution and never change origin or directory', () => {
  assert.equal(validateServerRedirect(manifest, 'archive/petpal-update.json', manifest), 'https://updates.example.test:44318/updates/stable/archive/petpal-update.json');
  assert.equal(validateServerRedirect(asset, 'PetPal-Windows.exe', manifest), 'https://updates.example.test:44318/updates/stable/v0.10.0/PetPal-Windows.exe');
  assert.equal(validateServerRedirect(asset, '/updates/stable/PetPal.apk', manifest), 'https://updates.example.test:44318/updates/stable/PetPal.apk');
  for (const value of [asset.replace(':44318', ':44319'), 'https://foreign.example.test/updates/stable/PetPal.exe', '//updates.example.test:44318/updates/stable/PetPal.exe', '/outside/PetPal.exe', '/updates/stable-other/PetPal.exe', '/updates/stable/../stable/PetPal.exe', '../PetPal.exe', './PetPal.exe', '%2e%2e/PetPal.exe', '%252e%252e/PetPal.exe', 'dir//PetPal.exe', 'dir\\PetPal.exe', 'PetPal.exe?', 'PetPal.exe#', 'https://user:private@updates.example.test:44318/updates/stable/PetPal.exe']) assert.throws(() => validateServerRedirect(asset, value, manifest), error => error.status === 502 && !/private/.test(error.message));
  assert.throws(() => validateServerRedirect('https://foreign.example.test/PetPal.exe', asset, manifest), { status: 502 });
});
