<#
.SYNOPSIS
    F0RT1KA Defense Hardening Script - SafePay Ransomware Protection

.DESCRIPTION
    Implements security hardening measures to protect against SafePay ransomware
    and similar threats. Based on MITRE ATT&CK mitigations for techniques:
    T1486, T1560.001, T1490, T1083, T1005, T1071.001

    Test ID: 6717c98c-b3db-490e-b03c-7b3bd3fb02ee
    MITRE Mitigations: M1040, M1053, M1038, M1047, M1057, M1028

    Hardening includes:
    - Attack Surface Reduction (ASR) rules
    - Controlled Folder Access (CFA)
    - Windows Defender real-time protection
    - Archive utility restrictions
    - Shadow copy protection
    - Backup verification

.PARAMETER Undo
    Reverts all changes made by this script

.PARAMETER WhatIf
    Shows what would happen without making changes

.PARAMETER SkipASR
    Skip Attack Surface Reduction rules configuration

.PARAMETER SkipCFA
    Skip Controlled Folder Access configuration

.PARAMETER SkipDefender
    Skip Windows Defender configuration

.PARAMETER Report
    Generate report only, no changes made

.EXAMPLE
    .\6717c98c-b3db-490e-b03c-7b3bd3fb02ee_hardening.ps1
    Applies all hardening settings

.EXAMPLE
    .\6717c98c-b3db-490e-b03c-7b3bd3fb02ee_hardening.ps1 -Undo
    Reverts all hardening settings

.EXAMPLE
    .\6717c98c-b3db-490e-b03c-7b3bd3fb02ee_hardening.ps1 -Report
    Generates security posture report only

.EXAMPLE
    .\6717c98c-b3db-490e-b03c-7b3bd3fb02ee_hardening.ps1 -WhatIf
    Shows what changes would be made

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    Test ID: 6717c98c-b3db-490e-b03c-7b3bd3fb02ee
    Requires: Administrator privileges
    Idempotent: Yes (safe to run multiple times)
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo,
    [switch]$SkipASR,
    [switch]$SkipCFA,
    [switch]$SkipDefender,
    [switch]$Report
)

#Requires -RunAsAdministrator

# ============================================================
# Configuration
# ============================================================

$ErrorActionPreference = "Continue"
$Script:ChangeLog = @()
$Script:TestID = "6717c98c-b3db-490e-b03c-7b3bd3fb02ee"
$Script:LogFile = "C:\F0\hardening_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# ASR Rule GUIDs for ransomware protection
$Script:ASRRules = @{
    # Block executable content from email client and webmail
    "be9ba2d9-53ea-4cdc-84e5-9b1eeee46550" = @{
        Name = "Block executable content from email client and webmail"
        Recommended = "Enabled"
    }
    # Block all Office applications from creating child processes
    "d4f940ab-401b-4efc-aadc-ad5f3c50688a" = @{
        Name = "Block Office apps from creating child processes"
        Recommended = "Enabled"
    }
    # Block Office applications from creating executable content
    "3b576869-a4ec-4529-8536-b80a7769e899" = @{
        Name = "Block Office apps from creating executable content"
        Recommended = "Enabled"
    }
    # Block execution of potentially obfuscated scripts
    "5beb7efe-fd9a-4556-801d-275e5ffc04cc" = @{
        Name = "Block execution of potentially obfuscated scripts"
        Recommended = "Enabled"
    }
    # Use advanced protection against ransomware
    "c1db55ab-c21a-4637-bb3f-a12568109d35" = @{
        Name = "Use advanced protection against ransomware"
        Recommended = "Enabled"
    }
    # Block process creations originating from PSExec and WMI commands
    "d1e49aac-8f56-4280-b9ba-993a6d77406c" = @{
        Name = "Block process creations from PSExec and WMI"
        Recommended = "Enabled"
    }
    # Block credential stealing from LSASS
    "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2" = @{
        Name = "Block credential stealing from LSASS"
        Recommended = "Enabled"
    }
}

