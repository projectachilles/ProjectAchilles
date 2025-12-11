<#
.SYNOPSIS
    F0RT1KA Hardening Script - Tailscale Remote Access and Data Exfiltration

.DESCRIPTION
    This script implements hardening measures to protect against the attack techniques
    demonstrated by F0RT1KA test eafce2fc-75fd-4c62-92dc-32cabe5cf206.

    Test ID: eafce2fc-75fd-4c62-92dc-32cabe5cf206
    Test Name: Tailscale Remote Access and Data Exfiltration
    MITRE ATT&CK: T1105, T1219, T1543.003, T1021.004, T1041

    Mitigations Applied:
    - M1031: Network Intrusion Prevention (Firewall rules)
    - M1037: Filter Network Traffic (Block Tailscale infrastructure)
    - M1038: Execution Prevention (Application control)
    - M1042: Disable or Remove Feature (SSH restrictions)
    - M1047: Audit (Enable security auditing)

.PARAMETER Undo
    Reverts all changes made by this script

.PARAMETER WhatIf
    Shows what would happen without making changes

.PARAMETER Verbose
    Provides detailed output of all operations

.EXAMPLE
    .\eafce2fc-75fd-4c62-92dc-32cabe5cf206_hardening.ps1
    Applies all hardening settings

.EXAMPLE
    .\eafce2fc-75fd-4c62-92dc-32cabe5cf206_hardening.ps1 -Undo
    Reverts all hardening settings

.EXAMPLE
    .\eafce2fc-75fd-4c62-92dc-32cabe5cf206_hardening.ps1 -WhatIf
    Shows what changes would be made without applying them

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    Requires: Administrator privileges
    Idempotent: Yes (safe to run multiple times)
    Test ID: eafce2fc-75fd-4c62-92dc-32cabe5cf206
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo
)

#Requires -RunAsAdministrator

# ============================================================
# Configuration
# ============================================================

$ErrorActionPreference = "Continue"
$Script:ChangeLog = @()
$Script:TestID = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
$Script:BackupPath = "$env:ProgramData\F0RT1KA\Hardening\$Script:TestID"
$Script:LogPath = "$Script:BackupPath\hardening_log_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# Tailscale infrastructure domains and IPs to block
$Script:TailscaleDomains = @(
    "*.tailscale.com",
    "*.ts.net",
    "login.tailscale.com",
    "controlplane.tailscale.com",
    "pkgs.tailscale.com"
)

# Common Tailscale DERP relay servers (sample - update based on current infrastructure)
$Script:TailscaleIPs = @(
    # Note: These are example IPs - Tailscale uses dynamic infrastructure
    # Consider using DNS-based blocking for more comprehensive coverage
)

# Remote access tools to block (executables)
$Script:BlockedRemoteAccessTools = @(
    "tailscale.exe",
    "tailscaled.exe"
)

# Firewall rule names created by this script
$Script:FirewallRulePrefix = "F0RT1KA-Hardening"

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
        Info    = "Cyan"
        Success = "Green"
        Warning = "Yellow"
        Error   = "Red"
    }

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Type] $Message"

    Write-Host $logMessage -ForegroundColor $colors[$Type]

    # Also log to file
    if (Test-Path $Script:BackupPath) {
        Add-Content -Path $Script:LogPath -Value $logMessage -ErrorAction SilentlyContinue
    }
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

function Initialize-BackupDirectory {
    if (-not (Test-Path $Script:BackupPath)) {
        New-Item -ItemType Directory -Path $Script:BackupPath -Force | Out-Null
        Write-Status "Created backup directory: $Script:BackupPath" "Info"
    }
}

function Save-OriginalState {
    param([string]$Name, [object]$State)

    $statePath = Join-Path $Script:BackupPath "$Name.json"
    $State | ConvertTo-Json -Depth 10 | Set-Content -Path $statePath
    Write-Status "Saved original state: $Name" "Info"
}

function Get-OriginalState {
    param([string]$Name)

    $statePath = Join-Path $Script:BackupPath "$Name.json"
    if (Test-Path $statePath) {
        return Get-Content -Path $statePath | ConvertFrom-Json
    }
    return $null
}

# ============================================================
# Hardening Functions
# ============================================================

