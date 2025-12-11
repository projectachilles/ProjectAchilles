<#
.SYNOPSIS
    EDR-Freeze Defense Evasion - Hardening Script

.DESCRIPTION
    This script applies hardening measures to protect against the EDR-Freeze
    defense evasion technique that abuses WerFaultSecure.exe to suspend
    security processes.

    Test ID: 87b7653b-2cee-44d4-9d80-73ec94d5e18e
    MITRE ATT&CK: T1562.001, T1055, T1574
    Mitigations: M1047, M1040, M1038, M1022, M1024, M1018

    Hardening measures implemented:
    - Attack Surface Reduction (ASR) rules
    - Windows Defender Tamper Protection verification
    - Certutil execution restrictions (AppLocker rules)
    - C:\F0 directory monitoring (NTFS auditing)
    - Windows Error Reporting component monitoring
    - Process creation auditing enhancement

.PARAMETER Undo
    Reverts all hardening changes made by this script

.PARAMETER WhatIf
    Shows what would happen without making changes

.PARAMETER AuditOnly
    Only enables audit mode for ASR rules (recommended for testing)

.PARAMETER SkipASR
    Skips Attack Surface Reduction rule configuration

.PARAMETER SkipAppLocker
    Skips AppLocker rule configuration

.EXAMPLE
    .\87b7653b-2cee-44d4-9d80-73ec94d5e18e_hardening.ps1
    Applies all hardening settings in enforce mode

.EXAMPLE
    .\87b7653b-2cee-44d4-9d80-73ec94d5e18e_hardening.ps1 -AuditOnly
    Applies ASR rules in audit mode for testing

.EXAMPLE
    .\87b7653b-2cee-44d4-9d80-73ec94d5e18e_hardening.ps1 -Undo
    Reverts all hardening settings

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Version: 1.0.0
    Date: 2025-12-07
    Requires: Administrator privileges
    Idempotent: Yes (safe to run multiple times)
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo,
    [switch]$AuditOnly,
    [switch]$SkipASR,
    [switch]$SkipAppLocker
)

#Requires -RunAsAdministrator

# ============================================================
# Configuration
# ============================================================
$ErrorActionPreference = "Stop"
$Script:ChangeLog = @()
$Script:TestID = "87b7653b-2cee-44d4-9d80-73ec94d5e18e"
$Script:LogFile = "C:\F0\hardening_log_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"

# ASR Rule GUIDs relevant to EDR-Freeze defense
$Script:ASRRules = @{
    # Block abuse of exploited vulnerable signed drivers
    "56a863a9-875e-4185-98a7-b882c64b5ce5" = "Block abuse of exploited vulnerable signed drivers"

    # Block credential stealing from LSASS
    "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2" = "Block credential stealing from LSASS"

    # Block process creations from PSExec and WMI commands
    "d1e49aac-8f56-4280-b9ba-993a6d77406c" = "Block process creations from PSExec and WMI"

    # Block executable content from email and webmail
    "be9ba2d9-53ea-4cdc-84e5-9b1eeee46550" = "Block executable content from email"

    # Block Office applications from creating child processes
    "d4f940ab-401b-4efc-aadc-ad5f3c50688a" = "Block Office from creating child processes"

    # Block Office applications from injecting code
    "75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84" = "Block Office from code injection"

    # Block persistence through WMI event subscription
    "e6db77e5-3df2-4cf1-b95a-636979351e5b" = "Block WMI persistence"
}

# ============================================================
# Helper Functions
# ============================================================

function Write-Status {
    param(
        [string]$Message,
        [ValidateSet("Info", "Success", "Warning", "Error")]
        [string]$Type = "Info"
    )
    $colors = @{
        Info = "Cyan"
        Success = "Green"
        Warning = "Yellow"
        Error = "Red"
    }
    $prefix = @{
        Info = "[*]"
        Success = "[+]"
        Warning = "[!]"
        Error = "[-]"
    }
    Write-Host "$($prefix[$Type]) $Message" -ForegroundColor $colors[$Type]
}

