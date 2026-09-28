param(
  [string]$SdkPath = $env:ANDROID_HOME,
  [string]$JdkPath = $env:JAVA_HOME,
  [string]$GradlePath,
  [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath "$project\package.json" -Raw | ConvertFrom-Json).version
if (-not $SdkPath -and (Test-Path -LiteralPath 'E:\Android\Sdk')) { $SdkPath = 'E:\Android\Sdk' }
if (-not $JdkPath -and (Test-Path -LiteralPath "$project\.tools\jdk-21")) { $JdkPath = "$project\.tools\jdk-21" }
if (-not $GradlePath) {
  $localGradle = "$project\.tools\gradle-8.11.1\bin\gradle.bat"
  $GradlePath = if (Test-Path -LiteralPath $localGradle) { $localGradle } else { "$project\android\gradlew.bat" }
}
if (-not $SdkPath -or -not (Test-Path -LiteralPath "$SdkPath\platform-tools")) { throw 'Set -SdkPath or ANDROID_HOME to an Android SDK with API 36.' }
if (-not $JdkPath -or -not (Test-Path -LiteralPath "$JdkPath\bin\java.exe")) { throw 'Set -JdkPath or JAVA_HOME to a JDK 21 installation.' }
$priorJava = $env:JAVA_HOME
$priorAndroid = $env:ANDROID_HOME
$priorPath = $env:PATH
Push-Location $project
try {
  $env:JAVA_HOME = $JdkPath
  $env:ANDROID_HOME = $SdkPath
  $env:PATH = "$JdkPath\bin;$env:PATH"
  if (-not $SkipWebBuild) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
  }
  & npx.cmd --no-install cap sync android
  if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
  Push-Location "$project\android"
  try {
    & $GradlePath --no-daemon --console plain assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
  } finally { Pop-Location }
  $output = Join-Path $project 'releases\android'
  New-Item -ItemType Directory -Path $output -Force | Out-Null
  Copy-Item -LiteralPath "$project\android\app\build\outputs\apk\debug\app-debug.apk" -Destination "$output\PetPal-$version-Android-debug.apk" -Force
  Get-FileHash -LiteralPath "$output\PetPal-$version-Android-debug.apk" -Algorithm SHA256
} finally {
  Pop-Location
  $env:JAVA_HOME = $priorJava
  $env:ANDROID_HOME = $priorAndroid
  $env:PATH = $priorPath
}
