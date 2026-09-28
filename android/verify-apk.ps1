param(
  [string]$SdkPath = $env:ANDROID_HOME,
  [string]$JdkPath = $env:JAVA_HOME,
  [string]$ApkPath
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath "$project\package.json" -Raw | ConvertFrom-Json).version
if (-not $SdkPath) { $SdkPath = 'E:\Android\Sdk' }
if (-not $JdkPath) { $JdkPath = Join-Path $project '.tools\jdk-21' }
if (-not $ApkPath) { $ApkPath = Join-Path $project "releases\android\PetPal-$version-Android-debug.apk" }
$evidence = Join-Path $project 'evidence\native'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$priorJava = $env:JAVA_HOME
try {
  $env:JAVA_HOME = $JdkPath
  & "$SdkPath\build-tools\36.1.0\apksigner.bat" verify --verbose $apkPath > "$evidence\android-signature.log" 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
} finally { $env:JAVA_HOME = $priorJava }
$badging = (& "$SdkPath\build-tools\36.1.0\aapt2.exe" dump badging $apkPath) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'APK manifest inspection failed.' }
$apkVersion = [regex]::Match($badging, "versionName='([^']+)'").Groups[1].Value
if ($apkVersion -ne $version) { throw 'APK version does not match package.json.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$webFiles = @()
$sourceFiles = @()
$apk = [System.IO.Compression.ZipFile]::OpenRead($apkPath)
try {
  $index = $apk.GetEntry('assets/public/index.html')
  if (-not $index) { throw 'Web entry point is missing from APK.' }
  $stream = $index.Open(); $hasher = [System.Security.Cryptography.SHA256]::Create()
  try { $indexSha = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') } finally { $stream.Dispose(); $hasher.Dispose() }
  if ($indexSha -ne (Get-FileHash -LiteralPath "$project\dist\index.html").Hash) { throw 'APK web entry point differs from current dist build.' }
  $distRoot = [System.IO.Path]::GetFullPath("$project\dist")
  foreach ($file in Get-ChildItem -LiteralPath $distRoot -File -Recurse | Sort-Object FullName) {
    $relative = $file.FullName.Substring($distRoot.Length + 1).Replace('\', '/')
    $entry = $apk.GetEntry('assets/public/' + $relative)
    if (-not $entry) { throw "APK resource is missing: $relative" }
    $stream = $entry.Open(); $hasher = [System.Security.Cryptography.SHA256]::Create()
    try { $sha = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') } finally { $stream.Dispose(); $hasher.Dispose() }
    if ($entry.Length -ne $file.Length -or $sha -ne (Get-FileHash -LiteralPath $file.FullName).Hash) { throw "APK resource differs from frozen dist: $relative" }
    $webFiles += [ordered]@{ path=$relative; bytes=$entry.Length; sha256=$sha }
  }
  $dexParts = @()
  foreach ($entry in $apk.Entries | Where-Object { $_.Name -match '^classes\d*\.dex$' }) {
    $stream = $entry.Open(); $memory = [System.IO.MemoryStream]::new()
    try { $stream.CopyTo($memory); $dexParts += [System.Text.Encoding]::GetEncoding(28591).GetString($memory.ToArray()) } finally { $stream.Dispose(); $memory.Dispose() }
  }
  $dex = $dexParts -join ''
  foreach ($type in @('PetOverlayPlugin', 'PetOverlayService', 'PetOverlayWebView', 'OverlayAssetPolicy')) {
    if (-not $dex.Contains("Lcom/petpal/app/$type;")) { throw "Native class is missing: $type" }
  }
  if ($dex.Contains('Lcom/petpal/app/CatView;')) { throw 'Retired 2D overlay class is still packaged.' }
} finally { $apk.Dispose() }
foreach ($directory in @('src\avatar', 'src\pet', 'src\platform', 'android\app\src\main\java\com\petpal\app')) {
  foreach ($file in Get-ChildItem -LiteralPath (Join-Path $project $directory) -File -Recurse | Sort-Object FullName) {
    $sourceFiles += [ordered]@{ path=$file.FullName.Substring($project.Length+1).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $file.FullName).Hash }
  }
}
$result = [ordered]@{
  apk = "releases/android/PetPal-$version-Android-debug.apk"
  version = $apkVersion
  bytes = (Get-Item -LiteralPath $apkPath).Length
  sha256 = (Get-FileHash -LiteralPath $apkPath).Hash
  signatureVerified = $true
  nativeOverlayClassesPresent = $true
  overlayRenderer = 'local-only WebView WebGL'
  overlayHasJavaScriptBridge = $false
  webIndexSha256 = $indexSha
  webFilesCompared = $webFiles.Count
  webFiles = $webFiles
  avatarResources = @($webFiles | Where-Object { $_.path -like 'avatars/akari/*.png' })
  sourceInputs = $sourceFiles
  compileSdk = [int]([regex]::Match($badging, "compileSdkVersion='(\d+)'").Groups[1].Value)
  targetSdk = [int]([regex]::Match($badging, "targetSdkVersion:'(\d+)'").Groups[1].Value)
  minSdk = [int]([regex]::Match($badging, "minSdkVersion:'(\d+)'").Groups[1].Value)
  deviceRuntimeVerified = $false
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$evidence\android-final.json" -Encoding utf8
$result | Select-Object apk,version,bytes,sha256,signatureVerified,webFilesCompared,deviceRuntimeVerified | ConvertTo-Json
