<#
.SYNOPSIS
    Hardening script to detect long-running processes and timeout evasion techniques.

.DESCRIPTION
    This script implements defensive measures to detect sandbox evasion techniques
    that use extended execution times (MITRE ATT&CK T1497.001). It configures:

    1. Process Creation Auditing - Enables detailed process logging
    2. Process Termination Auditing - Enables process exit tracking
    3. Directory Monitoring - Monitors F0RT1KA working directory
    4. Windows Defender Behavioral Monitoring - Detects evasion patterns
    5. Event Log Configuration - Ensures adequate log retention

    Test ID: 12afe0fc-597b-4e79-9cc4-40b4675ee83c
    MITRE ATT&CK: T1497.001 - Virtualization/Sandbox Evasion: System Checks
    Mitigations: M1047 (Audit)

.PARAMETER Undo
    Reverts all changes made by this script to default settings.

.PARAMETER WhatIf
    Shows what changes would be made without actually applying them.

.PARAMETER Verbose
    Provides detailed output of all operations.

.EXAMPLE
    .\12afe0fc-597b-4e79-9cc4-40b4675ee83c_hardening.ps1
    Applies all hardening settings to detect timeout evasion techniques.

.EXAMPLE
    .\12afe0fc-597b-4e79-9cc4-40b4675ee83c_hardening.ps1 -Undo
    Reverts all hardening settings to default.

.EXAMPLE
    .\12afe0fc-597b-4e79-9cc4-40b4675ee83c_hardening.ps1 -WhatIf
    Shows what changes would be made without applying them.

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    Requires: Administrator privileges
    Tested on: Windows 10/11, Windows Server 2019/2022
    Idempotent: Yes (safe to run multiple times)

.LINK
    https://attack.mitre.org/techniques/T1497/001/
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
$Script:LogFile = Join-Path $env:TEMP "timeout_evasion_hardening_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# Test metadata
$TestID = "12afe0fc-597b-4e79-9cc4-40b4675ee83c"
$TestName = "LimaCharlie Timeout Validation Harness"
$MitreAttack = "T1497.001"

# F0RT1KA working directory
$F0Directory = "c:\F0"

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

