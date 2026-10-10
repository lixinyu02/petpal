param(
  [string]$Executable,
  [string]$EvidenceDirectory,
  [string]$DistDirectory,
  [string]$MetadataPath,
  [switch]$AppFixture,
  [switch]$Poses
)
$ErrorActionPreference = 'Stop'
function New-WindowsSmokeIsolation {
  param([string]$IsolationRoot, [string]$OutputDirectory, [switch]$EnableAppFixture, [switch]$EnablePoses)
  $prior = @{}
  $cleared = @()
  $fixedNames = @('PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'OPENCLI_CONFIG_DIR', 'TEMP', 'TMP', 'TMPDIR', 'NODE_OPTIONS', 'NODE_PATH')
  foreach ($entry in [System.Environment]::GetEnvironmentVariables('Process').GetEnumerator()) {
    $name = [string]$entry.Key
    if ($name -in $fixedNames -or $name -match '^(OPENAI_|CODEX_|PETPAL_|ELECTRON_|PORTABLE_EXECUTABLE|ANTHROPIC_|AZURE_OPENAI_|GEMINI_|GOOGLE_API_|CPA_)') {
      $prior[$name] = [string]$entry.Value
      $cleared += $name
    }
  }
  $profile = Join-Path $IsolationRoot 'user-data'
  $childHome = Join-Path $IsolationRoot 'home'
  $isolated = [ordered]@{
    PATH="$env:SystemRoot\System32;$env:SystemRoot"
    HOME=$childHome
    USERPROFILE=$childHome
    APPDATA=(Join-Path $childHome 'AppData\Roaming')
    LOCALAPPDATA=(Join-Path $childHome 'AppData\Local')
    XDG_CONFIG_HOME=(Join-Path $childHome '.config')
    XDG_CACHE_HOME=(Join-Path $childHome '.cache')
    OPENCLI_CONFIG_DIR=(Join-Path $childHome '.opencli')
    TEMP=(Join-Path $IsolationRoot 'temp')
    TMP=(Join-Path $IsolationRoot 'temp')
    TMPDIR=(Join-Path $IsolationRoot 'temp')
    CODEX_HOME=(Join-Path $IsolationRoot 'codex-host')
    PETPAL_WORKSPACE=(Join-Path $IsolationRoot 'workspace')
    PETPAL_SMOKE_DIR=$OutputDirectory
    PETPAL_SMOKE_PROFILE=$profile
  }
  if ($EnableAppFixture) { $isolated.PETPAL_SMOKE_APP = '1' }
  if ($EnablePoses) { $isolated.PETPAL_SMOKE_POSES = '1' }
  foreach ($directory in @($profile, $childHome, $isolated.APPDATA, $isolated.LOCALAPPDATA, $isolated.XDG_CONFIG_HOME, $isolated.XDG_CACHE_HOME, $isolated.OPENCLI_CONFIG_DIR, $isolated.TEMP, $isolated.CODEX_HOME, $isolated.PETPAL_WORKSPACE)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  # Create CODEX_HOME/workspace before launch. A fresh profile must never load host credentials.
  foreach ($name in $cleared) { [System.Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  foreach ($entry in $isolated.GetEnumerator()) { [System.Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, 'Process') }
  return @{ prior=$prior; isolated=$isolated; cleared=$cleared; root=$IsolationRoot }
}
function Restore-WindowsSmokeIsolation {
  param($Isolation)
  if (-not $Isolation) { return }
  foreach ($name in @($Isolation.isolated.Keys) + @($Isolation.cleared)) { [System.Environment]::SetEnvironmentVariable([string]$name, $null, 'Process') }
  foreach ($entry in $Isolation.prior.GetEnumerator()) { [System.Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, 'Process') }
}
function Assert-WindowsSmokeAvatar {
  param($Avatar, [string]$Phase)
  if ($Avatar.kind -ne 'anime' -or $Avatar.display.version -ne 3 -or $Avatar.display.kind -ne 'anime' -or $Avatar.display.catEnabled -ne $false -or -not $Avatar.visible -or $Avatar.canvasBounds.width -le 0 -or $Avatar.canvasBounds.height -le 0 -or
    $Avatar.canvasCount -ne 1 -or $Avatar.petCount -ne 1 -or $Avatar.renderFrames -lt 2 -or
    $Avatar.renderer -ne 'cubism' -or $Avatar.cubismModel -ne 'akari-cubism-v12' -or [int64]$Avatar.mocVersion -ne 5 -or [int64]$Avatar.coreVersion -le 0) { throw "Effective v3 display and Cubism V12 did not synchronize for $Phase." }
}
function Get-NodePackageManifestBytes {
  param([Parameter(Mandatory=$true)][string]$ManifestPath, [string[]]$RemoveFields, [string]$NodeExecutable)
  # Match electron-builder's actual JSON.stringify bytes on both PowerShell 5.1 and 7.
  # This developer verifier runs from a source checkout with its Node build runtime.
  if (-not $NodeExecutable) { $NodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source }
  $nodeScript = "const fs=require('node:fs');const manifest=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));for(const name of process.argv[2].split(',').filter(Boolean))delete manifest[name];process.stdout.write(Buffer.from(JSON.stringify(manifest,null,2),'utf8').toString('base64'));"
  $fields = @($RemoveFields) -join ','
  $encoded = & $NodeExecutable -e $nodeScript $ManifestPath $fields
  if ($LASTEXITCODE -ne 0 -or -not $encoded) { throw 'Node package manifest serialization failed.' }
  return ,([Convert]::FromBase64String(($encoded -join '').Trim()))
}
$project = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath "$project\package.json" -Raw -Encoding utf8 | ConvertFrom-Json).version
$versionSeries = ($version.Split('.')[0..1] -join '')
if ($DistDirectory -and -not $MetadataPath) { throw '-DistDirectory requires -MetadataPath to preserve existing release evidence.' }
if (-not $Executable) { $Executable = Join-Path $project "releases\desktop\PetPal-$version-Windows-x64.exe" }
if (-not $EvidenceDirectory) { $EvidenceDirectory = Join-Path $project ('evidence\native\windows-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
if (-not $DistDirectory) { $DistDirectory = Join-Path $project 'dist' }
$Executable = [System.IO.Path]::GetFullPath($Executable)
$EvidenceDirectory = [System.IO.Path]::GetFullPath($EvidenceDirectory)
$DistDirectory = [System.IO.Path]::GetFullPath($DistDirectory)
if ($MetadataPath) {
  $MetadataPath = [System.IO.Path]::GetFullPath($MetadataPath)
  if (Test-Path -LiteralPath $MetadataPath) { throw "Independent metadata already exists: $MetadataPath" }
  if ((Test-Path -LiteralPath $EvidenceDirectory) -and @((Get-ChildItem -LiteralPath $EvidenceDirectory -Force)).Count -gt 0) { throw "Independent evidence directory must be empty: $EvidenceDirectory" }
}
if (-not (Test-Path -LiteralPath $Executable)) { throw "Desktop executable not found: $Executable" }
if (-not (Test-Path -LiteralPath (Join-Path $DistDirectory 'index.html') -PathType Leaf)) { throw "Frontend index not found: $DistDirectory" }
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
$isolation = $null
$startedAt = Get-Date
try {
  $isolation = New-WindowsSmokeIsolation -IsolationRoot (Join-Path $project ('.tools\desktop-smoke-profiles\' + [guid]::NewGuid().ToString('N'))) -OutputDirectory $EvidenceDirectory -EnableAppFixture:$AppFixture -EnablePoses:$Poses
  $process = Start-Process -FilePath $Executable -ArgumentList '--smoke-test' -WorkingDirectory (Split-Path -Parent $Executable) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $EvidenceDirectory 'stdout.log') -RedirectStandardError (Join-Path $EvidenceDirectory 'stderr.log') -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Desktop smoke exited $($process.ExitCode)" }
} finally {
  Restore-WindowsSmokeIsolation -Isolation $isolation
}
$resultPath = Join-Path $EvidenceDirectory 'result.json'
if (-not (Test-Path -LiteralPath $resultPath) -or (Get-Item -LiteralPath $resultPath).LastWriteTime -lt $startedAt) { throw 'Desktop did not write a fresh smoke result.' }
$result = Get-Content -LiteralPath $resultPath -Raw -Encoding utf8 | ConvertFrom-Json
if (-not $result.health.ok -or -not $result.bridge.hasToken -or -not $result.uiReady -or -not $result.codex.available -or -not $result.pet.alwaysOnTop) { throw 'Desktop health, preload, ready UI, bundled Codex, or pet window check failed.' }
if (-not $result.loginGate.loginVisible -or -not $result.loginGate.protectedContentAbsent -or -not $result.loginGate.noStoredToken -or -not $result.loginGate.explicitOwnerLogin -or -not $result.loginGate.authenticated) { throw 'Desktop login gate or explicit owner login verification failed.' }
if ($result.health.version -ne $version) { throw 'Desktop backend version does not match this release.' }
$sourceManifest = Get-Content -LiteralPath "$project\package.json" -Raw -Encoding utf8 | ConvertFrom-Json
if ($result.electronVersion -ne $sourceManifest.devDependencies.electron) { throw 'The final executable uses a different Electron version.' }
if (-not $result.desktopTools.opencli.available -or $result.desktopTools.opencli.version -ne '1.8.8' -or $result.desktopTools.opencli.runtime -ne 'bundled' -or -not $result.desktopTools.opencli.readOnlyProbe) { throw 'Bundled OpenCLI read-only status check failed.' }
if ($result.desktopTools.opencli.daemonState -notin @('stopped', 'external', 'unavailable')) { throw 'Smoke unexpectedly started or attached to an OpenCLI daemon.' }
if ($result.desktopTools.music.platform -ne 'win32' -or @($result.desktopTools.music.players | Where-Object { $_.id -in @('qqmusic', 'netease') }).Count -ne 2) { throw 'Windows music status did not report both supported players.' }
if ($result.defaultAvatar -ne 'anime') { throw 'Desktop did not default to its supported anime companion.' }
$synchronization = $result.avatarSynchronization
if (-not $synchronization.bothWindowsReloaded -or -not $synchronization.rawPreferenceUnchanged -or
  -not $synchronization.retiredControls.choiceAbsent -or -not $synchronization.retiredControls.capabilitySwitchAbsent -or
  -not $synchronization.reloadedControls.choiceAbsent -or -not $synchronization.reloadedControls.capabilitySwitchAbsent) { throw 'Anime synchronization, reload, or retired companion control verification failed.' }
$legacyFallback = $synchronization.legacyFallback
if (-not $legacyFallback.isolatedFixture -or -not $legacyFallback.bothWindowsReloaded -or $legacyFallback.legacyServerKind -ne 'cat' -or -not $legacyFallback.rawPreferenceUnchanged -or
  -not $legacyFallback.retiredControls.choiceAbsent -or -not $legacyFallback.retiredControls.capabilitySwitchAbsent) { throw 'Existing companion preferences did not safely fall back to anime.' }
foreach ($windowName in @('main', 'pet')) {
  Assert-WindowsSmokeAvatar -Avatar $result.avatars.anime.$windowName -Phase "anime/$windowName"
  Assert-WindowsSmokeAvatar -Avatar $synchronization.initial.$windowName -Phase "initial/$windowName"
  Assert-WindowsSmokeAvatar -Avatar $synchronization.reloaded.$windowName -Phase "reloaded/$windowName"
  Assert-WindowsSmokeAvatar -Avatar $legacyFallback.initial.$windowName -Phase "legacy-initial/$windowName"
  Assert-WindowsSmokeAvatar -Avatar $legacyFallback.reloaded.$windowName -Phase "legacy-reloaded/$windowName"
}
Add-Type -AssemblyName System.Drawing
$pet = [System.Drawing.Bitmap]::FromFile((Join-Path $EvidenceDirectory 'pet.png'))
try { if ($pet.GetPixel(0,0).A -ne 0) { throw 'Pet window corner is not transparent.' } } finally { $pet.Dispose() }
if (-not $result.bundleFiles -or $result.bundleFiles.Count -lt 10) { throw 'Packaged runtime did not report resource byte evidence.' }
foreach ($required in @('desktop/main.cjs', 'desktop/preload.cjs', 'desktop/window-layout.cjs', 'desktop/media-permissions.cjs', 'desktop/service-settings.cjs', 'desktop/startup-diagnostics.cjs', 'desktop/app-preferences.cjs', 'desktop/app-preferences-ipc.cjs', 'desktop/central-server.cjs', 'desktop/central-server-ipc.cjs', 'desktop/central-server-smoke.cjs', 'desktop/remote-http.cjs', 'desktop/executor.mjs', 'server/executors.mjs', 'server/remote-codex.mjs', 'server/executor-relay.mjs', 'server/response-message-segments.mjs', 'server/project-directory.mjs', 'server/agent-permissions.mjs', 'server/agent-tasks.mjs', 'server/attachments.mjs', 'server/downloads.mjs', 'server/codex-config.mjs', 'server/approval-review.mjs', 'server/system-controls.mjs', 'server/native/system-windows.ps1', 'server/native/codex-review/models-0.143.0.json', 'server/native/codex-review/LICENSE', 'server/native/codex-review/PROVENANCE.json', 'server/native/codex-review/SHA256SUMS', 'server/codex-transport.mjs', 'server/desktop-tools.mjs', 'server/music.mjs', 'server/opencli.mjs', 'server/opencli-manager.mjs', 'server/opencli-sites.mjs', 'server/opencli-worker.mjs', 'server/opencli-routes.mjs', 'server/native/music-windows.ps1', 'server/conversation-organization.mjs', 'server/chat-assistant.mjs', 'server/automation-schema.mjs', 'server/automation-tools.mjs', 'server/automations.mjs', 'dist/avatars/akari-cubism-v12/akari.moc3', 'node_modules/@jackwener/opencli/package.json', 'node_modules/@jackwener/opencli/dist/src/main.js', 'node_modules/@jackwener/opencli/dist/src/daemon.js', 'node_modules/@jackwener/opencli/LICENSE')) {
  if (-not @($result.bundleFiles | Where-Object { $_.path -eq $required }).Count) { throw "Missing required desktop assistant runtime member: $required" }
}
$packageBytes = Get-NodePackageManifestBytes -ManifestPath "$project\package.json" -RemoveFields @('scripts', 'devDependencies', 'build')
$hasher = [System.Security.Cryptography.SHA256]::Create()
try { $generatedPackageSha = [BitConverter]::ToString($hasher.ComputeHash($packageBytes)).Replace('-', '') } finally { $hasher.Dispose() }
foreach ($file in $result.bundleFiles) {
  if ($file.path -eq 'package.json') {
    if ($file.bytes -ne $packageBytes.Length -or $file.sha256 -ne $generatedPackageSha) { throw 'Generated package manifest differs from the expected release metadata.' }
    continue
  }
  $source = Join-Path $project $file.path
  if ($file.path.StartsWith('dist/', [System.StringComparison]::Ordinal)) { $source = Join-Path $DistDirectory $file.path.Substring(5) }
  if ($file.path -eq 'node_modules/@jackwener/opencli/package.json') {
    # These metadata-only fields are stripped by electron-builder's fileTransformer.
    $normalizedBytes = Get-NodePackageManifestBytes -ManifestPath $source -RemoveFields @('dist','gitHead','build','jspm','ava','xo','nyc','eslintConfig','contributors','bundleDependencies','tags','scripts','keywords','bugs')
    $manifestHasher = [System.Security.Cryptography.SHA256]::Create()
    try { $normalizedSha = [BitConverter]::ToString($manifestHasher.ComputeHash($normalizedBytes)).Replace('-', '') } finally { $manifestHasher.Dispose() }
    if ($normalizedBytes.Length -ne $file.bytes -or $normalizedSha -ne $file.sha256) { throw 'Packaged OpenCLI manifest differs from the expected release dependency.' }
    continue
  }
  if (-not (Test-Path -LiteralPath $source) -or (Get-Item -LiteralPath $source).Length -ne $file.bytes -or (Get-FileHash -LiteralPath $source).Hash -ne $file.sha256) { throw "Packaged runtime differs from frozen source: $($file.path)" }
}
$sourceInputs = @()
foreach ($directory in @('src\avatar', 'src\pet', 'src\platform')) {
  foreach ($file in Get-ChildItem -LiteralPath (Join-Path $project $directory) -File -Recurse | Sort-Object FullName) {
    $sourceInputs += [ordered]@{ path=$file.FullName.Substring($project.Length+1).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $file.FullName).Hash }
  }
}
$ownedProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($result.runtimeRoot + '\', [System.StringComparison]::OrdinalIgnoreCase) })
if ($ownedProcesses.Count -gt 0) { throw 'Owned packaged runtime processes remained after smoke shutdown.' }
$metadata = [ordered]@{
  executable=$Executable
  distDirectory=$DistDirectory
  version=$version
  bytes=(Get-Item -LiteralPath $Executable).Length
  sha256=(Get-FileHash -LiteralPath $Executable).Hash
  authenticodeStatus=[string](Get-AuthenticodeSignature -LiteralPath $Executable).Status
  portableSmoke=$result
  restrictedPath=$true
  environmentIsolation=[ordered]@{
    freshProfile=$true
    profile=$isolation.isolated.PETPAL_SMOKE_PROFILE
    codexHome=$isolation.isolated.CODEX_HOME
    workspace=$isolation.isolated.PETPAL_WORKSPACE
    tempDirectory=$isolation.isolated.TEMP
    credentialEnvironmentCleared=$true
    inheritedElectronFlagsCleared=$true
    inheritedPortableFlagsCleared=$true
    optionalAppFixture=[bool]$AppFixture
    optionalPoses=[bool]$Poses
    restored=$true
  }
  petCornerAlpha=0
  ownedProcessesRemaining=$ownedProcesses.Count
  electronVersion=$result.electronVersion
  desktopAssistantReadOnlyStatus=$result.desktopTools
  realApiCalled=$false
  browserActionExecuted=$false
  musicActionExecuted=$false
  webIndexSha256=($result.bundleFiles | Where-Object { $_.path -eq 'dist/index.html' }).sha256
  webFilesCompared=@($result.bundleFiles | Where-Object { $_.path -like 'dist/*' }).Count
  packagedSourceFilesCompared=@($result.bundleFiles | Where-Object { $_.path -notlike 'dist/*' }).Count
  startupDiagnosticsCompared=@($result.bundleFiles | Where-Object { $_.path -eq 'desktop/startup-diagnostics.cjs' }).Count -eq 1
  generatedPackageSha256=$generatedPackageSha
  avatarResources=@($result.bundleFiles | Where-Object { $_.path -like 'dist/avatars/akari-cubism-v12/*' })
  sourceInputs=$sourceInputs
}
$metadataJson = $metadata | ConvertTo-Json -Depth 12
if ($MetadataPath) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $MetadataPath) -Force | Out-Null
  $metadataStream = [System.IO.File]::Open($MetadataPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try {
    $metadataBytes = [System.Text.Encoding]::UTF8.GetBytes($metadataJson + "`r`n")
    $metadataStream.Write($metadataBytes, 0, $metadataBytes.Length)
    $metadataStream.Flush($true)
  } finally { $metadataStream.Dispose() }
} else {
  # Preserve the legacy release-finalizer contract only when no isolated output was requested.
  $metadataJson | Set-Content -LiteralPath (Join-Path $project "evidence\native\windows-v$versionSeries-final.json") -Encoding utf8
  $metadataJson | Set-Content -LiteralPath (Join-Path $project 'evidence\native\windows-final.json') -Encoding utf8
}
Write-Output "PASS: Windows portable, local backend, bundled Codex/OpenCLI, read-only music status, restricted preload, live avatars, and transparent pet. Evidence: $EvidenceDirectory"
Get-FileHash -LiteralPath $Executable -Algorithm SHA256
