[CmdletBinding(SupportsShouldProcess=$true)]
param([string]$TaskName = 'PetPal backend current user')
$ErrorActionPreference = 'Stop'

function New-PetPalRecoveryTaskXml {
    param([Parameter(Mandatory=$true)][string]$ExistingXml, [Parameter(Mandatory=$true)][string]$Root)
    $rootPath = [IO.Path]::GetFullPath($Root)
    if ($rootPath -match '["\r\n]') { throw 'Unsupported service root.' }
    $document = New-Object Xml.XmlDocument
    $document.PreserveWhitespace = $true
    $document.LoadXml($ExistingXml)
    $namespace = New-Object Xml.XmlNamespaceManager($document.NameTable)
    $namespace.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
    $task = $document.SelectSingleNode('/t:Task', $namespace)
    $actions = @($document.SelectNodes('/t:Task/t:Actions/*', $namespace))
    if (-not $task -or $actions.Count -ne 1 -or $actions[0].LocalName -ne 'Exec') { throw 'Expected an existing single-action service task.' }
    $command = $actions[0].SelectSingleNode('t:Command', $namespace)
    $arguments = $actions[0].SelectSingleNode('t:Arguments', $namespace)
    $legacy = Join-Path $rootPath '.data/service-guardian.ps1'
    $managed = Join-Path $rootPath 'scripts/Watch-PetPal-Service.ps1'
    $expectedShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $legacyArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $legacy + '"'
    $managedArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $managed + '" -Root "' + $rootPath + '" -ConfigPath "' + (Join-Path $rootPath '.data/service-guardian.json') + '"'
    if (-not $command -or -not $arguments -or $command.InnerText -ine $expectedShell -or $arguments.InnerText -cnotin @($legacyArguments, $managedArguments)) { throw 'Existing task does not belong to this service guardian.' }
    $triggers = $task.SelectSingleNode('t:Triggers', $namespace)
    if (-not $triggers -or -not $triggers.SelectSingleNode('t:LogonTrigger', $namespace)) { throw 'Expected the existing logon trigger.' }
    $settings = $task.SelectSingleNode('t:Settings', $namespace)
    if (-not $settings) { throw 'Expected existing task settings.' }
    $policy = $settings.SelectSingleNode('t:MultipleInstancesPolicy', $namespace)
    if (-not $policy) { throw 'Expected existing task settings.' }
    $policy.InnerText = 'IgnoreNew'
    $arguments.InnerText = $managedArguments
    $recoveryId = 'PetPalGuardianRecovery'
    $existingRecovery = @($triggers.SelectNodes("*[@id='$recoveryId']"))
    foreach ($old in $existingRecovery) { [void]$triggers.RemoveChild($old) }
    $recovery = $document.CreateElement('TimeTrigger', $task.NamespaceURI)
    $recovery.SetAttribute('id', $recoveryId)
    $repetition = $document.CreateElement('Repetition', $task.NamespaceURI)
    $interval = $document.CreateElement('Interval', $task.NamespaceURI); $interval.InnerText = 'PT1M'
    $stop = $document.CreateElement('StopAtDurationEnd', $task.NamespaceURI); $stop.InnerText = 'false'
    [void]$repetition.AppendChild($interval); [void]$repetition.AppendChild($stop); [void]$recovery.AppendChild($repetition)
    $boundary = $document.CreateElement('StartBoundary', $task.NamespaceURI); $boundary.InnerText = [DateTime]::Now.AddMinutes(1).ToString('s')
    $enabled = $document.CreateElement('Enabled', $task.NamespaceURI); $enabled.InnerText = 'true'
    [void]$recovery.AppendChild($boundary); [void]$recovery.AppendChild($enabled); [void]$triggers.AppendChild($recovery)
    return $document.OuterXml
}

if ($TaskName -cne 'PetPal backend current user') { throw 'Only the existing PetPal backend task may be updated.' }
$petpalRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$petpalGuardian = Join-Path $petpalRoot 'scripts/Watch-PetPal-Service.ps1'
if (-not (Test-Path -LiteralPath $petpalGuardian -PathType Leaf)) { throw 'Missing managed guardian.' }
$petpalTask = Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
$petpalXml = Export-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
$petpalUpdatedXml = New-PetPalRecoveryTaskXml -ExistingXml $petpalXml -Root $petpalRoot
if ($PSCmdlet.ShouldProcess($TaskName, 'Update the existing guardian action and add one-minute recovery')) {
    # Preserve the task XML's principal, logon trigger and all other settings.
    # Updating the definition does not stop or start an existing guardian.
    Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -Xml $petpalUpdatedXml -Force -ErrorAction Stop | Out-Null
    @{updated=$true;taskName=$TaskName;recoveryInterval='PT1M';previousState=[string]$petpalTask.State} | ConvertTo-Json -Compress
}
