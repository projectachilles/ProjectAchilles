<#
.SYNOPSIS
    SafePay UAC Bypass & Defense Evasion - Hardening Script

.DESCRIPTION
    This script applies hardening settings to protect against the SafePay-style
    attack techniques tested by F0RT1KA test 2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11:

    - T1548.002: UAC Bypass via CMSTPLUA COM object
    - T1562.001: Windows Defender tampering attempts
    - T1547.001: Registry Run key persistence

    The script implements mitigations recommended by MITRE ATT&CK:
    - M1052: User Account Control hardening
    - M1047: Audit configuration for suspicious activity
    - M1026: Privileged account management guidance

    Test ID: 2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11
    MITRE ATT&CK: T1548.002, T1562.001, T1547.001

.PARAMETER Undo
    Reverts all changes made by this script to Windows defaults

.PARAMETER WhatIf
    Shows what changes would be made without actually making them

.PARAMETER AuditOnly
    Only configures auditing without changing UAC or protection settings

.PARAMETER SkipReboot
    Applies changes but does not prompt for reboot (some settings require reboot)

.EXAMPLE
    .\2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_hardening.ps1
    Applies all hardening settings

.EXAMPLE
    .\2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_hardening.ps1 -WhatIf
    Shows what would be changed without making changes

.EXAMPLE
    .\2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_hardening.ps1 -Undo
    Reverts all hardening settings to Windows defaults

.EXAMPLE
    .\2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_hardening.ps1 -AuditOnly
    Only enables auditing without changing protection settings

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    Test ID: 2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11
    Requires: Administrator privileges
    Idempotent: Yes (safe to run multiple times)
    Reboot: Some UAC changes require reboot to take effect
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo,
    [switch]$AuditOnly,
    [switch]$SkipReboot
)

#Requires -RunAsAdministrator

# ============================================================================
# Configuration
# ============================================================================

$ErrorActionPreference = "Stop"
$Script:ChangeLog = @()
$Script:RebootRequired = $false

$TestID = "2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11"
$TestName = "SafePay UAC Bypass & Defense Evasion"

# Registry paths
$UACPolicyPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
$DefenderPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender"
$DefenderRTPPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection"
$AuditPolicyPath = "HKLM:\SYSTEM\CurrentControlSet\Services\EventLog\Security"

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
    Write-Host "$($prefix[$Type]) $Message" -ForegroundColor $colors[$Type]
}

function Add-ChangeLog {
    param(
        [string]$Category,
        [string]$Setting,
        [string]$OldValue,
        [string]$NewValue,
        [string]$Status
    )
    $Script:ChangeLog += [PSCustomObject]@{
        Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Category  = $Category
        Setting   = $Setting
        OldValue  = $OldValue
        NewValue  = $NewValue
        Status    = $Status
    }
}

function Get-RegistryValue {
    param(
        [string]$Path,
        [string]$Name,
        [object]$Default = $null
    )
    try {
        $value = Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
        return $value.$Name
    }
    catch {
        return $Default
    }
}

function Set-RegistryValue {
    param(
        [string]$Path,
        [string]$Name,
        [object]$Value,
        [string]$Type = "DWord"
    )

    # Ensure path exists
    if (-not (Test-Path $Path)) {
        New-Item -Path $Path -Force | Out-Null
    }

    Set-ItemProperty -Path $Path -Name $Name -Value $Value -Type $Type
}

# ============================================================================
# UAC Hardening Functions (M1052)
# ============================================================================

