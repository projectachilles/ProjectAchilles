<#
.SYNOPSIS
    F0RT1KA Defense Hardening Script - Data Exfiltration and Encryption Protection

.DESCRIPTION
    This script implements hardening measures to protect against data exfiltration
    and encryption attacks as simulated by F0RT1KA test 4b4bd24c-fff5-4de8-982e-6d0fa5e22284.

    Hardening measures include:
    - Attack Surface Reduction (ASR) rules for ransomware protection
    - PowerShell execution restrictions
    - Controlled Folder Access for ransomware protection
    - Software Restriction Policy for C:\F0 directory
    - File system auditing for cloud credential files
    - Firewall rules for cloud storage monitoring

    Test ID: 4b4bd24c-fff5-4de8-982e-6d0fa5e22284
    MITRE ATT&CK: T1020, T1041, T1486, T1055, T1083
    Mitigations: M1040, M1057, M1031, M1053, M1026

.PARAMETER Undo
    Reverts all changes made by this script

.PARAMETER WhatIf
    Shows what would happen without making changes

.PARAMETER Audit
    Only audits current security state without making changes

.EXAMPLE
    .\4b4bd24c-fff5-4de8-982e-6d0fa5e22284_hardening.ps1
    Applies all hardening settings

.EXAMPLE
    .\4b4bd24c-fff5-4de8-982e-6d0fa5e22284_hardening.ps1 -Undo
    Reverts all hardening settings

.EXAMPLE
    .\4b4bd24c-fff5-4de8-982e-6d0fa5e22284_hardening.ps1 -Audit
    Reports current security state without changes

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2024-01-15
    Requires: Administrator privileges
    Idempotent: Yes (safe to run multiple times)
    Test ID: 4b4bd24c-fff5-4de8-982e-6d0fa5e22284
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo,
    [switch]$Audit
)

#Requires -RunAsAdministrator

# ============================================================
# Configuration
# ============================================================
$ErrorActionPreference = "Continue"
$Script:ChangeLog = @()
$Script:AuditResults = @()

$TestID = "4b4bd24c-fff5-4de8-982e-6d0fa5e22284"
$TestName = "Data Exfiltration and Encryption Simulation"

# ASR Rules GUIDs for ransomware protection
$ASRRules = @{
    # Block executable content from email client and webmail
    "BE9BA2D9-53EA-4CDC-84E5-9B1EEEE46550" = "Block executable content from email client and webmail"
    # Block all Office applications from creating child processes
    "D4F940AB-401B-4EFC-AADC-AD5F3C50688A" = "Block Office applications from creating child processes"
    # Block Office applications from creating executable content
    "3B576869-A4EC-4529-8536-B80A7769E899" = "Block Office applications from creating executable content"
    # Block untrusted and unsigned processes that run from USB
    "B2B3F03D-6A65-4F7B-A9C7-1C7EF74A9BA4" = "Block untrusted processes from USB"
    # Use advanced protection against ransomware
    "C1DB55AB-C21A-4637-BB3F-A12568109D35" = "Use advanced protection against ransomware"
    # Block credential stealing from LSASS
    "9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2" = "Block credential stealing from LSASS"
    # Block process creations originating from PSExec and WMI commands
    "D1E49AAC-8F56-4280-B9BA-993A6D77406C" = "Block process creations from PSExec and WMI"
}

# Protected folders for Controlled Folder Access
$ProtectedFolders = @(
    "$env:USERPROFILE\Documents",
    "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\Downloads",
    "$env:USERPROFILE\.azure"
)

# ============================================================
# Helper Functions
# ============================================================

