<#
.SYNOPSIS
    End-to-end test of appliance/windows/Import-Achilles.ps1.

.DESCRIPTION
    Runs the real import script, unmodified, in many scenarios against a
    simulated Hyper-V host. Every Hyper-V, CIM, feature, service and web
    command the script calls is replaced by a global function: PowerShell
    runs a function in preference to a cmdlet of the same name. The mocks
    read a per-scenario state hashtable ($global:HV) and log each call to
    $global:Calls as "<cmdlet> <args>", which the assertions inspect.
    Nothing touches real Hyper-V, the network, or anything outside the
    harness's own temp directory. Commands that would change a host and are
    not mocked yet throw, so a stray call fails loudly instead of running.

    Scenarios are the functions named Test<Area>_<Case> in this file; they
    run in the order they are written. Add one by writing a new function.

    Run it under both Windows PowerShell 5.1 (powershell.exe) and
    PowerShell 7 (pwsh). The script has to work on 5.1, and 5.1-only
    breakage does not show up under pwsh. The mocks make the harness
    host-independent, so pwsh on Linux works for a local loop.
    CI: .github/workflows/windows-installer.yml.

.PARAMETER Only
    Run only the scenarios whose name matches this wildcard pattern.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File appliance\windows\tests\Test-ImportAchilles.ps1

.EXAMPLE
    pwsh -NoProfile -File appliance/windows/tests/Test-ImportAchilles.ps1 -Only 'TestImage_*'
#>
param(
    [string]$Script = (Join-Path (Split-Path $PSScriptRoot -Parent) 'Import-Achilles.ps1'),
    [string]$Only = '*'
)
$ErrorActionPreference = 'Stop'
"PowerShell $($PSVersionTable.PSVersion) $($PSVersionTable.PSEdition)"

$script:fail = 0
function Check($name, [bool]$ok) { if ($ok) { "  PASS $name" } else { "  FAIL $name"; $script:fail = 1 } }

