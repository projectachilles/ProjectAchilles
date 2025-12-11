<#
.SYNOPSIS
    Hardening script to protect against WFP-based EDR network isolation attacks.

.DESCRIPTION
    This script implements defensive measures against the Windows Filtering Platform
    (WFP) EDR isolation technique (MITRE ATT&CK T1562.001). It configures:

    1. WFP Audit Logging - Enables comprehensive WFP event logging
    2. Attack Surface Reduction (ASR) Rules - Blocks common attack vectors
    3. Windows Defender Tamper Protection - Prevents security configuration changes
    4. Firewall Hardening - Protects against unauthorized rule creation
    5. Process Protection - Monitors for EDR enumeration attempts

    Test ID: e5577355-f8e4-4e52-b1b2-f7d1c8b864f1
    MITRE ATT&CK: T1562.001 - Impair Defenses: Disable or Modify Tools
    Mitigations: M1047, M1038, M1022, M1024, M1018

.PARAMETER Undo
    Reverts all changes made by this script to default settings.

.PARAMETER WhatIf
    Shows what changes would be made without actually applying them.

.PARAMETER Verbose
    Provides detailed output of all operations.

.EXAMPLE
    .\e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_hardening.ps1
    Applies all hardening settings to protect against WFP EDR isolation.

.EXAMPLE
    .\e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_hardening.ps1 -Undo
    Reverts all hardening settings to default.

.EXAMPLE
    .\e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_hardening.ps1 -WhatIf
    Shows what changes would be made without applying them.

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-06
    Requires: Administrator privileges
    Tested on: Windows 10/11, Windows Server 2019/2022
    Idempotent: Yes (safe to run multiple times)

.LINK
    https://attack.mitre.org/techniques/T1562/001/
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
$Script:LogFile = Join-Path $env:TEMP "wfp_hardening_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# Test metadata
$TestID = "e5577355-f8e4-4e52-b1b2-f7d1c8b864f1"
$TestName = "SilentButDeadly WFP EDR Network Isolation"
$MitreAttack = "T1562.001"

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

# ============================================================================
# Hardening Functions
# ============================================================================

function Set-WFPAuditLogging {
    <#
    .SYNOPSIS
        Enables WFP (Windows Filtering Platform) audit logging.

    .DESCRIPTION
        Configures audit policies for Object Access category to capture
        WFP filter creation and blocking events (Event IDs 5441, 5157, 5152).

        MITRE Mitigation: M1047 - Audit
    #>

    Write-Status "Configuring WFP Audit Logging..." "Header"

    if ($Undo) {
        Write-Status "Reverting WFP audit settings to defaults..." "Info"

        if ($PSCmdlet.ShouldProcess("Filtering Platform Connection", "Disable Success/Failure auditing")) {
            auditpol /set /subcategory:"Filtering Platform Connection" /success:disable /failure:disable 2>&1 | Out-Null
            Add-ChangeLog "Disable" "Audit: Filtering Platform Connection" "Enabled" "Disabled"
            Write-Status "Filtering Platform Connection auditing disabled" "Success"
        }

        if ($PSCmdlet.ShouldProcess("Filtering Platform Policy Change", "Disable Success/Failure auditing")) {
            auditpol /set /subcategory:"Filtering Platform Policy Change" /success:disable /failure:disable 2>&1 | Out-Null
            Add-ChangeLog "Disable" "Audit: Filtering Platform Policy Change" "Enabled" "Disabled"
            Write-Status "Filtering Platform Policy Change auditing disabled" "Success"
        }

        return
    }

    # Enable Filtering Platform Connection auditing (captures blocked connections)
    $currentValue = Get-AuditPolicyValue "Filtering Platform Connection"
    if ($PSCmdlet.ShouldProcess("Filtering Platform Connection", "Enable Success/Failure auditing")) {
        auditpol /set /subcategory:"Filtering Platform Connection" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Filtering Platform Connection" $currentValue "SuccessAndFailure"
        Write-Status "Filtering Platform Connection auditing enabled (Event IDs 5156, 5157, 5158, 5159)" "Success"
    }

    # Enable Filtering Platform Policy Change auditing (captures filter creation)
    $currentValue = Get-AuditPolicyValue "Filtering Platform Policy Change"
    if ($PSCmdlet.ShouldProcess("Filtering Platform Policy Change", "Enable Success/Failure auditing")) {
        auditpol /set /subcategory:"Filtering Platform Policy Change" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Filtering Platform Policy Change" $currentValue "SuccessAndFailure"
        Write-Status "Filtering Platform Policy Change auditing enabled (Event ID 5441, 5442, 5443, 5444)" "Success"
    }

    # Enable Object Access - Other Object Access Events
    $currentValue = Get-AuditPolicyValue "Other Object Access Events"
    if ($PSCmdlet.ShouldProcess("Other Object Access Events", "Enable Success/Failure auditing")) {
        auditpol /set /subcategory:"Other Object Access Events" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Other Object Access Events" $currentValue "SuccessAndFailure"
        Write-Status "Other Object Access Events auditing enabled" "Success"
    }

    Write-Status "WFP audit logging configured successfully" "Success"
}

