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

# ---- safety -----------------------------------------------------------------
# This harness may run on a machine with Hyper-V enabled (the lab host), and
# members of "Hyper-V Administrators" can change Hyper-V without elevation.
# So it fails safe instead of relying on remembering every mock:
#  1. it imports the few modules the script and the harness legitimately use,
#     then turns module autoloading off, so a command from any other module
#     (Hyper-V, NetAdapter, NetTCPIP, ...) raises CommandNotFound instead of
#     loading and running;
#  2. every command of the host-changing modules that exist on this machine
#     gets a stub that logs and throws, in case one is already loaded;
#  3. TestStatic_EveryCommandIsMockedOrSafe fails on any command the script
#     calls that is neither mocked here nor on an explicit safe list, and on
#     any native executable (netsh.exe, vmconnect, ...) not mocked by that
#     exact name, so a forgotten mock goes red on Linux and in CI as well;
#  4. when any static check fails, no runtime scenario runs at all.
Import-Module Microsoft.PowerShell.Management, Microsoft.PowerShell.Utility, Microsoft.PowerShell.Archive -ErrorAction Stop
$DangerousModules = @('Hyper-V', 'NetAdapter', 'NetTCPIP', 'NetLbfo', 'Dism', 'ServerManager', 'FailoverClusters', 'Storage', 'CimCmdlets')
$HostCommands = @(Get-Command -Module $DangerousModules -CommandType Cmdlet, Function -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
$global:PSModuleAutoLoadingPreference = 'None'

# An HTTP error response for the Invoke-WebRequest mock. The script reads
# $_.Exception.Response.StatusCode, as on Windows PowerShell 5.1 (WebException)
# and PowerShell 7 (HttpResponseException).
Add-Type -IgnoreWarnings -TypeDefinition @'
public class AchillesFakeHttpResponse : System.Net.WebResponse {
    private readonly System.Net.HttpStatusCode code;
    public AchillesFakeHttpResponse(int statusCode) { code = (System.Net.HttpStatusCode)statusCode; }
    public System.Net.HttpStatusCode StatusCode { get { return code; } }
}
'@

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
# A virtual switch as Get-VMSwitch returns it. Hyper-V's Default Switch is
# Internal (with NAT) and has the same fixed ID on every host.
$DefaultSwitchId = 'c08cb7b8-9b3c-408e-8e30-5e16a3aeb444'
function New-MockSwitch([string]$Name, [string]$Type = 'External', $Adapter = $null, [string]$Id = [guid]::NewGuid().ToString()) {
    [pscustomobject]@{ Name = $Name; SwitchType = $Type; NetAdapterInterfaceDescription = $Adapter; Id = [guid]$Id }
}
# A network adapter as the state describes it: Get-NetAdapter returns the
# public fields; Physical (for -Physical) and IPv4 (the addresses for
# Get-NetIPAddress, IPv6 ones too, despite the name) are the mocks' own. NdisPhysicalMedium 14 = 802.3 (wired), 9 = native 802.11,
# 8 = wireless WAN, 10 = Bluetooth; NdisMedium 16 = native 802.11. Values as
# read on the lab host (Spanish Windows 11): Ethernet 14 / '802.3', Wi-Fi 9 /
# 'Native 802.11'.
$script:NextIfIndex = 20
function New-MockAdapter([string]$Name, [string]$Description, [string]$Status = 'Up', [int]$Medium = 14, [string[]]$IPv4 = @(), [bool]$Physical = $true, [int]$IfIndex = 0) {
    if ($IfIndex -eq 0) { $script:NextIfIndex++; $IfIndex = $script:NextIfIndex }
    $type = switch ($Medium) { 14 { '802.3' } 9 { 'Native 802.11' } 1 { 'Wireless LAN' } 8 { 'Wireless WAN' } 10 { 'BlueTooth' } default { 'Unspecified' } }
    $ndisMedium = 0; if ($Medium -eq 9) { $ndisMedium = 16 }
    $state = 'Connected'; if ($Status -ne 'Up') { $state = 'Disconnected' }
    @{
        Name = $Name; InterfaceDescription = $Description; ifIndex = $IfIndex; Status = $Status
        MediaConnectionState = $state; LinkSpeed = '1 Gbps'; NdisPhysicalMedium = [uint32]$Medium
        NdisMedium = [uint32]$ndisMedium; PhysicalMediaType = $type
        IPv4 = $IPv4; Physical = $Physical
    }
}
$EthDesc = 'Intel(R) Ethernet Connection (7) I219-V'
$WifiDesc = 'Intel(R) Wi-Fi 6 AX201 160MHz'

# One state hashtable per scenario. Defaults describe a healthy, elevated
# Windows 11 client with Hyper-V enabled, plenty of disk and memory, the
# Default Switch and one External switch "LAN" on its Ethernet adapter.
function New-HVState([string]$dir) {
    @{
        IsAdmin       = $true         # what the elevation probe returns (raw)
        HyperVModule  = $true
        ProductType   = 1             # Win32_OperatingSystem: 1 client, 3 server
        FeatureState  = 'Enabled'     # client: Get-WindowsOptionalFeature State
        FeatureServer = $true         # server: Get-WindowsFeature Installed
        ClusSvc       = $null         # $null = not installed, or 'Running'/'Stopped'
        VMs           = New-Object System.Collections.ArrayList
        Switches      = [System.Collections.ArrayList]@(
            (New-MockSwitch 'Default Switch' 'Internal' $null $DefaultSwitchId),
            (New-MockSwitch 'LAN' 'External' $EthDesc))
        Adapters      = [System.Collections.ArrayList]@(
            (New-MockAdapter 'Ethernet' $EthDesc 'Up' 14 @('192.168.4.45') $true 18))
        NewSwitchFails = $null        # 'before': New-VMSwitch throws; 'after': creates the switch, then throws
        SshConnection = $null         # $env:SSH_CONNECTION during the run ("client cport server sport")
        SessionName   = $null         # $env:SESSIONNAME during the run (RDP-Tcp#N for Remote Desktop)
        RdpPort       = $null         # registry PortNumber of RDP-Tcp; $null = no value
        TcpConnections = New-Object System.Collections.ArrayList   # @{ LocalAddress; LocalPort; RemoteAddress; State }
        SessionProbeThrows = $false   # Get-NetIPAddress -IPAddress / Get-NetTCPConnection throw
        NewSwitchAdapterArg = $null   # the -NetAdapterName New-VMSwitch received, as given
        VhdPath       = (Join-Path $dir 'vhd')
        FreeDiskBytes = 500GB         # free space of the one default volume
        Volumes       = $null         # $null = one volume at the temp root; or a list of @{ Name; FreeSpace }
        FreeMemoryKB  = [long](32GB / 1KB)
        Web           = @{}           # url -> response body (string)
        WebStatus     = @{}           # url -> HTTP error status (e.g. 404)
        # VM step. IpSequence: what Get-VMNetworkAdapter reports as IPAddresses on
        # each call (the last entry repeats; empty = never an address).
        IpSequence    = [System.Collections.ArrayList]@(, @('192.168.4.60', 'fe80::215:5dff:fe04:160'))
        IpCalls       = 0
        IpTimeoutS    = $null         # $env:ACHILLES_IMPORT_IP_TIMEOUT_S during the run
        Vmconnect     = $true         # <windir>\System32\vmconnect.exe exists (Hyper-V console)
        Windir        = (Join-Path $dir 'windir')   # $env:windir during the run
        FailAt        = $null         # a VM mock that throws ('New-VM:after' = creates the VM, then throws)
        # Integration services of a new VM: localized names, fixed IDs.
        IntegrationServices = @(
            @{ Name = 'Guest Service Interface'; Guid = '6C09BB55-D683-4DA0-8931-C9BF705F6480'; Enabled = $false },
            @{ Name = 'Heartbeat'; Guid = '84EAAE65-2F2E-45F5-9BB5-0E857DC8EB47'; Enabled = $true },
            @{ Name = 'Key-Value Pair Exchange'; Guid = '2A34B1C2-FD73-4043-8A5B-DD2159BC743F'; Enabled = $true },
            @{ Name = 'Shutdown'; Guid = '9F8233AC-BE49-4C79-8EE3-E7E1985B2077'; Enabled = $true },
            @{ Name = 'Time Synchronization'; Guid = '2497F4DE-E9FA-4204-80E4-4B75C46419C0'; Enabled = $true },
            @{ Name = 'VSS'; Guid = '5CED1297-4598-4915-A5FC-AD21BB4D02A4'; Enabled = $true })
        IntegrationObjects = $null    # what Get-VMIntegrationService returned (same objects each call)
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
    # Mock Hyper-V objects (a VM, an integration service) print as <Kind 'Name'>.
    if ($null -ne $v.PSObject.Properties['MockKind']) { return "<$($v.MockKind) '$($v.Name)'>" }
    if ($v -is [array]) { return (@($v | ForEach-Object { Format-MockValue $_ }) -join ',') }
    return [string]$v
}

function global:Read-Host {
    param([Parameter(Position = 0)][string]$Prompt, [switch]$AsSecureString)
    [void]$global:Calls.Add("Read-Host $Prompt")
    if ($global:Answers.Count -eq 0) { throw "unscripted prompt: $Prompt" }
    return [string]$global:Answers.Dequeue()
}
function global:Test-AchillesImportElevated {
    [CmdletBinding()] param()
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    $global:HV.IsAdmin
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
    if ($ClassName -eq 'Win32_Volume') {
        if ($null -eq $global:HV.Volumes) {
            return [pscustomobject]@{ Name = [IO.Path]::GetPathRoot($root); FreeSpace = [uint64]$global:HV.FreeDiskBytes }
        }
        foreach ($v in $global:HV.Volumes) { [pscustomobject]@{ Name = $v.Name; FreeSpace = [uint64]$v.FreeSpace } }
        return
    }
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
# Answers from $HV.Web, the way Windows PowerShell 5.1 returns an
# application/octet-stream body (a byte array). $HV.WebStatus answers with an
# HTTP error. Anything else is unreachable.
function global:Invoke-WebRequest {
    [CmdletBinding()] param([Parameter(Position = 0)][string]$Uri, [switch]$UseBasicParsing, [string]$OutFile)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    if ($global:HV.WebStatus.ContainsKey($Uri)) {
        $status = [int]$global:HV.WebStatus[$Uri]
        throw (New-Object System.Net.WebException "The remote server returned an error: ($status) (mock)", $null, ([System.Net.WebExceptionStatus]::ProtocolError), (New-Object AchillesFakeHttpResponse $status))
    }
    if (-not $global:HV.Web.ContainsKey($Uri)) {
        throw (New-Object System.Net.WebException "The remote name could not be resolved: 'github.com' (mock)")
    }
    [pscustomobject]@{ StatusCode = 200; Content = [Text.Encoding]::ASCII.GetBytes([string]$global:HV.Web[$Uri]) }
}

function global:Get-VMSwitch {
    [CmdletBinding()] param([Parameter(Position = 0)][string]$Name)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    foreach ($s in $global:HV.Switches) {
        if (-not $Name -or $s.Name -like $Name) { $s }
    }
}
function global:Get-NetAdapter {
    [CmdletBinding()] param([Parameter(Position = 0)][string]$Name, [switch]$Physical)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    foreach ($a in $global:HV.Adapters) {
        if ($Physical -and -not $a.Physical) { continue }
        if ($Name -and $a.Name -notlike $Name) { continue }
        $o = [ordered]@{}
        foreach ($k in 'Name', 'InterfaceDescription', 'ifIndex', 'Status', 'MediaConnectionState', 'LinkSpeed', 'NdisPhysicalMedium', 'NdisMedium', 'PhysicalMediaType') {
            if ($a.ContainsKey($k)) { $o[$k] = $a[$k] }
        }
        [pscustomobject]$o
    }
}
function global:Get-NetIPAddress {
    [CmdletBinding()] param([string]$IPAddress, [int]$InterfaceIndex, [string]$AddressFamily)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    if ($IPAddress) {
        if ($global:HV.SessionProbeThrows) { throw 'Access denied (mock).' }
        $hit = @($global:HV.Adapters | Where-Object { @($_.IPv4) -contains $IPAddress })
        if ($hit.Count -eq 0) { Write-Error "No MSFT_NetIPAddress objects found with property 'IPAddress' equal to '$IPAddress' (mock)."; return }
        return [pscustomobject]@{ IPAddress = $IPAddress; AddressFamily = 'IPv4'; InterfaceIndex = [uint32]$hit[0].ifIndex }
    }
    foreach ($a in $global:HV.Adapters) {
        if ($a.ifIndex -ne $InterfaceIndex) { continue }
        foreach ($ip in @($a.IPv4)) {
            if ($AddressFamily -eq 'IPv4' -and $ip.Contains(':')) { continue }
            [pscustomobject]@{ IPAddress = $ip; AddressFamily = 'IPv4'; InterfaceIndex = $InterfaceIndex }
        }
    }
}
function global:Get-NetTCPConnection {
    [CmdletBinding()] param([string]$State, [int]$LocalPort)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    if ($global:HV.SessionProbeThrows) { throw 'Access denied (mock).' }
    $hit = @($global:HV.TcpConnections | Where-Object { (-not $State -or $_.State -eq $State) -and (-not $LocalPort -or $_.LocalPort -eq $LocalPort) })
    if ($hit.Count -eq 0) { Write-Error 'No matching MSFT_NetTCPConnection objects found (mock).'; return }
    foreach ($c in $hit) { [pscustomobject]$c }
}
# Only the RDP port number is read from the registry.
function global:Get-ItemProperty {
    [CmdletBinding()] param([string]$LiteralPath, [string]$Name)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    if ($LiteralPath -ne 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp') { throw "harness: Get-ItemProperty $LiteralPath is not mocked" }
    if ($null -eq $global:HV.RdpPort) { Write-Error "Property $Name does not exist (mock)."; return }
    [pscustomobject]@{ PortNumber = [int]$global:HV.RdpPort }
}
# Creates an External switch in the state (never Internal: -SwitchType is
# declared only so that passing it shows up in the log).
function global:New-VMSwitch {
    [CmdletBinding()] param([string]$Name, [string]$NetAdapterName, [bool]$AllowManagementOS, [string]$SwitchType)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    $global:HV.NewSwitchAdapterArg = $NetAdapterName
    if ($global:HV.NewSwitchFails -eq 'before') { throw 'The operation failed because the adapter is in use (mock).' }
    $a = @($global:HV.Adapters | Where-Object { $_.Name -eq $NetAdapterName })
    if ($a.Count -ne 1) { throw "harness: New-VMSwitch on unknown adapter '$NetAdapterName'" }
    $s = New-MockSwitch $Name 'External' $a[0].InterfaceDescription
    [void]$global:HV.Switches.Add($s)
    if ($global:HV.NewSwitchFails -eq 'after') { throw 'The switch was created, but binding the management OS adapter failed (mock).' }
    $s
}

# ---- VM mocks ----
# Every one logs its call; $HV.FailAt names the one that throws.
function global:Invoke-MockFailure([string]$Command) {
    if ($global:HV.FailAt -eq $Command) { throw "$Command failed: the operation could not be completed (mock)." }
}
function global:New-VM {
    [CmdletBinding()] param([string]$Name, [int]$Generation, [long]$MemoryStartupBytes, [string]$VHDPath, [string]$SwitchName,
        [string]$BootDevice, [string]$Path, [string]$NewVHDPath, [long]$NewVHDSizeBytes, [switch]$NoVHD)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    Invoke-MockFailure 'New-VM'
    $global:HV.NewVmSawDisk = Test-Path -LiteralPath $VHDPath
    $vm = [pscustomobject]@{ MockKind = 'VM'; Name = $Name; Id = [guid]::NewGuid(); State = 'Off' }
    [void]$global:HV.VMs.Add($vm)
    Invoke-MockFailure 'New-VM:after'
    $vm
}
function global:Set-VMMemory {
    [CmdletBinding()] param([Parameter(Position = 0)]$VM, [bool]$DynamicMemoryEnabled, [long]$StartupBytes, [long]$MinimumBytes, [long]$MaximumBytes)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    Invoke-MockFailure 'Set-VMMemory'
}
function global:Set-VMProcessor {
    [CmdletBinding()] param([Parameter(Position = 0)]$VM, [long]$Count)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    Invoke-MockFailure 'Set-VMProcessor'
}
function global:Set-VMFirmware {
    [CmdletBinding()] param([Parameter(Position = 0)]$VM, [string]$EnableSecureBoot, [string]$SecureBootTemplate, [string]$SecureBootTemplateId)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    Invoke-MockFailure 'Set-VMFirmware'
}
function global:Set-VM {
    [CmdletBinding()] param([Parameter(Position = 0)]$VM, [bool]$AutomaticCheckpointsEnabled, [string]$CheckpointType,
        [string]$AutomaticStartAction, [int]$AutomaticStartDelay, [string]$AutomaticStopAction, [string]$Notes,
        [long]$MemoryStartupBytes, [switch]$DynamicMemory, [long]$ProcessorCount, [string]$Name)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    Invoke-MockFailure 'Set-VM'
}
function global:Get-VMIntegrationService {
    [CmdletBinding()] param([Parameter(Position = 0)]$VM, [string[]]$Name)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    Invoke-MockFailure 'Get-VMIntegrationService'
    if ($null -eq $global:HV.IntegrationObjects) {
        $global:HV.IntegrationObjects = @($global:HV.IntegrationServices | ForEach-Object {
                [pscustomobject]@{ MockKind = 'VMIntegrationService'; Name = $_.Name; Id = "Microsoft:$($VM.Id)\$($_.Guid)"; Enabled = $_.Enabled; VMName = $VM.Name } })
    }
    $global:HV.IntegrationObjects
}
function global:Enable-VMIntegrationService {
    [CmdletBinding()] param([Parameter(Position = 0)]$VMIntegrationService, $VM, [string[]]$Name)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    Invoke-MockFailure 'Enable-VMIntegrationService'
    foreach ($svc in @($VMIntegrationService)) { $svc.Enabled = $true }
}
function global:Set-VMNetworkAdapterVlan {
    [CmdletBinding()] param([Parameter(Position = 0)]$VM, [switch]$Access, [int]$VlanId, [switch]$Trunk, [switch]$Untagged)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    Invoke-MockFailure 'Set-VMNetworkAdapterVlan'
}
function global:Start-VM {
    [CmdletBinding()] param([Parameter(Position = 0)]$VM, [string]$Name)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    Invoke-MockFailure 'Start-VM'
    $VM.State = 'Running'
}
function global:Get-VMNetworkAdapter {
    [CmdletBinding()] param([Parameter(Position = 0)]$VM, [string]$VMName)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
    Invoke-MockFailure 'Get-VMNetworkAdapter'
    $seq = $global:HV.IpSequence
    $ips = @()
    if ($seq.Count -gt 0) { $ips = @($seq[[Math]::Min($global:HV.IpCalls, $seq.Count - 1)]) }
    $global:HV.IpCalls++
    [pscustomobject]@{ MockKind = 'VMNetworkAdapter'; Name = 'Network Adapter'; VMName = $VM.Name; IPAddresses = [string[]]$ips }
}
# The IP wait sleeps between polls: logged, never slept.
function global:Start-Sleep {
    [CmdletBinding()] param([Parameter(Position = 0)][int]$Seconds, [int]$Milliseconds)
    Add-MockCall $MyInvocation.MyCommand $PSBoundParameters
}

# Commands that change a host (or that later tasks will mock with state), plus
# every command of the host-changing modules found on this machine. Until a
# scenario mocks one, any call is logged and fails the run.
$guarded = @(
    'Enable-WindowsOptionalFeature', 'Install-WindowsFeature', 'Restart-Computer',
    'New-VM', 'Remove-VM', 'Start-VM', 'Stop-VM', 'Set-VM', 'Set-VMFirmware', 'Set-VMMemory',
    'Set-VMProcessor', 'Enable-VMIntegrationService', 'Set-VMNetworkAdapterVlan',
    'Get-VMNetworkAdapter', 'Connect-VMNetworkAdapter', 'Add-VMHardDiskDrive', 'Set-VMHost', 'Get-VMIntegrationService',
    'Get-VMSwitch', 'New-VMSwitch', 'Remove-VMSwitch', 'Get-NetAdapter', 'vmconnect'
)
# The mocks are the "function global:" definitions in this file.
$tokens = $null; $parseErrors = $null
$selfAst = [System.Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$tokens, [ref]$parseErrors)
$MockNames = @($selfAst.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -like 'global:*' }, $true) |
    ForEach-Object { $_.Name.Substring(7) })
$StubNames = @(@($guarded) + $HostCommands | Select-Object -Unique | Where-Object { $MockNames -notcontains $_ })
foreach ($n in $StubNames) {
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
    # The session the script sees comes from the scenario, never from the
    # shell running the harness (which may itself be an SSH session).
    # Likewise windir (where the script looks for vmconnect.exe) and the IP wait.
    $savedEnv = @{ SSH_CONNECTION = $env:SSH_CONNECTION; SESSIONNAME = $env:SESSIONNAME; windir = $env:windir; ACHILLES_IMPORT_IP_TIMEOUT_S = $env:ACHILLES_IMPORT_IP_TIMEOUT_S }
    $env:SSH_CONNECTION = $global:HV.SshConnection
    $env:SESSIONNAME = $global:HV.SessionName
    $env:ACHILLES_IMPORT_IP_TIMEOUT_S = $global:HV.IpTimeoutS
    $system32 = Join-Path $global:HV.Windir 'System32'
    New-Item -ItemType Directory -Path $system32 -Force | Out-Null
    $vmconnect = Join-Path $system32 'vmconnect.exe'
    if ($global:HV.Vmconnect) { [IO.File]::WriteAllText($vmconnect, 'not a program (harness)') }
    elseif (Test-Path -LiteralPath $vmconnect) { Remove-Item -LiteralPath $vmconnect }
    $env:windir = $global:HV.Windir
    try {
        $records = & $Script @Params *>&1
        $code = $LASTEXITCODE
    }
    catch {
        $code = "threw: $($_.Exception.Message)"
    }
    finally {
        $env:SSH_CONNECTION = $savedEnv.SSH_CONNECTION
        $env:SESSIONNAME = $savedEnv.SESSIONNAME
        $env:windir = $savedEnv.windir
        $env:ACHILLES_IMPORT_IP_TIMEOUT_S = $savedEnv.ACHILLES_IMPORT_IP_TIMEOUT_S
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
$HyperVCommands = 'Get-VM', 'Get-VMHost', 'Get-VMSwitch', 'New-VM', 'New-VMSwitch', 'Get-WindowsOptionalFeature', 'Get-WindowsFeature', 'Get-Service', 'Start-VM'
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
# Default parameters for a run that passes preflight with the fixtures. -Yes
# reuses the default host's one External switch without a prompt.
function Get-BaseParams { @{ ImagePath = $FixZip; ChecksumFile = $FixSums; Yes = $true } }
function Get-NewVmCalls($r) { @($r.Calls | Where-Object { $_.StartsWith('New-VM ') }) }
# True when the run created the VM on that switch and finished (exit 0).
function Test-VmCreatedOn($r, [string]$switch) {
    $calls = @(Get-NewVmCalls $r)
    $r.ExitCode -eq 0 -and $calls.Count -eq 1 -and $calls[0].Contains("-SwitchName '$($switch.Replace("'", "''"))'")
}

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
            $ok = $all.Contains('powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-Achilles.ps1')
        }
    }
    Check 'help (.SYNOPSIS/.EXAMPLE) shows powershell -NoProfile -ExecutionPolicy Bypass -File' $ok
    # -NoProfile keeps a profile's functions out of the run; every usage line has it.
    $all = 0; $without = 0
    if (Test-Path -LiteralPath $Script) {
        foreach ($l in [IO.File]::ReadAllLines($Script)) {
            if ($l.Contains('-ExecutionPolicy Bypass')) { $all++; if (-not $l.Contains('-NoProfile -ExecutionPolicy Bypass')) { $without++ } }
        }
    }
    Check "every '-ExecutionPolicy Bypass' usage line has -NoProfile ($all found)" ($all -gt 0 -and $without -eq 0)
}

# Commands the script may call without a mock: local, in-process, and only
# touching paths the script was given. Anything else needs a mock above.
# Add-Type and New-Object are not on this list: they are checked separately
# (Get-UnsafeCommands), because they can load code or start COM servers.
$SafeCommands = @(
    'Copy-Item', 'Expand-Archive', 'ForEach-Object', 'Get-ChildItem', 'Get-FileHash',
    'Get-Item', 'Join-Path', 'Move-Item', 'Out-Null', 'New-Item', 'Remove-Item',
    'Select-Object', 'Set-StrictMode', 'Split-Path', 'Test-Path', 'Where-Object', 'Write-Host'
)

# The only Add-Type calls the script may make, as written (whitespace
# collapsed). Each entry says what it is for; anything else (-TypeDefinition,
# -MemberDefinition, -Path, other assemblies, splatting) fails the scan.
$AllowedAddType = @(
    # System.IO.Compression.ZipFile, to read the zip's uncompressed size (Get-ImageSize).
    'Add-Type -AssemblyName System.IO.Compression.FileSystem'
)
# .NET types that start processes: [Diagnostics.Process]::Start(...) and friends.
$ProcessTypePattern = '^(System\.)?Diagnostics\.Process'

# True for a native executable: a name with an executable extension (also as a
# path), or one that resolves to an application on this machine. Checked
# before the safe list and the script's own functions, so nothing but an
# explicit mock of that exact name lets one through.
$script:ApplicationCache = @{}
function Test-NativeCommand([string]$n) {
    if ($n -match '\.(exe|com|bat|cmd)$') { return $true }
    if (-not $script:ApplicationCache.ContainsKey($n)) {
        $script:ApplicationCache[$n] = @(Get-Command -Name ([WildcardPattern]::Escape($n)) -CommandType Application -ErrorAction SilentlyContinue).Count -gt 0
    }
    $script:ApplicationCache[$n]
}

# Names of commands in a script that are not mocked, safe, or the script's own
# functions; native executables that are not mocked; module-qualified names;
# and dynamic invocations (& $x). $Mocks defaults to this file's mocks.
function Get-UnsafeCommands([System.Management.Automation.Language.Ast]$ast, [string[]]$Mocks = $MockNames) {
    $own = @($ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
    foreach ($c in $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.CommandAst] }, $true)) {
        $n = $c.GetCommandName()
        $where = "line $($c.Extent.StartLineNumber)"
        if ($null -eq $n) { "dynamic invocation at ${where}: $($c.Extent.Text)"; continue }
        if ($Mocks -contains $n) { continue }
        if (Test-NativeCommand $n) { "native executable $n at $where is not mocked"; continue }
        if ($n.Contains('\')) { "module-qualified $n at $where"; continue }
        if ($n -eq 'Add-Type') {
            $text = ($c.Extent.Text -replace '\s+', ' ').Trim()
            if ($AllowedAddType -notcontains $text) { "Add-Type at $where is not on the allow list: $text" }
            continue
        }
        if ($n -eq 'New-Object') {
            foreach ($e in @($c.CommandElements | Select-Object -Skip 1)) {
                # A splat can carry any parameter (ComObject, a Process type name).
                if ($e -is [System.Management.Automation.Language.VariableExpressionAst] -and $e.Splatted) {
                    "New-Object with splatted parameters at ${where}: $($c.Extent.Text)"
                }
                $value = $e
                if ($e -is [System.Management.Automation.Language.CommandParameterAst]) {
                    if ('ComObject'.StartsWith($e.ParameterName, [StringComparison]::OrdinalIgnoreCase)) {
                        "New-Object -ComObject at $where"
                    }
                    # -TypeName:System.Diagnostics.Process: the value sits on the parameter.
                    $value = $e.Argument
                }
                if ($value -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $value.Value -match $ProcessTypePattern) {
                    "New-Object $($value.Value) at $where starts processes"
                }
            }
            continue
        }
        if ($own -contains $n -or $SafeCommands -contains $n) { continue }
        if ($StubNames -contains $n) { "$n at $where is guarded but not mocked"; continue }
        "$n at $where is neither mocked nor on the safe list"
    }
    # Not commands at all: [Diagnostics.Process]::Start('netsh.exe', ...).
    foreach ($t in $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.TypeExpressionAst] }, $true)) {
        if ($t.TypeName.FullName -match $ProcessTypePattern) {
            "[$($t.TypeName.FullName)] at line $($t.Extent.StartLineNumber) starts processes: $($t.Parent.Extent.Text)"
        }
    }
}

