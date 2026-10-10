import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const verifier = fileURLToPath(new URL('../desktop/verify-windows.ps1', import.meta.url));
const literal = text => `'${text.replaceAll("'", "''")}'`;
const fixtureRoots = [];
test.after(async () => {
  for (const directory of fixtureRoots) {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('petpal-ps-isolation-'));
    await rm(directory, { recursive: true, force: true });
  }
});
async function powershell(body, executable = 'powershell.exe') {
  const script = `$ErrorActionPreference='Stop'; $tokens=$null; $parseErrors=$null; $ast=[System.Management.Automation.Language.Parser]::ParseFile(${literal(verifier)}, [ref]$tokens, [ref]$parseErrors); if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) };\n`
    + `$definitions=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $true); foreach ($definition in $definitions) { . ([scriptblock]::Create($definition.Extent.Text)) };\n${body}`;
  const { stdout } = await run(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout.trim());
}

test('real PowerShell isolation pre-creates all runtime homes, strips inherited launch/credential flags and restores them', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-ps-isolation-'));
  fixtureRoots.push(directory);
  const result = await powershell(`
$env:OPENAI_API_KEY='fixture-only'; $env:CODEX_HOME='host-fixture'; $env:PETPAL_SERVER_TOKEN='fixture-only'; $env:PETPAL_SMOKE_APP='1'; $env:PETPAL_SMOKE_POSES='1'; $env:ELECTRON_RUN_AS_NODE='1'; $env:ELECTRON_NO_ASAR='1'; $env:PORTABLE_EXECUTABLE_DIR='host-fixture'; $env:NODE_OPTIONS='fixture-only';
$isolation=$null;
try {
  $isolation=New-WindowsSmokeIsolation -IsolationRoot ${literal(directory)} -OutputDirectory ${literal(path.join(directory, 'output'))};
  $privateAbsent= -not $env:OPENAI_API_KEY -and -not $env:PETPAL_SERVER_TOKEN -and -not $env:ELECTRON_RUN_AS_NODE -and -not $env:ELECTRON_NO_ASAR -and -not $env:PORTABLE_EXECUTABLE_DIR -and -not $env:NODE_OPTIONS;
  $optionalAbsent= -not $env:PETPAL_SMOKE_APP -and -not $env:PETPAL_SMOKE_POSES;
  $homesReady= (Test-Path -LiteralPath $env:CODEX_HOME -PathType Container) -and (Test-Path -LiteralPath $env:PETPAL_WORKSPACE -PathType Container) -and (Test-Path -LiteralPath $env:PETPAL_SMOKE_PROFILE -PathType Container) -and (Test-Path -LiteralPath $env:TEMP -PathType Container) -and (Test-Path -LiteralPath $env:APPDATA -PathType Container);
  $isolatedCodex= $env:CODEX_HOME -ne 'host-fixture'; $sameTemp=$env:TEMP -eq $env:TMP;
} finally { Restore-WindowsSmokeIsolation -Isolation $isolation }
$restored= $env:OPENAI_API_KEY -eq 'fixture-only' -and $env:CODEX_HOME -eq 'host-fixture' -and $env:PETPAL_SMOKE_APP -eq '1' -and $env:ELECTRON_RUN_AS_NODE -eq '1' -and $env:PORTABLE_EXECUTABLE_DIR -eq 'host-fixture';
$explicit=New-WindowsSmokeIsolation -IsolationRoot ${literal(path.join(directory, 'explicit'))} -OutputDirectory ${literal(path.join(directory, 'output'))} -EnableAppFixture -EnablePoses;
try { $explicitOptions=$env:PETPAL_SMOKE_APP -eq '1' -and $env:PETPAL_SMOKE_POSES -eq '1' } finally { Restore-WindowsSmokeIsolation -Isolation $explicit }
@{privateAbsent=$privateAbsent;optionalAbsent=$optionalAbsent;homesReady=$homesReady;isolatedCodex=$isolatedCodex;sameTemp=$sameTemp;restored=$restored;explicitOptions=$explicitOptions} | ConvertTo-Json -Compress
`);
  for (const [property, value] of Object.entries(result)) assert.equal(value, true, property);
});

test('real PowerShell avatar validation accepts Cubism V12/v3 and rejects obsolete or incomplete smoke receipts', { skip: process.platform !== 'win32' }, async () => {
  const result = await powershell(`
$template=@{kind='anime';display=@{version=3;kind='anime';catEnabled=$false};visible=$true;canvasBounds=@{width=412;height=540};canvasCount=1;petCount=1;renderFrames=12;renderer='cubism';cubismModel='akari-cubism-v12';mocVersion='5';coreVersion='100663552'};
Assert-WindowsSmokeAvatar -Avatar $template -Phase fixture;
$rejected=@();
foreach ($mutation in @('v2','renderer','model','moc','core','hidden','duplicate','cat','staleDisplay')) {
  $avatar=($template | ConvertTo-Json -Depth 10 | ConvertFrom-Json);
  switch ($mutation) {
    'v2' { $avatar.display.version=2 }
    'renderer' { $avatar.renderer='mesh2d' }
    'model' { $avatar.cubismModel='akari-cubism-v11' }
    'moc' { $avatar.mocVersion='4' }
    'core' { $avatar.coreVersion='0' }
    'hidden' { $avatar.visible=$false }
    'duplicate' { $avatar.canvasCount=2 }
    'cat' { $avatar.kind='cat'; $avatar.display.kind='cat' }
    'staleDisplay' { $avatar.display.catEnabled=$true }
  }
  try { Assert-WindowsSmokeAvatar -Avatar $avatar -Phase fixture } catch { $rejected += $mutation }
}
@{accepted=$true;rejected=$rejected} | ConvertTo-Json -Compress
`);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.rejected, ['v2', 'renderer', 'model', 'moc', 'core', 'hidden', 'duplicate', 'cat', 'staleDisplay']);
});

