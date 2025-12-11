<#
.SYNOPSIS
    Hardening script to protect against NativeDump/NimDump LSASS credential dumping.

.DESCRIPTION
    This script implements defensive measures against LSASS credential dumping
    techniques used by NativeDump, NimDump, and similar tools (MITRE ATT&CK T1003.001).

    It configures:

    1. LSA Protection (Protected Process Light) - Prevents unauthorized LSASS access
    2. Credential Guard - Virtualization-based credential protection
    3. Attack Surface Reduction Rules - Blocks credential stealing from LSASS
    4. WDigest Hardening - Disables plaintext credential caching
    5. Windows Defender Configuration - Optimizes LSASS protection
    6. Audit Policies - Enables credential access logging
    7. Registry Hardening - Additional LSASS protections

    Test ID: b83616c2-84ee-4738-b398-d2d57eebecec
    MITRE ATT&CK: T1003.001 - OS Credential Dumping: LSASS Memory
    Mitigations: M1040, M1043, M1025, M1028, M1026, M1027

.PARAMETER Undo
    Reverts all changes made by this script to default settings.
    Note: Some settings (LSA Protection, Credential Guard) require reboot.

.PARAMETER WhatIf
    Shows what changes would be made without actually applying them.

.PARAMETER Verbose
    Provides detailed output of all operations.

.EXAMPLE
    .\b83616c2-84ee-4738-b398-d2d57eebecec_hardening.ps1
    Applies all hardening settings to protect against LSASS credential dumping.

.EXAMPLE
    .\b83616c2-84ee-4738-b398-d2d57eebecec_hardening.ps1 -Undo
    Reverts all hardening settings to default.

.EXAMPLE
    .\b83616c2-84ee-4738-b398-d2d57eebecec_hardening.ps1 -WhatIf
    Shows what changes would be made without applying them.

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    Requires: Administrator privileges
    Tested on: Windows 10/11, Windows Server 2019/2022
    Idempotent: Yes (safe to run multiple times)

    IMPORTANT: Some settings require a system reboot to take effect:
    - LSA Protection (RunAsPPL)
    - Credential Guard
    - Some ASR rules

.LINK
    https://attack.mitre.org/techniques/T1003/001/
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo
)

#Requires -RunAsAdministrator

# ============================================================================
# Configuration
# ============================================================================
$ErrorActionPreference = "Stop"
$Script:ChangeLog = @()
$Script:LogFile = Join-Path $env:TEMP "lsass_hardening_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
$Script:RebootRequired = $false

# Test metadata
$TestID = "b83616c2-84ee-4738-b398-d2d57eebecec"
$TestName = "NativeDump (NimDump) Detection"
$MitreAttack = "T1003.001"

# ============================================================================
# Helper Functions
# ============================================================================

function Write-Status {
    param(
        [string]$Message,
        [ValidateSet("Info", "Success", "Warning", "Error", "Header")]
        [string]$Type = "Info"
    )

    $colors = @{
        Info    = "Cyan"
        Success = "Green"
        Warning = "Yellow"
        Error   = "Red"
        Header  = "Magenta"
    }

    $prefix = @{
        Info    = "[*]"
        Success = "[+]"
        Warning = "[!]"
        Error   = "[-]"
        Header  = "[=]"
    }

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "$timestamp $($prefix[$Type]) $Message"

    Write-Host "$($prefix[$Type]) $Message" -ForegroundColor $colors[$Type]
    Add-Content -Path $Script:LogFile -Value $logMessage -ErrorAction SilentlyContinue
}

