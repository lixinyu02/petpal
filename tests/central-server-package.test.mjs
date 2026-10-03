import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const centralFiles = ['desktop/central-server.cjs', 'desktop/central-server-ipc.cjs', 'desktop/central-server-smoke.cjs'];
const yaml = createRequire(import.meta.url)('js-yaml');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function parsed(relative) {
  const source = await readFile(new URL('../' + relative, import.meta.url), 'utf8');
  return ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}
function find(tree, predicate) {
  let found;
  function visit(node) { if (found) return; if (predicate(node)) { found = node; return; } ts.forEachChild(node, visit); }
  visit(tree); assert.ok(found, 'Required production source contract was not found'); return found;
}
const stringArray = node => ts.isArrayLiteralExpression(node) && node.elements.every(ts.isStringLiteral);
const evaluate = (node, tree) => [...vm.runInNewContext(node.getText(tree))];

test('Linux and Windows builders ship all central modules present in the real native smoke source receipt', async () => {
  const linux = await parsed('scripts/linux-package.mjs');
  const files = find(linux, node => ts.isPropertyAssignment(node) && node.name.getText(linux) === 'files' && stringArray(node.initializer));
  const linuxFiles = evaluate(files.initializer, linux);
  const windows = yaml.load(await readFile(new URL('../desktop/electron-builder.yml', import.meta.url), 'utf8'));
  const main = await parsed('desktop/main.cjs');
  const smoke = find(main, node => stringArray(node) && node.elements.some(item => item.text === 'desktop/main.cjs') && node.elements.some(item => item.text === 'node_modules/@jackwener/opencli/LICENSE'));
  const smokeFiles = evaluate(smoke, main);
  for (const file of centralFiles) {
    assert.ok(linuxFiles.includes(file), `Ubuntu builder drops ${file}`);
    assert.ok(windows.files.includes(file), `Windows builder drops ${file}`);
    assert.ok(smokeFiles.includes(file), `Native smoke source receipt omits ${file}`);
  }
  assert.equal(linuxFiles.includes('desktop/**'), false, 'Private desktop runtime state must not be pulled in by a broad glob');
});

test('Windows readback hashes every central module and rejects an absent or modified packed member', async () => {
  const tree = await parsed('scripts/windows-native-verify.mjs');
  const loop = find(tree, node => ts.isForOfStatement(node) && stringArray(node.expression) &&
    node.statement.getText(tree).includes('await compare(file)') && node.expression.elements.some(item => item.text === 'desktop/main.cjs'));
  const required = evaluate(loop.expression, tree);
  const compare = find(tree, node => ts.isFunctionDeclaration(node) && node.name?.text === 'compare');
  const source = new Map(await Promise.all(centralFiles.map(async file => [file, await readFile(new URL('../' + file, import.meta.url))])));
  for (const file of centralFiles) assert.ok(required.includes(file), `Windows native byte comparison omits ${file}`);
  function harness(packed) {
    const context = vm.createContext({ assert, path, root, Buffer, digest, relative: value => value,
      packedBytes: file => { if (!packed.has(file)) throw new Error(`Missing fixture ASAR member: ${file}`); return packed.get(file); },
      transform: async () => null, readFile: async file => source.get(path.relative(root, file).split(path.sep).join('/')),
      files: [], compared: new Set() });
    vm.runInContext(compare.getText(tree), context); return context;
  }
  const intact = harness(new Map(source));
  for (const file of centralFiles) await intact.compare(file);
  assert.deepEqual([...intact.compared], centralFiles);
  for (const file of centralFiles) {
    const missing = new Map(source); missing.delete(file);
    await assert.rejects(harness(missing).compare(file), /Missing fixture ASAR member/);
    const corrupted = new Map(source), bytes = Buffer.from(source.get(file)); bytes[0] ^= 1; corrupted.set(file, bytes);
    await assert.rejects(harness(corrupted).compare(file), error => error.code === 'ERR_ASSERTION' && error.message.includes('content differs from frozen source'));
  }
});

test('Windows final receipts require matching central hashes across frozen source, final EXE and native smoke', async () => {
  const tree = await parsed('scripts/windows-native-finalize.mjs');
  const declaration = find(tree, node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(tree) === 'requiredExecutionSource'));
  const loop = find(tree, node => ts.isForOfStatement(node) && node.expression.getText(tree) === 'requiredExecutionSource');
  const required = [...vm.runInNewContext(declaration.getText(tree) + '\nrequiredExecutionSource;')];
  for (const file of centralFiles) assert.ok(required.includes(file), `Final release receipts omit ${file}`);
  const records = await Promise.all(required.map(async file => ({ path: file, sha256: digest(await readFile(new URL('../' + file, import.meta.url))) })));
  const check = (freeze, packed, smoke) => vm.runInNewContext(declaration.getText(tree) + '\n' + loop.getText(tree), {
    assert, freeze, asar: { files: packed }, runtime: { portableSmoke: { bundleFiles: smoke } },
  });
  assert.doesNotThrow(() => check(records, records, records));
  for (const file of centralFiles) for (const group of ['freeze', 'packed', 'smoke']) {
    const fixtures = { freeze: records, packed: records, smoke: records };
    fixtures[group] = records.filter(item => item.path !== file);
    assert.throws(() => check(fixtures.freeze, fixtures.packed, fixtures.smoke), error => error.code === 'ERR_ASSERTION' && error.message.includes(file));
    fixtures[group] = records.map(item => item.path === file ? { ...item, sha256: '0'.repeat(64) } : item);
    assert.throws(() => check(fixtures.freeze, fixtures.packed, fixtures.smoke), error => error.code === 'ERR_ASSERTION' && error.message.includes(file));
  }
});
