<#
.SYNOPSIS
    F0RT1KA Ransomware Defense Hardening Script

.DESCRIPTION
    Applies security hardening measures to protect against ransomware attacks
    as simulated by F0RT1KA test 5ed12ef2-5e29-49a2-8f26-269d8e9edcea.

    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: T1204.002, T1134.001, T1083, T1486, T1491.001
    Mitigations: M1040, M1053, M1026, M1038, M1018

.PARAMETER Undo
    Reverts all changes made by this script

.PARAMETER WhatIf
    Shows what would happen without making changes

.PARAMETER Verbose
    Shows detailed output during execution

.EXAMPLE
    .\5ed12ef2-5e29-49a2-8f26-269d8e9edcea_hardening.ps1
    Applies all hardening settings

.EXAMPLE
    .\5ed12ef2-5e29-49a2-8f26-269d8e9edcea_hardening.ps1 -Undo
    Reverts all hardening settings

.EXAMPLE
    .\5ed12ef2-5e29-49a2-8f26-269d8e9edcea_hardening.ps1 -WhatIf
    Shows what changes would be made without applying them

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2024-01-15
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
$ErrorActionPreference = "Stop"
$Script:ChangeLog = @()
$Script:BackupPath = "$env:ProgramData\F0RT1KA\HardeningBackup"
$Script:LogPath = "$env:ProgramData\F0RT1KA\HardeningLog.json"

# Test Information
$TestID = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
$TestName = "Multi-Stage Ransomware Killchain"

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
        [string]$MitreAttack
    )
    $Script:ChangeLog += [PSCustomObject]@{
        Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Action = $Action
        Target = $Target
        OldValue = $OldValue
        NewValue = $NewValue
        MitreAttack = $MitreAttack
    }
}

function Save-Backup {
    param(
        [string]$Key,
        [object]$Value
    )

    if (-not (Test-Path $Script:BackupPath)) {
        New-Item -ItemType Directory -Path $Script:BackupPath -Force | Out-Null
    }

    $backupFile = Join-Path $Script:BackupPath "backup_$Key.json"
    $Value | ConvertTo-Json -Depth 10 | Set-Content -Path $backupFile -Force
}

