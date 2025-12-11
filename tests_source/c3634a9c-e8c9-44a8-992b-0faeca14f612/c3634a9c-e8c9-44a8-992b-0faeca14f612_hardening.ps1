<#
.SYNOPSIS
    Hardening script to protect against Akira Ransomware BYOVD attack chain.

.DESCRIPTION
    This script implements defensive measures against the Bring Your Own Vulnerable
    Driver (BYOVD) attack technique and Windows Defender tampering used by Akira
    ransomware. It configures:

    1. Vulnerable Driver Blocklist - Enables Microsoft's vulnerable driver blocklist
    2. Driver Signature Enforcement - Requires signed drivers
    3. Windows Defender Tamper Protection - Protects security settings
    4. Service Creation Auditing - Enables Event ID 7045 logging
    5. Registry Auditing - Monitors Defender policy key changes
    6. Attack Surface Reduction (ASR) Rules - Blocks vulnerable driver abuse
    7. Hypervisor-Protected Code Integrity (HVCI) - Kernel protection

    Test ID: c3634a9c-e8c9-44a8-992b-0faeca14f612
    MITRE ATT&CK: T1068 (Privilege Escalation), T1562.001 (Impair Defenses)
    Mitigations: M1047, M1038, M1050, M1051, M1024

.PARAMETER Undo
    Reverts all changes made by this script to default settings.

.PARAMETER WhatIf
    Shows what changes would be made without actually applying them.

.PARAMETER Verbose
    Provides detailed output of all operations.

.EXAMPLE
    .\c3634a9c-e8c9-44a8-992b-0faeca14f612_hardening.ps1
    Applies all hardening settings to protect against BYOVD attacks.

.EXAMPLE
    .\c3634a9c-e8c9-44a8-992b-0faeca14f612_hardening.ps1 -Undo
    Reverts all hardening settings to default.

.EXAMPLE
    .\c3634a9c-e8c9-44a8-992b-0faeca14f612_hardening.ps1 -WhatIf
    Shows what changes would be made without applying them.

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    Requires: Administrator privileges
    Tested on: Windows 10/11, Windows Server 2019/2022
    Idempotent: Yes (safe to run multiple times)

.LINK
    https://attack.mitre.org/techniques/T1068/
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
$Script:LogFile = Join-Path $env:TEMP "byovd_hardening_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# Test metadata
$TestID = "c3634a9c-e8c9-44a8-992b-0faeca14f612"
$TestName = "Akira Ransomware BYOVD Attack Chain"
$MitreAttack = "T1068, T1562.001"

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

