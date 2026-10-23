import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const run = promisify(execFile);
const lifecycle = fileURLToPath(new URL('../scripts/Service-Lifecycle.ps1', import.meta.url));
const updater = fileURLToPath(new URL('../scripts/Update-PetPal-ServiceRecovery.ps1', import.meta.url));
const watcher = fileURLToPath(new URL('../scripts/Watch-PetPal-Service.ps1', import.meta.url));
const launcher = fileURLToPath(new URL('../scripts/Start-PetPal-Service.ps1', import.meta.url));
const literal = value => `'${value.replaceAll("'", "''")}'`;
async function powershell(body, executable) {
  const script = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); . ${literal(lifecycle)};\n${body}`;
  let stdout;
  try { ({ stdout } = await run(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 25000, maxBuffer: 1024 * 1024 })); }
  catch (error) { throw new Error(`${executable}: ${error.stderr || (error.killed ? 'fixture timed out' : error.code)}`); }
  return JSON.parse(stdout.trim());
}
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'petpal-service-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const contextFixture = `
$context=[pscustomobject]@{Pause='fixture-maintenance';Receipt='fixture-receipt';Port=54321;Url='http://127.0.0.1:54321';NodeExecutable='fixture-node';Startup='fixture-startup';Log='fixture-events'};
$state=[pscustomobject]@{ServiceId=0;Healthy=$null;Restoring=$false;CoolingDown=$false;RecentStarts=(New-Object 'Collections.Generic.Queue[datetime]')};
$global:events=New-Object 'Collections.Generic.List[string]'; $global:starts=0; $global:owned=$null; $global:healthy=$false; $global:listeners=@(); $global:paused=$false;
function Test-Path { param($LiteralPath,$PathType) return $global:paused }
function Get-PetPalOwnedService { param($Context) return $global:owned }
function Get-NetTCPConnection { param($State,$LocalPort,$ErrorAction) return $global:listeners }
function Test-PetPalServiceHealth { param($Url) return $global:healthy }
function Write-PetPalGuardianEvent { param($Context,$Event,$ServiceId) $global:events.Add($Event) }
`;

for (const engine of ['powershell.exe', 'pwsh.exe']) {
  test(`${engine}: scripts parse; atomic receipt replaces complete JSON and validates timestamp identity`, { skip: process.platform !== 'win32' }, async t => {
    const root = await directory(t), receipt = path.join(root, 'receipt 中文.json');
    const result = await powershell(`
foreach ($file in @(${[lifecycle, updater, watcher, launcher].map(literal).join(',')})) { $tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'PowerShell parse failed'} }
$file=${literal(receipt)};
Write-PetPalAtomicReceipt $file @{pid=42;startedAt='2026-10-23T05:55:15.7812197Z';note='中文'};
$first=Read-PetPalReceiptJson (Get-Content -LiteralPath $file -Raw -Encoding UTF8);
Write-PetPalAtomicReceipt $file @{pid=43;startedAt='2026-10-23T13:55:15.7812197+08:00'};
$second=Read-PetPalReceiptJson (Get-Content -LiteralPath $file -Raw -Encoding UTF8);
$same=(ConvertTo-PetPalReceiptInstant $first.startedAt) -eq (ConvertTo-PetPalReceiptInstant $second.startedAt);
$rejected=0;foreach($value in @('2026-10-23T05:55:15','invalid',[DateTime]::SpecifyKind([DateTime]::Now,[DateTimeKind]::Unspecified))) {try{[void](ConvertTo-PetPalReceiptInstant $value)}catch{$rejected++}}
@{engine=$PSVersionTable.PSVersion.Major;first=$first.pid;second=$second.pid;note=$first.note;same=$same;rejected=$rejected;remaining=@(Get-ChildItem -LiteralPath ${literal(root)}).Count} | ConvertTo-Json -Compress
`, engine);
    assert.deepEqual(result, { engine: engine === 'powershell.exe' ? 5 : 7, first: 42, second: 43, note: '中文', same: true, rejected: 3, remaining: 1 });
  });

  test(`${engine}: actual receipt ownership rejects PID reuse, executable/command mismatch, and malformed receipts`, { skip: process.platform !== 'win32' }, async t => {
    const root = await directory(t), receipt = path.join(root, 'receipt.json');
    const result = await powershell(`