for (const engine of ['powershell.exe', 'pwsh.exe']) {
  test(`${engine} uses actual Node builder manifest bytes for Unicode paths and stripped metadata`, { skip: process.platform !== 'win32' }, async () => {
    const directory=await mkdtemp(path.join(os.tmpdir(),'petpal-ps-isolation-'));
    fixtureRoots.push(directory);
    const file=path.join(directory,'package 中文 空格.json');
    const manifest={name:'中文包',version:'0.9.11',description:'字符与 Unicode \u2764',dependencies:{alpha:'1.0.0'},scripts:{start:'ignored'},devDependencies:{builder:'1.0.0'},build:{ignored:true},bugs:{url:'https://example.invalid'},keywords:['音乐']};
    await writeFile(file,JSON.stringify(manifest));
    for (const fields of [['scripts','devDependencies','build'],['scripts','keywords','bugs']]) {
      const expected=structuredClone(manifest);for(const field of fields)delete expected[field];
      const bytes=Buffer.from(JSON.stringify(expected,null,2));
      const result=await powershell(`
$bytes=Get-NodePackageManifestBytes -ManifestPath ${literal(file)} -RemoveFields @(${fields.map(literal).join(',')}) -NodeExecutable ${literal(process.execPath)};
$sha=[System.Security.Cryptography.SHA256]::Create(); try {$hash=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()};
@{bytes=$bytes.Length;sha256=$hash;engine=$PSVersionTable.PSVersion.Major} | ConvertTo-Json -Compress
`,engine);
      assert.equal(result.bytes,bytes.length);
      assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));
      assert.equal(result.engine,engine==='powershell.exe'?5:7);
    }
  });
}

test('real PowerShell smoke rejects missing assistant members and altered module byte receipts', { skip: process.platform !== 'win32' }, async () => {
  const expected = ['server/conversation-organization.mjs', 'server/chat-assistant.mjs',
    'server/automation-schema.mjs', 'server/automation-tools.mjs', 'server/automations.mjs',
    'server/codex-config.mjs', 'server/approval-review.mjs', 'server/system-controls.mjs', 'server/native/system-windows.ps1',
    'server/native/codex-review/models-0.143.0.json', 'server/native/codex-review/LICENSE', 'server/native/codex-review/PROVENANCE.json', 'server/native/codex-review/SHA256SUMS'];
  const result = await powershell(`
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility') -Force;
$requiredGate=@($ast.FindAll({param($node) $node -is [System.Management.Automation.Language.ForEachStatementAst] -and $node.Variable.VariablePath.UserPath -eq 'required' -and $node.Body.Extent.Text.Contains('Missing required desktop assistant runtime member')}, $true));
$byteGate=@($ast.FindAll({param($node) $node -is [System.Management.Automation.Language.ForEachStatementAst] -and $node.Variable.VariablePath.UserPath -eq 'file' -and $node.Body.Extent.Text.Contains('Packaged runtime differs from frozen source')}, $true));
if ($requiredGate.Count -ne 1 -or $byteGate.Count -ne 1) { throw 'Production smoke source gates were not found' }
$project=${literal(path.resolve(path.dirname(verifier), '..'))};
$critical=@(${expected.map(literal).join(',')});
$requiredNames=@(& ([scriptblock]::Create($requiredGate[0].Condition.Extent.Text)));
$records=@(); foreach ($member in $requiredNames) {
  if ($critical -contains $member) {
    $source=Join-Path $project $member;
    $records+=@{path=$member;bytes=(Get-Item -LiteralPath $source).Length;sha256=(Get-FileHash -LiteralPath $source).Hash};
  } else { $records+=@{path=$member;bytes=0;sha256=('0' * 64)} }
}
foreach ($member in $critical) { if ($requiredNames -notcontains $member) { throw ('Required member omitted: '+$member) } }
$result=@{bundleFiles=$records}; & ([scriptblock]::Create($requiredGate[0].Extent.Text));
$exact=@($records | Where-Object { $critical -contains $_.path });
$result=@{bundleFiles=$exact}; & ([scriptblock]::Create($byteGate[0].Extent.Text));
$missing=@(); $changed=@();
foreach ($member in $critical) {
  $result=@{bundleFiles=@($records | Where-Object { $_.path -ne $member })};
  try { & ([scriptblock]::Create($requiredGate[0].Extent.Text)) } catch { if ($_.Exception.Message -eq ('Missing required desktop assistant runtime member: '+$member)) { $missing+=$member } else { throw } }
  $original=@($exact | Where-Object { $_.path -eq $member })[0];
  $result=@{bundleFiles=@(@{path=$member;bytes=$original.bytes;sha256=('0' * 64)})};
  try { & ([scriptblock]::Create($byteGate[0].Extent.Text)) } catch { if ($_.Exception.Message -eq ('Packaged runtime differs from frozen source: '+$member)) { $changed+=$member } else { throw } }
}
@{accepted=$true;missing=$missing;changed=$changed} | ConvertTo-Json -Compress
`);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.missing, expected);
  assert.deepEqual(result.changed, expected);
});
