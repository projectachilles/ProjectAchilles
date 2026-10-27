#Requires -Version 5.1

<#
.SYNOPSIS
    Imports the ProjectAchilles appliance into Hyper-V. Run it from an
    elevated prompt as: powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1 -ImagePath <zip> -Version <x.y.z>

.DESCRIPTION
    Verifies the appliance image against the SHA256 checksums published on
    the GitHub release, copies the disk to the Hyper-V disk folder, picks or
    creates an External virtual switch, creates a Generation 2 VM and
    starts it.

    The VM needs an External switch so that agents on the network can reach
    it. An existing one is reused. Otherwise the script lists the physical
    adapters that are up and creates "ProjectAchilles External" on the one
    you pick, after you type its name: creating it interrupts the host's
    network on that adapter for several seconds, so a Remote Desktop session
    over it disconnects. On its own it never picks the Default Switch or an
    Internal or Private switch (only -SwitchName can), and it never creates
    an Internal or NAT switch.

    It checks the host first and refuses before changing anything when the
    session is not elevated, Hyper-V is not enabled, the host is a failover
    cluster node, a VM or disk of the same name already exists, or there is
    not enough free disk space or memory. It never enables Hyper-V itself
    and never overwrites anything.

    The checksum file comes from the GitHub release on purpose: releases
    publish the image elsewhere (Cloudflare R2), so a forged image also needs
    a forged GitHub release. A checksum is not a signature: it proves the
    image matches what was published there. A Hyper-V host without
    internet access can use -ChecksumFile with a copy of
    appliance-SHA256SUMS. There is no way to skip verification.

    A script downloaded with a browser is blocked by the default execution
    policy. Run it with "powershell -NoProfile -ExecutionPolicy Bypass -File"
    as in the examples (-NoProfile keeps profile functions out of the run);
    do not dot-source it.

.PARAMETER ImagePath
    The appliance image: ProjectAchilles-<version>-hyperv.zip from the
    release, or a .vhdx whose file name is listed in the checksum file.

.PARAMETER Version
    The release version (for example 2.7.0). The script downloads
    appliance-SHA256SUMS from that GitHub release. Use either -Version or
    -ChecksumFile.

.PARAMETER ChecksumFile
    A local copy of the release's appliance-SHA256SUMS, for hosts without
    internet access. Use either -Version or -ChecksumFile.

.PARAMETER Name
    The VM name, also used for the disk file name. Default: ProjectAchilles.

.PARAMETER SwitchName
    An existing virtual switch to connect the VM to. Any switch is accepted;
    for an Internal or Private switch, or the Default Switch (NAT), the
    script warns that agents on the network will not reach the VM through it.

.PARAMETER NetAdapterName
    The physical network adapter for a new External switch, named
    "ProjectAchilles External". If that adapter already has an External
    switch, the VM uses it instead.

.PARAMETER VlanId
    An access VLAN ID (1-4094) for the VM's network adapter.

.PARAMETER MemoryGB
    Static memory for the VM in GB. Default 8, minimum 6.

.PARAMETER CpuCount
    Number of virtual processors. Default 4.

.PARAMETER Destination
    Folder for the VM's disk. Default: the host's Hyper-V virtual hard disk
    folder (Get-VMHost).VirtualHardDiskPath.

.PARAMETER NoStart
    Create the VM but do not start it.

.PARAMETER Yes
    Answer yes to the confirmation prompts, for example to reuse the host's
    only External switch. It never confirms creating a switch, which
    interrupts the host's network: that needs -NetAdapterName with
    -ConfirmNetworkInterruption. With several External switches, name one
    with -SwitchName.

.PARAMETER ConfirmNetworkInterruption
    With -NetAdapterName, confirms creating an External switch on that
    adapter without typing its name. Not enough when your own SSH or Remote
    Desktop session arrives over that adapter: then type the name, or pick
    another adapter.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1 -ImagePath .\ProjectAchilles-v2.7.0-hyperv.zip -Version 2.7.0

    Verifies the zip against the v2.7.0 release checksums and imports it.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1 -ImagePath D:\ProjectAchilles-v2.7.0-hyperv.zip -ChecksumFile D:\appliance-SHA256SUMS

    The same on a host without internet access, with a copy of the release's
    checksum file.

.NOTES
    Exit codes: 0 the VM was created (and started unless -NoStart);
    1 refused or failed before any change; 2 failed after a change, with
    cleanup instructions printed. After a failure the VM and its disk are
    kept; the script prints the commands that remove them.

    Once started, the script waits up to 5 minutes for the VM's IPv4
    address. No address in that time is not a failure: the VM's console
    shows what first boot needs.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ImagePath,
    [string]$Version,
    [string]$ChecksumFile,
    [string]$Name = 'ProjectAchilles',
    [string]$SwitchName,
    [string]$NetAdapterName,
    [int]$VlanId,
    [int]$MemoryGB = 8,
    [int]$CpuCount = 4,
    [string]$Destination,
    [switch]$NoStart,
    [switch]$Yes,
    [switch]$ConfirmNetworkInterruption
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Functions see their own $PSBoundParameters, so record this one here.
$VlanIdGiven = $PSBoundParameters.ContainsKey('VlanId')

# -----------------------------------------------------------------------------
# Constants
# -----------------------------------------------------------------------------

$TotalSteps = 5
$MinMemoryGB = 6
$DiskHeadroomBytes = 20GB
$ReleaseBase = 'https://github.com/projectachilles/ProjectAchilles/releases'
$ClientEnableCommand = 'Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All'
$ServerEnableCommand = 'Install-WindowsFeature -Name Hyper-V -IncludeManagementTools'
# The External switch this script creates when the host has none.
$NewSwitchName = 'ProjectAchilles External'
# Hyper-V's Default Switch (Internal, with NAT) has this ID on every host.
$DefaultSwitchId = 'c08cb7b8-9b3c-408e-8e30-5e16a3aeb444'

# Thrown by Stop-Import; the main block turns it into the exit code.
$script:StopMarker = 'ACHILLES_IMPORT_STOP'
# Set once something on the host has changed (exit code 2 from then on).
$script:Changes = New-Object System.Collections.ArrayList
# The adapter of the switch this run created, if it created one.
$script:CreatedSwitchAdapter = $null
# Adapters carrying the admin's own SSH/RDP session (Get-SessionAdapters).
$script:Sessions = @()
# The VM this run created, and whether it tried to start it (for cleanup).
$script:CreatedVmName = $null
$script:VmStartAttempted = $false

# Integration services by their fixed IDs: the names are localized ("Interfaz
# de servicio invitado" on a Spanish host). The English name is a fallback.
$GuestServiceInterfaceId = '6C09BB55-D683-4DA0-8931-C9BF705F6480'
$TimeSynchronizationId = '2497F4DE-E9FA-4204-80E4-4B75C46419C0'
# How long to wait for the VM's IPv4 address; ACHILLES_IMPORT_IP_TIMEOUT_S
# overrides it (the tests use 2 s).
$DefaultIpTimeoutS = 300
$MaxIpTimeoutS = 3600
$IpPollSeconds = 5

# -----------------------------------------------------------------------------
# Output helpers (same layout as scripts/Install-ProjectAchilles.ps1)
# -----------------------------------------------------------------------------

function Write-Step {
    param([int]$Number, [string]$Text)
    Write-Host ''
    Write-Host "  [$Number/$TotalSteps] " -ForegroundColor Cyan -NoNewline
    Write-Host $Text
}

function Write-Ok {
    param([string]$Text)
    Write-Host '         [OK] ' -ForegroundColor Green -NoNewline
    Write-Host $Text
}