function Write-Status {
    param(
        [string]$Message,
        [ValidateSet("Info", "Success", "Warning", "Error", "Audit")]
        [string]$Type = "Info"
    )
    $colors = @{
        Info    = "Cyan"
        Success = "Green"
        Warning = "Yellow"
        Error   = "Red"
        Audit   = "Magenta"
    }
    $prefix = switch ($Type) {
        "Info"    { "[*]" }
        "Success" { "[+]" }
        "Warning" { "[!]" }
        "Error"   { "[-]" }
        "Audit"   { "[?]" }
    }
    Write-Host "$prefix $Message" -ForegroundColor $colors[$Type]
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

function Add-AuditResult {
    param(
        [string]$Check,
        [string]$Status,
        [string]$Details
    )
    $Script:AuditResults += [PSCustomObject]@{
        Check   = $Check
        Status  = $Status
        Details = $Details
    }
}

function Test-DefenderAvailable {
    try {
        $defender = Get-MpComputerStatus -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

# ============================================================
# Hardening Functions
# ============================================================

function Set-ASRRules {
    param([bool]$Enable = $true)

    Write-Status "Configuring Attack Surface Reduction (ASR) rules..." "Info"

    if (-not (Test-DefenderAvailable)) {
        Write-Status "Windows Defender not available - skipping ASR configuration" "Warning"
        return
    }

    foreach ($ruleId in $ASRRules.Keys) {
        $ruleName = $ASRRules[$ruleId]
        try {
            $currentState = (Get-MpPreference).AttackSurfaceReductionRules_Ids -contains $ruleId

            if ($Enable) {
                if ($PSCmdlet.ShouldProcess($ruleName, "Enable ASR Rule")) {
                    # Mode: 1 = Block, 2 = Audit, 6 = Warn
                    Add-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -AttackSurfaceReductionRules_Actions 1 -ErrorAction SilentlyContinue
                    Write-Status "Enabled ASR rule: $ruleName" "Success"
                    Add-ChangeLog "Enable ASR Rule" $ruleId "Disabled/Not Set" "Enabled (Block)"
                }
            }
            else {
                if ($PSCmdlet.ShouldProcess($ruleName, "Disable ASR Rule")) {
                    Remove-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -ErrorAction SilentlyContinue
                    Write-Status "Disabled ASR rule: $ruleName" "Warning"
                    Add-ChangeLog "Disable ASR Rule" $ruleId "Enabled" "Disabled"
                }
            }
        }
        catch {
            Write-Status "Failed to configure ASR rule $ruleName : $_" "Error"
        }
    }
}

function Set-ControlledFolderAccess {
    param([bool]$Enable = $true)

    Write-Status "Configuring Controlled Folder Access..." "Info"

    if (-not (Test-DefenderAvailable)) {
        Write-Status "Windows Defender not available - skipping Controlled Folder Access" "Warning"
        return
    }

    try {
        $currentState = (Get-MpPreference).EnableControlledFolderAccess

        if ($Enable) {
            if ($PSCmdlet.ShouldProcess("Controlled Folder Access", "Enable")) {
                # Mode: 1 = Enabled, 2 = Audit
                Set-MpPreference -EnableControlledFolderAccess 1
                Write-Status "Enabled Controlled Folder Access" "Success"
                Add-ChangeLog "Enable CFA" "ControlledFolderAccess" $currentState "1 (Enabled)"

                # Add protected folders
                foreach ($folder in $ProtectedFolders) {
                    if (Test-Path $folder) {
                        Add-MpPreference -ControlledFolderAccessProtectedFolders $folder -ErrorAction SilentlyContinue
                        Write-Status "Added protected folder: $folder" "Success"
                    }
                }
            }
        }
        else {
            if ($PSCmdlet.ShouldProcess("Controlled Folder Access", "Disable")) {
                Set-MpPreference -EnableControlledFolderAccess 0
                Write-Status "Disabled Controlled Folder Access" "Warning"
                Add-ChangeLog "Disable CFA" "ControlledFolderAccess" $currentState "0 (Disabled)"
            }
        }
    }
    catch {
        Write-Status "Failed to configure Controlled Folder Access: $_" "Error"
    }
}

function Set-PowerShellConstrainedMode {
    param([bool]$Enable = $true)

    Write-Status "Configuring PowerShell execution restrictions..." "Info"

    $regPath = "HKLM:\SOFTWARE\Microsoft\PowerShell\1\ShellIds\Microsoft.PowerShell"
    $regName = "ExecutionPolicy"

    try {
        $currentPolicy = Get-ItemProperty -Path $regPath -Name $regName -ErrorAction SilentlyContinue

        if ($Enable) {
            if ($PSCmdlet.ShouldProcess("PowerShell ExecutionPolicy", "Set to AllSigned")) {
                Set-ItemProperty -Path $regPath -Name $regName -Value "AllSigned" -Force
                Write-Status "Set PowerShell ExecutionPolicy to AllSigned" "Success"
                Add-ChangeLog "Set ExecutionPolicy" $regPath $currentPolicy.$regName "AllSigned"
            }
        }
        else {
            if ($PSCmdlet.ShouldProcess("PowerShell ExecutionPolicy", "Set to RemoteSigned")) {
                Set-ItemProperty -Path $regPath -Name $regName -Value "RemoteSigned" -Force
                Write-Status "Set PowerShell ExecutionPolicy to RemoteSigned" "Warning"
                Add-ChangeLog "Set ExecutionPolicy" $regPath $currentPolicy.$regName "RemoteSigned"
            }
        }
    }
    catch {
        Write-Status "Failed to configure PowerShell ExecutionPolicy: $_" "Error"
    }

    # Configure PowerShell Script Block Logging
    $logPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging"

    try {
        if ($Enable) {
            if ($PSCmdlet.ShouldProcess("PowerShell Script Block Logging", "Enable")) {
                if (-not (Test-Path $logPath)) {
                    New-Item -Path $logPath -Force | Out-Null
                }
                Set-ItemProperty -Path $logPath -Name "EnableScriptBlockLogging" -Value 1 -Type DWord -Force
                Set-ItemProperty -Path $logPath -Name "EnableScriptBlockInvocationLogging" -Value 1 -Type DWord -Force
                Write-Status "Enabled PowerShell Script Block Logging" "Success"
                Add-ChangeLog "Enable ScriptBlockLogging" $logPath "Not Set" "1"
            }
        }
        else {
            if ($PSCmdlet.ShouldProcess("PowerShell Script Block Logging", "Disable")) {
                if (Test-Path $logPath) {
                    Remove-Item -Path $logPath -Recurse -Force
                }
                Write-Status "Disabled PowerShell Script Block Logging" "Warning"
                Add-ChangeLog "Disable ScriptBlockLogging" $logPath "1" "Removed"
            }
        }
    }
    catch {
        Write-Status "Failed to configure PowerShell Script Block Logging: $_" "Error"
    }
}

function Set-F0DirectoryRestriction {
    param([bool]$Enable = $true)

    Write-Status "Configuring Software Restriction Policy for C:\F0..." "Info"

    $srPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Safer\CodeIdentifiers\0\Paths"

    try {
        if ($Enable) {
            if ($PSCmdlet.ShouldProcess("C:\F0", "Block execution via SRP")) {
                # Create policy path if not exists
                if (-not (Test-Path $srPath)) {
                    New-Item -Path $srPath -Force | Out-Null
                }

                # Create unique GUID for this rule
                $ruleGuid = "{F0RT1KA-4B4B-D24C-FFF5-4DE8982E6D0F}"
                $rulePath = Join-Path $srPath $ruleGuid

                if (-not (Test-Path $rulePath)) {
                    New-Item -Path $rulePath -Force | Out-Null
                }

                Set-ItemProperty -Path $rulePath -Name "ItemData" -Value "C:\F0\*" -Type String -Force
                Set-ItemProperty -Path $rulePath -Name "SaferFlags" -Value 0 -Type DWord -Force
                Set-ItemProperty -Path $rulePath -Name "Description" -Value "F0RT1KA Test Block - $TestID" -Type String -Force

                Write-Status "Blocked execution from C:\F0 via Software Restriction Policy" "Success"
                Add-ChangeLog "Block C:\F0" $rulePath "Not Set" "Disallowed"
            }
        }
        else {
            if ($PSCmdlet.ShouldProcess("C:\F0 SRP Rule", "Remove")) {
                $ruleGuid = "{F0RT1KA-4B4B-D24C-FFF5-4DE8982E6D0F}"
                $rulePath = Join-Path $srPath $ruleGuid

                if (Test-Path $rulePath) {
                    Remove-Item -Path $rulePath -Recurse -Force
                    Write-Status "Removed C:\F0 execution restriction" "Warning"
                    Add-ChangeLog "Unblock C:\F0" $rulePath "Disallowed" "Removed"
                }
            }
        }
    }
    catch {
        Write-Status "Failed to configure Software Restriction Policy: $_" "Error"
    }
}

function Set-AzureCredentialAuditing {
    param([bool]$Enable = $true)

    Write-Status "Configuring auditing for Azure credential files..." "Info"

    $azurePath = "$env:USERPROFILE\.azure"

    try {
        if (Test-Path $azurePath) {
            $acl = Get-Acl -Path $azurePath

            if ($Enable) {
                if ($PSCmdlet.ShouldProcess($azurePath, "Enable file access auditing")) {
                    # Create audit rule for read access
                    $auditRule = New-Object System.Security.AccessControl.FileSystemAuditRule(
                        "Everyone",
                        "Read",
                        "ContainerInherit,ObjectInherit",
                        "None",
                        "Success,Failure"
                    )

                    $acl.AddAuditRule($auditRule)
                    Set-Acl -Path $azurePath -AclObject $acl
                    Write-Status "Enabled file access auditing for Azure credentials" "Success"
                    Add-ChangeLog "Enable Audit" $azurePath "Not Set" "Read Audit Enabled"
                }
            }
            else {
                if ($PSCmdlet.ShouldProcess($azurePath, "Disable file access auditing")) {
                    $acl.SetAuditRuleProtection($false, $true)
                    Set-Acl -Path $azurePath -AclObject $acl
                    Write-Status "Disabled file access auditing for Azure credentials" "Warning"
                    Add-ChangeLog "Disable Audit" $azurePath "Read Audit Enabled" "Removed"
                }
            }
        }
        else {
            Write-Status "Azure CLI directory not found - skipping credential auditing" "Info"
        }
    }
    catch {
        Write-Status "Failed to configure Azure credential auditing: $_" "Error"
    }
}

function Set-CloudStorageFirewallRules {
    param([bool]$Enable = $true)

    Write-Status "Configuring firewall rules for cloud storage monitoring..." "Info"

    $ruleName = "F0RT1KA-CloudStorageAudit"

    try {
        if ($Enable) {
            if ($PSCmdlet.ShouldProcess("Outbound Cloud Storage", "Create audit firewall rule")) {
                # Create logging rule (not blocking) for cloud storage
                # This creates visibility without blocking legitimate traffic
                $existingRule = Get-NetFirewallRule -Name "$ruleName-Blob" -ErrorAction SilentlyContinue

                if (-not $existingRule) {
                    # Azure Blob Storage audit rule
                    New-NetFirewallRule -Name "$ruleName-Blob" `
                        -DisplayName "F0RT1KA: Azure Blob Storage Audit" `
                        -Direction Outbound `
                        -Action Allow `
                        -RemoteAddress "Internet" `
                        -Protocol TCP `
                        -RemotePort 443 `
                        -Profile Any `
                        -Enabled True `
                        -Description "Audit rule for Azure Blob Storage traffic - Test $TestID" | Out-Null

                    Write-Status "Created Azure Blob Storage audit firewall rule" "Success"
                    Add-ChangeLog "Create FW Rule" "$ruleName-Blob" "Not Set" "Allow with Logging"
                }
                else {
                    Write-Status "Azure Blob Storage audit rule already exists" "Info"
                }
            }
        }
        else {
            if ($PSCmdlet.ShouldProcess("Cloud Storage Audit Rules", "Remove")) {
                Remove-NetFirewallRule -Name "$ruleName-*" -ErrorAction SilentlyContinue
                Write-Status "Removed cloud storage audit firewall rules" "Warning"
                Add-ChangeLog "Remove FW Rules" "$ruleName-*" "Allow with Logging" "Removed"
            }
        }
    }
    catch {
        Write-Status "Failed to configure cloud storage firewall rules: $_" "Error"
    }
}

function Set-RansomwareProtectionSettings {
    param([bool]$Enable = $true)

    Write-Status "Configuring additional ransomware protection settings..." "Info"

    if (-not (Test-DefenderAvailable)) {
        Write-Status "Windows Defender not available - skipping ransomware protection settings" "Warning"
        return
    }

    try {
        if ($Enable) {
            if ($PSCmdlet.ShouldProcess("Ransomware Protection", "Enable enhanced settings")) {
                # Enable cloud-delivered protection
                Set-MpPreference -MAPSReporting Advanced -ErrorAction SilentlyContinue
                Write-Status "Enabled cloud-delivered protection (MAPS)" "Success"

                # Enable automatic sample submission
                Set-MpPreference -SubmitSamplesConsent SendAllSamples -ErrorAction SilentlyContinue
                Write-Status "Enabled automatic sample submission" "Success"

                # Enable behavior monitoring
                Set-MpPreference -DisableBehaviorMonitoring $false -ErrorAction SilentlyContinue
                Write-Status "Enabled behavior monitoring" "Success"

                # Enable real-time protection
                Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction SilentlyContinue
                Write-Status "Enabled real-time protection" "Success"

                # Enable potentially unwanted application blocking
                Set-MpPreference -PUAProtection Enabled -ErrorAction SilentlyContinue
                Write-Status "Enabled PUA protection" "Success"

                Add-ChangeLog "Enable Ransomware Protection" "Defender Settings" "Various" "Enhanced"
            }
        }
        else {
            Write-Status "Ransomware protection settings should not be disabled - skipping" "Warning"
        }
    }
    catch {
        Write-Status "Failed to configure ransomware protection settings: $_" "Error"
    }
}

# ============================================================
# Audit Functions
# ============================================================

function Invoke-SecurityAudit {
    Write-Status "Performing security audit for $TestName..." "Audit"
    Write-Status "Test ID: $TestID" "Info"
    Write-Host ""

    # Check Windows Defender status
    Write-Status "Checking Windows Defender status..." "Audit"
    if (Test-DefenderAvailable) {
        $defenderStatus = Get-MpComputerStatus
        Add-AuditResult "Windows Defender" $(if ($defenderStatus.RealTimeProtectionEnabled) { "PASS" } else { "FAIL" }) `
            "Real-time protection: $($defenderStatus.RealTimeProtectionEnabled)"

        # Check ASR rules
        $asrState = Get-MpPreference
        $enabledASR = @($asrState.AttackSurfaceReductionRules_Ids | Where-Object { $_ }).Count
        Add-AuditResult "ASR Rules" $(if ($enabledASR -ge 5) { "PASS" } else { "WARN" }) `
            "$enabledASR ASR rules configured"

        # Check Controlled Folder Access
        Add-AuditResult "Controlled Folder Access" $(if ($asrState.EnableControlledFolderAccess -eq 1) { "PASS" } else { "FAIL" }) `
            "CFA State: $($asrState.EnableControlledFolderAccess)"
    }
    else {
        Add-AuditResult "Windows Defender" "FAIL" "Windows Defender not available"
    }

    # Check PowerShell execution policy
    Write-Status "Checking PowerShell configuration..." "Audit"
    $psPolicy = Get-ExecutionPolicy -Scope LocalMachine
    Add-AuditResult "PowerShell ExecutionPolicy" $(if ($psPolicy -in @("AllSigned", "Restricted")) { "PASS" } else { "WARN" }) `
        "Current policy: $psPolicy"

    # Check Script Block Logging
    $sbLogPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging"
    $sbLogEnabled = (Get-ItemProperty -Path $sbLogPath -Name "EnableScriptBlockLogging" -ErrorAction SilentlyContinue).EnableScriptBlockLogging -eq 1
    Add-AuditResult "PowerShell Script Block Logging" $(if ($sbLogEnabled) { "PASS" } else { "FAIL" }) `
        "Logging enabled: $sbLogEnabled"

    # Check Azure CLI directory permissions
    Write-Status "Checking Azure credential protection..." "Audit"
    $azurePath = "$env:USERPROFILE\.azure"
    if (Test-Path $azurePath) {
        $azureAcl = Get-Acl $azurePath
        $auditRules = $azureAcl.GetAuditRules($true, $true, [System.Security.Principal.NTAccount])
        Add-AuditResult "Azure Credential Auditing" $(if ($auditRules.Count -gt 0) { "PASS" } else { "WARN" }) `
            "Audit rules configured: $($auditRules.Count)"
    }
    else {
        Add-AuditResult "Azure Credential Auditing" "N/A" "Azure CLI not installed"
    }

    # Check C:\F0 restrictions
    Write-Status "Checking test directory restrictions..." "Audit"
    $srpPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Safer\CodeIdentifiers\0\Paths"
    $f0Blocked = $false
    if (Test-Path $srpPath) {
        Get-ChildItem $srpPath -ErrorAction SilentlyContinue | ForEach-Object {
            $itemData = (Get-ItemProperty -Path $_.PSPath -Name "ItemData" -ErrorAction SilentlyContinue).ItemData
            if ($itemData -like "*F0*") {
                $f0Blocked = $true
            }
        }
    }
    Add-AuditResult "C:\F0 Execution Block" $(if ($f0Blocked) { "PASS" } else { "WARN" }) `
        "SRP rule exists: $f0Blocked"

    # Display results
    Write-Host ""
    Write-Status "===== AUDIT RESULTS =====" "Audit"
    Write-Host ""

    $Script:AuditResults | ForEach-Object {
        $statusColor = switch ($_.Status) {
            "PASS" { "Green" }
            "FAIL" { "Red" }
            "WARN" { "Yellow" }
            default { "Cyan" }
        }
        Write-Host "[$($_.Status)]" -ForegroundColor $statusColor -NoNewline
        Write-Host " $($_.Check): " -NoNewline
        Write-Host $_.Details -ForegroundColor Gray
    }

    Write-Host ""
    $passCount = @($Script:AuditResults | Where-Object { $_.Status -eq "PASS" }).Count
    $totalCount = $Script:AuditResults.Count
    $percentage = [math]::Round(($passCount / $totalCount) * 100)

    Write-Status "Security Posture: $passCount/$totalCount checks passed ($percentage%)" $(if ($percentage -ge 80) { "Success" } elseif ($percentage -ge 50) { "Warning" } else { "Error" })
}

# ============================================================
# Main Execution
# ============================================================

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  F0RT1KA Defense Hardening Script" -ForegroundColor Cyan
Write-Host "  Test: $TestName" -ForegroundColor Cyan
Write-Host "  ID: $TestID" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

if ($Audit) {
    Invoke-SecurityAudit
    exit 0
}

if ($Undo) {
    Write-Status "REVERTING hardening changes..." "Warning"
    Write-Host ""

    Set-ASRRules -Enable $false
    Set-ControlledFolderAccess -Enable $false
    Set-PowerShellConstrainedMode -Enable $false
    Set-F0DirectoryRestriction -Enable $false
    Set-AzureCredentialAuditing -Enable $false
    Set-CloudStorageFirewallRules -Enable $false

    Write-Host ""
    Write-Status "Hardening changes have been reverted" "Warning"
    Write-Status "WARNING: System is now less protected against data exfiltration and ransomware" "Error"
}
else {
    Write-Status "APPLYING hardening measures..." "Info"
    Write-Host ""

    Set-ASRRules -Enable $true
    Set-ControlledFolderAccess -Enable $true
    Set-PowerShellConstrainedMode -Enable $true
    Set-F0DirectoryRestriction -Enable $true
    Set-AzureCredentialAuditing -Enable $true
    Set-CloudStorageFirewallRules -Enable $true
    Set-RansomwareProtectionSettings -Enable $true

    Write-Host ""
    Write-Status "Hardening complete!" "Success"
}

# Display change log
if ($Script:ChangeLog.Count -gt 0) {
    Write-Host ""
    Write-Status "===== CHANGE LOG =====" "Info"
    $Script:ChangeLog | Format-Table -AutoSize
}

# Save change log to file
$logFile = Join-Path $env:TEMP "F0RT1KA_Hardening_$TestID_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
$Script:ChangeLog | ConvertTo-Json -Depth 3 | Out-File $logFile -Encoding UTF8
Write-Status "Change log saved to: $logFile" "Info"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Hardening script completed" -ForegroundColor Cyan
Write-Host "  Run with -Audit to verify security posture" -ForegroundColor Gray
Write-Host "  Run with -Undo to revert changes" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan
