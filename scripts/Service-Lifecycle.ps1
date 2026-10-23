# Shared service lifecycle functions; dot-sourcing this file does not start a service.
function Write-PetPalAtomicReceipt {
    param([Parameter(Mandatory=$true)][string]$Path, [Parameter(Mandatory=$true)][object]$Value)
    $temporary = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
        for ($attempt = 0; ; $attempt++) {
            try {
                if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, [System.Management.Automation.Language.NullString]::Value) }
                else { [IO.File]::Move($temporary, $Path) }
                break
            } catch {
                $failure = $_.Exception.GetBaseException()
                $nativeError = $failure.HResult -band 65535
                if ($failure -isnot [IO.IOException] -or $attempt -ge 20 -or $nativeError -notin @(32, 33)) { throw }
                Start-Sleep -Milliseconds 50
            }
        }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

function ConvertTo-PetPalReceiptInstant {
    param([Parameter(Mandatory=$true)][AllowNull()][object]$Value)
    if ($Value -is [DateTimeOffset]) { return $Value }
    if ($Value -is [DateTime]) {
        if ($Value.Kind -eq [DateTimeKind]::Unspecified) { throw 'Receipt timestamp must include a timezone.' }
        return [DateTimeOffset]::new($Value)
    }
    if ($Value -isnot [string] -or $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$') { throw 'Receipt timestamp must include a timezone.' }
    $instant = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse($Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$instant)) { throw 'Invalid receipt timestamp.' }
    return $instant
}

function Read-PetPalReceiptJson {
    param([Parameter(Mandatory=$true)][string]$Raw)
    $options = @{}
    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) { $options.DateKind = 'String' }
    return $Raw | ConvertFrom-Json @options
}

function Read-PetPalReceiptFile {
    param([Parameter(Mandatory=$true)][string]$Path)
    for ($attempt = 0; ; $attempt++) {
        try { return Read-PetPalReceiptJson -Raw ([IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)) }
        catch {
            $failure = $_.Exception.GetBaseException()
            $nativeError = $failure.HResult -band 65535
            # ReplaceFile can briefly make a concurrent path lookup report
            # FILE_NOT_FOUND; retry only that lookup and sharing/lock conflicts.
            if ($failure -isnot [IO.IOException] -or $attempt -ge 20 -or $nativeError -notin @(2, 32, 33)) { throw }
            Start-Sleep -Milliseconds 50
        }
    }
}

function Get-PetPalOwnedService {
    param([Parameter(Mandatory=$true)][object]$Context)
    try { $record = Read-PetPalReceiptFile -Path $Context.Receipt }
    catch {
        $failure = $_.Exception.GetBaseException()
        if ($failure -is [IO.FileNotFoundException] -or $failure -is [IO.DirectoryNotFoundException]) { return $null }
        throw
    }
    if ($record.url -ne $Context.Url -or $record.pid -isnot [ValueType] -or $record.pid -lt 1 -or $record.pid -gt [int]::MaxValue -or [int]$record.pid -ne $record.pid) { throw 'Unexpected service receipt.' }
    $candidate = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
    if (-not $candidate) { return $null }
    $difference = [Math]::Abs(($candidate.StartTime.ToUniversalTime() - (ConvertTo-PetPalReceiptInstant -Value $record.startedAt).UtcDateTime).TotalSeconds)
    if ($difference -gt 2 -or $candidate.Path -ne $Context.NodeExecutable) { throw 'Service identity changed.' }
    $identity = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $candidate.Id)
    if (-not $identity -or $identity.CommandLine -notmatch '(?:^|\s)"?server/index\.mjs"?(?:\s|$)') { throw 'Unexpected service command.' }
    return $candidate
}

