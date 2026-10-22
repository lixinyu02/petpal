import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyOpenUIWebBuild } from '../scripts/verify-openui-web-build.mjs';

const renderer = 'src/openui/OpenUIBlock.tsx';
const defaultManifest = () => ({
  'index.html': { file: 'assets/index-current.js', isEntry: true, imports: ['_shared.js'] },
  '_shared.js': { file: 'assets/shared-current.js', imports: ['_cycle.js'], dynamicImports: [renderer] },
  '_cycle.js': { file: 'assets/cycle-current.js', imports: ['_shared.js'] },
  [renderer]: {
    file: 'assets/OpenUIBlock-current.js', isDynamicEntry: true,
    css: ['assets/openui-current.css'], assets: ['assets/openui-current.svg'],
  },
});

async function fixture(t, { manifest = defaultManifest(), html = '<script type="module" src="/assets/index-current.js"></script>' } = {}) {
  const temporaryRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, 'petpal-openui-web-build-'));
  const write = async (name, contents = '') => {
    const target = path.resolve(directory, name);
    const relative = path.relative(directory, target);
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  };
  t.after(async () => {
    const relative = path.relative(temporaryRoot, path.resolve(directory));
    assert.ok(relative.startsWith('petpal-openui-web-build-') && !relative.includes(path.sep));
    await rm(directory, { recursive: true, force: true });
  });
  if (manifest !== null) {
    await write('.vite/manifest.json', JSON.stringify(manifest));
    for (const chunk of Object.values(manifest)) {
      for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) await write(file, 'fixture asset');
    }
  }
  if (html !== null) await write('index.html', html);
  return { directory, write, remove: name => rm(path.join(directory, name)) };
}

test('the deployed entry reaches a real OpenUI dynamic chunk through shared imports', async t => {
  const f = await fixture(t);
  assert.deepEqual(verifyOpenUIWebBuild(f.directory), {
    entry: 'assets/index-current.js', renderer: 'assets/OpenUIBlock-current.js', modules: 4,
  });
});

test('orphan OpenUI manifest entries and leftover renderer files do not certify an old entry', async t => {
  const manifest = defaultManifest();
  delete manifest['_shared.js'].dynamicImports;
  const f = await fixture(t, { manifest });
  await f.write('assets/OpenUIBlock-previous-release.js', 'leftover renderer');
  assert.throws(() => verifyOpenUIWebBuild(f.directory), /cannot load the OpenUI card renderer/);
});

test('an entry filename in HTML comments or text never certifies an old module script', async t => {
  const f = await fixture(t, {html:'<!-- assets/index-current.js --><p>assets/index-current.js</p><script type="module" src="/assets/index-old.js"></script>'});
  assert.throws(() => verifyOpenUIWebBuild(f.directory), /HTML entry and build manifest disagree/);
});

test('missing referenced modules are rejected before a release is certified', async t => {
  const manifest = defaultManifest();
  manifest['_shared.js'].dynamicImports.push('src/openui/missing-module.tsx');
  const f = await fixture(t, { manifest });
  assert.throws(() => verifyOpenUIWebBuild(f.directory), /references a missing module/);
});

test('every reachable JavaScript, stylesheet and imported asset must exist', async t => {
  for (const name of ['assets/index-current.js', 'assets/shared-current.js', 'assets/OpenUIBlock-current.js', 'assets/openui-current.css', 'assets/openui-current.svg']) {
    await t.test(name, async subtest => {
      const f = await fixture(subtest);
      await f.remove(name);
      assert.throws(() => verifyOpenUIWebBuild(f.directory), /ENOENT|unavailable asset/);
    });
  }
});

test('a renderer manifest entry must actually be a dynamic entry', async t => {
  const manifest = defaultManifest();
  delete manifest[renderer].isDynamicEntry;
  const f = await fixture(t, { manifest });
  assert.throws(() => verifyOpenUIWebBuild(f.directory), /cannot load the OpenUI card renderer/);
});

test('a missing or malformed Vite manifest cannot be mistaken for a verified build', async t => {
  const f = await fixture(t, { manifest: null });
  await f.write('assets/OpenUIBlock-stale.js', 'leftover renderer');
  assert.throws(() => verifyOpenUIWebBuild(f.directory), /ENOENT/);
  await f.write('.vite/manifest.json', '{"index.html":');
  assert.throws(() => verifyOpenUIWebBuild(f.directory), SyntaxError);
});

test('missing entry metadata is rejected even when OpenUI files exist', async t => {
  for (const mode of ['missing-entry', 'not-an-entry']) {
    await t.test(mode, async subtest => {
      const manifest = defaultManifest();
      if (mode === 'missing-entry') delete manifest['index.html'];
      else delete manifest['index.html'].isEntry;
      const f = await fixture(subtest, { manifest });
      assert.throws(() => verifyOpenUIWebBuild(f.directory), /Missing web application entry/);
    });
  }
});

test('the actual HTML must load the same entry declared by the verified graph', async t => {
  const f = await fixture(t, { html: '<script type="module" src="/assets/index-old.js"></script>' });
  await f.write('assets/index-old.js', 'previous frontend entry');
  assert.throws(() => verifyOpenUIWebBuild(f.directory), /HTML entry and build manifest disagree/);
});

test('a manifest without the HTML shell is not a deployable build', async t => {
  const f = await fixture(t, { html: null });
  assert.throws(() => verifyOpenUIWebBuild(f.directory), /ENOENT/);
});

test('reachable directories cannot stand in for asset files', async t => {
  const f = await fixture(t);
  await f.remove('assets/OpenUIBlock-current.js');
  await mkdir(path.join(f.directory, 'assets/OpenUIBlock-current.js'));
  assert.throws(() => verifyOpenUIWebBuild(f.directory), /unavailable asset/);
});

test('manifest references cannot escape the deployment directory', async t => {
  const f = await fixture(t);
  const manifest = defaultManifest();
  manifest[renderer].file = '../outside-renderer.js';
  await f.write('.vite/manifest.json', JSON.stringify(manifest));
  assert.throws(() => verifyOpenUIWebBuild(f.directory), /unavailable asset/);
});