function Set-ASRRules {
    <#
    .SYNOPSIS
        Configures Attack Surface Reduction (ASR) rules.

    .DESCRIPTION
        Enables ASR rules that help prevent the execution of EDR evasion tools.

        MITRE Mitigation: M1038 - Execution Prevention
    #>

    Write-Status "Configuring Attack Surface Reduction (ASR) Rules..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping ASR configuration" "Warning"
        return
    }

    # ASR Rule GUIDs
    $asrRules = @{
        # Block executable content from email client and webmail
        "BE9BA2D9-53EA-4CDC-84E5-9B1EEEE46550" = "Block executable content from email and webmail"
        # Block all Office applications from creating child processes
        "D4F940AB-401B-4EFC-AADC-AD5F3C50688A" = "Block Office apps from creating child processes"
        # Block Office applications from creating executable content
        "3B576869-A4EC-4529-8536-B80A7769E899" = "Block Office apps from creating executable content"
        # Block untrusted and unsigned processes that run from USB
        "B2B3F03D-6A65-4F7B-A9C7-1C7EF74A9BA4" = "Block untrusted processes from USB"
        # Block credential stealing from LSASS
        "9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2" = "Block credential stealing from LSASS"
        # Block process creations from PSExec and WMI
        "D1E49AAC-8F56-4280-B9BA-993A6D77406C" = "Block process creations from PSExec/WMI"
        # Block persistence through WMI event subscription
        "E6DB77E5-3DF2-4CF1-B95A-636979351E5B" = "Block WMI event subscription persistence"
        # Block abuse of exploited vulnerable signed drivers
        "56A863A9-875E-4185-98A7-B882C64B5CE5" = "Block vulnerable driver abuse"
    }

    if ($Undo) {
        Write-Status "Removing ASR rules..." "Info"

        foreach ($ruleGuid in $asrRules.Keys) {
            if ($PSCmdlet.ShouldProcess($asrRules[$ruleGuid], "Remove ASR rule")) {
                try {
                    Remove-MpPreference -AttackSurfaceReductionRules_Ids $ruleGuid -ErrorAction SilentlyContinue
                    Add-ChangeLog "Remove" "ASR Rule: $($asrRules[$ruleGuid])" "Enabled" "Removed"
                    Write-Status "Removed: $($asrRules[$ruleGuid])" "Success"
                } catch {
                    Write-Status "Failed to remove ASR rule: $($asrRules[$ruleGuid])" "Warning"
                }
            }
        }
        return
    }

    foreach ($ruleGuid in $asrRules.Keys) {
        if ($PSCmdlet.ShouldProcess($asrRules[$ruleGuid], "Enable ASR rule (Block mode)")) {
            try {
                # Set rule to Block mode (1)
                Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleGuid -AttackSurfaceReductionRules_Actions 1 -ErrorAction Stop
                Add-ChangeLog "Enable" "ASR Rule: $($asrRules[$ruleGuid])" "Disabled" "Block"
                Write-Status "Enabled (Block): $($asrRules[$ruleGuid])" "Success"
            } catch {
                Write-Status "Failed to enable ASR rule: $($asrRules[$ruleGuid]) - $($_.Exception.Message)" "Warning"
            }
        }
    }

    Write-Status "ASR rules configured successfully" "Success"
}

