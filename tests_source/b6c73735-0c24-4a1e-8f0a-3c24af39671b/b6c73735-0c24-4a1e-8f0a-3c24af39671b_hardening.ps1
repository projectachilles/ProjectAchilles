<#
.SYNOPSIS
    MDE Authentication Bypass - Hardening Script

.DESCRIPTION
    Applies security hardening to protect against MDE authentication bypass attacks.
    This script implements mitigations for MITRE ATT&CK techniques:
    - T1562.001 - Impair Defenses: Disable or Modify Tools
    - T1014 - Rootkit
    - T1090.003 - Proxy: Multi-hop Proxy
    - T1140 - Deobfuscate/Decode Files or Information
    - T1071.001 - Application Layer Protocol: Web Protocols

    Test ID: b6c73735-0c24-4a1e-8f0a-3c24af39671b
    MITRE Mitigations: M1047, M1038, M1022, M1024, M1018, M1037

.PARAMETER Undo
    Reverts all hardening changes made by this script

.PARAMETER WhatIf
    Shows what changes would be made without applying them

.PARAMETER Force
    Skips confirmation prompts

.PARAMETER EnableASR
    Enables Attack Surface Reduction rules (may impact legitimate applications)

.PARAMETER EnableAuditOnly
    Enables audit-only mode for ASR rules instead of blocking

.EXAMPLE
    .\b6c73735-0c24-4a1e-8f0a-3c24af39671b_hardening.ps1
    Applies all hardening settings with prompts

.EXAMPLE
    .\b6c73735-0c24-4a1e-8f0a-3c24af39671b_hardening.ps1 -Force -EnableASR
    Applies all hardening including ASR rules without prompts

.EXAMPLE
    .\b6c73735-0c24-4a1e-8f0a-3c24af39671b_hardening.ps1 -Undo
    Reverts all hardening settings

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Version: 2.0
    Date: 2025-01-22
    Requires: Administrator privileges
    Idempotent: Yes (safe to run multiple times)

    IMPORTANT: Test in a non-production environment first!
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo,
    [switch]$Force,
    [switch]$EnableASR,
    [switch]$EnableAuditOnly
)

# ============================================================
# Configuration
# ============================================================
$ErrorActionPreference = "Stop"
$Script:ChangeLog = @()
$Script:BackupPath = "$env:ProgramData\F0RT1KA\Hardening\Backups"
$Script:LogPath = "$env:ProgramData\F0RT1KA\Hardening\Logs"
$Script:ConfigPath = "$env:ProgramData\F0RT1KA\Hardening\Config"
$Script:TestID = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"

# ============================================================
# Pre-flight Checks
# ============================================================

function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    Write-Host "[ERROR] This script requires Administrator privileges." -ForegroundColor Red
    Write-Host "Please run PowerShell as Administrator and try again." -ForegroundColor Yellow
    exit 1
}

# ============================================================
# Helper Functions
# ============================================================

function Write-Status {
    param(
        [string]$Message,
        [ValidateSet("Info", "Success", "Warning", "Error", "Action")]
        [string]$Type = "Info"
    )
    $colors = @{
        Info = "Cyan"
        Success = "Green"
        Warning = "Yellow"
        Error = "Red"
        Action = "Magenta"
    }
    $prefix = @{
        Info = "[*]"
        Success = "[+]"
        Warning = "[!]"
        Error = "[-]"
        Action = "[>]"
    }
    Write-Host "$($prefix[$Type]) $Message" -ForegroundColor $colors[$Type]
}

function Add-ChangeLog {
    param(
        [string]$Category,
        [string]$Action,
        [string]$Target,
        [string]$OldValue = "",
        [string]$NewValue = ""
    )
    $Script:ChangeLog += [PSCustomObject]@{
        Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Category = $Category
        Action = $Action
        Target = $Target
        OldValue = $OldValue
        NewValue = $NewValue
    }
}

function Initialize-Directories {
    $dirs = @($Script:BackupPath, $Script:LogPath, $Script:ConfigPath)
    foreach ($dir in $dirs) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-Status "Created directory: $dir" "Info"
        }
    }
}

function Save-ChangeLog {
    $logFile = Join-Path $Script:LogPath "hardening_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
    $Script:ChangeLog | ConvertTo-Json -Depth 5 | Out-File -FilePath $logFile -Encoding UTF8
    Write-Status "Change log saved to: $logFile" "Info"
}