function Write-Warn {
    param([string]$Text)
    Write-Host '         [!!] ' -ForegroundColor Yellow -NoNewline
    Write-Host $Text
}

function Write-Fail {
    param([string]$Text)
    Write-Host '       [FAIL] ' -ForegroundColor Red -NoNewline
    Write-Host $Text
}

function Write-Info {
    param([string]$Text)
    Write-Host "         $Text" -ForegroundColor DarkGray
}

# Prints why the import stops (plus optional detail lines) and ends the run.
# The main block catches the marker, so finally blocks still clean up.
function Stop-Import {
    param([string]$Message, [string[]]$Detail = @())
    Write-Fail $Message
    foreach ($line in $Detail) { Write-Info $line }
    throw $script:StopMarker
}

# A value quoted for a PowerShell command line the admin can copy.
function ConvertTo-Literal {
    param([string]$Text)
    "'" + $Text.Replace("'", "''") + "'"
}

function Format-GB {
    param([double]$Bytes)
    '{0:N1} GB' -f ($Bytes / 1GB)
}

# -----------------------------------------------------------------------------
# Host probes
# -----------------------------------------------------------------------------

# The test harness (tests/Test-ImportAchilles.ps1) simulates a non-elevated
# session by defining a global Test-AchillesImportElevated first. A function
# the script defines would take precedence over it, so the script defines its
# own only when none exists. The name is unique to this script so that a
# common helper in a profile (Test-IsAdministrator, say) can't stand in for
# it, and the caller accepts only a [bool] $true. Every other host query is a
# plain cmdlet call.
if (-not (Test-Path -LiteralPath 'function:\Test-AchillesImportElevated')) {
    function Test-AchillesImportElevated {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal $identity
        $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
}

# Free bytes on the volume that holds $Path, or $null when no local volume
# does (a UNC share). The volume is the one with the longest name (C:\,
# D:\Mounts\VMs\, ...) that prefixes the path, so a mount-point folder counts
# as its own volume rather than the drive that holds it.
function Get-FreeBytes {
    param([string]$Path)
    $sep = [IO.Path]::DirectorySeparatorChar
    $full = $Path.TrimEnd('\', '/') + $sep
    $best = $null
    foreach ($volume in @(Get-CimInstance -ClassName Win32_Volume)) {
        $volumeName = [string]$volume.Name
        if ([string]::IsNullOrEmpty($volumeName) -or $null -eq $volume.FreeSpace) { continue }
        if (-not $volumeName.EndsWith([string]$sep)) { $volumeName += $sep }
        if (-not $full.StartsWith($volumeName, [StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($null -eq $best -or $volumeName.Length -gt $best.Name.Length) {
            $best = @{ Name = $volumeName; Free = [long]$volume.FreeSpace }
        }
    }
    if ($null -eq $best) { return $null }
    $best.Free
}

# Uncompressed size of the image: the .vhdx inside a zip, or the .vhdx itself.
function Get-ImageSize {
    param([string]$Path)
    if ([IO.Path]::GetExtension($Path) -ne '.zip') { return [long](Get-Item -LiteralPath $Path).Length }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    try { $zip = [IO.Compression.ZipFile]::OpenRead($Path) }
    catch {
        Stop-Import "Cannot read $([IO.Path]::GetFileName($Path)) as a zip file: $($_.Exception.Message)" @('Download the image again.')
    }
    try {
        $total = [long]0
        foreach ($entry in $zip.Entries) { $total += $entry.Length }
        $total
    }
    finally { $zip.Dispose() }
}

function Resolve-FullPath {
    param([string]$Path)
    $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

# -----------------------------------------------------------------------------
# Parameters
# -----------------------------------------------------------------------------

# Checks that need no host access. Normalizes $ImagePath, $ChecksumFile and
# $Version in script scope.
function Assert-Parameters {
    if ($MemoryGB -lt $MinMemoryGB) {
        Stop-Import "-MemoryGB must be at least $MinMemoryGB (the appliance needs $MinMemoryGB GB; the default is 8)."
    }
    if ($CpuCount -lt 1) { Stop-Import '-CpuCount must be at least 1.' }
    if ($VlanIdGiven -and ($VlanId -lt 1 -or $VlanId -gt 4094)) { Stop-Import '-VlanId must be between 1 and 4094.' }
    if ([string]::IsNullOrWhiteSpace($Name) -or $Name.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
        Stop-Import "-Name '$Name' cannot be used: it is also the disk's file name."
    }

    $hasVersion = -not [string]::IsNullOrWhiteSpace($Version)
    $hasFile = -not [string]::IsNullOrWhiteSpace($ChecksumFile)
    if (-not $hasVersion -and -not $hasFile) {
        Stop-Import 'Say where the image checksums come from.' @(
            '-Version <x.y.z>        downloads appliance-SHA256SUMS from that GitHub release',
            '-ChecksumFile <path>    a copy of that file, for a host without internet access',
            'There is no way to skip verification.'
        )
    }
    if ($hasVersion -and $hasFile) { Stop-Import 'Use -Version or -ChecksumFile, not both.' }

    if ($hasVersion) {
        $v = $Version.Trim()
        if ($v.StartsWith('v') -or $v.StartsWith('V')) { $v = $v.Substring(1) }
        if ($v -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$') {
            Stop-Import "-Version '$Version' is not a release version such as 2.7.0."
        }
        $script:Version = $v
    }
    if ($hasFile) {
        $full = Resolve-FullPath $ChecksumFile
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Stop-Import "Checksum file not found: $full" }
        $script:ChecksumFile = $full
    }

    $img = Resolve-FullPath $ImagePath
    if (-not (Test-Path -LiteralPath $img -PathType Leaf)) { Stop-Import "Image not found: $img" }
    $ext = [IO.Path]::GetExtension($img).ToLowerInvariant()
    if ($ext -ne '.zip' -and $ext -ne '.vhdx') {
        Stop-Import "-ImagePath must be the release's ProjectAchilles-<version>-hyperv.zip or a .vhdx, not '$([IO.Path]::GetFileName($img))'."
    }
    $script:ImagePath = $img
}

# -----------------------------------------------------------------------------
# Step 1: preflight
# -----------------------------------------------------------------------------

# Refuses before anything changes. Sets $script:Destination and
# $script:TargetVhdx.
function Invoke-Preflight {
    Write-Step 1 'Checking this host'

    $elevated = Test-AchillesImportElevated
    if (-not ($elevated -is [bool] -and $elevated)) {
        Stop-Import 'This script needs an elevated session. Run PowerShell as Administrator (right-click, Run as administrator) and start it again.'
    }
    Write-Ok 'Running elevated'

    # Hyper-V: the feature must be enabled and its PowerShell module present.
    $os = Get-CimInstance -ClassName Win32_OperatingSystem
    $isServer = [int]$os.ProductType -ne 1
    $featureState = 'Unknown'
    try {
        if ($isServer) {
            $feature = Get-WindowsFeature -Name Hyper-V
            if ($feature -and $feature.Installed) { $featureState = 'Enabled' } else { $featureState = 'Disabled' }
        }
        else {
            $feature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V
            if ($feature) { $featureState = [string]$feature.State } else { $featureState = 'Disabled' }
        }
    }
    catch {
        Write-Warn "Could not read the Hyper-V feature state ($($_.Exception.Message)); checking the module only."
    }
    $module = @(Get-Module -ListAvailable -Name Hyper-V)
    $featureOk = ($featureState -eq 'Enabled' -or $featureState -eq 'Unknown')
    if (-not $featureOk -or $module.Count -eq 0) {
        if ($isServer) { $enable = $ServerEnableCommand } else { $enable = $ClientEnableCommand }
        $why = 'Hyper-V is not enabled on this host.'
        if ($featureState -eq 'EnablePending') { $why = 'Hyper-V is enabled but waits for a reboot.' }
        elseif ($featureOk) { $why = 'The Hyper-V PowerShell module is not installed.' }
        Stop-Import $why @(
            'Enable it from an elevated PowerShell prompt with:',
            "    $enable",
            'then reboot this host and run this script again. This script never enables Hyper-V itself.'
        )
    }
    Write-Ok 'Hyper-V is enabled'

    # Failover cluster nodes are out of scope: the switch must match on every
    # node and the VM belongs on a Cluster Shared Volume.
    $clusSvc = Get-Service -Name ClusSvc -ErrorAction SilentlyContinue
    if ($clusSvc -and [string]$clusSvc.Status -eq 'Running') {
        Stop-Import 'This host is a failover cluster node (the Cluster service is running).' @(
            'Clustered Hyper-V hosts are not supported: the virtual switch must match on every node',
            'and the VM belongs on a Cluster Shared Volume. Import on a standalone Hyper-V host.'
        )
    }
    Write-Ok 'Not a failover cluster node'

    # Never overwrite a VM. Compare names exactly: Get-VM -Name takes wildcards.
    $existing = @(Get-VM | Where-Object { $_.Name -eq $Name })
    if ($existing.Count -gt 0) {
        Stop-Import "A VM named '$Name' already exists. Nothing was changed." @(
            "Pick another name with -Name, or remove that VM first if it is a leftover: Remove-VM -Name $(ConvertTo-Literal $Name)"
        )
    }
    Write-Ok "No VM named '$Name' yet"

    if ([string]::IsNullOrWhiteSpace($Destination)) {
        $vmHost = Get-VMHost
        $script:Destination = [string]$vmHost.VirtualHardDiskPath
        if ([string]::IsNullOrWhiteSpace($script:Destination)) {
            Stop-Import 'Hyper-V has no default virtual hard disk folder. Pass one with -Destination.'
        }
    }
    $script:Destination = Resolve-FullPath $script:Destination
    $script:TargetVhdx = Join-Path $script:Destination "$Name.vhdx"
    if (Test-Path -LiteralPath $script:TargetVhdx) {
        Stop-Import "The disk $($script:TargetVhdx) already exists. Nothing was changed." @(
            'If it is left over from an earlier import that failed, remove it:',
            "    Remove-Item -LiteralPath $(ConvertTo-Literal $script:TargetVhdx)",
            'Otherwise pick another -Name or another -Destination.'
        )
    }
    Write-Ok "Disk will be $($script:TargetVhdx)"

    $needed = (Get-ImageSize $ImagePath) + $DiskHeadroomBytes
    $free = Get-FreeBytes $script:Destination
    if ($null -eq $free) {
        Write-Warn "Could not check the free space at $($script:Destination): it is not on a local volume (a network share?). Make sure it has $(Format-GB $needed) free."
    }
    elseif ($free -lt $needed) {
        Stop-Import "Not enough free disk space at $($script:Destination): $(Format-GB $free) free, $(Format-GB $needed) needed (the image plus 20 GB to grow)." @(
            'Free some space, or pick a folder on another volume with -Destination.'
        )
    }
    else { Write-Ok "Free disk space: $(Format-GB $free) (needs $(Format-GB $needed))" }

    $freeMemory = [double]$os.FreePhysicalMemory * 1KB
    if ($freeMemory -lt [double]$MemoryGB * 1GB) {
        Stop-Import "Not enough free memory: $(Format-GB $freeMemory) free, the VM needs $MemoryGB GB." @(
            "Stop other VMs or applications, or give the VM less with -MemoryGB (at least $MinMemoryGB)."
        )
    }
    Write-Ok "Free memory: $(Format-GB $freeMemory) (the VM gets $MemoryGB GB)"
    Write-Ok 'Preflight checks passed'
}

# -----------------------------------------------------------------------------
# Step 3: image
# -----------------------------------------------------------------------------

function Get-ReleaseSumsUrl { "$ReleaseBase/download/v$Version/appliance-SHA256SUMS" }

function Get-ImageHash {
    param([string]$Path)
    Write-Info "Computing the SHA256 of $([IO.Path]::GetFileName($Path)) (a large image takes a few minutes)..."
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# The HTTP status of a failed web request, or 0. Windows PowerShell 5.1
# throws a WebException and PowerShell 7 an HttpResponseException; both carry
# the status in .Response.StatusCode.
function Get-HttpStatus {
    param($Exception)
    $response = $Exception.PSObject.Properties['Response']
    if ($null -eq $response -or $null -eq $response.Value) { return 0 }
    $code = $response.Value.PSObject.Properties['StatusCode']
    if ($null -eq $code -or $null -eq $code.Value) { return 0 }
    [int]$code.Value
}

# The checksum file's text, from -ChecksumFile or the GitHub release. When the
# release can't be reached, prints the image's hash and stops.
function Get-ChecksumText {
    if (-not [string]::IsNullOrWhiteSpace($ChecksumFile)) {
        Write-Info "Checksums from $ChecksumFile"
        return [IO.File]::ReadAllText($ChecksumFile)
    }
    $url = Get-ReleaseSumsUrl
    Write-Info "Checksums from $url"
    try {
        # Windows PowerShell 5.1 on older hosts may not offer TLS 1.2 by default.
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing
        $content = $response.Content
        # An application/octet-stream body arrives as bytes.
        if ($content -is [byte[]]) { $content = [Text.Encoding]::ASCII.GetString($content) }
        return [string]$content
    }
    catch {
        $reason = $_.Exception.Message
        $status = Get-HttpStatus $_.Exception
        $leaf = [IO.Path]::GetFileName($ImagePath)
        $page = "$ReleaseBase/tag/v$Version"
        if ($status -eq 404) {
            # The host is online; the release has no such file. Image names
            # carry a v (git describe), -Version doesn't.
            $detail = New-Object System.Collections.ArrayList
            $page = $ReleaseBase
            if ($leaf -match '^ProjectAchilles-[vV]?(.+)-hyperv\.zip$' -and $Matches[1] -ne $Version) {
                $message = "The v$Version release has no appliance-SHA256SUMS (HTTP 404). Check that -Version matches the image."
                [void]$detail.Add("The image's file name says version $($Matches[1]): try -Version $($Matches[1]).")
                $page = "$ReleaseBase/tag/v$($Matches[1])"
            }
            else {
                $message = "The v$Version release has no appliance-SHA256SUMS (HTTP 404). Use -ChecksumFile with the appliance-SHA256SUMS that came with the image."
            }
        }
        else {
            Write-Fail "Could not download the checksum file: $reason"
            $message = 'The image cannot be verified without the checksum file.'
            $detail = New-Object System.Collections.ArrayList
        }
        $hash = Get-ImageHash $ImagePath
        Stop-Import $message (@($detail) + @(
            "SHA256 of ${leaf}:",
            "    $hash",
            'From a machine with internet access, compare it with appliance-SHA256SUMS on',
            "    $page",
            'then copy that file to this host and run again with -ChecksumFile <path>',
            '(instead of -Version).'
        ))
    }
}

# Expected SHA256 of the image's file name, from sha256sum lines
# "<hex>  <name>" (or "<hex> *<name>").
function Get-ExpectedHash {
    param([string]$Text, [string]$Source)
    $leaf = [IO.Path]::GetFileName($ImagePath)
    $found = New-Object System.Collections.ArrayList
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line -match '^([0-9A-Fa-f]{64}) [ *](.+?)\s*$') {
            $entry = $Matches[2]
            $entryLeaf = $entry.Substring($entry.LastIndexOf('/') + 1)
            if ($entryLeaf -eq $leaf) { [void]$found.Add($Matches[1].ToLowerInvariant()) }
        }
    }
    $distinct = @($found | Select-Object -Unique)
    if ($distinct.Count -eq 0) {
        Stop-Import "$leaf is not listed in $Source." @(
            'Use the checksum file from the same release as the image, and keep the image''s original file name.'
        )
    }
    if ($distinct.Count -gt 1) { Stop-Import "$leaf is listed more than once, with different hashes, in $Source." }
    $distinct[0]
}

function Assert-HashMatches {
    param([string]$Path, [string]$Expected, [string]$Source)
    $actual = Get-ImageHash $Path
    if ($actual -ne $Expected) {
        Stop-Import "The SHA256 of $([IO.Path]::GetFileName($ImagePath)) does not match $Source. Nothing was imported." @(
            "Expected: $Expected",
            "Actual:   $actual",
            'The file is damaged or is not the released image. Download it again.'
        )
    }
    Write-Ok "SHA256 matches $Source"
}

# Verifies the image, then puts the disk at <Destination>\<Name>.vhdx and
# returns that path. Work happens in a temp folder inside Destination (same
# volume, so the final move is a rename), which is always removed.
function Get-VerifiedImage {
    Write-Step 3 'Verifying the image'
    if ([string]::IsNullOrWhiteSpace($ChecksumFile)) { $source = Get-ReleaseSumsUrl } else { $source = $ChecksumFile }
    $sums = Get-ChecksumText
    $expected = Get-ExpectedHash $sums $source
    $isZip = [IO.Path]::GetExtension($ImagePath) -eq '.zip'

    # Folders this run creates for Destination, deepest first: removed again
    # if the image doesn't make it there.
    $createdDirs = New-Object System.Collections.ArrayList
    $dir = $script:Destination
    while (-not [string]::IsNullOrEmpty($dir) -and -not (Test-Path -LiteralPath $dir)) {
        [void]$createdDirs.Add($dir)
        $dir = [IO.Path]::GetDirectoryName($dir)
    }
    $placed = $false
    $work = Join-Path $script:Destination ('.achilles-import-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $oldProgress = $ProgressPreference
    try {
        if ($createdDirs.Count -gt 0) { New-Item -ItemType Directory -Path $script:Destination -Force | Out-Null }
        New-Item -ItemType Directory -Path $work | Out-Null
        # The progress bar makes Expand-Archive and Copy-Item on Windows
        # PowerShell 5.1 many times slower on a multi-GB file.
        $ProgressPreference = 'SilentlyContinue'
        # Hash a copy, not the source, so what was verified is what is used: the
        # source may sit in a folder anyone logged on can write to (Downloads),
        # and could be replaced between the hash and its use.
        if ($isZip) {
            Write-Info "Copying to $($script:Destination)..."
            $zip = Join-Path $work ([IO.Path]::GetFileName($ImagePath))
            Copy-Item -LiteralPath $ImagePath -Destination $zip
            Assert-HashMatches $zip $expected $source
            Write-Info "Extracting to $($script:Destination) (a few minutes)..."
            $unzipped = Join-Path $work 'image'
            Expand-Archive -LiteralPath $zip -DestinationPath $unzipped
            Remove-Item -LiteralPath $zip
            $disks = @(Get-ChildItem -LiteralPath $unzipped -Recurse -File -Filter '*.vhdx')
            if ($disks.Count -ne 1) {
                Stop-Import "The zip holds $($disks.Count) .vhdx files; the appliance zip holds exactly one."
            }
            $disk = $disks[0].FullName
        }
        else {
            Write-Info "Copying to $($script:Destination)..."
            $disk = Join-Path $work ([IO.Path]::GetFileName($ImagePath))
            Copy-Item -LiteralPath $ImagePath -Destination $disk
            Assert-HashMatches $disk $expected $source
        }
        Move-Item -LiteralPath $disk -Destination $script:TargetVhdx
        $placed = $true
        [void]$script:Changes.Add("disk $($script:TargetVhdx)")
    }
    finally {
        $ProgressPreference = $oldProgress
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        if (-not $placed) {
            foreach ($d in $createdDirs) {
                if ((Test-Path -LiteralPath $d) -and @(Get-ChildItem -LiteralPath $d -Force).Count -eq 0) {
                    Remove-Item -LiteralPath $d -Force -ErrorAction SilentlyContinue
                }
            }
        }
    }
    Write-Ok "Disk ready: $($script:TargetVhdx)"
    $script:TargetVhdx
}

# -----------------------------------------------------------------------------
# Step 2: virtual switch
# -----------------------------------------------------------------------------

# A property of a cmdlet object, or $null when it has none (StrictMode-safe).
function Get-PropValue {
    param($Object, [string]$Property)
    $p = $Object.PSObject.Properties[$Property]
    if ($null -eq $p) { return $null }
    $p.Value
}

# Hyper-V's Default Switch is Internal with NAT: agents on the LAN can't reach
# a VM behind it. It has this fixed ID on every host; the name is a fallback.
function Test-DefaultSwitch {
    param($Switch)
    ([string](Get-PropValue $Switch 'Id') -eq $DefaultSwitchId) -or ([string]$Switch.Name -eq 'Default Switch')
}

function Test-ExternalSwitch {
    param($Switch)
    ([string]$Switch.SwitchType -eq 'External') -and -not (Test-DefaultSwitch $Switch)
}

# Wi-Fi by the medium, never by the name (localized, and admins rename them):
# NdisPhysicalMedium 1 (wireless LAN) or 9 (native 802.11), or NdisMedium 16
# (native 802.11). PhysicalMediaType is the fallback; "Wireless WAN" is not
# Wi-Fi.
function Test-WirelessAdapter {
    param($Adapter)
    $physical = Get-PropValue $Adapter 'NdisPhysicalMedium'
    if ($null -ne $physical -and ([int]$physical -eq 1 -or [int]$physical -eq 9)) { return $true }
    $medium = Get-PropValue $Adapter 'NdisMedium'
    if ($null -ne $medium -and [int]$medium -eq 16) { return $true }
    [string](Get-PropValue $Adapter 'PhysicalMediaType') -match '802\.11|Wireless LAN'
}

# Wireless WAN (NdisPhysicalMedium 8, mobile broadband) and Bluetooth (10)
# adapters cannot be bound to a virtual switch.
function Test-SwitchableAdapter {
    param($Adapter)
    $physical = Get-PropValue $Adapter 'NdisPhysicalMedium'
    if ($null -ne $physical) { return -not ([int]$physical -eq 8 -or [int]$physical -eq 10) }
    [string](Get-PropValue $Adapter 'PhysicalMediaType') -notmatch '^(Wireless WAN|BlueTooth)$'
}

# A name without accents and case, for comparing what the admin typed: typed
# accents are unreliable (Windows PowerShell 5.1 with redirected input reads
# code page 850, and some clients send decomposed text), so "conexion de area
# local" confirms "Conexion de area local" with its accents.
function Get-FoldedName {
    param([string]$Text)
    $sb = New-Object System.Text.StringBuilder
    foreach ($c in ([string]$Text).Trim().Normalize([Text.NormalizationForm]::FormD).ToCharArray()) {
        if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$sb.Append($c)
        }
    }
    $sb.ToString().ToUpperInvariant()
}

function Test-SameFoldedName {
    param([string]$A, [string]$B)
    [string]::Equals((Get-FoldedName $A), (Get-FoldedName $B), [StringComparison]::Ordinal)
}

# The adapters that carry the admin's own session, as @{ Kind; Client;
# IfIndex }: SSH from $env:SSH_CONNECTION ("client cport server sport"), and
# Remote Desktop from the established connections on the RDP port. Advisory
# and fail-open: any error means none are known, and nothing changes.
function Get-SessionAdapters {
    $found = New-Object System.Collections.ArrayList
    try {
        $ssh = [string]$env:SSH_CONNECTION
        if (-not [string]::IsNullOrWhiteSpace($ssh)) {
            $parts = @($ssh.Trim() -split '\s+')
            if ($parts.Count -ge 3) {
                $client = ($parts[0] -split '%')[0]
                $server = ($parts[2] -split '%')[0]
                foreach ($ip in @(Get-NetIPAddress -IPAddress $server -ErrorAction Stop)) {
                    [void]$found.Add(@{ Kind = 'SSH'; Client = $client; IfIndex = [int]$ip.InterfaceIndex })
                }
            }
        }
        elseif ([string]$env:SESSIONNAME -like 'RDP-Tcp*') {
            $port = 3389
            $value = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name PortNumber -ErrorAction SilentlyContinue
            if ($null -ne $value -and $null -ne (Get-PropValue $value 'PortNumber')) { $port = [int]$value.PortNumber }
            foreach ($conn in @(Get-NetTCPConnection -State Established -LocalPort $port -ErrorAction Stop)) {
                $local = ([string]$conn.LocalAddress -split '%')[0]
                if ($local.StartsWith('::ffff:') -and $local.Contains('.')) { $local = $local.Substring(7) }
                foreach ($ip in @(Get-NetIPAddress -IPAddress $local -ErrorAction Stop)) {
                    [void]$found.Add(@{ Kind = 'Remote Desktop'; Client = [string]$conn.RemoteAddress; IfIndex = [int]$ip.InterfaceIndex })
                }
            }
        }
    }
    catch { return }
    @($found)
}

function Get-OwnSessions {
    param($Adapter)
    @($script:Sessions | Where-Object { $_.IfIndex -eq [int]$Adapter.ifIndex })
}

function Format-Switch {
    param($Switch)
    $desc = [string](Get-PropValue $Switch 'NetAdapterInterfaceDescription')
    if ($desc) { "'$($Switch.Name)' on $desc" } else { "'$($Switch.Name)'" }
}

# "name  -  description  -  IPv4  -  speed", for the admin to recognize the
# adapter (the IPv4 shows which one carries their own connection).
function Format-Adapter {
    param($Adapter)
    $ips = @()
    try {
        $ips = @(Get-NetIPAddress -InterfaceIndex ([int]$Adapter.ifIndex) -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            ForEach-Object { [string]$_.IPAddress })
    }
    catch { $ips = @() }
    if ($ips.Count -eq 0) { $ipText = 'no IPv4 address' } else { $ipText = $ips -join ', ' }
    $text = "$($Adapter.Name)  -  $($Adapter.InterfaceDescription)  -  $ipText"
    $speed = [string](Get-PropValue $Adapter 'LinkSpeed')
    if ($speed) { $text += "  -  $speed" }
    if (Test-WirelessAdapter $Adapter) { $text += '  (Wi-Fi: not recommended)' }
    foreach ($kind in @(Get-OwnSessions $Adapter | ForEach-Object { $_.Kind } | Select-Object -Unique)) {
        $text += "  (carries your $kind session)"
    }
    $text
}

function Get-AdapterLines {
    param([object[]]$Adapters)
    $lines = New-Object System.Collections.ArrayList
    $i = 0
    foreach ($a in $Adapters) { $i++; [void]$lines.Add("$i) $(Format-Adapter $a)") }
    @($lines)
}

# A number from 1 to $Count, read from the admin; anything else stops.
function Read-Choice {
    param([string]$Prompt, [int]$Count)
    $answer = ([string](Read-Host $Prompt)).Trim()
    $n = 0
    if (-not [int]::TryParse($answer, [ref]$n) -or $n -lt 1 -or $n -gt $Count) {
        Stop-Import "'$answer' is not a number from 1 to $Count. Nothing was changed."
    }
    $n
}

# Shows what creating the switch does and gets it confirmed: the typed adapter
# name, or -NetAdapterName with -ConfirmNetworkInterruption (not enough when
# the admin's own session arrives over that adapter). -Yes never confirms it.
# Returns the plan for Select-VmSwitch.
function Confirm-NewSwitch {
    param($Adapter, [object[]]$AllSwitches)
    $name = [string]$Adapter.Name
    $taken = @($AllSwitches | Where-Object { [string]$_.Name -eq $NewSwitchName })
    if ($taken.Count -gt 0) {
        Stop-Import "A virtual switch named '$NewSwitchName' already exists ($($taken[0].SwitchType)). Nothing was changed." @(
            'If it is an External switch, use it with -SwitchName; otherwise rename or remove it in Hyper-V Manager.'
        )
    }
    if (Test-WirelessAdapter $Adapter) {
        Write-Warn "'$name' is a Wi-Fi adapter. Not recommended: many access points drop the VM's traffic, so agents may not reach it."
    }
    Write-Warn "Creating an External switch on '$name' interrupts this host's network on that adapter for several seconds."
    Write-Warn 'A Remote Desktop session over it will disconnect and should reconnect; an SSH session over it may end, and this script with it.'
    Write-Info "The host's IP settings on '$name' move to a new adapter, ""vEthernet ($NewSwitchName)""."
    Write-Warn 'Connected over this adapter? Run this from the console or over another adapter instead.'
    $own = @(Get-OwnSessions $Adapter)
    foreach ($s in $own) {
        if ($s.Kind -eq 'SSH') {
            Write-Warn "Your SSH session (from $($s.Client)) arrives over '$name': creating the switch will end it, and this script with it."
        }
        else {
            Write-Warn "Your Remote Desktop session (from $($s.Client)) arrives over '$name': creating the switch will disconnect it."
        }
    }
    $unattended = "-NetAdapterName $(ConvertTo-Literal $name) -ConfirmNetworkInterruption"
    $confirmed = $ConfirmNetworkInterruption -and -not [string]::IsNullOrWhiteSpace($NetAdapterName)
    if ($ConfirmNetworkInterruption -and -not $confirmed) {
        Write-Info '-ConfirmNetworkInterruption confirms only together with -NetAdapterName: type the adapter name instead.'
    }
    if ($confirmed -and $own.Count -gt 0) {
        Write-Warn '-ConfirmNetworkInterruption is not enough here, because it would cut your own session: type the adapter name, or pick another adapter.'
        $confirmed = $false
    }
    if ($confirmed) {
        Write-Ok 'Confirmed with -NetAdapterName and -ConfirmNetworkInterruption'
    }
    elseif ($Yes) {
        $how = "Add $unattended, or run without -Yes and type the adapter name."
        if ($own.Count -gt 0) { $how = 'Run without -Yes and type the adapter name, pick another adapter, or run this from the console.' }
        Stop-Import '-Yes does not confirm creating a switch, because it interrupts the network. No switch was created and nothing was changed.' @($how)
    }
    else {
        $hint = ''
        if ($name -match '[^\x00-\x7F]') { $hint = '; accents are optional' }
        $typed = [string](Read-Host "Type the adapter name ($name$hint) to create the switch, or press Enter to stop")
        if ([string]::IsNullOrWhiteSpace($typed) -or -not (Test-SameFoldedName $typed $name)) {
            $detail = @("To confirm without typing, run again with $unattended.")
            if ($own.Count -gt 0) { $detail = @('Type the adapter name again (case and accents do not matter), pick another adapter, or run this from the console.') }
            Stop-Import "That is not '$name'. No switch was created and nothing was changed." $detail
        }
        Write-Ok "Confirmed: an External switch on '$name'"
    }
    Write-Info 'The switch is created in step 4, after the image is verified.'
    @{ Name = $NewSwitchName; Create = $true; AdapterName = $name }
}

# Decides which switch the VM uses, before anything on the host changes, so a
# refusal here leaves nothing behind (exit 1): an explicit -SwitchName (any
# switch, with a warning when agents can't reach the VM through it), an
# existing External switch (reusing interrupts nothing), or a new one on a
# physical adapter that is up. The automatic paths never pick an Internal or
# Private switch or the Default Switch. Returns @{ Name; Create; AdapterName }
# for Select-VmSwitch.
function Resolve-VmSwitch {
    Write-Step 2 'Virtual switch'
    $plan = Get-SwitchPlan
    if (-not $plan.Create -and $ConfirmNetworkInterruption) {
        Write-Info "-ConfirmNetworkInterruption is ignored: no switch is created (the VM uses '$($plan.Name)')."
    }
    $plan
}

function Get-SwitchPlan {
    $haveSwitchName = -not [string]::IsNullOrWhiteSpace($SwitchName)
    $haveAdapterName = -not [string]::IsNullOrWhiteSpace($NetAdapterName)
    if ($haveSwitchName -and $haveAdapterName) {
        Stop-Import 'Use -SwitchName (an existing switch) or -NetAdapterName (a new one), not both.'
    }
    $all = @(Get-VMSwitch)
    $external = @($all | Where-Object { Test-ExternalSwitch $_ })
    $externalLines = @($external | ForEach-Object { '    ' + (Format-Switch $_) })
    if ($externalLines.Count -eq 0) { $externalLines = @('    (none)') }

    if ($haveSwitchName) {
        $named = @($all | Where-Object { [string]$_.Name -eq $SwitchName })
        if ($named.Count -eq 0) {
            Stop-Import "There is no virtual switch named '$SwitchName'. External switches on this host:" $externalLines
        }
        if ($named.Count -gt 1) {
            Stop-Import "Several virtual switches are named '$SwitchName'. Rename them in Hyper-V Manager first."
        }
        $target = $named[0]
        if (Test-ExternalSwitch $target) {
            Write-Ok "The VM will connect to the External switch $(Format-Switch $target)"
        }
        else {
            # Spec 8.2 step 3: the admin may choose any switch explicitly.
            $isDefault = Test-DefaultSwitch $target
            $type = [string]$target.SwitchType
            if ($isDefault) { $kind = 'the Default Switch (NAT)' }
            elseif ($type -eq 'Internal') { $kind = 'an Internal switch' }
            elseif ($type -eq 'Private') { $kind = 'a Private switch' }
            else { $kind = "a $type switch" }
            Write-Warn "'$($target.Name)' is ${kind}: agents on your network will not reach the VM through it."
            if ($isDefault) {
                Write-Warn 'Its NAT address can change (after a host restart, for example), so agents set up with it may lose the server.'
            }
            Write-Ok "The VM will connect to '$($target.Name)', as -SwitchName asks"
        }
        return @{ Name = [string]$target.Name; Create = $false; AdapterName = $null }
    }

    if (-not $haveAdapterName -and $external.Count -eq 1) {
        Write-Info "External switch on this host: $(Format-Switch $external[0])"
        if (-not $Yes) {
            # Spanish keyboards answer "si" with an accent; Get-FoldedName drops it.
            $answer = Get-FoldedName (Read-Host "Connect the VM to '$($external[0].Name)'? [Y/n]")
            if (@('', 'Y', 'YES', 'S', 'SI') -notcontains $answer) {
                Stop-Import 'Nothing was changed.' @(
                    'Pick a switch with -SwitchName <name>, or create one on an adapter with -NetAdapterName <name>.'
                )
            }
        }
        Write-Ok "The VM will connect to the External switch $(Format-Switch $external[0])"
        return @{ Name = [string]$external[0].Name; Create = $false; AdapterName = $null }
    }
    if (-not $haveAdapterName -and $external.Count -gt 1) {
        Write-Info 'External switches on this host:'
        $i = 0
        foreach ($s in $external) { $i++; Write-Info "    $i) $(Format-Switch $s)" }
        if ($Yes) { Stop-Import 'There are several External switches: with -Yes, say which one with -SwitchName <name>. Nothing was changed.' }
        $pick = $external[(Read-Choice "Switch for the VM [1-$($external.Count)]" $external.Count) - 1]
        Write-Ok "The VM will connect to the External switch $(Format-Switch $pick)"
        return @{ Name = [string]$pick.Name; Create = $false; AdapterName = $null }
    }

    # A new switch (or one already on -NetAdapterName): physical adapters that
    # are up, and the ones of those that can carry a switch.
    $up = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up')
    $adapters = @($up | Where-Object { Test-SwitchableAdapter $_ })
    $cannot = @($up | Where-Object { -not (Test-SwitchableAdapter $_) })
    $script:Sessions = @(Get-SessionAdapters)
    $adapterLines = @(Get-AdapterLines $adapters)
    $cannotText = (@($cannot | ForEach-Object { "'$($_.Name)'" }) -join ', ')

    if ($haveAdapterName) {
        $match = @($up | Where-Object { [string]$_.Name -eq $NetAdapterName })
        if ($match.Count -eq 0) {
            $match = @($up | Where-Object { Test-SameFoldedName ([string]$_.Name) $NetAdapterName })
            if ($match.Count -gt 1) {
                Stop-Import "-NetAdapterName '$NetAdapterName' matches more than one adapter once accents are ignored. Use the exact name:" @(
                    $match | ForEach-Object { "    $(ConvertTo-Literal ([string]$_.Name))" })
            }
        }
        if ($match.Count -eq 0) {
            $list = $adapterLines
            if ($list.Count -eq 0) { $list = @('(none)') }
            Stop-Import "No physical network adapter named '$NetAdapterName' is up. Physical adapters that are up:" $list
        }
        $adapter = $match[0]
        if (-not (Test-SwitchableAdapter $adapter)) {
            Stop-Import "'$($adapter.Name)' is a wireless WAN or Bluetooth adapter: it cannot carry a virtual switch. Nothing was changed." @(
                'Pick a wired adapter (or Wi-Fi) with -NetAdapterName.'
            )
        }
        # An adapter carries at most one External switch: reuse the one it has.
        $bound = @($external | Where-Object { [string](Get-PropValue $_ 'NetAdapterInterfaceDescription') -eq [string]$adapter.InterfaceDescription })
        if ($bound.Count -gt 0) {
            Write-Ok "The VM will connect to the External switch $(Format-Switch $bound[0]) (already on '$($adapter.Name)'; nothing to create)"
            return @{ Name = [string]$bound[0].Name; Create = $false; AdapterName = $null }
        }
        return Confirm-NewSwitch $adapter $all
    }

    # No External switch yet: create one on a physical adapter.
    if (@($all | Where-Object { Test-DefaultSwitch $_ }).Count -gt 0) {
        Write-Info 'The Default Switch is not used: it is NAT, and agents on your network could not reach the VM through it.'
    }
    if ($cannot.Count -gt 0) {
        Write-Info "Not offered, because they cannot carry a virtual switch (wireless WAN, Bluetooth): $cannotText"
    }
    if ($adapters.Count -eq 0) {
        Stop-Import 'There is no External switch, and no physical network adapter is up to create one on. Nothing was changed.' @(
            'Connect a network cable (or enable the adapter) and run this again.'
        )
    }
    if ($Yes) {
        Stop-Import 'There is no External switch yet. Creating one interrupts the network, so -Yes alone does not do it. Nothing was changed.' (@(
            'Name the adapter with -NetAdapterName <name> -ConfirmNetworkInterruption, or run without -Yes. Physical adapters that are up:'
        ) + @($adapterLines | ForEach-Object { "    $_" }))
    }
    Write-Info 'No External switch yet. Physical network adapters that are up:'
    foreach ($line in $adapterLines) { Write-Info "    $line" }
    if ($adapters.Count -eq 1) { $adapter = $adapters[0] }
    else { $adapter = $adapters[(Read-Choice "Adapter for the new External switch [1-$($adapters.Count)]" $adapters.Count) - 1] }
    Confirm-NewSwitch $adapter $all
}

# Step 4, before the VM: creates the switch Resolve-VmSwitch planned (once the
# image is verified) and returns @{ Name; Created }. It never creates one the
# admin did not confirm, and never an Internal or NAT switch.
function Select-VmSwitch {
    param([hashtable]$Plan)
    if (-not $Plan.Create) { return @{ Name = $Plan.Name; Created = $false } }
    $adapter = $Plan.AdapterName
    Write-Info "Creating the External switch '$NewSwitchName' on '$adapter' (the network on that adapter drops for a few seconds)..."
    try {
        New-VMSwitch -Name $NewSwitchName -NetAdapterName $adapter -AllowManagementOS $true | Out-Null
    }
    catch {
        $reason = $_.Exception.Message
        # A switch that exists despite the error was still made by this run.
        try { if (@(Get-VMSwitch | Where-Object { [string]$_.Name -eq $NewSwitchName }).Count -gt 0) { Register-CreatedSwitch $adapter } }
        catch { Write-Warn "Could not check whether the switch exists: $($_.Exception.Message)" }
        Stop-Import "Could not create the External switch on '$adapter': $reason"
    }
    Register-CreatedSwitch $adapter
    Write-Ok "Created the External switch '$NewSwitchName' on '$adapter'"
    @{ Name = $NewSwitchName; Created = $true }
}

function Register-CreatedSwitch {
    param([string]$Adapter)
    $script:CreatedSwitchAdapter = $Adapter
    [void]$script:Changes.Add("virtual switch '$NewSwitchName' on '$Adapter'")
}

# -----------------------------------------------------------------------------
# Steps 4-5: the VM
# -----------------------------------------------------------------------------

# The appliance version for the VM's notes: -Version, else the image's file
# name (ProjectAchilles-v<version>-hyperv.zip or ProjectAchilles-v<version>.vhdx;
# appliance/Makefile names them from git describe), without the v like -Version.
function Get-ApplianceVersion {
    if (-not [string]::IsNullOrWhiteSpace($Version)) { return $Version }
    $leaf = [IO.Path]::GetFileName($ImagePath)
    if ($leaf -match '^ProjectAchilles-[vV]?([0-9][0-9A-Za-z.-]*?)(-hyperv)?\.(zip|vhdx)$') { return $Matches[1] }
    '(version unknown)'
}

# The VM's integration service with that ID, or with that English name.
function Find-IntegrationService {
    param([object[]]$Services, [string]$Id, [string]$EnglishName)
    $byId = @($Services | Where-Object { ([string](Get-PropValue $_ 'Id')).EndsWith('\' + $Id, [StringComparison]::OrdinalIgnoreCase) })
    if ($byId.Count -gt 0) { return $byId[0] }
    $byName = @($Services | Where-Object { [string]$_.Name -eq $EnglishName })
    if ($byName.Count -gt 0) { return $byName[0] }
    $null
}

function Register-CreatedVm {
    $script:CreatedVmName = $Name
    [void]$script:Changes.Add("VM '$Name'")
}

# Creates the VM on the verified disk with the appliance's settings (spec 8.2
# step 4) and returns it. Any failure after New-VM keeps the VM and the disk:
# the main block prints how to remove them (exit 2).
function New-AchillesVm {
    param([string]$VhdxPath, [string]$VmSwitchName)
    Write-Info "Creating the VM '$Name': Generation 2, $MemoryGB GB static memory, $CpuCount virtual processors, on '$VmSwitchName'..."
    $vm = $null
    try {
        $vm = New-VM -Name $Name -Generation 2 -MemoryStartupBytes ([long]$MemoryGB * 1GB) -VHDPath $VhdxPath -SwitchName $VmSwitchName -BootDevice VHD
    }
    catch {
        $reason = $_.Exception.Message
        # A VM that exists despite the error was still made by this run.
        try { if (@(Get-VM | Where-Object { $_.Name -eq $Name }).Count -gt 0) { Register-CreatedVm } }
        catch { Write-Warn "Could not check whether the VM exists: $($_.Exception.Message)" }
        Stop-Import "Could not create the VM '$Name': $reason"
    }
    Register-CreatedVm
    if ($null -eq $vm) { Stop-Import "New-VM returned no VM for '$Name'." }
    Write-Ok "Created the VM '$Name'"

    $notes = "ProjectAchilles appliance $(Get-ApplianceVersion), imported $([DateTime]::Now.ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture))"
    $doing = 'turn off dynamic memory'
    try {
        # Dynamic memory hurts the Elasticsearch JVM: memory is static.
        Set-VMMemory -VM $vm -DynamicMemoryEnabled $false | Out-Null
        $doing = "set $CpuCount virtual processors"
        Set-VMProcessor -VM $vm -Count $CpuCount | Out-Null
        # Ubuntu boots with Secure Boot only under the Microsoft UEFI CA template.
        $doing = 'turn on Secure Boot with the MicrosoftUEFICertificateAuthority template'
        Set-VMFirmware -VM $vm -EnableSecureBoot On -SecureBootTemplate MicrosoftUEFICertificateAuthority | Out-Null
        Write-Ok "Static memory $MemoryGB GB, $CpuCount virtual processors, Secure Boot (Microsoft UEFI CA)"
        # A server: no automatic checkpoints; starts with the host, shuts down with it.
        $doing = 'turn off automatic checkpoints and set the automatic start and stop actions'
        Set-VM -VM $vm -AutomaticCheckpointsEnabled $false -CheckpointType Production -AutomaticStartAction Start -AutomaticStartDelay 30 -AutomaticStopAction ShutDown -Notes $notes | Out-Null
        Write-Ok 'Automatic checkpoints off (Production checkpoints); starts with the host after 30 s, shuts down with it'
        $doing = 'turn on Guest Service Interface and Time Synchronization'
        $services = @(Get-VMIntegrationService -VM $vm)
        foreach ($wanted in @(@($GuestServiceInterfaceId, 'Guest Service Interface'), @($TimeSynchronizationId, 'Time Synchronization'))) {
            $service = Find-IntegrationService $services $wanted[0] $wanted[1]
            if ($null -eq $service) { throw "the VM has no '$($wanted[1])' integration service." }
            Enable-VMIntegrationService -VMIntegrationService $service | Out-Null
        }
        Write-Ok 'Guest Service Interface and Time Synchronization on'
        if ($VlanIdGiven) {
            $doing = "set access VLAN $VlanId on the VM's network adapter"
            Set-VMNetworkAdapterVlan -VM $vm -Access -VlanId $VlanId | Out-Null
            Write-Ok "Network adapter on access VLAN $VlanId"
        }
    }
    catch {
        if ([string]$_.Exception.Message -eq $script:StopMarker) { throw }
        Stop-Import "Could not $doing for the VM '$Name': $($_.Exception.Message)"
    }
    $vm
}

# A VM name for a command line: bare when that is safe, else quoted.
function Format-VmArgument {
    param([string]$VmName)
    if ($VmName -match '^[A-Za-z0-9._-]+$') { return $VmName }
    ConvertTo-Literal $VmName
}

# A Hyper-V command on this VM by exact name. -Name takes wildcards, so a
# name with [ ] * ? selects the VM with Where-Object instead.
function Format-VmCommand {
    param([string]$Command, [string]$Arguments)
    if ($Name.IndexOfAny([char[]]'[]*?`') -ge 0) { return "Get-VM | Where-Object Name -eq $(ConvertTo-Literal $Name) | $Command $Arguments" }
    "$Command -Name $(ConvertTo-Literal $Name) $Arguments"
}

function Get-IpTimeout {
    $raw = [string]$env:ACHILLES_IMPORT_IP_TIMEOUT_S
    $n = 0
    if (-not [string]::IsNullOrWhiteSpace($raw) -and [int]::TryParse($raw.Trim(), [ref]$n) -and $n -ge 1) {
        if ($n -gt $MaxIpTimeoutS) {
            Write-Info "ACHILLES_IMPORT_IP_TIMEOUT_S=$n is capped at $MaxIpTimeoutS s."
            return $MaxIpTimeoutS
        }
        return $n
    }
    $DefaultIpTimeoutS
}

# The VM's first IPv4 address (as Hyper-V reads it from the guest over KVP),
# skipping 169.254.x.x, or $null.
function Get-VmIPv4 {
    param($Vm)
    foreach ($adapter in @(Get-VMNetworkAdapter -VM $Vm)) {
        foreach ($address in @(Get-PropValue $adapter 'IPAddresses')) {
            $text = [string]$address
            $parsed = $null
            if ([Net.IPAddress]::TryParse($text, [ref]$parsed) -and
                $parsed.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and -not $text.StartsWith('169.254.')) {
                return $text
            }
        }
    }
    $null
}

# Polls for the address up to $TimeoutS seconds. Advisory: an error reading it
# ends the wait without failing the import.
function Wait-VmIPv4 {
    param($Vm, [int]$TimeoutS)
    $waited = 0
    while ($true) {
        try { $ip = Get-VmIPv4 $Vm }
        catch {
            Write-Warn "Could not read the VM's address: $($_.Exception.Message)"
            return $null
        }
        if ($ip) { return $ip }
        if ($waited -ge $TimeoutS) { return $null }
        $step = [Math]::Min($IpPollSeconds, $TimeoutS - $waited)
        Start-Sleep -Seconds $step
        $waited += $step
    }
}

# The Hyper-V console. vmconnect.exe ships with the Hyper-V management tools
# on desktop Windows and Server with Desktop Experience, not on Server Core.
# Only its presence is checked; it is never run.
function Write-ConsoleHint {
    $windir = [string]$env:windir
    $haveConsole = $false
    if (-not [string]::IsNullOrWhiteSpace($windir)) {
        $haveConsole = Test-Path -LiteralPath (Join-Path (Join-Path $windir 'System32') 'vmconnect.exe') -PathType Leaf
    }
    if ($haveConsole) {
        Write-Info "Open the console: vmconnect localhost $(Format-VmArgument $Name)"
    }
    else {
        Write-Info 'This host has no Hyper-V console (vmconnect.exe), as on Server Core. Open the VM from Hyper-V Manager'
        Write-Info 'on another computer for its first boot, and use SSH after first boot.'
    }
    Write-Info 'First boot asks on the console for: keyboard layout, admin password, network settings.'
}

# Starts the VM unless -NoStart, waits for its IPv4 address and says how to
# reach it (spec 8.2 step 5). No address in time is not a failure.
function Start-AndReport {
    param($Vm)
    Write-Step 5 'Starting the VM'
    if ($NoStart) {
        Write-Ok "The VM '$Name' is ready; not started (-NoStart)"
        $startCommand = (Format-VmCommand 'Start-VM' '').TrimEnd()
        Write-Info "Start it with: $startCommand"
        Write-Info 'Then:'
        Write-ConsoleHint
        return
    }
    $script:VmStartAttempted = $true
    try { Start-VM -VM $Vm | Out-Null }
    catch { Stop-Import "Could not start the VM '$Name': $($_.Exception.Message)" }
    Write-Ok "Started the VM '$Name'"
    # The console command comes before the wait so the admin can start first
    # boot in parallel; the report below repeats it.
    Write-Info 'First boot needs the console. You can open it now, while this waits:'
    Write-ConsoleHint
    $timeout = Get-IpTimeout
    Write-Info "Waiting up to $timeout s for its IPv4 address..."
    $ip = Wait-VmIPv4 $Vm $timeout
    if ($ip) {
        Write-Ok "The VM is running. Its IPv4 address: $ip"
    }
    else {
        Write-Warn "The VM is running but reported no IPv4 address within $timeout s. That is not an error: first boot waits"
        Write-Info 'on the console for its settings, and the network may have no DHCP. Look at the console:'
    }
    Write-ConsoleHint
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

try {
    Write-Host ''
    Write-Host '  ProjectAchilles appliance import for Hyper-V' -ForegroundColor Magenta
    Assert-Parameters
    Invoke-Preflight
    # The switch is decided (and a new one confirmed) before anything changes,
    # and only created once the image is verified.
    $switchPlan = Resolve-VmSwitch
    $vhdx = Get-VerifiedImage
    Write-Step 4 'Creating the VM'
    $vmSwitch = Select-VmSwitch $switchPlan   # @{ Name; Created }
    $vm = New-AchillesVm $vhdx $vmSwitch.Name
    Start-AndReport $vm
    Write-Host ''
    exit 0
}
catch {
    if ([string]$_.Exception.Message -ne $script:StopMarker) {
        Write-Fail "Unexpected error: $($_.Exception.Message)"
    }
    if ($script:Changes.Count -gt 0) {
        Write-Info 'Changes made so far:'
        foreach ($c in $script:Changes) { Write-Info "    $c" }
        if ($null -ne $script:CreatedVmName) {
            # The VM and its disk are kept; removing them is the admin's call.
            Write-Info 'The VM and its disk are kept. To remove them, run:'
            if ($script:VmStartAttempted) { Write-Info "    $(Format-VmCommand 'Stop-VM' '-TurnOff -Force')" }
            Write-Info "    $(Format-VmCommand 'Remove-VM' '-Force')"
            Write-Info "    Remove-Item -LiteralPath $(ConvertTo-Literal $script:TargetVhdx)"
        }
        else {
            Write-Info "Remove the disk with: Remove-Item -LiteralPath $(ConvertTo-Literal $script:TargetVhdx)"
        }
        if ($null -ne $script:CreatedSwitchAdapter) {
            # Only a switch this run created; a reused one is never offered.
            Write-Info "This run created the switch '$NewSwitchName'. If you don't need it, remove it with:"
            Write-Info "    Remove-VMSwitch -Name $(ConvertTo-Literal $NewSwitchName) -Force"
            Write-Info "(that interrupts the network on '$($script:CreatedSwitchAdapter)' again for a few seconds)."
        }
        exit 2
    }
    exit 1
}
