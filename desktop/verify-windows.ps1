param(
  [string]$Executable,
  [string]$EvidenceDirectory,
  [string]$DistDirectory,
  [string]$MetadataPath
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath "$project\package.json" -Raw | ConvertFrom-Json).version
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
$priorPath = $env:PATH
$priorOutput = $env:PETPAL_SMOKE_DIR
$priorProfile = $env:PETPAL_SMOKE_PROFILE
$startedAt = Get-Date
try {
  $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
  $env:PETPAL_SMOKE_DIR = $EvidenceDirectory
  $env:PETPAL_SMOKE_PROFILE = Join-Path $project ('.tools\desktop-smoke-profiles\' + [guid]::NewGuid().ToString('N'))
  $process = Start-Process -FilePath $Executable -ArgumentList '--smoke-test' -WorkingDirectory (Split-Path -Parent $Executable) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $EvidenceDirectory 'stdout.log') -RedirectStandardError (Join-Path $EvidenceDirectory 'stderr.log') -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Desktop smoke exited $($process.ExitCode)" }
} finally {
  $env:PATH = $priorPath
  $env:PETPAL_SMOKE_DIR = $priorOutput
  $env:PETPAL_SMOKE_PROFILE = $priorProfile
}
$resultPath = Join-Path $EvidenceDirectory 'result.json'
if (-not (Test-Path -LiteralPath $resultPath) -or (Get-Item -LiteralPath $resultPath).LastWriteTime -lt $startedAt) { throw 'Desktop did not write a fresh smoke result.' }
$result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
if (-not $result.health.ok -or -not $result.bridge.hasToken -or -not $result.uiReady -or -not $result.codex.available -or -not $result.pet.alwaysOnTop) { throw 'Desktop health, preload, ready UI, bundled Codex, or pet window check failed.' }
if (-not $result.loginGate.loginVisible -or -not $result.loginGate.protectedContentAbsent -or -not $result.loginGate.noStoredToken -or -not $result.loginGate.explicitOwnerLogin -or -not $result.loginGate.authenticated) { throw 'Desktop login gate or explicit owner login verification failed.' }
if ($result.health.version -ne $version) { throw 'Desktop backend version does not match this release.' }
$sourceManifest = Get-Content -LiteralPath "$project\package.json" -Raw | ConvertFrom-Json
if ($result.electronVersion -ne $sourceManifest.devDependencies.electron) { throw 'The final executable uses a different Electron version.' }
if (-not $result.desktopTools.opencli.available -or $result.desktopTools.opencli.version -ne '1.8.8' -or $result.desktopTools.opencli.runtime -ne 'bundled' -or -not $result.desktopTools.opencli.readOnlyProbe) { throw 'Bundled OpenCLI read-only status check failed.' }
if ($result.desktopTools.opencli.daemonState -notin @('stopped', 'external', 'unavailable')) { throw 'Smoke unexpectedly started or attached to an OpenCLI daemon.' }
if ($result.desktopTools.music.platform -ne 'win32' -or @($result.desktopTools.music.players | Where-Object { $_.id -in @('qqmusic', 'netease') }).Count -ne 2) { throw 'Windows music status did not report both supported players.' }
if (-not $result.is3d -or $result.renderer.main.petCount -ne 1 -or $result.renderer.pet.petCount -ne 1 -or $result.renderer.main.renderFrames -lt 2 -or $result.renderer.pet.renderFrames -lt 2) { throw 'Live single-cat 3D renderer verification failed.' }
if (-not $result.switchSynced -or $result.defaultAvatar -ne 'anime' -or $result.avatars.anime.main.renderer -ne 'mesh2d' -or $result.avatars.anime.pet.renderer -ne 'mesh2d' -or $result.avatars.anime.main.petCount -ne 1 -or $result.avatars.anime.pet.petCount -ne 1 -or $result.avatars.anime.main.renderFrames -lt 2 -or $result.avatars.anime.pet.renderFrames -lt 2) { throw 'Anime renderer or shared-window avatar selection verification failed.' }
$capability = $result.catCapability
if (-not $capability.defaultOff.choiceHidden -or $capability.defaultOff.settingsChecked -ne $false -or
  -not $capability.enabled.choiceVisible -or $capability.enabled.settingsChecked -ne $true -or -not $capability.enabled.clickedSettingsSwitch -or -not $capability.enabled.rawPreferenceUnchanged -or
  -not $capability.disabled.choiceHidden -or $capability.disabled.settingsChecked -ne $false -or -not $capability.disabled.clickedSettingsSwitch -or -not $capability.disabled.rawPreferenceUnchanged -or $capability.disabled.rawKindPreserved -ne 'cat' -or
  -not $capability.reloaded.choiceHidden -or $capability.reloaded.settingsChecked -ne $false -or -not $capability.reloaded.bothWindowsReloaded -or -not $capability.reloaded.rawPreferenceUnchanged -or $capability.reloaded.rawKindPreserved -ne 'cat' -or
  -not $capability.legacyPreferenceUnchanged) { throw 'Explicit cat capability UI, default-off, reload, or raw-preference preservation verification failed.' }