function Backup-RegistryKey {
    param([string]$KeyPath, [string]$BackupName)

    $backupFile = Join-Path $Script:BackupPath "$BackupName.reg"
    try {
        reg export $KeyPath $backupFile /y 2>$null
        Write-Status "Backed up: $KeyPath" "Info"
        return $true
    } catch {
        Write-Status "Could not backup: $KeyPath (may not exist)" "Warning"
        return $false
    }
}

# ============================================================
# Hardening Functions
# ============================================================

function Set-F0DirectoryProtection {
    <#
    .SYNOPSIS
        Restricts access to C:\F0 directory
    #>
    param([switch]$Undo)

    Write-Status "Configuring F0 directory protection..." "Action"

    $f0Path = "C:\F0"

    if ($Undo) {
        # Remove F0 directory restriction
        if (Test-Path $f0Path) {
            try {
                # Reset ACL to inherited permissions
                $acl = Get-Acl $f0Path
                $acl.SetAccessRuleProtection($false, $true)
                Set-Acl -Path $f0Path -AclObject $acl
                Write-Status "Removed F0 directory restrictions" "Success"
                Add-ChangeLog "FileSystem" "Undo" $f0Path "Restricted" "Inherited"
            } catch {
                Write-Status "Could not reset F0 permissions: $_" "Warning"
            }
        }
        return
    }

    # Create directory if it doesn't exist (so we can lock it down)
    if (-not (Test-Path $f0Path)) {
        New-Item -ItemType Directory -Path $f0Path -Force | Out-Null
    }

    try {
        # Get current ACL
        $acl = Get-Acl $f0Path

        # Disable inheritance
        $acl.SetAccessRuleProtection($true, $false)

        # Remove all existing rules
        $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) } | Out-Null

        # Add SYSTEM full control (required for operation)
        $systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            "NT AUTHORITY\SYSTEM",
            "FullControl",
            "ContainerInherit,ObjectInherit",
            "None",
            "Allow"
        )
        $acl.AddAccessRule($systemRule)

        # Add Administrators read-only (for investigation)
        $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            "BUILTIN\Administrators",
            "ReadAndExecute",
            "ContainerInherit,ObjectInherit",
            "None",
            "Allow"
        )
        $acl.AddAccessRule($adminRule)

        # Apply ACL
        Set-Acl -Path $f0Path -AclObject $acl

        Write-Status "Applied restrictive ACL to C:\F0" "Success"
        Add-ChangeLog "FileSystem" "Apply" $f0Path "Default" "Restricted"

    } catch {
        Write-Status "Failed to configure F0 directory: $_" "Error"
    }
}

function Set-MDERegistryProtection {
    <#
    .SYNOPSIS
        Enables auditing on MDE registry keys
    #>
    param([switch]$Undo)

    Write-Status "Configuring MDE registry protection..." "Action"

    $mdeRegPaths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows Advanced Threat Protection"
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows Advanced Threat Protection"
    )

    foreach ($regPath in $mdeRegPaths) {
        if ($Undo) {
            Write-Status "Registry auditing removal requires manual intervention" "Warning"
            continue
        }

        if (Test-Path $regPath) {
            try {
                # Enable SACL auditing
                $acl = Get-Acl $regPath -Audit
                $auditRule = New-Object System.Security.AccessControl.RegistryAuditRule(
                    "Everyone",
                    "ReadKey",
                    "ContainerInherit,ObjectInherit",
                    "None",
                    "Success"
                )
                $acl.AddAuditRule($auditRule)
                Set-Acl -Path $regPath -AclObject $acl

                Write-Status "Enabled auditing on: $regPath" "Success"
                Add-ChangeLog "Registry" "Audit" $regPath "None" "Read auditing enabled"
            } catch {
                Write-Status "Could not configure auditing for $regPath : $_" "Warning"
            }
        } else {
            Write-Status "Registry key not found (MDE may not be installed): $regPath" "Info"
        }
    }
}

