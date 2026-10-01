param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskManifest = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'psd2live-source-manifest.json') | ConvertFrom-Json
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $taskRoot '.tools\psd2live-source' }
$taskOutput = [IO.Path]::GetFullPath($OutputDirectory)
$taskToolsPrefix = [IO.Path]::GetFullPath((Join-Path $taskRoot '.tools')).TrimEnd('\') + '\'
if (-not $taskOutput.StartsWith($taskToolsPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Authoring source must stay under this repository .tools directory.' }
$taskArchive = (Get-Item -LiteralPath $ArchivePath).FullName
if ((Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskManifest.sourceZipSha256) {
  throw 'Archive hash mismatch: obtain the exact pinned source archive before extraction.'
}
if (Test-Path -LiteralPath $taskOutput) {
  if (@(Get-ChildItem -LiteralPath $taskOutput -Force).Count) { throw 'Use a new empty source directory. Existing files are never replaced.' }
} else { New-Item -ItemType Directory -Path $taskOutput | Out-Null }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskZip = [IO.Compression.ZipFile]::OpenRead($taskArchive)
try {
  foreach ($taskMember in $taskManifest.selected) {
    if ($taskMember.path -match '(^/|\\|(^|/)\.\.(/|$)|:)') { throw 'Source manifest contains an unsafe member path.' }
    $taskMatches = @($taskZip.Entries | Where-Object {
      $taskSlash = $_.FullName.IndexOf('/')
      $taskSlash -ge 0 -and $_.FullName.Substring($taskSlash + 1) -ceq $taskMember.path
    })
    if ($taskMatches.Count -ne 1 -or $taskMatches[0].Length -ne $taskMember.bytes) { throw "Missing/ambiguous source member: $($taskMember.path)" }
    $taskTarget = [IO.Path]::GetFullPath((Join-Path $taskOutput $taskMember.path))
    if (-not $taskTarget.StartsWith($taskOutput.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source member escapes extraction directory.' }
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($taskTarget)) -Force | Out-Null
    $taskInput = $taskMatches[0].Open()
    $taskStream = [IO.File]::Open($taskTarget, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try { $taskInput.CopyTo($taskStream) } finally { $taskStream.Dispose(); $taskInput.Dispose() }
    if ((Get-FileHash -LiteralPath $taskTarget -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskMember.sha256) { throw "Source member hash mismatch: $($taskMember.path)" }
  }
} finally { $taskZip.Dispose() }
Write-Output "Extracted and verified $($taskManifest.selected.Count) frozen source members at $taskOutput. No wrapper JAR, sample models or SDK binaries were extracted."