function TestStatic_EveryCommandIsMockedOrSafe {
    $bad = @('script missing')
    if (Test-Path -LiteralPath $Script) {
        $tokens = $null; $parseErrors = $null
        $bad = @(Get-UnsafeCommands ([System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$tokens, [ref]$parseErrors)))
    }
    Check 'every command the script calls is mocked or on the safe list' ($bad.Count -eq 0)
    foreach ($b in $bad) { "     | $b" }

    # The check itself must catch an unmocked Hyper-V command, a
    # module-qualified name and a dynamic invocation.
    $probe = [System.Management.Automation.Language.Parser]::ParseInput(
        "function Own { Get-ChildItem }`nOwn`nAdd-VMNetworkAdapter -VMName x`nHyper-V\Get-VM`n& `$cmd`n", [ref]$null, [ref]$null)
    $found = @(Get-UnsafeCommands $probe)
    Check 'the command check catches unmocked, module-qualified and dynamic calls' (
        $found.Count -eq 3 -and ($found -join ' ') -match 'Add-VMNetworkAdapter' -and ($found -join ' ') -match 'module-qualified' -and ($found -join ' ') -match 'dynamic')

    # Native executables never count as safe: a name ending in .exe (or
    # .com/.bat/.cmd), a full path to one, or a bare name that resolves to an
    # application on this machine (netsh, sc, hostname, ...). Only an explicit
    # mock of that exact name lets one through.
    $app = @(Get-Command -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1)
    $bare = ''
    if ($app.Count -gt 0) { $bare = [IO.Path]::GetFileNameWithoutExtension($app[0].Name) }
    $probe = [System.Management.Automation.Language.Parser]::ParseInput(
        "vmconnect.exe localhost x`nNETSH.EXE interface show interface`n& 'C:\Windows\System32\sc.exe' stop x`ncmd.CMD /c x`n$bare`n", [ref]$null, [ref]$null)
    $found = @(Get-UnsafeCommands $probe)
    $native = @($found | Where-Object { $_ -like 'native executable *' })
    Check "the command check flags native executables, by extension and by resolving to an application ('$bare')" (
        $bare -ne '' -and $found.Count -eq 5 -and $native.Count -eq 5 -and ($native -join ' ') -match [regex]::Escape("native executable $bare "))
    $found = @(Get-UnsafeCommands $probe @('vmconnect.exe', 'NETSH.EXE', 'C:\Windows\System32\sc.exe', 'cmd.CMD', $bare))
    Check 'a native executable passes only when that exact name is mocked' ($found.Count -eq 0)
    $found = @(Get-UnsafeCommands ([System.Management.Automation.Language.Parser]::ParseInput("vmconnect.exe localhost x`n", [ref]$null, [ref]$null)) @('vmconnect'))
    Check 'a mock of vmconnect does not cover vmconnect.exe' ($found.Count -eq 1 -and $found[0] -like 'native executable vmconnect.exe *')

    # Ways to start a process or load code that are not commands: .NET
    # Process, COM objects, and Add-Type beyond the allow list.
    $probe = [System.Management.Automation.Language.Parser]::ParseInput((@(
        "[Diagnostics.Process]::Start('netsh.exe', 'interface show interface')",
        "[System.Diagnostics.Process]::Start('cmd.exe')",
        "`$p = [System.Diagnostics.ProcessStartInfo]::new('sc.exe')",
        "New-Object -ComObject WScript.Shell",
        "New-Object -Com Shell.Application",
        "New-Object System.Diagnostics.Process",
        "Add-Type -TypeDefinition 'public class X {}'",
        "Add-Type -MemberDefinition 'public static extern void Beep();' -Name B",
        "Add-Type -Path C:\x.dll",
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type 'public class Y {}'",
        "Add-Type @addTypeArgs",
        # The colon form puts the value on the parameter (CommandParameterAst.Argument).
        "New-Object -TypeName:System.Diagnostics.Process",
        "New-Object -ComObject:WScript.Shell",
        # A splatted New-Object can hide -ComObject or a Process type name.
        "`$a = @{ ComObject = 'WScript.Shell' }; New-Object @a"
    ) -join "`n") + "`n", [ref]$null, [ref]$null)
    $found = @(Get-UnsafeCommands $probe)
    $lines = @($found | ForEach-Object { if ($_ -match ' at line (\d+)') { [int]$Matches[1] } } | Select-Object -Unique)
    Check 'the command check flags [Diagnostics.Process], New-Object -ComObject (also -TypeName:/-ComObject: and splatted) and Add-Type beyond its allow list (15 lines)' ($lines.Count -eq 15)
    if ($lines.Count -ne 15) { foreach ($f in $found) { "     | $f" } }
    $allowed = [System.Management.Automation.Language.Parser]::ParseInput(
        "Add-Type -AssemblyName System.IO.Compression.FileSystem`nNew-Object System.Collections.ArrayList`n[IO.Path]::GetFileName('x')`n", [ref]$null, [ref]$null)
    Check 'the allow-listed Add-Type and ordinary New-Object/.NET calls pass' (@(Get-UnsafeCommands $allowed).Count -eq 0)

    # With autoloading off, a command from a module that was not imported
    # cannot load and run.
    $notFound = $false
    try { Get-SmbShare | Out-Null } catch [System.Management.Automation.CommandNotFoundException] { $notFound = $true }
    Check 'module autoloading is off (an unimported module''s command is not found)' ($global:PSModuleAutoLoadingPreference -eq 'None' -and $notFound)
}