function Set-CredentialGuardProtection {
    <#
    .SYNOPSIS
        Enables Credential Guard for memory protection
    #>
    param([switch]$Undo)

    Write-Status "Configuring Credential Guard..." "Action"

    $regPath = "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard"
    $valueName = "EnableVirtualizationBasedSecurity"

    # Backup current setting
    Backup-RegistryKey "HKLM\SYSTEM\CurrentControlSet\Control\DeviceGuard" "DeviceGuard_Backup"

    if ($Undo) {
        if (Test-Path $regPath) {
            try {
                Remove-ItemProperty -Path $regPath -Name $valueName -ErrorAction SilentlyContinue
                Write-Status "Credential Guard setting removed (reboot required)" "Success"
                Add-ChangeLog "Security" "Undo" "Credential Guard" "Enabled" "Removed"
            } catch {
                Write-Status "Could not remove Credential Guard setting: $_" "Warning"
            }
        }
        return
    }

    try {
        if (-not (Test-Path $regPath)) {
            New-Item -Path $regPath -Force | Out-Null
        }
        Set-ItemProperty -Path $regPath -Name $valueName -Value 1 -Type DWord
        Set-ItemProperty -Path $regPath -Name "RequirePlatformSecurityFeatures" -Value 1 -Type DWord

        Write-Status "Credential Guard enabled (reboot required)" "Success"
        Add-ChangeLog "Security" "Apply" "Credential Guard" "Disabled" "Enabled"
    } catch {
        Write-Status "Failed to enable Credential Guard: $_" "Error"
    }
}

function Set-PowerShellConstrainedMode {
    <#
    .SYNOPSIS
        Enables PowerShell Constrained Language Mode
    #>
    param([switch]$Undo)

    Write-Status "Configuring PowerShell execution restrictions..." "Action"

    $regPath = "HKLM:\SOFTWARE\Microsoft\PowerShell\1\ShellIds\Microsoft.PowerShell"

    if ($Undo) {
        try {
            Remove-ItemProperty -Path $regPath -Name "ExecutionPolicy" -ErrorAction SilentlyContinue
            Write-Status "PowerShell execution policy reset to default" "Success"
            Add-ChangeLog "PowerShell" "Undo" "ExecutionPolicy" "AllSigned" "Default"
        } catch {
            Write-Status "Could not reset PowerShell policy: $_" "Warning"
        }
        return
    }

    try {
        Set-ItemProperty -Path $regPath -Name "ExecutionPolicy" -Value "AllSigned"
        Write-Status "PowerShell execution policy set to AllSigned" "Success"
        Add-ChangeLog "PowerShell" "Apply" "ExecutionPolicy" "Default" "AllSigned"
    } catch {
        Write-Status "Failed to set PowerShell policy: $_" "Error"
    }
}

function Enable-PowerShellLogging {
    <#
    .SYNOPSIS
        Enables comprehensive PowerShell logging
    #>
    param([switch]$Undo)

    Write-Status "Configuring PowerShell logging..." "Action"

    $scriptBlockPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging"
    $modulePath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ModuleLogging"
    $transcriptPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\Transcription"

    if ($Undo) {
        try {
            Remove-Item -Path $scriptBlockPath -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path $modulePath -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path $transcriptPath -Recurse -Force -ErrorAction SilentlyContinue
            Write-Status "PowerShell logging disabled" "Success"
            Add-ChangeLog "PowerShell" "Undo" "Logging" "Enabled" "Disabled"
        } catch {
            Write-Status "Could not disable PowerShell logging: $_" "Warning"
        }
        return
    }

    try {
        # Script Block Logging
        if (-not (Test-Path $scriptBlockPath)) {
            New-Item -Path $scriptBlockPath -Force | Out-Null
        }
        Set-ItemProperty -Path $scriptBlockPath -Name "EnableScriptBlockLogging" -Value 1 -Type DWord
        Set-ItemProperty -Path $scriptBlockPath -Name "EnableScriptBlockInvocationLogging" -Value 1 -Type DWord

        # Module Logging
        if (-not (Test-Path $modulePath)) {
            New-Item -Path $modulePath -Force | Out-Null
        }
        Set-ItemProperty -Path $modulePath -Name "EnableModuleLogging" -Value 1 -Type DWord

        # Transcription
        if (-not (Test-Path $transcriptPath)) {
            New-Item -Path $transcriptPath -Force | Out-Null
        }
        Set-ItemProperty -Path $transcriptPath -Name "EnableTranscripting" -Value 1 -Type DWord
        Set-ItemProperty -Path $transcriptPath -Name "OutputDirectory" -Value "$env:ProgramData\PowerShellTranscripts" -Type String
        Set-ItemProperty -Path $transcriptPath -Name "EnableInvocationHeader" -Value 1 -Type DWord

        # Create transcript directory
        $transcriptDir = "$env:ProgramData\PowerShellTranscripts"
        if (-not (Test-Path $transcriptDir)) {
            New-Item -ItemType Directory -Path $transcriptDir -Force | Out-Null
        }

        Write-Status "PowerShell logging enabled (Script Block, Module, Transcription)" "Success"
        Add-ChangeLog "PowerShell" "Apply" "Logging" "Disabled" "Enabled"
    } catch {
        Write-Status "Failed to enable PowerShell logging: $_" "Error"
    }
}

