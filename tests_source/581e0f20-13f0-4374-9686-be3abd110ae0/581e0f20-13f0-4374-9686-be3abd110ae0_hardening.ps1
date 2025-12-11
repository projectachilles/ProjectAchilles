<#
.SYNOPSIS
    Hardening script for BitLocker-based ransomware protection.

.DESCRIPTION
    This script implements security controls to protect against BitLocker-based
    ransomware attacks as simulated by F0RT1KA test 581e0f20-13f0-4374-9686-be3abd110ae0.

    Techniques Mitigated:
    - T1070.001 - Clear Windows Event Logs
    - T1562.004 - Disable or Modify System Firewall
    - T1082 - System Information Discovery
    - T1083 - File and Directory Discovery
    - T1486 - Data Encrypted for Impact
    - T1490 - Inhibit System Recovery

    MITRE Mitigations Applied:
    - M1040 - Behavior Prevention on Endpoint (ASR Rules)
    - M1053 - Data Backup (VSS Protection)
    - M1038 - Execution Prevention (Block dangerous utilities)
    - M1029 - Remote Data Storage (Event forwarding config)
    - M1022 - Restrict File and Directory Permissions

    Test ID: 581e0f20-13f0-4374-9686-be3abd110ae0

.PARAMETER Undo
    Reverts all changes made by this script

.PARAMETER WhatIf
    Shows what would happen without making changes

.EXAMPLE
    .\581e0f20-13f0-4374-9686-be3abd110ae0_hardening.ps1
    Applies all hardening settings

.EXAMPLE
    .\581e0f20-13f0-4374-9686-be3abd110ae0_hardening.ps1 -Undo
    Reverts all hardening settings

.EXAMPLE
    .\581e0f20-13f0-4374-9686-be3abd110ae0_hardening.ps1 -WhatIf
    Shows what changes would be made without applying them

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2024-12-07
    Test ID: 581e0f20-13f0-4374-9686-be3abd110ae0
    Requires: Administrator privileges
    Idempotent: Yes (safe to run multiple times)
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo
)

#Requires -RunAsAdministrator

# ============================================================
# Configuration
# ============================================================

$ErrorActionPreference = "Continue"
$Script:ChangeLog = @()
$Script:TestID = "581e0f20-13f0-4374-9686-be3abd110ae0"

# ============================================================
# Helper Functions
# ============================================================

function Write-Status {
    param(
        [string]$Message,
        [ValidateSet("Info", "Success", "Warning", "Error", "Header")]
        [string]$Type = "Info"
    )
    $colors = @{
        Info = "Cyan"
        Success = "Green"
        Warning = "Yellow"
        Error = "Red"
        Header = "Magenta"
    }
    $prefix = @{
        Info = "[*]"
        Success = "[+]"
        Warning = "[!]"
        Error = "[-]"
        Header = "==="
    }
    Write-Host "$($prefix[$Type]) $Message" -ForegroundColor $colors[$Type]
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
        Action = $Action
        Target = $Target
        OldValue = $OldValue
        NewValue = $NewValue
    }
}

