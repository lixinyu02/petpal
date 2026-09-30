param(
  [string]$SdkPath = $env:ANDROID_HOME,
  [string]$JdkPath,
  [string]$GradlePath,
  [string]$WebDirectory,
  [string]$OutputDirectory,
  [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$androidConfig = Get-Content -LiteralPath "$project\android\app\build.gradle" -Raw
$versionMatch = [regex]::Match($androidConfig, 'versionName\s+"([0-9]+\.[0-9]+\.[0-9]+)"')
if (-not $versionMatch.Success) { throw 'Android versionName must be a semantic version.' }
$version = $versionMatch.Groups[1].Value
if (-not $WebDirectory) { $WebDirectory = if ($SkipWebBuild) { "$project\dist" } else { "$project\.data\android-web-build" } }
$WebDirectory = [IO.Path]::GetFullPath($WebDirectory)
if (-not $OutputDirectory) { $OutputDirectory = "$project\releases\android" }
if (-not $SdkPath -and (Test-Path -LiteralPath 'E:\Android\Sdk')) { $SdkPath = 'E:\Android\Sdk' }
if (-not $JdkPath) {
  $localJdk = "$project\.tools\jdk-21"
  $JdkPath = if (Test-Path -LiteralPath "$localJdk\bin\javac.exe" -PathType Leaf) { $localJdk } else { $env:JAVA_HOME }
}
if (-not $GradlePath) {
  $localGradle = "$project\.tools\gradle-8.11.1\bin\gradle.bat"
  $GradlePath = if (Test-Path -LiteralPath $localGradle) { $localGradle } else { "$project\android\gradlew.bat" }
}
if (-not $SdkPath -or -not (Test-Path -LiteralPath "$SdkPath\platform-tools")) { throw 'Set -SdkPath or ANDROID_HOME to an Android SDK with API 36.' }
if (-not $JdkPath -or -not (Test-Path -LiteralPath "$JdkPath\bin\java.exe" -PathType Leaf) -or -not (Test-Path -LiteralPath "$JdkPath\bin\javac.exe" -PathType Leaf) -or -not (Test-Path -LiteralPath "$JdkPath\release" -PathType Leaf)) { throw 'Set -JdkPath or JAVA_HOME to a JDK 21 installation.' }
$javaVersionMatch = [regex]::Match((Get-Content -LiteralPath "$JdkPath\release" -Raw), '(?m)^JAVA_VERSION="([0-9]+)(?:[."+\-])')
if (-not $javaVersionMatch.Success -or $javaVersionMatch.Groups[1].Value -ne '21') { throw 'Android requires JDK 21. Pass -JdkPath to a JDK 21 installation; older JAVA_HOME values are not supported.' }
$JdkPath = [IO.Path]::GetFullPath($JdkPath)
Write-Host "Android build uses JDK 21: $JdkPath"
$priorJava = $env:JAVA_HOME
$priorAndroid = $env:ANDROID_HOME
$priorPath = $env:PATH
$priorWebDirectory = $env:PETPAL_ANDROID_WEB_DIR
$priorAndroidVersion = $env:PETPAL_ANDROID_VERSION
Push-Location $project
try {
  $env:JAVA_HOME = $JdkPath
  $env:ANDROID_HOME = $SdkPath
  $env:PATH = "$JdkPath\bin;$env:PATH"
  $env:PETPAL_ANDROID_WEB_DIR = $WebDirectory
  $env:PETPAL_ANDROID_VERSION = $version
  if (-not $SkipWebBuild) {
    & npm.cmd run build -- --outDir $WebDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
  }
  if (-not (Test-Path -LiteralPath "$WebDirectory\index.html" -PathType Leaf)) { throw 'Android web build entry is missing.' }
  & npx.cmd --no-install cap sync android
  if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
  Push-Location "$project\android"
  try {
    & $GradlePath --no-daemon --console plain assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
  } finally { Pop-Location }
  $output = [IO.Path]::GetFullPath($OutputDirectory)
  New-Item -ItemType Directory -Path $output -Force | Out-Null
  $apk = "$project\android\app\build\outputs\apk\debug\app-debug.apk"
  $target = "$output\PetPal-$version-Android-debug.apk"
  if (Test-Path -LiteralPath $target) {
    if ((Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash) { throw 'An APK with this version already exists. Use a new version or output directory.' }
  } else { Copy-Item -LiteralPath $apk -Destination $target }
  Get-FileHash -LiteralPath "$output\PetPal-$version-Android-debug.apk" -Algorithm SHA256
} finally {
  Pop-Location
  $env:JAVA_HOME = $priorJava
  $env:ANDROID_HOME = $priorAndroid
  $env:PATH = $priorPath
  $env:PETPAL_ANDROID_WEB_DIR = $priorWebDirectory
  $env:PETPAL_ANDROID_VERSION = $priorAndroidVersion
}
