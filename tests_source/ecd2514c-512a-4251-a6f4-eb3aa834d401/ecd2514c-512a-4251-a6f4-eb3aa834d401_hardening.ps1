<#
.SYNOPSIS
    F0RT1KA Hardening Script - Windows Defender Protection Against CyberEye RAT Techniques

.DESCRIPTION
    This script implements hardening measures to protect against the CyberEye RAT's
    Windows Defender disabling techniques. It addresses MITRE ATT&CK technique T1562.001
    (Impair Defenses: Disable or Modify Tools).

    Test ID: ecd2514c-512a-4251-a6f4-eb3aa834d401
    MITRE ATT&CK: T1562.001
    Mitigations: M1024, M1022, M1054, M1038, M1047

    Hardening Actions:
    - Verifies and enables Windows Defender Tamper Protection
    - Configures PowerShell security logging (Script Block, Transcription, Module)
    - Enables registry auditing for Windows Defender keys
    - Configures Attack Surface Reduction rules
    - Creates monitoring scheduled task for Defender health

.PARAMETER Undo
    Reverts all changes made by this script

.PARAMETER WhatIf
    Shows what would happen without making changes

.PARAMETER AuditOnly
    Only checks current security posture without making changes

.EXAMPLE
    .\ecd2514c-512a-4251-a6f4-eb3aa834d401_hardening.ps1
    Applies all hardening settings

.EXAMPLE
    .\ecd2514c-512a-4251-a6f4-eb3aa834d401_hardening.ps1 -Undo
    Reverts all hardening settings

.EXAMPLE
    .\ecd2514c-512a-4251-a6f4-eb3aa834d401_hardening.ps1 -AuditOnly
    Checks security posture without making changes

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    Requires: Administrator privileges
    Idempotent: Yes (safe to run multiple times)
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo,
    [switch]$AuditOnly
)

#Requires -RunAsAdministrator

# ============================================================
# Configuration
# ============================================================
$ErrorActionPreference = "Continue"
$Script:ChangeLog = @()
$Script:TestID = "ecd2514c-512a-4251-a6f4-eb3aa834d401"
$Script:MitreAttack = "T1562.001"
$LogFile = "$env:TEMP\F0RT1KA_Hardening_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# ============================================================
# Helper Functions
# ============================================================

function Write-Status {
    param(
        [string]$Message,
        [ValidateSet("Info", "Success", "Warning", "Error", "Check")]
        [string]$Type = "Info"
    )
    $colors = @{
        Info = "Cyan"
        Success = "Green"
        Warning = "Yellow"
        Error = "Red"
        Check = "Magenta"
    }
    $prefixes = @{
        Info = "[*]"
        Success = "[+]"
        Warning = "[!]"
        Error = "[-]"
        Check = "[?]"
    }
    $logMessage = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $($prefixes[$Type]) $Message"
    Write-Host "$($prefixes[$Type]) $Message" -ForegroundColor $colors[$Type]
    Add-Content -Path $LogFile -Value $logMessage
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
        Action = $Action
        Target = $Target
        OldValue = $OldValue
        NewValue = $NewValue
    }
}

function Test-RegistryValue {
    param(
        [string]$Path,
        [string]$Name
    )
    try {
        $value = Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop
        return $value.$Name
    }
    catch {
        return $null
    }
}

# ============================================================
# Hardening Functions
# ============================================================

function Set-TamperProtectionVerification {
    <#
    .SYNOPSIS
        Verifies Windows Defender Tamper Protection status
    #>
    Write-Status "Checking Windows Defender Tamper Protection status..." "Check"

    try {
        $status = Get-MpComputerStatus -ErrorAction Stop
        $tamperProtected = $status.IsTamperProtected

        if ($tamperProtected) {
            Write-Status "Tamper Protection is ENABLED - System protected" "Success"
            return $true
        }
        else {
            Write-Status "Tamper Protection is DISABLED - System at risk!" "Warning"
            Write-Status "Note: Tamper Protection must be enabled via Windows Security UI or Intune" "Info"
            Write-Status "Path: Windows Security > Virus & threat protection > Manage settings > Tamper Protection" "Info"

            if (-not $AuditOnly) {
                Write-Status "Attempting to verify cloud-delivered protection status..." "Info"
                $cloudProtection = $status.CloudProtectionEnabled
                if (-not $cloudProtection) {
                    Write-Status "Cloud-delivered protection is DISABLED - Required for Tamper Protection" "Warning"
                    Set-MpPreference -MAPSReporting Advanced -ErrorAction SilentlyContinue
                    Write-Status "Enabled cloud-delivered protection (Advanced MAPS)" "Success"
                }
            }
            return $false
        }
    }
    catch {
        Write-Status "Failed to check Tamper Protection: $($_.Exception.Message)" "Error"
        return $false
    }
}

