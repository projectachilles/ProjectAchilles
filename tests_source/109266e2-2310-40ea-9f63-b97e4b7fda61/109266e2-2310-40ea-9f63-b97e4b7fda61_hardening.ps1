<#
.SYNOPSIS
    Hardening script to protect against ransomware attacks like SafePay.

.DESCRIPTION
    This script implements defensive measures against ransomware attacks
    including mass file encryption, data staging, and file destruction.
    Based on MITRE ATT&CK techniques: T1486, T1560.001, T1490, T1083, T1005.

    Key protections implemented:
    1. Controlled Folder Access - Prevent unauthorized file modifications
    2. Attack Surface Reduction (ASR) Rules - Block ransomware behaviors
    3. File System Auditing - Detect mass file operations
    4. Volume Shadow Copy Protection - Preserve recovery data
    5. Application Control - Block unauthorized utilities
    6. PowerShell Logging - Capture script execution

    Test ID: 109266e2-2310-40ea-9f63-b97e4b7fda61
    MITRE ATT&CK: T1486, T1560.001, T1071.001, T1490, T1083, T1005
    Mitigations: M1040, M1053, M1047, M1038, M1028, M1018

.PARAMETER Undo
    Reverts all changes made by this script to default settings.

.PARAMETER WhatIf
    Shows what changes would be made without actually applying them.

.PARAMETER Verbose
    Provides detailed output of all operations.

.EXAMPLE
    .\109266e2-2310-40ea-9f63-b97e4b7fda61_hardening.ps1
    Applies all hardening settings to protect against ransomware.

.EXAMPLE
    .\109266e2-2310-40ea-9f63-b97e4b7fda61_hardening.ps1 -Undo
    Reverts all hardening settings to default.

.EXAMPLE
    .\109266e2-2310-40ea-9f63-b97e4b7fda61_hardening.ps1 -WhatIf
    Shows what changes would be made without applying them.

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    Requires: Administrator privileges
    Tested on: Windows 10/11, Windows Server 2019/2022
    Idempotent: Yes (safe to run multiple times)

.LINK
    https://attack.mitre.org/techniques/T1486/
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
$Script:LogFile = Join-Path $env:TEMP "ransomware_hardening_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# Test metadata
$TestID = "109266e2-2310-40ea-9f63-b97e4b7fda61"
$TestName = "SafePay Enhanced Ransomware Simulation & Mass Data Operations"
$MitreAttack = "T1486, T1560.001, T1490, T1083, T1005"

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
        Enables Windows Defender Controlled Folder Access.

    .DESCRIPTION
        Configures Controlled Folder Access to protect user folders from
        unauthorized applications. This is the primary defense against
        ransomware file encryption.

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
    #>

    Write-Status "Configuring Controlled Folder Access..." "Header"

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
            Add-ChangeLog "Enable" "Controlled Folder Access" "Disabled" "Enabled"
            Write-Status "Controlled Folder Access enabled" "Success"
        } catch {
            Write-Status "Failed to enable Controlled Folder Access: $($_.Exception.Message)" "Warning"
        }
    }

    # Add additional protected folders
    $additionalFolders = @(
        "$env:USERPROFILE\Documents",
        "$env:USERPROFILE\Desktop",
        "$env:USERPROFILE\Pictures",
        "C:\Users"
    )

    foreach ($folder in $additionalFolders) {
        if (Test-Path $folder) {
            if ($PSCmdlet.ShouldProcess($folder, "Add to protected folders")) {
                try {
                    Add-MpPreference -ControlledFolderAccessProtectedFolders $folder -ErrorAction SilentlyContinue
                    Write-Status "Added protected folder: $folder" "Success"
                } catch {
                    # Folder may already be protected
                    Write-Status "Folder already protected or cannot be added: $folder" "Info"
                }
            }
        }
    }

    Write-Status "Controlled Folder Access configured successfully" "Success"
}

