import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { openCliEnvironment } from '../server/opencli.mjs';
import { COMPUTER_USE_PACKAGE, COMPUTER_USE_RUNTIME_FILES } from '../scripts/computer-use-package.mjs';

const source = await readFile(new URL('../scripts/windows-native-verify.mjs', import.meta.url), 'utf8');
const tree = ts.createSourceFile('windows-native-verify.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function find(predicate) {
  let result;
  function visit(node) { if (result) return; if (predicate(node)) result = node; else ts.forEachChild(node, visit); }
  visit(tree); assert.ok(result, 'Required production verifier contract not found'); return result;
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const root = path.resolve('fixture-root');

test('readback accepts exact restored Zavora metadata, rejects corruption and still transforms ordinary manifests', async () => {
  const compare = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'compare');
  const restored = `${COMPUTER_USE_PACKAGE}/package.json`, ordinary = 'node_modules/ordinary/package.json';
  const upstream = Buffer.from('{"name":"fixture","scripts":{"build":"tsc"}}');
  const normalized = Buffer.from('{"name":"fixture"}');
  function harness(corrupt = false) {
    const transforms = [];
    const packed = new Map([[restored, corrupt ? Buffer.from('corrupted metadata') : upstream], [ordinary, normalized]]);
    const context = vm.createContext({ assert, path, root, Buffer, digest, COMPUTER_USE_PACKAGE, COMPUTER_USE_RUNTIME_FILES,
      compared: new Set(), files: [], relative: value => value,
      packedBytes: file => packed.get(file), transform: async file => { transforms.push(file); return normalized; },
      readFile: async file => file.includes('app.asar.unpacked') ? packed.get(file.slice(file.indexOf('app.asar.unpacked') + 18).split(path.sep).join('/')) : upstream,
    });
    vm.runInContext(compare.getText(tree), context);
    return { context, transforms, packed };
  }
  const intact = harness();
  await intact.context.compare(restored); await intact.context.compare(ordinary);
  assert.equal(intact.transforms.length, 1);
  assert.equal(intact.transforms[0], path.join(root, ordinary));
  assert.equal(intact.context.files[0].sha256, digest(upstream));
  assert.equal(intact.context.files[1].sha256, digest(normalized));
  await assert.rejects(harness(true).context.compare(restored), { code: 'ERR_ASSERTION' });
  const changedOrdinary = harness(); changedOrdinary.packed.set(ordinary, upstream);
  await assert.rejects(changedOrdinary.context.compare(ordinary), { code: 'ERR_ASSERTION' });
});

test('readback follows MCP, Zavora and OpenCLI dependency roots and rejects a missing transitive runtime', async () => {
  const functions = ['dependencyRoot', 'sourceDependencyRoot', 'collect'].map(name => find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree)).join('\n');
  const loop = find(node => ts.isForOfStatement(node) && node.statement.getText(tree).includes('await collect(dependencyRoot(name)') && node.expression.getText(tree).includes('@modelcontextprotocol/sdk'));
  const manifests = new Map([
    ['node_modules/@jackwener/opencli', { name: '@jackwener/opencli', version: '1.8.8', dependencies: { '@modelcontextprotocol/sdk': '1.0' } }],
    ['node_modules/@modelcontextprotocol/sdk', { name: '@modelcontextprotocol/sdk', version: '1.0', dependencies: { fixture: '1.0' } }],
    ['node_modules/@zavora-ai/computer-use-mcp', { name: '@zavora-ai/computer-use-mcp', version: '7.4.0', dependencies: { '@modelcontextprotocol/sdk': '1.0' } }],
    ['node_modules/fixture', { name: 'fixture', version: '1.0' }],
  ]);
  async function collect(missing = false) {
    const packed = new Map([...manifests].filter(([file]) => !missing || file !== 'node_modules/fixture'));
    const context = vm.createContext({ assert, path, root, packages: new Map(), packedPaths: [...packed.keys()].map(file => `${file}/package.json`),
      packedBytes: file => JSON.stringify(packed.get(file.slice(0, -13))),
      readFile: async file => JSON.stringify(manifests.get(path.relative(root, path.dirname(file)).split(path.sep).join('/'))),
      exists: async file => manifests.has(path.relative(root, path.dirname(file)).split(path.sep).join('/')),
    });
    vm.runInContext(functions, context);
    await vm.runInContext(`(async()=>{${loop.getText(tree)}})()`, context); return context.packages;
  }
  assert.deepEqual([...await collect()].map(([, entry]) => entry.name).sort(), [...manifests.values()].map(item => item.name).sort());
  await assert.rejects(collect(true), /Missing runtime dependency: fixture/);
});