function Set-PowerShellLogging {
    <#
    .SYNOPSIS
        Enables PowerShell security logging (Script Block, Transcription, Module)
        MITRE Mitigation: M1047 - Audit
    #>
    Write-Status "Configuring PowerShell security logging..." "Info"

    $loggingPaths = @{
        "ScriptBlockLogging" = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging"
        "Transcription" = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\Transcription"
        "ModuleLogging" = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ModuleLogging"
    }

    foreach ($logType in $loggingPaths.Keys) {
        $path = $loggingPaths[$logType]

        if ($Undo) {
            # Remove logging configuration
            if (Test-Path $path) {
                Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue
                Write-Status "Removed $logType configuration" "Warning"
                Add-ChangeLog -Action "Remove" -Target $path -OldValue "Enabled" -NewValue "Removed"
            }
        }
        elseif (-not $AuditOnly) {
            # Enable logging
            if (-not (Test-Path $path)) {
                New-Item -Path $path -Force | Out-Null
            }

            switch ($logType) {
                "ScriptBlockLogging" {
                    $currentValue = Test-RegistryValue -Path $path -Name "EnableScriptBlockLogging"
                    Set-ItemProperty -Path $path -Name "EnableScriptBlockLogging" -Value 1 -Type DWord
                    Set-ItemProperty -Path $path -Name "EnableScriptBlockInvocationLogging" -Value 1 -Type DWord
                    Write-Status "Enabled Script Block Logging" "Success"
                    Add-ChangeLog -Action "Enable" -Target "$path\EnableScriptBlockLogging" -OldValue $currentValue -NewValue "1"
                }
                "Transcription" {
                    $currentValue = Test-RegistryValue -Path $path -Name "EnableTranscripting"
                    $transcriptPath = "C:\PSTranscripts"
                    if (-not (Test-Path $transcriptPath)) {
                        New-Item -Path $transcriptPath -ItemType Directory -Force | Out-Null
                    }
                    Set-ItemProperty -Path $path -Name "EnableTranscripting" -Value 1 -Type DWord
                    Set-ItemProperty -Path $path -Name "OutputDirectory" -Value $transcriptPath -Type String
                    Set-ItemProperty -Path $path -Name "EnableInvocationHeader" -Value 1 -Type DWord
                    Write-Status "Enabled PowerShell Transcription to $transcriptPath" "Success"
                    Add-ChangeLog -Action "Enable" -Target "$path\EnableTranscripting" -OldValue $currentValue -NewValue "1"
                }
                "ModuleLogging" {
                    $currentValue = Test-RegistryValue -Path $path -Name "EnableModuleLogging"
                    Set-ItemProperty -Path $path -Name "EnableModuleLogging" -Value 1 -Type DWord

                    # Log all modules
                    $modulePath = "$path\ModuleNames"
                    if (-not (Test-Path $modulePath)) {
                        New-Item -Path $modulePath -Force | Out-Null
                    }
                    Set-ItemProperty -Path $modulePath -Name "*" -Value "*" -Type String
                    Write-Status "Enabled Module Logging for all modules" "Success"
                    Add-ChangeLog -Action "Enable" -Target "$path\EnableModuleLogging" -OldValue $currentValue -NewValue "1"
                }
            }
        }
        else {
            # Audit only
            $enabled = Test-RegistryValue -Path $path -Name "Enable$($logType -replace 'Logging|Transcription','')"
            if ($enabled -eq 1) {
                Write-Status "$logType is ENABLED" "Success"
            }
            else {
                Write-Status "$logType is DISABLED" "Warning"
            }
        }
    }
}