function Set-UACHardening {
    Write-Status "Configuring UAC hardening settings..." "Header"

    $uacSettings = @(
        @{
            Name = "EnableLUA"
            Value = 1
            Default = 1
            Description = "Enable User Account Control"
        },
        @{
            Name = "ConsentPromptBehaviorAdmin"
            Value = 2  # Prompt for credentials on secure desktop
            Default = 5  # Prompt for consent for non-Windows binaries
            Description = "Admin consent prompt behavior (2=credentials on secure desktop)"
        },
        @{
            Name = "ConsentPromptBehaviorUser"
            Value = 0  # Auto-deny elevation for standard users
            Default = 3  # Prompt for credentials
            Description = "Standard user consent prompt behavior (0=auto-deny)"
        },
        @{
            Name = "PromptOnSecureDesktop"
            Value = 1
            Default = 1
            Description = "Prompt on secure desktop"
        },
        @{
            Name = "EnableVirtualization"
            Value = 1
            Default = 1
            Description = "Enable file/registry virtualization"
        },
        @{
            Name = "FilterAdministratorToken"
            Value = 1
            Default = 0
            Description = "Filter built-in administrator account token"
        },
        @{
            Name = "EnableInstallerDetection"
            Value = 1
            Default = 1
            Description = "Detect app installations and prompt for elevation"
        },
        @{
            Name = "ValidateAdminCodeSignatures"
            Value = 1
            Default = 0
            Description = "Only elevate signed and validated executables"
        },
        @{
            Name = "EnableSecureUIAPaths"
            Value = 1
            Default = 1
            Description = "Only elevate UIAccess apps from secure locations"
        }
    )

    foreach ($setting in $uacSettings) {
        $currentValue = Get-RegistryValue -Path $UACPolicyPath -Name $setting.Name -Default "Not Set"
        $targetValue = if ($Undo) { $setting.Default } else { $setting.Value }

        if ($PSCmdlet.ShouldProcess($setting.Name, "Set to $targetValue")) {
            try {
                Set-RegistryValue -Path $UACPolicyPath -Name $setting.Name -Value $targetValue
                Add-ChangeLog -Category "UAC" -Setting $setting.Name -OldValue $currentValue -NewValue $targetValue -Status "Success"
                Write-Status "$($setting.Description): $currentValue -> $targetValue" "Success"

                if ($currentValue -ne $targetValue) {
                    $Script:RebootRequired = $true
                }
            }
            catch {
                Add-ChangeLog -Category "UAC" -Setting $setting.Name -OldValue $currentValue -NewValue "FAILED" -Status "Error"
                Write-Status "Failed to set $($setting.Name): $_" "Error"
            }
        }
    }
}

# ============================================================================
# Windows Defender Tamper Protection Verification
# ============================================================================

function Test-DefenderTamperProtection {
    Write-Status "Verifying Windows Defender Tamper Protection..." "Header"

    try {
        $mpStatus = Get-MpComputerStatus -ErrorAction Stop

        Write-Status "Real-Time Protection: $($mpStatus.RealTimeProtectionEnabled)" $(if($mpStatus.RealTimeProtectionEnabled){"Success"}else{"Warning"})
        Write-Status "Behavior Monitoring: $($mpStatus.BehaviorMonitoringEnabled)" $(if($mpStatus.BehaviorMonitoringEnabled){"Success"}else{"Warning"})
        Write-Status "Tamper Protection: $($mpStatus.IsTamperProtected)" $(if($mpStatus.IsTamperProtected){"Success"}else{"Warning"})
        Write-Status "Antivirus Enabled: $($mpStatus.AntivirusEnabled)" $(if($mpStatus.AntivirusEnabled){"Success"}else{"Warning"})

        if (-not $mpStatus.IsTamperProtected) {
            Write-Status "RECOMMENDATION: Enable Tamper Protection via Microsoft 365 Defender portal or Windows Security app" "Warning"
            Add-ChangeLog -Category "Defender" -Setting "TamperProtection" -OldValue "Disabled" -NewValue "Manual Action Required" -Status "Warning"
        }
        else {
            Add-ChangeLog -Category "Defender" -Setting "TamperProtection" -OldValue "Enabled" -NewValue "Enabled" -Status "Success"
        }
    }
    catch {
        Write-Status "Could not query Windows Defender status: $_" "Warning"
        Add-ChangeLog -Category "Defender" -Setting "Status" -OldValue "Unknown" -NewValue "Query Failed" -Status "Error"
    }
}

# ============================================================================
# Audit Policy Configuration (M1047)
# ============================================================================