$context=[pscustomobject]@{Receipt=${literal(receipt)};Url='http://127.0.0.1:54321';NodeExecutable='fixture-node'};
$script:process=[pscustomobject]@{Id=42;StartTime=[DateTime]::Parse('2026-10-23T05:55:15Z').ToUniversalTime();Path='fixture-node'};
$script:command='node server/index.mjs';
function Get-Process {param($Id,$ErrorAction) if($Id -eq 42){return $script:process}}
function Get-CimInstance {param($ClassName,$Filter) return @{CommandLine=$script:command}}
Write-PetPalAtomicReceipt $context.Receipt @{pid=42;startedAt='2026-10-23T05:55:15Z';url=$context.Url};
$accepted=(Get-PetPalOwnedService $context).Id;
$rejected=@();foreach($mutation in @('time','executable','command','url','pid','json')) {
  $script:process.StartTime=[DateTime]::Parse('2026-10-23T05:55:15Z').ToUniversalTime();$script:process.Path='fixture-node';$script:command='node server/index.mjs';
  $value=@{pid=42;startedAt='2026-10-23T05:55:15Z';url=$context.Url};
  switch($mutation){'time'{$value.startedAt='2026-10-23T05:54:00Z'}'executable'{$script:process.Path='other-node'}'command'{$script:command='node other.mjs'}'url'{$value.url='http://elsewhere'}'pid'{$value.pid='42'}}
  Write-PetPalAtomicReceipt $context.Receipt $value;
  if($mutation -eq 'json'){[IO.File]::WriteAllText($context.Receipt,'{')};
  try{[void](Get-PetPalOwnedService $context)}catch{$rejected+=$mutation}
}
Write-PetPalAtomicReceipt $context.Receipt @{pid=77;startedAt='2026-10-23T05:55:15Z';url=$context.Url};
@{accepted=$accepted;rejected=$rejected;missing=$null -eq (Get-PetPalOwnedService $context)} | ConvertTo-Json -Compress
`, engine);
    assert.equal(result.accepted, 42); assert.deepEqual(result.rejected, ['time', 'executable', 'command', 'url', 'pid', 'json']); assert.equal(result.missing, true);
  });

  test(`${engine}: atomic publication tolerates an overlapping reader lock and concurrent JSON reads`, { skip: process.platform !== 'win32' }, async t => {
    const root = await directory(t), receipt = path.join(root, 'receipt.json');
    const result = await powershell(`
$file=${literal(receipt)};Write-PetPalAtomicReceipt $file @{seq=0};
$ready=[Threading.ManualResetEvent]::new($false);$stop=[Threading.ManualResetEvent]::new($false);
$reader=[powershell]::Create();[void]$reader.AddScript({param($file,$ready,$stop,$helper)
  $ErrorActionPreference='Stop';. $helper;
  $lock=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);
  [void]$ready.Set();[Threading.Thread]::Sleep(200);$lock.Dispose();
  $reads=0;$errors=0;$categories=New-Object 'Collections.Generic.List[string]';while(-not $stop.WaitOne(0)){
    try{$value=Read-PetPalReceiptFile -Path $file;if($value.seq -isnot [ValueType]){throw 'incomplete receipt'};$reads++}catch{$errors++;$failure=$_.Exception.GetBaseException();$categories.Add(($failure.GetType().FullName+':'+($failure.HResult -band 65535)+':'+$_.CategoryInfo.Category))}
    [Threading.Thread]::Sleep(1)
  };@{reads=$reads;errors=$errors;categories=@($categories.ToArray())}
}).AddArgument($file).AddArgument($ready).AddArgument($stop).AddArgument(${literal(lifecycle)});
$pending=$reader.BeginInvoke();if(-not $ready.WaitOne(5000)){throw 'reader did not start'};
$watch=[Diagnostics.Stopwatch]::StartNew();
try{1..100|ForEach-Object{Write-PetPalAtomicReceipt $file @{seq=$_;padding=('x'*10000)}}}finally{[void]$stop.Set()};
$observations=$reader.EndInvoke($pending);$reader.Dispose();$ready.Dispose();$stop.Dispose();
$final=Read-PetPalReceiptJson (Get-Content -LiteralPath $file -Raw);
@{seq=$final.seq;reads=$observations[0].reads;errors=$observations[0].errors;categories=$observations[0].categories;elapsed=$watch.ElapsedMilliseconds;files=@(Get-ChildItem -LiteralPath ${literal(root)}).Count} | ConvertTo-Json -Compress
`, engine);
    assert.equal(result.seq, 100); assert.equal(result.errors, 0, JSON.stringify(result.categories)); assert.ok(result.reads > 0); assert.equal(result.files, 1); assert.ok(result.elapsed >= 100 && result.elapsed < 10000);
  });

  test(`${engine}: a transient missing receipt is retried; persistent absence stays bounded and malformed JSON fails`, { skip: process.platform !== 'win32' }, async t => {
    const root = await directory(t), receipt = path.join(root, 'receipt.json');
    const result = await powershell(`