$root = Join-Path ([IO.Path]::GetTempPath()) ('pa-import-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $root | Out-Null

# ---- fixtures ---------------------------------------------------------------
# A small stand-in for the release zip: ProjectAchilles-<ver>-hyperv.zip
# holding ProjectAchilles-<ver>.vhdx, plus appliance-SHA256SUMS in sha256sum
# format ("<hex>  <name>"), the way appliance/Makefile writes them.
$FixVer = '9.9.9'
$FixDir = Join-Path $root 'fixtures'
New-Item -ItemType Directory -Path $FixDir | Out-Null
$stage = Join-Path $FixDir 'stage'
New-Item -ItemType Directory -Path $stage | Out-Null
$FixVhdxName = "ProjectAchilles-$FixVer.vhdx"
$FixZipName = "ProjectAchilles-$FixVer-hyperv.zip"
$vhdxBytes = New-Object byte[] 65536
(New-Object System.Random 42).NextBytes($vhdxBytes)
[IO.File]::WriteAllBytes((Join-Path $stage $FixVhdxName), $vhdxBytes)
$FixZip = Join-Path $FixDir $FixZipName
Compress-Archive -Path (Join-Path $stage $FixVhdxName) -DestinationPath $FixZip
$FixVhdx = Join-Path $FixDir $FixVhdxName
Copy-Item -LiteralPath (Join-Path $stage $FixVhdxName) -Destination $FixVhdx
$FixZipHash = (Get-FileHash -LiteralPath $FixZip -Algorithm SHA256).Hash.ToLowerInvariant()
$FixVhdxHash = (Get-FileHash -LiteralPath $FixVhdx -Algorithm SHA256).Hash.ToLowerInvariant()
$FixSumsText = "$FixZipHash  $FixZipName`n"
function New-SumsFile([string]$name, [string]$text) {
    $p = Join-Path $FixDir $name
    [IO.File]::WriteAllText($p, $text)
    $p
}
$FixSums = New-SumsFile 'appliance-SHA256SUMS' $FixSumsText
$FixReleaseUrl = "https://github.com/projectachilles/ProjectAchilles/releases/download/v$FixVer/appliance-SHA256SUMS"

# ---- simulated host ---------------------------------------------------------
# One state hashtable per scenario. Defaults describe a healthy, elevated
# Windows 11 client with Hyper-V enabled and plenty of disk and memory.
function New-HVState([string]$dir) {
    @{
        IsAdmin       = $true
        HyperVModule  = $true
        ProductType   = 1             # Win32_OperatingSystem: 1 client, 3 server
        FeatureState  = 'Enabled'     # client: Get-WindowsOptionalFeature State
        FeatureServer = $true         # server: Get-WindowsFeature Installed
        ClusSvc       = $null         # $null = not installed, or 'Running'/'Stopped'
        VMs           = New-Object System.Collections.ArrayList
        Switches      = New-Object System.Collections.ArrayList
        Adapters      = New-Object System.Collections.ArrayList
        VhdPath       = (Join-Path $dir 'vhd')
        FreeDiskBytes = 500GB
        FreeMemoryKB  = [long](32GB / 1KB)
        Web           = @{}           # url -> response body (string)
        IpSequence    = New-Object System.Collections.ArrayList
    }
}

# ---- mocks ------------------------------------------------------------------
$global:Calls = New-Object System.Collections.ArrayList
$global:Answers = New-Object System.Collections.Queue
$global:HV = $null

# Logs "<cmdlet> -Param value ..." with the parameters in the order the mock
# declares them, so assertions can compare exact argument strings.
function global:Add-MockCall($Command, $Bound) {
    $parts = New-Object System.Collections.ArrayList
    [void]$parts.Add($Command.Name)
    $ast = $Command.ScriptBlock.Ast
    if ($ast -is [System.Management.Automation.Language.FunctionDefinitionAst]) { $ast = $ast.Body }
    $declared = @()
    if ($null -ne $ast.ParamBlock) { $declared = $ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath } }
    foreach ($p in $declared) {
        if (-not $Bound.ContainsKey($p)) { continue }
        $v = $Bound[$p]
        if ($v -is [System.Management.Automation.SwitchParameter]) {
            if ($v.IsPresent) { [void]$parts.Add("-$p") } else { [void]$parts.Add("-${p}:`$false") }
        }
        else { [void]$parts.Add("-$p " + (Format-MockValue $v)) }
    }
    [void]$global:Calls.Add(($parts -join ' '))
}
function global:Format-MockValue($v) {
    if ($null -eq $v) { return '$null' }
    if ($v -is [bool]) { if ($v) { return '$true' } else { return '$false' } }
    if ($v -is [string]) { return "'" + $v.Replace("'", "''") + "'" }
    if ($v -is [array]) { return (@($v | ForEach-Object { Format-MockValue $_ }) -join ',') }
    return [string]$v
}