function Set-RansomwareASRRules {
    <#
    .SYNOPSIS
        Configures Attack Surface Reduction (ASR) rules for ransomware protection.

    .DESCRIPTION
        Enables ASR rules specifically targeting ransomware behaviors:
        - Block executable content from email/webmail
        - Block Office apps from creating child processes
        - Block credential stealing from LSASS
        - Block process creations from PSExec/WMI

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
    #>

    Write-Status "Configuring Ransomware ASR Rules..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping ASR configuration" "Warning"
        return
    }

    # ASR Rule GUIDs for ransomware protection
    $asrRules = @{
        # Block executable content from email client and webmail
        "BE9BA2D9-53EA-4CDC-84E5-9B1EEEE46550" = "Block executable content from email/webmail"
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
        # Use advanced ransomware protection
        "C1DB55AB-C21A-4637-BB3F-A12568109D35" = "Use advanced ransomware protection"
        # Block executable files from running unless they meet criteria
        "01443614-CD74-433A-B99E-2ECDC07BFC25" = "Block executable files from running unless they meet criteria"
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

    Write-Status "Ransomware ASR rules configured successfully" "Success"
}

function Set-FileSystemAuditing {
    <#
    .SYNOPSIS
        Enables file system auditing to detect mass file operations.

    .DESCRIPTION
        Configures audit policies to capture file access, creation, and deletion
        events for detecting ransomware activity.

        MITRE Mitigation: M1047 - Audit
    #>

    Write-Status "Configuring File System Auditing..." "Header"

    if ($Undo) {
        Write-Status "Reverting file system auditing to defaults..." "Info"

        if ($PSCmdlet.ShouldProcess("File System Auditing", "Disable")) {
            auditpol /set /subcategory:"File System" /success:disable /failure:disable 2>&1 | Out-Null
            Add-ChangeLog "Disable" "Audit: File System" "Enabled" "Disabled"
            Write-Status "File System auditing disabled" "Success"
        }

        if ($PSCmdlet.ShouldProcess("Handle Manipulation Auditing", "Disable")) {
            auditpol /set /subcategory:"Handle Manipulation" /success:disable /failure:disable 2>&1 | Out-Null
            Add-ChangeLog "Disable" "Audit: Handle Manipulation" "Enabled" "Disabled"
            Write-Status "Handle Manipulation auditing disabled" "Success"
        }
        return
    }

    # Enable File System auditing
    $currentValue = Get-AuditPolicyValue "File System"
    if ($PSCmdlet.ShouldProcess("File System", "Enable Success/Failure auditing")) {
        auditpol /set /subcategory:"File System" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: File System" $currentValue "SuccessAndFailure"
        Write-Status "File System auditing enabled (Event ID 4663)" "Success"
    }

    # Enable Handle Manipulation auditing
    $currentValue = Get-AuditPolicyValue "Handle Manipulation"
    if ($PSCmdlet.ShouldProcess("Handle Manipulation", "Enable Success auditing")) {
        auditpol /set /subcategory:"Handle Manipulation" /success:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Handle Manipulation" $currentValue "Success"
        Write-Status "Handle Manipulation auditing enabled" "Success"
    }

    # Enable Removable Storage auditing (USB data staging)
    $currentValue = Get-AuditPolicyValue "Removable Storage"
    if ($PSCmdlet.ShouldProcess("Removable Storage", "Enable Success/Failure auditing")) {
        auditpol /set /subcategory:"Removable Storage" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Removable Storage" $currentValue "SuccessAndFailure"
        Write-Status "Removable Storage auditing enabled" "Success"
    }

    Write-Status "File System auditing configured successfully" "Success"
}

