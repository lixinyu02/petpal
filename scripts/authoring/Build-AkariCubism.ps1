param(
  [Parameter(Mandatory = $true)][string]$JavaHome,
  [Parameter(Mandatory = $true)][string]$GradleExecutable,
  [string]$SourceDirectory,
  [string]$GradleUserHome,
  [string]$InputPsd,
  [string]$OutputDirectory,
  [ValidateSet('classic', 'continuous-body', 'stable-portrait')][string]$Profile = 'classic',
  [switch]$BuildUpstream,
  [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskManifest = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'psd2live-source-manifest.json') | ConvertFrom-Json
if (-not $SourceDirectory) { $SourceDirectory = Join-Path $taskRoot '.tools\psd2live-source' }
if (-not $GradleUserHome) { $GradleUserHome = Join-Path $taskRoot '.tools\psd2live-gradle' }
if (-not $InputPsd) {
  $taskAvatarSource = if ($Profile -eq 'stable-portrait') { 'akari-cubism-v4' } elseif ($Profile -eq 'continuous-body') { 'akari-cubism-v2' } else { 'akari-cubism' }
  $InputPsd = Join-Path $taskRoot "outputs\avatars\$taskAvatarSource\akari.psd"
}
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $taskRoot '.tools\cubism-authoring\model' }
$taskSource = (Get-Item -LiteralPath $SourceDirectory).FullName
$taskInput = (Get-Item -LiteralPath $InputPsd).FullName
$taskOutput = [IO.Path]::GetFullPath($OutputDirectory)
$taskRepoPrefix = $taskRoot.TrimEnd('\') + '\'
$taskJavaHome = (Get-Item -LiteralPath $JavaHome).FullName
$taskJava = Join-Path $taskJavaHome 'bin\java.exe'
$taskGradle = (Get-Item -LiteralPath $GradleExecutable).FullName
$taskCache = [IO.Path]::GetFullPath($GradleUserHome)
$taskWork = Join-Path $taskRoot '.tools\cubism-authoring'
$taskBuild = Join-Path $taskWork 'build'
$taskClasspathFile = Join-Path $taskWork 'runtime-classpath.txt'
if (-not $taskInput.StartsWith($taskRepoPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    -not $taskOutput.StartsWith($taskRepoPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'PSD and generated output must stay inside this repository.' }
if ($taskOutput.StartsWith((Join-Path $taskRoot 'public').TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Export to an authoring directory and review before updating public assets.' }
if (Test-Path -LiteralPath $taskOutput) {
  if (@(Get-ChildItem -LiteralPath $taskOutput -Force).Count) { throw 'Output is not empty. Use a new output directory to preserve previous assets.' }
}
foreach ($taskMember in $taskManifest.selected) {
  $taskTarget = Join-Path $taskSource $taskMember.path
  if (-not (Test-Path -LiteralPath $taskTarget -PathType Leaf) -or
      (Get-Item -LiteralPath $taskTarget).Length -ne $taskMember.bytes -or
      (Get-FileHash -LiteralPath $taskTarget -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskMember.sha256) {
    throw "Frozen upstream source changed or missing: $($taskMember.path)"
  }
}
New-Item -ItemType Directory -Path $taskWork -Force | Out-Null
$taskPreviousJavaHome = $env:JAVA_HOME
$taskPreviousSdkOptIn = $env:PSD2LIVE_INCLUDE_CUBISM
$env:JAVA_HOME = $taskJavaHome
$env:PSD2LIVE_INCLUDE_CUBISM = 'false'
try {
  $taskCommon = @('--no-daemon', '--console', 'plain', '--gradle-user-home', $taskCache,
    "-Dorg.gradle.java.installations.paths=$taskJavaHome", '-Dorg.gradle.java.installations.auto-download=false')
  if ($Offline) { $taskCommon += '--offline' }
  if ($BuildUpstream) {
    & $taskGradle @taskCommon '--project-dir' $taskSource '-Ppsd2live.includeCubism=false' 'writeRunArgs'
    if ($LASTEXITCODE -ne 0) { throw 'Pinned upstream compiler build failed.' }
  }
  $taskArgumentsFile = Join-Path $taskSource 'build\run\jvm.args'
  if (-not (Test-Path -LiteralPath $taskArgumentsFile)) { throw 'No compiled upstream classpath. Run again with -BuildUpstream; the first build needs dependency downloads.' }
  $taskArguments = @(Get-Content -LiteralPath $taskArgumentsFile | ForEach-Object { ConvertFrom-Json -InputObject $_ })
  $taskCpIndex = [Array]::IndexOf($taskArguments, '-cp')
  if ($taskCpIndex -lt 0 -or $taskCpIndex + 1 -ge $taskArguments.Length) { throw 'Frozen compiler launcher has no classpath.' }
  $taskClasspath = @($taskArguments[$taskCpIndex + 1] -split ';')
  foreach ($taskEntry in $taskClasspath) { if (-not (Test-Path -LiteralPath $taskEntry -PathType Leaf)) { throw 'Compiler classpath member is missing.' } }
  [IO.File]::WriteAllLines($taskClasspathFile, $taskClasspath, (New-Object Text.UTF8Encoding($false)))
  & $taskGradle @taskCommon '--project-dir' (Join-Path $PSScriptRoot 'cubism') '--project-cache-dir' (Join-Path $taskWork 'project-cache') "-Ppsd2liveClasspathFile=$taskClasspathFile" "-PauthoringBuildRoot=$taskBuild" 'classes'
  if ($LASTEXITCODE -ne 0) { throw 'Independent authoring runner build failed.' }
  $taskClasses = Join-Path $taskBuild 'classes\kotlin\main'
  $taskCp = (@($taskClasses) + $taskClasspath) -join ';'
  & $taskJava '-Xmx2g' '-Dfile.encoding=UTF-8' '-Djava.awt.headless=true' "-Dpetpal.authoring.projectRoot=$taskRoot" '-classpath' $taskCp 'PetPalAuthoringKt' $taskInput $taskOutput ($Profile.ToLowerInvariant())
  if ($LASTEXITCODE -ne 0) { throw 'Original Cubism model export failed.' }
  $taskGenerated = @(Get-ChildItem -LiteralPath $taskOutput -File -Recurse | ForEach-Object {
    [ordered]@{ path=$_.FullName.Substring($taskOutput.Length + 1).Replace('\','/'); bytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
  $taskRunnerSources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'cubism') -File -Recurse | ForEach-Object {
    [ordered]@{ path=$_.FullName.Substring($taskRoot.Length + 1).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
  $taskReceipt = [ordered]@{
    status='generated'; generatedAt=[DateTime]::UtcNow.ToString('o'); upstream=$taskManifest.upstream; commit=$taskManifest.commit;
    frozenSourceFiles=$taskManifest.selected.Count; sourceUnmodified=$true;
    authoringProfile=$Profile.ToLowerInvariant();
    inputPsdSha256=(Get-FileHash -LiteralPath $taskInput -Algorithm SHA256).Hash.ToLowerInvariant();
    runnerSources=$taskRunnerSources; generatedFiles=$taskGenerated; officialCoreValidation='Run verify-cubism-model.mjs separately';
    editorValidation='CMO3 has not been validated in official Cubism Editor';
    runtimeBoundary='Authoring compiler and runner are not embedded in PetPal app packages'
  }
  [IO.File]::WriteAllText((Join-Path $taskWork 'latest-authoring-receipt.json'), ($taskReceipt | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
  Write-Output "Generated original assets at $taskOutput; run the separate official Core validation before publishing."
} finally {
  $env:JAVA_HOME = $taskPreviousJavaHome
  $env:PSD2LIVE_INCLUDE_CUBISM = $taskPreviousSdkOptIn
}
