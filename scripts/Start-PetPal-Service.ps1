[CmdletBinding()]
param([ValidateRange(0,65535)][int]$Port = 0)
$ErrorActionPreference = 'Stop'

function Resolve-PetPalServiceNetworkSettings {
    param([AllowNull()][object]$Settings)
    $petpalListenHost = '127.0.0.1'
    [string[]]$petpalNetworkOrigins = @()
    if ($null -ne $Settings) {
        if ($Settings -isnot [System.Management.Automation.PSCustomObject]) { throw 'Service settings must be a JSON object.' }
        if ($Settings.PSObject.Properties.Name -contains 'host') {
            if ($Settings.host -isnot [string] -or $Settings.host -cnotin @('127.0.0.1', '0.0.0.0')) { throw 'Service host must be 127.0.0.1 or 0.0.0.0.' }
            $petpalListenHost = $Settings.host
        }
        if ($Settings.PSObject.Properties.Name -contains 'allowedOrigins') {
            if ($Settings.allowedOrigins -isnot [System.Array] -or $Settings.allowedOrigins.Count -gt 32) { throw 'allowedOrigins must be an array of at most 32 exact HTTP(S) origins.' }
            foreach ($petpalOrigin in $Settings.allowedOrigins) {
                if ($petpalOrigin -isnot [string] -or $petpalOrigin.Length -gt 2048 -or $petpalOrigin -match '[\x00-\x20\x7f]' -or $petpalOrigin -notmatch '^https?://[^/?#\\\s*@%]+$' -or $petpalOrigin.EndsWith(':')) { throw 'Each allowed origin must contain only an HTTP(S) scheme and authority, without credentials, path, wildcard, query or fragment.' }
                $petpalOriginUri = $null
                if (-not [System.Uri]::TryCreate($petpalOrigin, [System.UriKind]::Absolute, [ref]$petpalOriginUri) -or $petpalOriginUri.Scheme -notin @('http', 'https') -or -not $petpalOriginUri.Host -or $petpalOriginUri.UserInfo -or $petpalOriginUri.AbsolutePath -ne '/' -or $petpalOriginUri.Query -or $petpalOriginUri.Fragment -or $petpalOriginUri.Port -lt 1 -or $petpalOriginUri.Port -gt 65535) { throw 'Invalid HTTP(S) origin.' }
                $petpalNormalizedOrigin = $petpalOriginUri.GetLeftPart([System.UriPartial]::Authority)
                if ($petpalNetworkOrigins -notcontains $petpalNormalizedOrigin) { $petpalNetworkOrigins += $petpalNormalizedOrigin }
            }
        }
    }
    return [pscustomobject]@{ ListenHost = $petpalListenHost; NetworkOrigins = $petpalNetworkOrigins }
}

$petpalRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$petpalData = Join-Path $petpalRoot '.data'
$petpalSettings = Join-Path $petpalData 'service-settings.json'
$petpalConfiguredOrigins = ''
$petpalConfig = $null
if (Test-Path -LiteralPath $petpalSettings) {
    $petpalConfig = Get-Content -LiteralPath $petpalSettings -Raw | ConvertFrom-Json
    if ($Port -eq 0 -and $petpalConfig.port) { $Port = [int]$petpalConfig.port }
    if ($petpalConfig.codexHttpOrigins) { $petpalConfiguredOrigins = [string]$petpalConfig.codexHttpOrigins }
}
$petpalNetwork = Resolve-PetPalServiceNetworkSettings -Settings $petpalConfig
if ($Port -eq 0) { $Port = 4318 }
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Invalid local port.' }
if (-not (Test-Path -LiteralPath (Join-Path $petpalRoot 'dist/index.html'))) { throw 'Run npm run build before starting the service.' }
$petpalNode = (Get-Command node.exe -ErrorAction Stop).Source
$petpalUrl = 'http://127.0.0.1:' + $Port
$petpalListener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($petpalListener) {
    throw "Port $Port is already in use. The existing process has not been changed."
}
$petpalLogDir = Join-Path $petpalData 'service-logs'
New-Item -ItemType Directory -Path $petpalLogDir -Force | Out-Null
$petpalStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$petpalOut = Join-Path $petpalLogDir ($petpalStamp + '.stdout.log')
$petpalErr = Join-Path $petpalLogDir ($petpalStamp + '.stderr.log')
$petpalEnv = @{
    PETPAL_HOST = $petpalNetwork.ListenHost
    PETPAL_PORT = [string]$Port
    PETPAL_ALLOWED_ORIGINS = ($petpalNetwork.NetworkOrigins -join ',')
    PETPAL_DATA_DIR = $petpalData
    PETPAL_WORKSPACE = (Join-Path $petpalData 'workspace')
    PETPAL_CODEX_HTTP_ORIGINS = $petpalConfiguredOrigins
}
$petpalOldEnv = @{}
try {
    foreach ($petpalName in $petpalEnv.Keys) {
        $petpalOldEnv[$petpalName] = [Environment]::GetEnvironmentVariable($petpalName, 'Process')
        [Environment]::SetEnvironmentVariable($petpalName, $petpalEnv[$petpalName], 'Process')
    }
    $petpalProcess = Start-Process -FilePath $petpalNode -ArgumentList 'server/index.mjs' -WorkingDirectory $petpalRoot -WindowStyle Hidden -RedirectStandardOutput $petpalOut -RedirectStandardError $petpalErr -PassThru
} finally {
    foreach ($petpalName in $petpalOldEnv.Keys) { [Environment]::SetEnvironmentVariable($petpalName, $petpalOldEnv[$petpalName], 'Process') }
}
$petpalStarted = $petpalProcess.StartTime.ToUniversalTime().ToString('o')
@{pid=$petpalProcess.Id;startedAt=$petpalStarted;url=$petpalUrl;listenHost=$petpalNetwork.ListenHost;networkOrigins=@($petpalNetwork.NetworkOrigins);stdout=$petpalOut;stderr=$petpalErr} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $petpalData 'service-process.json') -Encoding UTF8
$petpalReady = $null
for ($petpalAttempt = 0; $petpalAttempt -lt 30; $petpalAttempt++) {
    $petpalProcess.Refresh()
    if ($petpalProcess.HasExited) { throw 'PetPal exited during startup. Inspect the private .data/service-logs directory.' }
    try { $petpalReady = Invoke-RestMethod -Uri ($petpalUrl + '/api/health') -TimeoutSec 2; if ($petpalReady.ok) { break } } catch {}
    Start-Sleep -Milliseconds 500
}
if (-not $petpalReady.ok) { throw 'PetPal is running but did not report healthy. Inspect the private service receipt and logs.' }
@{running=$true;url=$petpalUrl;listenHost=$petpalNetwork.ListenHost;networkOrigins=@($petpalNetwork.NetworkOrigins);pid=$petpalProcess.Id;version=$petpalReady.version;dataDirectory=$petpalData;pairingTokenFile=(Join-Path $petpalData 'token')} | ConvertTo-Json