function Set-VolumeShadowCopyProtection {
    <#
    .SYNOPSIS
        Protects Volume Shadow Copy service from ransomware attacks.

    .DESCRIPTION
        Ensures VSS service is running and configured to protect
        against ransomware attempts to delete shadow copies.

        MITRE Mitigation: M1053 - Data Backup, M1028 - OS Configuration
    #>

    Write-Status "Configuring Volume Shadow Copy Protection..." "Header"

    if ($Undo) {
        Write-Status "Note: VSS protection should remain enabled for data recovery" "Warning"
        return
    }

    # Ensure VSS service is set to Automatic
    if ($PSCmdlet.ShouldProcess("Volume Shadow Copy Service", "Set to Automatic startup")) {
        try {
            Set-Service -Name "VSS" -StartupType Automatic -ErrorAction Stop
            Add-ChangeLog "Set" "Service: VSS Startup Type" "Unknown" "Automatic"
            Write-Status "Volume Shadow Copy service set to Automatic" "Success"
        } catch {
            Write-Status "Failed to configure VSS service: $($_.Exception.Message)" "Warning"
        }
    }

    # Start VSS service if not running
    if ($PSCmdlet.ShouldProcess("Volume Shadow Copy Service", "Start service")) {
        try {
            $vssService = Get-Service -Name "VSS" -ErrorAction Stop
            if ($vssService.Status -ne "Running") {
                Start-Service -Name "VSS" -ErrorAction Stop
                Write-Status "Volume Shadow Copy service started" "Success"
            } else {
                Write-Status "Volume Shadow Copy service already running" "Info"
            }
        } catch {
            Write-Status "Failed to start VSS service: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable System Protection on C: drive
    if ($PSCmdlet.ShouldProcess("System Protection on C:", "Enable")) {
        try {
            # Enable system protection via WMI
            Enable-ComputerRestore -Drive "C:\" -ErrorAction Stop
            Add-ChangeLog "Enable" "System Protection: C:" "Unknown" "Enabled"
            Write-Status "System Protection enabled on C: drive" "Success"
        } catch {
            Write-Status "System Protection may already be enabled or failed: $($_.Exception.Message)" "Info"
        }
    }

    Write-Status "Volume Shadow Copy protection configured successfully" "Success"
}

function Set-PowerShellLogging {
    <#
    .SYNOPSIS
        Enables comprehensive PowerShell logging.

    .DESCRIPTION
        Configures PowerShell script block logging, module logging, and
        transcription to detect malicious script execution.

        MITRE Mitigation: M1047 - Audit
    #>

    Write-Status "Configuring PowerShell Logging..." "Header"

    $psLoggingPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell"
    $scriptBlockPath = "$psLoggingPath\ScriptBlockLogging"
    $moduleLoggingPath = "$psLoggingPath\ModuleLogging"
    $transcriptionPath = "$psLoggingPath\Transcription"

    if ($Undo) {
        Write-Status "Reverting PowerShell logging settings..." "Info"

        foreach ($path in @($scriptBlockPath, $moduleLoggingPath, $transcriptionPath)) {
            if ($PSCmdlet.ShouldProcess($path, "Remove registry key")) {
                try {
                    Remove-Item -Path $path -Force -Recurse -ErrorAction SilentlyContinue
                    Write-Status "Removed: $path" "Success"
                } catch {
                    Write-Status "Failed to remove: $path" "Warning"
                }
            }
        }
        Add-ChangeLog "Disable" "PowerShell Logging" "Enabled" "Disabled"
        return
    }

    # Enable Script Block Logging
    if ($PSCmdlet.ShouldProcess("Script Block Logging", "Enable")) {
        try {
            if (-not (Test-Path $psLoggingPath)) { New-Item -Path $psLoggingPath -Force | Out-Null }
            if (-not (Test-Path $scriptBlockPath)) { New-Item -Path $scriptBlockPath -Force | Out-Null }
            Set-ItemProperty -Path $scriptBlockPath -Name "EnableScriptBlockLogging" -Value 1 -Type DWord -Force
            Set-ItemProperty -Path $scriptBlockPath -Name "EnableScriptBlockInvocationLogging" -Value 1 -Type DWord -Force
            Add-ChangeLog "Enable" "PowerShell Script Block Logging" "Disabled" "Enabled"
            Write-Status "Script Block Logging enabled" "Success"
        } catch {
            Write-Status "Failed to enable Script Block Logging: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Module Logging
    if ($PSCmdlet.ShouldProcess("Module Logging", "Enable")) {
        try {
            if (-not (Test-Path $moduleLoggingPath)) { New-Item -Path $moduleLoggingPath -Force | Out-Null }
            Set-ItemProperty -Path $moduleLoggingPath -Name "EnableModuleLogging" -Value 1 -Type DWord -Force

            # Log all modules
            $moduleNamesPath = "$moduleLoggingPath\ModuleNames"
            if (-not (Test-Path $moduleNamesPath)) { New-Item -Path $moduleNamesPath -Force | Out-Null }
            Set-ItemProperty -Path $moduleNamesPath -Name "*" -Value "*" -Type String -Force

            Add-ChangeLog "Enable" "PowerShell Module Logging" "Disabled" "Enabled"
            Write-Status "Module Logging enabled (all modules)" "Success"
        } catch {
            Write-Status "Failed to enable Module Logging: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "PowerShell logging configured successfully" "Success"
}

function Set-ProcessCreationAuditing {
    <#
    .SYNOPSIS
        Enables process creation auditing with command line logging.

    .DESCRIPTION
        Configures audit policies to capture process creation events
        with full command line arguments for detecting malicious activity.

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

    Write-Status "Process Creation auditing configured successfully" "Success"
}

function Set-DefenderCloudProtection {
    <#
    .SYNOPSIS
        Enables Windows Defender cloud-based protection features.

    .DESCRIPTION
        Configures cloud-delivered protection and automatic sample submission
        for enhanced ransomware detection.

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
    #>

    Write-Status "Configuring Windows Defender Cloud Protection..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping cloud protection" "Warning"
        return
    }

    if ($Undo) {
        Write-Status "Note: Cloud protection is recommended to remain enabled" "Warning"
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

    # Enable Cloud-Delivered Protection (Advanced)
    if ($PSCmdlet.ShouldProcess("Cloud-Delivered Protection", "Enable Advanced")) {
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

    # Enable Behavior Monitoring
    if ($PSCmdlet.ShouldProcess("Behavior Monitoring", "Enable")) {
        try {
            Set-MpPreference -DisableBehaviorMonitoring $false -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: Behavior Monitoring" "Unknown" "Enabled"
            Write-Status "Behavior Monitoring enabled" "Success"
        } catch {
            Write-Status "Failed to enable Behavior Monitoring: $($_.Exception.Message)" "Warning"
        }
    }

    # Set cloud block level to High
    if ($PSCmdlet.ShouldProcess("Cloud Block Level", "Set to High")) {
        try {
            Set-MpPreference -CloudBlockLevel High -ErrorAction Stop
            Add-ChangeLog "Set" "Defender: Cloud Block Level" "Unknown" "High"
            Write-Status "Cloud Block Level set to High" "Success"
        } catch {
            Write-Status "Failed to set Cloud Block Level: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Windows Defender Cloud Protection configured successfully" "Success"
}

# ============================================================================
# Main Execution
# ============================================================================

Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  F0RT1KA Defense Hardening Script - Ransomware Protection" -ForegroundColor Cyan
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

    Set-RansomwareASRRules
    Write-Host ""

    Set-FileSystemAuditing
    Write-Host ""

    Set-VolumeShadowCopyProtection
    Write-Host ""

    Set-PowerShellLogging
    Write-Host ""

    Set-ProcessCreationAuditing
    Write-Host ""

    Set-DefenderCloudProtection
    Write-Host ""

    # Summary
    Write-Host "============================================================================" -ForegroundColor Green
    Write-Host "  Ransomware Hardening Complete!" -ForegroundColor Green
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
    Write-Host "  Get-MpPreference | Select-Object EnableControlledFolderAccess"
    Write-Host ""
    Write-Host "  # Verify ASR rules:" -ForegroundColor Yellow
    Write-Host "  Get-MpPreference | Select-Object -ExpandProperty AttackSurfaceReductionRules_Ids"
    Write-Host ""
    Write-Host "  # Verify Defender status:" -ForegroundColor Yellow
    Write-Host "  Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, BehaviorMonitorEnabled, CloudEnabled"
    Write-Host ""
    Write-Host "  # Verify file system auditing:" -ForegroundColor Yellow
    Write-Host '  auditpol /get /subcategory:"File System"'
    Write-Host ""
    Write-Host "  # Verify VSS service:" -ForegroundColor Yellow
    Write-Host '  Get-Service -Name VSS | Select-Object Status, StartType'
    Write-Host ""
    Write-Host "  # Verify PowerShell logging:" -ForegroundColor Yellow
    Write-Host '  Get-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging" -ErrorAction SilentlyContinue'
    Write-Host ""

} catch {
    Write-Status "Critical error during hardening: $($_.Exception.Message)" "Error"
    Write-Status "Stack trace: $($_.ScriptStackTrace)" "Error"
    exit 1
}

exit 0