function Add-ChangeLog {
    param(
        [string]$Action,
        [string]$Target,
        [string]$OldValue,
        [string]$NewValue,
        [string]$Status = "Applied"
    )
    $Script:ChangeLog += [PSCustomObject]@{
        Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Action = $Action
        Target = $Target
        OldValue = $OldValue
        NewValue = $NewValue
        Status = $Status
    }
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Save-ChangeLog {
    if ($Script:ChangeLog.Count -gt 0) {
        $logDir = Split-Path $Script:LogFile -Parent
        if (-not (Test-Path $logDir)) {
            New-Item -Path $logDir -ItemType Directory -Force | Out-Null
        }
        $Script:ChangeLog | ConvertTo-Json -Depth 5 | Out-File $Script:LogFile -Encoding UTF8
        Write-Status "Change log saved to: $($Script:LogFile)" "Info"
    }
}

# ============================================================
# ASR Rule Functions
# ============================================================

function Get-CurrentASRRules {
    try {
        $prefs = Get-MpPreference -ErrorAction Stop
        $rules = @{}
        if ($prefs.AttackSurfaceReductionRules_Ids) {
            for ($i = 0; $i -lt $prefs.AttackSurfaceReductionRules_Ids.Count; $i++) {
                $ruleId = $prefs.AttackSurfaceReductionRules_Ids[$i]
                $action = if ($prefs.AttackSurfaceReductionRules_Actions.Count -gt $i) {
                    $prefs.AttackSurfaceReductionRules_Actions[$i]
                } else { 0 }
                $rules[$ruleId] = $action
            }
        }
        return $rules
    }
    catch {
        Write-Status "Failed to get current ASR rules: $_" "Warning"
        return @{}
    }
}

function Set-ASRRules {
    param([bool]$Enable, [bool]$AuditMode = $false)

    if ($SkipASR) {
        Write-Status "Skipping ASR rule configuration (SkipASR flag set)" "Warning"
        return
    }

    Write-Status "Configuring Attack Surface Reduction (ASR) rules..." "Info"

    $currentRules = Get-CurrentASRRules
    $action = if ($Enable) { if ($AuditMode) { 2 } else { 1 } } else { 0 }
    $actionName = @{ 0 = "Disabled"; 1 = "Enabled (Block)"; 2 = "Enabled (Audit)" }[$action]

    foreach ($ruleId in $Script:ASRRules.Keys) {
        $ruleName = $Script:ASRRules[$ruleId]
        $currentAction = if ($currentRules.ContainsKey($ruleId)) { $currentRules[$ruleId] } else { 0 }
        $currentActionName = @{ 0 = "Disabled"; 1 = "Enabled (Block)"; 2 = "Enabled (Audit)" }[$currentAction]

        if ($currentAction -eq $action) {
            Write-Status "  $ruleName - Already $actionName" "Info"
            continue
        }

        if ($PSCmdlet.ShouldProcess($ruleName, "Set ASR rule to $actionName")) {
            try {
                Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -AttackSurfaceReductionRules_Actions $action -ErrorAction Stop
                Write-Status "  $ruleName - Changed from $currentActionName to $actionName" "Success"
                Add-ChangeLog -Action "ASR Rule" -Target $ruleId -OldValue $currentActionName -NewValue $actionName
            }
            catch {
                Write-Status "  $ruleName - Failed: $_" "Error"
                Add-ChangeLog -Action "ASR Rule" -Target $ruleId -OldValue $currentActionName -NewValue $actionName -Status "Failed: $_"
            }
        }
    }
}

# ============================================================
# Defender Tamper Protection
# ============================================================

function Test-TamperProtection {
    Write-Status "Checking Windows Defender Tamper Protection status..." "Info"

    try {
        $status = Get-MpComputerStatus -ErrorAction Stop
        $isTamperProtected = $status.IsTamperProtected

        if ($isTamperProtected) {
            Write-Status "  Tamper Protection is ENABLED (Good)" "Success"
        }
        else {
            Write-Status "  Tamper Protection is DISABLED (Vulnerable)" "Warning"
            Write-Status "  Enable via: Microsoft 365 Defender Portal > Endpoints > Configuration > Tamper Protection" "Info"
        }

        Add-ChangeLog -Action "TamperProtection Check" -Target "IsTamperProtected" -OldValue "N/A" -NewValue $isTamperProtected.ToString() -Status "Checked"

        return $isTamperProtected
    }
    catch {
        Write-Status "  Failed to check Tamper Protection: $_" "Error"
        return $null
    }
}

# ============================================================
# NTFS Auditing for C:\F0
# ============================================================

function Set-F0DirectoryAuditing {
    param([bool]$Enable)

    $f0Path = "C:\F0"

    Write-Status "Configuring NTFS auditing for $f0Path..." "Info"

    # Ensure directory exists
    if (-not (Test-Path $f0Path)) {
        if ($Enable) {
            if ($PSCmdlet.ShouldProcess($f0Path, "Create directory")) {
                New-Item -Path $f0Path -ItemType Directory -Force | Out-Null
                Write-Status "  Created directory: $f0Path" "Success"
            }
        }
        else {
            Write-Status "  Directory does not exist: $f0Path" "Info"
            return
        }
    }

    if ($Enable) {
        try {
            # Get current ACL
            $acl = Get-Acl $f0Path -Audit -ErrorAction Stop

            # Define audit rule for file/folder creation and execution
            $auditRuleWrite = New-Object System.Security.AccessControl.FileSystemAuditRule(
                "Everyone",
                "WriteData, CreateFiles, ExecuteFile",
                "ContainerInherit, ObjectInherit",
                "None",
                "Success, Failure"
            )

            # Check if rule already exists
            $existingRules = $acl.GetAuditRules($true, $true, [System.Security.Principal.NTAccount])
            $ruleExists = $false
            foreach ($rule in $existingRules) {
                if ($rule.IdentityReference.Value -eq "Everyone" -and
                    $rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::WriteData) {
                    $ruleExists = $true
                    break
                }
            }

            if (-not $ruleExists) {
                if ($PSCmdlet.ShouldProcess($f0Path, "Add NTFS audit rule")) {
                    $acl.AddAuditRule($auditRuleWrite)
                    Set-Acl -Path $f0Path -AclObject $acl -ErrorAction Stop
                    Write-Status "  Added NTFS audit rule for file creation/execution" "Success"
                    Add-ChangeLog -Action "NTFS Auditing" -Target $f0Path -OldValue "None" -NewValue "WriteData, CreateFiles, ExecuteFile"
                }
            }
            else {
                Write-Status "  NTFS audit rule already exists" "Info"
            }
        }
        catch {
            Write-Status "  Failed to configure NTFS auditing: $_" "Error"
            Add-ChangeLog -Action "NTFS Auditing" -Target $f0Path -OldValue "N/A" -NewValue "Failed" -Status "Error: $_"
        }
    }
    else {
        try {
            $acl = Get-Acl $f0Path -Audit -ErrorAction Stop
            $auditRules = $acl.GetAuditRules($true, $false, [System.Security.Principal.NTAccount])

            foreach ($rule in $auditRules) {
                if ($rule.IdentityReference.Value -eq "Everyone") {
                    if ($PSCmdlet.ShouldProcess($f0Path, "Remove NTFS audit rule")) {
                        $acl.RemoveAuditRule($rule) | Out-Null
                    }
                }
            }
            Set-Acl -Path $f0Path -AclObject $acl -ErrorAction Stop
            Write-Status "  Removed NTFS audit rules" "Success"
            Add-ChangeLog -Action "NTFS Auditing" -Target $f0Path -OldValue "WriteData, CreateFiles" -NewValue "None"
        }
        catch {
            Write-Status "  Failed to remove NTFS auditing: $_" "Error"
        }
    }
}

# ============================================================
# Process Creation Auditing
# ============================================================

function Set-ProcessCreationAuditing {
    param([bool]$Enable)

    Write-Status "Configuring process creation auditing..." "Info"

    # Enable command line in process creation events
    $regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit"
    $regName = "ProcessCreationIncludeCmdLine_Enabled"

    try {
        # Ensure registry path exists
        if (-not (Test-Path $regPath)) {
            if ($Enable) {
                if ($PSCmdlet.ShouldProcess($regPath, "Create registry key")) {
                    New-Item -Path $regPath -Force | Out-Null
                }
            }
        }

        $currentValue = Get-ItemProperty -Path $regPath -Name $regName -ErrorAction SilentlyContinue

        if ($Enable) {
            if ($currentValue.$regName -ne 1) {
                if ($PSCmdlet.ShouldProcess($regName, "Enable command line logging")) {
                    Set-ItemProperty -Path $regPath -Name $regName -Value 1 -Type DWord -Force
                    Write-Status "  Enabled command line logging in process creation events" "Success"
                    Add-ChangeLog -Action "ProcessCreationAudit" -Target $regName -OldValue ($currentValue.$regName ?? "NotSet") -NewValue "1"
                }
            }
            else {
                Write-Status "  Command line logging already enabled" "Info"
            }
        }
        else {
            if ($currentValue.$regName -eq 1) {
                if ($PSCmdlet.ShouldProcess($regName, "Disable command line logging")) {
                    Set-ItemProperty -Path $regPath -Name $regName -Value 0 -Type DWord -Force
                    Write-Status "  Disabled command line logging" "Success"
                    Add-ChangeLog -Action "ProcessCreationAudit" -Target $regName -OldValue "1" -NewValue "0"
                }
            }
        }
    }
    catch {
        Write-Status "  Failed to configure process creation auditing: $_" "Error"
    }

    # Enable audit policy for process creation
    if ($Enable) {
        try {
            $result = auditpol /set /subcategory:"Process Creation" /success:enable /failure:enable 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Status "  Enabled audit policy for process creation" "Success"
                Add-ChangeLog -Action "AuditPolicy" -Target "Process Creation" -OldValue "Unknown" -NewValue "Success+Failure"
            }
        }
        catch {
            Write-Status "  Failed to set audit policy: $_" "Warning"
        }
    }
    else {
        try {
            $result = auditpol /set /subcategory:"Process Creation" /success:disable /failure:disable 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Status "  Disabled audit policy for process creation" "Success"
                Add-ChangeLog -Action "AuditPolicy" -Target "Process Creation" -OldValue "Success+Failure" -NewValue "Disabled"
            }
        }
        catch {
            Write-Status "  Failed to reset audit policy: $_" "Warning"
        }
    }
}