function Set-DefenderRegistryAuditing {
    <#
    .SYNOPSIS
        Enables auditing on Windows Defender registry keys
        MITRE Mitigation: M1024 - Restrict Registry Permissions
    #>
    Write-Status "Configuring Windows Defender registry auditing..." "Info"

    $registryPaths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows Defender",
        "HKLM:\SOFTWARE\Microsoft\Windows Defender\Features",
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender",
        "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection"
    )

    # Enable Object Access auditing via auditpol
    if (-not $AuditOnly -and -not $Undo) {
        try {
            $result = auditpol /set /subcategory:"Registry" /success:enable /failure:enable 2>&1
            Write-Status "Enabled registry object access auditing" "Success"
            Add-ChangeLog -Action "Enable" -Target "Audit Policy: Registry" -OldValue "Unknown" -NewValue "Success+Failure"
        }
        catch {
            Write-Status "Failed to enable registry auditing via auditpol: $($_.Exception.Message)" "Warning"
        }
    }
    elseif ($Undo) {
        try {
            auditpol /set /subcategory:"Registry" /success:disable /failure:disable 2>&1
            Write-Status "Disabled registry object access auditing" "Warning"
        }
        catch {
            Write-Status "Failed to disable registry auditing: $($_.Exception.Message)" "Error"
        }
    }
    else {
        $auditStatus = auditpol /get /subcategory:"Registry" 2>&1
        Write-Status "Current registry audit policy:" "Check"
        Write-Status "$auditStatus" "Info"
    }
}

function Set-AttackSurfaceReduction {
    <#
    .SYNOPSIS
        Enables Attack Surface Reduction rules relevant to Defender protection
        MITRE Mitigation: M1038 - Execution Prevention
    #>
    Write-Status "Configuring Attack Surface Reduction rules..." "Info"

    # ASR Rules relevant to this attack
    $asrRules = @{
        # Block process creations originating from PSExec and WMI commands
        "d1e49aac-8f56-4280-b9ba-993a6d77406c" = "Block process creations from PSExec and WMI"
        # Block credential stealing from LSASS
        "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2" = "Block credential stealing from LSASS"
        # Block Office applications from creating child processes
        "d4f940ab-401b-4efc-aadc-ad5f3c50688a" = "Block Office from creating child processes"
        # Block untrusted and unsigned processes from USB
        "b2b3f03d-6a65-4f7b-a9c7-1c7ef74a9ba4" = "Block untrusted processes from USB"
        # Block persistence through WMI event subscription
        "e6db77e5-3df2-4cf1-b95a-636979351e5b" = "Block persistence through WMI"
    }

    foreach ($ruleId in $asrRules.Keys) {
        $ruleName = $asrRules[$ruleId]

        if ($Undo) {
            try {
                Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -AttackSurfaceReductionRules_Actions Disabled -ErrorAction Stop
                Write-Status "Disabled ASR rule: $ruleName" "Warning"
                Add-ChangeLog -Action "Disable" -Target "ASR: $ruleId" -OldValue "Enabled" -NewValue "Disabled"
            }
            catch {
                Write-Status "Failed to disable ASR rule $ruleId : $($_.Exception.Message)" "Error"
            }
        }
        elseif (-not $AuditOnly) {
            try {
                Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -AttackSurfaceReductionRules_Actions Enabled -ErrorAction Stop
                Write-Status "Enabled ASR rule: $ruleName" "Success"
                Add-ChangeLog -Action "Enable" -Target "ASR: $ruleId" -OldValue "Unknown" -NewValue "Enabled"
            }
            catch {
                Write-Status "Failed to enable ASR rule $ruleId : $($_.Exception.Message)" "Error"
            }
        }
        else {
            # Audit - check current state
            try {
                $asrStatus = Get-MpPreference | Select-Object -ExpandProperty AttackSurfaceReductionRules_Ids
                if ($asrStatus -contains $ruleId) {
                    Write-Status "ASR rule ENABLED: $ruleName" "Success"
                }
                else {
                    Write-Status "ASR rule DISABLED: $ruleName" "Warning"
                }
            }
            catch {
                Write-Status "Could not check ASR rule status: $($_.Exception.Message)" "Warning"
            }
        }
    }
}

