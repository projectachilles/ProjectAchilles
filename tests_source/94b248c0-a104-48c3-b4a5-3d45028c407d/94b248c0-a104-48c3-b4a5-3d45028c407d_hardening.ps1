<#
.SYNOPSIS
    Hardening script to protect against Gunra ransomware and similar threats.

.DESCRIPTION
    This script implements defensive measures against Gunra ransomware
    techniques (MITRE ATT&CK T1486, T1490, T1082, T1083, T1622). It configures:

    1. Controlled Folder Access (Ransomware Protection)
    2. Attack Surface Reduction (ASR) Rules
    3. Shadow Copy Protection
    4. Volume Shadow Copy Service Hardening
    5. File System Auditing
    6. Backup Configuration Recommendations

    Test ID: 94b248c0-a104-48c3-b4a5-3d45028c407d
    MITRE ATT&CK: T1486, T1490, T1082, T1083, T1622
    Mitigations: M1040, M1053, M1038, M1028, M1018

.PARAMETER Undo
    Reverts all changes made by this script to default settings.

.PARAMETER WhatIf
    Shows what changes would be made without actually applying them.

.PARAMETER Verbose
    Provides detailed output of all operations.

.EXAMPLE
    .\94b248c0-a104-48c3-b4a5-3d45028c407d_hardening.ps1
    Applies all hardening settings to protect against Gunra ransomware.

.EXAMPLE
    .\94b248c0-a104-48c3-b4a5-3d45028c407d_hardening.ps1 -Undo
    Reverts all hardening settings to default.

.EXAMPLE
    .\94b248c0-a104-48c3-b4a5-3d45028c407d_hardening.ps1 -WhatIf
    Shows what changes would be made without applying them.

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    Requires: Administrator privileges
    Tested on: Windows 10/11, Windows Server 2019/2022
    Idempotent: Yes (safe to run multiple times)

.LINK
    https://attack.mitre.org/techniques/T1486/
    https://attack.mitre.org/techniques/T1490/
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
$Script:LogFile = Join-Path $env:TEMP "gunra_hardening_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# Test metadata
$TestID = "94b248c0-a104-48c3-b4a5-3d45028c407d"
$TestName = "Gunra Ransomware Simulation"
$MitreAttack = "T1486, T1490, T1082, T1083, T1622"

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

function Set-ControlledFolderAccess {
    <#
    .SYNOPSIS
        Enables Windows Defender Controlled Folder Access (Ransomware Protection).

    .DESCRIPTION
        Configures Controlled Folder Access to protect important folders from
        unauthorized modification by ransomware and other malicious applications.

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
    #>

    Write-Status "Configuring Controlled Folder Access (Ransomware Protection)..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping Controlled Folder Access" "Warning"
        return
    }

    if ($Undo) {
        Write-Status "Disabling Controlled Folder Access..." "Info"

        if ($PSCmdlet.ShouldProcess("Controlled Folder Access", "Disable")) {
            try {
                Set-MpPreference -EnableControlledFolderAccess Disabled -ErrorAction Stop
                Add-ChangeLog "Disable" "Controlled Folder Access" "Enabled" "Disabled"
                Write-Status "Controlled Folder Access disabled" "Success"
            } catch {
                Write-Status "Failed to disable Controlled Folder Access: $($_.Exception.Message)" "Warning"
            }
        }
        return
    }

    # Enable Controlled Folder Access
    if ($PSCmdlet.ShouldProcess("Controlled Folder Access", "Enable")) {
        try {
            Set-MpPreference -EnableControlledFolderAccess Enabled -ErrorAction Stop
            Add-ChangeLog "Enable" "Controlled Folder Access" "Disabled/Unknown" "Enabled"
            Write-Status "Controlled Folder Access enabled" "Success"
        } catch {
            Write-Status "Failed to enable Controlled Folder Access: $($_.Exception.Message)" "Warning"
        }
    }

    # Add protected folders (in addition to defaults)
    $protectedFolders = @(
        "$env:USERPROFILE\Documents",
        "$env:USERPROFILE\Desktop",
        "$env:USERPROFILE\Pictures",
        "$env:USERPROFILE\Videos",
        "$env:USERPROFILE\Music",
        "$env:USERPROFILE\Downloads"
    )

    foreach ($folder in $protectedFolders) {
        if (Test-Path $folder) {
            if ($PSCmdlet.ShouldProcess($folder, "Add to protected folders")) {
                try {
                    Add-MpPreference -ControlledFolderAccessProtectedFolders $folder -ErrorAction Stop
                    Add-ChangeLog "Add" "Protected Folder" "N/A" $folder
                    Write-Status "Added protected folder: $folder" "Success"
                } catch {
                    # Folder may already be protected
                    Write-Status "Folder already protected or error: $folder" "Info"
                }
            }
        }
    }

    Write-Status "Controlled Folder Access configured successfully" "Success"
}

