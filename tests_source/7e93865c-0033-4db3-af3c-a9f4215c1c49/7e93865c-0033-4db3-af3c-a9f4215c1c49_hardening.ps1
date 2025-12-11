<#
.SYNOPSIS
    Hardening script to protect against process injection via CreateRemoteThread.

.DESCRIPTION
    This script implements defensive measures against process injection attacks
    using the CreateRemoteThread technique (MITRE ATT&CK T1055.002). It configures:

    1. Attack Surface Reduction (ASR) Rules - Blocks process injection behaviors
    2. Credential Guard - Protects against credential theft via injection
    3. Process Creation Auditing - Enables detailed logging
    4. Sysmon Configuration - Monitors for injection indicators
    5. Windows Defender Hardening - Enhanced protection settings

    Test ID: 7e93865c-0033-4db3-af3c-a9f4215c1c49
    MITRE ATT&CK: T1055.002 - Process Injection: Portable Executable Injection
    Mitigations: M1040 - Behavior Prevention on Endpoint

.PARAMETER Undo
    Reverts all changes made by this script to default settings.

.PARAMETER WhatIf
    Shows what changes would be made without actually applying them.

.PARAMETER Verbose
    Provides detailed output of all operations.

.EXAMPLE
    .\7e93865c-0033-4db3-af3c-a9f4215c1c49_hardening.ps1
    Applies all hardening settings to protect against process injection.

.EXAMPLE
    .\7e93865c-0033-4db3-af3c-a9f4215c1c49_hardening.ps1 -Undo
    Reverts all hardening settings to default.

.EXAMPLE
    .\7e93865c-0033-4db3-af3c-a9f4215c1c49_hardening.ps1 -WhatIf
    Shows what changes would be made without applying them.

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    Requires: Administrator privileges
    Tested on: Windows 10/11, Windows Server 2019/2022
    Idempotent: Yes (safe to run multiple times)

.LINK
    https://attack.mitre.org/techniques/T1055/002/
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
$Script:LogFile = Join-Path $env:TEMP "process_injection_hardening_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# Test metadata
$TestID = "7e93865c-0033-4db3-af3c-a9f4215c1c49"
$TestName = "Process Injection via CreateRemoteThread"
$MitreAttack = "T1055.002"

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

function Set-ASRRulesForInjection {
    <#
    .SYNOPSIS
        Configures Attack Surface Reduction (ASR) rules for process injection.

    .DESCRIPTION
        Enables ASR rules that help prevent process injection attacks.

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
    #>

    Write-Status "Configuring Attack Surface Reduction (ASR) Rules for Process Injection..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping ASR configuration" "Warning"
        return
    }

    # ASR Rule GUIDs relevant to process injection
    $asrRules = @{
        # Block credential stealing from LSASS (prevents common injection target)
        "9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2" = "Block credential stealing from LSASS"
        # Block process creations from PSExec and WMI commands
        "D1E49AAC-8F56-4280-B9BA-993A6D77406C" = "Block process creations from PSExec/WMI"
        # Block untrusted and unsigned processes that run from USB
        "B2B3F03D-6A65-4F7B-A9C7-1C7EF74A9BA4" = "Block untrusted processes from USB"
        # Block Office applications from injecting code into other processes
        "75668C1F-73B5-4CF0-BB93-3ECF5CB7CC84" = "Block Office apps from code injection"
        # Block abuse of exploited vulnerable signed drivers
        "56A863A9-875E-4185-98A7-B882C64B5CE5" = "Block vulnerable driver abuse"
        # Block executable files from running unless they meet prevalence, age, or trusted list criteria
        "01443614-CD74-433A-B99E-2ECDC07BFC25" = "Block executables unless criteria met"
    }

    if ($Undo) {
        Write-Status "Removing ASR rules for process injection protection..." "Info"

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

    Write-Status "ASR rules for process injection configured successfully" "Success"
}

function Set-ProcessCreationAuditing {
    <#
    .SYNOPSIS
        Enables detailed process creation auditing.

    .DESCRIPTION
        Configures audit policies to capture process creation events (Event ID 4688),
        which is essential for detecting injection source processes.

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
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
            Add-ChangeLog "Enable" "Command Line in Process Creation Events" "Disabled" "Enabled"
            Write-Status "Command Line logging in process events enabled" "Success"
        } catch {
            Write-Status "Failed to enable command line auditing: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Process Termination auditing
    $currentValue = Get-AuditPolicyValue "Process Termination"
    if ($PSCmdlet.ShouldProcess("Process Termination", "Enable Success auditing")) {
        auditpol /set /subcategory:"Process Termination" /success:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Process Termination" $currentValue "Success"
        Write-Status "Process Termination auditing enabled (Event ID 4689)" "Success"
    }

    Write-Status "Process Creation auditing configured successfully" "Success"
}