function Set-AuditPolicies {
    Write-Status "Configuring audit policies for detection..." "Header"

    $auditCategories = @(
        @{
            Category = "Process Creation"
            SubCategory = "{0CCE922B-69AE-11D9-BED3-505054503030}"
            Setting = "Success,Failure"
            Description = "Audit process creation events"
        },
        @{
            Category = "Registry"
            SubCategory = "{0CCE921E-69AE-11D9-BED3-505054503030}"
            Setting = "Success,Failure"
            Description = "Audit registry access events"
        },
        @{
            Category = "Object Access"
            SubCategory = "{0CCE921D-69AE-11D9-BED3-505054503030}"
            Setting = "Success,Failure"
            Description = "Audit object access events"
        }
    )

    # Enable command line in process creation events
    $cmdLineAuditPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit"
    $targetValue = if ($Undo) { 0 } else { 1 }

    if ($PSCmdlet.ShouldProcess("ProcessCreationIncludeCmdLine_Enabled", "Set to $targetValue")) {
        try {
            if (-not (Test-Path $cmdLineAuditPath)) {
                New-Item -Path $cmdLineAuditPath -Force | Out-Null
            }
            Set-RegistryValue -Path $cmdLineAuditPath -Name "ProcessCreationIncludeCmdLine_Enabled" -Value $targetValue

            Write-Status "Command line logging in process creation events: $targetValue" "Success"
            Add-ChangeLog -Category "Audit" -Setting "ProcessCreationIncludeCmdLine" -OldValue "Unknown" -NewValue $targetValue -Status "Success"
        }
        catch {
            Write-Status "Failed to enable command line logging: $_" "Error"
            Add-ChangeLog -Category "Audit" -Setting "ProcessCreationIncludeCmdLine" -OldValue "Unknown" -NewValue "FAILED" -Status "Error"
        }
    }

    # Configure PowerShell logging
    $psLogPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging"

    if ($PSCmdlet.ShouldProcess("PowerShell Script Block Logging", "Enable")) {
        try {
            if (-not (Test-Path $psLogPath)) {
                New-Item -Path $psLogPath -Force | Out-Null
            }

            $logValue = if ($Undo) { 0 } else { 1 }
            Set-RegistryValue -Path $psLogPath -Name "EnableScriptBlockLogging" -Value $logValue
            Set-RegistryValue -Path $psLogPath -Name "EnableScriptBlockInvocationLogging" -Value $logValue

            Write-Status "PowerShell Script Block Logging: $logValue" "Success"
            Add-ChangeLog -Category "Audit" -Setting "PowerShellScriptBlockLogging" -OldValue "Unknown" -NewValue $logValue -Status "Success"
        }
        catch {
            Write-Status "Failed to configure PowerShell logging: $_" "Error"
            Add-ChangeLog -Category "Audit" -Setting "PowerShellScriptBlockLogging" -OldValue "Unknown" -NewValue "FAILED" -Status "Error"
        }
    }

    # Configure Module logging
    $psModuleLogPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ModuleLogging"

    if ($PSCmdlet.ShouldProcess("PowerShell Module Logging", "Enable")) {
        try {
            if (-not (Test-Path $psModuleLogPath)) {
                New-Item -Path $psModuleLogPath -Force | Out-Null
            }

            $logValue = if ($Undo) { 0 } else { 1 }
            Set-RegistryValue -Path $psModuleLogPath -Name "EnableModuleLogging" -Value $logValue

            # Log all modules
            $moduleNamesPath = "$psModuleLogPath\ModuleNames"
            if (-not (Test-Path $moduleNamesPath)) {
                New-Item -Path $moduleNamesPath -Force | Out-Null
            }

            if (-not $Undo) {
                Set-RegistryValue -Path $moduleNamesPath -Name "*" -Value "*" -Type "String"
            }

            Write-Status "PowerShell Module Logging: $logValue" "Success"
            Add-ChangeLog -Category "Audit" -Setting "PowerShellModuleLogging" -OldValue "Unknown" -NewValue $logValue -Status "Success"
        }
        catch {
            Write-Status "Failed to configure PowerShell module logging: $_" "Error"
            Add-ChangeLog -Category "Audit" -Setting "PowerShellModuleLogging" -OldValue "Unknown" -NewValue "FAILED" -Status "Error"
        }
    }
}

# ============================================================================
# Registry Run Key Monitoring
# ============================================================================

function Set-RunKeyMonitoring {
    Write-Status "Configuring Registry Run key monitoring..." "Header"

    # Enable auditing on Run keys via auditpol
    $auditRules = @(
        "HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce",
        "HKLM\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKLM\Software\Microsoft\Windows\CurrentVersion\RunOnce"
    )

    foreach ($key in $auditRules) {
        Write-Status "Recommendation: Monitor registry key $key for modifications" "Info"
    }

    Add-ChangeLog -Category "Monitoring" -Setting "RunKeyAuditing" -OldValue "N/A" -NewValue "Recommended" -Status "Info"
}

# ============================================================================
# Attack Surface Reduction Rules
# ============================================================================