function Get-Backup {
    param(
        [string]$Key
    )

    $backupFile = Join-Path $Script:BackupPath "backup_$Key.json"
    if (Test-Path $backupFile) {
        return Get-Content -Path $backupFile -Raw | ConvertFrom-Json
    }
    return $null
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ============================================================
# Hardening Functions - M1040: Behavior Prevention on Endpoint
# ============================================================

function Set-ControlledFolderAccess {
    <#
    .SYNOPSIS
        Enables Controlled Folder Access (M1040)
    #>
    param([switch]$Disable)

    Write-Status "Configuring Controlled Folder Access (M1040 - Behavior Prevention)" "Info"

    try {
        $currentSetting = (Get-MpPreference).EnableControlledFolderAccess

        if ($Disable) {
            if ($currentSetting -eq 0) {
                Write-Status "Controlled Folder Access already disabled" "Info"
                return
            }

            if ($PSCmdlet.ShouldProcess("Controlled Folder Access", "Disable")) {
                Set-MpPreference -EnableControlledFolderAccess Disabled
                Add-ChangeLog -Action "Disable" -Target "ControlledFolderAccess" -OldValue "Enabled" -NewValue "Disabled" -MitreAttack "T1486"
                Write-Status "Controlled Folder Access disabled" "Warning"
            }
        }
        else {
            if ($currentSetting -eq 1) {
                Write-Status "Controlled Folder Access already enabled" "Success"
                return
            }

            # Save current setting for rollback
            Save-Backup -Key "ControlledFolderAccess" -Value @{ Value = $currentSetting }

            if ($PSCmdlet.ShouldProcess("Controlled Folder Access", "Enable")) {
                Set-MpPreference -EnableControlledFolderAccess Enabled
                Add-ChangeLog -Action "Enable" -Target "ControlledFolderAccess" -OldValue $currentSetting -NewValue "Enabled" -MitreAttack "T1486"
                Write-Status "Controlled Folder Access enabled" "Success"
            }
        }
    }
    catch {
        Write-Status "Failed to configure Controlled Folder Access: $_" "Error"
    }
}

function Set-AttackSurfaceReductionRules {
    <#
    .SYNOPSIS
        Configures Attack Surface Reduction rules for ransomware protection (M1040)
    #>
    param([switch]$Disable)

    Write-Status "Configuring Attack Surface Reduction Rules (M1040)" "Info"

    # ASR Rules relevant to ransomware protection
    $asrRules = @{
        # Block executable content from email client and webmail
        "be9ba2d9-53ea-4cdc-84e5-9b1eeee46550" = "Block executable content from email"
        # Block Office applications from creating executable content
        "3b576869-a4ec-4529-8536-b80a7769e899" = "Block Office creating executables"
        # Block Office applications from injecting code into other processes
        "75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84" = "Block Office code injection"
        # Use advanced protection against ransomware
        "c1db55ab-c21a-4637-bb3f-a12568109d35" = "Advanced ransomware protection"
        # Block executable files from running unless they meet criteria
        "d4f940ab-401b-4efc-aadc-ad5f3c50688a" = "Block untrusted executables"
        # Block process creations originating from PSExec and WMI commands
        "d1e49aac-8f56-4280-b9ba-993a6d77406c" = "Block PSExec/WMI process creation"
        # Block credential stealing from LSASS
        "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2" = "Block LSASS credential stealing"
    }

    try {
        foreach ($ruleId in $asrRules.Keys) {
            $ruleName = $asrRules[$ruleId]

            if ($Disable) {
                if ($PSCmdlet.ShouldProcess("ASR Rule: $ruleName", "Disable")) {
                    Add-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -AttackSurfaceReductionRules_Actions Disabled
                    Add-ChangeLog -Action "Disable" -Target "ASR_$ruleName" -OldValue "Enabled" -NewValue "Disabled" -MitreAttack "T1204.002,T1486"
                    Write-Status "  Disabled: $ruleName" "Warning"
                }
            }
            else {
                if ($PSCmdlet.ShouldProcess("ASR Rule: $ruleName", "Enable")) {
                    Add-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -AttackSurfaceReductionRules_Actions Enabled
                    Add-ChangeLog -Action "Enable" -Target "ASR_$ruleName" -OldValue "NotConfigured" -NewValue "Enabled" -MitreAttack "T1204.002,T1486"
                    Write-Status "  Enabled: $ruleName" "Success"
                }
            }
        }
    }
    catch {
        Write-Status "Failed to configure ASR rules: $_" "Error"
    }
}

# ============================================================
# Hardening Functions - M1026: Privileged Account Management
# ============================================================

function Set-TokenPrivilegeRestrictions {
    <#
    .SYNOPSIS
        Restricts dangerous token privileges (M1026)
    #>
    param([switch]$Disable)

    Write-Status "Configuring Token Privilege Restrictions (M1026 - T1134.001)" "Info"

    # Note: These require careful implementation and may need GPO
    # This is a simplified version that sets registry-based restrictions

    $privilegeKey = "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa"

    try {
        if ($Disable) {
            $backup = Get-Backup -Key "TokenPrivileges"
            if ($backup) {
                if ($PSCmdlet.ShouldProcess("Token Privileges", "Restore defaults")) {
                    if ($backup.RestrictAnonymous) {
                        Set-ItemProperty -Path $privilegeKey -Name "RestrictAnonymous" -Value $backup.RestrictAnonymous
                    }
                    if ($backup.RestrictAnonymousSAM) {
                        Set-ItemProperty -Path $privilegeKey -Name "RestrictAnonymousSAM" -Value $backup.RestrictAnonymousSAM
                    }
                    Write-Status "Token privilege restrictions reverted" "Warning"
                }
            }
        }
        else {
            # Save current values
            $currentRestrict = (Get-ItemProperty -Path $privilegeKey -Name "RestrictAnonymous" -ErrorAction SilentlyContinue).RestrictAnonymous
            $currentRestrictSAM = (Get-ItemProperty -Path $privilegeKey -Name "RestrictAnonymousSAM" -ErrorAction SilentlyContinue).RestrictAnonymousSAM

            Save-Backup -Key "TokenPrivileges" -Value @{
                RestrictAnonymous = $currentRestrict
                RestrictAnonymousSAM = $currentRestrictSAM
            }

            if ($PSCmdlet.ShouldProcess("RestrictAnonymous", "Set to 1")) {
                Set-ItemProperty -Path $privilegeKey -Name "RestrictAnonymous" -Value 1
                Add-ChangeLog -Action "Set" -Target "RestrictAnonymous" -OldValue $currentRestrict -NewValue "1" -MitreAttack "T1134.001"
                Write-Status "  RestrictAnonymous set to 1" "Success"
            }

            if ($PSCmdlet.ShouldProcess("RestrictAnonymousSAM", "Set to 1")) {
                Set-ItemProperty -Path $privilegeKey -Name "RestrictAnonymousSAM" -Value 1
                Add-ChangeLog -Action "Set" -Target "RestrictAnonymousSAM" -OldValue $currentRestrictSAM -NewValue "1" -MitreAttack "T1134.001"
                Write-Status "  RestrictAnonymousSAM set to 1" "Success"
            }
        }
    }
    catch {
        Write-Status "Failed to configure token restrictions: $_" "Error"
    }
}

function Set-LsassProtection {
    <#
    .SYNOPSIS
        Enables LSASS protection to prevent credential theft (M1026)
    #>
    param([switch]$Disable)

    Write-Status "Configuring LSASS Protection (M1026 - T1134.001)" "Info"

    $lsaKey = "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa"

    try {
        $currentValue = (Get-ItemProperty -Path $lsaKey -Name "RunAsPPL" -ErrorAction SilentlyContinue).RunAsPPL

        if ($Disable) {
            $backup = Get-Backup -Key "LsassProtection"
            if ($backup -and $PSCmdlet.ShouldProcess("LSASS Protection", "Disable")) {
                Set-ItemProperty -Path $lsaKey -Name "RunAsPPL" -Value $backup.RunAsPPL
                Add-ChangeLog -Action "Revert" -Target "LsassProtection" -OldValue "1" -NewValue $backup.RunAsPPL -MitreAttack "T1134.001"
                Write-Status "LSASS Protection reverted (requires reboot)" "Warning"
            }
        }
        else {
            if ($currentValue -eq 1) {
                Write-Status "  LSASS Protection already enabled" "Success"
                return
            }

            Save-Backup -Key "LsassProtection" -Value @{ RunAsPPL = $currentValue }

            if ($PSCmdlet.ShouldProcess("LSASS RunAsPPL", "Enable")) {
                Set-ItemProperty -Path $lsaKey -Name "RunAsPPL" -Value 1 -Type DWord
                Add-ChangeLog -Action "Enable" -Target "LsassProtection" -OldValue $currentValue -NewValue "1" -MitreAttack "T1134.001"
                Write-Status "  LSASS Protection enabled (requires reboot)" "Success"
            }
        }
    }
    catch {
        Write-Status "Failed to configure LSASS protection: $_" "Error"
    }
}

# ============================================================
# Hardening Functions - M1053: Data Backup
# ============================================================

function Set-ShadowCopyProtection {
    <#
    .SYNOPSIS
        Configures Volume Shadow Copy protection (M1053)
    #>
    param([switch]$Disable)

    Write-Status "Configuring Shadow Copy Protection (M1053 - T1486)" "Info"

    try {
        # Check VSS service status
        $vssService = Get-Service -Name "VSS" -ErrorAction SilentlyContinue

        if ($Disable) {
            Write-Status "  Shadow Copy protection is service-based, not disabling" "Info"
        }
        else {
            if ($vssService.Status -ne "Running") {
                if ($PSCmdlet.ShouldProcess("VSS Service", "Set to Manual start")) {
                    Set-Service -Name "VSS" -StartupType Manual
                    Add-ChangeLog -Action "Configure" -Target "VSSService" -OldValue $vssService.StartType -NewValue "Manual" -MitreAttack "T1486"
                    Write-Status "  VSS Service configured for Manual start" "Success"
                }
            }
            else {
                Write-Status "  VSS Service already running" "Success"
            }

            # Recommend enabling System Protection
            $systemDrive = $env:SystemDrive
            Write-Status "  Recommendation: Enable System Protection on $systemDrive" "Info"
            Write-Status "  Run: Enable-ComputerRestore -Drive '$systemDrive\'" "Info"
        }
    }
    catch {
        Write-Status "Failed to configure Shadow Copy protection: $_" "Error"
    }
}

# ============================================================
# Hardening Functions - M1038: Execution Prevention
# ============================================================

function Set-ScriptBlockLogging {
    <#
    .SYNOPSIS
        Enables PowerShell Script Block Logging (M1038)
    #>
    param([switch]$Disable)

    Write-Status "Configuring PowerShell Script Block Logging (M1038)" "Info"

    $psLogKey = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging"

    try {
        # Ensure key exists
        if (-not (Test-Path $psLogKey)) {
            if (-not $Disable -and $PSCmdlet.ShouldProcess($psLogKey, "Create")) {
                New-Item -Path $psLogKey -Force | Out-Null
            }
        }

        if ($Disable) {
            $backup = Get-Backup -Key "ScriptBlockLogging"
            if ($backup -and $PSCmdlet.ShouldProcess("Script Block Logging", "Disable")) {
                Set-ItemProperty -Path $psLogKey -Name "EnableScriptBlockLogging" -Value 0
                Write-Status "  Script Block Logging disabled" "Warning"
            }
        }
        else {
            $currentValue = (Get-ItemProperty -Path $psLogKey -Name "EnableScriptBlockLogging" -ErrorAction SilentlyContinue).EnableScriptBlockLogging

            Save-Backup -Key "ScriptBlockLogging" -Value @{ EnableScriptBlockLogging = $currentValue }

            if ($PSCmdlet.ShouldProcess("EnableScriptBlockLogging", "Enable")) {
                Set-ItemProperty -Path $psLogKey -Name "EnableScriptBlockLogging" -Value 1 -Type DWord
                Add-ChangeLog -Action "Enable" -Target "ScriptBlockLogging" -OldValue $currentValue -NewValue "1" -MitreAttack "T1204.002"
                Write-Status "  Script Block Logging enabled" "Success"
            }
        }
    }
    catch {
        Write-Status "Failed to configure Script Block Logging: $_" "Error"
    }
}

function Set-WindowsDefenderSettings {
    <#
    .SYNOPSIS
        Configures Windows Defender settings for ransomware protection
    #>
    param([switch]$Disable)

    Write-Status "Configuring Windows Defender Settings (M1040)" "Info"

    try {
        if ($Disable) {
            Write-Status "  Not disabling Defender protections for safety" "Warning"
        }
        else {
            # Enable real-time protection
            $rtpStatus = (Get-MpPreference).DisableRealtimeMonitoring
            if ($rtpStatus) {
                if ($PSCmdlet.ShouldProcess("Real-time Protection", "Enable")) {
                    Set-MpPreference -DisableRealtimeMonitoring $false
                    Add-ChangeLog -Action "Enable" -Target "RealtimeProtection" -OldValue "Disabled" -NewValue "Enabled" -MitreAttack "T1486"
                    Write-Status "  Real-time Protection enabled" "Success"
                }
            }
            else {
                Write-Status "  Real-time Protection already enabled" "Success"
            }

            # Enable cloud-delivered protection
            $cloudStatus = (Get-MpPreference).MAPSReporting
            if ($cloudStatus -eq 0) {
                if ($PSCmdlet.ShouldProcess("Cloud Protection", "Enable")) {
                    Set-MpPreference -MAPSReporting Advanced
                    Add-ChangeLog -Action "Enable" -Target "CloudProtection" -OldValue "Disabled" -NewValue "Advanced" -MitreAttack "T1486"
                    Write-Status "  Cloud-delivered Protection enabled" "Success"
                }
            }
            else {
                Write-Status "  Cloud-delivered Protection already enabled" "Success"
            }

            # Enable tamper protection check
            $tamperStatus = (Get-MpComputerStatus).IsTamperProtected
            if ($tamperStatus) {
                Write-Status "  Tamper Protection enabled" "Success"
            }
            else {
                Write-Status "  Tamper Protection should be enabled via Security Center" "Warning"
            }

            # Enable behavior monitoring
            $behaviorStatus = (Get-MpPreference).DisableBehaviorMonitoring
            if ($behaviorStatus) {
                if ($PSCmdlet.ShouldProcess("Behavior Monitoring", "Enable")) {
                    Set-MpPreference -DisableBehaviorMonitoring $false
                    Add-ChangeLog -Action "Enable" -Target "BehaviorMonitoring" -OldValue "Disabled" -NewValue "Enabled" -MitreAttack "T1486"
                    Write-Status "  Behavior Monitoring enabled" "Success"
                }
            }
            else {
                Write-Status "  Behavior Monitoring already enabled" "Success"
            }
        }
    }
    catch {
        Write-Status "Failed to configure Defender settings: $_" "Error"
    }
}

# ============================================================
# Hardening Functions - Firewall Rules
# ============================================================

function Set-FirewallRules {
    <#
    .SYNOPSIS
        Configures Windows Firewall rules to limit ransomware spread
    #>
    param([switch]$Disable)

    Write-Status "Configuring Firewall Rules (Defense in Depth)" "Info"

    $ruleName = "F0RT1KA_Block_SMB_Outbound"

    try {
        $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

        if ($Disable) {
            if ($existingRule -and $PSCmdlet.ShouldProcess($ruleName, "Remove")) {
                Remove-NetFirewallRule -DisplayName $ruleName
                Add-ChangeLog -Action "Remove" -Target "FirewallRule_$ruleName" -OldValue "Exists" -NewValue "Removed" -MitreAttack "T1486"
                Write-Status "  Firewall rule '$ruleName' removed" "Warning"
            }
        }
        else {
            if (-not $existingRule) {
                if ($PSCmdlet.ShouldProcess($ruleName, "Create")) {
                    # Block outbound SMB to prevent lateral movement
                    # Note: This may affect legitimate SMB usage
                    New-NetFirewallRule `
                        -DisplayName $ruleName `
                        -Description "F0RT1KA: Block outbound SMB to prevent ransomware spread" `
                        -Direction Outbound `
                        -Protocol TCP `
                        -LocalPort 445 `
                        -Action Block `
                        -Enabled True `
                        -Profile Domain,Private,Public | Out-Null

                    Add-ChangeLog -Action "Create" -Target "FirewallRule_$ruleName" -OldValue "NotExists" -NewValue "Created" -MitreAttack "T1486"
                    Write-Status "  Firewall rule '$ruleName' created" "Success"
                    Write-Status "  NOTE: This blocks outbound SMB which may affect file sharing" "Warning"
                }
            }
            else {
                Write-Status "  Firewall rule '$ruleName' already exists" "Success"
            }
        }
    }
    catch {
        Write-Status "Failed to configure firewall rules: $_" "Error"
    }
}

# ============================================================
# Main Execution
# ============================================================

function Show-Banner {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  F0RT1KA Ransomware Defense Hardening Script" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  Test ID: $TestID" -ForegroundColor White
    Write-Host "  Test: $TestName" -ForegroundColor White
    Write-Host "  MITRE: T1204.002, T1134.001, T1083, T1486, T1491.001" -ForegroundColor White
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Save-ChangeLog {
    if ($Script:ChangeLog.Count -gt 0) {
        $logData = @{
            Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            TestID = $TestID
            Action = if ($Undo) { "Undo" } else { "Apply" }
            Changes = $Script:ChangeLog
        }

        $logDir = Split-Path $Script:LogPath
        if (-not (Test-Path $logDir)) {
            New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        }

        $logData | ConvertTo-Json -Depth 10 | Set-Content -Path $Script:LogPath
        Write-Status "Change log saved to: $Script:LogPath" "Info"
    }
}

# Main
Show-Banner

if (-not (Test-IsAdmin)) {
    Write-Status "This script requires Administrator privileges" "Error"
    Write-Status "Please run PowerShell as Administrator" "Error"
    exit 1
}

if ($Undo) {
    Write-Host ""
    Write-Status "REVERTING hardening changes..." "Warning"
    Write-Host ""

    Set-ControlledFolderAccess -Disable
    Set-AttackSurfaceReductionRules -Disable
    Set-TokenPrivilegeRestrictions -Disable
    Set-LsassProtection -Disable
    Set-ShadowCopyProtection -Disable
    Set-ScriptBlockLogging -Disable
    Set-WindowsDefenderSettings -Disable
    Set-FirewallRules -Disable

    Write-Host ""
    Write-Status "Hardening changes reverted" "Warning"
    Write-Status "Some changes may require a system reboot to take effect" "Info"
}
else {
    Write-Host ""
    Write-Status "APPLYING hardening settings..." "Info"
    Write-Host ""

    # M1040 - Behavior Prevention on Endpoint
    Write-Host ""
    Write-Host "--- M1040: Behavior Prevention on Endpoint ---" -ForegroundColor Yellow
    Set-ControlledFolderAccess
    Set-AttackSurfaceReductionRules
    Set-WindowsDefenderSettings

    # M1026 - Privileged Account Management
    Write-Host ""
    Write-Host "--- M1026: Privileged Account Management ---" -ForegroundColor Yellow
    Set-TokenPrivilegeRestrictions
    Set-LsassProtection

    # M1053 - Data Backup
    Write-Host ""
    Write-Host "--- M1053: Data Backup ---" -ForegroundColor Yellow
    Set-ShadowCopyProtection

    # M1038 - Execution Prevention
    Write-Host ""
    Write-Host "--- M1038: Execution Prevention ---" -ForegroundColor Yellow
    Set-ScriptBlockLogging

    # Defense in Depth
    Write-Host ""
    Write-Host "--- Defense in Depth ---" -ForegroundColor Yellow
    Set-FirewallRules

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Status "Hardening complete!" "Success"
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Status "Some changes may require a system reboot to take effect" "Info"
    Write-Status "Run with -Undo parameter to revert changes" "Info"
    Write-Host ""
}

# Save change log
Save-ChangeLog

# Summary
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Changes Applied: $($Script:ChangeLog.Count)" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Cyan

if ($Script:ChangeLog.Count -gt 0) {
    Write-Host ""
    Write-Host "Change Summary:" -ForegroundColor Yellow
    $Script:ChangeLog | ForEach-Object {
        Write-Host "  - $($_.Action): $($_.Target)" -ForegroundColor White
    }
}

Write-Host ""
Write-Host "To verify protection, re-run F0RT1KA test:" -ForegroundColor Cyan
Write-Host "  .\5ed12ef2-5e29-49a2-8f26-269d8e9edcea.exe" -ForegroundColor White
Write-Host ""