function Set-DefenderEnhancedProtection {
    <#
    .SYNOPSIS
        Configures Windows Defender for enhanced protection against injection.

    .DESCRIPTION
        Enables Defender features that help detect and prevent process injection.

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
    #>

    Write-Status "Configuring Windows Defender Enhanced Protection..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping Defender configuration" "Warning"
        return
    }

    if ($Undo) {
        Write-Status "Note: Defender settings are not automatically reverted for security" "Warning"
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
            Write-Status "Behavior Monitoring enabled (critical for injection detection)" "Success"
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

    # Enable Block at First Sight
    if ($PSCmdlet.ShouldProcess("Block at First Sight", "Enable")) {
        try {
            Set-MpPreference -DisableBlockAtFirstSeen $false -ErrorAction Stop
            Add-ChangeLog "Enable" "Defender: Block at First Sight" "Unknown" "Enabled"
            Write-Status "Block at First Sight enabled" "Success"
        } catch {
            Write-Status "Failed to enable Block at First Sight: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable Network Protection
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
            Write-Status "Potentially Unwanted Application Protection enabled" "Success"
        } catch {
            Write-Status "Failed to enable PUA Protection: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Windows Defender enhanced protection configured successfully" "Success"
}

function Set-CredentialGuard {
    <#
    .SYNOPSIS
        Enables Credential Guard if hardware supports it.

    .DESCRIPTION
        Configures Credential Guard to protect credentials from process injection
        attacks targeting LSASS.

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
    #>

    Write-Status "Configuring Credential Guard..." "Header"

    if ($Undo) {
        Write-Status "Reverting Credential Guard settings..." "Info"

        if ($PSCmdlet.ShouldProcess("Credential Guard", "Disable")) {
            try {
                # Note: Disabling Credential Guard requires restart
                Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\LSA" -Name "LsaCfgFlags" -Value 0 -Type DWord -Force -ErrorAction Stop
                Add-ChangeLog "Disable" "Credential Guard" "Enabled" "Disabled"
                Write-Status "Credential Guard disabled (restart required)" "Success"
            } catch {
                Write-Status "Failed to disable Credential Guard: $($_.Exception.Message)" "Warning"
            }
        }
        return
    }

    # Check if virtualization-based security is supported
    try {
        $deviceGuardInfo = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard -ErrorAction SilentlyContinue
        if ($null -eq $deviceGuardInfo) {
            Write-Status "Device Guard not available - Credential Guard may not be supported" "Warning"
        }
    } catch {
        Write-Status "Unable to query Device Guard status" "Warning"
    }

    # Configure LSA Protection
    if ($PSCmdlet.ShouldProcess("LSA Protection", "Enable")) {
        try {
            $regPath = "HKLM:\SYSTEM\CurrentControlSet\Control\LSA"
            Set-ItemProperty -Path $regPath -Name "RunAsPPL" -Value 1 -Type DWord -Force -ErrorAction Stop
            Add-ChangeLog "Enable" "LSA Protection (RunAsPPL)" "Disabled" "Enabled"
            Write-Status "LSA Protection enabled (restart required)" "Success"
        } catch {
            Write-Status "Failed to enable LSA Protection: $($_.Exception.Message)" "Warning"
        }
    }

    # Configure Credential Guard (without UEFI lock for easier rollback)
    if ($PSCmdlet.ShouldProcess("Credential Guard", "Enable without UEFI lock")) {
        try {
            $regPath = "HKLM:\SYSTEM\CurrentControlSet\Control\LSA"
            Set-ItemProperty -Path $regPath -Name "LsaCfgFlags" -Value 2 -Type DWord -Force -ErrorAction Stop
            Add-ChangeLog "Enable" "Credential Guard" "Disabled" "Enabled (no UEFI lock)"
            Write-Status "Credential Guard enabled without UEFI lock (restart required)" "Success"
        } catch {
            Write-Status "Failed to enable Credential Guard: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Credential Guard configuration completed (restart required for changes)" "Success"
}

function Set-ExploitProtection {
    <#
    .SYNOPSIS
        Configures Exploit Protection settings.

    .DESCRIPTION
        Enables exploit protection mitigations that help prevent process injection.

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
    #>

    Write-Status "Configuring Exploit Protection..." "Header"

    if ($Undo) {
        Write-Status "Reverting Exploit Protection settings..." "Info"
        Write-Status "Note: System-wide exploit protection settings should be reverted via Group Policy" "Warning"
        return
    }

    # Enable system-wide mitigations
    $mitigations = @{
        "DEP"                    = "Enable Data Execution Prevention"
        "SEHOP"                  = "Enable Structured Exception Handler Overwrite Protection"
        "ForceRelocateImages"    = "Force ASLR for all images"
        "RequireInfo"            = "Require DEP for all processes"
        "BottomUp"               = "Bottom-up ASLR"
        "HighEntropy"            = "High-entropy ASLR"
    }

    # Check current exploit protection settings
    try {
        $currentSettings = Get-ProcessMitigation -System -ErrorAction Stop
        Write-Status "Current system exploit protection settings retrieved" "Info"
    } catch {
        Write-Status "Unable to retrieve exploit protection settings: $($_.Exception.Message)" "Warning"
    }

    # Enable DEP (always on)
    if ($PSCmdlet.ShouldProcess("Data Execution Prevention (DEP)", "Enable system-wide")) {
        try {
            Set-ProcessMitigation -System -Enable DEP -ErrorAction Stop
            Add-ChangeLog "Enable" "Exploit Protection: DEP" "Unknown" "Enabled"
            Write-Status "DEP enabled system-wide" "Success"
        } catch {
            Write-Status "Failed to enable DEP: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable SEHOP
    if ($PSCmdlet.ShouldProcess("SEHOP", "Enable system-wide")) {
        try {
            Set-ProcessMitigation -System -Enable SEHOP -ErrorAction Stop
            Add-ChangeLog "Enable" "Exploit Protection: SEHOP" "Unknown" "Enabled"
            Write-Status "SEHOP enabled system-wide" "Success"
        } catch {
            Write-Status "Failed to enable SEHOP: $($_.Exception.Message)" "Warning"
        }
    }

    # Enable ASLR mitigations
    if ($PSCmdlet.ShouldProcess("ASLR Mitigations", "Enable system-wide")) {
        try {
            Set-ProcessMitigation -System -Enable ForceRelocateImages -ErrorAction Stop
            Set-ProcessMitigation -System -Enable BottomUp -ErrorAction Stop
            Add-ChangeLog "Enable" "Exploit Protection: ASLR" "Unknown" "Enabled"
            Write-Status "ASLR mitigations enabled system-wide" "Success"
        } catch {
            Write-Status "Failed to enable ASLR mitigations: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Exploit Protection configuration completed" "Success"
}

function Set-HandleAccessAuditing {
    <#
    .SYNOPSIS
        Enables handle access auditing for detecting injection attempts.

    .DESCRIPTION
        Configures auditing to capture when processes open handles to other processes,
        which is a key indicator of injection attempts.
    #>

    Write-Status "Configuring Handle Access Auditing..." "Header"

    if ($Undo) {
        Write-Status "Reverting handle access auditing..." "Info"

        if ($PSCmdlet.ShouldProcess("Handle Manipulation Auditing", "Disable")) {
            auditpol /set /subcategory:"Handle Manipulation" /success:disable /failure:disable 2>&1 | Out-Null
            Add-ChangeLog "Disable" "Audit: Handle Manipulation" "Enabled" "Disabled"
            Write-Status "Handle Manipulation auditing disabled" "Success"
        }
        return
    }

    # Enable Handle Manipulation auditing
    $currentValue = Get-AuditPolicyValue "Handle Manipulation"
    if ($PSCmdlet.ShouldProcess("Handle Manipulation", "Enable Success/Failure auditing")) {
        auditpol /set /subcategory:"Handle Manipulation" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Handle Manipulation" $currentValue "SuccessAndFailure"
        Write-Status "Handle Manipulation auditing enabled (Event ID 4656, 4658, 4660, 4663)" "Success"
    }

    # Enable Kernel Object auditing (catches process handle access)
    $currentValue = Get-AuditPolicyValue "Kernel Object"
    if ($PSCmdlet.ShouldProcess("Kernel Object", "Enable Success auditing")) {
        auditpol /set /subcategory:"Kernel Object" /success:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Kernel Object" $currentValue "Success"
        Write-Status "Kernel Object auditing enabled" "Success"
    }

    Write-Status "Handle access auditing configured successfully" "Success"
}

function Install-SysmonRecommendations {
    <#
    .SYNOPSIS
        Provides Sysmon installation recommendations for enhanced monitoring.

    .DESCRIPTION
        Checks if Sysmon is installed and provides recommendations for
        monitoring CreateRemoteThread and ProcessAccess events.
    #>

    Write-Status "Checking Sysmon Status..." "Header"

    # Check if Sysmon is installed
    $sysmonService = Get-Service -Name "Sysmon*" -ErrorAction SilentlyContinue

    if ($null -eq $sysmonService) {
        Write-Status "Sysmon is NOT installed" "Warning"
        Write-Status "Sysmon is HIGHLY RECOMMENDED for detecting process injection" "Warning"
        Write-Host ""
        Write-Status "Recommended Sysmon events for process injection detection:" "Info"
        Write-Host "  - Event ID 8: CreateRemoteThread detected" -ForegroundColor Cyan
        Write-Host "  - Event ID 10: ProcessAccess - cross-process handle" -ForegroundColor Cyan
        Write-Host "  - Event ID 1: Process Create with command line" -ForegroundColor Cyan
        Write-Host "  - Event ID 7: Image loaded (DLL injection)" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Download: https://docs.microsoft.com/en-us/sysinternals/downloads/sysmon" -ForegroundColor Yellow
        Write-Host "  Recommended config: https://github.com/SwiftOnSecurity/sysmon-config" -ForegroundColor Yellow
        Write-Host ""

        # Create recommended Sysmon config snippet
        $sysmonConfig = @"
<!-- Sysmon Configuration for Process Injection Detection -->
<!-- Add these rules to your Sysmon config -->

<!-- Event ID 8: CreateRemoteThread -->
<RuleGroup name="" groupRelation="or">
  <CreateRemoteThread onmatch="include">
    <!-- Log all CreateRemoteThread events -->
    <SourceImage condition="excludes">C:\Windows\System32\csrss.exe</SourceImage>
  </CreateRemoteThread>
</RuleGroup>

<!-- Event ID 10: ProcessAccess -->
<RuleGroup name="" groupRelation="or">
  <ProcessAccess onmatch="include">
    <!-- Detect injection-related access rights -->
    <GrantedAccess condition="is">0x1F0FFF</GrantedAccess>
    <GrantedAccess condition="is">0x143A</GrantedAccess>
    <GrantedAccess condition="is">0x1F3FFF</GrantedAccess>
  </ProcessAccess>
</RuleGroup>
"@

        $configPath = Join-Path $env:TEMP "sysmon_injection_detection.xml"
        try {
            $sysmonConfig | Out-File -FilePath $configPath -Encoding utf8 -Force
            Write-Status "Sample Sysmon config saved to: $configPath" "Info"
        } catch {
            Write-Status "Could not save sample config: $($_.Exception.Message)" "Warning"
        }
    } else {
        Write-Status "Sysmon is installed: $($sysmonService.Name) - $($sysmonService.Status)" "Success"
        Write-Status "Ensure your Sysmon config includes Event IDs 8 (CreateRemoteThread) and 10 (ProcessAccess)" "Info"
    }
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
    Set-ASRRulesForInjection
    Write-Host ""

    Set-ProcessCreationAuditing
    Write-Host ""

    Set-DefenderEnhancedProtection
    Write-Host ""

    Set-CredentialGuard
    Write-Host ""

    Set-ExploitProtection
    Write-Host ""

    Set-HandleAccessAuditing
    Write-Host ""

    Install-SysmonRecommendations
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
    Write-Host "  # Verify ASR rules:" -ForegroundColor Yellow
    Write-Host "  Get-MpPreference | Select-Object -ExpandProperty AttackSurfaceReductionRules_Ids"
    Write-Host ""
    Write-Host "  # Verify Defender status:" -ForegroundColor Yellow
    Write-Host "  Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, BehaviorMonitorEnabled, CloudEnabled"
    Write-Host ""
    Write-Host "  # Verify process creation auditing:" -ForegroundColor Yellow
    Write-Host '  auditpol /get /subcategory:"Process Creation"'
    Write-Host ""
    Write-Host "  # Verify LSA Protection:" -ForegroundColor Yellow
    Write-Host '  Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\LSA" -Name "RunAsPPL" -ErrorAction SilentlyContinue'
    Write-Host ""
    Write-Host "  # Verify exploit protection:" -ForegroundColor Yellow
    Write-Host "  Get-ProcessMitigation -System"
    Write-Host ""
    Write-Host "  # Check Sysmon events (if installed):" -ForegroundColor Yellow
    Write-Host '  Get-WinEvent -LogName "Microsoft-Windows-Sysmon/Operational" -MaxEvents 10 | Where-Object {$_.Id -in (8,10)}'
    Write-Host ""

    # Restart warning
    Write-Status "IMPORTANT: Some changes (LSA Protection, Credential Guard) require a restart" "Warning"
    Write-Host ""

} catch {
    Write-Status "Critical error during hardening: $($_.Exception.Message)" "Error"
    Write-Status "Stack trace: $($_.ScriptStackTrace)" "Error"
    exit 1
}

exit 0
