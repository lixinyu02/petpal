[CmdletBinding()]
param(
    [string]$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')),
    [string]$ConfigPath = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Service-Lifecycle.ps1')
$petpalRoot = [IO.Path]::GetFullPath($Root)
if ($petpalRoot -ne [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))) { throw 'Guardian root must match this checkout.' }
$petpalData = Join-Path $petpalRoot '.data'
if (-not $ConfigPath) { $ConfigPath = Join-Path $petpalData 'service-guardian.json' }
if ([IO.Path]::GetFullPath($ConfigPath) -ne (Join-Path $petpalData 'service-guardian.json')) { throw 'Unexpected guardian configuration path.' }
$petpalConfig = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($petpalConfig.schema -ne 1 -or [IO.Path]::GetFullPath($petpalConfig.root) -ne $petpalRoot -or $petpalConfig.port -ne 4318) { throw 'Invalid guardian scope.' }
if (-not (Test-Path -LiteralPath $petpalConfig.nodeExecutable -PathType Leaf)) { throw 'Missing fixed Node runtime.' }
$env:Path = (Split-Path $petpalConfig.nodeExecutable -Parent) + ';' + $env:Path
$petpalContext = [pscustomobject]@{
    Port=4318; Url='http://127.0.0.1:4318'; NodeExecutable=$petpalConfig.nodeExecutable
    Startup=(Join-Path $petpalRoot 'scripts/Start-PetPal-Service.ps1'); Receipt=(Join-Path $petpalData 'service-process.json')
    Pause=(Join-Path $petpalData 'service-maintenance'); Log=(Join-Path $petpalData 'service-guardian.events.jsonl')
}
# Retain the previous guardian's mutex so old and new entry points cannot overlap.
$petpalMutex = New-Object Threading.Mutex($false, 'Local\PetPalBackendGuardian.E_RK3566_petpal')
$petpalHasMutex = $false
try {
    try { $petpalHasMutex = $petpalMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $petpalHasMutex = $true }
    if (-not $petpalHasMutex) { exit 0 }
    Write-PetPalGuardianEvent $petpalContext 'guardian-started'
    $petpalState = [pscustomobject]@{ServiceId=0;Healthy=$null;Restoring=$false;CoolingDown=$false;RecentStarts=(New-Object 'Collections.Generic.Queue[datetime]')}
    while ($true) {
        Invoke-PetPalGuardianStep -Context $petpalContext -State $petpalState
        Start-Sleep -Seconds 10
    }
} catch {
    Write-PetPalGuardianEvent $petpalContext 'guardian-failed'
    exit 1
} finally {
    if ($petpalHasMutex) { $petpalMutex.ReleaseMutex() }
    $petpalMutex.Dispose()
}
