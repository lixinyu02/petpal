param(
  [ValidateSet('status','open','play','pause','next','previous')][string]$Action = 'status',
  [ValidateSet('qqmusic','netease')][string]$Player
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$players = @(
  @{ id='qqmusic'; name='QQ Music'; exe='QQMusic.exe'; pattern='(?i)QQMusic'; path=$null },
  @{ id='netease'; name='NetEase Cloud Music'; exe='cloudmusic.exe'; pattern='(?i)cloudmusic|netease-cloud-music'; path=$null }
)
function Find-PlayerPath($item) {
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    foreach ($branch in @('SOFTWARE', 'SOFTWARE\WOW6432Node')) {
      $key = "$hive\$branch\Microsoft\Windows\CurrentVersion\App Paths\$($item.exe)"
      $entry = Get-Item -LiteralPath $key -ErrorAction SilentlyContinue
      if ($entry) {
        $candidate = [string]$entry.GetValue('')
        if ($candidate) {
          $candidate = $candidate.Trim('"')
          if ([IO.Path]::GetFileName($candidate) -ieq $item.exe -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
        }
      }
    }
  }
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    foreach ($branch in @('SOFTWARE', 'SOFTWARE\WOW6432Node')) {
      $base = "$hive\$branch\Microsoft\Windows\CurrentVersion\Uninstall"
      foreach ($key in @(Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue)) {
        $meta = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
        if ($meta.DisplayName -notmatch $item.pattern -and $key.PSChildName -notmatch $item.pattern) { continue }
        $candidates = @()
        if ($meta.InstallLocation) { $candidates += Join-Path ([string]$meta.InstallLocation) $item.exe }
        if ($meta.DisplayIcon) { $candidates += ([string]$meta.DisplayIcon -replace ',\s*-?\d+$','').Trim('"') }
        foreach ($candidate in $candidates) {
          if ([IO.Path]::GetFileName($candidate) -ieq $item.exe -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
        }
      }
    }
  }
  return $null
}
function Await-Operation($operation, [Type]$resultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(6000)) { throw 'Media session timed out.' }
  return $task.Result
}
try {
  foreach ($item in $players) { $item.path = Find-PlayerPath $item }
  if ($Action -eq 'open') {
    $target = $players | Where-Object id -eq $Player
    if (-not $target.path) { throw 'Player is not installed.' }
    # This branch is the user's explicit Open action; show the requested player.
    # The parent PowerShell helper remains hidden, with no caller-controlled path or argument.
    Start-Process -FilePath $target.path -WindowStyle Normal | Out-Null
    @{ok=$true; message="Requested opening $($target.name)."} | ConvertTo-Json -Compress
    exit 0
  }
  $sessions = @(); $mediaError = $null
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
    $manager = Await-Operation ($managerType::RequestAsync()) $managerType
    $sessions = @($manager.GetSessions())
  } catch { $mediaError = 'Windows session does not provide GSMTC.' }
  if ($Action -eq 'status') {
    $result = @()
    foreach ($item in $players) {
      $matching = @($sessions | Where-Object { $_.SourceAppUserModelId -match $item.pattern })
      $row = @{id=$item.id;name=$item.name;installed=[bool]$item.path;session=$matching.Count -eq 1;controls=@()}
      if ($matching.Count -eq 1) {
        $info = $matching[0].GetPlaybackInfo(); $row.state = [string]$info.PlaybackStatus
        $controls = $info.Controls
        if ($controls.IsPlayEnabled) { $row.controls += 'play' }
        if ($controls.IsPauseEnabled) { $row.controls += 'pause' }
        if ($controls.IsNextEnabled) { $row.controls += 'next' }
        if ($controls.IsPreviousEnabled) { $row.controls += 'previous' }
      } else { $row.message = if ($matching.Count -gt 1) { 'Multiple matching media sessions; close duplicate players.' } else { 'No media session; open the player and play a song manually first.' } }
      $result += $row
    }
    @{ok=$true;players=$result;message=$mediaError} | ConvertTo-Json -Depth 5 -Compress
    exit 0
  }
  if ($mediaError) { throw $mediaError }
  $target = $players | Where-Object id -eq $Player
  $matching = @($sessions | Where-Object { $_.SourceAppUserModelId -match $target.pattern })
  if ($matching.Count -ne 1) { throw 'Cannot identify a unique player session. Open the player and play a song manually first.' }
  $session = $matching[0]; $controls = $session.GetPlaybackInfo().Controls
  $property = @{play='IsPlayEnabled';pause='IsPauseEnabled';next='IsNextEnabled';previous='IsPreviousEnabled'}[$Action]
  if (-not $controls.$property) { throw 'Player does not support this action now.' }
  $operation = switch ($Action) {
    'play' { $session.TryPlayAsync() }
    'pause' { $session.TryPauseAsync() }
    'next' { $session.TrySkipNextAsync() }
    'previous' { $session.TrySkipPreviousAsync() }
  }
  if (-not (Await-Operation $operation ([bool]))) { throw 'Player rejected the action.' }
  @{ok=$true;message="$($target.name) accepted the action."} | ConvertTo-Json -Compress
} catch {
  # Return only known operation diagnostics; no paths, process arguments or exception stacks.
  $message = [string]$_.Exception.Message
  if ($message -notmatch '^(Player |Windows session|Media session|Cannot identify)') { $message = 'Native music control is unavailable; check the player and desktop session.' }
  @{ok=$false;message=$message} | ConvertTo-Json -Compress
}