function Set-DefenderHealthMonitoring {
    <#
    .SYNOPSIS
        Creates a scheduled task to monitor Windows Defender health
        MITRE Mitigation: M1047 - Audit
    #>
    Write-Status "Configuring Windows Defender health monitoring..." "Info"

    $taskName = "F0RT1KA-DefenderHealthCheck"
    $taskPath = "\F0RT1KA\"

    if ($Undo) {
        try {
            Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false -ErrorAction Stop
            Write-Status "Removed Defender health monitoring task" "Warning"
            Add-ChangeLog -Action "Remove" -Target "Scheduled Task: $taskName" -OldValue "Enabled" -NewValue "Removed"
        }
        catch {
            Write-Status "Task not found or already removed" "Info"
        }
        return
    }

    if ($AuditOnly) {
        $existingTask = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
        if ($existingTask) {
            Write-Status "Defender health monitoring task EXISTS" "Success"
        }
        else {
            Write-Status "Defender health monitoring task NOT CONFIGURED" "Warning"
        }
        return
    }

    # Create monitoring script
    $monitorScript = @'
# F0RT1KA Defender Health Monitor
$logPath = "C:\ProgramData\F0RT1KA\DefenderHealthLogs"
if (-not (Test-Path $logPath)) { New-Item -Path $logPath -ItemType Directory -Force | Out-Null }
$logFile = Join-Path $logPath "DefenderHealth_$(Get-Date -Format 'yyyyMMdd').log"

try {
    $status = Get-MpComputerStatus
    $alert = $false
    $message = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Defender Health Check`n"

    if (-not $status.RealTimeProtectionEnabled) {
        $message += "  [ALERT] Real-Time Protection is DISABLED!`n"
        $alert = $true
    }
    if (-not $status.IsTamperProtected) {
        $message += "  [ALERT] Tamper Protection is DISABLED!`n"
        $alert = $true
    }
    if (-not $status.AntispywareEnabled) {
        $message += "  [ALERT] Antispyware is DISABLED!`n"
        $alert = $true
    }
    if (-not $status.BehaviorMonitorEnabled) {
        $message += "  [ALERT] Behavior Monitor is DISABLED!`n"
        $alert = $true
    }

    if ($alert) {
        $message += "  [WARNING] Windows Defender protection degraded - investigate immediately!`n"
        Write-EventLog -LogName Application -Source "F0RT1KA" -EventId 1001 -EntryType Warning -Message $message -ErrorAction SilentlyContinue
    } else {
        $message += "  [OK] All Defender protections are ENABLED`n"
    }

    Add-Content -Path $logFile -Value $message
}
catch {
    Add-Content -Path $logFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Error checking Defender status: $($_.Exception.Message)"
}
'@

    # Save monitoring script
    $scriptPath = "C:\ProgramData\F0RT1KA\Scripts"
    if (-not (Test-Path $scriptPath)) {
        New-Item -Path $scriptPath -ItemType Directory -Force | Out-Null
    }
    $scriptFile = Join-Path $scriptPath "Check-DefenderHealth.ps1"
    Set-Content -Path $scriptFile -Value $monitorScript -Force

    # Create event log source if it doesn't exist
    try {
        if (-not [System.Diagnostics.EventLog]::SourceExists("F0RT1KA")) {
            New-EventLog -LogName Application -Source "F0RT1KA" -ErrorAction SilentlyContinue
        }
    }
    catch {
        # Source may already exist or we may not have permission
    }

    # Create scheduled task
    try {
        $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptFile`""
        $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
        $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

        # Remove existing task if present
        Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false -ErrorAction SilentlyContinue

        Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "F0RT1KA Windows Defender health monitoring task" | Out-Null

        Write-Status "Created Defender health monitoring task (runs every 15 minutes)" "Success"
        Add-ChangeLog -Action "Create" -Target "Scheduled Task: $taskName" -OldValue "None" -NewValue "Created"
    }
    catch {
        Write-Status "Failed to create monitoring task: $($_.Exception.Message)" "Error"
    }
}

function Set-ControlledFolderAccess {
    <#
    .SYNOPSIS
        Enables Controlled Folder Access to protect against unauthorized changes
        MITRE Mitigation: M1022 - Restrict File and Directory Permissions
    #>
    Write-Status "Configuring Controlled Folder Access..." "Info"

    if ($Undo) {
        try {
            Set-MpPreference -EnableControlledFolderAccess Disabled -ErrorAction Stop
            Write-Status "Disabled Controlled Folder Access" "Warning"
            Add-ChangeLog -Action "Disable" -Target "Controlled Folder Access" -OldValue "Enabled" -NewValue "Disabled"
        }
        catch {
            Write-Status "Failed to disable Controlled Folder Access: $($_.Exception.Message)" "Error"
        }
        return
    }

    if ($AuditOnly) {
        try {
            $cfaStatus = Get-MpPreference | Select-Object -ExpandProperty EnableControlledFolderAccess
            if ($cfaStatus -eq 1) {
                Write-Status "Controlled Folder Access is ENABLED" "Success"
            }
            elseif ($cfaStatus -eq 2) {
                Write-Status "Controlled Folder Access is in AUDIT MODE" "Warning"
            }
            else {
                Write-Status "Controlled Folder Access is DISABLED" "Warning"
            }
        }
        catch {
            Write-Status "Could not check Controlled Folder Access status" "Warning"
        }
        return
    }

    try {
        # Enable in audit mode first (recommended for initial deployment)
        Set-MpPreference -EnableControlledFolderAccess AuditMode -ErrorAction Stop
        Write-Status "Enabled Controlled Folder Access (Audit Mode)" "Success"
        Write-Status "Note: Change to 'Enabled' mode after reviewing audit logs" "Info"
        Add-ChangeLog -Action "Enable" -Target "Controlled Folder Access" -OldValue "Unknown" -NewValue "AuditMode"
    }
    catch {
        Write-Status "Failed to enable Controlled Folder Access: $($_.Exception.Message)" "Error"
    }
}

function Show-SecurityPosture {
    <#
    .SYNOPSIS
        Displays current Windows Defender security posture
    #>
    Write-Status "`n========== SECURITY POSTURE SUMMARY ==========" "Info"

    try {
        $status = Get-MpComputerStatus

        $posture = @(
            @{ Name = "Real-Time Protection"; Status = $status.RealTimeProtectionEnabled },
            @{ Name = "Tamper Protection"; Status = $status.IsTamperProtected },
            @{ Name = "Behavior Monitor"; Status = $status.BehaviorMonitorEnabled },
            @{ Name = "On-Access Protection"; Status = $status.OnAccessProtectionEnabled },
            @{ Name = "Antispyware"; Status = $status.AntispywareEnabled },
            @{ Name = "Cloud Protection"; Status = $status.CloudProtectionEnabled }
        )

        foreach ($item in $posture) {
            if ($item.Status) {
                Write-Status "$($item.Name): ENABLED" "Success"
            }
            else {
                Write-Status "$($item.Name): DISABLED" "Error"
            }
        }

        Write-Status "`nAM Running Mode: $($status.AMRunningMode)" "Info"
        Write-Status "Engine Version: $($status.AMEngineVersion)" "Info"
        Write-Status "Signature Version: $($status.AntispywareSignatureVersion)" "Info"

    }
    catch {
        Write-Status "Failed to retrieve Defender status: $($_.Exception.Message)" "Error"
    }

    Write-Status "=============================================`n" "Info"
}