# ==== preflight ==============================================================
function TestPreflight_NotElevatedRefuses {
    $null = New-Scenario 'preflight-not-elevated'
    $global:HV.IsAdmin = $false
    $r = Invoke-Import (Get-BaseParams)
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'says Run PowerShell as Administrator' $r (Test-Contains $r 'Run PowerShell as Administrator')
    Expect 'no Hyper-V calls' $r (Test-NoHyperVCalls $r)

    # A common helper name in a profile must not stand in for the check.
    $null = New-Scenario 'preflight-not-elevated-profile-helper'
    $global:HV.IsAdmin = $false
    Set-Item -Path 'function:global:Test-IsAdministrator' -Value { $true }
    try { $r = Invoke-Import (Get-BaseParams) }
    finally { Remove-Item -LiteralPath 'function:global:Test-IsAdministrator' }
    Expect 'a Test-IsAdministrator returning $true does not bypass the check' $r ($r.ExitCode -eq 1 -and (Test-Contains $r 'Run PowerShell as Administrator'))

    # Only a real [bool] $true passes: the string 'False' is truthy.
    foreach ($v in @('False', 'True', 1)) {
        $null = New-Scenario "preflight-elevation-not-bool-$v"
        $global:HV.IsAdmin = $v
        $r = Invoke-Import (Get-BaseParams)
        Expect "a probe returning $($v.GetType().Name) '$v' is refused" $r ($r.ExitCode -eq 1 -and (Test-Contains $r 'Run PowerShell as Administrator'))
    }
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

# A Destination under a mount-point folder lives on the mounted volume, not
# on the drive that holds the folder: the longest volume name that prefixes
# Destination wins (case-insensitively, as on Windows).
function TestPreflight_MountPointDiskSpace {
    $sep = [IO.Path]::DirectorySeparatorChar
    $dir = New-Scenario 'preflight-mount-point-low'
    $mount = Join-Path $dir 'mnt'
    $global:HV.Volumes = @(
        @{ Name = [IO.Path]::GetPathRoot($root); FreeSpace = 500GB },
        @{ Name = $mount + $sep; FreeSpace = 5GB }
    )
    $p = Get-BaseParams; $p.Destination = Join-Path $mount 'VMs'
    $r = Invoke-Import $p
    Expect 'small mounted volume under a big drive: refused' $r ($r.ExitCode -eq 1 -and (Test-Contains $r 'Not enough free disk space'))

    $dir = New-Scenario 'preflight-mount-point-big'
    $mount = Join-Path $dir 'mnt'
    $global:HV.Volumes = @(
        @{ Name = [IO.Path]::GetPathRoot($root); FreeSpace = 5GB },
        @{ Name = ($mount + $sep).ToUpperInvariant(); FreeSpace = 500GB }
    )
    $p = Get-BaseParams; $p.Destination = Join-Path $mount 'VMs'
    $r = Invoke-Import $p
    Expect 'big mounted volume under a small drive (name in other case): passes' $r (Test-Contains $r 'Preflight checks passed')
}

# A UNC Destination (an SMB3 share) is on no local volume. The free space
# can't be checked: warn and go on. Simulated by a host whose only volume
# does not hold Destination; a real \\server\share path would make the
# script reach the network on Windows (and be a relative path on Linux).
function TestPreflight_DestinationOnNoLocalVolumeWarns {
    $dir = New-Scenario 'preflight-no-local-volume'
    $global:HV.Volumes = @(@{ Name = (Join-Path $dir 'elsewhere') + [IO.Path]::DirectorySeparatorChar; FreeSpace = 1GB })
    $r = Invoke-Import (Get-BaseParams)
    Expect 'warns that the free space could not be checked' $r (Test-Contains $r 'Could not check the free space')
    Expect 'and goes on (preflight passes)' $r (Test-Contains $r 'Preflight checks passed')
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
    $vmCalls = @(Get-NewVmCalls $r)
    Expect 'exit 0: the VM is created on that disk, and no cleanup is printed' $r (
        $r.ExitCode -eq 0 -and $vmCalls.Count -eq 1 -and $vmCalls[0].Contains("-VHDPath '$target'") -and -not (Test-Contains $r 'Remove-Item'))

    # -Destination overrides the host default, and a .vhdx listed in the
    # checksum file is accepted as -ImagePath.
    $dir = New-Scenario 'image-vhdx-listed'
    $sums = New-SumsFile 'sums-vhdx' "$FixVhdxHash *$FixVhdxName`r`n"
    $dest = Join-Path $dir 'custom dest'
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixVhdx; ChecksumFile = $sums; Destination = $dest; Name = 'pa-test' }
    $target = Join-Path $dest 'pa-test.vhdx'
    Expect '.vhdx image copied to -Destination\-Name.vhdx' $r ((Test-Path -LiteralPath $target) -and (Test-Contains $r 'SHA256 matches'))
    Expect 'the source .vhdx is kept' $r (Test-Path -LiteralPath $FixVhdx)
    Expect '-Destination given: Get-VMHost not needed' $r (-not (Test-Called $r 'Get-VMHost'))
}

function TestImage_ChecksumMismatchStopsAndCleansUp {
    $null = New-Scenario 'image-checksum-mismatch'
    $bad = ('0' * 64)
    $sums = New-SumsFile 'sums-bad' "$bad  $FixZipName`n"
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixZip; ChecksumFile = $sums }
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'says it does not match, with both hashes' $r ((Test-Contains $r 'does not match') -and (Test-Contains $r $bad) -and (Test-Contains $r $FixZipHash))
    Expect 'no VHDX and no temp directory at the destination' $r (Test-NoWork $global:HV.VhdPath)
    Expect 'the zip is kept' $r (Test-Path -LiteralPath $FixZip)

    # A .vhdx image is copied before hashing; a mismatch removes the copy.
    $null = New-Scenario 'image-checksum-mismatch-vhdx'
    $sums = New-SumsFile 'sums-bad-vhdx' "$bad  $FixVhdxName`n"
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixVhdx; ChecksumFile = $sums }
    Expect '.vhdx: exit 1 and nothing left at the destination' $r ($r.ExitCode -eq 1 -and (Test-NoWork $global:HV.VhdPath))
    Expect '.vhdx: the Destination folder this run created is removed' $r (-not (Test-Path -LiteralPath $global:HV.VhdPath))

    # Folders this run created for -Destination go; ones that existed stay.
    $dir = New-Scenario 'image-checksum-mismatch-new-dest'
    $dest = Join-Path (Join-Path $dir 'new') 'deeper'
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixVhdx; ChecksumFile = $sums; Destination = $dest }
    Expect 'nested new -Destination: every folder this run created is removed' $r ($r.ExitCode -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $dir 'new')))
    $dir = New-Scenario 'image-checksum-mismatch-existing-dest'
    New-Item -ItemType Directory -Path $global:HV.VhdPath | Out-Null
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixVhdx; ChecksumFile = $sums }
    Expect 'an existing -Destination folder is kept' $r ($r.ExitCode -eq 1 -and (Test-Path -LiteralPath $global:HV.VhdPath))
}

function TestImage_ChecksumFileWithoutEntryStops {
    $null = New-Scenario 'image-checksum-no-entry'
    $sums = New-SumsFile 'sums-other' "$FixZipHash  ProjectAchilles-1.0.0-hyperv.zip`n"
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixZip; ChecksumFile = $sums }
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'says the image is not listed' $r (Test-Contains $r "$FixZipName is not listed")
    Expect 'nothing written' $r (Test-NoWork $global:HV.VhdPath)
}

function TestImage_ChecksumFileFormats {
    $null = New-Scenario 'image-checksum-uppercase'
    $sums = New-SumsFile 'sums-upper' ($FixZipHash.ToUpperInvariant() + "  $FixZipName`n")
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixZip; ChecksumFile = $sums }
    Expect 'uppercase hex matches' $r (Test-Contains $r 'SHA256 matches')

    $null = New-Scenario 'image-checksum-duplicate-same'
    $sums = New-SumsFile 'sums-dup-same' "$FixZipHash  $FixZipName`n$($FixZipHash.ToUpperInvariant())  $FixZipName`n"
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixZip; ChecksumFile = $sums }
    Expect 'the same entry twice with the same hash passes' $r (Test-Contains $r 'SHA256 matches')

    $null = New-Scenario 'image-checksum-duplicate-different'
    $sums = New-SumsFile 'sums-dup-diff' "$FixZipHash  $FixZipName`n$('1' * 64)  $FixZipName`n"
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixZip; ChecksumFile = $sums }
    Expect 'the same entry twice with different hashes: exit 1, nothing written' $r (
        $r.ExitCode -eq 1 -and (Test-Contains $r 'listed more than once') -and (Test-NoWork $global:HV.VhdPath))
}

function TestImage_NoChecksumSourceRefuses {
    $null = New-Scenario 'image-no-checksum-source'
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixZip }
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'names -Version and -ChecksumFile' $r ((Test-Contains $r '-Version') -and (Test-Contains $r '-ChecksumFile'))
    Expect 'refused before any host call' $r ($r.Calls.Count -eq 0)

    $null = New-Scenario 'image-both-checksum-sources'
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixZip; ChecksumFile = $FixSums; Version = $FixVer }
    Expect 'both given: exit 1 before any host call' $r ($r.ExitCode -eq 1 -and $r.Calls.Count -eq 0 -and (Test-Contains $r 'not both'))
}