function global:Read-Host {
    param([Parameter(Position = 0)][string]$Prompt, [switch]$AsSecureString)
    [void]$global:Calls.Add("Read-Host $Prompt")
    if ($global:Answers.Count -eq 0) { throw "unscripted prompt: $Prompt" }
    return [string]$global:Answers.Dequeue()
}
function global:Test-IsAdministrator {
    [CmdletBinding()] param()
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    [bool]$global:HV.IsAdmin
}
function global:Get-Module {
    [CmdletBinding()] param([Parameter(Position = 0)][string[]]$Name, [switch]$ListAvailable)
    if (@($Name) -contains 'Hyper-V') {
        Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
        if ($global:HV.HyperVModule) { return [pscustomobject]@{ Name = 'Hyper-V'; Version = [version]'2.0.0.0' } }
        return
    }
    Microsoft.PowerShell.Core\Get-Module @PSBoundParameters
}
function global:Get-CimInstance {
    [CmdletBinding()] param([Parameter(Position = 0)][string]$ClassName)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    if ($ClassName -ne 'Win32_OperatingSystem') { throw "harness: Get-CimInstance $ClassName is not mocked" }
    [pscustomobject]@{
        Caption            = 'Microsoft Windows (mock)'
        ProductType        = [uint32]$global:HV.ProductType
        FreePhysicalMemory = [uint64]$global:HV.FreeMemoryKB
    }
}
function global:Get-WindowsOptionalFeature {
    [CmdletBinding()] param([switch]$Online, [string]$FeatureName)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    [pscustomobject]@{ FeatureName = $FeatureName; State = $global:HV.FeatureState }
}
function global:Get-WindowsFeature {
    [CmdletBinding()] param([Parameter(Position = 0)][string]$Name)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    [pscustomobject]@{ Name = $Name; Installed = [bool]$global:HV.FeatureServer }
}
function global:Get-Service {
    [CmdletBinding()] param([Parameter(Position = 0)][string]$Name)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    if ($Name -ne 'ClusSvc') { throw "harness: Get-Service $Name is not mocked" }
    if ($null -eq $global:HV.ClusSvc) {
        Write-Error "Cannot find any service with service name '$Name'."
        return
    }
    [pscustomobject]@{ Name = 'ClusSvc'; Status = $global:HV.ClusSvc }
}
function global:Get-VM {
    [CmdletBinding()] param([Parameter(Position = 0)][string]$Name)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    foreach ($vm in $global:HV.VMs) {
        if (-not $Name -or $vm.Name -like $Name) { $vm }
    }
}
function global:Get-VMHost {
    [CmdletBinding()] param()
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    [pscustomobject]@{ VirtualHardDiskPath = $global:HV.VhdPath }
}
# Every FileSystem drive reports the scenario's free space.
function global:Get-PSDrive {
    [CmdletBinding()] param([Parameter(Position = 0)][string[]]$Name, [string]$PSProvider)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    $roots = @([IO.Path]::GetPathRoot($root), [IO.Path]::GetPathRoot([string]$global:HV.VhdPath)) | Select-Object -Unique
    foreach ($r in $roots) { [pscustomobject]@{ Name = 'Mock'; Root = $r; Free = [long]$global:HV.FreeDiskBytes } }
}
# Answers from $HV.Web, the way Windows PowerShell 5.1 returns an
# application/octet-stream body (a byte array). Anything else is unreachable.
function global:Invoke-WebRequest {
    [CmdletBinding()] param([Parameter(Position = 0)][string]$Uri, [switch]$UseBasicParsing, [string]$OutFile)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    if (-not $global:HV.Web.ContainsKey($Uri)) {
        throw (New-Object System.Net.WebException "The remote name could not be resolved: 'github.com' (mock)")
    }
    [pscustomobject]@{ StatusCode = 200; Content = [Text.Encoding]::ASCII.GetBytes([string]$global:HV.Web[$Uri]) }
}

# Commands that change a host (or that later tasks will mock with state).
# Until a scenario needs them, any call is logged and fails the run.
$guarded = @(
    'Enable-WindowsOptionalFeature', 'Install-WindowsFeature', 'Restart-Computer',
    'New-VM', 'Remove-VM', 'Start-VM', 'Stop-VM', 'Set-VM', 'Set-VMFirmware', 'Set-VMMemory',
    'Set-VMProcessor', 'Enable-VMIntegrationService', 'Set-VMNetworkAdapterVlan',
    'Get-VMNetworkAdapter', 'Connect-VMNetworkAdapter', 'Add-VMHardDiskDrive', 'Set-VMHost',
    'Get-VMSwitch', 'New-VMSwitch', 'Remove-VMSwitch', 'Get-NetAdapter', 'vmconnect'
)
foreach ($n in $guarded) {
    Set-Item -Path "function:global:$n" -Value {
        [void]$global:Calls.Add("$($MyInvocation.MyCommand.Name) $args")
        throw "harness: $($MyInvocation.MyCommand.Name) is not mocked"
    }
}

# ---- runner -----------------------------------------------------------------
# Joins captured host output back into lines: Write-Host -NoNewline arrives
# as separate information records.
function ConvertTo-OutputText($records) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($r in @($records)) {
        if ($r -is [System.Management.Automation.InformationRecord] -and $r.MessageData -is [System.Management.Automation.HostInformationMessage]) {
            [void]$sb.Append($r.MessageData.Message)
            if (-not $r.MessageData.NoNewLine) { [void]$sb.Append("`n") }
        }
        else { [void]$sb.Append("$r`n") }
    }
    $sb.ToString()
}