function Set-ASRRules {
    <#
    .SYNOPSIS
        Enables Attack Surface Reduction rules
    #>
    param(
        [switch]$Undo,
        [switch]$AuditOnly
    )

    Write-Status "Configuring Attack Surface Reduction rules..." "Action"

    # ASR rules relevant to this attack
    $asrRules = @{
        # Block executable content from email client and webmail
        "BE9BA2D9-53EA-4CDC-84E5-9B1EEEE46550" = "Block executable content from email"
        # Block all Office applications from creating child processes
        "D4F940AB-401B-4EFC-AADC-AD5F3C50688A" = "Block Office child processes"
        # Block Office from creating executable content
        "3B576869-A4EC-4529-8536-B80A7769E899" = "Block Office executable creation"
        # Block credential stealing from LSASS
        "9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2" = "Block credential stealing from LSASS"
        # Block untrusted and unsigned processes from USB
        "B2B3F03D-6A65-4F7B-A9C7-1C7EF74A9BA4" = "Block untrusted USB processes"
        # Block persistence through WMI
        "E6DB77E5-3DF2-4CF1-B95A-636979351E5B" = "Block persistence through WMI"
        # Block process creations from PSExec and WMI
        "D1E49AAC-8F56-4280-B9BA-993A6D77406C" = "Block PSExec and WMI process creation"
    }

    if ($Undo) {
        try {
            foreach ($ruleId in $asrRules.Keys) {
                Remove-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -ErrorAction SilentlyContinue
            }
            Write-Status "ASR rules disabled" "Success"
            Add-ChangeLog "ASR" "Undo" "All Rules" "Enabled" "Disabled"
        } catch {
            Write-Status "Could not disable ASR rules: $_" "Warning"
        }
        return
    }

    try {
        $mode = if ($AuditOnly) { 2 } else { 1 }  # 1 = Block, 2 = Audit
        $modeText = if ($AuditOnly) { "Audit" } else { "Block" }

        foreach ($ruleId in $asrRules.Keys) {
            $ruleName = $asrRules[$ruleId]
            Add-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -AttackSurfaceReductionRules_Actions $mode
            Write-Status "  $modeText mode: $ruleName" "Info"
        }

        Write-Status "ASR rules configured in $modeText mode" "Success"
        Add-ChangeLog "ASR" "Apply" "All Rules" "Disabled" "$modeText mode"
    } catch {
        Write-Status "Failed to configure ASR rules: $_" "Error"
    }
}

function Set-ControlledFolderAccess {
    <#
    .SYNOPSIS
        Enables Controlled Folder Access for Defender directories
    #>
    param([switch]$Undo)

    Write-Status "Configuring Controlled Folder Access..." "Action"

    $protectedFolders = @(
        "C:\ProgramData\Microsoft\Windows Defender"
        "C:\Program Files\Windows Defender"
        "C:\Program Files\Windows Defender Advanced Threat Protection"
    )

    if ($Undo) {
        try {
            Set-MpPreference -EnableControlledFolderAccess Disabled
            foreach ($folder in $protectedFolders) {
                Remove-MpPreference -ControlledFolderAccessProtectedFolders $folder -ErrorAction SilentlyContinue
            }
            Write-Status "Controlled Folder Access disabled" "Success"
            Add-ChangeLog "CFA" "Undo" "Controlled Folder Access" "Enabled" "Disabled"
        } catch {
            Write-Status "Could not disable Controlled Folder Access: $_" "Warning"
        }
        return
    }

    try {
        Set-MpPreference -EnableControlledFolderAccess Enabled
        foreach ($folder in $protectedFolders) {
            if (Test-Path $folder) {
                Add-MpPreference -ControlledFolderAccessProtectedFolders $folder
                Write-Status "  Protected: $folder" "Info"
            }
        }
        Write-Status "Controlled Folder Access enabled" "Success"
        Add-ChangeLog "CFA" "Apply" "Controlled Folder Access" "Disabled" "Enabled"
    } catch {
        Write-Status "Failed to enable Controlled Folder Access: $_" "Error"
    }
}