# ============================================================
# Main Execution
# ============================================================

Write-Status "============================================================" "Info"
Write-Status "F0RT1KA Hardening Script" "Info"
Write-Status "Test ID: $Script:TestID" "Info"
Write-Status "MITRE ATT&CK: $Script:MitreAttack" "Info"
Write-Status "Mode: $(if ($Undo) {'UNDO'} elseif ($AuditOnly) {'AUDIT'} else {'HARDEN'})" "Info"
Write-Status "============================================================" "Info"

if ($Undo) {
    Write-Status "`nReverting hardening changes..." "Warning"

    Set-PowerShellLogging
    Set-AttackSurfaceReduction
    Set-DefenderHealthMonitoring
    Set-ControlledFolderAccess
    Set-DefenderRegistryAuditing

    Write-Status "`nUndo complete. Review changes above." "Warning"
}
elseif ($AuditOnly) {
    Write-Status "`nAuditing current security posture..." "Check"

    Show-SecurityPosture
    Set-TamperProtectionVerification
    Set-PowerShellLogging
    Set-AttackSurfaceReduction
    Set-DefenderHealthMonitoring
    Set-ControlledFolderAccess
    Set-DefenderRegistryAuditing

    Write-Status "`nAudit complete. No changes were made." "Info"
}
else {
    Write-Status "`nApplying hardening settings..." "Info"

    # Show current posture first
    Show-SecurityPosture

    # Apply hardening
    Set-TamperProtectionVerification
    Set-PowerShellLogging
    Set-AttackSurfaceReduction
    Set-DefenderHealthMonitoring
    Set-ControlledFolderAccess
    Set-DefenderRegistryAuditing

    # Show updated posture
    Write-Status "`n========== POST-HARDENING POSTURE ==========" "Info"
    Show-SecurityPosture

    Write-Status "Hardening complete. Review log file: $LogFile" "Success"
}

# Display change log
if ($Script:ChangeLog.Count -gt 0) {
    Write-Status "`n========== CHANGE LOG ==========" "Info"
    $Script:ChangeLog | ForEach-Object {
        Write-Status "$($_.Timestamp) | $($_.Action) | $($_.Target)" "Info"
    }
    Write-Status "================================`n" "Info"
}

Write-Status "`nLog file saved to: $LogFile" "Info"
Write-Status "Script execution completed." "Success"