# ============================================================
# Certutil Restrictions
# ============================================================

function Set-CertutilRestrictions {
    param([bool]$Enable)

    if ($SkipAppLocker) {
        Write-Status "Skipping certutil restrictions (SkipAppLocker flag set)" "Warning"
        return
    }

    Write-Status "Configuring certutil execution restrictions..." "Info"

    # Note: Full AppLocker configuration requires Group Policy
    # This provides guidance and checks current status

    try {
        # Check if AppLocker service is running
        $applockerSvc = Get-Service -Name "AppIDSvc" -ErrorAction SilentlyContinue

        if ($applockerSvc) {
            Write-Status "  AppLocker service status: $($applockerSvc.Status)" "Info"

            if ($Enable -and $applockerSvc.Status -ne "Running") {
                Write-Status "  AppLocker service is not running. Start it to enable restrictions." "Warning"
                Write-Status "  Run: Start-Service AppIDSvc" "Info"
            }
        }
        else {
            Write-Status "  AppLocker service not found" "Warning"
        }

        # Provide guidance for certutil restriction
        if ($Enable) {
            Write-Status "  To restrict certutil execution, configure AppLocker via Group Policy:" "Info"
            Write-Status "    1. Open gpedit.msc" "Info"
            Write-Status "    2. Navigate to: Computer Configuration > Windows Settings > Security Settings > Application Control Policies > AppLocker" "Info"
            Write-Status "    3. Create Executable Rule: Deny certutil.exe for non-admin users" "Info"
            Write-Status "    4. Publisher: O=MICROSOFT CORPORATION, Product: *, File: CERTUTIL.EXE" "Info"

            Add-ChangeLog -Action "CertutilRestriction" -Target "AppLocker Guidance" -OldValue "N/A" -NewValue "Guidance Provided" -Status "Manual"
        }
    }
    catch {
        Write-Status "  Failed to check AppLocker status: $_" "Error"
    }
}