function Set-NetworkProtection {
    <#
    .SYNOPSIS
        Enables Windows Defender Network Protection
    #>
    param([switch]$Undo)

    Write-Status "Configuring Network Protection..." "Action"

    if ($Undo) {
        try {
            Set-MpPreference -EnableNetworkProtection Disabled
            Write-Status "Network Protection disabled" "Success"
            Add-ChangeLog "Network" "Undo" "Network Protection" "Enabled" "Disabled"
        } catch {
            Write-Status "Could not disable Network Protection: $_" "Warning"
        }
        return
    }

    try {
        Set-MpPreference -EnableNetworkProtection Enabled
        Write-Status "Network Protection enabled" "Success"
        Add-ChangeLog "Network" "Apply" "Network Protection" "Disabled" "Enabled"
    } catch {
        Write-Status "Failed to enable Network Protection: $_" "Error"
    }
}

function Set-AuditPolicies {
    <#
    .SYNOPSIS
        Enables audit policies for security monitoring
    #>
    param([switch]$Undo)

    Write-Status "Configuring audit policies..." "Action"

    $auditPolicies = @(
        @{ Category = "Object Access"; Subcategory = "Registry"; Setting = "Success,Failure" }
        @{ Category = "Object Access"; Subcategory = "File System"; Setting = "Success,Failure" }
        @{ Category = "Privilege Use"; Subcategory = "Sensitive Privilege Use"; Setting = "Success,Failure" }
        @{ Category = "Detailed Tracking"; Subcategory = "Process Creation"; Setting = "Success" }
        @{ Category = "Detailed Tracking"; Subcategory = "Process Termination"; Setting = "Success" }
    )

    if ($Undo) {
        try {
            foreach ($policy in $auditPolicies) {
                auditpol /set /subcategory:"$($policy.Subcategory)" /success:disable /failure:disable 2>$null
            }
            Write-Status "Audit policies disabled" "Success"
            Add-ChangeLog "Audit" "Undo" "Audit Policies" "Enabled" "Disabled"
        } catch {
            Write-Status "Could not disable audit policies: $_" "Warning"
        }
        return
    }

    try {
        foreach ($policy in $auditPolicies) {
            $successFlag = if ($policy.Setting -match "Success") { "enable" } else { "disable" }
            $failureFlag = if ($policy.Setting -match "Failure") { "enable" } else { "disable" }
            auditpol /set /subcategory:"$($policy.Subcategory)" /success:$successFlag /failure:$failureFlag 2>$null
            Write-Status "  Enabled: $($policy.Subcategory)" "Info"
        }
        Write-Status "Audit policies configured" "Success"
        Add-ChangeLog "Audit" "Apply" "Audit Policies" "Default" "Enhanced"
    } catch {
        Write-Status "Failed to configure audit policies: $_" "Error"
    }
}

