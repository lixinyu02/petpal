param(
  [string]$SdkPath = $env:ANDROID_HOME,
  [string]$JdkPath = $env:JAVA_HOME,
  [string]$ApkPath,
  [Alias('DistDirectory')][string]$WebDirectory,
  [string]$EvidenceDirectory,
  [Alias('PriorApkPath')][string]$PreviousApkPath,
  [string]$Version,
  [long]$VersionCode = 0,
  [string]$ApplicationId = 'com.petpal.app',
  [string]$DefaultModelUrl
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
if (-not $SdkPath) { $SdkPath = 'E:\Android\Sdk' }
if (-not $JdkPath) { $JdkPath = Join-Path $project '.tools\jdk-21' }
$arguments = @((Join-Path $project 'scripts\verify-android-apk.mjs'), '--root', $project,
  '--sdk', [IO.Path]::GetFullPath($SdkPath), '--jdk', [IO.Path]::GetFullPath($JdkPath), '--application-id', $ApplicationId)
foreach ($argument in @(
  @('--apk', $ApkPath), @('--web-directory', $WebDirectory), @('--evidence-directory', $EvidenceDirectory),
  @('--previous-apk', $PreviousApkPath), @('--version', $Version), @('--default-model', $DefaultModelUrl)
)) {
  if ($argument[1]) { $arguments += $argument }
}
if ($VersionCode) { $arguments += @('--version-code', "$VersionCode") }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Android APK verification failed. See the selected evidence directory.' }