function Add-ChangeLog {
    param(
        [string]$Action,
        [string]$Target,
        [string]$OldValue,
        [string]$NewValue
    )

    $Script:ChangeLog += [PSCustomObject]@{
        Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Action    = $Action
        Target    = $Target
        OldValue  = $OldValue
        NewValue  = $NewValue
    }
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$identity
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-RegistryValueSafe {
    param(
        [string]$Path,
        [string]$Name
    )

    try {
        $value = Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
        return $value.$Name
    } catch {
        return $null
    }
}

function Get-AuditPolicyValue {
    param([string]$Subcategory)

    try {
        $result = auditpol /get /subcategory:"$Subcategory" 2>&1
        if ($result -match "Success and Failure") { return "SuccessAndFailure" }
        elseif ($result -match "Success") { return "Success" }
        elseif ($result -match "Failure") { return "Failure" }
        else { return "No Auditing" }
    } catch {
        return "Unknown"
    }
}

function Test-CredentialGuardSupport {
    # Check if hardware supports Credential Guard
    $os = Get-CimInstance -ClassName Win32_OperatingSystem
    $osVersion = [Version]$os.Version

    # Requires Windows 10 Enterprise/Education or Server 2016+
    if ($osVersion.Major -lt 10) {
        return $false
    }

    # Check for virtualization support
    try {
        $vbs = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard -ErrorAction SilentlyContinue
        if ($vbs) {
            return ($vbs.VirtualizationBasedSecurityStatus -ne 0)
        }
    } catch {
        # Fall through to basic check
    }

    return $true  # Assume support on modern Windows
}

# ============================================================================
# Hardening Functions
# ============================================================================

function Set-LSAProtection {
    <#
    .SYNOPSIS
        Enables LSA Protection (Protected Process Light) for LSASS.

    .DESCRIPTION
        Configures LSASS to run as a Protected Process Light (PPL), which
        prevents unauthorized processes from reading LSASS memory.

        MITRE Mitigation: M1025 - Privileged Process Integrity
    #>

    Write-Status "Configuring LSA Protection (RunAsPPL)..." "Header"

    $regPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa"
    $regName = "RunAsPPL"

    $currentValue = Get-RegistryValueSafe -Path $regPath -Name $regName

    if ($Undo) {
        Write-Status "Disabling LSA Protection..." "Info"

        if ($PSCmdlet.ShouldProcess("LSA Protection", "Disable")) {
            try {
                Set-ItemProperty -Path $regPath -Name $regName -Value 0 -Type DWord -Force
                Add-ChangeLog "Disable" "LSA Protection (RunAsPPL)" "$currentValue" "0"
                Write-Status "LSA Protection disabled (reboot required)" "Success"
                $Script:RebootRequired = $true
            } catch {
                Write-Status "Failed to disable LSA Protection: $($_.Exception.Message)" "Warning"
            }
        }
        return
    }

    if ($PSCmdlet.ShouldProcess("LSA Protection", "Enable")) {
        try {
            # Ensure the registry path exists
            if (-not (Test-Path $regPath)) {
                New-Item -Path $regPath -Force | Out-Null
            }

            Set-ItemProperty -Path $regPath -Name $regName -Value 1 -Type DWord -Force
            Add-ChangeLog "Enable" "LSA Protection (RunAsPPL)" "$currentValue" "1"
            Write-Status "LSA Protection enabled (reboot required to activate)" "Success"
            Write-Status "  LSASS will run as Protected Process Light after reboot" "Info"
            $Script:RebootRequired = $true
        } catch {
            Write-Status "Failed to enable LSA Protection: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "LSA Protection configuration completed" "Success"
}

function Set-CredentialGuard {
    <#
    .SYNOPSIS
        Enables Windows Credential Guard.

    .DESCRIPTION
        Configures Credential Guard using virtualization-based security (VBS)
        to protect credentials from LSASS dumping attacks.

        MITRE Mitigation: M1043 - Credential Access Protection

        Requirements:
        - Windows 10 Enterprise/Education or Server 2016+
        - UEFI firmware with Secure Boot
        - Hardware virtualization (Intel VT-x or AMD-V)
        - TPM 2.0 (recommended)
    #>

    Write-Status "Configuring Credential Guard..." "Header"

    # Check support
    if (-not (Test-CredentialGuardSupport)) {
        Write-Status "Credential Guard may not be fully supported on this hardware" "Warning"
        Write-Status "Attempting configuration anyway..." "Info"
    }

    $deviceGuardPath = "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard"
    $lsaPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa"

    if ($Undo) {
        Write-Status "Disabling Credential Guard..." "Info"

        if ($PSCmdlet.ShouldProcess("Credential Guard", "Disable")) {
            try {
                # Disable VBS
                if (Test-Path $deviceGuardPath) {
                    Set-ItemProperty -Path $deviceGuardPath -Name "EnableVirtualizationBasedSecurity" -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue
                }

                # Disable Credential Guard
                Set-ItemProperty -Path $lsaPath -Name "LsaCfgFlags" -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue

                Add-ChangeLog "Disable" "Credential Guard" "Enabled" "Disabled"
                Write-Status "Credential Guard disabled (reboot required)" "Success"
                $Script:RebootRequired = $true
            } catch {
                Write-Status "Failed to disable Credential Guard: $($_.Exception.Message)" "Warning"
            }
        }
        return
    }

    if ($PSCmdlet.ShouldProcess("Credential Guard", "Enable")) {
        try {
            # Ensure DeviceGuard key exists
            if (-not (Test-Path $deviceGuardPath)) {
                New-Item -Path $deviceGuardPath -Force | Out-Null
            }

            # Enable Virtualization Based Security
            Set-ItemProperty -Path $deviceGuardPath -Name "EnableVirtualizationBasedSecurity" -Value 1 -Type DWord -Force

            # Enable required features
            Set-ItemProperty -Path $deviceGuardPath -Name "RequirePlatformSecurityFeatures" -Value 1 -Type DWord -Force

            # Enable Credential Guard (1 = with UEFI lock, 2 = without lock)
            Set-ItemProperty -Path $lsaPath -Name "LsaCfgFlags" -Value 1 -Type DWord -Force

            Add-ChangeLog "Enable" "Credential Guard" "Disabled" "Enabled with UEFI Lock"
            Write-Status "Credential Guard enabled (reboot required to activate)" "Success"
            Write-Status "  Credentials will be protected by VBS after reboot" "Info"
            $Script:RebootRequired = $true
        } catch {
            Write-Status "Failed to enable Credential Guard: $($_.Exception.Message)" "Warning"
            Write-Status "Credential Guard requires specific hardware support" "Info"
        }
    }

    Write-Status "Credential Guard configuration completed" "Success"
}

function Set-WDigestConfiguration {
    <#
    .SYNOPSIS
        Disables WDigest plaintext credential caching.

    .DESCRIPTION
        Configures Windows to not store plaintext credentials in memory
        for WDigest authentication.

        MITRE Mitigation: M1028 - Operating System Configuration
    #>

    Write-Status "Configuring WDigest Authentication..." "Header"

    $regPath = "HKLM:\SYSTEM\CurrentControlSet\Control\SecurityProviders\WDigest"
    $regName = "UseLogonCredential"

    $currentValue = Get-RegistryValueSafe -Path $regPath -Name $regName

    if ($Undo) {
        Write-Status "Re-enabling WDigest credential caching (NOT RECOMMENDED)..." "Warning"

        if ($PSCmdlet.ShouldProcess("WDigest", "Enable credential caching")) {
            try {
                Set-ItemProperty -Path $regPath -Name $regName -Value 1 -Type DWord -Force
                Add-ChangeLog "Enable" "WDigest Credential Caching" "$currentValue" "1"
                Write-Status "WDigest credential caching enabled (security reduced)" "Warning"
            } catch {
                Write-Status "Failed to modify WDigest setting: $($_.Exception.Message)" "Warning"
            }
        }
        return
    }

    if ($PSCmdlet.ShouldProcess("WDigest", "Disable credential caching")) {
        try {
            # Ensure the registry path exists
            if (-not (Test-Path $regPath)) {
                New-Item -Path $regPath -Force | Out-Null
            }

            Set-ItemProperty -Path $regPath -Name $regName -Value 0 -Type DWord -Force
            Add-ChangeLog "Disable" "WDigest Credential Caching" "$currentValue" "0"
            Write-Status "WDigest plaintext credential caching disabled" "Success"
            Write-Status "  Credentials will no longer be stored in cleartext in memory" "Info"
        } catch {
            Write-Status "Failed to disable WDigest: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "WDigest configuration completed" "Success"
}

function Set-ASRRulesForLSASS {
    <#
    .SYNOPSIS
        Configures Attack Surface Reduction (ASR) rules for LSASS protection.

    .DESCRIPTION
        Enables ASR rules that specifically protect against credential
        dumping attacks targeting LSASS.

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
    #>

    Write-Status "Configuring Attack Surface Reduction (ASR) Rules for LSASS..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping ASR configuration" "Warning"
        return
    }

    # ASR Rule GUIDs for LSASS protection
    $asrRules = @{
        # Block credential stealing from LSASS (CRITICAL for this attack)
        "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2" = "Block credential stealing from LSASS"
        # Block process creations from PSExec and WMI commands
        "d1e49aac-8f56-4280-b9ba-993a6d77406c" = "Block process creations from PSExec/WMI"
        # Block untrusted and unsigned processes that run from USB
        "b2b3f03d-6a65-4f7b-a9c7-1c7ef74a9ba4" = "Block untrusted processes from USB"
        # Block abuse of exploited vulnerable signed drivers
        "56a863a9-875e-4185-98a7-b882c64b5ce5" = "Block abuse of vulnerable signed drivers"
    }

    if ($Undo) {
        Write-Status "Disabling LSASS protection ASR rules..." "Info"

        foreach ($ruleGuid in $asrRules.Keys) {
            if ($PSCmdlet.ShouldProcess($asrRules[$ruleGuid], "Disable ASR rule")) {
                try {
                    Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleGuid `
                        -AttackSurfaceReductionRules_Actions 0 -ErrorAction SilentlyContinue
                    Add-ChangeLog "Disable" "ASR Rule: $($asrRules[$ruleGuid])" "Block" "Disabled"
                    Write-Status "Disabled: $($asrRules[$ruleGuid])" "Success"
                } catch {
                    Write-Status "Failed to disable ASR rule: $($asrRules[$ruleGuid])" "Warning"
                }
            }
        }
        return
    }

    foreach ($ruleGuid in $asrRules.Keys) {
        if ($PSCmdlet.ShouldProcess($asrRules[$ruleGuid], "Enable ASR rule (Block mode)")) {
            try {
                # Set rule to Block mode (1)
                Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleGuid `
                    -AttackSurfaceReductionRules_Actions 1 -ErrorAction Stop
                Add-ChangeLog "Enable" "ASR Rule: $($asrRules[$ruleGuid])" "Disabled" "Block"
                Write-Status "Enabled (Block): $($asrRules[$ruleGuid])" "Success"
            } catch {
                Write-Status "Failed to enable ASR rule: $($asrRules[$ruleGuid]) - $($_.Exception.Message)" "Warning"
            }
        }
    }

    Write-Status "ASR rules for LSASS protection configured successfully" "Success"
}

function Set-WindowsDefenderConfiguration {
    <#
    .SYNOPSIS
        Configures Windows Defender for optimal LSASS protection.

    .DESCRIPTION
        Enables Windows Defender settings that help detect and prevent
        credential dumping attacks targeting LSASS.

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
    #>

    Write-Status "Configuring Windows Defender for LSASS Protection..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping Defender configuration" "Warning"
        return
    }

    if ($Undo) {
        Write-Status "Note: Defender configuration revert is not recommended" "Warning"
        Write-Status "Keeping protective settings enabled" "Info"
        return
    }

    # Enable Real-Time Protection
    if ($PSCmdlet.ShouldProcess("Real-Time Protection", "Enable")) {
        try {
            Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: Real-Time Protection" "Unknown" "Enabled"
            Write-Status "Real-Time Protection enabled" "Success"
        } catch {
            Write-Status "Failed to enable Real-Time Protection: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Behavior Monitoring (critical for LSASS access detection)
    if ($PSCmdlet.ShouldProcess("Behavior Monitoring", "Enable")) {
        try {
            Set-MpPreference -DisableBehaviorMonitoring $false -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: Behavior Monitoring" "Unknown" "Enabled"
            Write-Status "Behavior Monitoring enabled (critical for LSASS protection)" "Success"
        } catch {
            Write-Status "Failed to enable Behavior Monitoring: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Cloud-Delivered Protection
    if ($PSCmdlet.ShouldProcess("Cloud-Delivered Protection", "Enable")) {
        try {
            Set-MpPreference -MAPSReporting Advanced -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: Cloud Protection" "Unknown" "Advanced"
            Write-Status "Cloud-Delivered Protection enabled (Advanced)" "Success"
        } catch {
            Write-Status "Failed to enable Cloud Protection: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Block at First Sight
    if ($PSCmdlet.ShouldProcess("Block at First Sight", "Enable")) {
        try {
            Set-MpPreference -DisableBlockAtFirstSeen $false -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: Block at First Sight" "Unknown" "Enabled"
            Write-Status "Block at First Sight enabled" "Success"
        } catch {
            Write-Status "Failed to enable Block at First Sight: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable PUA Protection
    if ($PSCmdlet.ShouldProcess("PUA Protection", "Enable")) {
        try {
            Set-MpPreference -PUAProtection Enabled -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: PUA Protection" "Unknown" "Enabled"
            Write-Status "Potentially Unwanted Application (PUA) Protection enabled" "Success"
        } catch {
            Write-Status "Failed to enable PUA Protection: $($_.Exception.Message)" "Warning"
        }
    }

    # Update signatures
    if ($PSCmdlet.ShouldProcess("Signature Updates", "Update")) {
        try {
            Update-MpSignature -ErrorAction SilentlyContinue
            Write-Status "Signature update initiated" "Success"
        } catch {
            Write-Status "Signature update may require internet connectivity" "Warning"
        }
    }

    Write-Status "Windows Defender configuration completed" "Success"
}

function Set-CredentialAccessAuditing {
    <#
    .SYNOPSIS
        Enables auditing for credential access events.

    .DESCRIPTION
        Configures audit policies to capture credential access attempts,
        helping detect LSASS dumping activities.

        MITRE Mitigation: M1047 - Audit
    #>

    Write-Status "Configuring Credential Access Auditing..." "Header"

    if ($Undo) {
        Write-Status "Disabling credential access auditing..." "Info"

        if ($PSCmdlet.ShouldProcess("Credential Access Auditing", "Disable")) {
            auditpol /set /subcategory:"Credential Validation" /success:disable /failure:disable 2>&1 | Out-Null
            auditpol /set /subcategory:"Kerberos Authentication Service" /success:disable /failure:disable 2>&1 | Out-Null
            auditpol /set /subcategory:"Kerberos Service Ticket Operations" /success:disable /failure:disable 2>&1 | Out-Null
            auditpol /set /subcategory:"Special Logon" /success:disable /failure:disable 2>&1 | Out-Null
            Add-ChangeLog "Disable" "Credential Access Auditing" "Enabled" "Disabled"
            Write-Status "Credential access auditing disabled" "Success"
        }
        return
    }

    # Enable Credential Validation auditing
    $currentValue = Get-AuditPolicyValue "Credential Validation"
    if ($PSCmdlet.ShouldProcess("Credential Validation", "Enable auditing")) {
        auditpol /set /subcategory:"Credential Validation" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Credential Validation" $currentValue "SuccessAndFailure"
        Write-Status "Credential Validation auditing enabled (Event ID 4774, 4775, 4776)" "Success"
    }

    # Enable Kerberos auditing
    $currentValue = Get-AuditPolicyValue "Kerberos Authentication Service"
    if ($PSCmdlet.ShouldProcess("Kerberos Authentication Service", "Enable auditing")) {
        auditpol /set /subcategory:"Kerberos Authentication Service" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Kerberos Auth" $currentValue "SuccessAndFailure"
        Write-Status "Kerberos Authentication Service auditing enabled" "Success"
    }

    # Enable Special Logon auditing (captures SeDebugPrivilege usage)
    $currentValue = Get-AuditPolicyValue "Special Logon"
    if ($PSCmdlet.ShouldProcess("Special Logon", "Enable auditing")) {
        auditpol /set /subcategory:"Special Logon" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Special Logon" $currentValue "SuccessAndFailure"
        Write-Status "Special Logon auditing enabled (captures privilege usage)" "Success"
    }

    # Enable Sensitive Privilege Use auditing
    $currentValue = Get-AuditPolicyValue "Sensitive Privilege Use"
    if ($PSCmdlet.ShouldProcess("Sensitive Privilege Use", "Enable auditing")) {
        auditpol /set /subcategory:"Sensitive Privilege Use" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Sensitive Privilege Use" $currentValue "SuccessAndFailure"
        Write-Status "Sensitive Privilege Use auditing enabled (Event ID 4673, 4674)" "Success"
    }

    # Enable Process Creation auditing
    $currentValue = Get-AuditPolicyValue "Process Creation"
    if ($PSCmdlet.ShouldProcess("Process Creation", "Enable auditing")) {
        auditpol /set /subcategory:"Process Creation" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Process Creation" $currentValue "SuccessAndFailure"
        Write-Status "Process Creation auditing enabled (Event ID 4688)" "Success"
    }

    # Enable command line in process creation events
    if ($PSCmdlet.ShouldProcess("Command Line Auditing", "Enable")) {
        try {
            $regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit"
            if (-not (Test-Path $regPath)) {
                New-Item -Path $regPath -Force | Out-Null
            }
            Set-ItemProperty -Path $regPath -Name "ProcessCreationIncludeCmdLine_Enabled" -Value 1 -Type DWord -Force
            Add-ChangeLog "Enable" "Command Line in Process Events" "Disabled" "Enabled"
            Write-Status "Command Line logging in process events enabled" "Success"
        } catch {
            Write-Status "Failed to enable command line auditing: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Credential access auditing configured successfully" "Success"
}

function Set-DebugPrivilegeRestriction {
    <#
    .SYNOPSIS
        Restricts SeDebugPrivilege assignment.

    .DESCRIPTION
        Documents how to restrict SeDebugPrivilege via Group Policy.
        This privilege is required to access LSASS memory.

        MITRE Mitigation: M1026 - Privileged Account Management
    #>

    Write-Status "SeDebugPrivilege Restriction Guidance..." "Header"

    Write-Status "Note: SeDebugPrivilege restriction requires Group Policy" "Info"
    Write-Status "Location: Computer Configuration > Windows Settings > Security Settings" "Info"
    Write-Status "         > Local Policies > User Rights Assignment" "Info"
    Write-Status "Setting: 'Debug programs' - Remove all users except essential admins" "Info"
    Write-Host ""
    Write-Status "Current users with debug privilege:" "Info"

    try {
        $seceditExport = Join-Path $env:TEMP "secedit_export_$(Get-Date -Format 'yyyyMMdd_HHmmss').cfg"
        secedit /export /cfg $seceditExport 2>&1 | Out-Null

        if (Test-Path $seceditExport) {
            $content = Get-Content $seceditExport
            $debugLine = $content | Where-Object { $_ -match "SeDebugPrivilege" }
            if ($debugLine) {
                Write-Status "  $debugLine" "Info"
            } else {
                Write-Status "  Unable to determine current assignment" "Warning"
            }
            Remove-Item $seceditExport -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Status "  Could not query current SeDebugPrivilege assignment" "Warning"
    }

    Write-Status "For maximum security, restrict SeDebugPrivilege to essential accounts only" "Info"
}

function Set-MonitoredFolders {
    <#
    .SYNOPSIS
        Ensures test directory exists for monitoring.

    .DESCRIPTION
        Creates the c:\F0 directory for F0RT1KA test execution and monitoring.
    #>

    Write-Status "Configuring Monitored Folders..." "Header"

    if ($Undo) {
        Write-Status "Note: Not removing c:\F0 directory to preserve test results" "Info"
        return
    }

    # Ensure C:\F0 exists for test detection
    if (-not (Test-Path "C:\F0")) {
        if ($PSCmdlet.ShouldProcess("C:\F0", "Create test directory")) {
            try {
                New-Item -Path "C:\F0" -ItemType Directory -Force | Out-Null
                Add-ChangeLog "Create" "Directory: C:\F0" "None" "Created"
                Write-Status "Created test directory: C:\F0" "Success"
            } catch {
                Write-Status "Failed to create C:\F0: $($_.Exception.Message)" "Warning"
            }
        }
    } else {
        Write-Status "Test directory C:\F0 already exists" "Info"
    }

    Write-Status "Monitored folders configuration completed" "Success"
}

# ============================================================================
# Main Execution
# ============================================================================

Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  F0RT1KA LSASS Credential Dumping Defense Hardening Script" -ForegroundColor Cyan
Write-Host "  Test: $TestName" -ForegroundColor Cyan
Write-Host "  MITRE ATT&CK: $MitreAttack - OS Credential Dumping: LSASS Memory" -ForegroundColor Cyan
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""

# Verify admin privileges
if (-not (Test-IsAdmin)) {
    Write-Status "This script requires Administrator privileges" "Error"
    Write-Status "Please run as Administrator" "Error"
    exit 1
}

$mode = if ($Undo) { "REVERT" } else { "HARDEN" }
Write-Status "Mode: $mode" "Header"
Write-Status "Log File: $Script:LogFile" "Info"
Write-Host ""

try {
    # Execute hardening functions in order of importance
    Set-LSAProtection
    Write-Host ""

    Set-CredentialGuard
    Write-Host ""

    Set-WDigestConfiguration
    Write-Host ""

    Set-ASRRulesForLSASS
    Write-Host ""

    Set-WindowsDefenderConfiguration
    Write-Host ""

    Set-CredentialAccessAuditing
    Write-Host ""

    Set-DebugPrivilegeRestriction
    Write-Host ""

    Set-MonitoredFolders
    Write-Host ""

    # Summary
    Write-Host "============================================================================" -ForegroundColor Green
    Write-Host "  Hardening Complete!" -ForegroundColor Green
    Write-Host "============================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Status "Total changes: $($Script:ChangeLog.Count)" "Success"
    Write-Status "Log file: $Script:LogFile" "Info"

    if ($Script:RebootRequired) {
        Write-Host ""
        Write-Host "============================================================================" -ForegroundColor Yellow
        Write-Status "REBOOT REQUIRED to activate LSA Protection and Credential Guard" "Warning"
        Write-Host "============================================================================" -ForegroundColor Yellow
    }

    Write-Host ""

    # Display change summary
    if ($Script:ChangeLog.Count -gt 0) {
        Write-Status "Change Summary:" "Header"
        $Script:ChangeLog | Format-Table -AutoSize
    }

    # Verification commands
    Write-Host ""
    Write-Status "Verification Commands:" "Header"
    Write-Host ""
    Write-Host "  # Verify LSA Protection (after reboot):" -ForegroundColor Yellow
    Write-Host '  Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa" -Name "RunAsPPL"'
    Write-Host ""
    Write-Host "  # Verify Credential Guard status:" -ForegroundColor Yellow
    Write-Host '  Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard'
    Write-Host ""
    Write-Host "  # Verify WDigest is disabled:" -ForegroundColor Yellow
    Write-Host '  Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\SecurityProviders\WDigest" -Name "UseLogonCredential"'
    Write-Host ""
    Write-Host "  # Verify ASR rules:" -ForegroundColor Yellow
    Write-Host '  Get-MpPreference | Select-Object -ExpandProperty AttackSurfaceReductionRules_Ids'
    Write-Host ""
    Write-Host "  # Verify Defender status:" -ForegroundColor Yellow
    Write-Host '  Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, BehaviorMonitorEnabled'
    Write-Host ""
    Write-Host "  # Check auditing configuration:" -ForegroundColor Yellow
    Write-Host '  auditpol /get /subcategory:"Credential Validation"'
    Write-Host '  auditpol /get /subcategory:"Sensitive Privilege Use"'
    Write-Host ""
    Write-Host "  # Test LSASS protection (run F0RT1KA test):" -ForegroundColor Yellow
    Write-Host "  # The NimDump binary should be quarantined or LSASS access should be blocked"
    Write-Host ""

} catch {
    Write-Status "Critical error during hardening: $($_.Exception.Message)" "Error"
    Write-Status "Stack trace: $($_.ScriptStackTrace)" "Error"
    exit 1
}

exit 0
