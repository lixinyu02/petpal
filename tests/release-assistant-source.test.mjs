import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { COMPUTER_USE_PACKAGE, COMPUTER_USE_RUNTIME_FILES } from '../scripts/computer-use-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const assistantFiles = ['server/conversation-organization.mjs', 'server/chat-assistant.mjs',
  'server/automation-schema.mjs', 'server/automation-tools.mjs', 'server/automations.mjs'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const originals = new Map(await Promise.all(assistantFiles.map(async file => [file, await readFile(path.join(root, file))])));
async function parsed(relative) {
  const source = await readFile(path.join(root, relative), 'utf8');
  return ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}
function find(tree, predicate) {
  let result;
  function visit(node) { if (result) return; if (predicate(node)) result = node; else ts.forEachChild(node, visit); }
  visit(tree); assert.ok(result, 'Production package gate was not found'); return result;
}
function linuxPolicy(tree) {
  const declarations = tree.statements.filter(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => ['requiredApplicationSource', 'isApplicationSource'].includes(item.name.getText(tree))));
  const additions = tree.statements.filter(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === 'requiredApplicationSource.push');
  const code = [...declarations, ...additions].map(node => node.getText(tree)).join('\n');
  return vm.runInNewContext(code + '\n({ requiredApplicationSource, isApplicationSource: typeof isApplicationSource === "undefined" ? undefined : isApplicationSource });');
}
const changed = bytes => { const copy = Buffer.from(bytes); copy[0] ^= 1; return copy; };

test('Windows readback rejects omitted assistant modules and byte-corrupted final ASAR members', async () => {
  const tree = await parsed('scripts/windows-native-verify.mjs');
  const gate = find(tree, node => ts.isForOfStatement(node) && node.statement.getText(tree).includes('Required assistant module missing'));
  const required = [...vm.runInNewContext(gate.expression.getText(tree))];
  const compare = find(tree, node => ts.isFunctionDeclaration(node) && node.name?.text === 'compare');
  function harness(packed) {
    const context = vm.createContext({ assert, path, root, Buffer, digest, COMPUTER_USE_PACKAGE, COMPUTER_USE_RUNTIME_FILES,
      compared: new Set(), files: [], relative: value => value, transform: async () => null,
      packedBytes: file => { if (!packed.has(file)) throw new Error('Missing ASAR member: ' + file); return packed.get(file); },
      readFile: async file => originals.get(path.relative(root, file).split(path.sep).join('/')) });
    vm.runInContext(compare.getText(tree), context); return context;
  }
  const intact = harness(originals);
  for (const file of assistantFiles) {
    assert.ok(required.includes(file), 'Assistant gate omits ' + file);
    await intact.compare(file);
    const missing = new Map(originals); missing.delete(file);
    await assert.rejects(harness(missing).compare(file), error => error.message.includes(file));
    const corrupted = new Map(originals); corrupted.set(file, changed(originals.get(file)));
    await assert.rejects(harness(corrupted).compare(file), error => error.code === 'ERR_ASSERTION' && error.message.includes('content differs'));
    assert.throws(() => vm.runInNewContext(gate.getText(tree), { assert, compared: new Set(required.filter(item => item !== file)) }),
      error => error.message.includes('Required assistant module missing: ' + file));
  }
  assert.deepEqual([...intact.compared], assistantFiles);
});

test('final receipts reject missing or altered assistant hashes in frozen inputs, EXE readback and native smoke', async () => {
  const tree = await parsed('scripts/windows-native-finalize.mjs');
  const declaration = find(tree, node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => item.name.getText(tree) === 'requiredExecutionSource'));
  const loop = find(tree, node => ts.isForOfStatement(node) && node.expression.getText(tree) === 'requiredExecutionSource');
  const required = [...vm.runInNewContext(declaration.getText(tree) + '\nrequiredExecutionSource;')];
  const records = await Promise.all(required.map(async file => ({ path: file, sha256: digest(await readFile(path.join(root, file))) })));
  const check = fixtures => vm.runInNewContext(declaration.getText(tree) + '\n' + loop.getText(tree), {
    assert, freeze: fixtures.freeze, asar: { files: fixtures.packed }, runtime: { portableSmoke: { bundleFiles: fixtures.smoke } } });
  assert.doesNotThrow(() => check({ freeze: records, packed: records, smoke: records }));
  for (const file of assistantFiles) {
    assert.ok(required.includes(file), 'Final receipt gate omits ' + file);
    for (const group of ['freeze', 'packed', 'smoke']) for (const mutation of ['missing', 'changed']) {
      const fixtures = { freeze: records, packed: records, smoke: records };
      fixtures[group] = mutation === 'missing' ? records.filter(item => item.path !== file)
        : records.map(item => item.path === file ? { ...item, sha256: digest(changed(originals.get(file))) } : item);
      assert.throws(() => check(fixtures), error => error.code === 'ERR_ASSERTION' && error.message.includes(file));
    }
  }
});