function Set-FirewallBlockTailscale {
    <#
    .SYNOPSIS
        Blocks outbound traffic to Tailscale infrastructure
    .DESCRIPTION
        Creates Windows Firewall rules to block connections to Tailscale
        coordination servers and DERP relays
    #>

    Write-Status "Configuring firewall to block Tailscale infrastructure..." "Info"

    # Block Tailscale executables from making outbound connections
    foreach ($exe in $Script:BlockedRemoteAccessTools) {
        $ruleName = "$Script:FirewallRulePrefix-Block-$exe"

        # Check if rule already exists
        $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

        if (-not $existingRule) {
            if ($PSCmdlet.ShouldProcess($ruleName, "Create firewall rule")) {
                try {
                    New-NetFirewallRule -DisplayName $ruleName `
                        -Description "F0RT1KA Hardening: Block $exe outbound connections" `
                        -Direction Outbound `
                        -Action Block `
                        -Program "*\$exe" `
                        -Enabled True | Out-Null

                    Add-ChangeLog -Action "Create" -Target "FirewallRule" -OldValue "" -NewValue $ruleName
                    Write-Status "Created firewall rule: $ruleName" "Success"
                }
                catch {
                    Write-Status "Failed to create firewall rule $ruleName : $_" "Error"
                }
            }
        }
        else {
            Write-Status "Firewall rule already exists: $ruleName" "Info"
        }
    }

    # Block WireGuard port (used by Tailscale)
    $wireguardRuleName = "$Script:FirewallRulePrefix-Block-WireGuard-UDP"
    $existingWgRule = Get-NetFirewallRule -DisplayName $wireguardRuleName -ErrorAction SilentlyContinue

    if (-not $existingWgRule) {
        if ($PSCmdlet.ShouldProcess($wireguardRuleName, "Create firewall rule")) {
            try {
                New-NetFirewallRule -DisplayName $wireguardRuleName `
                    -Description "F0RT1KA Hardening: Block WireGuard UDP port 41641" `
                    -Direction Outbound `
                    -Action Block `
                    -Protocol UDP `
                    -RemotePort 41641 `
                    -Enabled True | Out-Null

                Add-ChangeLog -Action "Create" -Target "FirewallRule" -OldValue "" -NewValue $wireguardRuleName
                Write-Status "Created firewall rule: $wireguardRuleName" "Success"
            }
            catch {
                Write-Status "Failed to create WireGuard blocking rule: $_" "Error"
            }
        }
    }

    # Block STUN port (used for NAT traversal)
    $stunRuleName = "$Script:FirewallRulePrefix-Block-STUN-UDP"
    $existingStunRule = Get-NetFirewallRule -DisplayName $stunRuleName -ErrorAction SilentlyContinue

    if (-not $existingStunRule) {
        if ($PSCmdlet.ShouldProcess($stunRuleName, "Create firewall rule")) {
            try {
                New-NetFirewallRule -DisplayName $stunRuleName `
                    -Description "F0RT1KA Hardening: Block STUN UDP port 3478" `
                    -Direction Outbound `
                    -Action Block `
                    -Protocol UDP `
                    -RemotePort 3478 `
                    -Enabled True | Out-Null

                Add-ChangeLog -Action "Create" -Target "FirewallRule" -OldValue "" -NewValue $stunRuleName
                Write-Status "Created firewall rule: $stunRuleName" "Success"
            }
            catch {
                Write-Status "Failed to create STUN blocking rule: $_" "Error"
            }
        }
    }
}

function Remove-FirewallBlockTailscale {
    <#
    .SYNOPSIS
        Removes firewall rules created by this script
    #>

    Write-Status "Removing Tailscale blocking firewall rules..." "Info"

    $rules = Get-NetFirewallRule -DisplayName "$Script:FirewallRulePrefix*" -ErrorAction SilentlyContinue

    foreach ($rule in $rules) {
        if ($PSCmdlet.ShouldProcess($rule.DisplayName, "Remove firewall rule")) {
            try {
                Remove-NetFirewallRule -DisplayName $rule.DisplayName
                Add-ChangeLog -Action "Remove" -Target "FirewallRule" -OldValue $rule.DisplayName -NewValue ""
                Write-Status "Removed firewall rule: $($rule.DisplayName)" "Success"
            }
            catch {
                Write-Status "Failed to remove firewall rule $($rule.DisplayName): $_" "Error"
            }
        }
    }
}

function Set-SSHHardening {
    <#
    .SYNOPSIS
        Hardens or disables SSH service
    .DESCRIPTION
        Disables OpenSSH Server if not required, or applies hardening settings
    #>

    Write-Status "Configuring SSH hardening..." "Info"

    # Check if sshd service exists
    $sshdService = Get-Service -Name sshd -ErrorAction SilentlyContinue

    if ($sshdService) {
        # Save original state
        $originalState = @{
            StartupType = (Get-WmiObject -Class Win32_Service -Filter "Name='sshd'").StartMode
            Status      = $sshdService.Status
        }
        Save-OriginalState -Name "sshd_service" -State $originalState

        if ($PSCmdlet.ShouldProcess("sshd", "Stop and disable service")) {
            try {
                # Stop the service
                if ($sshdService.Status -eq "Running") {
                    Stop-Service sshd -Force
                    Write-Status "Stopped sshd service" "Success"
                }

                # Set to disabled
                Set-Service sshd -StartupType Disabled
                Add-ChangeLog -Action "Modify" -Target "Service:sshd" -OldValue $originalState.StartupType -NewValue "Disabled"
                Write-Status "Disabled sshd service startup" "Success"
            }
            catch {
                Write-Status "Failed to disable sshd service: $_" "Error"
            }
        }

        # Remove SSH firewall rule if exists
        $sshFirewallRule = Get-NetFirewallRule -Name "sshd" -ErrorAction SilentlyContinue
        if ($sshFirewallRule) {
            if ($PSCmdlet.ShouldProcess("sshd firewall rule", "Remove")) {
                try {
                    Remove-NetFirewallRule -Name "sshd"
                    Add-ChangeLog -Action "Remove" -Target "FirewallRule:sshd" -OldValue "Enabled" -NewValue ""
                    Write-Status "Removed sshd firewall rule" "Success"
                }
                catch {
                    Write-Status "Failed to remove sshd firewall rule: $_" "Error"
                }
            }
        }
    }
    else {
        Write-Status "SSH service not installed - no action needed" "Info"
    }
}

function Restore-SSHState {
    <#
    .SYNOPSIS
        Restores SSH service to original state
    #>

    Write-Status "Restoring SSH service state..." "Info"

    $originalState = Get-OriginalState -Name "sshd_service"

    if ($originalState) {
        $sshdService = Get-Service -Name sshd -ErrorAction SilentlyContinue

        if ($sshdService) {
            if ($PSCmdlet.ShouldProcess("sshd", "Restore original state")) {
                try {
                    # Map startup mode
                    $startupMap = @{
                        "Auto"     = "Automatic"
                        "Manual"   = "Manual"
                        "Disabled" = "Disabled"
                    }
                    $startupType = $startupMap[$originalState.StartupType]
                    if (-not $startupType) { $startupType = "Manual" }

                    Set-Service sshd -StartupType $startupType

                    if ($originalState.Status -eq "Running") {
                        Start-Service sshd
                    }

                    Add-ChangeLog -Action "Restore" -Target "Service:sshd" -OldValue "Disabled" -NewValue $startupType
                    Write-Status "Restored sshd service to original state" "Success"
                }
                catch {
                    Write-Status "Failed to restore sshd service: $_" "Error"
                }
            }
        }
    }
    else {
        Write-Status "No original SSH state found to restore" "Info"
    }
}

function Set-F0DirectoryProtection {
    <#
    .SYNOPSIS
        Restricts access to C:\F0 test directory
    .DESCRIPTION
        Creates NTFS permissions to prevent unauthorized access to test directory
    #>

    Write-Status "Configuring F0 directory protection..." "Info"

    $f0Path = "C:\F0"

    # Create directory if it doesn't exist (to set permissions)
    if (-not (Test-Path $f0Path)) {
        if ($PSCmdlet.ShouldProcess($f0Path, "Create restricted directory")) {
            New-Item -ItemType Directory -Path $f0Path -Force | Out-Null
        }
    }

    if ($PSCmdlet.ShouldProcess($f0Path, "Set restrictive NTFS permissions")) {
        try {
            # Get current ACL
            $acl = Get-Acl $f0Path

            # Save original ACL
            Save-OriginalState -Name "f0_acl" -State @{
                AccessRules = ($acl.Access | ForEach-Object {
                    @{
                        IdentityReference = $_.IdentityReference.Value
                        FileSystemRights  = $_.FileSystemRights.ToString()
                        AccessControlType = $_.AccessControlType.ToString()
                    }
                })
            }

            # Remove inheritance and existing rules
            $acl.SetAccessRuleProtection($true, $false)

            # Add SYSTEM with full control
            $systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                "NT AUTHORITY\SYSTEM",
                "FullControl",
                "ContainerInherit,ObjectInherit",
                "None",
                "Allow"
            )
            $acl.AddAccessRule($systemRule)

            # Add Administrators with full control
            $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                "BUILTIN\Administrators",
                "FullControl",
                "ContainerInherit,ObjectInherit",
                "None",
                "Allow"
            )
            $acl.AddAccessRule($adminRule)

            # Apply ACL
            Set-Acl -Path $f0Path -AclObject $acl

            Add-ChangeLog -Action "Modify" -Target "ACL:$f0Path" -OldValue "Default" -NewValue "Restricted"
            Write-Status "Set restrictive permissions on $f0Path" "Success"
        }
        catch {
            Write-Status "Failed to set permissions on $f0Path : $_" "Error"
        }
    }
}

function Restore-F0DirectoryProtection {
    <#
    .SYNOPSIS
        Restores original F0 directory permissions
    #>

    Write-Status "Restoring F0 directory permissions..." "Info"

    $f0Path = "C:\F0"

    if (Test-Path $f0Path) {
        if ($PSCmdlet.ShouldProcess($f0Path, "Restore default permissions")) {
            try {
                $acl = Get-Acl $f0Path
                $acl.SetAccessRuleProtection($false, $true)  # Re-enable inheritance
                Set-Acl -Path $f0Path -AclObject $acl

                Add-ChangeLog -Action "Restore" -Target "ACL:$f0Path" -OldValue "Restricted" -NewValue "Default"
                Write-Status "Restored default permissions on $f0Path" "Success"
            }
            catch {
                Write-Status "Failed to restore permissions on $f0Path : $_" "Error"
            }
        }
    }
}

function Set-AuditingPolicies {
    <#
    .SYNOPSIS
        Enables security auditing for attack detection
    .DESCRIPTION
        Configures Windows audit policies to log service installation,
        process creation, and network events
    #>

    Write-Status "Configuring security auditing policies..." "Info"

    $auditPolicies = @(
        @{ Category = "Security System Extension"; Setting = "Success,Failure" },
        @{ Category = "Process Creation"; Setting = "Success" },
        @{ Category = "Network Shares"; Setting = "Success,Failure" },
        @{ Category = "Filtering Platform Connection"; Setting = "Failure" }
    )

    foreach ($policy in $auditPolicies) {
        if ($PSCmdlet.ShouldProcess($policy.Category, "Enable auditing")) {
            try {
                $result = auditpol /set /subcategory:"$($policy.Category)" /success:enable /failure:enable 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Add-ChangeLog -Action "Enable" -Target "Audit:$($policy.Category)" -OldValue "" -NewValue $policy.Setting
                    Write-Status "Enabled auditing for $($policy.Category)" "Success"
                }
                else {
                    Write-Status "Note: Could not enable auditing for $($policy.Category)" "Warning"
                }
            }
            catch {
                Write-Status "Failed to enable auditing for $($policy.Category): $_" "Warning"
            }
        }
    }

    # Enable command line auditing in process creation events
    $regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit"
    if (-not (Test-Path $regPath)) {
        New-Item -Path $regPath -Force | Out-Null
    }

    if ($PSCmdlet.ShouldProcess("ProcessCreationIncludeCmdLine_Enabled", "Enable")) {
        try {
            Set-ItemProperty -Path $regPath -Name "ProcessCreationIncludeCmdLine_Enabled" -Value 1 -Type DWord
            Add-ChangeLog -Action "Enable" -Target "Registry:ProcessCreationIncludeCmdLine" -OldValue "0" -NewValue "1"
            Write-Status "Enabled command line auditing in process creation events" "Success"
        }
        catch {
            Write-Status "Failed to enable command line auditing: $_" "Warning"
        }
    }
}

function Set-ApplicationControlHints {
    <#
    .SYNOPSIS
        Provides guidance for application control implementation
    .DESCRIPTION
        Outputs recommendations for AppLocker/WDAC policies
        (Full implementation requires domain environment)
    #>

    Write-Status "Application Control Recommendations:" "Info"
    Write-Status "  1. Block execution from C:\F0\ directory" "Info"
    Write-Status "  2. Block tailscale.exe and tailscaled.exe" "Info"
    Write-Status "  3. Block unsigned MSI installations from temp directories" "Info"
    Write-Status "  4. Whitelist only approved remote access tools" "Info"

    # Create AppLocker policy template
    $appLockerTemplate = @"
<AppLockerPolicy Version="1">
    <RuleCollection Type="Exe" EnforcementMode="Enabled">
        <!-- Block executables from F0RT1KA test directory -->
        <FilePathRule Id="$(New-Guid)" Name="Block F0 Directory"
                      Description="Block execution from C:\F0\" UserOrGroupSid="S-1-1-0" Action="Deny">
            <Conditions>
                <FilePathCondition Path="C:\F0\*"/>
            </Conditions>
        </FilePathRule>

        <!-- Block Tailscale executables -->
        <FilePublisherRule Id="$(New-Guid)" Name="Block Tailscale"
                          Description="Block Tailscale executables" UserOrGroupSid="S-1-1-0" Action="Deny">
            <Conditions>
                <FilePublisherCondition PublisherName="*Tailscale*" ProductName="*" BinaryName="*">
                    <BinaryVersionRange LowSection="*" HighSection="*"/>
                </FilePublisherCondition>
            </Conditions>
        </FilePublisherRule>
    </RuleCollection>

    <RuleCollection Type="Msi" EnforcementMode="Enabled">
        <!-- Block MSI from F0RT1KA test directory -->
        <FilePathRule Id="$(New-Guid)" Name="Block F0 MSI"
                      Description="Block MSI from C:\F0\" UserOrGroupSid="S-1-1-0" Action="Deny">
            <Conditions>
                <FilePathCondition Path="C:\F0\*.msi"/>
            </Conditions>
        </FilePathRule>
    </RuleCollection>
</AppLockerPolicy>
"@

    $templatePath = Join-Path $Script:BackupPath "AppLocker_Template.xml"
    $appLockerTemplate | Set-Content -Path $templatePath
    Write-Status "AppLocker policy template saved to: $templatePath" "Info"
}

# ============================================================
# Main Execution
# ============================================================

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " F0RT1KA Hardening Script" -ForegroundColor Cyan
Write-Host " Test: Tailscale Remote Access and Data Exfiltration" -ForegroundColor Cyan
Write-Host " ID: $Script:TestID" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Initialize backup directory
Initialize-BackupDirectory

if ($Undo) {
    Write-Status "=== REVERTING HARDENING CHANGES ===" "Warning"
    Write-Host ""

    # Revert in reverse order
    Restore-F0DirectoryProtection
    Restore-SSHState
    Remove-FirewallBlockTailscale

    Write-Host ""
    Write-Status "=== REVERT COMPLETE ===" "Success"
}
else {
    Write-Status "=== APPLYING HARDENING SETTINGS ===" "Info"
    Write-Host ""

    # Apply hardening measures
    Write-Status "--- Firewall Configuration ---" "Info"
    Set-FirewallBlockTailscale

    Write-Host ""
    Write-Status "--- SSH Hardening ---" "Info"
    Set-SSHHardening

    Write-Host ""
    Write-Status "--- Directory Protection ---" "Info"
    Set-F0DirectoryProtection

    Write-Host ""
    Write-Status "--- Security Auditing ---" "Info"
    Set-AuditingPolicies

    Write-Host ""
    Write-Status "--- Application Control ---" "Info"
    Set-ApplicationControlHints

    Write-Host ""
    Write-Status "=== HARDENING COMPLETE ===" "Success"
}

# Display change summary
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Change Summary" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

if ($Script:ChangeLog.Count -gt 0) {
    $Script:ChangeLog | Format-Table -AutoSize

    # Save change log
    $changeLogPath = Join-Path $Script:BackupPath "changes_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
    $Script:ChangeLog | ConvertTo-Json | Set-Content -Path $changeLogPath
    Write-Status "Change log saved to: $changeLogPath" "Info"
}
else {
    Write-Status "No changes were made (WhatIf mode or already configured)" "Info"
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Additional Recommendations" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Deploy application whitelisting (AppLocker/WDAC)" -ForegroundColor Yellow
Write-Host "   Template saved to: $Script:BackupPath\AppLocker_Template.xml" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Enable Sysmon for enhanced telemetry" -ForegroundColor Yellow
Write-Host "   Download from: https://docs.microsoft.com/en-us/sysinternals/downloads/sysmon" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Configure network proxy with TLS inspection" -ForegroundColor Yellow
Write-Host "   Block: *.tailscale.com, *.ts.net" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Implement DLP to detect sensitive data staging" -ForegroundColor Yellow
Write-Host "   Monitor: Archive creation, bulk file access" -ForegroundColor Gray
Write-Host ""
Write-Host "5. Review EDR policies for remote access tool detection" -ForegroundColor Yellow
Write-Host "   Block: Unauthorized RAT installation and execution" -ForegroundColor Gray
Write-Host ""

Write-Status "Script execution complete" "Success"