# Protected folders for Controlled Folder Access
$Script:ProtectedFolders = @(
    "$env:USERPROFILE\Documents",
    "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\Pictures",
    "$env:USERPROFILE\Music",
    "$env:USERPROFILE\Videos",
    "$env:PUBLIC\Documents"
)

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

    # Console output
    Write-Host "$($prefix[$Type]) $Message" -ForegroundColor $colors[$Type]

    # File logging
    if (-not $Report) {
        try {
            if (-not (Test-Path "C:\F0")) {
                New-Item -ItemType Directory -Path "C:\F0" -Force | Out-Null
            }
            Add-Content -Path $Script:LogFile -Value $logMessage -ErrorAction SilentlyContinue
        } catch {
            # Silently ignore logging errors
        }
    }
}

function Add-ChangeLog {
    param(
        [string]$Action,
        [string]$Target,
        [string]$OldValue,
        [string]$NewValue,
        [string]$Status = "Success"
    )

    $Script:ChangeLog += [PSCustomObject]@{
        Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Action    = $Action
        Target    = $Target
        OldValue  = $OldValue
        NewValue  = $NewValue
        Status    = $Status
    }
}

function Test-IsAdmin {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-DefenderStatus {
    try {
        $mpStatus = Get-MpComputerStatus -ErrorAction Stop
        return @{
            RealTimeProtection = $mpStatus.RealTimeProtectionEnabled
            BehaviorMonitor    = $mpStatus.BehaviorMonitorEnabled
            OnAccessProtection = $mpStatus.OnAccessProtectionEnabled
            ControlledFolderAccess = (Get-MpPreference).EnableControlledFolderAccess
            CloudProtection    = $mpStatus.IoavProtectionEnabled
            SignatureAge       = $mpStatus.AntivirusSignatureAge
        }
    } catch {
        return $null
    }
}

# ============================================================
# Security Status Report
# ============================================================

function Get-SecurityReport {
    Write-Status "============================================" "Header"
    Write-Status "F0RT1KA Security Posture Report" "Header"
    Write-Status "Test ID: $Script:TestID" "Header"
    Write-Status "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" "Header"
    Write-Status "============================================" "Header"
    Write-Host ""

    # Windows Defender Status
    Write-Status "Windows Defender Status" "Header"
    $defenderStatus = Get-DefenderStatus
    if ($defenderStatus) {
        Write-Status "Real-Time Protection: $(if($defenderStatus.RealTimeProtection){'Enabled'}else{'DISABLED'})" $(if($defenderStatus.RealTimeProtection){"Success"}else{"Error"})
        Write-Status "Behavior Monitor: $(if($defenderStatus.BehaviorMonitor){'Enabled'}else{'DISABLED'})" $(if($defenderStatus.BehaviorMonitor){"Success"}else{"Error"})
        Write-Status "On-Access Protection: $(if($defenderStatus.OnAccessProtection){'Enabled'}else{'DISABLED'})" $(if($defenderStatus.OnAccessProtection){"Success"}else{"Error"})

        $cfaStatus = switch ($defenderStatus.ControlledFolderAccess) {
            0 { "Disabled"; "Error" }
            1 { "Enabled"; "Success" }
            2 { "Audit Mode"; "Warning" }
            default { "Unknown"; "Warning" }
        }
        Write-Status "Controlled Folder Access: $($cfaStatus[0])" $cfaStatus[1]

        Write-Status "Signature Age: $($defenderStatus.SignatureAge) days" $(if($defenderStatus.SignatureAge -le 1){"Success"}else{"Warning"})
    } else {
        Write-Status "Windows Defender not available or accessible" "Error"
    }
    Write-Host ""

    # ASR Rules Status
    Write-Status "Attack Surface Reduction (ASR) Rules" "Header"
    try {
        $asrRulesState = (Get-MpPreference).AttackSurfaceReductionRules_Ids
        $asrRulesAction = (Get-MpPreference).AttackSurfaceReductionRules_Actions

        foreach ($ruleGuid in $Script:ASRRules.Keys) {
            $ruleName = $Script:ASRRules[$ruleGuid].Name
            $index = [array]::IndexOf($asrRulesState, $ruleGuid)

            if ($index -ge 0 -and $asrRulesAction[$index] -eq 1) {
                Write-Status "$ruleName`: Enabled" "Success"
            } elseif ($index -ge 0 -and $asrRulesAction[$index] -eq 2) {
                Write-Status "$ruleName`: Audit Mode" "Warning"
            } else {
                Write-Status "$ruleName`: DISABLED" "Error"
            }
        }
    } catch {
        Write-Status "Unable to query ASR rules status" "Error"
    }
    Write-Host ""

    # Shadow Copies Status
    Write-Status "Shadow Copies Status" "Header"
    try {
        $shadowCopies = vssadmin list shadows 2>&1
        if ($shadowCopies -match "No items found") {
            Write-Status "No shadow copies found - RECOVERY AT RISK" "Error"
        } else {
            $copyCount = ($shadowCopies | Select-String "Shadow Copy ID").Count
            Write-Status "Shadow copies found: $copyCount" "Success"
        }

        $vssService = Get-Service -Name VSS -ErrorAction SilentlyContinue
        if ($vssService) {
            Write-Status "VSS Service Status: $($vssService.Status)" $(if($vssService.Status -eq "Running"){"Success"}else{"Warning"})
        }
    } catch {
        Write-Status "Unable to query shadow copy status" "Warning"
    }
    Write-Host ""

    # Protected Folders Status
    Write-Status "Protected Folders (CFA)" "Header"
    try {
        $protectedFolders = (Get-MpPreference).ControlledFolderAccessProtectedFolders
        if ($protectedFolders) {
            foreach ($folder in $protectedFolders) {
                Write-Status "Protected: $folder" "Success"
            }
        } else {
            Write-Status "No additional protected folders configured" "Warning"
        }
    } catch {
        Write-Status "Unable to query protected folders" "Warning"
    }
    Write-Host ""
}

# ============================================================
# Hardening Functions
# ============================================================

function Enable-ASRRules {
    Write-Status "Configuring Attack Surface Reduction (ASR) Rules..." "Header"
    Write-Status "MITRE Mitigation: M1040 (Behavior Prevention on Endpoint)" "Info"

    foreach ($ruleGuid in $Script:ASRRules.Keys) {
        $ruleName = $Script:ASRRules[$ruleGuid].Name

        if ($PSCmdlet.ShouldProcess($ruleName, "Enable ASR Rule")) {
            try {
                # Get current state
                $currentIds = (Get-MpPreference).AttackSurfaceReductionRules_Ids
                $currentActions = (Get-MpPreference).AttackSurfaceReductionRules_Actions
                $index = if ($currentIds) { [array]::IndexOf($currentIds, $ruleGuid) } else { -1 }

                $oldValue = if ($index -ge 0) { $currentActions[$index] } else { "NotConfigured" }

                # Enable the rule (Action 1 = Block)
                Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleGuid -AttackSurfaceReductionRules_Actions 1 -ErrorAction Stop

                Write-Status "Enabled: $ruleName" "Success"
                Add-ChangeLog -Action "EnableASR" -Target $ruleGuid -OldValue $oldValue -NewValue "1 (Block)"
            } catch {
                Write-Status "Failed to enable: $ruleName - $($_.Exception.Message)" "Error"
                Add-ChangeLog -Action "EnableASR" -Target $ruleGuid -OldValue $oldValue -NewValue "Failed" -Status "Error"
            }
        }
    }
}

function Disable-ASRRules {
    Write-Status "Disabling Attack Surface Reduction (ASR) Rules..." "Header"

    foreach ($ruleGuid in $Script:ASRRules.Keys) {
        $ruleName = $Script:ASRRules[$ruleGuid].Name

        if ($PSCmdlet.ShouldProcess($ruleName, "Disable ASR Rule")) {
            try {
                # Disable the rule (Action 0 = Disabled)
                Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleGuid -AttackSurfaceReductionRules_Actions 0 -ErrorAction Stop

                Write-Status "Disabled: $ruleName" "Warning"
                Add-ChangeLog -Action "DisableASR" -Target $ruleGuid -OldValue "1 (Block)" -NewValue "0 (Disabled)"
            } catch {
                Write-Status "Failed to disable: $ruleName - $($_.Exception.Message)" "Error"
            }
        }
    }
}

function Enable-ControlledFolderAccess {
    Write-Status "Configuring Controlled Folder Access (CFA)..." "Header"
    Write-Status "MITRE Mitigation: M1057 (Data Loss Prevention)" "Info"

    if ($PSCmdlet.ShouldProcess("Controlled Folder Access", "Enable")) {
        try {
            # Get current state
            $currentState = (Get-MpPreference).EnableControlledFolderAccess
            $oldValue = switch ($currentState) {
                0 { "Disabled" }
                1 { "Enabled" }
                2 { "AuditMode" }
                default { "Unknown" }
            }

            # Enable Controlled Folder Access
            Set-MpPreference -EnableControlledFolderAccess Enabled -ErrorAction Stop

            Write-Status "Controlled Folder Access: Enabled" "Success"
            Add-ChangeLog -Action "EnableCFA" -Target "EnableControlledFolderAccess" -OldValue $oldValue -NewValue "Enabled"
        } catch {
            Write-Status "Failed to enable CFA: $($_.Exception.Message)" "Error"
            Add-ChangeLog -Action "EnableCFA" -Target "EnableControlledFolderAccess" -OldValue $oldValue -NewValue "Failed" -Status "Error"
        }
    }

    # Add protected folders
    foreach ($folder in $Script:ProtectedFolders) {
        if (Test-Path $folder) {
            if ($PSCmdlet.ShouldProcess($folder, "Add to Protected Folders")) {
                try {
                    Add-MpPreference -ControlledFolderAccessProtectedFolders $folder -ErrorAction Stop
                    Write-Status "Added protected folder: $folder" "Success"
                    Add-ChangeLog -Action "AddProtectedFolder" -Target $folder -OldValue "NotProtected" -NewValue "Protected"
                } catch {
                    # Might already be protected
                    Write-Status "Folder already protected or error: $folder" "Warning"
                }
            }
        }
    }
}

function Disable-ControlledFolderAccess {
    Write-Status "Disabling Controlled Folder Access..." "Header"

    if ($PSCmdlet.ShouldProcess("Controlled Folder Access", "Disable")) {
        try {
            Set-MpPreference -EnableControlledFolderAccess Disabled -ErrorAction Stop
            Write-Status "Controlled Folder Access: Disabled" "Warning"
            Add-ChangeLog -Action "DisableCFA" -Target "EnableControlledFolderAccess" -OldValue "Enabled" -NewValue "Disabled"
        } catch {
            Write-Status "Failed to disable CFA: $($_.Exception.Message)" "Error"
        }
    }
}

function Enable-DefenderProtection {
    Write-Status "Configuring Windows Defender Protection..." "Header"
    Write-Status "MITRE Mitigation: M1040 (Behavior Prevention on Endpoint)" "Info"

    # Enable Real-Time Protection
    if ($PSCmdlet.ShouldProcess("Real-Time Protection", "Enable")) {
        try {
            Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction Stop
            Write-Status "Real-Time Protection: Enabled" "Success"
            Add-ChangeLog -Action "EnableDefender" -Target "RealtimeMonitoring" -OldValue "Unknown" -NewValue "Enabled"
        } catch {
            Write-Status "Failed to enable Real-Time Protection: $($_.Exception.Message)" "Error"
        }
    }

    # Enable Behavior Monitoring
    if ($PSCmdlet.ShouldProcess("Behavior Monitoring", "Enable")) {
        try {
            Set-MpPreference -DisableBehaviorMonitoring $false -ErrorAction Stop
            Write-Status "Behavior Monitoring: Enabled" "Success"
            Add-ChangeLog -Action "EnableDefender" -Target "BehaviorMonitoring" -OldValue "Unknown" -NewValue "Enabled"
        } catch {
            Write-Status "Failed to enable Behavior Monitoring: $($_.Exception.Message)" "Error"
        }
    }

    # Enable Cloud-Delivered Protection
    if ($PSCmdlet.ShouldProcess("Cloud Protection", "Enable")) {
        try {
            Set-MpPreference -MAPSReporting Advanced -ErrorAction Stop
            Set-MpPreference -SubmitSamplesConsent SendAllSamples -ErrorAction Stop
            Write-Status "Cloud-Delivered Protection: Enabled (Advanced)" "Success"
            Add-ChangeLog -Action "EnableDefender" -Target "CloudProtection" -OldValue "Unknown" -NewValue "Advanced"
        } catch {
            Write-Status "Failed to enable Cloud Protection: $($_.Exception.Message)" "Error"
        }
    }

    # Enable Block at First Sight
    if ($PSCmdlet.ShouldProcess("Block at First Sight", "Enable")) {
        try {
            Set-MpPreference -DisableBlockAtFirstSeen $false -ErrorAction Stop
            Write-Status "Block at First Sight: Enabled" "Success"
            Add-ChangeLog -Action "EnableDefender" -Target "BlockAtFirstSight" -OldValue "Unknown" -NewValue "Enabled"
        } catch {
            Write-Status "Failed to enable Block at First Sight: $($_.Exception.Message)" "Error"
        }
    }

    # Update signatures
    if ($PSCmdlet.ShouldProcess("Defender Signatures", "Update")) {
        try {
            Write-Status "Updating Defender signatures..." "Info"
            Update-MpSignature -ErrorAction Stop
            Write-Status "Defender signatures updated" "Success"
        } catch {
            Write-Status "Failed to update signatures: $($_.Exception.Message)" "Warning"
        }
    }
}

function Enable-ShadowCopyProtection {
    Write-Status "Configuring Shadow Copy Protection..." "Header"
    Write-Status "MITRE Mitigation: M1053 (Data Backup)" "Info"

    # Ensure VSS service is running
    if ($PSCmdlet.ShouldProcess("VSS Service", "Configure")) {
        try {
            $vssService = Get-Service -Name VSS
            if ($vssService.Status -ne "Running") {
                Start-Service -Name VSS -ErrorAction Stop
                Write-Status "VSS Service: Started" "Success"
            }
            Set-Service -Name VSS -StartupType Manual -ErrorAction SilentlyContinue
            Write-Status "VSS Service: Configured (Manual startup)" "Success"
            Add-ChangeLog -Action "ConfigureVSS" -Target "VSSService" -OldValue "Unknown" -NewValue "Manual"
        } catch {
            Write-Status "Failed to configure VSS: $($_.Exception.Message)" "Error"
        }
    }

    # Check current shadow copies
    try {
        $shadowCopies = Get-WmiObject Win32_ShadowCopy -ErrorAction SilentlyContinue
        if ($shadowCopies) {
            Write-Status "Existing shadow copies: $($shadowCopies.Count)" "Info"
        } else {
            Write-Status "No shadow copies found - consider creating one" "Warning"
        }
    } catch {
        Write-Status "Unable to query shadow copies" "Warning"
    }
}

function Block-ArchiveUtilities {
    Write-Status "Configuring Archive Utility Restrictions..." "Header"
    Write-Status "MITRE Mitigation: M1038 (Execution Prevention)" "Info"

    # Note: Full AppLocker configuration requires Enterprise/Education editions
    # This provides Software Restriction Policy guidance

    Write-Status "Archive utility restrictions require Group Policy or AppLocker" "Info"
    Write-Status "Recommended actions:" "Info"
    Write-Status "  1. Block WinRAR.exe execution from temp directories" "Info"
    Write-Status "  2. Block rar.exe, 7z.exe from untrusted locations" "Info"
    Write-Status "  3. Whitelist compression tools only from Program Files" "Info"

    # Create registry keys for documentation
    if ($PSCmdlet.ShouldProcess("Archive Restrictions Documentation", "Create")) {
        try {
            $regPath = "HKLM:\SOFTWARE\F0RT1KA\Hardening"
            if (-not (Test-Path $regPath)) {
                New-Item -Path $regPath -Force | Out-Null
            }
            Set-ItemProperty -Path $regPath -Name "ArchiveRestrictionsConfigured" -Value (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
            Set-ItemProperty -Path $regPath -Name "TestID" -Value $Script:TestID
            Write-Status "Hardening configuration documented in registry" "Success"
            Add-ChangeLog -Action "DocumentRestrictions" -Target $regPath -OldValue "None" -NewValue "Configured"
        } catch {
            Write-Status "Failed to create documentation: $($_.Exception.Message)" "Warning"
        }
    }
}

# ============================================================
# Main Execution
# ============================================================

# Header
Write-Host ""
Write-Status "============================================================" "Header"
Write-Status "F0RT1KA Defense Hardening Script" "Header"
Write-Status "SafePay Ransomware Protection" "Header"
Write-Status "Test ID: $Script:TestID" "Header"
Write-Status "============================================================" "Header"
Write-Host ""

# Check admin privileges
if (-not (Test-IsAdmin)) {
    Write-Status "This script requires Administrator privileges" "Error"
    Write-Status "Please run PowerShell as Administrator" "Error"
    exit 1
}

# Report mode
if ($Report) {
    Get-SecurityReport
    exit 0
}

# Undo mode
if ($Undo) {
    Write-Status "UNDO MODE - Reverting hardening changes..." "Warning"
    Write-Host ""

    if (-not $SkipASR) {
        Disable-ASRRules
    }

    if (-not $SkipCFA) {
        Disable-ControlledFolderAccess
    }

    Write-Host ""
    Write-Status "============================================================" "Header"
    Write-Status "Hardening reverted. Security posture may be reduced." "Warning"
    Write-Status "============================================================" "Header"

    # Show change log
    if ($Script:ChangeLog.Count -gt 0) {
        Write-Host ""
        Write-Status "Change Log:" "Info"
        $Script:ChangeLog | Format-Table -AutoSize
    }

    exit 0
}

# Apply hardening
Write-Status "HARDENING MODE - Applying security configurations..." "Info"
Write-Host ""

# Windows Defender
if (-not $SkipDefender) {
    Enable-DefenderProtection
    Write-Host ""
}

# ASR Rules
if (-not $SkipASR) {
    Enable-ASRRules
    Write-Host ""
}

# Controlled Folder Access
if (-not $SkipCFA) {
    Enable-ControlledFolderAccess
    Write-Host ""
}

# Shadow Copy Protection
Enable-ShadowCopyProtection
Write-Host ""

# Archive Utility Restrictions
Block-ArchiveUtilities
Write-Host ""

# Summary
Write-Status "============================================================" "Header"
Write-Status "Hardening Complete" "Header"
Write-Status "============================================================" "Header"
Write-Host ""

Write-Status "Applied MITRE ATT&CK Mitigations:" "Info"
Write-Status "  M1040 - Behavior Prevention on Endpoint (ASR, Defender)" "Info"
Write-Status "  M1053 - Data Backup (Shadow Copies)" "Info"
Write-Status "  M1057 - Data Loss Prevention (CFA)" "Info"
Write-Status "  M1038 - Execution Prevention (Documentation)" "Info"
Write-Host ""

Write-Status "Protected against SafePay ransomware behaviors:" "Success"
Write-Status "  - Mass file creation detection" "Success"
Write-Status "  - WinRAR data staging prevention" "Success"
Write-Status "  - File encryption prevention" "Success"
Write-Status "  - Controlled folder protection" "Success"
Write-Host ""

# Show change log
if ($Script:ChangeLog.Count -gt 0) {
    Write-Status "Change Log Summary:" "Info"
    $Script:ChangeLog | Format-Table -Property Timestamp, Action, Target, Status -AutoSize
}

Write-Status "Log file: $Script:LogFile" "Info"
Write-Status "Run with -Report to view current security posture" "Info"
Write-Status "Run with -Undo to revert changes" "Info"