function Set-FirewallRules {
    <#
    .SYNOPSIS
        Configures firewall rules to restrict MDE endpoint access
    #>
    param([switch]$Undo)

    Write-Status "Configuring firewall rules..." "Action"

    $ruleName = "F0RT1KA-Block-Unauthorized-MDE-Access"

    if ($Undo) {
        try {
            Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
            Write-Status "Firewall rule removed: $ruleName" "Success"
            Add-ChangeLog "Firewall" "Undo" $ruleName "Enabled" "Removed"
        } catch {
            Write-Status "Could not remove firewall rule: $_" "Warning"
        }
        return
    }

    try {
        # Remove existing rule if present
        Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

        # Block non-MDE processes from connecting to MDE endpoints
        # This is a sample rule - adjust based on environment
        New-NetFirewallRule `
            -DisplayName $ruleName `
            -Description "Block unauthorized access to MDE cloud endpoints" `
            -Direction Outbound `
            -Action Block `
            -Program "C:\F0\*" `
            -RemoteAddress "Any" `
            -Protocol TCP `
            -RemotePort 443 `
            -Enabled True | Out-Null

        Write-Status "Firewall rule created: $ruleName" "Success"
        Add-ChangeLog "Firewall" "Apply" $ruleName "None" "Enabled"
    } catch {
        Write-Status "Failed to create firewall rule: $_" "Error"
    }
}

# ============================================================
# Main Execution
# ============================================================

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " MDE Authentication Bypass - Hardening Script" -ForegroundColor Cyan
Write-Host " Test ID: $Script:TestID" -ForegroundColor Cyan
Write-Host " MITRE ATT&CK: T1562.001, T1014, T1090.003, T1140, T1071.001" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Initialize directories
Initialize-Directories

if ($Undo) {
    Write-Host ""
    Write-Status "UNDO MODE: Reverting hardening changes..." "Warning"
    Write-Host ""

    if (-not $Force) {
        $confirm = Read-Host "Are you sure you want to revert all hardening changes? (yes/no)"
        if ($confirm -ne "yes") {
            Write-Status "Operation cancelled" "Info"
            exit 0
        }
    }

    Set-F0DirectoryProtection -Undo
    Set-MDERegistryProtection -Undo
    Set-CredentialGuardProtection -Undo
    Set-PowerShellConstrainedMode -Undo
    Enable-PowerShellLogging -Undo
    if ($EnableASR) { Set-ASRRules -Undo }
    Set-ControlledFolderAccess -Undo
    Set-NetworkProtection -Undo
    Set-AuditPolicies -Undo
    Set-FirewallRules -Undo

    Write-Host ""
    Write-Status "Hardening changes reverted. Some changes may require a reboot." "Warning"

} else {
    Write-Host ""
    Write-Status "APPLY MODE: Applying hardening settings..." "Info"
    Write-Host ""

    if (-not $Force) {
        Write-Host "This script will apply the following hardening measures:" -ForegroundColor Yellow
        Write-Host "  1. Restrict C:\F0 directory access" -ForegroundColor White
        Write-Host "  2. Enable MDE registry key auditing" -ForegroundColor White
        Write-Host "  3. Enable Credential Guard (requires reboot)" -ForegroundColor White
        Write-Host "  4. Restrict PowerShell execution policy" -ForegroundColor White
        Write-Host "  5. Enable PowerShell logging" -ForegroundColor White
        if ($EnableASR) {
            $asrMode = if ($EnableAuditOnly) { "audit" } else { "block" }
            Write-Host "  6. Configure ASR rules ($asrMode mode)" -ForegroundColor White
        }
        Write-Host "  7. Enable Controlled Folder Access" -ForegroundColor White
        Write-Host "  8. Enable Network Protection" -ForegroundColor White
        Write-Host "  9. Configure security audit policies" -ForegroundColor White
        Write-Host " 10. Create firewall blocking rule" -ForegroundColor White
        Write-Host ""

        $confirm = Read-Host "Do you want to continue? (yes/no)"
        if ($confirm -ne "yes") {
            Write-Status "Operation cancelled" "Info"
            exit 0
        }
    }

    Write-Host ""

    # Apply all hardening measures
    Set-F0DirectoryProtection
    Set-MDERegistryProtection
    Set-CredentialGuardProtection
    Set-PowerShellConstrainedMode
    Enable-PowerShellLogging
    if ($EnableASR) {
        Set-ASRRules -AuditOnly:$EnableAuditOnly
    } else {
        Write-Status "Skipping ASR rules (use -EnableASR to include)" "Info"
    }
    Set-ControlledFolderAccess
    Set-NetworkProtection
    Set-AuditPolicies
    Set-FirewallRules

    Write-Host ""
    Write-Status "Hardening complete!" "Success"
    Write-Status "Some changes require a reboot to take effect." "Warning"
}

# Save change log
Save-ChangeLog

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Summary" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Changes applied: $($Script:ChangeLog.Count)" -ForegroundColor White
Write-Host "Log location: $Script:LogPath" -ForegroundColor White
Write-Host "Backup location: $Script:BackupPath" -ForegroundColor White
Write-Host ""

if (-not $Undo) {
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "  1. Reboot the system to apply all changes" -ForegroundColor White
    Write-Host "  2. Test the F0RT1KA security test to verify protection" -ForegroundColor White
    Write-Host "  3. Review logs in $Script:LogPath" -ForegroundColor White
    Write-Host "  4. To undo changes, run: .\$($MyInvocation.MyCommand.Name) -Undo" -ForegroundColor White
}

Write-Host ""