function Set-ASRRules {
    Write-Status "Configuring Attack Surface Reduction (ASR) rules..." "Header"

    # Check if ASR rules are available (requires Windows Defender)
    try {
        $mpPrefs = Get-MpPreference -ErrorAction Stop
    }
    catch {
        Write-Status "Cannot configure ASR rules - Windows Defender not available" "Warning"
        Add-ChangeLog -Category "ASR" -Setting "Configuration" -OldValue "N/A" -NewValue "Defender Not Available" -Status "Warning"
        return
    }

    # ASR rules relevant to this attack
    $asrRules = @(
        @{
            GUID = "d4f940ab-401b-4efc-aadc-ad5f3c50688a"
            Name = "Block Office applications from creating executable content"
            Action = 1  # Block
        },
        @{
            GUID = "be9ba2d9-53ea-4cdc-84e5-9b1eeee46550"
            Name = "Block executable content from email client and webmail"
            Action = 1
        },
        @{
            GUID = "b2b3f03d-6a65-4f7b-a9c7-1c7ef74a9ba4"
            Name = "Block untrusted and unsigned processes from USB"
            Action = 1
        },
        @{
            GUID = "92E97FA1-2EDF-4476-BDD6-9DD0B4DDDC7B"
            Name = "Block Win32 API calls from Office macros"
            Action = 1
        },
        @{
            GUID = "d1e49aac-8f56-4280-b9ba-993a6d77406c"
            Name = "Block process creations originating from PSExec and WMI"
            Action = 1
        }
    )

    if ($AuditOnly) {
        Write-Status "Audit-only mode: Setting ASR rules to Audit (2) instead of Block (1)" "Info"
    }

    foreach ($rule in $asrRules) {
        $targetAction = if ($Undo) { 0 } elseif ($AuditOnly) { 2 } else { $rule.Action }

        if ($PSCmdlet.ShouldProcess($rule.Name, "Set ASR action to $targetAction")) {
            try {
                Add-MpPreference -AttackSurfaceReductionRules_Ids $rule.GUID -AttackSurfaceReductionRules_Actions $targetAction -ErrorAction Stop
                Write-Status "$($rule.Name): Action set to $targetAction" "Success"
                Add-ChangeLog -Category "ASR" -Setting $rule.Name -OldValue "Unknown" -NewValue $targetAction -Status "Success"
            }
            catch {
                Write-Status "Failed to set ASR rule $($rule.Name): $_" "Warning"
                Add-ChangeLog -Category "ASR" -Setting $rule.Name -OldValue "Unknown" -NewValue "FAILED" -Status "Error"
            }
        }
    }
}

# ============================================================================
# Privileged Account Management Guidance (M1026)
# ============================================================================

function Show-PrivilegedAccountGuidance {
    Write-Status "Privileged Account Management Recommendations (M1026)..." "Header"

    Write-Status "1. Remove standard users from local Administrators group" "Info"
    Write-Status "2. Implement the principle of least privilege" "Info"
    Write-Status "3. Use Privileged Access Workstations (PAWs) for admin tasks" "Info"
    Write-Status "4. Enable LAPS for local admin password management" "Info"

    # List current local administrators
    Write-Status "Current Local Administrators:" "Info"
    try {
        $admins = Get-LocalGroupMember -Group "Administrators" -ErrorAction Stop
        foreach ($admin in $admins) {
            Write-Host "    - $($admin.Name) [$($admin.ObjectClass)]" -ForegroundColor Gray
        }
    }
    catch {
        Write-Status "Could not enumerate local administrators: $_" "Warning"
    }

    Add-ChangeLog -Category "Guidance" -Setting "PrivilegedAccountManagement" -OldValue "N/A" -NewValue "Recommendations Provided" -Status "Info"
}

# ============================================================================
# Verification Function
# ============================================================================