test('Linux builder refuses an incomplete source snapshot and changed assistant bytes after packaging', async () => {
  const tree = await parsed('scripts/linux-package.mjs'), { requiredApplicationSource: required } = linuxPolicy(tree);
  const sourceGate = find(tree, node => ts.isForOfStatement(node) && node.statement.getText(tree).includes('Required application source is absent'));
  const payloadGate = find(tree, node => ts.isForOfStatement(node) && node.expression.getText(tree) === 'requiredApplicationSource'
    && node.statement.getText(tree).includes('Builder changed application source'));
  const sourceReceipt = required.map(file => ({ path: file, sha256: originals.has(file) ? digest(originals.get(file)) : digest(file) }));
  async function verify(packed) {
    const context = vm.createContext({ path, requiredApplicationSource: required, sourceReceipt, packagedApp: '/fixture',
      stat: async file => { const present = packed.has(path.relative('/fixture', file).split(path.sep).join('/')); return { isFile: () => present }; },
      digest: async file => digest(packed.get(path.relative('/fixture', file).split(path.sep).join('/'))) });
    await vm.runInContext('(async()=>{' + payloadGate.getText(tree) + '})()', context);
  }
  const complete = new Map(required.map(file => [file, originals.get(file) || Buffer.from(file)]));
  await verify(complete);
  for (const file of assistantFiles) {
    assert.ok(required.includes(file), 'Linux builder gate omits ' + file);
    assert.throws(() => vm.runInNewContext(sourceGate.getText(tree), { requiredApplicationSource: required, sourceFiles: required.filter(item => item !== file) }),
      error => error.message.includes('Required application source is absent: ' + file));
    const missing = new Map(complete); missing.delete(file);
    await assert.rejects(verify(missing), error => error.message.includes('Required packaged application source is absent: ' + file));
    const corrupted = new Map(complete); corrupted.set(file, changed(originals.get(file)));
    await assert.rejects(verify(corrupted), error => error.message.includes('Builder changed application source: ' + file));
  }
});

test('Linux verifier rejects omitted assistant payloads even when receipts omit them and rejects byte hash mismatches', async () => {
  const tree = await parsed('scripts/linux-verify.mjs'), policy = linuxPolicy(tree);
  const block = find(tree, node => ts.isIfStatement(node) && node.expression.getText(tree) === '!manifest');
  const comparisons = block.elseStatement.statements.filter(node => ts.isForOfStatement(node)
    && (/App payload hash mismatch|Manifest app member missing|Required application source missing/.test(node.getText(tree))));
  assert.equal(comparisons.length, 3);
  const records = policy.requiredApplicationSource.map(file => ({ path: file, sha256: originals.has(file) ? digest(originals.get(file)) : digest(file) }));
  function verify(payload, receipt = records) {
    const failures = [];
    vm.runInNewContext(comparisons.map(node => node.getText(tree)).join('\n'), { failures, frontend: [], applicationSource: payload,
      manifest: { sourceReceipt: receipt }, ...policy }); return failures;
  }
  assert.deepEqual(verify(records), []);
  for (const file of assistantFiles) {
    assert.ok(policy.requiredApplicationSource.includes(file), 'Linux verifier gate omits ' + file);
    const omitted = records.filter(item => item.path !== file);
    assert.ok(verify(omitted, omitted).includes('Required application source missing: ' + file));
    assert.ok(verify(omitted).includes('Manifest app member missing: ' + file));
    const corrupted = records.map(item => item.path === file ? { ...item, sha256: digest(changed(originals.get(file))) } : item);
    assert.ok(verify(corrupted).includes('App payload hash mismatch: ' + file));
    assert.ok(verify(corrupted).includes('Manifest app member missing: ' + file));
  }
});