function Test-PetPalServiceHealth {
    param([Parameter(Mandatory=$true)][string]$Url)
    try {
        # Never inherit an OS proxy for the loopback health request.
        $request = [Net.HttpWebRequest]::Create($Url + '/api/health')
        $request.Proxy = $null
        $request.Timeout = 2000
        $request.ReadWriteTimeout = 2000
        $request.AllowAutoRedirect = $false
        $response = $null
        $reader = $null
        try {
            $response = $request.GetResponse()
            if ([int]$response.StatusCode -ne 200 -or $response.ContentLength -gt 65536) { return $false }
            $reader = [IO.StreamReader]::new($response.GetResponseStream())
            $buffer = New-Object char[] 65537
            $read = $reader.ReadBlockAsync($buffer, 0, $buffer.Length)
            if (-not $read.Wait(2000)) { return $false }
            $count = $read.Result
            if ($count -gt 65536) { return $false }
            $body = [string]::new($buffer, 0, $count) | ConvertFrom-Json
            return ($body.ok -is [bool] -and $body.ok -eq $true)
        } finally {
            $request.Abort()
            if ($reader) { $reader.Dispose() }
            if ($response) { $response.Dispose() }
        }
    } catch { return $false }
}

function Write-PetPalGuardianEvent {
    param([Parameter(Mandatory=$true)][object]$Context, [Parameter(Mandatory=$true)][string]$Event, [int]$ServiceId = 0)
    @{at=[DateTime]::UtcNow.ToString('o');event=$Event;servicePid=$ServiceId;guardianPid=$PID} | ConvertTo-Json -Compress | Add-Content -LiteralPath $Context.Log -Encoding UTF8
}

function Invoke-PetPalGuardianStep {
    param([Parameter(Mandatory=$true)][object]$Context, [Parameter(Mandatory=$true)][object]$State)
    if (Test-Path -LiteralPath $Context.Pause) { return }
    $service = Get-PetPalOwnedService -Context $Context
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Context.Port -ErrorAction SilentlyContinue)
    if (-not $service) {
        if ($listeners.Count -gt 0) { throw 'Unknown listener; guardian will not take over.' }
        if ($State.ServiceId -gt 0) { Write-PetPalGuardianEvent $Context 'service-exited' $State.ServiceId; $State.ServiceId = 0; $State.Healthy = $null }
        while ($State.RecentStarts.Count -gt 0 -and $State.RecentStarts.Peek() -lt [DateTime]::UtcNow.AddMinutes(-10)) { [void]$State.RecentStarts.Dequeue() }
        if ($State.RecentStarts.Count -ge 3) {
            if (-not $State.CoolingDown) { Write-PetPalGuardianEvent $Context 'service-restart-cooldown'; $State.CoolingDown = $true }
            return
        }
        $State.CoolingDown = $false
        $State.RecentStarts.Enqueue([DateTime]::UtcNow)
        try { & $Context.Startup -Port $Context.Port | Out-Null }
        catch { Write-PetPalGuardianEvent $Context 'service-start-unconfirmed' }
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        do {
            $service = Get-PetPalOwnedService -Context $Context
            if (-not $service) { Start-Sleep -Milliseconds 500 }
        } until ($service -or [DateTime]::UtcNow -gt $deadline)
        if (-not $service) { Write-PetPalGuardianEvent $Context 'service-start-failed'; return }
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Context.Port -ErrorAction SilentlyContinue)
        $State.Restoring = $true
    }
    if (@($listeners | Where-Object { $_.OwningProcess -ne $service.Id }).Count -gt 0) { throw 'Listener ownership mismatch.' }
    $healthy = $listeners.Count -gt 0 -and (Test-PetPalServiceHealth -Url $Context.Url)
    if ($healthy -and $State.Restoring) { Write-PetPalGuardianEvent $Context 'service-restored' $service.Id; $State.Restoring = $false }
    elseif ($healthy -and $State.Healthy -eq $false) { Write-PetPalGuardianEvent $Context 'service-recovered' $service.Id }
    elseif (-not $healthy -and ($null -eq $State.Healthy -or $State.Healthy)) { Write-PetPalGuardianEvent $Context 'service-degraded' $service.Id }
    if ($State.ServiceId -ne $service.Id) { Write-PetPalGuardianEvent $Context 'service-monitored' $service.Id }
    $State.ServiceId = $service.Id
    $State.Healthy = $healthy
}