$file=${literal(receipt)};$go=[Threading.ManualResetEvent]::new($false);
$publisher=[powershell]::Create();[void]$publisher.AddScript({param($file,$go)
  [void]$go.WaitOne();[Threading.Thread]::Sleep(200);[IO.File]::WriteAllText($file,'{"pid":42}')
}).AddArgument($file).AddArgument($go);
$pending=$publisher.BeginInvoke();[void]$go.Set();$watch=[Diagnostics.Stopwatch]::StartNew();
$value=Read-PetPalReceiptFile $file;$transientElapsed=$watch.ElapsedMilliseconds;
[void]$publisher.EndInvoke($pending);$publisher.Dispose();$go.Dispose();[IO.File]::Delete($file);
$context=[pscustomobject]@{Receipt=$file};$watch.Restart();$absent=$null -eq (Get-PetPalOwnedService $context);$missingElapsed=$watch.ElapsedMilliseconds;
[IO.File]::WriteAllText($file,'{');$malformed=$false;try{[void](Read-PetPalReceiptFile $file)}catch{$malformed=$true};
@{pid=$value.pid;transientElapsed=$transientElapsed;absent=$absent;missingElapsed=$missingElapsed;malformed=$malformed} | ConvertTo-Json -Compress
`, engine);
    assert.equal(result.pid, 42); assert.ok(result.transientElapsed >= 100 && result.transientElapsed < 2000);
    assert.equal(result.absent, true); assert.ok(result.missingElapsed >= 900 && result.missingElapsed < 2500); assert.equal(result.malformed, true);
  });

  test(`${engine}: failed startup health never reports restored; later recovery is observable without restart`, { skip: process.platform !== 'win32' }, async t => {
    const root = await directory(t), startup = path.join(root, 'startup.ps1');
    await writeFile(startup, '$global:starts++;$global:owned=[pscustomobject]@{Id=42};$global:listeners=@(@{OwningProcess=42});throw "fixture health failed"');
    const result = await powershell(contextFixture + `
$context.Startup=${literal(startup)};
function Stop-Process {throw 'Guardian must not stop a process'}
Invoke-PetPalGuardianStep $context $state;
$before=@($global:events.ToArray());
Invoke-PetPalGuardianStep $context $state;
$global:healthy=$true;Invoke-PetPalGuardianStep $context $state;
$global:healthy=$false;Invoke-PetPalGuardianStep $context $state;Invoke-PetPalGuardianStep $context $state;
$global:healthy=$true;Invoke-PetPalGuardianStep $context $state;
@{before=$before;events=@($global:events.ToArray());starts=$global:starts;service=$state.ServiceId;healthy=$state.Healthy} | ConvertTo-Json -Compress
`, engine);
    assert.deepEqual(result.before, ['service-start-unconfirmed', 'service-degraded', 'service-monitored']);
    assert.deepEqual(result.events, ['service-start-unconfirmed', 'service-degraded', 'service-monitored', 'service-restored', 'service-degraded', 'service-recovered']);
    assert.equal(result.starts, 1); assert.equal(result.service, 42); assert.equal(result.healthy, true);
  });

  test(`${engine}: maintenance, unknown listeners, listener ownership and restart cooldown stay fail closed`, { skip: process.platform !== 'win32' }, async () => {
    const result = await powershell(contextFixture + `
