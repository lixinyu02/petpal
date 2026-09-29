import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

test('every required Linux source member participates in payload hashing and manifest comparison', async () => {
  const source = await readFile(new URL('../scripts/linux-verify.mjs', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('linux-verify.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = name => parsed.statements.find(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(item => item.name.getText(parsed) === name));
  const additions = parsed.statements.filter(statement => ts.isExpressionStatement(statement)
    && ts.isCallExpression(statement.expression)
    && statement.expression.expression.getText(parsed) === 'requiredApplicationSource.push');
  // Evaluate only the manifest policy; importing the CLI would read an archive.
  const code = [declaration('requiredApplicationSource'), ...additions, declaration('isApplicationSource')]
    .map(statement => { assert.ok(statement); return statement.getText(parsed); }).join('\n');
  const policy = vm.runInNewContext(`${code}\n({ requiredApplicationSource, isApplicationSource });`);
  assert.ok(policy.requiredApplicationSource.includes('desktop/window-layout.cjs'));
  for (const file of policy.requiredApplicationSource) assert.ok(policy.isApplicationSource(file), `Unhashed required source: ${file}`);
  for (const file of ['desktop/assets/icon.png', 'desktop/private.cjs', 'server/data/auth.json', 'node_modules/pkg/index.js']) {
    assert.equal(policy.isApplicationSource(file), false, `Unexpected application source: ${file}`);
  }
});