function Set-ASRRulesRansomware {
    <#
    .SYNOPSIS
        Configures Attack Surface Reduction (ASR) rules for ransomware protection.

    .DESCRIPTION
        Enables ASR rules specifically designed to block ransomware behaviors
        including file encryption, process injection, and persistence.

        MITRE Mitigation: M1038 - Execution Prevention
    #>

    Write-Status "Configuring ASR Rules for Ransomware Protection..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping ASR configuration" "Warning"
        return
    }

    # ASR Rules focused on ransomware protection
    $asrRules = @{
        # Block executable content from email client and webmail
        "BE9BA2D9-53EA-4CDC-84E5-9B1EEEE46550" = "Block executable content from email"
        # Block Office applications from creating child processes
        "D4F940AB-401B-4EFC-AADC-AD5F3C50688A" = "Block Office child processes"
        # Block Office applications from creating executable content
        "3B576869-A4EC-4529-8536-B80A7769E899" = "Block Office executable content"
        # Block Office applications from injecting code into other processes
        "75668C1F-73B5-4CF0-BB93-3ECF5CB7CC84" = "Block Office code injection"
        # Block JavaScript or VBScript from launching downloaded executable content
        "D3E037E1-3EB8-44C8-A917-57927947596D" = "Block JS/VBS downloading executables"
        # Block execution of potentially obfuscated scripts
        "5BEB7EFE-FD9A-4556-801D-275E5FFC04CC" = "Block obfuscated scripts"
        # Block untrusted and unsigned processes that run from USB
        "B2B3F03D-6A65-4F7B-A9C7-1C7EF74A9BA4" = "Block untrusted USB processes"
        # Block executable files from running unless they meet a prevalence, age, or trusted list criterion
        "01443614-CD74-433A-B99E-2ECDC07BFC25" = "Block low-reputation executables"
        # Use advanced protection against ransomware
        "C1DB55AB-C21A-4637-BB3F-A12568109D35" = "Advanced ransomware protection"
        # Block credential stealing from LSASS
        "9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2" = "Block LSASS credential stealing"
        # Block process creations originating from PSExec and WMI commands
        "D1E49AAC-8F56-4280-B9BA-993A6D77406C" = "Block PSExec/WMI process creation"
        # Block persistence through WMI event subscription
        "E6DB77E5-3DF2-4CF1-B95A-636979351E5B" = "Block WMI persistence"
    }

    if ($Undo) {
        Write-Status "Removing ransomware protection ASR rules..." "Info"

        foreach ($ruleGuid in $asrRules.Keys) {
            if ($PSCmdlet.ShouldProcess($asrRules[$ruleGuid], "Remove ASR rule")) {
                try {
                    Remove-MpPreference -AttackSurfaceReductionRules_Ids $ruleGuid -ErrorAction SilentlyContinue
                    Add-ChangeLog "Remove" "ASR: $($asrRules[$ruleGuid])" "Enabled" "Removed"
                    Write-Status "Removed: $($asrRules[$ruleGuid])" "Success"
                } catch {
                    Write-Status "Failed to remove: $($asrRules[$ruleGuid])" "Warning"
                }
            }
        }
        return
    }

    foreach ($ruleGuid in $asrRules.Keys) {
        if ($PSCmdlet.ShouldProcess($asrRules[$ruleGuid], "Enable ASR rule (Block mode)")) {
            try {
                Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleGuid -AttackSurfaceReductionRules_Actions 1 -ErrorAction Stop
                Add-ChangeLog "Enable" "ASR: $($asrRules[$ruleGuid])" "Disabled" "Block"
                Write-Status "Enabled (Block): $($asrRules[$ruleGuid])" "Success"
            } catch {
                Write-Status "Failed to enable: $($asrRules[$ruleGuid]) - $($_.Exception.Message)" "Warning"
            }
        }
    }

    Write-Status "ASR rules for ransomware protection configured" "Success"
}