# Runs the real script in a child scope with the mocks.
function Invoke-Import([hashtable]$Params, [string[]]$Answers) {
    $global:Calls.Clear()
    $global:Answers.Clear(); foreach ($a in @($Answers)) { $global:Answers.Enqueue($a) }
    $records = @()
    $global:LASTEXITCODE = 0
    try {
        $records = & $Script @Params *>&1
        $code = $LASTEXITCODE
    }
    catch {
        $code = "threw: $($_.Exception.Message)"
    }
    $text = ConvertTo-OutputText $records
    if ($code -is [string]) { $text += "$code`n" }
    @{ ExitCode = $code; Output = $text; Calls = @($global:Calls); AnswersLeft = $global:Answers.Count }
}

# Fresh per-scenario directory and host state.
function New-Scenario([string]$name) {
    $dir = Join-Path $root $name
    New-Item -ItemType Directory -Path $dir | Out-Null
    $global:HV = New-HVState $dir
    Write-Host ''
    Write-Host "== $name"
    $dir
}

# Prints the tail of the output when a scenario failed, to debug CI runs.
function Show-Output($r) {
    ($r.Output -split "`n") | Where-Object { $_.Trim() } | Select-Object -Last 12 | ForEach-Object { "     | $_" }
    "     | calls: " + ($r.Calls -join ' ; ')
}

