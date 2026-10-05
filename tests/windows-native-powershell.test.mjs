import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';

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
async function powershell(body) {
  const script = `$ErrorActionPreference='Stop'; $tokens=$null; $parseErrors=$null; $ast=[System.Management.Automation.Language.Parser]::ParseFile(${literal(verifier)}, [ref]$tokens, [ref]$parseErrors); if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) };\n`
    + `$definitions=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $true); foreach ($definition in $definitions) { . ([scriptblock]::Create($definition.Extent.Text)) };\n${body}`;
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
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
Assert-WindowsSmokeAvatar -Avatar $template -ExpectedKind anime -ExpectedEnabled $false -Phase fixture;
$rejected=@();
foreach ($mutation in @('v2','renderer','model','moc','core','hidden','duplicate','cat')) {
  $avatar=($template | ConvertTo-Json -Depth 10 | ConvertFrom-Json);
  switch ($mutation) {
    'v2' { $avatar.display.version=2 }
    'renderer' { $avatar.renderer='mesh2d' }
    'model' { $avatar.cubismModel='akari-cubism-v11' }
    'moc' { $avatar.mocVersion='4' }
    'core' { $avatar.coreVersion='0' }
    'hidden' { $avatar.visible=$false }
    'duplicate' { $avatar.canvasCount=2 }
    'cat' { $avatar.display.catEnabled=$true }
  }
  try { Assert-WindowsSmokeAvatar -Avatar $avatar -ExpectedKind anime -ExpectedEnabled $false -Phase fixture } catch { $rejected += $mutation }
}
@{accepted=$true;rejected=$rejected} | ConvertTo-Json -Compress
`);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.rejected, ['v2', 'renderer', 'model', 'moc', 'core', 'hidden', 'duplicate', 'cat']);
});