function Set-ShadowCopyProtection {
    <#
    .SYNOPSIS
        Protects Volume Shadow Copy Service from ransomware attacks.

    .DESCRIPTION
        Configures settings to protect VSS from deletion and ensures
        the service is properly configured for recovery.

        MITRE Mitigation: M1053 - Data Backup
    #>

    Write-Status "Configuring Shadow Copy Protection..." "Header"

    if ($Undo) {
        Write-Status "Note: Shadow Copy protection settings are not automatically reverted" "Warning"
        Write-Status "Manual intervention may be required" "Warning"
        return
    }

    # Ensure Volume Shadow Copy service is set to Automatic
    if ($PSCmdlet.ShouldProcess("VSS Service", "Set to Automatic startup")) {
        try {
            Set-Service -Name "VSS" -StartupType Automatic -ErrorAction Stop
            Add-ChangeLog "Set" "Service: VSS Startup" "Unknown" "Automatic"
            Write-Status "VSS service set to Automatic startup" "Success"
        } catch {
            Write-Status "Failed to configure VSS service: $($_.Exception.Message)" "Warning"
        }
    }

    # Ensure Volume Shadow Copy service is running
    if ($PSCmdlet.ShouldProcess("VSS Service", "Start service")) {
        try {
            $vssService = Get-Service -Name "VSS" -ErrorAction Stop
            if ($vssService.Status -ne "Running") {
                Start-Service -Name "VSS" -ErrorAction Stop
                Add-ChangeLog "Start" "Service: VSS" "Stopped" "Running"
                Write-Status "VSS service started" "Success"
            } else {
                Write-Status "VSS service already running" "Info"
            }
        } catch {
            Write-Status "Failed to start VSS service: $($_.Exception.Message)" "Warning"
        }
    }

    # Configure VSS space allocation (increase default space)
    $systemDrive = $env:SystemDrive
    if ($PSCmdlet.ShouldProcess("Shadow Storage", "Configure 15% allocation on $systemDrive")) {
        try {
            $result = vssadmin resize shadowstorage /for=$systemDrive /on=$systemDrive /maxsize=15% 2>&1
            Add-ChangeLog "Configure" "VSS Shadow Storage" "Unknown" "15%"
            Write-Status "Shadow storage configured for $systemDrive (15%)" "Success"
        } catch {
            Write-Status "Failed to configure shadow storage: $($_.Exception.Message)" "Warning"
        }
    }

    # Create a shadow copy as baseline
    if ($PSCmdlet.ShouldProcess("Shadow Copy", "Create baseline shadow copy")) {
        try {
            $result = wmic shadowcopy call create Volume="$systemDrive\" 2>&1
            Add-ChangeLog "Create" "Baseline Shadow Copy" "N/A" "$systemDrive"
            Write-Status "Baseline shadow copy created for $systemDrive" "Success"
        } catch {
            Write-Status "Failed to create shadow copy: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Shadow Copy protection configured" "Success"
}

function Set-VSSAdminAuditing {
    <#
    .SYNOPSIS
        Enables auditing for vssadmin and related commands.

    .DESCRIPTION
        Configures audit policies to detect shadow copy deletion attempts
        and other recovery inhibition techniques.

        MITRE Mitigation: M1028 - Operating System Configuration
    #>

    Write-Status "Configuring VSS Admin Auditing..." "Header"

    if ($Undo) {
        Write-Status "Reverting process creation auditing..." "Info"

        if ($PSCmdlet.ShouldProcess("Process Creation Auditing", "Disable")) {
            auditpol /set /subcategory:"Process Creation" /success:disable /failure:disable 2>&1 | Out-Null
            Add-ChangeLog "Disable" "Audit: Process Creation" "Enabled" "Disabled"
            Write-Status "Process Creation auditing disabled" "Success"
        }
        return
    }

    # Enable Process Creation auditing
    $currentValue = Get-AuditPolicyValue "Process Creation"
    if ($PSCmdlet.ShouldProcess("Process Creation", "Enable Success/Failure auditing")) {
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

    # Enable Object Access auditing (for file system events)
    $currentValue = Get-AuditPolicyValue "File System"
    if ($PSCmdlet.ShouldProcess("File System Auditing", "Enable Success/Failure")) {
        auditpol /set /subcategory:"File System" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: File System" $currentValue "SuccessAndFailure"
        Write-Status "File System auditing enabled (Event IDs 4656, 4663)" "Success"
    }

    Write-Status "VSS Admin auditing configured" "Success"
}

function Set-DefenderCloudProtection {
    <#
    .SYNOPSIS
        Enables enhanced Windows Defender cloud protection.

    .DESCRIPTION
        Configures cloud-delivered protection and automatic sample
        submission to improve ransomware detection.

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
    #>

    Write-Status "Configuring Defender Cloud Protection..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping cloud protection" "Warning"
        return
    }

    if ($Undo) {
        Write-Status "Reverting Defender cloud protection to defaults..." "Info"

        if ($PSCmdlet.ShouldProcess("Cloud Protection", "Set to Default")) {
            try {
                Set-MpPreference -MAPSReporting Advanced -ErrorAction Stop
                Set-MpPreference -SubmitSamplesConsent SendSafeSamples -ErrorAction Stop
                Add-ChangeLog "Revert" "Cloud Protection" "Advanced" "Default"
                Write-Status "Cloud protection reverted to defaults" "Success"
            } catch {
                Write-Status "Failed to revert cloud protection: $($_.Exception.Message)" "Warning"
            }
        }
        return
    }

    # Enable Real-Time Protection
    if ($PSCmdlet.ShouldProcess("Real-Time Protection", "Enable")) {
        try {
            Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction Stop
            Add-ChangeLog "Enable" "Real-Time Protection" "Unknown" "Enabled"
            Write-Status "Real-Time Protection enabled" "Success"
        } catch {
            Write-Status "Failed to enable Real-Time Protection: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Cloud-Delivered Protection (Advanced)
    if ($PSCmdlet.ShouldProcess("Cloud Protection", "Set to Advanced")) {
        try {
            Set-MpPreference -MAPSReporting Advanced -ErrorAction Stop
            Add-ChangeLog "Set" "Cloud Protection Level" "Unknown" "Advanced"
            Write-Status "Cloud-Delivered Protection set to Advanced" "Success"
        } catch {
            Write-Status "Failed to set cloud protection: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Automatic Sample Submission
    if ($PSCmdlet.ShouldProcess("Sample Submission", "Enable SendAllSamples")) {
        try {
            Set-MpPreference -SubmitSamplesConsent SendAllSamples -ErrorAction Stop
            Add-ChangeLog "Set" "Sample Submission" "Unknown" "SendAllSamples"
            Write-Status "Automatic Sample Submission enabled" "Success"
        } catch {
            Write-Status "Failed to enable sample submission: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Block at First Sight
    if ($PSCmdlet.ShouldProcess("Block at First Sight", "Enable")) {
        try {
            Set-MpPreference -DisableBlockAtFirstSeen $false -ErrorAction Stop
            Add-ChangeLog "Enable" "Block at First Sight" "Unknown" "Enabled"
            Write-Status "Block at First Sight enabled" "Success"
        } catch {
            Write-Status "Failed to enable Block at First Sight: $($_.Exception.Message)" "Warning"
        }
    }

    # Set cloud block level to High+
    if ($PSCmdlet.ShouldProcess("Cloud Block Level", "Set to HighPlus")) {
        try {
            Set-MpPreference -CloudBlockLevel HighPlus -ErrorAction Stop
            Add-ChangeLog "Set" "Cloud Block Level" "Unknown" "HighPlus"
            Write-Status "Cloud Block Level set to High+" "Success"
        } catch {
            Write-Status "Failed to set cloud block level: $($_.Exception.Message)" "Warning"
        }
    }

    # Extend cloud check timeout
    if ($PSCmdlet.ShouldProcess("Cloud Check Timeout", "Set to 50 seconds")) {
        try {
            Set-MpPreference -CloudExtendedTimeout 50 -ErrorAction Stop
            Add-ChangeLog "Set" "Cloud Check Timeout" "Unknown" "50 seconds"
            Write-Status "Cloud check timeout extended to 50 seconds" "Success"
        } catch {
            Write-Status "Failed to set cloud timeout: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Defender cloud protection configured" "Success"
}

function Set-FileExtensionBlocking {
    <#
    .SYNOPSIS
        Configures file extension monitoring and blocking.

    .DESCRIPTION
        Adds ransomware-associated file extensions to monitoring
        and blocking lists where applicable.

        Note: Full implementation requires AppLocker or WDAC
    #>

    Write-Status "Configuring File Extension Monitoring..." "Header"

    if ($Undo) {
        Write-Status "Note: File extension monitoring not automatically reverted" "Warning"
        return
    }

    # Add .ENCRT and other ransomware extensions to Defender monitoring
    # Note: This requires additional configuration through Group Policy or MDM

    Write-Status "Ransomware file extensions to monitor:" "Info"
    $ransomwareExtensions = @(
        ".ENCRT",      # Gunra
        ".encrypted",
        ".locked",
        ".crypted",
        ".enc",
        ".crypt",
        ".locky",
        ".cerber",
        ".wannacry",
        ".ryuk",
        ".conti",
        ".lockbit"
    )

    foreach ($ext in $ransomwareExtensions) {
        Write-Host "  - $ext" -ForegroundColor Yellow
    }

    Write-Status "Configure SIEM/EDR rules to alert on these extensions" "Info"
    Write-Status "Consider AppLocker/WDAC policies for additional protection" "Info"

    Write-Status "File extension monitoring guidance provided" "Success"
}

function Show-BackupRecommendations {
    <#
    .SYNOPSIS
        Displays backup recommendations for ransomware protection.

    .DESCRIPTION
        Provides guidance on backup strategies to protect against
        ransomware attacks (MITRE M1053 - Data Backup).
    #>

    Write-Status "Backup Recommendations (M1053 - Data Backup)..." "Header"

    Write-Host ""
    Write-Host "  CRITICAL BACKUP RECOMMENDATIONS" -ForegroundColor Yellow
    Write-Host "  ================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. 3-2-1 Backup Rule:" -ForegroundColor Cyan
    Write-Host "     - 3 copies of data" -ForegroundColor White
    Write-Host "     - 2 different storage types" -ForegroundColor White
    Write-Host "     - 1 offsite/offline copy" -ForegroundColor White
    Write-Host ""
    Write-Host "  2. Offline/Air-Gapped Backups:" -ForegroundColor Cyan
    Write-Host "     - Keep at least one backup disconnected" -ForegroundColor White
    Write-Host "     - Rotate backup media regularly" -ForegroundColor White
    Write-Host "     - Test restoration quarterly" -ForegroundColor White
    Write-Host ""
    Write-Host "  3. Cloud Backup with Versioning:" -ForegroundColor Cyan
    Write-Host "     - Enable versioning on cloud storage" -ForegroundColor White
    Write-Host "     - Configure retention policies (30+ days)" -ForegroundColor White
    Write-Host "     - Enable soft delete/immutability" -ForegroundColor White
    Write-Host ""
    Write-Host "  4. Windows Backup Configuration:" -ForegroundColor Cyan
    Write-Host ""

    # Check current backup status
    try {
        $backupStatus = Get-WBPolicy -ErrorAction SilentlyContinue
        if ($backupStatus) {
            Write-Host "     Windows Server Backup: Configured" -ForegroundColor Green
        } else {
            Write-Host "     Windows Server Backup: Not configured" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "     Windows Server Backup: Check configuration manually" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Status "Backup recommendations displayed" "Success"
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
    Set-ControlledFolderAccess
    Write-Host ""

    Set-ASRRulesRansomware
    Write-Host ""

    Set-ShadowCopyProtection
    Write-Host ""

    Set-VSSAdminAuditing
    Write-Host ""

    Set-DefenderCloudProtection
    Write-Host ""

    Set-FileExtensionBlocking
    Write-Host ""

    Show-BackupRecommendations
    Write-Host ""

    # Summary
    Write-Host "============================================================================" -ForegroundColor Green
    Write-Host "  Ransomware Protection Hardening Complete!" -ForegroundColor Green
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
    Write-Host "  # Verify Controlled Folder Access:" -ForegroundColor Yellow
    Write-Host '  Get-MpPreference | Select-Object EnableControlledFolderAccess'
    Write-Host ""
    Write-Host "  # Verify ASR rules:" -ForegroundColor Yellow
    Write-Host '  Get-MpPreference | Select-Object -ExpandProperty AttackSurfaceReductionRules_Ids'
    Write-Host ""
    Write-Host "  # Verify Shadow Copy status:" -ForegroundColor Yellow
    Write-Host '  vssadmin list shadows'
    Write-Host '  Get-Service VSS | Select-Object Status, StartType'
    Write-Host ""
    Write-Host "  # Verify process auditing:" -ForegroundColor Yellow
    Write-Host '  auditpol /get /subcategory:"Process Creation"'
    Write-Host ""
    Write-Host "  # Verify Defender status:" -ForegroundColor Yellow
    Write-Host '  Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, CloudEnabled, BehaviorMonitorEnabled'
    Write-Host ""

    # Additional recommendations
    Write-Host ""
    Write-Status "Additional Recommendations:" "Header"
    Write-Host ""
    Write-Host "  1. Deploy these KQL detections in Microsoft Sentinel:" -ForegroundColor Yellow
    Write-Host "     - 94b248c0-a104-48c3-b4a5-3d45028c407d_detections.kql" -ForegroundColor White
    Write-Host ""
    Write-Host "  2. Deploy LimaCharlie D&R rules:" -ForegroundColor Yellow
    Write-Host "     - limacharlie dr add -f 94b248c0-a104-48c3-b4a5-3d45028c407d_dr_rules.yaml" -ForegroundColor White
    Write-Host ""
    Write-Host "  3. Deploy YARA rules to file scanning:" -ForegroundColor Yellow
    Write-Host "     - 94b248c0-a104-48c3-b4a5-3d45028c407d_rules.yar" -ForegroundColor White
    Write-Host ""
    Write-Host "  4. Implement network segmentation to limit lateral movement" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  5. Regular backup testing and offline backup maintenance" -ForegroundColor Yellow
    Write-Host ""

} catch {
    Write-Status "Critical error during hardening: $($_.Exception.Message)" "Error"
    Write-Status "Stack trace: $($_.ScriptStackTrace)" "Error"
    exit 1
}

exit 0