function Test-Contains($r, [string]$text) { $r.Output.IndexOf($text, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
# True when a logged call is exactly $prefix or starts with "$prefix ".
function Test-Called($r, [string]$prefix) {
    @($r.Calls | Where-Object { $_ -eq $prefix -or $_.StartsWith("$prefix ", [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
}
$HyperVCommands = 'Get-VM', 'Get-VMHost', 'Get-VMSwitch', 'New-VM', 'New-VMSwitch', 'Get-WindowsOptionalFeature', 'Get-WindowsFeature', 'Get-Service'
function Test-NoHyperVCalls($r) {
    @($r.Calls | Where-Object { $HyperVCommands -contains ($_ -split ' ')[0] }).Count -eq 0
}
function Test-NoWork([string]$dest) {
    if (-not (Test-Path -LiteralPath $dest)) { return $true }
    @(Get-ChildItem -LiteralPath $dest -Force).Count -eq 0
}
function Expect([string]$name, $r, [bool]$ok) {
    Check $name $ok
    if (-not $ok) { Show-Output $r }
}
# Default parameters for a run that passes preflight with the fixtures.
function Get-BaseParams { @{ ImagePath = $FixZip; ChecksumFile = $FixSums } }

# ==== static =================================================================
# Windows PowerShell 5.1 reads a .ps1 without a BOM as Windows-1252. A UTF-8
# character such as an em dash then decodes to bytes that include 0x94, which
# PowerShell treats as a closing quote mark.
function TestStatic_PureAscii {
    ""
    "== static"
    foreach ($f in @($Script, $PSCommandPath)) {
        $ok = $false
        if (Test-Path -LiteralPath $f) { $ok = @([IO.File]::ReadAllBytes($f) | Where-Object { $_ -gt 0x7F }).Count -eq 0 }
        Check "$([IO.Path]::GetFileName($f)) is pure ASCII" $ok
    }
}

function TestStatic_Parses {
    $ok = $false
    if (Test-Path -LiteralPath $Script) {
        $tokens = $null; $parseErrors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$tokens, [ref]$parseErrors)
        $ok = $parseErrors.Count -eq 0
        foreach ($e in $parseErrors) { "     | line $($e.Extent.StartLineNumber): $($e.Message)" }
        $text = [IO.File]::ReadAllText($Script)
        Check 'script starts with #Requires -Version 5.1' ($text.StartsWith('#Requires -Version 5.1'))
        Check 'script sets StrictMode Latest and ErrorActionPreference Stop' ($text.Contains('Set-StrictMode -Version Latest') -and $text.Contains("`$ErrorActionPreference = 'Stop'"))
    }
    Check 'script parses' $ok
}

# A script downloaded from a browser carries the Mark of the Web; the help must
# show the invocation that works under the default execution policy. This also
# catches a help block that PowerShell ignores: a comment directly on the line
# after #Requires (no blank line between) hides the whole block from Get-Help.
function TestStatic_HelpShowsBypassFile {
    $ok = $false
    if (Test-Path -LiteralPath $Script) {
        $tokens = $null; $parseErrors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$tokens, [ref]$parseErrors)
        $help = $ast.GetHelpContent()
        if ($null -ne $help) {
            $all = [string]$help.Synopsis + "`n" + (@($help.Examples) -join "`n")
            $ok = $all.Contains('powershell -ExecutionPolicy Bypass -File .\Import-Achilles.ps1')
        }
    }
    Check 'help (.SYNOPSIS/.EXAMPLE) shows powershell -ExecutionPolicy Bypass -File' $ok
}

# ==== preflight ==============================================================
function TestPreflight_NotElevatedRefuses {
    $null = New-Scenario 'preflight-not-elevated'
    $global:HV.IsAdmin = $false
    $r = Invoke-Import (Get-BaseParams)
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'says Run PowerShell as Administrator' $r (Test-Contains $r 'Run PowerShell as Administrator')
    Expect 'no Hyper-V calls' $r (Test-NoHyperVCalls $r)
}

function TestPreflight_HyperVMissingPrintsEnableCommand {
    $clientCmd = 'Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All'
    $serverCmd = 'Install-WindowsFeature -Name Hyper-V -IncludeManagementTools'

    $null = New-Scenario 'preflight-hyperv-missing-client'
    $global:HV.HyperVModule = $false
    $global:HV.FeatureState = 'Disabled'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'client: exit 1' $r ($r.ExitCode -eq 1)
    Expect 'client: prints the Enable-WindowsOptionalFeature command' $r (Test-Contains $r $clientCmd)
    Expect 'client: does not print the server command' $r (-not (Test-Contains $r $serverCmd))
    Expect 'client: mentions the reboot' $r (Test-Contains $r 'reboot')
    Expect 'client: never runs either command' $r (-not (Test-Called $r 'Enable-WindowsOptionalFeature') -and -not (Test-Called $r 'Install-WindowsFeature'))

    $null = New-Scenario 'preflight-hyperv-missing-server'
    $global:HV.ProductType = 3
    $global:HV.HyperVModule = $false
    $global:HV.FeatureServer = $false
    $r = Invoke-Import (Get-BaseParams)
    Expect 'server: exit 1' $r ($r.ExitCode -eq 1)
    Expect 'server: prints the Install-WindowsFeature command' $r (Test-Contains $r $serverCmd)
    Expect 'server: does not print the client command' $r (-not (Test-Contains $r $clientCmd))
    Expect 'server: never runs either command' $r (-not (Test-Called $r 'Enable-WindowsOptionalFeature') -and -not (Test-Called $r 'Install-WindowsFeature'))

    # The module alone is not enough: the feature must be enabled too.
    $null = New-Scenario 'preflight-hyperv-feature-disabled'
    $global:HV.FeatureState = 'Disabled'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'module present, feature disabled: exit 1 with the enable command' $r ($r.ExitCode -eq 1 -and (Test-Contains $r $clientCmd))
}

function TestPreflight_ClusterNodeRefuses {
    $dest = New-Scenario 'preflight-cluster-node'
    $global:HV.ClusSvc = 'Running'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'says it is a failover cluster node' $r (Test-Contains $r 'This host is a failover cluster node')
    Expect 'never looks at VMs' $r (-not (Test-Called $r 'Get-VM'))
    Expect 'nothing written' $r (Test-NoWork $global:HV.VhdPath)

    # A stopped cluster service (feature installed, not a cluster member) is fine.
    $null = New-Scenario 'preflight-cluster-stopped'
    $global:HV.ClusSvc = 'Stopped'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'stopped ClusSvc passes preflight' $r (-not (Test-Contains $r 'This host is a failover cluster node') -and (Test-Contains $r 'Preflight checks passed'))
}

function TestPreflight_ExistingVmRefuses {
    $null = New-Scenario 'preflight-existing-vm'
    [void]$global:HV.VMs.Add([pscustomobject]@{ Name = 'ProjectAchilles'; State = 'Off' })
    $r = Invoke-Import (Get-BaseParams)
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'says the VM already exists' $r (Test-Contains $r "A VM named 'ProjectAchilles' already exists")
    Expect 'no checksum fetch, nothing written' $r (-not (Test-Called $r 'Invoke-WebRequest') -and (Test-NoWork $global:HV.VhdPath))

    # -Name picks a different VM name, so the same host passes.
    $null = New-Scenario 'preflight-existing-vm-other-name'
    [void]$global:HV.VMs.Add([pscustomobject]@{ Name = 'ProjectAchilles'; State = 'Off' })
    $p = Get-BaseParams; $p.Name = 'ProjectAchilles-2'
    $r = Invoke-Import $p
    Expect 'another -Name passes preflight' $r (Test-Contains $r 'Preflight checks passed')

    # Get-VM -Name takes wildcards; a name with brackets must still match only itself.
    $null = New-Scenario 'preflight-existing-vm-wildcard'
    [void]$global:HV.VMs.Add([pscustomobject]@{ Name = 'PA1'; State = 'Off' })
    $p = Get-BaseParams; $p.Name = 'PA[12]'
    $r = Invoke-Import $p
    Expect 'wildcard characters in -Name are literal' $r (Test-Contains $r 'Preflight checks passed')
}

function TestPreflight_ExistingVhdxRefuses {
    $dest = New-Scenario 'preflight-existing-vhdx'
    New-Item -ItemType Directory -Path $global:HV.VhdPath | Out-Null
    $leftover = Join-Path $global:HV.VhdPath 'ProjectAchilles.vhdx'
    [IO.File]::WriteAllText($leftover, 'leftover from an earlier import')
    $r = Invoke-Import (Get-BaseParams)
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'names the existing file' $r (Test-Contains $r $leftover)
    Expect 'says how to proceed (remove it or another -Name/-Destination)' $r ((Test-Contains $r 'Remove-Item') -and (Test-Contains $r '-Name') -and (Test-Contains $r '-Destination'))
    Expect 'the existing file is untouched' $r ([IO.File]::ReadAllText($leftover) -eq 'leftover from an earlier import')
    Expect 'no checksum fetch' $r (-not (Test-Called $r 'Invoke-WebRequest'))
}

function TestPreflight_LowDiskRefuses {
    $null = New-Scenario 'preflight-low-disk'
    $global:HV.FreeDiskBytes = 15GB   # image (64 KB) + 20 GB does not fit
    $r = Invoke-Import (Get-BaseParams)
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'says not enough disk space' $r (Test-Contains $r 'Not enough free disk space')
    Expect 'nothing written' $r (Test-NoWork $global:HV.VhdPath)

    $null = New-Scenario 'preflight-disk-just-enough'
    $global:HV.FreeDiskBytes = 21GB
    $r = Invoke-Import (Get-BaseParams)
    Expect 'image + 20 GB fits: preflight passes' $r (Test-Contains $r 'Preflight checks passed')
}

function TestPreflight_LowMemoryRefuses {
    $null = New-Scenario 'preflight-low-memory'
    $global:HV.FreeMemoryKB = [long](7GB / 1KB)   # default -MemoryGB is 8
    $r = Invoke-Import (Get-BaseParams)
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'says not enough free memory' $r (Test-Contains $r 'Not enough free memory')
    Expect 'suggests -MemoryGB' $r (Test-Contains $r '-MemoryGB')
    Expect 'nothing written' $r (Test-NoWork $global:HV.VhdPath)

    $null = New-Scenario 'preflight-memory-lower-request'
    $global:HV.FreeMemoryKB = [long](7GB / 1KB)
    $p = Get-BaseParams; $p.MemoryGB = 6
    $r = Invoke-Import $p
    Expect '-MemoryGB 6 with 7 GB free passes preflight' $r (Test-Contains $r 'Preflight checks passed')
}

function TestPreflight_MemoryBelowSixRefuses {
    $null = New-Scenario 'preflight-memory-below-six'
    $p = Get-BaseParams; $p.MemoryGB = 4
    $r = Invoke-Import $p
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'says at least 6' $r (Test-Contains $r '-MemoryGB must be at least 6')
    Expect 'refused before any host call' $r ($r.Calls.Count -eq 0)
}

# ==== image ==================================================================
function TestImage_ChecksumMatchesExtracts {
    $null = New-Scenario 'image-checksum-matches'
    $r = Invoke-Import (Get-BaseParams)
    $target = Join-Path $global:HV.VhdPath 'ProjectAchilles.vhdx'
    Expect 'says the checksum matches' $r (Test-Contains $r 'SHA256 matches')
    Expect 'the VHDX is at <Destination>\<Name>.vhdx' $r (Test-Path -LiteralPath $target)
    $same = $false
    if (Test-Path -LiteralPath $target) { $same = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $FixVhdxHash }
    Expect 'the VHDX is the one from the zip' $r $same
    Expect 'no temp directory left behind' $r (@(Get-ChildItem -LiteralPath $global:HV.VhdPath -Force -ErrorAction SilentlyContinue).Count -eq 1)
    Expect 'the zip is kept' $r (Test-Path -LiteralPath $FixZip)
    # Task 1: the switch and VM steps are stubs.
    Expect 'stops at the not-implemented switch step with exit 1' $r ($r.ExitCode -eq 1 -and (Test-Contains $r 'not implemented yet (Task 2/3)'))

    # -Destination overrides the host default, and a .vhdx listed in the
    # checksum file is accepted as -ImagePath.
    $dir = New-Scenario 'image-vhdx-listed'
    $sums = New-SumsFile 'sums-vhdx' "$FixVhdxHash *$FixVhdxName`r`n"
    $dest = Join-Path $dir 'custom dest'
    $r = Invoke-Import @{ ImagePath = $FixVhdx; ChecksumFile = $sums; Destination = $dest; Name = 'pa-test' }
    $target = Join-Path $dest 'pa-test.vhdx'
    Expect '.vhdx image copied to -Destination\-Name.vhdx' $r ((Test-Path -LiteralPath $target) -and (Test-Contains $r 'SHA256 matches'))
    Expect 'the source .vhdx is kept' $r (Test-Path -LiteralPath $FixVhdx)
    Expect '-Destination given: Get-VMHost not needed' $r (-not (Test-Called $r 'Get-VMHost'))
}

function TestImage_ChecksumMismatchStopsAndCleansUp {
    $null = New-Scenario 'image-checksum-mismatch'
    $bad = ('0' * 64)
    $sums = New-SumsFile 'sums-bad' "$bad  $FixZipName`n"
    $r = Invoke-Import @{ ImagePath = $FixZip; ChecksumFile = $sums }
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'says it does not match, with both hashes' $r ((Test-Contains $r 'does not match') -and (Test-Contains $r $bad) -and (Test-Contains $r $FixZipHash))
    Expect 'no VHDX and no temp directory at the destination' $r (Test-NoWork $global:HV.VhdPath)
    Expect 'the zip is kept' $r (Test-Path -LiteralPath $FixZip)

    # A .vhdx image is copied before hashing; a mismatch removes the copy.
    $null = New-Scenario 'image-checksum-mismatch-vhdx'
    $sums = New-SumsFile 'sums-bad-vhdx' "$bad  $FixVhdxName`n"
    $r = Invoke-Import @{ ImagePath = $FixVhdx; ChecksumFile = $sums }
    Expect '.vhdx: exit 1 and nothing left at the destination' $r ($r.ExitCode -eq 1 -and (Test-NoWork $global:HV.VhdPath))
}

function TestImage_ChecksumFileWithoutEntryStops {
    $null = New-Scenario 'image-checksum-no-entry'
    $sums = New-SumsFile 'sums-other' "$FixZipHash  ProjectAchilles-1.0.0-hyperv.zip`n"
    $r = Invoke-Import @{ ImagePath = $FixZip; ChecksumFile = $sums }
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'says the image is not listed' $r (Test-Contains $r "$FixZipName is not listed")
    Expect 'nothing written' $r (Test-NoWork $global:HV.VhdPath)
}

function TestImage_NoChecksumSourceRefuses {
    $null = New-Scenario 'image-no-checksum-source'
    $r = Invoke-Import @{ ImagePath = $FixZip }
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'names -Version and -ChecksumFile' $r ((Test-Contains $r '-Version') -and (Test-Contains $r '-ChecksumFile'))
    Expect 'refused before any host call' $r ($r.Calls.Count -eq 0)

    $null = New-Scenario 'image-both-checksum-sources'
    $r = Invoke-Import @{ ImagePath = $FixZip; ChecksumFile = $FixSums; Version = $FixVer }
    Expect 'both given: exit 1 before any host call' $r ($r.ExitCode -eq 1 -and $r.Calls.Count -eq 0 -and (Test-Contains $r 'not both'))
}

function TestImage_VersionFetchesReleaseSums {
    $null = New-Scenario 'image-version-fetch'
    $global:HV.Web[$FixReleaseUrl] = $FixSumsText
    $r = Invoke-Import @{ ImagePath = $FixZip; Version = $FixVer }
    $fetches = @($r.Calls | Where-Object { $_.StartsWith('Invoke-WebRequest') })
    Expect 'one fetch, of exactly the release URL' $r ($fetches.Count -eq 1 -and $fetches[0].StartsWith("Invoke-WebRequest -Uri '$FixReleaseUrl'"))
    Expect 'checksum matches and the VHDX is in place' $r ((Test-Contains $r 'SHA256 matches') -and (Test-Path -LiteralPath (Join-Path $global:HV.VhdPath 'ProjectAchilles.vhdx')))

    # A leading "v" is accepted and does not end up doubled in the URL.
    $null = New-Scenario 'image-version-with-v'
    $global:HV.Web[$FixReleaseUrl] = $FixSumsText
    $r = Invoke-Import @{ ImagePath = $FixZip; Version = "v$FixVer" }
    Expect '-Version v9.9.9 fetches the same URL' $r (Test-Called $r "Invoke-WebRequest -Uri '$FixReleaseUrl'")

    $null = New-Scenario 'image-version-invalid'
    $r = Invoke-Import @{ ImagePath = $FixZip; Version = '1.0/../../evil' }
    Expect 'a malformed -Version is refused before any host call' $r ($r.ExitCode -eq 1 -and $r.Calls.Count -eq 0)
}

function TestImage_VersionUnreachablePrintsHashAndAsksForChecksumFile {
    $null = New-Scenario 'image-version-unreachable'
    $r = Invoke-Import @{ ImagePath = $FixZip; Version = $FixVer }
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'prints the computed SHA256 of the image' $r (Test-Contains $r $FixZipHash)
    Expect 'asks for -ChecksumFile' $r (Test-Contains $r '-ChecksumFile')
    Expect 'points at the release page' $r (Test-Contains $r "releases/tag/v$FixVer")
    Expect 'nothing written' $r (Test-NoWork $global:HV.VhdPath)
}

function TestImage_UnreadableZipRefuses {
    $dir = New-Scenario 'image-unreadable-zip'
    $broken = Join-Path $dir $FixZipName
    [IO.File]::WriteAllText($broken, 'not a zip')
    $r = Invoke-Import @{ ImagePath = $broken; ChecksumFile = $FixSums }
    Expect 'exit 1, says it cannot read the zip, nothing written' $r ($r.ExitCode -eq 1 -and (Test-Contains $r 'as a zip file') -and (Test-NoWork $global:HV.VhdPath))
}

# ---- run --------------------------------------------------------------------
$tokens = $null; $parseErrors = $null
$self = [System.Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$tokens, [ref]$parseErrors)
$scenarios = $self.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -match '^Test[A-Za-z]+_' }, $false) |
    ForEach-Object { $_.Name } | Where-Object { $_ -like $Only }
foreach ($s in $scenarios) {
    try { & $s }
    catch { Check "$s ran without a harness error ($($_.Exception.Message))" $false }
}

""
if ($script:fail) {
    "logs and scenario directories kept for inspection: $root"
    'RESULT: FAIL'
}
else {
    Remove-Item -LiteralPath $root -Recurse -Force
    'RESULT: PASS'
}
exit $script:fail
