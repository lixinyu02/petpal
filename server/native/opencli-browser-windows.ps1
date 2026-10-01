param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('status', 'secure-directory', 'verify-installer', 'open-extension')]
    [string]$Action,
    [string]$TargetPath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$extensionUrl = 'https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk'

function Test-GoogleSignature([string]$FilePath) {
    $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
    return ($signature.Status -eq 'Valid' -and $null -ne $signature.SignerCertificate -and $signature.SignerCertificate.Subject -match '(?:^|,\s*)O=Google LLC(?:,|$)')
}

function Find-GoogleChrome {
    $candidates = @()
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if ($base) { $candidates += Join-Path $base 'Google\Chrome\Application\chrome.exe' }
    }
    foreach ($candidate in $candidates) {
        if ((Test-Path -LiteralPath $candidate -PathType Leaf) -and (Test-GoogleSignature $candidate)) {
            return [pscustomobject]@{ installed = $true; path = $candidate }
        }
    }
    return [pscustomobject]@{ installed = $false; path = $null }
}

try {
    switch ($Action) {
        'status' {
            if ($TargetPath) { throw 'Unexpected target' }
            Find-GoogleChrome | ConvertTo-Json -Compress
        }
        'secure-directory' {
            if (-not $TargetPath -or -not [System.IO.Path]::IsPathRooted($TargetPath)) { throw 'Invalid directory' }
            $directory = Get-Item -LiteralPath $TargetPath -Force
            if (-not $directory.PSIsContainer -or ($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe directory' }
            $acl = New-Object System.Security.AccessControl.DirectorySecurity
            $acl.SetAccessRuleProtection($true, $false)
            $owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
            $acl.SetOwner($owner)
            $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
            $propagation = [System.Security.AccessControl.PropagationFlags]::None
            foreach ($sid in @($owner, (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')))) {
                $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inheritance, $propagation, 'Allow')
                $acl.AddAccessRule($rule)
            }
            Set-Acl -LiteralPath $directory.FullName -AclObject $acl
            @{ secured = $true } | ConvertTo-Json -Compress
        }
        'verify-installer' {
            if (-not $TargetPath -or -not [System.IO.Path]::IsPathRooted($TargetPath) -or [System.IO.Path]::GetExtension($TargetPath) -ne '.msi') { throw 'Invalid installer' }
            $installer = Get-Item -LiteralPath $TargetPath -Force
            if ($installer.PSIsContainer -or ($installer.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe installer' }
            $valid = Test-GoogleSignature $installer.FullName
            @{ valid = $valid; publisher = $(if ($valid) { 'Google LLC' } else { $null }) } | ConvertTo-Json -Compress
        }
        'open-extension' {
            if ($TargetPath) { throw 'Unexpected target' }
            $chrome = Find-GoogleChrome
            if (-not $chrome.installed) { throw 'Chrome unavailable' }
            $start = New-Object System.Diagnostics.ProcessStartInfo
            $start.FileName = $chrome.path
            $start.Arguments = '--new-window ' + $extensionUrl
            $start.UseShellExecute = $false
            [System.Diagnostics.Process]::Start($start) | Out-Null
            @{ opened = $true } | ConvertTo-Json -Compress
        }
    }
} catch {
    # Do not expose usernames, command output, private profile paths, or certificates.
    [Console]::Error.WriteLine('Google Chrome preparation check failed.')
    exit 1
}