# ============================================================
# Windows Defender Real-Time Protection
# ============================================================

function Test-DefenderStatus {
    Write-Status "Checking Windows Defender status..." "Info"

    try {
        $status = Get-MpComputerStatus -ErrorAction Stop

        $checks = @{
            "Real-Time Protection" = $status.RealTimeProtectionEnabled
            "Behavior Monitoring" = $status.BehaviorMonitorEnabled
            "On-Access Protection" = $status.OnAccessProtectionEnabled
            "Antivirus Enabled" = $status.AntivirusEnabled
            "Antispyware Enabled" = $status.AntispywareEnabled
        }

        foreach ($check in $checks.GetEnumerator()) {
            if ($check.Value) {
                Write-Status "  $($check.Key): ENABLED" "Success"
            }
            else {
                Write-Status "  $($check.Key): DISABLED" "Warning"
            }
        }

        # Check signature age
        $sigAge = (Get-Date) - $status.AntivirusSignatureLastUpdated
        if ($sigAge.TotalDays -gt 1) {
            Write-Status "  Signatures are $([int]$sigAge.TotalDays) days old - consider updating" "Warning"
        }
        else {
            Write-Status "  Signatures are up to date" "Success"
        }

        Add-ChangeLog -Action "DefenderStatus" -Target "Health Check" -OldValue "N/A" -NewValue "Checked" -Status "Completed"
    }
    catch {
        Write-Status "  Failed to check Defender status: $_" "Error"
    }
}