test('wrong-platform native metadata can remain in ASAR only when its physical binary is absent', async () => {
  const declaration = find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(tree) === 'excludedNativeMetadata'));
  const loop = find(node => ts.isForOfStatement(node) && node.expression.getText(tree) === 'excludedNativeMetadata');
  const packedPaths = ['node_modules/@zavora-ai/computer-use-mcp/computer-use-napi.linux-x64.node', 'node_modules/@zavora-ai/computer-use-mcp/computer-use-napi.darwin-arm64.node', 'node_modules/@zavora-ai/computer-use-mcp/computer-use-napi.win32-arm64.node', 'node_modules/@zavora-ai/computer-use-mcp/computer-use-napi.win32-x64.node'];
  async function check(exists, unpacked = true) {
    const context = vm.createContext({ assert, path, archive: 'fixture.asar', packedPaths, exists: async () => exists, asar: { statFile: () => ({ unpacked }) } });
    await vm.runInContext(`(async()=>{${declaration.getText(tree)}\n${loop.getText(tree)};return excludedNativeMetadata})()`, context);
  }
  await check(false);
  await assert.rejects(check(true), /Wrong-platform native binary entered Windows payload/);
  await assert.rejects(check(false, false), { code: 'ERR_ASSERTION' });
});

test('OpenCLI manager, sites, worker and routes must be physically unpacked', async () => {
  const loop = find(node => ts.isForOfStatement(node) && node.statement.getText(tree).includes('OpenCLI worker closure must be unpacked'));
  const required = [...vm.runInNewContext(loop.expression.getText(tree))];
  for (const file of ['server/opencli-manager.mjs', 'server/opencli-sites.mjs', 'server/opencli-worker.mjs', 'server/opencli-routes.mjs']) assert.ok(required.includes(file));
  const check = (files, unpacked) => vm.runInNewContext(loop.getText(tree), { assert, path, compared: new Set(files), archive: 'fixture.asar', asar: { statFile: () => ({ unpacked }) } });
  assert.doesNotThrow(() => check(required, true));
  assert.throws(() => check(required.filter(file => file !== 'server/opencli-worker.mjs'), true), /Required OpenCLI module missing/);
  assert.throws(() => check(required, false), /OpenCLI worker closure must be unpacked/);
});

test('version-only probes use the actual allowlist, fresh Codex/workspace/temp paths and no inherited credentials', async () => {
  const statements = tree.statements;
  const start = statements.findIndex(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(tree) === 'nativeExe'));
  const end = statements.findIndex((node, index) => index > start && node.getText(tree).startsWith('await Promise.all('));
  assert.ok(start > 0 && end > start);
  const directories = [];
  const inherited = { SystemRoot: 'C:\\Windows', PATH: 'secret-tools', Path: 'alternate-secret-tools', OPENAI_API_KEY: 'fixture-secret', CODEX_HOME: 'host-private', PETPAL_SERVER_TOKEN: 'fixture', ELECTRON_RUN_AS_NODE: '0', NODE_OPTIONS: '--require private.mjs', TEMP: 'host-temp', APPDATA: 'host-appdata' };
  const context = vm.createContext({ assert, path, openCliEnvironment, process: { env: inherited }, payload: path.resolve('payload'), extraction: path.resolve('extraction'), mkdir: async directory => directories.push(directory) });
  const env = await vm.runInContext(`(async()=>{${statements.slice(start, end + 1).map(node => node.getText(tree)).join('\n')}return env;})()`, context);
  for (const name of ['OPENAI_API_KEY', 'PETPAL_SERVER_TOKEN', 'NODE_OPTIONS']) assert.equal(env[name], undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1', 'Version probes intentionally use Electron as the bundled Node runtime');
  assert.equal(env.Path, undefined);
  assert.equal(env.PATH, 'C:\\Windows\\System32;C:\\Windows');
  assert.equal(env.TEMP, env.TMP);
  assert.notEqual(env.TEMP, inherited.TEMP); assert.notEqual(env.CODEX_HOME, inherited.CODEX_HOME);
  assert.ok(directories.includes(env.CODEX_HOME)); assert.ok(directories.includes(env.TEMP));
  assert.ok(directories.some(directory => directory.endsWith(path.sep + 'workspace')));
  assert.equal(inherited.CODEX_HOME, 'host-private');
});