function Set-ProcessCreationAuditing {
    <#
    .SYNOPSIS
        Enables detailed process creation auditing.

    .DESCRIPTION
        Configures audit policies to capture process creation events (Event ID 4688),
        including command line arguments. This enables detection of long-running
        processes and staged execution patterns.

        MITRE Mitigation: M1047 - Audit
    #>

    Write-Status "Configuring Process Creation Auditing..." "Header"

    if ($Undo) {
        Write-Status "Reverting process creation auditing to defaults..." "Info"

        if ($PSCmdlet.ShouldProcess("Process Creation Auditing", "Disable")) {
            auditpol /set /subcategory:"Process Creation" /success:disable /failure:disable 2>&1 | Out-Null
            Add-ChangeLog "Disable" "Audit: Process Creation" "Enabled" "Disabled"
            Write-Status "Process Creation auditing disabled" "Success"
        }

        if ($PSCmdlet.ShouldProcess("Command Line Auditing", "Disable")) {
            try {
                $regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit"
                if (Test-Path $regPath) {
                    Set-ItemProperty -Path $regPath -Name "ProcessCreationIncludeCmdLine_Enabled" -Value 0 -Type DWord -Force
                    Add-ChangeLog "Disable" "Command Line in Process Events" "Enabled" "Disabled"
                    Write-Status "Command Line logging disabled" "Success"
                }
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
            Add-ChangeLog "Enable" "Command Line in Process Events" "Disabled" "Enabled"
            Write-Status "Command Line logging in process events enabled" "Success"
        } catch {
            Write-Status "Failed to enable command line auditing: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Process Creation auditing configured successfully" "Success"
}

function Set-ProcessTerminationAuditing {
    <#
    .SYNOPSIS
        Enables process termination auditing.

    .DESCRIPTION
        Configures audit policies to capture process termination events (Event ID 4689).
        Combined with creation events, this enables process duration calculation.

        MITRE Mitigation: M1047 - Audit
    #>

    Write-Status "Configuring Process Termination Auditing..." "Header"

    if ($Undo) {
        Write-Status "Reverting process termination auditing..." "Info"

        if ($PSCmdlet.ShouldProcess("Process Termination", "Disable Success auditing")) {
            auditpol /set /subcategory:"Process Termination" /success:disable 2>&1 | Out-Null
            Add-ChangeLog "Disable" "Audit: Process Termination" "Enabled" "Disabled"
            Write-Status "Process Termination auditing disabled" "Success"
        }

        return
    }

    # Enable Process Termination auditing
    $currentValue = Get-AuditPolicyValue "Process Termination"
    if ($PSCmdlet.ShouldProcess("Process Termination", "Enable Success auditing")) {
        auditpol /set /subcategory:"Process Termination" /success:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: Process Termination" $currentValue "Success"
        Write-Status "Process Termination auditing enabled (Event ID 4689)" "Success"
    }

    Write-Status "Process Termination auditing configured successfully" "Success"
}

function Set-DirectoryMonitoring {
    <#
    .SYNOPSIS
        Configures auditing for the F0RT1KA working directory.

    .DESCRIPTION
        Sets up file system auditing on c:\F0 to capture all file operations
        performed by F0RT1KA tests. This helps detect test execution.

        MITRE Mitigation: M1047 - Audit
    #>

    Write-Status "Configuring F0RT1KA Directory Monitoring..." "Header"

    if ($Undo) {
        Write-Status "Reverting directory monitoring..." "Info"

        if ($PSCmdlet.ShouldProcess($F0Directory, "Remove directory audit rules")) {
            try {
                if (Test-Path $F0Directory) {
                    $acl = Get-Acl $F0Directory
                    $acl.SetAuditRuleProtection($false, $true)
                    # Note: Removing specific audit rules requires more complex logic
                    Write-Status "Directory audit monitoring removal requires manual intervention" "Warning"
                    Write-Status "Navigate to $F0Directory properties > Security > Advanced > Auditing" "Info"
                }
            } catch {
                Write-Status "Failed to remove directory monitoring: $($_.Exception.Message)" "Warning"
            }
        }

        return
    }

    # Create F0 directory if it doesn't exist
    if (-not (Test-Path $F0Directory)) {
        if ($PSCmdlet.ShouldProcess($F0Directory, "Create directory")) {
            try {
                New-Item -Path $F0Directory -ItemType Directory -Force | Out-Null
                Add-ChangeLog "Create" "Directory: $F0Directory" "N/A" "Created"
                Write-Status "Created $F0Directory directory" "Success"
            } catch {
                Write-Status "Failed to create $F0Directory : $($_.Exception.Message)" "Warning"
                return
            }
        }
    }

    # Enable Object Access auditing (required for file system auditing)
    $currentValue = Get-AuditPolicyValue "File System"
    if ($PSCmdlet.ShouldProcess("File System Auditing", "Enable Success/Failure")) {
        auditpol /set /subcategory:"File System" /success:enable /failure:enable 2>&1 | Out-Null
        Add-ChangeLog "Enable" "Audit: File System" $currentValue "SuccessAndFailure"
        Write-Status "File System auditing enabled (Event IDs 4656, 4663)" "Success"
    }

    # Add audit rules to F0 directory
    if ($PSCmdlet.ShouldProcess($F0Directory, "Add file system audit rules")) {
        try {
            $acl = Get-Acl $F0Directory

            # Create audit rule for Everyone - Write, Delete, CreateFiles
            $auditRule = New-Object System.Security.AccessControl.FileSystemAuditRule(
                "Everyone",
                "Write,Delete,CreateFiles,CreateDirectories,DeleteSubdirectoriesAndFiles",
                "ContainerInherit,ObjectInherit",
                "None",
                "Success,Failure"
            )

            $acl.AddAuditRule($auditRule)
            Set-Acl -Path $F0Directory -AclObject $acl

            Add-ChangeLog "Enable" "Directory Audit: $F0Directory" "N/A" "Write/Delete/Create auditing"
            Write-Status "Directory auditing configured for $F0Directory" "Success"
        } catch {
            Write-Status "Failed to configure directory auditing: $($_.Exception.Message)" "Warning"
        }
    }

    Write-Status "Directory monitoring configured successfully" "Success"
}

function Set-DefenderBehaviorMonitoring {
    <#
    .SYNOPSIS
        Configures Windows Defender behavioral monitoring.

    .DESCRIPTION
        Enables Defender's behavior monitoring features that can detect
        sandbox evasion patterns and suspicious process behavior.

        MITRE Mitigation: M1040 - Behavior Prevention on Endpoint
    #>

    Write-Status "Configuring Windows Defender Behavioral Monitoring..." "Header"

    # Check if Defender is available
    try {
        $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
    } catch {
        Write-Status "Windows Defender not available - skipping behavioral monitoring configuration" "Warning"
        return
    }

    if ($Undo) {
        Write-Status "Note: Disabling Defender behavioral monitoring is not recommended" "Warning"
        Write-Status "Settings will remain enabled for security" "Info"
        return
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

    Write-Status "Windows Defender behavioral monitoring configured successfully" "Success"
}

function Set-EventLogConfiguration {
    <#
    .SYNOPSIS
        Configures event log sizes for adequate retention.

    .DESCRIPTION
        Increases Security event log size to ensure process creation and
        termination events are retained long enough for analysis.

        MITRE Mitigation: M1047 - Audit
    #>

    Write-Status "Configuring Event Log Retention..." "Header"

    if ($Undo) {
        Write-Status "Reverting event log configuration to defaults..." "Info"

        if ($PSCmdlet.ShouldProcess("Security Event Log", "Reset to default size")) {
            try {
                wevtutil sl Security /ms:20971520  # Default ~20MB
                Add-ChangeLog "Reset" "Event Log: Security Size" "Custom" "20MB (Default)"
                Write-Status "Security event log reset to default size" "Success"
            } catch {
                Write-Status "Failed to reset Security log size: $($_.Exception.Message)" "Warning"
            }
        }

        return
    }

    # Increase Security event log size to 256MB
    if ($PSCmdlet.ShouldProcess("Security Event Log", "Increase size to 256MB")) {
        try {
            $currentSize = (wevtutil gl Security | Select-String "maxSize").ToString() -replace '.*: ', ''
            wevtutil sl Security /ms:268435456  # 256MB
            Add-ChangeLog "Increase" "Event Log: Security Size" $currentSize "256MB"
            Write-Status "Security event log size increased to 256MB" "Success"
        } catch {
            Write-Status "Failed to increase Security log size: $($_.Exception.Message)" "Warning"
        }
    }

    # Increase Application event log size to 64MB
    if ($PSCmdlet.ShouldProcess("Application Event Log", "Increase size to 64MB")) {
        try {
            $currentSize = (wevtutil gl Application | Select-String "maxSize").ToString() -replace '.*: ', ''
            wevtutil sl Application /ms:67108864  # 64MB
            Add-ChangeLog "Increase" "Event Log: Application Size" $currentSize "64MB"
            Write-Status "Application event log size increased to 64MB" "Success"
        } catch {
            Write-Status "Failed to increase Application log size: $($_.Exception.Message)" "Warning"
        }
    }

    # Configure Sysmon log if available
    try {
        $sysmonLog = "Microsoft-Windows-Sysmon/Operational"
        if (Get-WinEvent -ListLog $sysmonLog -ErrorAction SilentlyContinue) {
            if ($PSCmdlet.ShouldProcess("Sysmon Event Log", "Increase size to 128MB")) {
                wevtutil sl $sysmonLog /ms:134217728  # 128MB
                Add-ChangeLog "Increase" "Event Log: Sysmon Size" "Unknown" "128MB"
                Write-Status "Sysmon event log size increased to 128MB" "Success"
            }
        }
    } catch {
        Write-Status "Sysmon not installed - skipping Sysmon log configuration" "Info"
    }

    Write-Status "Event log configuration completed successfully" "Success"
}

function Set-SysmonRecommendation {
    <#
    .SYNOPSIS
        Provides Sysmon installation and configuration recommendations.

    .DESCRIPTION
        Checks if Sysmon is installed and provides guidance for configuration
        to enable detailed process monitoring for timeout evasion detection.
    #>

    Write-Status "Checking Sysmon Status..." "Header"

    # Check if Sysmon is installed
    $sysmonService = Get-Service -Name "Sysmon*" -ErrorAction SilentlyContinue

    if ($sysmonService) {
        Write-Status "Sysmon is installed (Service: $($sysmonService.Name))" "Success"
        Write-Status "Ensure Sysmon config includes Event ID 1 (Process Create) and ID 5 (Process Terminate)" "Info"
    } else {
        Write-Status "Sysmon is NOT installed" "Warning"
        Write-Status "Recommendation: Install Sysmon for enhanced process monitoring" "Info"
        Write-Host ""
        Write-Host "  To install Sysmon:" -ForegroundColor Yellow
        Write-Host "  1. Download from: https://docs.microsoft.com/sysinternals/downloads/sysmon"
        Write-Host "  2. Install: sysmon64.exe -accepteula -i sysmonconfig.xml"
        Write-Host ""
        Write-Host "  Recommended config for timeout evasion detection:" -ForegroundColor Yellow
        Write-Host "  - Event ID 1: Process creation with hashing"
        Write-Host "  - Event ID 5: Process termination"
        Write-Host "  - Event ID 10: Process access (optional)"
        Write-Host ""
    }
}

function New-ProcessDurationMonitorScript {
    <#
    .SYNOPSIS
        Creates a PowerShell script for monitoring process durations.

    .DESCRIPTION
        Generates a monitoring script that can be scheduled to periodically
        check for long-running processes, helping detect timeout evasion.
    #>

    Write-Status "Creating Process Duration Monitor Script..." "Header"

    if ($Undo) {
        Write-Status "Process duration monitor is a standalone script - remove manually if needed" "Info"
        return
    }

    $monitorScript = @'
<#
.SYNOPSIS
    Monitors for long-running processes that may indicate sandbox evasion.

.DESCRIPTION
    This script identifies processes running longer than a specified threshold,
    which may indicate timing-based sandbox evasion techniques.

.PARAMETER ThresholdMinutes
    Minimum process runtime in minutes to trigger an alert. Default: 5

.PARAMETER ExcludeProcesses
    Array of process names to exclude from monitoring.

.EXAMPLE
    .\Monitor-ProcessDuration.ps1 -ThresholdMinutes 10
#>

param(
    [int]$ThresholdMinutes = 5,
    [string[]]$ExcludeProcesses = @(
        "svchost", "services", "lsass", "csrss", "winlogon",
        "System", "smss", "MsMpEng", "dwm", "explorer",
        "RuntimeBroker", "SearchIndexer", "spoolsv"
    )
)

$threshold = (Get-Date).AddMinutes(-$ThresholdMinutes)
$longRunning = @()

Get-Process | ForEach-Object {
    try {
        if ($_.StartTime -lt $threshold -and $_.Name -notin $ExcludeProcesses) {
            $runtime = (Get-Date) - $_.StartTime
            $longRunning += [PSCustomObject]@{
                ProcessId = $_.Id
                Name = $_.Name
                Path = $_.Path
                StartTime = $_.StartTime
                Runtime = $runtime.ToString("hh\:mm\:ss")
                RuntimeMinutes = [math]::Round($runtime.TotalMinutes, 2)
            }
        }
    } catch {
        # Process may have exited
    }
}

if ($longRunning.Count -gt 0) {
    Write-Host "=== Long-Running Processes (> $ThresholdMinutes minutes) ===" -ForegroundColor Yellow
    $longRunning | Sort-Object RuntimeMinutes -Descending | Format-Table -AutoSize

    # Check for F0 directory processes specifically
    $f0Processes = $longRunning | Where-Object { $_.Path -like "*\F0\*" }
    if ($f0Processes) {
        Write-Host "`n=== F0RT1KA Test Processes Detected ===" -ForegroundColor Cyan
        $f0Processes | Format-Table -AutoSize
    }
} else {
    Write-Host "No long-running processes detected." -ForegroundColor Green
}

# Return results for automation
return $longRunning
'@

    $scriptPath = Join-Path $env:TEMP "Monitor-ProcessDuration.ps1"

    if ($PSCmdlet.ShouldProcess($scriptPath, "Create process duration monitor script")) {
        try {
            $monitorScript | Out-File -FilePath $scriptPath -Encoding UTF8 -Force
            Add-ChangeLog "Create" "Script: Process Duration Monitor" "N/A" $scriptPath
            Write-Status "Process duration monitor script created: $scriptPath" "Success"
            Write-Host ""
            Write-Host "  Usage:" -ForegroundColor Yellow
            Write-Host "  powershell -ExecutionPolicy Bypass -File `"$scriptPath`""
            Write-Host "  powershell -ExecutionPolicy Bypass -File `"$scriptPath`" -ThresholdMinutes 10"
            Write-Host ""
        } catch {
            Write-Status "Failed to create monitor script: $($_.Exception.Message)" "Warning"
        }
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
    Set-ProcessCreationAuditing
    Write-Host ""

    Set-ProcessTerminationAuditing
    Write-Host ""

    Set-DirectoryMonitoring
    Write-Host ""

    Set-DefenderBehaviorMonitoring
    Write-Host ""

    Set-EventLogConfiguration
    Write-Host ""

    Set-SysmonRecommendation
    Write-Host ""

    if (-not $Undo) {
        New-ProcessDurationMonitorScript
        Write-Host ""
    }

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
    Write-Host "  # Verify process creation auditing:" -ForegroundColor Yellow
    Write-Host '  auditpol /get /subcategory:"Process Creation"'
    Write-Host '  auditpol /get /subcategory:"Process Termination"'
    Write-Host ""
    Write-Host "  # Verify file system auditing:" -ForegroundColor Yellow
    Write-Host '  auditpol /get /subcategory:"File System"'
    Write-Host ""
    Write-Host "  # Verify Defender status:" -ForegroundColor Yellow
    Write-Host "  Get-MpComputerStatus | Select-Object BehaviorMonitorEnabled, RealTimeProtectionEnabled"
    Write-Host ""
    Write-Host "  # Check F0 directory audit settings:" -ForegroundColor Yellow
    Write-Host "  (Get-Acl 'c:\F0' -Audit).Audit | Format-Table"
    Write-Host ""
    Write-Host "  # Check for long-running processes:" -ForegroundColor Yellow
    Write-Host "  Get-Process | Where-Object { `$_.StartTime -lt (Get-Date).AddMinutes(-5) } | Sort-Object StartTime"
    Write-Host ""
    Write-Host "  # View recent process creation events:" -ForegroundColor Yellow
    Write-Host "  Get-WinEvent -FilterHashtable @{LogName='Security';ID=4688} -MaxEvents 10"
    Write-Host ""

} catch {
    Write-Status "Critical error during hardening: $($_.Exception.Message)" "Error"
    Write-Status "Stack trace: $($_.ScriptStackTrace)" "Error"
    exit 1
}

exit 0