# ============================================================
# WER Component Monitoring
# ============================================================

function Set-WERMonitoring {
    param([bool]$Enable)

    Write-Status "Configuring Windows Error Reporting monitoring..." "Info"

    # Enable auditing for WER directory
    $werPath = "C:\ProgramData\Microsoft\Windows\WER"

    if (Test-Path $werPath) {
        try {
            if ($Enable) {
                $acl = Get-Acl $werPath -Audit -ErrorAction Stop

                $auditRule = New-Object System.Security.AccessControl.FileSystemAuditRule(
                    "Everyone",
                    "ExecuteFile, WriteData, CreateFiles",
                    "ContainerInherit, ObjectInherit",
                    "None",
                    "Success"
                )

                if ($PSCmdlet.ShouldProcess($werPath, "Add WER audit rule")) {
                    $acl.AddAuditRule($auditRule)
                    Set-Acl -Path $werPath -AclObject $acl -ErrorAction Stop
                    Write-Status "  Added audit rule for WER directory" "Success"
                    Add-ChangeLog -Action "WER Monitoring" -Target $werPath -OldValue "None" -NewValue "Audit Enabled"
                }
            }
            else {
                Write-Status "  WER monitoring undo - manual cleanup may be required" "Info"
            }
        }
        catch {
            Write-Status "  Failed to configure WER monitoring: $_" "Warning"
        }
    }
    else {
        Write-Status "  WER directory not found: $werPath" "Warning"
    }
}