foreach ($phase in @('defaultOff', 'enabled', 'returned', 'disabled', 'reloaded')) {
  $expectedKind = if ($phase -eq 'enabled') { 'cat' } else { 'anime' }
  $expectedEnabled = $phase -in @('enabled', 'returned')
  foreach ($windowName in @('main', 'pet')) {
    $avatar = $capability.$phase.$windowName
    if ($avatar.kind -ne $expectedKind -or $avatar.display.version -ne 2 -or $avatar.display.kind -ne $expectedKind -or $avatar.display.catEnabled -ne $expectedEnabled -or -not $avatar.visible -or $avatar.canvasBounds.width -le 0 -or $avatar.canvasBounds.height -le 0 -or
      $avatar.canvasCount -ne 1 -or $avatar.petCount -ne 1 -or $avatar.renderFrames -lt 2 -or
      ($expectedKind -eq 'anime' -and $avatar.renderer -ne 'mesh2d')) { throw "Effective v2 display did not synchronize for $phase/$windowName." }
  }
}
Add-Type -AssemblyName System.Drawing
$pet = [System.Drawing.Bitmap]::FromFile((Join-Path $EvidenceDirectory 'pet.png'))
try { if ($pet.GetPixel(0,0).A -ne 0) { throw 'Pet window corner is not transparent.' } } finally { $pet.Dispose() }
if (-not $result.bundleFiles -or $result.bundleFiles.Count -lt 10) { throw 'Packaged runtime did not report resource byte evidence.' }
foreach ($required in @('desktop/window-layout.cjs', 'desktop/media-permissions.cjs', 'desktop/service-settings.cjs', 'desktop/startup-diagnostics.cjs', 'desktop/remote-http.cjs', 'server/agent-permissions.mjs', 'server/agent-tasks.mjs', 'server/attachments.mjs', 'server/downloads.mjs', 'server/codex-config.mjs', 'server/codex-transport.mjs', 'server/desktop-tools.mjs', 'server/music.mjs', 'server/opencli.mjs', 'server/native/music-windows.ps1', 'node_modules/@jackwener/opencli/package.json', 'node_modules/@jackwener/opencli/dist/src/main.js', 'node_modules/@jackwener/opencli/dist/src/daemon.js', 'node_modules/@jackwener/opencli/LICENSE')) {
  if (-not @($result.bundleFiles | Where-Object { $_.path -eq $required }).Count) { throw "Missing required desktop assistant runtime member: $required" }
}
$generatedPackage = Get-Content -LiteralPath "$project\package.json" -Raw | ConvertFrom-Json
# electron-builder removes build-time fields and writes its runtime manifest as two-space LF JSON.
foreach ($field in @('scripts', 'devDependencies', 'build')) { $generatedPackage.PSObject.Properties.Remove($field) }
$packageBytes = [System.Text.Encoding]::UTF8.GetBytes(($generatedPackage | ConvertTo-Json -Depth 20).Replace("`r`n", "`n"))
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
    $manifest = Get-Content -LiteralPath $source -Raw | ConvertFrom-Json
    # These metadata-only fields are stripped by electron-builder's fileTransformer.
    foreach ($field in @('dist','gitHead','build','jspm','ava','xo','nyc','eslintConfig','contributors','bundleDependencies','tags','scripts','keywords','bugs')) { $manifest.PSObject.Properties.Remove($field) }
    $normalizedBytes = [System.Text.Encoding]::UTF8.GetBytes(($manifest | ConvertTo-Json -Depth 100).Replace("`r`n", "`n"))
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
  avatarResources=@($result.bundleFiles | Where-Object { $_.path -like 'dist/avatars/akari/*.webp' })
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