$global:paused=$true;$global:listeners=@(@{OwningProcess=77});Invoke-PetPalGuardianStep $context $state;$maintenance=$events.Count -eq 0;
$global:paused=$false;$unknown=$false;try{Invoke-PetPalGuardianStep $context $state}catch{$unknown=$true};
$global:owned=@{Id=42};$mismatch=$false;try{Invoke-PetPalGuardianStep $context $state}catch{$mismatch=$true};
$global:owned=$null;$global:listeners=@();1..3|ForEach-Object{$state.RecentStarts.Enqueue([DateTime]::UtcNow)};
Invoke-PetPalGuardianStep $context $state;Invoke-PetPalGuardianStep $context $state;
$cooldown=@($events.ToArray());$state.RecentStarts.Clear();1..3|ForEach-Object{$state.RecentStarts.Enqueue([DateTime]::UtcNow.AddMinutes(-11))};
$context.Startup={$global:starts++;$global:owned=@{Id=42};$global:listeners=@(@{OwningProcess=42});$global:healthy=$true};
Invoke-PetPalGuardianStep $context $state;
@{maintenance=$maintenance;unknown=$unknown;mismatch=$mismatch;cooldown=$cooldown;events=@($events.ToArray());starts=$starts} | ConvertTo-Json -Compress
`, engine);
    assert.deepEqual(result, { maintenance: true, unknown: true, mismatch: true, cooldown: ['service-restart-cooldown'], events: ['service-restart-cooldown', 'service-restored', 'service-monitored'], starts: 1 });
  });

  test(`${engine}: existing scheduled task gains idempotent recovery while retaining principal, settings and logon trigger`, { skip: process.platform !== 'win32' }, async () => {
    const result = await powershell(String.raw`
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile(${literal(updater)},[ref]$tokens,[ref]$errors);
foreach($definition in $ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($definition.Extent.Text))}
$root='C:\fixture root';$shell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe';
$xml='<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task" version="1.2"><RegistrationInfo><Description>retained</Description></RegistrationInfo><Triggers><LogonTrigger><Enabled>true</Enabled><UserId>fixture</UserId></LogonTrigger></Triggers><Principals><Principal id="Author"><UserId>fixture</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings><Actions Context="Author"><Exec><Command>'+[Security.SecurityElement]::Escape($shell)+'</Command><Arguments>-NoProfile -NonInteractive -WindowStyle Hidden -File &quot;C:\fixture root\.data\service-guardian.ps1&quot;</Arguments></Exec></Actions></Task>';
$first=[xml](New-PetPalRecoveryTaskXml $xml $root);$second=[xml](New-PetPalRecoveryTaskXml $first.OuterXml $root);$original=[xml]$xml;
$preserved=$first.Task.Principals.OuterXml -eq $original.Task.Principals.OuterXml -and $first.Task.Triggers.LogonTrigger.OuterXml -eq $original.Task.Triggers.LogonTrigger.OuterXml -and $first.Task.Settings.RestartOnFailure.OuterXml -eq $original.Task.Settings.RestartOnFailure.OuterXml -and $first.Task.Settings.ExecutionTimeLimit -eq 'PT0S' -and $first.Task.Settings.DisallowStartIfOnBatteries -eq 'false';
$unchanged=$first.Clone();[void]$unchanged.Task.Triggers.RemoveChild($unchanged.Task.Triggers.TimeTrigger);$unchanged.Task.Actions.Exec.Arguments=$original.Task.Actions.Exec.Arguments;$unchanged.Task.Settings.MultipleInstancesPolicy=$original.Task.Settings.MultipleInstancesPolicy;
$preserved=$preserved -and $unchanged.OuterXml -ceq $original.OuterXml;
$rejected=$false;try{[void](New-PetPalRecoveryTaskXml ($xml.Replace('service-guardian.ps1','other.ps1')) $root)}catch{$rejected=$true};
@{preserved=$preserved;interval=$second.Task.Triggers.TimeTrigger.Repetition.Interval;recoveryCount=@($second.Task.Triggers.TimeTrigger).Count;policy=$second.Task.Settings.MultipleInstancesPolicy;managed=$second.Task.Actions.Exec.Arguments.Contains('Watch-PetPal-Service.ps1');rejected=$rejected} | ConvertTo-Json -Compress
`, engine);
    assert.deepEqual(result, { preserved: true, interval: 'PT1M', recoveryCount: 1, policy: 'IgnoreNew', managed: true, rejected: true });
  });

  test(`${engine}: real health probe rejects false, malformed, redirected and stalled loopback responses`, { skip: process.platform !== 'win32' }, async t => {
    const sockets = new Set();
    const server = http.createServer((request, response) => {
      if (request.url.startsWith('/stall')) return;
      if (request.url.startsWith('/dribble')) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{'); const timer = setInterval(() => response.write(' '), 50); response.once('close', () => clearInterval(timer)); return; }
      if (request.url.startsWith('/oversized')) { response.end('x'.repeat(65537)); return; }
      if (request.url.startsWith('/redirect')) { response.writeHead(302, { Location: '/good/api/health' }).end(); return; }
      response.end(request.url.startsWith('/good') ? '{"ok":true}' : request.url.startsWith('/bad-json') ? '{' : request.url.startsWith('/false') ? '{"ok":false}' : '{"ok":"true"}');
    });
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
    const url = `http://127.0.0.1:${server.address().port}`;
    const result = await powershell(`
$watch=[Diagnostics.Stopwatch]::StartNew();$results=@();foreach($route in @('good','bad-json','false','string','redirect','oversized','stall','dribble')){$results+=Test-PetPalServiceHealth -Url (${literal(url)}+'/'+$route)};
@{results=$results;elapsed=$watch.ElapsedMilliseconds} | ConvertTo-Json -Compress
`, engine);
    assert.deepEqual(result.results, [true, false, false, false, false, false, false, false]); assert.ok(result.elapsed < 9000, `bounded health check took ${result.elapsed} ms`);
  });
}
