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

    It checks the host first and refuses before changing anything when the
    session is not elevated, Hyper-V is not enabled, the host is a failover
    cluster node, a VM or disk of the same name already exists, or there is
    not enough free disk space or memory. It never enables Hyper-V itself
    and never overwrites anything.

    The checksum file comes from GitHub on purpose: the image and its
    checksum are published on different hosts. A Hyper-V host without
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
    An existing External virtual switch to connect the VM to.

.PARAMETER NetAdapterName
    The physical network adapter for a new External switch.

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
    Answer yes to the confirmation prompts. It never confirms creating a
    switch, which interrupts the host's network: that needs
    -ConfirmNetworkInterruption.

.PARAMETER ConfirmNetworkInterruption
    With -NetAdapterName, confirms creating an External switch on that
    adapter without typing its name.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1 -ImagePath .\ProjectAchilles-2.7.0-hyperv.zip -Version 2.7.0

    Verifies the zip against the v2.7.0 release checksums and imports it.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1 -ImagePath D:\ProjectAchilles-2.7.0-hyperv.zip -ChecksumFile D:\appliance-SHA256SUMS

    The same on a host without internet access, with a copy of the release's
    checksum file.

.NOTES
    Exit codes: 0 the VM was created (and started unless -NoStart);
    1 refused or failed before any change; 2 failed after a change, with
    cleanup instructions printed.
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

# Thrown by Stop-Import; the main block turns it into the exit code.
$script:StopMarker = 'ACHILLES_IMPORT_STOP'
# Set once something on the host has changed (exit code 2 from then on).
$script:Changes = New-Object System.Collections.ArrayList

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
# Step 2: image
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
            # The host is online; the release has no such file.
            $message = "The v$Version release has no appliance-SHA256SUMS (HTTP 404). Check that -Version matches the image."
            $detail = New-Object System.Collections.ArrayList
            $page = $ReleaseBase
            if ($leaf -match '^ProjectAchilles-(.+)-hyperv\.zip$' -and $Matches[1] -ne $Version) {
                [void]$detail.Add("The image's file name says version $($Matches[1]): try -Version $($Matches[1]).")
                $page = "$ReleaseBase/tag/v$($Matches[1])"
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
    Write-Step 2 'Verifying the image'
    if ([string]::IsNullOrWhiteSpace($ChecksumFile)) { $source = Get-ReleaseSumsUrl } else { $source = $ChecksumFile }
    $sums = Get-ChecksumText
    $expected = Get-ExpectedHash $sums $source
    $isZip = [IO.Path]::GetExtension($ImagePath) -eq '.zip'
    if ($isZip) { Assert-HashMatches $ImagePath $expected $source }

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
        if ($isZip) {
            Write-Info "Extracting to $($script:Destination) (a few minutes)..."
            Expand-Archive -LiteralPath $ImagePath -DestinationPath $work
            $disks = @(Get-ChildItem -LiteralPath $work -Recurse -File -Filter '*.vhdx')
            if ($disks.Count -ne 1) {
                Stop-Import "The zip holds $($disks.Count) .vhdx files; the appliance zip holds exactly one."
            }
            $disk = $disks[0].FullName
        }
        else {
            # Hash the copy, not the source, so what was verified is what is used.
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
# Steps 3-5: switch, VM, start (not implemented yet)
# -----------------------------------------------------------------------------

function Select-VmSwitch {
    Write-Step 3 'Virtual switch'
    Write-Fail 'Switch selection, VM creation and start: not implemented yet (Task 2/3).'
    Write-Info "The verified disk is at $($script:TargetVhdx). Remove it with:"
    Write-Info "    Remove-Item -LiteralPath $(ConvertTo-Literal $script:TargetVhdx)"
    exit 1
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

try {
    Write-Host ''
    Write-Host '  ProjectAchilles appliance import for Hyper-V' -ForegroundColor Magenta
    Assert-Parameters
    Invoke-Preflight
    $vhdx = Get-VerifiedImage   # the VM's disk (Task 3)
    Select-VmSwitch
}
catch {
    if ([string]$_.Exception.Message -ne $script:StopMarker) {
        Write-Fail "Unexpected error: $($_.Exception.Message)"
    }
    if ($script:Changes.Count -gt 0) {
        Write-Info 'Changes made so far:'
        foreach ($c in $script:Changes) { Write-Info "    $c" }
        Write-Info "Remove the disk with: Remove-Item -LiteralPath $(ConvertTo-Literal $script:TargetVhdx)"
        exit 2
    }
    exit 1
}