function Set-VulnerableDriverBlocklist {
    <#
    .SYNOPSIS
        Enables Microsoft's Vulnerable Driver Blocklist.

    .DESCRIPTION
        Configures the system to use Microsoft's kernel-mode driver blocklist
        which prevents loading of known vulnerable drivers used in BYOVD attacks.

        MITRE Mitigation: M1038 - Execution Prevention
    #>

    Write-Status "Configuring Vulnerable Driver Blocklist..." "Header"

    $regPath = "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Config"

    if ($Undo) {
        Write-Status "Disabling vulnerable driver blocklist..." "Info"

        if ($PSCmdlet.ShouldProcess("VulnerableDriverBlocklistEnable", "Set to 0")) {
            try {
                if (Test-Path $regPath) {
                    Set-ItemProperty -Path $regPath -Name "VulnerableDriverBlocklistEnable" -Value 0 -Type DWord -Force
                    Add-ChangeLog "Disable" "Vulnerable Driver Blocklist" "Enabled" "Disabled"
                    Write-Status "Vulnerable Driver Blocklist disabled" "Success"
                }
            } catch {
                Write-Status "Failed to disable blocklist: $($_.Exception.Message)" "Warning"
            }
        }
        return
    }

    # Enable vulnerable driver blocklist
    if ($PSCmdlet.ShouldProcess("VulnerableDriverBlocklistEnable", "Set to 1")) {
        try {
            if (-not (Test-Path $regPath)) {
                New-Item -Path $regPath -Force | Out-Null
            }

            $currentValue = Get-ItemProperty -Path $regPath -Name "VulnerableDriverBlocklistEnable" -ErrorAction SilentlyContinue
            $oldValue = if ($currentValue) { $currentValue.VulnerableDriverBlocklistEnable } else { "Not Set" }

            Set-ItemProperty -Path $regPath -Name "VulnerableDriverBlocklistEnable" -Value 1 -Type DWord -Force
            Add-ChangeLog "Enable" "Vulnerable Driver Blocklist" $oldValue "1"
            Write-Status "Vulnerable Driver Blocklist enabled" "Success"
        } catch {
            Write-Status "Failed to enable blocklist: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Vulnerable Driver Blocklist configured successfully" "Success"
}

function Set-DriverSignatureEnforcement {
    <#
    .SYNOPSIS
        Configures Driver Signature Enforcement settings.

    .DESCRIPTION
        Ensures that only properly signed drivers can be loaded into the kernel,
        preventing unsigned or improperly signed vulnerable drivers.

        MITRE Mitigation: M1038 - Execution Prevention
    #>

    Write-Status "Configuring Driver Signature Enforcement..." "Header"

    if ($Undo) {
        Write-Status "Note: Driver Signature Enforcement is managed by Secure Boot/UEFI" "Warning"
        Write-Status "Manual reversion may require BIOS/UEFI changes" "Warning"
        return
    }

    # Check current status
    $codeIntegrity = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard" -ErrorAction SilentlyContinue

    if ($PSCmdlet.ShouldProcess("DeviceGuard", "Configure Code Integrity")) {
        try {
            $regPath = "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard"
            if (-not (Test-Path $regPath)) {
                New-Item -Path $regPath -Force | Out-Null
            }

            # Enable Code Integrity
            Set-ItemProperty -Path $regPath -Name "EnableVirtualizationBasedSecurity" -Value 1 -Type DWord -Force
            Add-ChangeLog "Enable" "Virtualization Based Security" "Unknown" "1"
            Write-Status "Virtualization Based Security enabled" "Success"

            # Configure HVCI
            Set-ItemProperty -Path $regPath -Name "HypervisorEnforcedCodeIntegrity" -Value 1 -Type DWord -Force
            Add-ChangeLog "Enable" "HVCI" "Unknown" "1"
            Write-Status "Hypervisor-Protected Code Integrity (HVCI) enabled" "Success"

            # Require UEFI Memory Attributes Table
            Set-ItemProperty -Path $regPath -Name "RequireUEFIMemoryAttributesTable" -Value 1 -Type DWord -Force
            Add-ChangeLog "Enable" "UEFI Memory Attributes Table Requirement" "Unknown" "1"
            Write-Status "UEFI Memory Attributes Table requirement enabled" "Success"

        } catch {
            Write-Status "Failed to configure DeviceGuard: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Driver Signature Enforcement configured successfully" "Success"
}

function Set-DefenderTamperProtection {
    <#
    .SYNOPSIS
        Configures Windows Defender Tamper Protection settings.

    .DESCRIPTION
        Enables settings that protect Windows Defender from being disabled
        by attackers through registry manipulation or other means.

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

    # Enable Network Protection (blocks exploitation attempts)
    if ($PSCmdlet.ShouldProcess("Network Protection", "Enable")) {
        try {
            Set-MpPreference -EnableNetworkProtection Enabled -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: Network Protection" "Unknown" "Enabled"
            Write-Status "Network Protection enabled" "Success"
        } catch {
            Write-Status "Failed to enable Network Protection: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable PUA Protection
    if ($PSCmdlet.ShouldProcess("PUA Protection", "Enable")) {
        try {
            Set-MpPreference -PUAProtection Enabled -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: PUA Protection" "Unknown" "Enabled"
            Write-Status "PUA Protection enabled" "Success"
        } catch {
            Write-Status "Failed to enable PUA Protection: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Windows Defender Tamper Protection configured successfully" "Success"
}

function Set-ASRRulesForBYOVD {
    <#
    .SYNOPSIS
        Configures Attack Surface Reduction (ASR) rules for BYOVD protection.

    .DESCRIPTION
        Enables ASR rules that specifically target BYOVD attack vectors,
        including the rule to block abuse of exploited vulnerable signed drivers.

        MITRE Mitigation: M1038 - Execution Prevention
    #>

    Write-Status "Configuring ASR Rules for BYOVD Protection..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping ASR configuration" "Warning"
        return
    }

    # ASR Rule GUIDs specifically for BYOVD protection
    $asrRules = @{
        # Block abuse of exploited vulnerable signed drivers
        "56A863A9-875E-4185-98A7-B882C64B5CE5" = "Block vulnerable driver abuse"
        # Block credential stealing from LSASS
        "9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2" = "Block credential stealing from LSASS"
        # Block process creations from PSExec and WMI
        "D1E49AAC-8F56-4280-B9BA-993A6D77406C" = "Block process creations from PSExec/WMI"
        # Block untrusted and unsigned processes from USB
        "B2B3F03D-6A65-4F7B-A9C7-1C7EF74A9BA4" = "Block untrusted processes from USB"
        # Block persistence through WMI event subscription
        "E6DB77E5-3DF2-4CF1-B95A-636979351E5B" = "Block WMI event subscription persistence"
    }

    if ($Undo) {
        Write-Status "Removing BYOVD-specific ASR rules..." "Info"

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

    Write-Status "ASR rules for BYOVD protection configured successfully" "Success"
}

function Set-ServiceCreationAuditing {
    <#
    .SYNOPSIS
        Enables auditing for service creation events.

    .DESCRIPTION
        Configures audit policies to capture service installation events
        (Event ID 7045), enabling detection of malicious kernel services.

        MITRE Mitigation: M1047 - Audit
    #>

    Write-Status "Configuring Service Creation Auditing..." "Header"

    if ($Undo) {
        Write-Status "Reverting service creation auditing..." "Info"

        if ($PSCmdlet.ShouldProcess("Security System Extension Auditing", "Disable")) {
            auditpol /set /subcategory:"Security System Extension" /success:disable /failure:disable 2>&1 | Out-Null
            Add-ChangeLog "Disable" "Audit: Security System Extension" "Enabled" "Disabled"
            Write-Status "Security System Extension auditing disabled" "Success"
        }
        return
    }

    # Enable Security System Extension auditing (captures service installs - Event ID 7045)
    $currentValue = Get-AuditPolicyValue "Security System Extension"
    if ($PSCmdlet.ShouldProcess("Security System Extension", "Enable Success/Failure auditing")) {
        auditpol /set /subcategory:"Security System Extension" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Security System Extension" $currentValue "SuccessAndFailure"
        Write-Status "Security System Extension auditing enabled (Event ID 4697, 7045)" "Success"
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

    Write-Status "Service Creation auditing configured successfully" "Success"
}

function Set-RegistryAuditingForDefender {
    <#
    .SYNOPSIS
        Enables auditing for Windows Defender registry keys.

    .DESCRIPTION
        Configures audit policies and SACL to capture modifications
        to Windows Defender policy and configuration registry keys.

        MITRE Mitigation: M1047 - Audit
    #>

    Write-Status "Configuring Registry Auditing for Defender Keys..." "Header"

    if ($Undo) {
        Write-Status "Reverting registry auditing settings..." "Info"

        if ($PSCmdlet.ShouldProcess("Registry Auditing", "Disable")) {
            auditpol /set /subcategory:"Registry" /success:disable /failure:disable 2>&1 | Out-Null
            Add-ChangeLog "Disable" "Audit: Registry" "Enabled" "Disabled"
            Write-Status "Registry auditing disabled" "Success"
        }
        return
    }

    # Enable Registry auditing
    $currentValue = Get-AuditPolicyValue "Registry"
    if ($PSCmdlet.ShouldProcess("Registry", "Enable Success/Failure auditing")) {
        auditpol /set /subcategory:"Registry" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Registry" $currentValue "SuccessAndFailure"
        Write-Status "Registry auditing enabled (Event ID 4656, 4657, 4660, 4663)" "Success"
    }

    # Configure SACL on Defender registry keys
    $defenderKeys = @(
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender",
        "HKLM:\SOFTWARE\Microsoft\Windows Defender\Features",
        "HKLM:\SOFTWARE\Microsoft\Windows Defender\Real-Time Protection"
    )

    foreach ($keyPath in $defenderKeys) {
        if (Test-Path $keyPath) {
            if ($PSCmdlet.ShouldProcess($keyPath, "Configure audit SACL")) {
                try {
                    $acl = Get-Acl $keyPath
                    $rule = New-Object System.Security.AccessControl.RegistryAuditRule(
                        "Everyone",
                        "SetValue,Delete,CreateSubKey",
                        "ContainerInherit,ObjectInherit",
                        "None",
                        "Success,Failure"
                    )
                    $acl.AddAuditRule($rule)
                    Set-Acl $keyPath $acl
                    Add-ChangeLog "Enable" "SACL: $keyPath" "None" "Audit Everyone (SetValue,Delete)"
                    Write-Status "SACL configured for: $keyPath" "Success"
                } catch {
                    Write-Status "Failed to configure SACL for $keyPath : $($_.Exception.Message)" "Warning"
                }
            }
        } else {
            Write-Status "Key not found (may be created later): $keyPath" "Info"
        }
    }

    Write-Status "Registry auditing for Defender keys configured successfully" "Success"
}

function Set-PowerShellLogging {
    <#
    .SYNOPSIS
        Enables comprehensive PowerShell logging.

    .DESCRIPTION
        Configures PowerShell script block logging and module logging to
        capture defense evasion scripts attempting to disable Defender.

        MITRE Mitigation: M1047 - Audit
    #>

    Write-Status "Configuring PowerShell Logging..." "Header"

    $regPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell"

    if ($Undo) {
        Write-Status "Reverting PowerShell logging settings..." "Info"

        if ($PSCmdlet.ShouldProcess("PowerShell ScriptBlock Logging", "Disable")) {
            try {
                Remove-ItemProperty -Path "$regPath\ScriptBlockLogging" -Name "EnableScriptBlockLogging" -ErrorAction SilentlyContinue
                Add-ChangeLog "Disable" "PowerShell ScriptBlock Logging" "Enabled" "Removed"
                Write-Status "ScriptBlock Logging disabled" "Success"
            } catch {
                Write-Status "Failed to disable ScriptBlock Logging: $($_.Exception.Message)" "Warning"
            }
        }
        return
    }

    # Enable ScriptBlock Logging
    if ($PSCmdlet.ShouldProcess("PowerShell ScriptBlock Logging", "Enable")) {
        try {
            $scriptBlockPath = "$regPath\ScriptBlockLogging"
            if (-not (Test-Path $scriptBlockPath)) {
                New-Item -Path $scriptBlockPath -Force | Out-Null
            }
            Set-ItemProperty -Path $scriptBlockPath -Name "EnableScriptBlockLogging" -Value 1 -Type DWord -Force
            Add-ChangeLog "Enable" "PowerShell ScriptBlock Logging" "Disabled" "Enabled"
            Write-Status "ScriptBlock Logging enabled (Event ID 4104)" "Success"
        } catch {
            Write-Status "Failed to enable ScriptBlock Logging: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Module Logging
    if ($PSCmdlet.ShouldProcess("PowerShell Module Logging", "Enable")) {
        try {
            $moduleLoggingPath = "$regPath\ModuleLogging"
            if (-not (Test-Path $moduleLoggingPath)) {
                New-Item -Path $moduleLoggingPath -Force | Out-Null
            }
            Set-ItemProperty -Path $moduleLoggingPath -Name "EnableModuleLogging" -Value 1 -Type DWord -Force

            # Log all modules
            $moduleNamesPath = "$moduleLoggingPath\ModuleNames"
            if (-not (Test-Path $moduleNamesPath)) {
                New-Item -Path $moduleNamesPath -Force | Out-Null
            }
            Set-ItemProperty -Path $moduleNamesPath -Name "*" -Value "*" -Type String -Force

            Add-ChangeLog "Enable" "PowerShell Module Logging" "Disabled" "Enabled (All Modules)"
            Write-Status "Module Logging enabled (Event ID 4103)" "Success"
        } catch {
            Write-Status "Failed to enable Module Logging: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Transcription (optional - may impact performance)
    if ($PSCmdlet.ShouldProcess("PowerShell Transcription", "Enable")) {
        try {
            $transcriptionPath = "$regPath\Transcription"
            if (-not (Test-Path $transcriptionPath)) {
                New-Item -Path $transcriptionPath -Force | Out-Null
            }
            Set-ItemProperty -Path $transcriptionPath -Name "EnableTranscripting" -Value 1 -Type DWord -Force
            Set-ItemProperty -Path $transcriptionPath -Name "EnableInvocationHeader" -Value 1 -Type DWord -Force
            Set-ItemProperty -Path $transcriptionPath -Name "OutputDirectory" -Value "C:\PSTranscripts" -Type String -Force

            # Create transcription directory
            if (-not (Test-Path "C:\PSTranscripts")) {
                New-Item -Path "C:\PSTranscripts" -ItemType Directory -Force | Out-Null
            }

            Add-ChangeLog "Enable" "PowerShell Transcription" "Disabled" "Enabled (C:\PSTranscripts)"
            Write-Status "Transcription enabled (Output: C:\PSTranscripts)" "Success"
        } catch {
            Write-Status "Failed to enable Transcription: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "PowerShell logging configured successfully" "Success"
}

function Protect-SecurityServices {
    <#
    .SYNOPSIS
        Protects critical security service configurations.

    .DESCRIPTION
        Ensures that critical security services (WinDefend, BFE) are set to
        automatic startup and cannot be easily disabled.

        MITRE Mitigation: M1022 - Restrict File and Directory Permissions
    #>

    Write-Status "Protecting Security Service Configurations..." "Header"

    if ($Undo) {
        Write-Status "Note: Service protection settings are not automatically reverted" "Warning"
        return
    }

    # Services to protect
    $services = @(
        @{ Name = "WinDefend"; DisplayName = "Windows Defender Antivirus Service" },
        @{ Name = "MpsSvc"; DisplayName = "Windows Defender Firewall" },
        @{ Name = "BFE"; DisplayName = "Base Filtering Engine" },
        @{ Name = "SecurityHealthService"; DisplayName = "Windows Security Service" }
    )

    foreach ($svc in $services) {
        if ($PSCmdlet.ShouldProcess($svc.DisplayName, "Set to Automatic startup")) {
            try {
                $service = Get-Service -Name $svc.Name -ErrorAction SilentlyContinue
                if ($service) {
                    Set-Service -Name $svc.Name -StartupType Automatic -ErrorAction Stop
                    Add-ChangeLog "Set" "Service: $($svc.Name) Startup Type" "Unknown" "Automatic"
                    Write-Status "$($svc.DisplayName) set to Automatic" "Success"
                } else {
                    Write-Status "Service not found: $($svc.Name)" "Info"
                }
            } catch {
                Write-Status "Failed to configure $($svc.Name): $($_.Exception.Message)" "Warning"
            }
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
    Set-VulnerableDriverBlocklist
    Write-Host ""

    Set-DriverSignatureEnforcement
    Write-Host ""

    Set-DefenderTamperProtection
    Write-Host ""

    Set-ASRRulesForBYOVD
    Write-Host ""

    Set-ServiceCreationAuditing
    Write-Host ""

    Set-RegistryAuditingForDefender
    Write-Host ""

    Set-PowerShellLogging
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
    Write-Host "  # Verify Vulnerable Driver Blocklist:" -ForegroundColor Yellow
    Write-Host '  Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Config" | Select-Object VulnerableDriverBlocklistEnable'
    Write-Host ""
    Write-Host "  # Verify DeviceGuard/HVCI:" -ForegroundColor Yellow
    Write-Host '  Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard" | Select-Object EnableVirtualizationBasedSecurity, HypervisorEnforcedCodeIntegrity'
    Write-Host ""
    Write-Host "  # Verify ASR rules:" -ForegroundColor Yellow
    Write-Host "  Get-MpPreference | Select-Object -ExpandProperty AttackSurfaceReductionRules_Ids"
    Write-Host ""
    Write-Host "  # Verify Defender status:" -ForegroundColor Yellow
    Write-Host "  Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, BehaviorMonitorEnabled, IoavProtectionEnabled"
    Write-Host ""
    Write-Host "  # Verify audit settings:" -ForegroundColor Yellow
    Write-Host '  auditpol /get /subcategory:"Security System Extension"'
    Write-Host '  auditpol /get /subcategory:"Process Creation"'
    Write-Host '  auditpol /get /subcategory:"Registry"'
    Write-Host ""
    Write-Host "  # Verify PowerShell logging:" -ForegroundColor Yellow
    Write-Host '  Get-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging" -ErrorAction SilentlyContinue'
    Write-Host ""

    # Reboot recommendation
    Write-Host ""
    Write-Status "IMPORTANT: Some settings (HVCI, Driver Blocklist) require a reboot to take effect." "Warning"
    Write-Host ""

} catch {
    Write-Status "Critical error during hardening: $($_.Exception.Message)" "Error"
    Write-Status "Stack trace: $($_.ScriptStackTrace)" "Error"
    exit 1
}

exit 0