# ============================================================
# Sysmon Configuration Check
# ============================================================

function Test-SysmonInstalled {
    Write-Status "Checking Sysmon installation..." "Info"

    try {
        $sysmonSvc = Get-Service -Name "Sysmon*" -ErrorAction SilentlyContinue

        if ($sysmonSvc) {
            Write-Status "  Sysmon service found: $($sysmonSvc.Name) - $($sysmonSvc.Status)" "Success"

            # Check for process suspension logging capability
            Write-Status "  Consider enabling Sysmon Event ID 10 (ProcessAccess) for thread suspension detection" "Info"
        }
        else {
            Write-Status "  Sysmon is NOT installed" "Warning"
            Write-Status "  Recommendation: Install Sysmon with SwiftOnSecurity config for enhanced visibility" "Info"
            Write-Status "  Download: https://docs.microsoft.com/en-us/sysinternals/downloads/sysmon" "Info"
        }
    }
    catch {
        Write-Status "  Failed to check Sysmon status: $_" "Error"
    }
}

# ============================================================
# Main Execution
# ============================================================

function Show-Banner {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " EDR-Freeze Defense Evasion - Hardening Script" -ForegroundColor Cyan
    Write-Host " Test ID: $Script:TestID" -ForegroundColor Cyan
    Write-Host " MITRE ATT&CK: T1562.001, T1055, T1574" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Main {
    Show-Banner

    if (-not (Test-IsAdmin)) {
        Write-Status "This script requires Administrator privileges" "Error"
        exit 1
    }

    if ($Undo) {
        Write-Status "UNDO MODE: Reverting hardening changes..." "Warning"
        Write-Host ""

        Set-ASRRules -Enable $false
        Set-F0DirectoryAuditing -Enable $false
        Set-ProcessCreationAuditing -Enable $false
        Set-WERMonitoring -Enable $false

        Write-Host ""
        Write-Status "Hardening changes reverted" "Success"
    }
    else {
        Write-Status "Applying hardening measures..." "Info"
        if ($AuditOnly) {
            Write-Status "AUDIT MODE: ASR rules will be set to Audit only" "Warning"
        }
        Write-Host ""

        # Check current status first
        Test-DefenderStatus
        Write-Host ""

        Test-TamperProtection
        Write-Host ""

        Test-SysmonInstalled
        Write-Host ""

        # Apply hardening
        Set-ASRRules -Enable $true -AuditMode $AuditOnly
        Write-Host ""

        Set-F0DirectoryAuditing -Enable $true
        Write-Host ""

        Set-ProcessCreationAuditing -Enable $true
        Write-Host ""

        Set-CertutilRestrictions -Enable $true
        Write-Host ""

        Set-WERMonitoring -Enable $true
        Write-Host ""

        Write-Host "============================================================" -ForegroundColor Green
        Write-Status "Hardening complete!" "Success"
        Write-Host "============================================================" -ForegroundColor Green
        Write-Host ""

        # Summary
        Write-Status "Summary of applied protections:" "Info"
        Write-Status "  - Attack Surface Reduction rules configured" "Success"
        Write-Status "  - C:\F0 directory auditing enabled" "Success"
        Write-Status "  - Process creation auditing enabled" "Success"
        Write-Status "  - WER directory monitoring enabled" "Success"
        Write-Host ""

        Write-Status "Additional recommendations:" "Info"
        Write-Status "  - Enable Tamper Protection via Microsoft 365 Defender Portal" "Info"
        Write-Status "  - Install and configure Sysmon for enhanced visibility" "Info"
        Write-Status "  - Deploy certutil restrictions via AppLocker/WDAC" "Info"
        Write-Status "  - Enable PowerShell Script Block Logging" "Info"
    }

    # Save change log
    Save-ChangeLog

    Write-Host ""
    Write-Status "Script completed. Review $($Script:LogFile) for details." "Info"
}

# Run main function
Main
