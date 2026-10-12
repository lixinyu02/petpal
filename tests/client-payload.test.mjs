import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { copyClientPayload, includeClientPayload, listClientPayloadFiles } from '../scripts/client-payload.mjs';

test('real client snapshot excludes every published installer cache without touching web downloads or nearby assets', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-client-payload-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(directory, { recursive: true, force: true });
  });
  const source = path.join(directory, 'source'), target = path.join(directory, 'client');
  const keep = ['dist/index.html', 'dist/assets/ui.js', 'dist/avatars/akari/idle.webp',
    'dist/downloads-help.txt', 'dist/downloads-backup/asset.js', 'server/downloads.mjs', 'desktop/main.cjs'];
  const cache = ['dist/downloads/PetPal-Windows.exe', 'dist/downloads/PetPal-Ubuntu.tar.gz',
    'dist/downloads/PetPal-Android.apk', 'dist/downloads/updates/latest.json'];
  for (const relative of [...keep, ...cache]) {
    const file = path.join(source, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `fixture ${relative}`);
  }
  await copyClientPayload(source, target);
  for (const relative of keep) assert.deepEqual(await readFile(path.join(target, relative)), await readFile(path.join(source, relative)));
  await assert.rejects(stat(path.join(target, 'dist/downloads')), { code: 'ENOENT' });
  for (const relative of cache) assert.equal(await readFile(path.join(source, relative), 'utf8'), `fixture ${relative}`, 'web cache is retained');
  const expected = keep.filter(file => file.startsWith('dist/')).sort();
  assert.deepEqual((await listClientPayloadFiles(source, 'dist')).sort(), expected);
  assert.deepEqual((await listClientPayloadFiles(target, 'dist')).sort(), expected);
  assert.equal(includeClientPayload('dist\\downloads\\updates\\latest.json'), false);
  assert.equal(includeClientPayload('server/downloads.mjs'), true);
});

test('download cache exclusion leaves the existing credentials, runtime, and Windows-binary rejection intact', async () => {
  const source = await readFile(new URL('../scripts/linux-package.mjs', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('linux-package.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let guard;
  function visit(node) {
    if (ts.isIfStatement(node) && node.thenStatement.getText(parsed).includes('Source snapshot unexpectedly contains')) guard = node;
    ts.forEachChild(node, visit);
  }
  visit(parsed); assert.ok(guard, 'The actual snapshot security guard must remain present');
  for (const relative of ['server/.data/state.json', 'server/private/credential.json', 'desktop/.env', 'desktop/auth.json',
    'desktop/token', 'dist/.preview/index.html', 'dist/evidence/report.txt', 'dist/assets/helper.exe', 'dist/assets/helper.dll']) {
    assert.equal(includeClientPayload(relative), true, 'only dist/downloads is excluded before security auditing');
    assert.throws(() => vm.runInNewContext(guard.getText(parsed), { sourceFiles: [relative] }), /Source snapshot unexpectedly contains/);
  }
  assert.doesNotThrow(() => vm.runInNewContext(guard.getText(parsed), { sourceFiles: ['dist/assets/ui.js', 'server/downloads.mjs'] }));
});