function TestImage_VersionFetchesReleaseSums {
    $null = New-Scenario 'image-version-fetch'
    $global:HV.Web[$FixReleaseUrl] = $FixSumsText
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixZip; Version = $FixVer }
    $fetches = @($r.Calls | Where-Object { $_.StartsWith('Invoke-WebRequest') })
    Expect 'one fetch, of exactly the release URL' $r ($fetches.Count -eq 1 -and $fetches[0].StartsWith("Invoke-WebRequest -Uri '$FixReleaseUrl'"))
    Expect 'checksum matches and the VHDX is in place' $r ((Test-Contains $r 'SHA256 matches') -and (Test-Path -LiteralPath (Join-Path $global:HV.VhdPath 'ProjectAchilles.vhdx')))

    # A leading "v" is accepted and does not end up doubled in the URL.
    $null = New-Scenario 'image-version-with-v'
    $global:HV.Web[$FixReleaseUrl] = $FixSumsText
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixZip; Version = "v$FixVer" }
    Expect '-Version v9.9.9 fetches the same URL' $r (Test-Called $r "Invoke-WebRequest -Uri '$FixReleaseUrl'")

    $null = New-Scenario 'image-version-invalid'
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixZip; Version = '1.0/../../evil' }
    Expect 'a malformed -Version is refused before any host call' $r ($r.ExitCode -eq 1 -and $r.Calls.Count -eq 0)
}

function TestImage_VersionUnreachablePrintsHashAndAsksForChecksumFile {
    $null = New-Scenario 'image-version-unreachable'
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixZip; Version = $FixVer }
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
    $r = Invoke-Import @{ Yes = $true; ImagePath = $broken; ChecksumFile = $FixSums }
    Expect 'exit 1, says it cannot read the zip, nothing written' $r ($r.ExitCode -eq 1 -and (Test-Contains $r 'as a zip file') -and (Test-NoWork $global:HV.VhdPath))
}

# A wrong -Version is not an offline host: the release exists but has no
# appliance-SHA256SUMS (HTTP 404). Say so; keep the computed-hash hint.
function TestImage_VersionNotFoundSaysCheckVersion {
    $null = New-Scenario 'image-version-404'
    $url = 'https://github.com/projectachilles/ProjectAchilles/releases/download/v9.9.8/appliance-SHA256SUMS'
    $global:HV.WebStatus[$url] = 404
    $r = Invoke-Import @{ Yes = $true; ImagePath = $FixZip; Version = '9.9.8' }
    Expect 'exit 1' $r ($r.ExitCode -eq 1)
    Expect 'says the release has no appliance-SHA256SUMS' $r (Test-Contains $r 'v9.9.8 release has no appliance-SHA256SUMS')
    Expect 'says to check that -Version matches the image' $r (Test-Contains $r 'Check that -Version matches the image')
    Expect 'suggests the version in the image file name' $r (Test-Contains $r "-Version $FixVer")
    Expect 'keeps the computed-hash hint' $r (Test-Contains $r $FixZipHash)
    Expect "points at the image's own release page" $r (Test-Contains $r "releases/tag/v$FixVer")
    Expect 'no offline guidance' $r (-not (Test-Contains $r 'Could not download'))
    Expect 'nothing written' $r (Test-NoWork $global:HV.VhdPath)
}