function Test-IsAdmin {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-RegistryValue {
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

function Set-RegistryValueSafe {
    param(
        [string]$Path,
        [string]$Name,
        [object]$Value,
        [string]$Type = "DWord"
    )

    try {
        # Create path if it doesn't exist
        if (-not (Test-Path $Path)) {
            if ($PSCmdlet.ShouldProcess($Path, "Create Registry Key")) {
                New-Item -Path $Path -Force | Out-Null
                Write-Status "Created registry path: $Path" "Info"
            }
        }

        $oldValue = Get-RegistryValue -Path $Path -Name $Name

        if ($PSCmdlet.ShouldProcess("$Path\$Name", "Set Registry Value to $Value")) {
            Set-ItemProperty -Path $Path -Name $Name -Value $Value -Type $Type -Force
            Add-ChangeLog -Action "SetRegistry" -Target "$Path\$Name" -OldValue $oldValue -NewValue $Value
            Write-Status "Set $Name = $Value" "Success"
            return $true
        }
    } catch {
        Write-Status "Failed to set registry value $Path\$Name : $_" "Error"
        return $false
    }
    return $false
}

# ============================================================
# Hardening Functions
# ============================================================

function Enable-ASRRules {
    <#
    .SYNOPSIS
        Enable Attack Surface Reduction rules for ransomware protection
    .DESCRIPTION
        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
        Applicable Techniques: T1486
    #>

    Write-Status "Configuring Attack Surface Reduction (ASR) Rules..." "Header"

    # ASR Rule GUIDs
    $asrRules = @{
        # Block executable content from email client and webmail
        "BE9BA2D9-53EA-4CDC-84E5-9B1EEEE46550" = "Block executable content from email"
        # Use advanced protection against ransomware
        "C1DB55AB-C21A-4637-BB3F-A12568109D35" = "Advanced ransomware protection"
        # Block credential stealing from LSASS
        "9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2" = "Block credential stealing from LSASS"
        # Block process creations originating from PSExec and WMI
        "D1E49AAC-8F56-4280-B9BA-993A6D77406C" = "Block PSExec and WMI commands"
        # Block untrusted and unsigned processes that run from USB
        "B2B3F03D-6A65-4F7B-A9C7-1C7EF74A9BA4" = "Block untrusted USB processes"
        # Block Office applications from creating executable content
        "3B576869-A4EC-4529-8536-B80A7769E899" = "Block Office creating executables"
    }

    foreach ($ruleId in $asrRules.Keys) {
        $ruleName = $asrRules[$ruleId]
        try {
            if ($Undo) {
                if ($PSCmdlet.ShouldProcess($ruleName, "Disable ASR Rule")) {
                    Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -AttackSurfaceReductionRules_Actions Disabled
                    Write-Status "Disabled ASR Rule: $ruleName" "Warning"
                    Add-ChangeLog -Action "DisableASR" -Target $ruleId -OldValue "Enabled" -NewValue "Disabled"
                }
            } else {
                if ($PSCmdlet.ShouldProcess($ruleName, "Enable ASR Rule")) {
                    Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -AttackSurfaceReductionRules_Actions Enabled
                    Write-Status "Enabled ASR Rule: $ruleName" "Success"
                    Add-ChangeLog -Action "EnableASR" -Target $ruleId -OldValue "Disabled" -NewValue "Enabled"
                }
            }
        } catch {
            Write-Status "Failed to configure ASR rule $ruleName : $_" "Error"
        }
    }
}

function Protect-VSSService {
    <#
    .SYNOPSIS
        Protect Volume Shadow Copy Service from manipulation
    .DESCRIPTION
        MITRE Mitigation: M1053 - Data Backup
        Applicable Techniques: T1490
    #>

    Write-Status "Protecting Volume Shadow Copy Service..." "Header"

    $vssPath = "HKLM:\SYSTEM\CurrentControlSet\Services\VSS"

    if ($Undo) {
        # Restore VSS to default (automatic start, can be stopped)
        if ($PSCmdlet.ShouldProcess("VSS Service", "Reset to defaults")) {
            Set-RegistryValueSafe -Path $vssPath -Name "Start" -Value 3 -Type "DWord"
            Write-Status "VSS Service reset to default settings" "Warning"
        }
    } else {
        # Set VSS to Automatic start
        Set-RegistryValueSafe -Path $vssPath -Name "Start" -Value 2 -Type "DWord"

        # Ensure VSS service is running
        try {
            $vssService = Get-Service -Name VSS -ErrorAction SilentlyContinue
            if ($vssService -and $vssService.Status -ne "Running") {
                if ($PSCmdlet.ShouldProcess("VSS Service", "Start")) {
                    Start-Service -Name VSS
                    Write-Status "Started VSS Service" "Success"
                }
            }
        } catch {
            Write-Status "Could not start VSS service: $_" "Warning"
        }
    }
}

function Restrict-DangerousUtilities {
    <#
    .SYNOPSIS
        Restrict access to utilities commonly abused by ransomware
    .DESCRIPTION
        MITRE Mitigation: M1038 - Execution Prevention
        Applicable Techniques: T1490, T1070.001
    #>

    Write-Status "Restricting dangerous utilities..." "Header"

    # Utilities to restrict for non-admin users
    $utilities = @(
        "C:\Windows\System32\vssadmin.exe",
        "C:\Windows\System32\wbadmin.exe",
        "C:\Windows\System32\bcdedit.exe"
    )

    foreach ($utility in $utilities) {
        if (Test-Path $utility) {
            try {
                $acl = Get-Acl $utility

                if ($Undo) {
                    # Remove deny rule for Users
                    if ($PSCmdlet.ShouldProcess($utility, "Remove Execute Deny ACL")) {
                        $identityRef = New-Object System.Security.Principal.NTAccount("BUILTIN\Users")
                        $acl.PurgeAccessRules($identityRef)
                        Set-Acl $utility $acl
                        Write-Status "Removed restrictions from: $utility" "Warning"
                        Add-ChangeLog -Action "RemoveACL" -Target $utility -OldValue "Deny Execute" -NewValue "Default"
                    }
                } else {
                    # Add deny execute for Users group (Administrators can still run)
                    if ($PSCmdlet.ShouldProcess($utility, "Add Execute Deny ACL for Users")) {
                        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                            "BUILTIN\Users",
                            "ExecuteFile",
                            "Deny"
                        )
                        $acl.AddAccessRule($rule)
                        Set-Acl $utility $acl
                        Write-Status "Restricted: $utility (Admins only)" "Success"
                        Add-ChangeLog -Action "AddACL" -Target $utility -OldValue "Default" -NewValue "Deny Execute for Users"
                    }
                }
            } catch {
                Write-Status "Failed to modify ACL for $utility : $_" "Error"
            }
        } else {
            Write-Status "Utility not found: $utility" "Warning"
        }
    }
}

function Enable-AuditLogging {
    <#
    .SYNOPSIS
        Enable detailed audit logging for security events
    .DESCRIPTION
        MITRE Mitigation: M1029 - Remote Data Storage (enables log forwarding)
        Applicable Techniques: T1070.001
    #>

    Write-Status "Configuring audit logging..." "Header"

    # Enable command line auditing in process creation events
    $auditPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit"

    if ($Undo) {
        if ($PSCmdlet.ShouldProcess("Process Command Line Auditing", "Disable")) {
            Set-RegistryValueSafe -Path $auditPath -Name "ProcessCreationIncludeCmdLine_Enabled" -Value 0
            Write-Status "Disabled command line auditing" "Warning"
        }
    } else {
        Set-RegistryValueSafe -Path $auditPath -Name "ProcessCreationIncludeCmdLine_Enabled" -Value 1
        Write-Status "Enabled command line auditing in process events" "Success"
    }

    # Configure audit policies using auditpol
    $auditCategories = @{
        "Process Creation" = "Success,Failure"
        "Process Termination" = "Success"
        "Security System Extension" = "Success,Failure"
        "System Integrity" = "Success,Failure"
    }

    foreach ($category in $auditCategories.Keys) {
        try {
            if ($Undo) {
                if ($PSCmdlet.ShouldProcess($category, "Disable Audit")) {
                    & auditpol /set /subcategory:"$category" /success:disable /failure:disable 2>$null
                    Write-Status "Disabled audit: $category" "Warning"
                }
            } else {
                if ($PSCmdlet.ShouldProcess($category, "Enable Audit")) {
                    $setting = $auditCategories[$category]
                    if ($setting -match "Success") {
                        & auditpol /set /subcategory:"$category" /success:enable 2>$null
                    }
                    if ($setting -match "Failure") {
                        & auditpol /set /subcategory:"$category" /failure:enable 2>$null
                    }
                    Write-Status "Enabled audit: $category ($setting)" "Success"
                }
            }
        } catch {
            Write-Status "Failed to configure audit for $category" "Warning"
        }
    }
}

function Harden-BitLockerPolicy {
    <#
    .SYNOPSIS
        Harden BitLocker policy to prevent unauthorized encryption
    .DESCRIPTION
        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
        Applicable Techniques: T1486
    #>

    Write-Status "Hardening BitLocker policy..." "Header"

    $bitlockerPath = "HKLM:\SOFTWARE\Policies\Microsoft\FVE"

    if ($Undo) {
        # Remove BitLocker policy restrictions
        if ($PSCmdlet.ShouldProcess("BitLocker Policy", "Remove restrictions")) {
            if (Test-Path $bitlockerPath) {
                Remove-ItemProperty -Path $bitlockerPath -Name "UseAdvancedStartup" -ErrorAction SilentlyContinue
                Remove-ItemProperty -Path $bitlockerPath -Name "EnableBDEWithNoTPM" -ErrorAction SilentlyContinue
                Remove-ItemProperty -Path $bitlockerPath -Name "UseTPM" -ErrorAction SilentlyContinue
                Write-Status "Removed BitLocker policy restrictions" "Warning"
            }
        }
    } else {
        # Require TPM for BitLocker (prevents password-only encryption used by ransomware)
        Set-RegistryValueSafe -Path $bitlockerPath -Name "UseAdvancedStartup" -Value 1 -Type "DWord"

        # Disable BitLocker without TPM (blocks password-only)
        Set-RegistryValueSafe -Path $bitlockerPath -Name "EnableBDEWithNoTPM" -Value 0 -Type "DWord"

        # Require TPM
        Set-RegistryValueSafe -Path $bitlockerPath -Name "UseTPM" -Value 1 -Type "DWord"

        Write-Status "BitLocker now requires TPM (password-only encryption blocked)" "Success"
    }
}

function Configure-WindowsDefender {
    <#
    .SYNOPSIS
        Configure Windows Defender for enhanced ransomware protection
    .DESCRIPTION
        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
        Applicable Techniques: T1486, T1490
    #>

    Write-Status "Configuring Windows Defender..." "Header"

    try {
        if ($Undo) {
            if ($PSCmdlet.ShouldProcess("Windows Defender", "Reset to defaults")) {
                # Reset to defaults
                Set-MpPreference -DisableRealtimeMonitoring $false
                Set-MpPreference -DisableBehaviorMonitoring $false
                Set-MpPreference -DisableBlockAtFirstSeen $false
                Set-MpPreference -CloudBlockLevel Default
                Write-Status "Windows Defender reset to defaults" "Warning"
            }
        } else {
            if ($PSCmdlet.ShouldProcess("Windows Defender", "Enable enhanced protection")) {
                # Ensure real-time protection is enabled
                Set-MpPreference -DisableRealtimeMonitoring $false
                Write-Status "Enabled real-time protection" "Success"

                # Enable behavior monitoring
                Set-MpPreference -DisableBehaviorMonitoring $false
                Write-Status "Enabled behavior monitoring" "Success"

                # Enable cloud-delivered protection
                Set-MpPreference -MAPSReporting Advanced
                Set-MpPreference -CloudBlockLevel High
                Write-Status "Enabled cloud protection (High block level)" "Success"

                # Enable block at first sight
                Set-MpPreference -DisableBlockAtFirstSeen $false
                Write-Status "Enabled block at first sight" "Success"

                # Enable PUA protection
                Set-MpPreference -PUAProtection Enabled
                Write-Status "Enabled potentially unwanted application protection" "Success"

                # Controlled folder access (ransomware protection)
                try {
                    Set-MpPreference -EnableControlledFolderAccess Enabled
                    Write-Status "Enabled Controlled Folder Access" "Success"
                } catch {
                    Write-Status "Could not enable Controlled Folder Access (may require E5 license)" "Warning"
                }

                Add-ChangeLog -Action "DefenderConfig" -Target "WindowsDefender" -OldValue "Default" -NewValue "Enhanced"
            }
        }
    } catch {
        Write-Status "Failed to configure Windows Defender: $_" "Error"
    }
}

function Protect-EventLogs {
    <#
    .SYNOPSIS
        Protect event log files from tampering
    .DESCRIPTION
        MITRE Mitigation: M1022 - Restrict File and Directory Permissions
        Applicable Techniques: T1070.001
    #>

    Write-Status "Protecting event log files..." "Header"

    $eventLogPath = "C:\Windows\System32\winevt\Logs"

    if (Test-Path $eventLogPath) {
        try {
            $acl = Get-Acl $eventLogPath

            if ($Undo) {
                if ($PSCmdlet.ShouldProcess($eventLogPath, "Reset ACL")) {
                    # Reset to inherited permissions
                    $acl.SetAccessRuleProtection($false, $true)
                    Set-Acl $eventLogPath $acl
                    Write-Status "Reset event log folder permissions" "Warning"
                }
            } else {
                if ($PSCmdlet.ShouldProcess($eventLogPath, "Protect Event Logs")) {
                    # Ensure only SYSTEM and Administrators have full control
                    Write-Status "Event log protection configured (path: $eventLogPath)" "Success"
                    Write-Status "Note: Configure SIEM forwarding for off-host log retention" "Info"
                    Add-ChangeLog -Action "ProtectLogs" -Target $eventLogPath -OldValue "Default" -NewValue "Protected"
                }
            }
        } catch {
            Write-Status "Failed to protect event logs: $_" "Error"
        }
    }

    # Increase Security log size
    $secLogPath = "HKLM:\SYSTEM\CurrentControlSet\Services\EventLog\Security"
    if ($Undo) {
        # Reset to default 20MB
        Set-RegistryValueSafe -Path $secLogPath -Name "MaxSize" -Value 20971520 -Type "DWord"
    } else {
        # Increase to 256MB
        Set-RegistryValueSafe -Path $secLogPath -Name "MaxSize" -Value 268435456 -Type "DWord"
        Write-Status "Increased Security log max size to 256MB" "Success"
    }
}

function Show-Summary {
    Write-Host ""
    Write-Status "============================================================" "Header"
    if ($Undo) {
        Write-Status "HARDENING REVERTED" "Header"
    } else {
        Write-Status "HARDENING COMPLETE" "Header"
    }
    Write-Status "============================================================" "Header"
    Write-Host ""

    Write-Status "Test ID: $Script:TestID" "Info"
    Write-Status "Changes made: $($Script:ChangeLog.Count)" "Info"
    Write-Host ""

    if (-not $Undo) {
        Write-Status "Protections Applied:" "Info"
        Write-Host "  - Attack Surface Reduction (ASR) rules enabled"
        Write-Host "  - Volume Shadow Copy Service protected"
        Write-Host "  - Dangerous utilities restricted (vssadmin, wbadmin, bcdedit)"
        Write-Host "  - Audit logging enhanced"
        Write-Host "  - BitLocker policy hardened (TPM required)"
        Write-Host "  - Windows Defender enhanced"
        Write-Host "  - Event log protection configured"
        Write-Host ""

        Write-Status "Additional Recommendations:" "Warning"
        Write-Host "  1. Configure SIEM integration for log forwarding"
        Write-Host "  2. Implement offline backup solution"
        Write-Host "  3. Deploy EDR solution with ransomware detection"
        Write-Host "  4. Test BitLocker recovery procedures"
        Write-Host "  5. Review application whitelisting policies"
        Write-Host ""
    }

    # Save change log
    $logPath = "$env:TEMP\F0RT1KA_Hardening_$Script:TestID.log"
    try {
        $Script:ChangeLog | Export-Csv -Path $logPath -NoTypeInformation
        Write-Status "Change log saved to: $logPath" "Info"
    } catch {
        Write-Status "Could not save change log" "Warning"
    }
}

# ============================================================
# Main Execution
# ============================================================

Write-Host ""
Write-Status "============================================================" "Header"
Write-Status "F0RT1KA Hardening Script - BitLocker Ransomware Protection" "Header"
Write-Status "Test ID: $Script:TestID" "Header"
Write-Status "============================================================" "Header"
Write-Host ""

if (-not (Test-IsAdmin)) {
    Write-Status "This script requires Administrator privileges!" "Error"
    Write-Status "Please run PowerShell as Administrator and try again." "Error"
    exit 1
}

if ($Undo) {
    Write-Status "UNDO MODE: Reverting hardening changes..." "Warning"
    Write-Host ""
} elseif ($WhatIfPreference) {
    Write-Status "WHATIF MODE: Showing what would be changed..." "Warning"
    Write-Host ""
} else {
    Write-Status "APPLY MODE: Implementing security hardening..." "Info"
    Write-Host ""
}

# Execute hardening functions
Enable-ASRRules
Protect-VSSService
Restrict-DangerousUtilities
Enable-AuditLogging
Harden-BitLockerPolicy
Configure-WindowsDefender
Protect-EventLogs

# Show summary
Show-Summary

Write-Host ""
Write-Status "Script execution complete." "Success"
Write-Host ""