function Test-HardeningStatus {
    Write-Status "Verifying hardening status..." "Header"

    $checks = @()

    # Check UAC settings
    $enableLUA = Get-RegistryValue -Path $UACPolicyPath -Name "EnableLUA" -Default 0
    $checks += [PSCustomObject]@{
        Setting = "UAC Enabled"
        Status = if ($enableLUA -eq 1) { "PASS" } else { "FAIL" }
        Value = $enableLUA
        Expected = 1
    }

    $consentBehavior = Get-RegistryValue -Path $UACPolicyPath -Name "ConsentPromptBehaviorAdmin" -Default 5
    $checks += [PSCustomObject]@{
        Setting = "Admin Consent Prompt (Credentials on Secure Desktop)"
        Status = if ($consentBehavior -eq 2) { "PASS" } else { "WARN" }
        Value = $consentBehavior
        Expected = 2
    }

    $filterAdmin = Get-RegistryValue -Path $UACPolicyPath -Name "FilterAdministratorToken" -Default 0
    $checks += [PSCustomObject]@{
        Setting = "Filter Admin Token"
        Status = if ($filterAdmin -eq 1) { "PASS" } else { "WARN" }
        Value = $filterAdmin
        Expected = 1
    }

    $validateSig = Get-RegistryValue -Path $UACPolicyPath -Name "ValidateAdminCodeSignatures" -Default 0
    $checks += [PSCustomObject]@{
        Setting = "Validate Admin Code Signatures"
        Status = if ($validateSig -eq 1) { "PASS" } else { "WARN" }
        Value = $validateSig
        Expected = 1
    }

    # Check PowerShell logging
    $psLogPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging"
    $scriptBlockLog = Get-RegistryValue -Path $psLogPath -Name "EnableScriptBlockLogging" -Default 0
    $checks += [PSCustomObject]@{
        Setting = "PowerShell Script Block Logging"
        Status = if ($scriptBlockLog -eq 1) { "PASS" } else { "WARN" }
        Value = $scriptBlockLog
        Expected = 1
    }

    # Check Defender status
    try {
        $mpStatus = Get-MpComputerStatus -ErrorAction Stop
        $checks += [PSCustomObject]@{
            Setting = "Defender Real-Time Protection"
            Status = if ($mpStatus.RealTimeProtectionEnabled) { "PASS" } else { "FAIL" }
            Value = $mpStatus.RealTimeProtectionEnabled
            Expected = $true
        }
        $checks += [PSCustomObject]@{
            Setting = "Defender Tamper Protection"
            Status = if ($mpStatus.IsTamperProtected) { "PASS" } else { "WARN" }
            Value = $mpStatus.IsTamperProtected
            Expected = $true
        }
    }
    catch {
        $checks += [PSCustomObject]@{
            Setting = "Defender Status"
            Status = "UNKNOWN"
            Value = "Query Failed"
            Expected = "N/A"
        }
    }

    # Display results
    Write-Host ""
    Write-Host "=" * 80
    Write-Host "HARDENING STATUS SUMMARY" -ForegroundColor Cyan
    Write-Host "=" * 80

    foreach ($check in $checks) {
        $color = switch ($check.Status) {
            "PASS" { "Green" }
            "WARN" { "Yellow" }
            "FAIL" { "Red" }
            default { "Gray" }
        }
        Write-Host ("[{0,-8}] {1,-45} Value: {2}" -f $check.Status, $check.Setting, $check.Value) -ForegroundColor $color
    }

    Write-Host "=" * 80
    Write-Host ""

    return $checks
}

# ============================================================================
# Main Execution
# ============================================================================

Write-Host ""
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "F0RT1KA DEFENSE HARDENING SCRIPT" -ForegroundColor Cyan
Write-Host "Test ID: $TestID" -ForegroundColor Gray
Write-Host "Test Name: $TestName" -ForegroundColor Gray
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host ""

if ($Undo) {
    Write-Status "UNDO MODE: Reverting hardening changes to Windows defaults..." "Warning"
}
elseif ($AuditOnly) {
    Write-Status "AUDIT-ONLY MODE: Configuring monitoring without changing protection settings..." "Info"
}
else {
    Write-Status "Applying hardening settings to protect against SafePay-style attacks..." "Info"
}

Write-Host ""

# Execute hardening functions
if (-not $AuditOnly -or $Undo) {
    Set-UACHardening
    Write-Host ""
}

Set-AuditPolicies
Write-Host ""

Test-DefenderTamperProtection
Write-Host ""

Set-RunKeyMonitoring
Write-Host ""

if (-not $AuditOnly -or $Undo) {
    Set-ASRRules
    Write-Host ""
}

Show-PrivilegedAccountGuidance
Write-Host ""

# Run verification
$status = Test-HardeningStatus

# Display change log
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "CHANGE LOG" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Cyan

$Script:ChangeLog | Format-Table -AutoSize -Property Timestamp, Category, Setting, OldValue, NewValue, Status

# Export change log to file
$logPath = Join-Path $env:TEMP "F0RT1KA_Hardening_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
$Script:ChangeLog | ConvertTo-Json | Out-File -FilePath $logPath -Encoding UTF8
Write-Status "Change log exported to: $logPath" "Info"

# Reboot notification
if ($Script:RebootRequired -and -not $SkipReboot -and -not $Undo) {
    Write-Host ""
    Write-Status "Some UAC settings require a reboot to take effect." "Warning"
    $reboot = Read-Host "Would you like to reboot now? (y/N)"
    if ($reboot -eq 'y' -or $reboot -eq 'Y') {
        Write-Status "Rebooting in 10 seconds... Press Ctrl+C to cancel." "Warning"
        Start-Sleep -Seconds 10
        Restart-Computer -Force
    }
    else {
        Write-Status "Remember to reboot for all changes to take effect." "Warning"
    }
}

Write-Host ""
Write-Status "Hardening script completed." "Success"
Write-Host ""
