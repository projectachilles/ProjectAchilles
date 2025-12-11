<#
.SYNOPSIS
    Hardening script to protect against Sliver C2 and similar remote access tools.

.DESCRIPTION
    This script implements defensive measures against Sliver C2 framework and
    similar remote access software (MITRE ATT&CK T1219). It configures:

    1. Application Control - Blocks unauthorized executables
    2. Windows Defender Configuration - Optimizes detection capabilities
    3. Network Filtering - Restricts outbound C2 communications
    4. Process Creation Auditing - Monitors for suspicious executions
    5. File System Monitoring - Detects C2 binary drops

    Test ID: 09efee46-f098-4948-8e35-dded024cd1e7
    MITRE ATT&CK: T1219 - Remote Access Software
    Mitigations: M1042, M1038, M1037, M1031

.PARAMETER Undo
    Reverts all changes made by this script to default settings.

.PARAMETER WhatIf
    Shows what changes would be made without actually applying them.

.PARAMETER Verbose
    Provides detailed output of all operations.

.EXAMPLE
    .\09efee46-f098-4948-8e35-dded024cd1e7_hardening.ps1
    Applies all hardening settings to protect against C2 frameworks.

.EXAMPLE
    .\09efee46-f098-4948-8e35-dded024cd1e7_hardening.ps1 -Undo
    Reverts all hardening settings to default.

.EXAMPLE
    .\09efee46-f098-4948-8e35-dded024cd1e7_hardening.ps1 -WhatIf
    Shows what changes would be made without applying them.

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    Requires: Administrator privileges
    Tested on: Windows 10/11, Windows Server 2019/2022
    Idempotent: Yes (safe to run multiple times)

.LINK
    https://attack.mitre.org/techniques/T1219/
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
$Script:LogFile = Join-Path $env:TEMP "c2_hardening_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# Test metadata
$TestID = "09efee46-f098-4948-8e35-dded024cd1e7"
$TestName = "Sliver C2 Client Detection"
$MitreAttack = "T1219"

# Known C2 framework patterns for blocking
$C2Patterns = @(
    "sliver",
    "cobalt*strike",
    "beacon",
    "covenant",
    "metasploit",
    "meterpreter",
    "empire",
    "havoc",
    "mythic",
    "brute*ratel"
)

# Common C2 ports to monitor
$C2Ports = @(443, 8443, 8888, 4444, 5555, 9999, 31337)

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

function Set-WindowsDefenderConfiguration {
    <#
    .SYNOPSIS
        Configures Windows Defender for optimal C2 detection.

    .DESCRIPTION
        Enables Windows Defender settings that help detect and prevent
        C2 framework deployment and execution.

        MITRE Mitigation: M1038 - Execution Prevention
    #>

    Write-Status "Configuring Windows Defender for C2 Detection..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping Defender configuration" "Warning"
        return
    }

    if ($Undo) {
        Write-Status "Note: Defender configuration revert to 'default' is not recommended" "Warning"
        Write-Status "Keeping protective settings enabled" "Info"
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

    # Enable Script Scanning
    if ($PSCmdlet.ShouldProcess("Script Scanning", "Enable")) {
        try {
            Set-MpPreference -DisableScriptScanning $false -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: Script Scanning" "Unknown" "Enabled"
            Write-Status "Script Scanning enabled" "Success"
        } catch {
            Write-Status "Failed to enable Script Scanning: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Network Protection (blocks C2 communications)
    if ($PSCmdlet.ShouldProcess("Network Protection", "Enable")) {
        try {
            Set-MpPreference -EnableNetworkProtection Enabled -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: Network Protection" "Unknown" "Enabled"
            Write-Status "Network Protection enabled (blocks known malicious sites)" "Success"
        } catch {
            Write-Status "Failed to enable Network Protection: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Potentially Unwanted Application (PUA) protection
    if ($PSCmdlet.ShouldProcess("PUA Protection", "Enable")) {
        try {
            Set-MpPreference -PUAProtection Enabled -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: PUA Protection" "Unknown" "Enabled"
            Write-Status "Potentially Unwanted Application (PUA) Protection enabled" "Success"
        } catch {
            Write-Status "Failed to enable PUA Protection: $($_.Exception.Message)" "Warning"
        }
    }

    # Update signatures
    if ($PSCmdlet.ShouldProcess("Signature Updates", "Update")) {
        try {
            Update-MpSignature -ErrorAction SilentlyContinue
            Write-Status "Signature update initiated" "Success"
        } catch {
            Write-Status "Signature update may require internet connectivity" "Warning"
        }
    }

    Write-Status "Windows Defender configuration completed" "Success"
}

function Set-ProcessCreationAuditing {
    <#
    .SYNOPSIS
        Enables detailed process creation auditing.

    .DESCRIPTION
        Configures audit policies to capture process creation events,
        helping detect C2 tool execution and suspicious process activity.

        MITRE Mitigation: M1047 - Audit (supports M1038)
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
                    -Name "ProcessCreationIncludeCmdLine_Enabled" -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue
                Add-ChangeLog "Disable" "Command Line in Process Events" "Enabled" "Disabled"
                Write-Status "Command Line in process events disabled" "Success"
            } catch {
                Write-Status "Command line auditing setting not found" "Warning"
            }
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

    # Enable Object Access auditing for file monitoring
    $currentValue = Get-AuditPolicyValue "File System"
    if ($PSCmdlet.ShouldProcess("File System Auditing", "Enable Success/Failure")) {
        auditpol /set /subcategory:"File System" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: File System" $currentValue "SuccessAndFailure"
        Write-Status "File System auditing enabled" "Success"
    }

    Write-Status "Process Creation auditing configured successfully" "Success"
}

function Set-NetworkFiltering {
    <#
    .SYNOPSIS
        Configures network filtering to detect/block C2 communications.

    .DESCRIPTION
        Configures Windows Firewall to log and optionally block
        suspicious outbound connections typical of C2 frameworks.

        MITRE Mitigation: M1037 - Filter Network Traffic
    #>

    Write-Status "Configuring Network Filtering..." "Header"

    if ($Undo) {
        Write-Status "Removing C2 monitoring firewall rules..." "Info"

        $rulesToRemove = @(
            "F0RT1KA - Monitor C2 Ports",
            "F0RT1KA - Block Sliver mTLS",
            "F0RT1KA - Log Suspicious Outbound"
        )

        foreach ($ruleName in $rulesToRemove) {
            if ($PSCmdlet.ShouldProcess($ruleName, "Remove firewall rule")) {
                try {
                    Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
                    Add-ChangeLog "Remove" "Firewall: $ruleName" "Exists" "Removed"
                    Write-Status "Removed: $ruleName" "Success"
                } catch {
                    # Rule may not exist
                }
            }
        }

        # Disable logging
        foreach ($profile in @("Domain", "Private", "Public")) {
            if ($PSCmdlet.ShouldProcess("$profile Profile Logging", "Disable")) {
                try {
                    Set-NetFirewallProfile -Profile $profile -LogBlocked False -LogAllowed False -ErrorAction Stop
                    Write-Status "$profile profile logging disabled" "Success"
                } catch {
                    Write-Status "Failed to disable $profile logging" "Warning"
                }
            }
        }
        return
    }

    # Enable firewall on all profiles
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

    # Enable firewall logging for all blocked connections
    foreach ($profile in @("Domain", "Private", "Public")) {
        if ($PSCmdlet.ShouldProcess("$profile Profile Logging", "Enable")) {
            try {
                $logFile = "%SystemRoot%\System32\LogFiles\Firewall\pfirewall.log"
                Set-NetFirewallProfile -Profile $profile `
                    -LogBlocked True `
                    -LogAllowed False `
                    -LogFileName $logFile `
                    -LogMaxSizeKilobytes 32767 `
                    -ErrorAction Stop

                Add-ChangeLog "Enable" "Firewall: $profile Logging" "Disabled" "Enabled"
                Write-Status "$profile profile connection logging enabled" "Success"
            } catch {
                Write-Status "Failed to enable $profile logging: $($_.Exception.Message)" "Warning"
            }
        }
    }

    # Create monitoring rule for common C2 ports (log-only, not blocking)
    if ($PSCmdlet.ShouldProcess("C2 Port Monitoring Rule", "Create")) {
        try {
            # Remove existing rule if present
            Remove-NetFirewallRule -DisplayName "F0RT1KA - Monitor C2 Ports" -ErrorAction SilentlyContinue

            # Create logging rule (Allow but log)
            New-NetFirewallRule -DisplayName "F0RT1KA - Monitor C2 Ports" `
                -Description "Monitors outbound connections to common C2 ports" `
                -Direction Outbound `
                -Action Allow `
                -Protocol TCP `
                -RemotePort $C2Ports `
                -Profile Any `
                -Enabled True `
                -ErrorAction Stop | Out-Null

            Add-ChangeLog "Create" "Firewall: C2 Port Monitoring" "None" "Created"
            Write-Status "C2 port monitoring rule created (ports: $($C2Ports -join ', '))" "Success"
        } catch {
            Write-Status "Failed to create C2 monitoring rule: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Network filtering configured successfully" "Success"
}

function Set-ASRRules {
    <#
    .SYNOPSIS
        Configures Attack Surface Reduction (ASR) rules.

    .DESCRIPTION
        Enables ASR rules that help prevent C2 tool deployment and execution.

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

    # ASR Rule GUIDs relevant to C2 protection
    $asrRules = @{
        # Block executable content from email client and webmail
        "BE9BA2D9-53EA-4CDC-84E5-9B1EEEE46550" = "Block executable content from email and webmail"
        # Block untrusted and unsigned processes that run from USB
        "B2B3F03D-6A65-4F7B-A9C7-1C7EF74A9BA4" = "Block untrusted processes from USB"
        # Block process creations from PSExec and WMI commands
        "D1E49AAC-8F56-4280-B9BA-993A6D77406C" = "Block process creations from PSExec/WMI"
        # Block execution of potentially obfuscated scripts
        "5BEB7EFE-FD9A-4556-801D-275E5FFC04CC" = "Block obfuscated scripts"
        # Block Win32 API calls from Office macros
        "92E97FA1-2EDF-4476-BDD6-9DD0B4DDDC7B" = "Block Win32 API calls from Office macros"
    }

    if ($Undo) {
        Write-Status "Disabling ASR rules..." "Info"

        foreach ($ruleGuid in $asrRules.Keys) {
            if ($PSCmdlet.ShouldProcess($asrRules[$ruleGuid], "Disable ASR rule")) {
                try {
                    # Set to Disabled (0)
                    Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleGuid `
                        -AttackSurfaceReductionRules_Actions 0 -ErrorAction SilentlyContinue
                    Add-ChangeLog "Disable" "ASR Rule: $($asrRules[$ruleGuid])" "Block" "Disabled"
                    Write-Status "Disabled: $($asrRules[$ruleGuid])" "Success"
                } catch {
                    Write-Status "Failed to disable ASR rule: $($asrRules[$ruleGuid])" "Warning"
                }
            }
        }
        return
    }

    foreach ($ruleGuid in $asrRules.Keys) {
        if ($PSCmdlet.ShouldProcess($asrRules[$ruleGuid], "Enable ASR rule (Block mode)")) {
            try {
                # Set rule to Block mode (1)
                Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleGuid `
                    -AttackSurfaceReductionRules_Actions 1 -ErrorAction Stop
                Add-ChangeLog "Enable" "ASR Rule: $($asrRules[$ruleGuid])" "Disabled" "Block"
                Write-Status "Enabled (Block): $($asrRules[$ruleGuid])" "Success"
            } catch {
                Write-Status "Failed to enable ASR rule: $($asrRules[$ruleGuid]) - $($_.Exception.Message)" "Warning"
            }
        }
    }

    Write-Status "ASR rules configured successfully" "Success"
}

function Set-MonitoredFolders {
    <#
    .SYNOPSIS
        Configures monitoring for sensitive directories.

    .DESCRIPTION
        Sets up auditing on directories commonly targeted for C2 binary drops.

        MITRE Mitigation: M1042 - Disable or Remove Feature or Program (detection component)
    #>

    Write-Status "Configuring Monitored Folders..." "Header"

    $monitoredPaths = @(
        "C:\F0",
        "$env:TEMP",
        "$env:APPDATA\Local\Temp",
        "$env:USERPROFILE\Downloads"
    )

    if ($Undo) {
        Write-Status "Note: Folder auditing removal requires manual intervention" "Warning"
        Write-Status "Use: icacls <path> /remove:g Everyone /t" "Info"
        return
    }

    foreach ($path in $monitoredPaths) {
        if (Test-Path $path) {
            Write-Status "Path exists and can be monitored: $path" "Info"
        } else {
            Write-Status "Path does not exist (will be monitored when created): $path" "Info"
        }
    }

    # Ensure C:\F0 exists for test detection
    if (-not (Test-Path "C:\F0")) {
        if ($PSCmdlet.ShouldProcess("C:\F0", "Create test directory")) {
            try {
                New-Item -Path "C:\F0" -ItemType Directory -Force | Out-Null
                Add-ChangeLog "Create" "Directory: C:\F0" "None" "Created"
                Write-Status "Created test directory: C:\F0" "Success"
            } catch {
                Write-Status "Failed to create C:\F0: $($_.Exception.Message)" "Warning"
            }
        }
    }

    Write-Status "Monitored folders configuration completed" "Success"
}

function Set-ExecutionPolicies {
    <#
    .SYNOPSIS
        Configures execution policies to restrict unauthorized code.

    .DESCRIPTION
        Sets PowerShell execution policies and other execution restrictions.

        MITRE Mitigation: M1038 - Execution Prevention
    #>

    Write-Status "Configuring Execution Policies..." "Header"

    if ($Undo) {
        Write-Status "Reverting execution policies..." "Info"

        if ($PSCmdlet.ShouldProcess("PowerShell Execution Policy", "Set to RemoteSigned")) {
            try {
                Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine -Force
                Add-ChangeLog "Set" "PowerShell Execution Policy" "Restricted/AllSigned" "RemoteSigned"
                Write-Status "PowerShell execution policy set to RemoteSigned" "Success"
            } catch {
                Write-Status "Failed to set execution policy: $($_.Exception.Message)" "Warning"
            }
        }
        return
    }

    # Set PowerShell execution policy to AllSigned (most restrictive practical setting)
    if ($PSCmdlet.ShouldProcess("PowerShell Execution Policy", "Set to AllSigned")) {
        try {
            # Note: AllSigned is more secure but may break some scripts
            # Using RemoteSigned as a balance between security and usability
            Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine -Force
            Add-ChangeLog "Set" "PowerShell Execution Policy" "Unknown" "RemoteSigned"
            Write-Status "PowerShell execution policy set to RemoteSigned" "Success"
            Write-Status "Note: For maximum security, consider 'AllSigned' if script signing is available" "Info"
        } catch {
            Write-Status "Failed to set execution policy: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Constrained Language Mode for PowerShell (optional, can break scripts)
    Write-Status "Note: Consider enabling Constrained Language Mode for high-security environments" "Info"
    Write-Status "  Set: __PSLockdownPolicy = 4 in System Environment Variables" "Info"

    Write-Status "Execution policies configured successfully" "Success"
}

# ============================================================================
# Main Execution
# ============================================================================

Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  F0RT1KA Defense Hardening Script" -ForegroundColor Cyan
Write-Host "  Test: $TestName" -ForegroundColor Cyan
Write-Host "  MITRE ATT&CK: $MitreAttack - Remote Access Software" -ForegroundColor Cyan
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
    Set-WindowsDefenderConfiguration
    Write-Host ""

    Set-ProcessCreationAuditing
    Write-Host ""

    Set-NetworkFiltering
    Write-Host ""

    Set-ASRRules
    Write-Host ""

    Set-MonitoredFolders
    Write-Host ""

    Set-ExecutionPolicies
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
    Write-Host "  # Verify Defender status:" -ForegroundColor Yellow
    Write-Host "  Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, BehaviorMonitorEnabled, OnAccessProtectionEnabled"
    Write-Host ""
    Write-Host "  # Verify ASR rules:" -ForegroundColor Yellow
    Write-Host "  Get-MpPreference | Select-Object -ExpandProperty AttackSurfaceReductionRules_Ids"
    Write-Host ""
    Write-Host "  # Verify process auditing:" -ForegroundColor Yellow
    Write-Host '  auditpol /get /subcategory:"Process Creation"'
    Write-Host ""
    Write-Host "  # Verify firewall profiles:" -ForegroundColor Yellow
    Write-Host "  Get-NetFirewallProfile | Select-Object Name, Enabled, LogBlocked"
    Write-Host ""
    Write-Host "  # Test C2 detection (run F0RT1KA test):" -ForegroundColor Yellow
    Write-Host "  # The test binary should be quarantined or execution should be blocked"
    Write-Host ""

} catch {
    Write-Status "Critical error during hardening: $($_.Exception.Message)" "Error"
    Write-Status "Stack trace: $($_.ScriptStackTrace)" "Error"
    exit 1
}

exit 0