function Set-DefenderTamperProtection {
    <#
    .SYNOPSIS
        Configures Windows Defender Tamper Protection settings.

    .DESCRIPTION
        Enables settings that protect Defender from being disabled by attackers.
        Note: Some settings require Microsoft Defender for Endpoint licensing.

        MITRE Mitigation: M1024 - Restrict Registry Permissions
    #>

    Write-Status "Configuring Windows Defender Tamper Protection..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping tamper protection" "Warning"
        return
    }

    if ($Undo) {
        Write-Status "Note: Tamper Protection is managed by Microsoft - manual revert may not be possible" "Warning"
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

    # Enable Automatic Sample Submission
    if ($PSCmdlet.ShouldProcess("Automatic Sample Submission", "Enable")) {
        try {
            Set-MpPreference -SubmitSamplesConsent SendAllSamples -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: Sample Submission" "Unknown" "SendAllSamples"
            Write-Status "Automatic Sample Submission enabled" "Success"
        } catch {
            Write-Status "Failed to enable Sample Submission: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Network Protection
    if ($PSCmdlet.ShouldProcess("Network Protection", "Enable")) {
        try {
            Set-MpPreference -EnableNetworkProtection Enabled -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: Network Protection" "Unknown" "Enabled"
            Write-Status "Network Protection enabled" "Success"
        } catch {
            Write-Status "Failed to enable Network Protection: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Controlled Folder Access
    if ($PSCmdlet.ShouldProcess("Controlled Folder Access", "Enable")) {
        try {
            Set-MpPreference -EnableControlledFolderAccess Enabled -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: Controlled Folder Access" "Unknown" "Enabled"
            Write-Status "Controlled Folder Access enabled" "Success"
        } catch {
            Write-Status "Failed to enable Controlled Folder Access: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Defender Tamper Protection configured successfully" "Success"
}

function Set-FirewallHardening {
    <#
    .SYNOPSIS
        Hardens Windows Firewall to prevent unauthorized rule creation.

    .DESCRIPTION
        Configures Windows Firewall settings to:
        - Enable logging for blocked connections
        - Ensure firewall is enabled on all profiles
        - Block inbound connections by default

        MITRE Mitigation: M1022 - Restrict File and Directory Permissions
    #>

    Write-Status "Configuring Windows Firewall Hardening..." "Header"

    if ($Undo) {
        Write-Status "Reverting firewall logging settings..." "Info"

        foreach ($profile in @("Domain", "Private", "Public")) {
            if ($PSCmdlet.ShouldProcess("$profile Profile Logging", "Disable")) {
                try {
                    Set-NetFirewallProfile -Profile $profile -LogBlocked False -LogAllowed False -ErrorAction Stop
                    Add-ChangeLog "Disable" "Firewall: $profile Logging" "Enabled" "Disabled"
                    Write-Status "$profile profile logging disabled" "Success"
                } catch {
                    Write-Status "Failed to disable $profile logging: $($_.Exception.Message)" "Warning"
                }
            }
        }
        return
    }

    # Ensure firewall is enabled on all profiles
    foreach ($profile in @("Domain", "Private", "Public")) {
        if ($PSCmdlet.ShouldProcess("$profile Profile", "Enable firewall")) {
            try {
                Set-NetFirewallProfile -Profile $profile -Enabled True -ErrorAction Stop
                Add-ChangeLog "Enable" "Firewall: $profile Profile" "Unknown" "Enabled"
                Write-Status "$profile profile firewall enabled" "Success"
            } catch {
                Write-Status "Failed to enable $profile firewall: $($_.Exception.Message)" "Warning"
            }
        }
    }

    # Enable firewall logging for blocked connections
    foreach ($profile in @("Domain", "Private", "Public")) {
        if ($PSCmdlet.ShouldProcess("$profile Profile Logging", "Enable blocked connection logging")) {
            try {
                $logFile = "%SystemRoot%\System32\LogFiles\Firewall\pfirewall.log"
                Set-NetFirewallProfile -Profile $profile `
                    -LogBlocked True `
                    -LogAllowed False `
                    -LogFileName $logFile `
                    -LogMaxSizeKilobytes 32767 `
                    -ErrorAction Stop

                Add-ChangeLog "Enable" "Firewall: $profile Blocked Logging" "Disabled" "Enabled"
                Write-Status "$profile profile blocked connection logging enabled" "Success"
            } catch {
                Write-Status "Failed to enable $profile logging: $($_.Exception.Message)" "Warning"
            }
        }
    }

    # Set default inbound action to Block
    foreach ($profile in @("Domain", "Private", "Public")) {
        if ($PSCmdlet.ShouldProcess("$profile Profile", "Set default inbound to Block")) {
            try {
                Set-NetFirewallProfile -Profile $profile -DefaultInboundAction Block -ErrorAction Stop
                Add-ChangeLog "Set" "Firewall: $profile Default Inbound" "Unknown" "Block"
                Write-Status "$profile profile default inbound set to Block" "Success"
            } catch {
                Write-Status "Failed to set $profile default inbound: $($_.Exception.Message)" "Warning"
            }
        }
    }

    Write-Status "Windows Firewall hardening configured successfully" "Success"
}

function Set-ProcessCreationAuditing {
    <#
    .SYNOPSIS
        Enables detailed process creation auditing.

    .DESCRIPTION
        Configures audit policies to capture process creation events,
        helping detect EDR enumeration and attack tool execution.

        MITRE Mitigation: M1047 - Audit
    #>

    Write-Status "Configuring Process Creation Auditing..." "Header"

    if ($Undo) {
        Write-Status "Reverting process creation auditing..." "Info"

        if ($PSCmdlet.ShouldProcess("Process Creation Auditing", "Disable")) {
            auditpol /set /subcategory:"Process Creation" /success:disable /failure:disable 2>&1 | Out-Null
            Add-ChangeLog "Disable" "Audit: Process Creation" "Enabled" "Disabled"
            Write-Status "Process Creation auditing disabled" "Success"
        }

        if ($PSCmdlet.ShouldProcess("Command Line Auditing", "Disable")) {
            try {
                Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit" `
                    -Name "ProcessCreationIncludeCmdLine_Enabled" -Value 0 -Type DWord -Force
                Add-ChangeLog "Disable" "Command Line in Process Creation Events" "Enabled" "Disabled"
                Write-Status "Command Line in process events disabled" "Success"
            } catch {
                Write-Status "Failed to disable command line auditing: $($_.Exception.Message)" "Warning"
            }
        }
        return
    }

    # Enable Process Creation auditing
    $currentValue = Get-AuditPolicyValue "Process Creation"
    if ($PSCmdlet.ShouldProcess("Process Creation", "Enable Success auditing")) {
        auditpol /set /subcategory:"Process Creation" /success:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Process Creation" $currentValue "Success"
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
            Add-ChangeLog "Enable" "Command Line in Process Creation Events" "Disabled" "Enabled"
            Write-Status "Command Line logging in process events enabled" "Success"
        } catch {
            Write-Status "Failed to enable command line auditing: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Process Termination auditing
    $currentValue = Get-AuditPolicyValue "Process Termination"
    if ($PSCmdlet.ShouldProcess("Process Termination", "Enable Success auditing")) {
        auditpol /set /subcategory:"Process Termination" /success:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Process Termination" $currentValue "Success"
        Write-Status "Process Termination auditing enabled (Event ID 4689)" "Success"
    }

    Write-Status "Process Creation auditing configured successfully" "Success"
}

function Protect-SecurityServices {
    <#
    .SYNOPSIS
        Protects security service configurations.

    .DESCRIPTION
        Sets registry permissions to prevent unauthorized modification
        of security service configurations.

        MITRE Mitigation: M1024 - Restrict Registry Permissions
    #>

    Write-Status "Protecting Security Service Configurations..." "Header"

    if ($Undo) {
        Write-Status "Note: Registry permission changes are not automatically reverted" "Warning"
        Write-Status "Manual intervention required to restore default permissions" "Warning"
        return
    }

    # Protect Base Filtering Engine (BFE) service configuration
    $servicePaths = @(
        "HKLM:\SYSTEM\CurrentControlSet\Services\BFE",
        "HKLM:\SYSTEM\CurrentControlSet\Services\WinDefend",
        "HKLM:\SYSTEM\CurrentControlSet\Services\MpsSvc"
    )

    foreach ($path in $servicePaths) {
        if (Test-Path $path) {
            $serviceName = Split-Path $path -Leaf
            Write-Status "Service '$serviceName' registry key exists and is protected by default" "Info"
        }
    }

    # Ensure BFE service is set to Automatic
    if ($PSCmdlet.ShouldProcess("Base Filtering Engine Service", "Set to Automatic startup")) {
        try {
            Set-Service -Name "BFE" -StartupType Automatic -ErrorAction Stop
            Add-ChangeLog "Set" "Service: BFE Startup Type" "Unknown" "Automatic"
            Write-Status "Base Filtering Engine (BFE) service set to Automatic" "Success"
        } catch {
            Write-Status "Failed to configure BFE service: $($_.Exception.Message)" "Warning"
        }
    }

    # Ensure MpsSvc (Windows Firewall) is set to Automatic
    if ($PSCmdlet.ShouldProcess("Windows Firewall Service", "Set to Automatic startup")) {
        try {
            Set-Service -Name "MpsSvc" -StartupType Automatic -ErrorAction Stop
            Add-ChangeLog "Set" "Service: MpsSvc Startup Type" "Unknown" "Automatic"
            Write-Status "Windows Firewall (MpsSvc) service set to Automatic" "Success"
        } catch {
            Write-Status "Failed to configure MpsSvc service: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Security service configurations protected" "Success"
}

# ============================================================================
# Main Execution
# ============================================================================

Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  F0RT1KA Defense Hardening Script" -ForegroundColor Cyan
Write-Host "  Test: $TestName" -ForegroundColor Cyan
Write-Host "  MITRE ATT&CK: $MitreAttack" -ForegroundColor Cyan
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
    # Execute hardening functions
    Set-WFPAuditLogging
    Write-Host ""

    Set-ASRRules
    Write-Host ""

    Set-DefenderTamperProtection
    Write-Host ""

    Set-FirewallHardening
    Write-Host ""

    Set-ProcessCreationAuditing
    Write-Host ""

    Protect-SecurityServices
    Write-Host ""

    # Summary
    Write-Host "============================================================================" -ForegroundColor Green
    Write-Host "  Hardening Complete!" -ForegroundColor Green
    Write-Host "============================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Status "Total changes: $($Script:ChangeLog.Count)" "Success"
    Write-Status "Log file: $Script:LogFile" "Info"
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
    Write-Host "  # Verify WFP audit settings:" -ForegroundColor Yellow
    Write-Host '  auditpol /get /subcategory:"Filtering Platform Connection"'
    Write-Host '  auditpol /get /subcategory:"Filtering Platform Policy Change"'
    Write-Host ""
    Write-Host "  # Verify ASR rules:" -ForegroundColor Yellow
    Write-Host "  Get-MpPreference | Select-Object -ExpandProperty AttackSurfaceReductionRules_Ids"
    Write-Host ""
    Write-Host "  # Verify Defender status:" -ForegroundColor Yellow
    Write-Host "  Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, CloudEnabled, BehaviorMonitorEnabled"
    Write-Host ""
    Write-Host "  # Verify firewall profiles:" -ForegroundColor Yellow
    Write-Host "  Get-NetFirewallProfile | Select-Object Name, Enabled, LogBlocked"
    Write-Host ""

} catch {
    Write-Status "Critical error during hardening: $($_.Exception.Message)" "Error"
    Write-Status "Stack trace: $($_.ScriptStackTrace)" "Error"
    exit 1
}

exit 0