# ==== switch =================================================================
# Spec 8.2 step 3. Creating an External switch drops the host's network on
# that adapter (and a Remote Desktop or SSH session over it), so it needs the
# typed adapter name, or -NetAdapterName with -ConfirmNetworkInterruption.
$NewSwitch = 'ProjectAchilles External'
function Get-SwitchParams { @{ ImagePath = $FixZip; ChecksumFile = $FixSums } }   # no -Yes
function Get-NewSwitchCalls($r) { @($r.Calls | Where-Object { $_.StartsWith('New-VMSwitch') }) }
function Get-Prompts($r) { @($r.Calls | Where-Object { $_.StartsWith('Read-Host') }) }
function Get-OutputIndex($r, [string]$text) { $r.Output.IndexOf($text, [StringComparison]::OrdinalIgnoreCase) }
function Get-OutputLine($r, [string]$text) { @($r.Output -split "`n" | Where-Object { $_.IndexOf($text, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) }
function Set-OnlyDefaultSwitch {
    $global:HV.Switches = [System.Collections.ArrayList]@(New-MockSwitch 'Default Switch' 'Internal' $null $DefaultSwitchId)
}
function Add-SecondExternal {
    [void]$global:HV.Adapters.Add((New-MockAdapter 'Ethernet 2' 'Realtek USB GbE Family Controller' 'Up' 14 @('10.0.0.5')))
    [void]$global:HV.Switches.Add((New-MockSwitch 'Lab' 'External' 'Realtek USB GbE Family Controller'))
}
$WarnText = "interrupts this host's network on that adapter for several seconds"
function Test-NetworkWarning($r) {
    (Test-Contains $r $WarnText) -and (Test-Contains $r 'Remote Desktop session over it will disconnect') -and (Test-Contains $r 'vEthernet')
}
function Test-ReusesWithoutChange($r, [string]$switch) {
    (Get-NewSwitchCalls $r).Count -eq 0 -and (Test-Contains $r "The VM will connect to the External switch '$switch'")
}
# Refused at the switch step: exit 1, no switch, nothing written.
function Test-RefusedUnchanged($r) {
    $r.ExitCode -eq 1 -and (Get-NewSwitchCalls $r).Count -eq 0 -and (Test-NoWork $global:HV.VhdPath)
}

function TestSwitch_ReusesSingleExternal {
    $null = New-Scenario 'switch-reuse-single-yes'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'reuses LAN: no New-VMSwitch' $r (Test-ReusesWithoutChange $r 'LAN')
    Expect 'no prompt with -Yes' $r ((Get-Prompts $r).Count -eq 0)
    Expect 'lists the switch with its adapter' $r ((Test-Contains $r "'LAN'") -and (Test-Contains $r $EthDesc))
    Expect 'no network warning (reusing interrupts nothing)' $r (-not (Test-Contains $r $WarnText))
    $sw = Get-OutputIndex $r 'Virtual switch'
    Expect 'the switch is chosen before the image is verified' $r ($sw -ge 0 -and $sw -lt (Get-OutputIndex $r 'SHA256 matches'))
    Expect 'creates the VM on LAN (exit 0), offers no switch removal' $r ((Test-VmCreatedOn $r 'LAN') -and -not (Test-Contains $r 'Remove-VMSwitch'))

    $null = New-Scenario 'switch-reuse-single-enter'
    $r = Invoke-Import (Get-SwitchParams) @('')
    Expect 'without -Yes: one prompt, Enter reuses it' $r ((Get-Prompts $r).Count -eq 1 -and (Test-ReusesWithoutChange $r 'LAN') -and $r.AnswersLeft -eq 0)

    $null = New-Scenario 'switch-reuse-single-declined'
    $r = Invoke-Import (Get-SwitchParams) @('n')
    Expect 'answering n: exit 1, no switch, nothing written' $r (Test-RefusedUnchanged $r)
    Expect 'and says how to pick or create one' $r ((Test-Contains $r '-SwitchName') -and (Test-Contains $r '-NetAdapterName'))

    # A Spanish keyboard answers "si" with an accent ([char]0xED keeps this file ASCII).
    foreach ($yes in @("s$([char]0x00ED)", 'Si', 'S')) {
        $null = New-Scenario "switch-reuse-single-answer-$([int][char]$yes[$yes.Length - 1])"
        $r = Invoke-Import (Get-SwitchParams) @($yes)
        Expect "answering '$yes' reuses it" $r ((Get-Prompts $r).Count -eq 1 -and (Test-ReusesWithoutChange $r 'LAN'))
    }
}

function TestSwitch_ChoosesAmongSeveralExternal {
    $null = New-Scenario 'switch-several-prompt'
    Add-SecondExternal
    $r = Invoke-Import (Get-SwitchParams) @('2')
    Expect 'a numbered list of the External switches' $r ((Test-Contains $r "1) 'LAN'") -and (Test-Contains $r "2) 'Lab'"))
    Expect 'the Default Switch is not offered' $r (-not (Test-Contains $r ") 'Default Switch'"))
    Expect 'one prompt; 2 picks Lab' $r ((Get-Prompts $r).Count -eq 1 -and (Test-ReusesWithoutChange $r 'Lab'))

    $null = New-Scenario 'switch-several-invalid'
    Add-SecondExternal
    $r = Invoke-Import (Get-SwitchParams) @('3')
    Expect 'an answer that is not a listed number: exit 1, nothing written' $r (Test-RefusedUnchanged $r)

    $null = New-Scenario 'switch-several-by-name'
    Add-SecondExternal
    $p = Get-SwitchParams; $p.SwitchName = 'Lab'
    $r = Invoke-Import $p
    Expect '-SwitchName Lab picks it directly, no prompt' $r ((Get-Prompts $r).Count -eq 0 -and (Test-ReusesWithoutChange $r 'Lab'))

    $null = New-Scenario 'switch-several-yes'
    Add-SecondExternal
    $r = Invoke-Import (Get-BaseParams)
    Expect '-Yes cannot choose between several: exit 1 asking for -SwitchName, no prompt' $r (
        (Test-RefusedUnchanged $r) -and (Test-Contains $r '-SwitchName') -and (Get-Prompts $r).Count -eq 0)
}

# Spec 8.2 step 3: an explicit -SwitchName may name any existing switch. One
# that is not External is accepted with a loud warning; the automatic paths
# never pick one.
function TestSwitch_SwitchNameAcceptsAnySwitchWithWarning {
    foreach ($case in @(@('Internal', 'Internal-Lab', 'an Internal switch'), @('Private', 'Isolated', 'a Private switch'), @('Internal', 'Default Switch', 'the Default Switch (NAT)'))) {
        $null = New-Scenario "switch-name-$($case[0].ToLowerInvariant())-$($case[1].Replace(' ', '-'))"
        if ($case[1] -ne 'Default Switch') { [void]$global:HV.Switches.Add((New-MockSwitch $case[1] $case[0])) }
        $p = Get-BaseParams; $p.SwitchName = $case[1]; $p.ConfirmNetworkInterruption = $true
        $r = Invoke-Import $p
        $warn = @(Get-OutputLine $r "'$($case[1])' is $($case[2]): agents on your network will not reach the VM through it")
        $ok = @(Get-OutputLine $r 'The VM will connect to')
        Expect "-SwitchName '$($case[1])' ($($case[0])): accepted, no prompt, no New-VMSwitch, goes on" $r (
            (Get-NewSwitchCalls $r).Count -eq 0 -and (Get-Prompts $r).Count -eq 0 -and (Test-VmCreatedOn $r $case[1]) -and
            $ok.Count -eq 1 -and $ok[0].Contains("'$($case[1])'") -and (Test-Contains $r 'SHA256 matches'))
        Expect "  and warned with [!!]: $($case[2]), agents will not reach the VM" $r ($warn.Count -eq 1 -and $warn[0].Contains('[!!]'))
        Expect '  and says -ConfirmNetworkInterruption is ignored (nothing is created)' $r (Test-Contains $r '-ConfirmNetworkInterruption is ignored')
        $nat = @(Get-OutputLine $r 'NAT address can change')
        if ($case[1] -eq 'Default Switch') { Expect '  the Default Switch: also says its NAT address can change' $r ($nat.Count -eq 1 -and $nat[0].Contains('[!!]')) }
        else { Expect '  no NAT-address line for other switches' $r ($nat.Count -eq 0) }
    }

    $null = New-Scenario 'switch-name-duplicate'
    [void]$global:HV.Switches.Add((New-MockSwitch 'Dup' 'External' $EthDesc))
    [void]$global:HV.Switches.Add((New-MockSwitch 'Dup' 'Internal'))
    $p = Get-BaseParams; $p.SwitchName = 'Dup'
    $r = Invoke-Import $p
    Expect 'a -SwitchName that names several switches: exit 1' $r ((Test-RefusedUnchanged $r) -and (Test-Contains $r "Several virtual switches are named 'Dup'"))

    $null = New-Scenario 'switch-name-missing'
    $p = Get-BaseParams; $p.SwitchName = 'Nope'
    $r = Invoke-Import $p
    Expect 'an unknown -SwitchName: exit 1, lists the External switches' $r ((Test-RefusedUnchanged $r) -and (Test-Contains $r "'LAN'"))

    $null = New-Scenario 'switch-name-and-adapter'
    $p = Get-BaseParams; $p.SwitchName = 'LAN'; $p.NetAdapterName = 'Ethernet'
    $r = Invoke-Import $p
    Expect '-SwitchName with -NetAdapterName: exit 1' $r ((Test-RefusedUnchanged $r) -and (Test-Contains $r 'not both'))
}

function TestSwitch_CreateRequiresTypedName {
    $null = New-Scenario 'switch-create-typed'
    Set-OnlyDefaultSwitch
    $r = Invoke-Import (Get-SwitchParams) @('Ethernet')
    $calls = @(Get-NewSwitchCalls $r)
    Expect 'one New-VMSwitch, with exactly the External-switch arguments' $r (
        $calls.Count -eq 1 -and $calls[0] -ceq "New-VMSwitch -Name '$NewSwitch' -NetAdapterName 'Ethernet' -AllowManagementOS `$true")
    Expect 'the warning says it interrupts the network, drops Remote Desktop, and moves the IP to vEthernet' $r (Test-NetworkWarning $r)
    Expect 'one prompt (the typed name), before New-VMSwitch' $r (
        (Get-Prompts $r).Count -eq 1 -and [array]::IndexOf($r.Calls, @(Get-Prompts $r)[0]) -lt [array]::IndexOf($r.Calls, $calls[0]))
    Expect 'confirmed before the image, created after it is verified' $r (
        (Get-OutputIndex $r $WarnText) -lt (Get-OutputIndex $r 'SHA256 matches') -and
        (Get-OutputIndex $r 'SHA256 matches') -lt (Get-OutputIndex $r "Created the External switch '$NewSwitch'"))
    $rdp = @(Get-OutputLine $r 'Remote Desktop session over it will disconnect')
    $over = @(Get-OutputLine $r 'Connected over this adapter?')
    Expect 'the Remote Desktop/SSH line and the "connected over this adapter" line are [!!] warnings' $r (
        $rdp.Count -eq 1 -and $rdp[0].Contains('[!!]') -and $over.Count -eq 1 -and $over[0].Contains('[!!]'))
    $note = Get-OutputIndex $r 'The switch is created in step 4, after the image is verified.'
    Expect 'the step-4 note comes after the confirmation' $r ($note -gt (Get-OutputIndex $r "Confirmed: an External switch on 'Ethernet'"))
    Expect 'the host now has the External switch on Ethernet' $r (@($global:HV.Switches | Where-Object { $_.Name -eq $NewSwitch -and $_.SwitchType -eq 'External' -and $_.NetAdapterInterfaceDescription -eq $EthDesc }).Count -eq 1)
    Expect 'the VM is created on the new switch (exit 0); nothing to clean up' $r ((Test-VmCreatedOn $r $NewSwitch) -and -not (Test-Contains $r 'Remove-VMSwitch'))

    # Two adapters: pick by number, then type the name (case does not matter;
    # New-VMSwitch gets the adapter's own name).
    $null = New-Scenario 'switch-create-pick'
    Set-OnlyDefaultSwitch
    [void]$global:HV.Adapters.Add((New-MockAdapter 'Ethernet 2' 'Realtek USB GbE Family Controller' 'Up' 14 @('10.0.0.5')))
    $r = Invoke-Import (Get-SwitchParams) @('2', 'ETHERNET 2')
    $calls = @(Get-NewSwitchCalls $r)
    Expect 'number then typed name: New-VMSwitch on Ethernet 2' $r (
        (Get-Prompts $r).Count -eq 2 -and $calls.Count -eq 1 -and $calls[0] -ceq "New-VMSwitch -Name '$NewSwitch' -NetAdapterName 'Ethernet 2' -AllowManagementOS `$true")
}

function TestSwitch_WrongTypedNameAborts {
    $i = 0
    foreach ($answer in @('Ethernet 2', '', 'yes', 'y', 'Ethernet; Remove-VM', 'Eth')) {
        $i++
        $null = New-Scenario "switch-wrong-name-$i"
        Set-OnlyDefaultSwitch
        $r = Invoke-Import (Get-SwitchParams) @($answer)
        Expect "typed '$answer': exit 1, no switch, nothing written, no step-4 note" $r (
            (Test-RefusedUnchanged $r) -and (Test-Contains $r 'No switch was created') -and -not (Test-Contains $r 'The switch is created in step 4'))
    }

    # The typed name confirms only the adapter that was picked: the exact name
    # of another adapter that is up does not.
    $null = New-Scenario 'switch-wrong-name-other-adapter'
    Set-OnlyDefaultSwitch
    [void]$global:HV.Adapters.Add((New-MockAdapter 'Ethernet 2' 'Realtek USB GbE Family Controller' 'Up' 14 @('10.0.0.5')))
    $r = Invoke-Import (Get-SwitchParams) @('1', 'Ethernet 2')
    Expect "picked adapter 1, typed adapter 2's exact name: exit 1, no New-VMSwitch, nothing written" $r (
        (Test-RefusedUnchanged $r) -and (Get-Prompts $r).Count -eq 2 -and (Test-Contains $r "That is not 'Ethernet'"))
}

function TestSwitch_UnattendedWithoutConfirmRefuses {
    $null = New-Scenario 'switch-unattended-no-confirm'
    Set-OnlyDefaultSwitch
    $p = Get-BaseParams; $p.NetAdapterName = 'Ethernet'
    $r = Invoke-Import $p
    Expect '-Yes -NetAdapterName without -ConfirmNetworkInterruption: exit 1, no prompt' $r ((Test-RefusedUnchanged $r) -and (Get-Prompts $r).Count -eq 0)
    Expect 'shows the warning and names -ConfirmNetworkInterruption' $r ((Test-NetworkWarning $r) -and (Test-Contains $r '-ConfirmNetworkInterruption'))
    Expect 'no step-4 note before the -Yes refusal' $r (-not (Test-Contains $r 'The switch is created in step 4'))

    $null = New-Scenario 'switch-unattended-no-adapter'
    Set-OnlyDefaultSwitch
    $r = Invoke-Import (Get-BaseParams)
    Expect '-Yes and no External switch: exit 1, says -NetAdapterName -ConfirmNetworkInterruption, no prompt' $r (
        (Test-RefusedUnchanged $r) -and (Test-Contains $r '-NetAdapterName') -and (Test-Contains $r '-ConfirmNetworkInterruption') -and (Get-Prompts $r).Count -eq 0)

    # -ConfirmNetworkInterruption confirms only together with -NetAdapterName.
    $null = New-Scenario 'switch-confirm-without-adapter'
    Set-OnlyDefaultSwitch
    $p = Get-SwitchParams; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p @('nope')
    Expect 'says -ConfirmNetworkInterruption confirms only together with -NetAdapterName' $r (Test-Contains $r '-ConfirmNetworkInterruption confirms only together with -NetAdapterName')
    Expect '-ConfirmNetworkInterruption alone still asks for the typed name' $r ((Test-RefusedUnchanged $r) -and (Get-Prompts $r).Count -eq 1)

    $null = New-Scenario 'switch-confirm-without-adapter-yes'
    Set-OnlyDefaultSwitch
    $p = Get-BaseParams; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect '-Yes -ConfirmNetworkInterruption without -NetAdapterName: exit 1, no prompt' $r ((Test-RefusedUnchanged $r) -and (Get-Prompts $r).Count -eq 0)
}

function TestSwitch_UnattendedWithConfirmCreates {
    $expected = "New-VMSwitch -Name '$NewSwitch' -NetAdapterName 'Ethernet' -AllowManagementOS `$true"
    $null = New-Scenario 'switch-unattended-confirm'
    Set-OnlyDefaultSwitch
    $p = Get-BaseParams; $p.NetAdapterName = 'Ethernet'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    $calls = @(Get-NewSwitchCalls $r)
    Expect "exactly: $expected" $r ($calls.Count -eq 1 -and $calls[0] -ceq $expected)
    Expect 'no prompt, and the warning is still shown' $r ((Get-Prompts $r).Count -eq 0 -and (Test-NetworkWarning $r))
    Expect 'the VM is created on the new switch (exit 0)' $r (Test-VmCreatedOn $r $NewSwitch)

    $null = New-Scenario 'switch-confirm-interactive'
    Set-OnlyDefaultSwitch
    $p = Get-SwitchParams; $p.NetAdapterName = 'Ethernet'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect 'without -Yes too: created, no prompt' $r ((Get-Prompts $r).Count -eq 0 -and @(Get-NewSwitchCalls $r) -ccontains $expected)

    # The adapter already carries an External switch: reuse it, interrupt nothing.
    $null = New-Scenario 'switch-adapter-already-bound'
    $p = Get-BaseParams; $p.NetAdapterName = 'Ethernet'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect 'an adapter that already has an External switch: reuses it, no warning' $r ((Test-ReusesWithoutChange $r 'LAN') -and -not (Test-Contains $r $WarnText))
    Expect '  and says -ConfirmNetworkInterruption is ignored (nothing is created)' $r (Test-Contains $r '-ConfirmNetworkInterruption is ignored')

    $null = New-Scenario 'switch-adapter-beside-existing'
    [void]$global:HV.Adapters.Add((New-MockAdapter 'Ethernet 2' 'Realtek USB GbE Family Controller' 'Up' 14 @('10.0.0.5')))
    $p = Get-BaseParams; $p.NetAdapterName = 'Ethernet 2'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect 'another adapter while LAN exists: creates on that adapter' $r (@(Get-NewSwitchCalls $r) -ccontains "New-VMSwitch -Name '$NewSwitch' -NetAdapterName 'Ethernet 2' -AllowManagementOS `$true")

    $null = New-Scenario 'switch-adapter-down'
    Set-OnlyDefaultSwitch
    [void]$global:HV.Adapters.Add((New-MockAdapter 'Ethernet 2' 'Realtek USB GbE Family Controller' 'Disconnected'))
    $p = Get-BaseParams; $p.NetAdapterName = 'Ethernet 2'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect 'an adapter that is not up: exit 1, nothing written' $r ((Test-RefusedUnchanged $r) -and (Test-Contains $r "No physical network adapter named 'Ethernet 2' is up"))

    $null = New-Scenario 'switch-name-taken'
    Set-OnlyDefaultSwitch
    [void]$global:HV.Switches.Add((New-MockSwitch $NewSwitch 'Internal'))
    $p = Get-BaseParams; $p.NetAdapterName = 'Ethernet'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect "a non-External switch already named '$NewSwitch': exit 1, nothing written" $r ((Test-RefusedUnchanged $r) -and (Test-Contains $r 'already exists'))

    $null = New-Scenario 'switch-create-fails'
    Set-OnlyDefaultSwitch
    $global:HV.NewSwitchFails = 'before'
    $p = Get-BaseParams; $p.NetAdapterName = 'Ethernet'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect 'New-VMSwitch fails: exit 2, says so, prints how to remove the disk' $r (
        $r.ExitCode -eq 2 -and (Test-Contains $r 'Could not create the External switch') -and (Test-Contains $r 'Remove-Item -LiteralPath'))
    Expect 'and offers no switch removal (none was created)' $r (-not (Test-Contains $r 'Remove-VMSwitch'))

    # New-VMSwitch made the switch and then failed: it is still this run's.
    $null = New-Scenario 'switch-create-fails-after-creating'
    Set-OnlyDefaultSwitch
    $global:HV.NewSwitchFails = 'after'
    $r = Invoke-Import $p
    Expect 'New-VMSwitch creates the switch, then fails: exit 2, says so' $r ($r.ExitCode -eq 2 -and (Test-Contains $r 'Could not create the External switch'))
    Expect '  and offers to remove that switch' $r (Test-Contains $r "Remove-VMSwitch -Name '$NewSwitch' -Force")
}

function TestSwitch_OnlyUpPhysicalAdaptersListed {
    $null = New-Scenario 'switch-adapters-listed'
    Set-OnlyDefaultSwitch
    [void]$global:HV.Adapters.Add((New-MockAdapter 'Ethernet 2' 'Realtek USB GbE Family Controller' 'Disconnected'))
    [void]$global:HV.Adapters.Add((New-MockAdapter 'Wi-Fi' $WifiDesc 'Up' 9 @('192.168.4.44')))
    [void]$global:HV.Adapters.Add((New-MockAdapter 'vEthernet (Default Switch)' 'Hyper-V Virtual Ethernet Adapter' 'Up' 14 @('172.20.0.1') $false))
    [void]$global:HV.Adapters.Add((New-MockAdapter 'Tailscale' 'Tailscale Tunnel' 'Up' 0 @('100.64.0.7') $false))
    $r = Invoke-Import (Get-SwitchParams) @('x')
    Expect 'asks Get-NetAdapter for physical adapters' $r (Test-Called $r 'Get-NetAdapter -Physical')
    Expect 'lists the Up physical ones, numbered, with IPv4 and link speed' $r (
        (Test-Contains $r '1) Ethernet') -and (Test-Contains $r '2) Wi-Fi') -and (Test-Contains $r '192.168.4.45') -and
        (Test-Contains $r '192.168.4.44') -and (Test-Contains $r '1 Gbps') -and (Test-Contains $r $EthDesc))
    Expect 'not the disconnected or virtual ones' $r (
        -not (Test-Contains $r 'Ethernet 2') -and -not (Test-Contains $r 'vEthernet (Default Switch)') -and -not (Test-Contains $r 'Tailscale'))
    Expect 'an answer that is not a listed number: exit 1, nothing written' $r (Test-RefusedUnchanged $r)

    $null = New-Scenario 'switch-no-adapter-up'
    Set-OnlyDefaultSwitch
    $global:HV.Adapters[0].Status = 'Disconnected'
    $r = Invoke-Import (Get-SwitchParams)
    Expect 'no physical adapter up: exit 1, no prompt, nothing written' $r (
        (Test-RefusedUnchanged $r) -and (Get-Prompts $r).Count -eq 0 -and (Test-Contains $r 'No physical network adapter is up'))
}

# Wi-Fi is told by the medium (NdisPhysicalMedium, or PhysicalMediaType when
# that is all there is), never by the name, which is localized and editable.
function TestSwitch_WifiMarkedNotRecommended {
    $null = New-Scenario 'switch-wifi-marked'
    Set-OnlyDefaultSwitch
    $global:HV.Adapters = [System.Collections.ArrayList]@(
        (New-MockAdapter 'Wi-Fi' 'Realtek PCIe GbE Family Controller' 'Up' 14 @('192.168.1.10')),
        (New-MockAdapter 'Ethernet 3' $WifiDesc 'Up' 9 @('192.168.1.11')),
        (New-MockAdapter 'WLAN' 'Qualcomm Atheros QCA9377' 'Up' 0 @('192.168.1.12')))
    # Each signal alone must be enough: 'Ethernet 3' has only the NDIS medium,
    # 'WLAN' only the media type.
    $global:HV.Adapters[1].Remove('PhysicalMediaType'); $global:HV.Adapters[1].Remove('NdisMedium')
    $global:HV.Adapters[2].Remove('NdisPhysicalMedium')
    $global:HV.Adapters[2].PhysicalMediaType = 'Native 802.11'
    $r = Invoke-Import (Get-SwitchParams) @('2', 'Ethernet 3')
    $line = { param($t) (Get-OutputLine $r $t) -join ' ' }
    Expect "'Wi-Fi' by name but wired (802.3): not marked" $r ((& $line '1) Wi-Fi') -ne '' -and (& $line '1) Wi-Fi') -notmatch 'not recommended')
    Expect "'Ethernet 3' with NdisPhysicalMedium 9 (802.11): marked not recommended" $r ((& $line '2) Ethernet 3') -match 'not recommended')
    Expect "'WLAN' with only PhysicalMediaType 'Native 802.11': marked not recommended" $r ((& $line '3) WLAN') -match 'not recommended')
    Expect 'picking a Wi-Fi adapter warns again and still needs the typed name' $r (
        (Test-Contains $r "'Ethernet 3' is a Wi-Fi adapter") -and (Get-Prompts $r).Count -eq 2 -and
        @(Get-NewSwitchCalls $r) -ccontains "New-VMSwitch -Name '$NewSwitch' -NetAdapterName 'Ethernet 3' -AllowManagementOS `$true")
}

# A Spanish-locale host: "Conexion de area local 2" with its accents (built
# from code points: this file stays ASCII). The name must reach New-VMSwitch
# unchanged, from the typed confirmation and from -NetAdapterName.
function TestSwitch_AdapterNameWithSpacesAndAccents {
    $acc = "Conexi$([char]0x00F3)n de $([char]0x00E1)rea local 2"
    $null = New-Scenario 'switch-accents-typed'
    Set-OnlyDefaultSwitch
    $global:HV.Adapters = [System.Collections.ArrayList]@((New-MockAdapter $acc 'Realtek PCIe GbE Family Controller' 'Up' 14 @('192.168.1.20')))
    $r = Invoke-Import (Get-SwitchParams) @($acc)
    Expect 'typed: the name arrives at New-VMSwitch byte-identical' $r (
        (Get-NewSwitchCalls $r).Count -eq 1 -and $null -ne $global:HV.NewSwitchAdapterArg -and [string]::CompareOrdinal($global:HV.NewSwitchAdapterArg, $acc) -eq 0)
    Expect 'and is shown as is' $r (([string]$r.Output).Contains($acc))

    $null = New-Scenario 'switch-accents-param'
    Set-OnlyDefaultSwitch
    $global:HV.Adapters = [System.Collections.ArrayList]@((New-MockAdapter $acc 'Realtek PCIe GbE Family Controller' 'Up' 14 @('192.168.1.20')))
    $p = Get-BaseParams; $p.NetAdapterName = $acc; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect '-NetAdapterName: the name arrives at New-VMSwitch byte-identical' $r (
        (Get-NewSwitchCalls $r).Count -eq 1 -and $null -ne $global:HV.NewSwitchAdapterArg -and [string]::CompareOrdinal($global:HV.NewSwitchAdapterArg, $acc) -eq 0)

    # Typing accents is unreliable: Windows PowerShell 5.1 with redirected
    # stdin (code page 850) turns o-acute into two box-drawing characters, and
    # some clients send decomposed text. The confirmation ignores accents and
    # case, still bound to the one adapter shown; New-VMSwitch always gets the
    # adapter's own name.
    $plain = 'Conexion de area local 2'
    $nfd = "Conexio$([char]0x0301)n de a$([char]0x0301)rea local 2"
    $cp850 = "Conexi$([char]0x251C)$([char]0x2502)n de $([char]0x251C)$([char]0x00AA)rea local 2"
    foreach ($t in @(@('accent-free', $plain), @('lowercase accent-free', $plain.ToLowerInvariant()), @('decomposed (NFD)', $nfd))) {
        $null = New-Scenario "switch-accents-typed-$($t[0].Replace(' ', '-').Replace('(', '').Replace(')', ''))"
        Set-OnlyDefaultSwitch
        $global:HV.Adapters = [System.Collections.ArrayList]@((New-MockAdapter $acc 'Realtek PCIe GbE Family Controller' 'Up' 14 @('192.168.1.20')))
        $r = Invoke-Import (Get-SwitchParams) @($t[1])
        Expect "typed $($t[0]): confirmed, New-VMSwitch gets the accented name byte-identical" $r (
            (Get-NewSwitchCalls $r).Count -eq 1 -and $null -ne $global:HV.NewSwitchAdapterArg -and [string]::CompareOrdinal($global:HV.NewSwitchAdapterArg, $acc) -eq 0)
    }
    Expect 'the prompt says accents are optional' $r (@(Get-Prompts $r)[0] -match 'accents are optional')

    $null = New-Scenario 'switch-accents-typed-cp850'
    Set-OnlyDefaultSwitch
    $global:HV.Adapters = [System.Collections.ArrayList]@((New-MockAdapter $acc 'Realtek PCIe GbE Family Controller' 'Up' 14 @('192.168.1.20')))
    $r = Invoke-Import (Get-SwitchParams) @($cp850)
    Expect 'typed through code page 850 (still wrong): refused, nothing written' $r (Test-RefusedUnchanged $r)
    Expect '  and prints the unattended alternative, quoted' $r (([string]$r.Output).Contains("-NetAdapterName '$acc' -ConfirmNetworkInterruption"))

    $null = New-Scenario 'switch-accents-param-plain'
    Set-OnlyDefaultSwitch
    $global:HV.Adapters = [System.Collections.ArrayList]@((New-MockAdapter $acc 'Realtek PCIe GbE Family Controller' 'Up' 14 @('192.168.1.20')))
    $p = Get-BaseParams; $p.NetAdapterName = $plain; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect '-NetAdapterName without accents finds the adapter; New-VMSwitch gets its own name' $r (
        (Get-NewSwitchCalls $r).Count -eq 1 -and [string]::CompareOrdinal([string]$global:HV.NewSwitchAdapterArg, $acc) -eq 0)

    # Two adapters that differ only in accents: the accent-free spelling is ambiguous.
    $null = New-Scenario 'switch-accents-param-ambiguous'
    Set-OnlyDefaultSwitch
    $global:HV.Adapters = [System.Collections.ArrayList]@(
        (New-MockAdapter "R$([char]0x00E9)d" 'NIC 1' 'Up' 14 @('10.0.1.2')),
        (New-MockAdapter "R$([char]0x00E8)d" 'NIC 2' 'Up' 14 @('10.0.2.2')))
    $p = Get-BaseParams; $p.NetAdapterName = 'Red'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect '-NetAdapterName matching two adapters once accents are ignored: exit 1' $r ((Test-RefusedUnchanged $r) -and (Test-Contains $r 'matches more than one adapter'))

    # A name with an apostrophe is quoted for copying.
    $null = New-Scenario 'switch-apostrophe-alternative'
    Set-OnlyDefaultSwitch
    $global:HV.Adapters = [System.Collections.ArrayList]@((New-MockAdapter "Juan's NIC" 'Realtek PCIe GbE Family Controller' 'Up' 14 @('192.168.1.21')))
    $r = Invoke-Import (Get-SwitchParams) @('nope')
    Expect "refused; the alternative quotes Juan's NIC as 'Juan''s NIC'" $r ((Test-RefusedUnchanged $r) -and (Test-Contains $r "-NetAdapterName 'Juan''s NIC' -ConfirmNetworkInterruption"))
}

# WWAN (mobile broadband) and Bluetooth adapters cannot carry an External
# switch: they are not offered, and -NetAdapterName naming one is refused
# before anything changes (not at New-VMSwitch, after the disk copy).
function TestSwitch_WirelessWanAndBluetoothCannotCarryASwitch {
    $null = New-Scenario 'switch-wwan-bt-not-offered'
    Set-OnlyDefaultSwitch
    [void]$global:HV.Adapters.Add((New-MockAdapter 'Cellular' 'Generic Mobile Broadband Adapter' 'Up' 8 @('10.64.1.2')))
    [void]$global:HV.Adapters.Add((New-MockAdapter 'Bluetooth Network Connection' 'Bluetooth Device (Personal Area Network)' 'Up' 10))
    $r = Invoke-Import (Get-SwitchParams) @('Ethernet')
    Expect 'only Ethernet is offered (no number prompt), and the switch goes on Ethernet' $r (
        -not (Test-Contains $r ') Cellular') -and -not (Test-Contains $r ') Bluetooth') -and (Get-Prompts $r).Count -eq 1 -and
        @(Get-NewSwitchCalls $r) -ccontains "New-VMSwitch -Name '$NewSwitch' -NetAdapterName 'Ethernet' -AllowManagementOS `$true")
    Expect 'says which adapters cannot carry a virtual switch' $r ((Test-Contains $r 'cannot carry a virtual switch') -and (Test-Contains $r "'Cellular'") -and (Test-Contains $r "'Bluetooth Network Connection'"))
    Expect 'wireless WAN is not labelled Wi-Fi' $r (-not ((@(Get-OutputLine $r 'Cellular') -join ' ') -match 'Wi-Fi'))

    foreach ($n in @('Cellular', 'Bluetooth Network Connection')) {
        $null = New-Scenario "switch-cannot-carry-$($n.Split(' ')[0].ToLowerInvariant())"
        Set-OnlyDefaultSwitch
        [void]$global:HV.Adapters.Add((New-MockAdapter 'Cellular' 'Generic Mobile Broadband Adapter' 'Up' 8 @('10.64.1.2')))
        [void]$global:HV.Adapters.Add((New-MockAdapter 'Bluetooth Network Connection' 'Bluetooth Device (Personal Area Network)' 'Up' 10))
        $p = Get-BaseParams; $p.NetAdapterName = $n; $p.ConfirmNetworkInterruption = $true
        $r = Invoke-Import $p
        Expect "-NetAdapterName '$n': exit 1 before anything changes" $r ((Test-RefusedUnchanged $r) -and (Test-Contains $r 'cannot carry a virtual switch'))
    }

    # NdisMedium 16 (native 802.11) alone is enough to mark Wi-Fi.
    $null = New-Scenario 'switch-wifi-ndismedium-only'
    Set-OnlyDefaultSwitch
    $w = New-MockAdapter 'Red inalambrica' $WifiDesc 'Up' 9 @('192.168.1.30')
    $w.Remove('NdisPhysicalMedium'); $w.Remove('PhysicalMediaType')
    [void]$global:HV.Adapters.Add($w)
    $r = Invoke-Import (Get-SwitchParams) @('x')
    Expect 'an adapter with only NdisMedium 16 is marked not recommended' $r ((@(Get-OutputLine $r ') Red inalambrica') -join ' ') -match 'not recommended')
}

# The adapter carrying the admin's own session (SSH or Remote Desktop) is
# detected, advisory and fail-open. Lab values: SSH arrives over Wi-Fi
# (192.168.4.44, ifIndex 10); the switch goes on Ethernet (192.168.4.45, 18).
function Set-LabAdapters {
    Set-OnlyDefaultSwitch
    $global:HV.Adapters = [System.Collections.ArrayList]@(
        (New-MockAdapter 'Ethernet' $EthDesc 'Up' 14 @('192.168.4.45', 'fe80::abcd') $true 18),
        (New-MockAdapter 'Wi-Fi' $WifiDesc 'Up' 9 @('192.168.4.44') $true 10))
}
function TestSwitch_SessionAdapterDetected {
    $created = "New-VMSwitch -Name '$NewSwitch' -NetAdapterName 'Ethernet' -AllowManagementOS `$true"
    $null = New-Scenario 'switch-session-lab-ssh-on-wifi'
    Set-LabAdapters
    $global:HV.SshConnection = '192.168.4.30 52692 192.168.4.44 22'
    $p = Get-BaseParams; $p.NetAdapterName = 'Ethernet'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect 'lab case (SSH over Wi-Fi, switch on Ethernet): looked up the SSH server address' $r (Test-Called $r "Get-NetIPAddress -IPAddress '192.168.4.44'")
    Expect '  no session warning, -ConfirmNetworkInterruption is enough' $r (-not (Test-Contains $r 'Your SSH session') -and @(Get-NewSwitchCalls $r) -ccontains $created)

    $null = New-Scenario 'switch-session-lab-list'
    Set-LabAdapters
    $global:HV.SshConnection = '192.168.4.30 52692 192.168.4.44 22'
    $r = Invoke-Import (Get-SwitchParams) @('1', 'Ethernet')
    Expect 'the list marks Wi-Fi as carrying your SSH session, not Ethernet' $r (
        (@(Get-OutputLine $r '2) Wi-Fi') -join ' ') -match 'your SSH session' -and -not ((@(Get-OutputLine $r '1) Ethernet') -join ' ') -match 'your SSH session'))

    $null = New-Scenario 'switch-session-ssh-on-ethernet'
    Set-LabAdapters
    $global:HV.SshConnection = '192.168.4.30 52692 192.168.4.45 22'
    $p = Get-BaseParams; $p.NetAdapterName = 'Ethernet'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    $w = @(Get-OutputLine $r "Your SSH session (from 192.168.4.30) arrives over 'Ethernet': creating the switch will end it, and this script with it.")
    Expect 'SSH over the chosen adapter: [!!] warning naming the client' $r ($w.Count -eq 1 -and $w[0].Contains('[!!]'))
    Expect '  -Yes -ConfirmNetworkInterruption refused: exit 1, nothing written, says it is not enough' $r ((Test-RefusedUnchanged $r) -and (Test-Contains $r '-ConfirmNetworkInterruption is not enough'))

    $null = New-Scenario 'switch-session-ssh-on-ethernet-typed'
    Set-LabAdapters
    $global:HV.SshConnection = '192.168.4.30 52692 192.168.4.45 22'
    $p = Get-SwitchParams; $p.NetAdapterName = 'Ethernet'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p @('Ethernet')
    Expect '  without -Yes: asks for the typed name instead, which confirms it' $r ((Get-Prompts $r).Count -eq 1 -and @(Get-NewSwitchCalls $r) -ccontains $created)

    # A wrong name there: the hint agrees with the prompt (case and accents
    # do not matter), it never asks for the name "exactly".
    $null = New-Scenario 'switch-session-ssh-on-ethernet-wrong'
    Set-LabAdapters
    $global:HV.SshConnection = '192.168.4.30 52692 192.168.4.45 22'
    $r = Invoke-Import $p @('Ethernt')
    Expect '  a wrong typed name: refused, and the hint says case and accents do not matter' $r (
        (Test-RefusedUnchanged $r) -and (Test-Contains $r 'Type the adapter name again (case and accents do not matter), pick another adapter, or run this from the console.') -and
        -not (Test-Contains $r 'exactly'))

    $null = New-Scenario 'switch-session-ssh-ipv6-scope'
    Set-LabAdapters
    $global:HV.SshConnection = 'fe80::1%7 50000 fe80::abcd%18 22'
    $p = Get-BaseParams; $p.NetAdapterName = 'Ethernet'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect 'IPv6 with %scope: scope stripped, still detected and refused' $r (
        (Test-Called $r "Get-NetIPAddress -IPAddress 'fe80::abcd'") -and (Test-Contains $r 'Your SSH session (from fe80::1)') -and (Test-RefusedUnchanged $r))

    $null = New-Scenario 'switch-session-rdp-on-ethernet'
    Set-LabAdapters
    $global:HV.SessionName = 'RDP-Tcp#2'
    $global:HV.RdpPort = 3390
    [void]$global:HV.TcpConnections.Add(@{ LocalAddress = '192.168.4.45'; LocalPort = 3390; RemoteAddress = '192.168.4.30'; RemotePort = 51000; State = 'Established' })
    $p = Get-BaseParams; $p.NetAdapterName = 'Ethernet'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    $w = @(Get-OutputLine $r "Your Remote Desktop session (from 192.168.4.30) arrives over 'Ethernet'")
    Expect 'Remote Desktop over the chosen adapter (port from the registry): [!!] warning' $r (
        (Test-Called $r "Get-NetTCPConnection -State 'Established' -LocalPort 3390") -and $w.Count -eq 1 -and $w[0].Contains('[!!]'))
    Expect '  -Yes -ConfirmNetworkInterruption refused' $r (Test-RefusedUnchanged $r)

    $null = New-Scenario 'switch-session-rdp-default-port-on-wifi'
    Set-LabAdapters
    $global:HV.SessionName = 'RDP-Tcp#0'
    [void]$global:HV.TcpConnections.Add(@{ LocalAddress = '192.168.4.44'; LocalPort = 3389; RemoteAddress = '192.168.4.30'; RemotePort = 51000; State = 'Established' })
    $r = Invoke-Import $p
    Expect 'Remote Desktop (default port 3389) over Wi-Fi, switch on Ethernet: no warning, created' $r (
        (Test-Called $r "Get-NetTCPConnection -State 'Established' -LocalPort 3389") -and -not (Test-Contains $r 'Your Remote Desktop session') -and @(Get-NewSwitchCalls $r) -ccontains $created)

    $null = New-Scenario 'switch-session-probe-throws'
    Set-LabAdapters
    $global:HV.SshConnection = '192.168.4.30 52692 192.168.4.45 22'
    $global:HV.SessionProbeThrows = $true
    $r = Invoke-Import $p
    Expect 'detection throws: no warning, no crash, created as before' $r (
        -not (Test-Contains $r 'Your SSH session') -and -not (Test-Contains $r 'Unexpected error') -and $r.ExitCode -eq 0 -and @(Get-NewSwitchCalls $r) -ccontains $created)

    $null = New-Scenario 'switch-session-console'
    Set-LabAdapters
    $r = Invoke-Import $p
    Expect 'console session: no session lookups at all' $r (-not (Test-Called $r 'Get-NetTCPConnection') -and @($r.Calls | Where-Object { $_ -like 'Get-NetIPAddress -IPAddress*' }).Count -eq 0)
}

function TestSwitch_NeverUsesDefaultSwitch {
    $null = New-Scenario 'switch-only-default'
    Set-OnlyDefaultSwitch
    $r = Invoke-Import (Get-SwitchParams) @('Ethernet')
    Expect 'only the Default Switch: goes to creation, never reuses it' $r (
        (Get-NewSwitchCalls $r).Count -eq 1 -and -not (Test-Contains $r "connect to the External switch 'Default Switch'"))
    Expect 'says why the Default Switch is not used' $r (Test-Contains $r 'The Default Switch is not used')

    $null = New-Scenario 'switch-only-default-yes'
    Set-OnlyDefaultSwitch
    $r = Invoke-Import (Get-BaseParams)
    Expect 'with -Yes: refused (creation path), not reused' $r ((Test-RefusedUnchanged $r) -and -not (Test-Contains $r "connect to the External switch 'Default Switch'"))

    # Even if it were reported as External, its fixed ID gives it away.
    $null = New-Scenario 'switch-default-reported-external'
    $global:HV.Switches = [System.Collections.ArrayList]@(New-MockSwitch 'Default Switch' 'External' $null $DefaultSwitchId)
    $r = Invoke-Import (Get-SwitchParams) @('Ethernet')
    Expect 'a Default Switch reported as External is still not reused' $r (
        (Get-NewSwitchCalls $r).Count -eq 1 -and -not (Test-Contains $r "connect to the External switch 'Default Switch'"))
}

# ==== VM: create, start, report ==============================================
# The calls that change the VM, in order (reads and sleeps left out).
function Get-VmChangeCalls($r) {
    @($r.Calls | Where-Object { $_ -match '^(New-VM|Set-VM|Set-VMMemory|Set-VMProcessor|Set-VMFirmware|Enable-VMIntegrationService|Set-VMNetworkAdapterVlan|Start-VM) ' })
}
function Get-SleepSeconds($r) {
    $total = 0
    foreach ($c in @($r.Calls | Where-Object { $_.StartsWith('Start-Sleep ') })) { if ($c -match '-Seconds (\d+)') { $total += [int]$Matches[1] } }
    $total
}
# The VM is kept: no Remove-VM/Stop-VM ran, and the VM and its disk exist.
function Test-VmKept($r, [string]$vmName, [string]$vhdx) {
    -not (Test-Called $r 'Remove-VM') -and -not (Test-Called $r 'Stop-VM') -and -not (Test-Called $r 'Remove-VMSwitch') -and
    @($global:HV.VMs | Where-Object { $_.Name -eq $vmName }).Count -eq 1 -and (Test-Path -LiteralPath $vhdx)
}
$VmRef = "<VM 'ProjectAchilles'>"
$IsoDate = '\d{4}-\d{2}-\d{2}'

function TestVM_CreatedWithExactSettings {
    $null = New-Scenario 'vm-exact-settings'
    $r = Invoke-Import (Get-BaseParams)
    $target = Join-Path $global:HV.VhdPath 'ProjectAchilles.vhdx'
    $calls = @(Get-VmChangeCalls $r)
    $expected = @(
        "New-VM -Name 'ProjectAchilles' -Generation 2 -MemoryStartupBytes 8589934592 -VHDPath '$($target.Replace("'", "''"))' -SwitchName 'LAN' -BootDevice 'VHD'",
        "Set-VMMemory -VM $VmRef -DynamicMemoryEnabled `$false",
        "Set-VMProcessor -VM $VmRef -Count 4",
        "Set-VMFirmware -VM $VmRef -EnableSecureBoot 'On' -SecureBootTemplate 'MicrosoftUEFICertificateAuthority'",
        "Set-VM -VM $VmRef -AutomaticCheckpointsEnabled `$false -CheckpointType 'Production' -AutomaticStartAction 'Start' -AutomaticStartDelay 30 -AutomaticStopAction 'ShutDown' -Notes 'ProjectAchilles appliance 9.9.9, imported <date>'",
        "Enable-VMIntegrationService -VMIntegrationService <VMIntegrationService 'Guest Service Interface'>",
        "Enable-VMIntegrationService -VMIntegrationService <VMIntegrationService 'Time Synchronization'>",
        "Start-VM -VM $VmRef")
    $same = $calls.Count -eq $expected.Count
    for ($i = 0; $same -and $i -lt $expected.Count; $i++) {
        if ($expected[$i].Contains('<date>')) {
            $same = $calls[$i] -cmatch ('^' + [regex]::Escape($expected[$i]).Replace('<date>', $IsoDate) + '$')
        }
        else { $same = $calls[$i] -ceq $expected[$i] }
    }
    Expect 'exactly these calls, in this order: New-VM, Set-VMMemory, Set-VMProcessor, Set-VMFirmware, Set-VM, Enable-VMIntegrationService x2, Start-VM' $r $same
    if (-not $same) { foreach ($c in $calls) { "     | got: $c" } }
    Expect 'exit 0' $r ($r.ExitCode -eq 0)
    Expect 'New-VM ran with the disk already in place' $r ($global:HV.NewVmSawDisk -eq $true)
    Expect 'both integration services are on afterwards' $r (
        @($global:HV.IntegrationObjects | Where-Object { $_.Enabled -and ($_.Name -eq 'Guest Service Interface' -or $_.Name -eq 'Time Synchronization') }).Count -eq 2)
    Expect 'the notes use today''s date (ISO)' $r (@($calls | Where-Object { $_.Contains("imported $([DateTime]::Now.ToString('yyyy-MM-dd'))'") }).Count -eq 1 -or
        @($calls | Where-Object { $_.Contains("imported $([DateTime]::Now.AddDays(-1).ToString('yyyy-MM-dd'))'") }).Count -eq 1)

    $null = New-Scenario 'vm-exact-settings-custom'
    $p = Get-BaseParams; $p.MemoryGB = 12; $p.CpuCount = 2
    $r = Invoke-Import $p
    $calls = @(Get-VmChangeCalls $r)
    Expect '-MemoryGB 12 -CpuCount 2: 12 GB static, 2 vCPUs' $r (
        $calls.Count -ge 3 -and $calls[0].Contains('-MemoryStartupBytes 12884901888 ') -and $calls[2] -ceq "Set-VMProcessor -VM $VmRef -Count 2")

    # -Version gives the version for the notes (the .vhdx name may not carry it).
    $null = New-Scenario 'vm-notes-version'
    $sums = New-SumsFile 'sums-vhdx-notes' "$FixVhdxHash  disk.vhdx`n"
    $disk = Join-Path $FixDir 'disk.vhdx'
    Copy-Item -LiteralPath $FixVhdx -Destination $disk
    $global:HV.Web[$FixReleaseUrl.Replace($FixVer, '9.9.10')] = "$FixVhdxHash  disk.vhdx`n"
    $r = Invoke-Import @{ Yes = $true; ImagePath = $disk; Version = '9.9.10' }
    Expect 'the notes name the -Version' $r (@(Get-VmChangeCalls $r | Where-Object { $_ -cmatch "^Set-VM .* -Notes 'ProjectAchilles appliance 9\.9\.10, imported $IsoDate'$" }).Count -eq 1)
    $null = New-Scenario 'vm-notes-unknown-version'
    $r = Invoke-Import @{ Yes = $true; ImagePath = $disk; ChecksumFile = $sums }
    Expect 'no version anywhere: the notes say so' $r (@(Get-VmChangeCalls $r | Where-Object { $_ -cmatch "^Set-VM .* -Notes 'ProjectAchilles appliance \(version unknown\), imported $IsoDate'$" }).Count -eq 1)

    # appliance/Makefile names images from git describe, so the version in the
    # name starts with a v: a release, and a build between releases.
    foreach ($case in @(
            @{ Leaf = 'ProjectAchilles-v9.9.11.vhdx'; Want = '9\.9\.11' },
            @{ Leaf = 'ProjectAchilles-v2.6.1-73-gf8953030.vhdx'; Want = '2\.6\.1-73-gf8953030' })) {
        $null = New-Scenario "vm-notes-from-$($case.Leaf)"
        $named = Join-Path $FixDir $case.Leaf
        Copy-Item -LiteralPath $FixVhdx -Destination $named
        $sumsNamed = New-SumsFile "sums-$($case.Leaf)" "$FixVhdxHash  $($case.Leaf)`n"
        $r = Invoke-Import @{ Yes = $true; ImagePath = $named; ChecksumFile = $sumsNamed }
        Expect "$($case.Leaf): the notes give the version without the v" $r (@(Get-VmChangeCalls $r | Where-Object { $_ -cmatch "^Set-VM .* -Notes 'ProjectAchilles appliance $($case.Want), imported $IsoDate'$" }).Count -eq 1)
    }
}

# Integration service names are localized (a Spanish host says "Sincronizacion
# de hora"); the script finds them by their fixed IDs.
function TestVM_IntegrationServicesFoundById {
    $null = New-Scenario 'vm-integration-localized'
    $global:HV.IntegrationServices = @(
        @{ Name = 'Interfaz de servicio invitado'; Guid = '6C09BB55-D683-4DA0-8931-C9BF705F6480'; Enabled = $false },
        @{ Name = 'Latido'; Guid = '84EAAE65-2F2E-45F5-9BB5-0E857DC8EB47'; Enabled = $true },
        @{ Name = 'Sincronizacion de hora'; Guid = '2497F4DE-E9FA-4204-80E4-4B75C46419C0'; Enabled = $false })
    $r = Invoke-Import (Get-BaseParams)
    $en = @($r.Calls | Where-Object { $_.StartsWith('Enable-VMIntegrationService ') })
    Expect 'Spanish names: enables exactly the two services by ID, exit 0' $r (
        $r.ExitCode -eq 0 -and $en.Count -eq 2 -and
        $en[0] -ceq "Enable-VMIntegrationService -VMIntegrationService <VMIntegrationService 'Interfaz de servicio invitado'>" -and
        $en[1] -ceq "Enable-VMIntegrationService -VMIntegrationService <VMIntegrationService 'Sincronizacion de hora'>")

    # Lowercase IDs match (case-insensitive), and an ID that merely contains the
    # GUID (a decoy listed first) is not the service: the match is anchored at the end.
    $null = New-Scenario 'vm-integration-lowercase'
    $global:HV.IntegrationServices = @(
        @{ Name = 'Decoy one'; Guid = '6c09bb55-d683-4da0-8931-c9bf705f6480-x'; Enabled = $false },
        @{ Name = 'Guest Service Interface'; Guid = '6c09bb55-d683-4da0-8931-c9bf705f6480'; Enabled = $false },
        @{ Name = 'Decoy two'; Guid = '2497f4de-e9fa-4204-80e4-4b75c46419c0-x'; Enabled = $false },
        @{ Name = 'Time Synchronization'; Guid = '2497f4de-e9fa-4204-80e4-4b75c46419c0'; Enabled = $false })
    $r = Invoke-Import (Get-BaseParams)
    $en = @($r.Calls | Where-Object { $_.StartsWith('Enable-VMIntegrationService ') })
    Expect 'lowercase GUIDs, decoys with the GUID as a prefix: enables the real two services' $r (
        $r.ExitCode -eq 0 -and $en.Count -eq 2 -and
        $en[0] -ceq "Enable-VMIntegrationService -VMIntegrationService <VMIntegrationService 'Guest Service Interface'>" -and
        $en[1] -ceq "Enable-VMIntegrationService -VMIntegrationService <VMIntegrationService 'Time Synchronization'>")

    $null = New-Scenario 'vm-integration-missing'
    $global:HV.IntegrationServices = @(@{ Name = 'Heartbeat'; Guid = '84EAAE65-2F2E-45F5-9BB5-0E857DC8EB47'; Enabled = $true })
    $r = Invoke-Import (Get-BaseParams)
    Expect 'a service the host does not have: exit 2, names it, prints Remove-VM, never starts the VM' $r (
        $r.ExitCode -eq 2 -and (Test-Contains $r 'Guest Service Interface') -and (Test-Contains $r "Remove-VM -Name 'ProjectAchilles' -Force") -and -not (Test-Called $r 'Start-VM'))
}

function TestVM_VlanAppliedWhenGiven {
    $null = New-Scenario 'vm-vlan'
    $p = Get-BaseParams; $p.VlanId = 42
    $r = Invoke-Import $p
    $calls = @(Get-VmChangeCalls $r)
    $vlan = [array]::IndexOf($calls, "Set-VMNetworkAdapterVlan -VM $VmRef -Access -VlanId 42")
    Expect '-VlanId 42: Set-VMNetworkAdapterVlan -Access -VlanId 42, after the integration services and before Start-VM' $r (
        $r.ExitCode -eq 0 -and $vlan -gt 0 -and $calls[$vlan - 1].StartsWith('Enable-VMIntegrationService') -and $calls[$vlan + 1] -ceq "Start-VM -VM $VmRef")

    $null = New-Scenario 'vm-no-vlan'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'no -VlanId: no VLAN call' $r ($r.ExitCode -eq 0 -and -not (Test-Called $r 'Set-VMNetworkAdapterVlan'))
}

function TestVM_DestinationWithSpaces {
    $dir = New-Scenario 'vm-destination-spaces'
    $dest = Join-Path $dir "Hyper V disks (O'Brien)"
    $p = Get-BaseParams; $p.Destination = $dest; $p.Name = 'Achilles Lab'
    $r = Invoke-Import $p
    $vhdx = Join-Path $dest 'Achilles Lab.vhdx'
    $calls = @(Get-NewVmCalls $r)
    Expect 'New-VM gets the name and the disk path with spaces and an apostrophe, as one argument each' $r (
        $r.ExitCode -eq 0 -and $calls.Count -eq 1 -and
        $calls[0] -ceq "New-VM -Name 'Achilles Lab' -Generation 2 -MemoryStartupBytes 8589934592 -VHDPath '$($vhdx.Replace("'", "''"))' -SwitchName 'LAN' -BootDevice 'VHD'" -and
        (Test-Path -LiteralPath $vhdx))
    Expect 'the console command quotes the name' $r (Test-Contains $r "vmconnect localhost 'Achilles Lab'")
}

function TestVM_NoStartSkipsStart {
    $null = New-Scenario 'vm-no-start'
    $p = Get-BaseParams; $p.NoStart = $true
    $r = Invoke-Import $p
    Expect '-NoStart: exit 0, VM created, no Start-VM, no IP wait' $r (
        $r.ExitCode -eq 0 -and (Get-NewVmCalls $r).Count -eq 1 -and -not (Test-Called $r 'Start-VM') -and
        -not (Test-Called $r 'Get-VMNetworkAdapter') -and -not (Test-Called $r 'Start-Sleep'))
    Expect '  says how to start it, and how to open the console then' $r (
        (Test-Contains $r "Start-VM -Name 'ProjectAchilles'") -and (Test-Contains $r 'vmconnect localhost ProjectAchilles'))
}

function TestVM_NoStartHintUsesExactNameForWildcards {
    $null = New-Scenario 'vm-no-start-wildcard'
    $p = Get-BaseParams; $p.NoStart = $true; $p.Name = 'PA[1]'
    $r = Invoke-Import $p
    Expect '-NoStart with a wildcard name: the start hint selects by exact name, never Start-VM -Name PA[1]' $r (
        $r.ExitCode -eq 0 -and (Test-Contains $r "Get-VM | Where-Object Name -eq 'PA[1]' | Start-VM") -and -not (Test-Contains $r "Start-VM -Name 'PA[1]'"))
}

function TestVM_StartsAndPrintsIp {
    $null = New-Scenario 'vm-start-ip'
    # Nothing, then IPv6 only, then a link-local IPv4, then the real address.
    $global:HV.IpSequence = [System.Collections.ArrayList]@(, @())
    [void]$global:HV.IpSequence.Add(@('fe80::215:5dff:fe04:160'))
    [void]$global:HV.IpSequence.Add(@('169.254.10.20', 'fe80::215:5dff:fe04:160'))
    [void]$global:HV.IpSequence.Add(@('fe80::215:5dff:fe04:160', '192.168.4.60'))
    $r = Invoke-Import (Get-BaseParams)
    $ipLine = @(Get-OutputLine $r '192.168.4.60')
    Expect 'exit 0; reports 192.168.4.60 with [OK] after 4 polls (IPv6 and 169.254.x skipped)' $r (
        $r.ExitCode -eq 0 -and $ipLine.Count -ge 1 -and $ipLine[0].Contains('[OK]') -and $global:HV.IpCalls -eq 4 -and -not (Test-Contains $r '169.254.10.20'))
    Expect 'waited 5 s between polls (mocked sleeps)' $r ((Get-SleepSeconds $r) -eq 15)
    Expect 'prints the console command: vmconnect localhost ProjectAchilles' $r (Test-Contains $r 'vmconnect localhost ProjectAchilles')
    Expect 'says what first boot asks: keyboard layout, admin password, network' $r (Test-Contains $r 'keyboard layout, admin password, network')
    $firstHint = Get-OutputIndex $r 'vmconnect localhost ProjectAchilles'
    Expect 'the console command is printed before the IP wait, and again in the final report' $r (
        $firstHint -ge 0 -and $firstHint -lt (Get-OutputIndex $r 'Waiting up to') -and
        $r.Output.IndexOf('vmconnect localhost ProjectAchilles', $firstHint + 1, [StringComparison]::OrdinalIgnoreCase) -gt (Get-OutputIndex $r 'The VM is running. Its IPv4'))
    Expect 'Start-VM before the first address poll' $r (
        [array]::IndexOf($r.Calls, "Start-VM -VM $VmRef") -ge 0 -and
        [array]::IndexOf($r.Calls, "Start-VM -VM $VmRef") -lt [array]::IndexOf($r.Calls, "Get-VMNetworkAdapter -VM $VmRef"))
    Expect 'no cleanup printed on success' $r (-not (Test-Contains $r 'Remove-VM') -and -not (Test-Contains $r 'Remove-Item'))
}

function TestVM_IpTimeoutIsNotFailure {
    $null = New-Scenario 'vm-ip-timeout'
    $global:HV.IpSequence = New-Object System.Collections.ArrayList
    $global:HV.IpTimeoutS = '2'
    $r = Invoke-Import (Get-BaseParams)
    $warn = @(Get-OutputLine $r 'no IPv4 address')
    Expect 'ACHILLES_IMPORT_IP_TIMEOUT_S=2, no address: exit 0' $r ($r.ExitCode -eq 0 -and -not (Test-Contains $r '[FAIL]'))
    Expect '  waits 2 s in total, says so with [!!] and that it is not an error' $r (
        (Get-SleepSeconds $r) -eq 2 -and $warn.Count -ge 1 -and $warn[0].Contains('[!!]') -and (Test-Contains $r 'not an error'))
    Expect '  points at the console' $r (Test-Contains $r 'vmconnect localhost ProjectAchilles')
    Expect '  no cleanup printed' $r (-not (Test-Contains $r 'Remove-VM'))

    $null = New-Scenario 'vm-ip-timeout-default'
    $global:HV.IpSequence = New-Object System.Collections.ArrayList
    $global:HV.IpTimeoutS = 'soon'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'an unusable ACHILLES_IMPORT_IP_TIMEOUT_S falls back to 300 s' $r ($r.ExitCode -eq 0 -and (Get-SleepSeconds $r) -eq 300)

    $null = New-Scenario 'vm-ip-timeout-cap'
    $global:HV.IpSequence = New-Object System.Collections.ArrayList
    $global:HV.IpTimeoutS = '999999'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'ACHILLES_IMPORT_IP_TIMEOUT_S above 3600 is capped at 3600 s, with a note' $r (
        $r.ExitCode -eq 0 -and (Get-SleepSeconds $r) -eq 3600 -and (Test-Contains $r 'capped at 3600'))

    $null = New-Scenario 'vm-ip-probe-fails'
    $global:HV.FailAt = 'Get-VMNetworkAdapter'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'reading the address fails: still exit 0 (the VM runs), [!!], console hint' $r (
        $r.ExitCode -eq 0 -and (Test-Contains $r 'Could not read the VM') -and (Test-Contains $r 'vmconnect localhost ProjectAchilles') -and -not (Test-Contains $r 'Unexpected error'))
}

function TestVM_ServerCoreHintWithoutVmconnect {
    $null = New-Scenario 'vm-server-core'
    $global:HV.Vmconnect = $false
    $r = Invoke-Import (Get-BaseParams)
    Expect 'no vmconnect.exe: exit 0, says to use SSH after first boot, no vmconnect command' $r (
        $r.ExitCode -eq 0 -and (Test-Contains $r 'use SSH after first boot') -and -not (Test-Contains $r 'vmconnect localhost'))
    Expect '  vmconnect is looked for, never run' $r (-not (Test-Called $r 'vmconnect') -and -not (Test-Called $r 'vmconnect.exe'))

    $null = New-Scenario 'vm-server-core-timeout'
    $global:HV.Vmconnect = $false
    $global:HV.IpSequence = New-Object System.Collections.ArrayList
    $global:HV.IpTimeoutS = '2'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'no address and no vmconnect: exit 0, still the SSH hint' $r ($r.ExitCode -eq 0 -and (Test-Contains $r 'use SSH after first boot'))
}

function TestVM_FailureAfterCreatePrintsCleanup {
    $null = New-Scenario 'vm-fail-firmware'
    $global:HV.FailAt = 'Set-VMFirmware'
    $r = Invoke-Import (Get-BaseParams)
    $target = Join-Path $global:HV.VhdPath 'ProjectAchilles.vhdx'
    $removeVm = Get-OutputIndex $r "Remove-VM -Name 'ProjectAchilles' -Force"
    $removeDisk = Get-OutputIndex $r "Remove-Item -LiteralPath '$target'"
    Expect 'Set-VMFirmware throws: exit 2, says what failed' $r ($r.ExitCode -eq 2 -and (Test-Contains $r 'Secure Boot') -and (Test-Contains $r 'Set-VMFirmware failed'))
    Expect '  the VM and the VHDX are kept' $r (Test-VmKept $r 'ProjectAchilles' $target)
    Expect '  prints Remove-VM, then Remove-Item for the disk' $r ($removeVm -ge 0 -and $removeDisk -gt $removeVm)
    Expect '  no Stop-VM line (it never started), no switch removal (LAN was reused), never started' $r (
        -not (Test-Contains $r 'Stop-VM') -and -not (Test-Contains $r 'Remove-VMSwitch') -and -not (Test-Called $r 'Start-VM'))

    $null = New-Scenario 'vm-fail-start'
    $global:HV.FailAt = 'Start-VM'
    $r = Invoke-Import (Get-BaseParams)
    $stop = Get-OutputIndex $r "Stop-VM -Name 'ProjectAchilles' -TurnOff -Force"
    Expect 'Start-VM throws: exit 2, Stop-VM -TurnOff then Remove-VM then Remove-Item' $r (
        $r.ExitCode -eq 2 -and $stop -ge 0 -and $stop -lt (Get-OutputIndex $r "Remove-VM -Name 'ProjectAchilles' -Force") -and
        (Get-OutputIndex $r "Remove-VM -Name 'ProjectAchilles' -Force") -lt (Get-OutputIndex $r 'Remove-Item -LiteralPath') -and (Test-VmKept $r 'ProjectAchilles' $target))

    $null = New-Scenario 'vm-fail-new-vm'
    $global:HV.FailAt = 'New-VM'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'New-VM throws (no VM): exit 2, the disk''s Remove-Item, no Remove-VM' $r (
        $r.ExitCode -eq 2 -and (Test-Contains $r "Could not create the VM 'ProjectAchilles'") -and (Test-Contains $r 'Remove-Item -LiteralPath') -and -not (Test-Contains $r 'Remove-VM'))

    $null = New-Scenario 'vm-fail-new-vm-after'
    $global:HV.FailAt = 'New-VM:after'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'New-VM creates the VM, then throws: exit 2, Remove-VM offered' $r (
        $r.ExitCode -eq 2 -and (Test-Contains $r "Remove-VM -Name 'ProjectAchilles' -Force") -and (Test-VmKept $r 'ProjectAchilles' $target))

    # A name with wildcard characters: Remove-VM -Name would match others.
    $null = New-Scenario 'vm-fail-wildcard-name'
    $global:HV.FailAt = 'Set-VM'
    $p = Get-BaseParams; $p.Name = 'PA[1]'
    $r = Invoke-Import $p
    Expect "-Name 'PA[1]': the removal selects the VM by exact name" $r (
        $r.ExitCode -eq 2 -and (Test-Contains $r "Get-VM | Where-Object Name -eq 'PA[1]' | Remove-VM -Force") -and -not (Test-Contains $r "Remove-VM -Name 'PA[1]'"))
}

function TestVM_FailureOffersRemovingCreatedSwitchOnly {
    $null = New-Scenario 'vm-fail-created-switch'
    Set-OnlyDefaultSwitch
    $global:HV.FailAt = 'Set-VMFirmware'
    $p = Get-BaseParams; $p.NetAdapterName = 'Ethernet'; $p.ConfirmNetworkInterruption = $true
    $r = Invoke-Import $p
    Expect 'this run created the switch: exit 2, Remove-VMSwitch offered after Remove-VM' $r (
        $r.ExitCode -eq 2 -and (Get-OutputIndex $r "Remove-VMSwitch -Name '$NewSwitch' -Force") -gt (Get-OutputIndex $r "Remove-VM -Name 'ProjectAchilles' -Force") -and
        (Get-OutputIndex $r "Remove-VM -Name 'ProjectAchilles' -Force") -ge 0 -and -not (Test-Called $r 'Remove-VMSwitch'))

    $null = New-Scenario 'vm-fail-reused-switch'
    $global:HV.FailAt = 'Set-VMFirmware'
    $r = Invoke-Import (Get-BaseParams)
    Expect 'a reused switch: exit 2, no Remove-VMSwitch offered' $r ($r.ExitCode -eq 2 -and -not (Test-Contains $r 'Remove-VMSwitch'))

    $null = New-Scenario 'vm-fail-named-switch'
    $global:HV.FailAt = 'Set-VMFirmware'
    $p = Get-BaseParams; $p.SwitchName = 'Default Switch'
    $r = Invoke-Import $p
    Expect 'a -SwitchName switch: exit 2, no Remove-VMSwitch offered' $r ($r.ExitCode -eq 2 -and -not (Test-Contains $r 'Remove-VMSwitch'))
}

# ---- run --------------------------------------------------------------------
$tokens = $null; $parseErrors = $null
$self = [System.Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$tokens, [ref]$parseErrors)
$scenarios = @($self.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -match '^Test[A-Za-z]+_' }, $false) |
    ForEach-Object { $_.Name })
# The static checks always run, whatever -Only says, and gate everything else:
# a script that calls something unmocked (a Hyper-V cmdlet, netsh.exe, ...) or
# does not parse is never run, so a forgotten mock can't reach a real host.
foreach ($s in @($scenarios | Where-Object { $_ -like 'TestStatic_*' })) {
    try { & $s }
    catch { Check "$s ran without a harness error ($($_.Exception.Message))" $false }
}
if ($script:fail) {
    ""
    'Static checks failed: no scenario ran the script. Mock what it calls (or fix it) first.'
    "logs kept for inspection: $root"
    'RESULT: FAIL'
    exit 1
}
foreach ($s in @($scenarios | Where-Object { $_ -notlike 'TestStatic_*' -and $_ -like $Only })) {
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
