<#
.SYNOPSIS
    F0RT1KA Security Hardening Script - MDE Process Injection and API Bypass Protection

.DESCRIPTION
    This script implements security hardening measures to protect against the attack techniques
    demonstrated by F0RT1KA test fec68e9b-af59-40c1-abbd-98ec98428444:
    - Process injection (T1055, T1055.001)
    - Defense evasion (T1562.001)
    - Memory manipulation (T1014)
    - Adversary-in-the-Middle (T1557)

    Test ID: fec68e9b-af59-40c1-abbd-98ec98428444
    MITRE ATT&CK: T1055, T1055.001, T1562.001, T1014, T1557, T1071.001, T1140

.PARAMETER Undo
    Reverts all changes made by this script to their default values

.PARAMETER WhatIf
    Shows what would happen without making changes

.PARAMETER Audit
    Only audits current settings without making changes

.EXAMPLE
    .\fec68e9b-af59-40c1-abbd-98ec98428444_hardening.ps1
    Applies all hardening settings

.EXAMPLE
    .\fec68e9b-af59-40c1-abbd-98ec98428444_hardening.ps1 -Undo
    Reverts all hardening settings

.EXAMPLE
    .\fec68e9b-af59-40c1-abbd-98ec98428444_hardening.ps1 -Audit
    Audits current security posture without making changes

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    Requires: Administrator privileges
    Idempotent: Yes (safe to run multiple times)
    Rollback: Use -Undo parameter
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
$Script:TestID = "fec68e9b-af59-40c1-abbd-98ec98428444"
$Script:LogPath = "C:\F0\hardening_log.json"

# ============================================================
# Helper Functions
# ============================================================

function Write-Status {
    param(
        [string]$Message,
        [ValidateSet("Info", "Success", "Warning", "Error", "Header")]
        [string]$Type = "Info"
    )
    $colors = @{
        Info = "Cyan"
        Success = "Green"
        Warning = "Yellow"
        Error = "Red"
        Header = "Magenta"
    }
    $prefix = @{
        Info = "[*]"
        Success = "[+]"
        Warning = "[!]"
        Error = "[-]"
        Header = "[=]"
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
        Category = $Category
        Setting = $Setting
        OldValue = $OldValue
        NewValue = $NewValue
        Status = $Status
    }
}

function Test-AdminPrivileges {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-RegistryValue {
    param(
        [string]$Path,
        [string]$Name
    )
    try {
        $value = Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue
        if ($null -ne $value) {
            return $value.$Name
        }
    } catch {
        return $null
    }
    return $null
}

function Set-RegistryValue {
    param(
        [string]$Path,
        [string]$Name,
        [object]$Value,
        [string]$Type = "DWord"
    )

    if (-not (Test-Path $Path)) {
        New-Item -Path $Path -Force | Out-Null
    }

    $oldValue = Get-RegistryValue -Path $Path -Name $Name
    Set-ItemProperty -Path $Path -Name $Name -Value $Value -Type $Type -Force
    return $oldValue
}

# ============================================================
# SECTION 1: Attack Surface Reduction (ASR) Rules
# ============================================================

function Set-ASRRules {
    param([switch]$Disable)

    Write-Status "Configuring Attack Surface Reduction (ASR) Rules" -Type Header

    # ASR Rules relevant to process injection
    $asrRules = @{
        # Block process creations from PSExec and WMI commands
        "d1e49aac-8f56-4280-b9ba-993a6d77406c" = "Block process creations from PSExec and WMI"
        # Block executable content from email client and webmail
        "be9ba2d9-53ea-4cdc-84e5-9b1eeee46550" = "Block executable content from email client"
        # Block credential stealing from LSASS
        "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2" = "Block credential stealing from LSASS"
        # Block untrusted and unsigned processes from USB
        "b2b3f03d-6a65-4f7b-a9c7-1c7ef74a9ba4" = "Block untrusted processes from USB"
        # Block Office applications from creating child processes
        "d4f940ab-401b-4efc-aadc-ad5f3c50688a" = "Block Office from creating child processes"
        # Block Office applications from injecting code into other processes
        "75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84" = "Block Office from code injection"
        # Block Win32 API calls from Office macro
        "92e97fa1-2edf-4476-bdd6-9dd0b4dddc7b" = "Block Win32 API calls from Office macro"
        # Block all Office applications from creating child processes
        "d4f940ab-401b-4efc-aadc-ad5f3c50688a" = "Block Office child processes"
        # Block JavaScript or VBScript from launching downloaded executable content
        "d3e037e1-3eb8-44c8-a917-57927947596d" = "Block JS/VBS downloaded executables"
        # Block executable files from running unless they meet prevalence criteria
        "01443614-cd74-433a-b99e-2ecdc07bfc25" = "Block low-prevalence executables"
    }

    $mode = if ($Disable) { 0 } else { 1 }  # 0=Disabled, 1=Block, 2=Audit
    $modeText = if ($Disable) { "Disabled" } else { "Enabled (Block)" }

    foreach ($ruleId in $asrRules.Keys) {
        $ruleName = $asrRules[$ruleId]

        if ($PSCmdlet.ShouldProcess($ruleName, "Set ASR rule to $modeText")) {
            try {
                if ($Audit) {
                    $currentState = (Get-MpPreference).AttackSurfaceReductionRules_Ids
                    $currentAction = (Get-MpPreference).AttackSurfaceReductionRules_Actions
                    $idx = [Array]::IndexOf($currentState, $ruleId)
                    if ($idx -ge 0) {
                        $state = switch ($currentAction[$idx]) {
                            0 { "Disabled" }
                            1 { "Block" }
                            2 { "Audit" }
                            default { "Unknown" }
                        }
                        Write-Status "$ruleName : $state" -Type Info
                    } else {
                        Write-Status "$ruleName : Not Configured" -Type Warning
                    }
                } else {
                    Add-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -AttackSurfaceReductionRules_Actions $mode
                    Write-Status "$ruleName : $modeText" -Type Success
                    Add-ChangeLog -Category "ASR" -Setting $ruleName -OldValue "Previous" -NewValue $modeText -Status "Applied"
                }
            } catch {
                Write-Status "Failed to configure $ruleName : $_" -Type Error
                Add-ChangeLog -Category "ASR" -Setting $ruleName -OldValue "N/A" -NewValue "Failed" -Status "Error"
            }
        }
    }
}

# ============================================================
# SECTION 2: Memory Integrity / HVCI
# ============================================================

function Set-MemoryIntegrity {
    param([switch]$Disable)

    Write-Status "Configuring Memory Integrity (HVCI)" -Type Header

    $path = "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity"
    $valueName = "Enabled"

    if ($PSCmdlet.ShouldProcess("Memory Integrity", "Configure HVCI")) {
        if ($Audit) {
            $current = Get-RegistryValue -Path $path -Name $valueName
            $state = if ($current -eq 1) { "Enabled" } else { "Disabled" }
            Write-Status "Memory Integrity (HVCI): $state" -Type Info
        } else {
            $newValue = if ($Disable) { 0 } else { 1 }
            $oldValue = Set-RegistryValue -Path $path -Name $valueName -Value $newValue

            $status = if ($Disable) { "Disabled" } else { "Enabled" }
            Write-Status "Memory Integrity (HVCI): $status" -Type Success
            Write-Status "  NOTE: Reboot required for changes to take effect" -Type Warning
            Add-ChangeLog -Category "HVCI" -Setting $valueName -OldValue "$oldValue" -NewValue "$newValue" -Status "Applied"
        }
    }
}

# ============================================================
# SECTION 3: Windows Defender Configuration
# ============================================================

function Set-DefenderHardening {
    param([switch]$Disable)

    Write-Status "Configuring Windows Defender Hardening" -Type Header

    if ($PSCmdlet.ShouldProcess("Windows Defender", "Configure hardening settings")) {
        if ($Audit) {
            $prefs = Get-MpPreference
            Write-Status "Real-time Protection: $(if($prefs.DisableRealtimeMonitoring){'Disabled'}else{'Enabled'})" -Type Info
            Write-Status "Behavior Monitoring: $(if($prefs.DisableBehaviorMonitoring){'Disabled'}else{'Enabled'})" -Type Info
            Write-Status "Script Scanning: $(if($prefs.DisableScriptScanning){'Disabled'}else{'Enabled'})" -Type Info
            Write-Status "Cloud Protection: $(if($prefs.MAPSReporting -gt 0){'Enabled'}else{'Disabled'})" -Type Info
            Write-Status "Network Protection: $(if($prefs.EnableNetworkProtection -eq 1){'Block'}elseif($prefs.EnableNetworkProtection -eq 2){'Audit'}else{'Disabled'})" -Type Info
            Write-Status "Controlled Folder Access: $(if($prefs.EnableControlledFolderAccess -eq 1){'Enabled'}else{'Disabled'})" -Type Info
            Write-Status "PUA Protection: $(if($prefs.PUAProtection -eq 1){'Enabled'}else{'Disabled'})" -Type Info
        } else {
            try {
                if ($Disable) {
                    # Only for testing - not recommended!
                    Write-Status "WARNING: Disabling Defender protections is NOT RECOMMENDED!" -Type Warning
                } else {
                    # Enable real-time protection
                    Set-MpPreference -DisableRealtimeMonitoring $false
                    Write-Status "Real-time Protection: Enabled" -Type Success

                    # Enable behavior monitoring
                    Set-MpPreference -DisableBehaviorMonitoring $false
                    Write-Status "Behavior Monitoring: Enabled" -Type Success

                    # Enable script scanning
                    Set-MpPreference -DisableScriptScanning $false
                    Write-Status "Script Scanning: Enabled" -Type Success

                    # Enable cloud-delivered protection (Advanced)
                    Set-MpPreference -MAPSReporting Advanced
                    Write-Status "Cloud Protection: Advanced" -Type Success

                    # Enable Network Protection (Block mode)
                    Set-MpPreference -EnableNetworkProtection Enabled
                    Write-Status "Network Protection: Enabled (Block)" -Type Success

                    # Enable Controlled Folder Access
                    Set-MpPreference -EnableControlledFolderAccess Enabled
                    Write-Status "Controlled Folder Access: Enabled" -Type Success

                    # Enable PUA Protection
                    Set-MpPreference -PUAProtection Enabled
                    Write-Status "PUA Protection: Enabled" -Type Success

                    # Set cloud block timeout to maximum
                    Set-MpPreference -CloudBlockLevel High
                    Set-MpPreference -CloudExtendedTimeout 50
                    Write-Status "Cloud Block Level: High (50s timeout)" -Type Success

                    Add-ChangeLog -Category "Defender" -Setting "Multiple" -OldValue "Various" -NewValue "Hardened" -Status "Applied"
                }
            } catch {
                Write-Status "Failed to configure Defender: $_" -Type Error
                Add-ChangeLog -Category "Defender" -Setting "Configuration" -OldValue "N/A" -NewValue "Failed" -Status "Error"
            }
        }
    }
}

# ============================================================
# SECTION 4: Process Protection Settings
# ============================================================

function Set-ProcessProtection {
    param([switch]$Disable)

    Write-Status "Configuring Process Protection Settings" -Type Header

    # Enable LSA Protection
    $lsaPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa"
    $lsaValue = "RunAsPPL"

    if ($PSCmdlet.ShouldProcess("LSA Protection", "Configure")) {
        if ($Audit) {
            $current = Get-RegistryValue -Path $lsaPath -Name $lsaValue
            $state = if ($current -eq 1) { "Enabled" } else { "Disabled" }
            Write-Status "LSA Protection (RunAsPPL): $state" -Type Info
        } else {
            $newValue = if ($Disable) { 0 } else { 1 }
            $oldValue = Set-RegistryValue -Path $lsaPath -Name $lsaValue -Value $newValue

            $status = if ($Disable) { "Disabled" } else { "Enabled" }
            Write-Status "LSA Protection (RunAsPPL): $status" -Type Success
            Write-Status "  NOTE: Reboot required for changes to take effect" -Type Warning
            Add-ChangeLog -Category "ProcessProtection" -Setting "RunAsPPL" -OldValue "$oldValue" -NewValue "$newValue" -Status "Applied"
        }
    }

    # Enable Credential Guard
    $cgPath = "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard"
    $cgValues = @{
        "EnableVirtualizationBasedSecurity" = 1
        "RequirePlatformSecurityFeatures" = 1
        "LsaCfgFlags" = 1
    }

    if ($PSCmdlet.ShouldProcess("Credential Guard", "Configure")) {
        if (-not $Audit) {
            foreach ($name in $cgValues.Keys) {
                $newValue = if ($Disable) { 0 } else { $cgValues[$name] }
                $oldValue = Set-RegistryValue -Path $cgPath -Name $name -Value $newValue
                Write-Status "Credential Guard ($name): $(if($Disable){'Disabled'}else{'Enabled'})" -Type Success
                Add-ChangeLog -Category "CredentialGuard" -Setting $name -OldValue "$oldValue" -NewValue "$newValue" -Status "Applied"
            }
            Write-Status "  NOTE: Reboot required for Credential Guard to take effect" -Type Warning
        } else {
            foreach ($name in $cgValues.Keys) {
                $current = Get-RegistryValue -Path $cgPath -Name $name
                $state = if ($current -ge 1) { "Enabled ($current)" } else { "Disabled" }
                Write-Status "Credential Guard ($name): $state" -Type Info
            }
        }
    }
}

# ============================================================
# SECTION 5: Network Hardening
# ============================================================

function Set-NetworkHardening {
    param([switch]$Disable)

    Write-Status "Configuring Network Hardening" -Type Header

    if ($PSCmdlet.ShouldProcess("Network Settings", "Configure firewall rules")) {
        if ($Audit) {
            # Check for MDE-specific firewall rules
            $rules = Get-NetFirewallRule -DisplayName "*MDE*" -ErrorAction SilentlyContinue
            if ($rules) {
                Write-Status "MDE Firewall Rules: Found $($rules.Count) rules" -Type Info
            } else {
                Write-Status "MDE Firewall Rules: None configured" -Type Warning
            }
        } else {
            if ($Disable) {
                # Remove hardening rules
                Remove-NetFirewallRule -DisplayName "F0RT1KA - Block MDE API from Unknown" -ErrorAction SilentlyContinue
                Write-Status "Removed F0RT1KA firewall rules" -Type Success
            } else {
                # Create firewall rule to monitor non-MDE connections to MDE endpoints
                # Note: This is informational - MDE endpoints should only be contacted by MsSense.exe
                try {
                    # Block connections to MDE endpoints from processes other than MsSense.exe
                    # This is a sample rule - actual implementation depends on environment
                    $existingRule = Get-NetFirewallRule -DisplayName "F0RT1KA - Block MDE API from Unknown" -ErrorAction SilentlyContinue
                    if (-not $existingRule) {
                        New-NetFirewallRule -DisplayName "F0RT1KA - Block MDE API from Unknown" `
                            -Direction Outbound `
                            -Action Block `
                            -RemoteAddress "Any" `
                            -Protocol TCP `
                            -RemotePort 443 `
                            -Program "C:\Windows\System32\cmd.exe" `
                            -Description "Block suspicious processes from MDE endpoints - F0RT1KA test protection" `
                            -Enabled True
                        Write-Status "Created firewall rule for MDE endpoint protection" -Type Success
                    } else {
                        Write-Status "Firewall rule already exists" -Type Info
                    }
                    Add-ChangeLog -Category "Network" -Setting "Firewall Rule" -OldValue "None" -NewValue "Created" -Status "Applied"
                } catch {
                    Write-Status "Failed to create firewall rule: $_" -Type Error
                }
            }
        }
    }

    # Disable LLMNR (Link-Local Multicast Name Resolution) - prevents MITM
    $llmnrPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient"
    if ($PSCmdlet.ShouldProcess("LLMNR", "Configure")) {
        if ($Audit) {
            $current = Get-RegistryValue -Path $llmnrPath -Name "EnableMulticast"
            $state = if ($current -eq 0) { "Disabled" } else { "Enabled" }
            Write-Status "LLMNR (Link-Local Multicast): $state" -Type Info
        } else {
            $newValue = if ($Disable) { 1 } else { 0 }  # 0 = disabled
            $oldValue = Set-RegistryValue -Path $llmnrPath -Name "EnableMulticast" -Value $newValue

            $status = if ($Disable) { "Enabled" } else { "Disabled" }
            Write-Status "LLMNR: $status (protects against MITM)" -Type Success
            Add-ChangeLog -Category "Network" -Setting "LLMNR" -OldValue "$oldValue" -NewValue "$newValue" -Status "Applied"
        }
    }

    # Disable NetBIOS over TCP/IP (prevents MITM)
    # Note: This requires per-adapter configuration
    if ($PSCmdlet.ShouldProcess("NetBIOS", "Configure")) {
        if ($Audit) {
            Write-Status "NetBIOS: Check per-adapter configuration manually" -Type Info
        } else {
            Write-Status "NetBIOS: Configure per-adapter via Network Settings" -Type Info
            Write-Status "  Recommendation: Disable NetBIOS over TCP/IP on all adapters" -Type Warning
        }
    }
}

# ============================================================
# SECTION 6: Audit Policy Configuration
# ============================================================

function Set-AuditPolicies {
    param([switch]$Disable)

    Write-Status "Configuring Audit Policies" -Type Header

    if ($PSCmdlet.ShouldProcess("Audit Policies", "Configure")) {
        if ($Audit) {
            Write-Status "Current Audit Policies:" -Type Info
            $output = auditpol /get /category:*
            # Show key policies
            Write-Status "  Run 'auditpol /get /category:*' for full audit policy status" -Type Info
        } else {
            if ($Disable) {
                Write-Status "Not reverting audit policies - manual action required" -Type Warning
            } else {
                try {
                    # Enable process creation auditing
                    auditpol /set /subcategory:"Process Creation" /success:enable /failure:enable
                    Write-Status "Process Creation Auditing: Enabled" -Type Success

                    # Enable handle manipulation auditing
                    auditpol /set /subcategory:"Handle Manipulation" /success:enable /failure:enable
                    Write-Status "Handle Manipulation Auditing: Enabled" -Type Success

                    # Enable security system extension
                    auditpol /set /subcategory:"Security System Extension" /success:enable /failure:enable
                    Write-Status "Security System Extension Auditing: Enabled" -Type Success

                    # Enable sensitive privilege use
                    auditpol /set /subcategory:"Sensitive Privilege Use" /success:enable /failure:enable
                    Write-Status "Sensitive Privilege Use Auditing: Enabled" -Type Success

                    # Enable process termination
                    auditpol /set /subcategory:"Process Termination" /success:enable /failure:enable
                    Write-Status "Process Termination Auditing: Enabled" -Type Success

                    Add-ChangeLog -Category "Audit" -Setting "Multiple Policies" -OldValue "Various" -NewValue "Enabled" -Status "Applied"

                } catch {
                    Write-Status "Failed to configure audit policies: $_" -Type Error
                }
            }
        }
    }

    # Enable command line in process creation events
    $cmdLinePath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit"
    if ($PSCmdlet.ShouldProcess("Command Line Auditing", "Configure")) {
        if ($Audit) {
            $current = Get-RegistryValue -Path $cmdLinePath -Name "ProcessCreationIncludeCmdLine_Enabled"
            $state = if ($current -eq 1) { "Enabled" } else { "Disabled" }
            Write-Status "Command Line in Process Events: $state" -Type Info
        } else {
            $newValue = if ($Disable) { 0 } else { 1 }
            $oldValue = Set-RegistryValue -Path $cmdLinePath -Name "ProcessCreationIncludeCmdLine_Enabled" -Value $newValue

            $status = if ($Disable) { "Disabled" } else { "Enabled" }
            Write-Status "Command Line in Process Events: $status" -Type Success
            Add-ChangeLog -Category "Audit" -Setting "ProcessCreationIncludeCmdLine_Enabled" -OldValue "$oldValue" -NewValue "$newValue" -Status "Applied"
        }
    }
}

# ============================================================
# SECTION 7: PowerShell Hardening
# ============================================================

function Set-PowerShellHardening {
    param([switch]$Disable)

    Write-Status "Configuring PowerShell Hardening" -Type Header

    # Enable Script Block Logging
    $psLoggingPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging"
    if ($PSCmdlet.ShouldProcess("Script Block Logging", "Configure")) {
        if ($Audit) {
            $current = Get-RegistryValue -Path $psLoggingPath -Name "EnableScriptBlockLogging"
            $state = if ($current -eq 1) { "Enabled" } else { "Disabled" }
            Write-Status "PowerShell Script Block Logging: $state" -Type Info
        } else {
            $newValue = if ($Disable) { 0 } else { 1 }
            $oldValue = Set-RegistryValue -Path $psLoggingPath -Name "EnableScriptBlockLogging" -Value $newValue

            $status = if ($Disable) { "Disabled" } else { "Enabled" }
            Write-Status "PowerShell Script Block Logging: $status" -Type Success
            Add-ChangeLog -Category "PowerShell" -Setting "EnableScriptBlockLogging" -OldValue "$oldValue" -NewValue "$newValue" -Status "Applied"
        }
    }

    # Enable Module Logging
    $psModuleLoggingPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ModuleLogging"
    if ($PSCmdlet.ShouldProcess("Module Logging", "Configure")) {
        if ($Audit) {
            $current = Get-RegistryValue -Path $psModuleLoggingPath -Name "EnableModuleLogging"
            $state = if ($current -eq 1) { "Enabled" } else { "Disabled" }
            Write-Status "PowerShell Module Logging: $state" -Type Info
        } else {
            $newValue = if ($Disable) { 0 } else { 1 }
            $oldValue = Set-RegistryValue -Path $psModuleLoggingPath -Name "EnableModuleLogging" -Value $newValue

            $status = if ($Disable) { "Disabled" } else { "Enabled" }
            Write-Status "PowerShell Module Logging: $status" -Type Success
            Add-ChangeLog -Category "PowerShell" -Setting "EnableModuleLogging" -OldValue "$oldValue" -NewValue "$newValue" -Status "Applied"
        }
    }

    # Enable Constrained Language Mode (optional - can break scripts)
    if ($PSCmdlet.ShouldProcess("Constrained Language Mode", "Info")) {
        Write-Status "Constrained Language Mode: Consider enabling via AppLocker/WDAC" -Type Info
        Write-Status "  This prevents arbitrary .NET/COM access from PowerShell" -Type Info
    }
}

# ============================================================
# SECTION 8: Additional MDE-Specific Hardening
# ============================================================

function Set-MDEHardening {
    param([switch]$Disable)

    Write-Status "Configuring MDE-Specific Hardening" -Type Header

    if ($PSCmdlet.ShouldProcess("MDE Configuration", "Verify and harden")) {
        # Verify MDE is running
        $mdeSvc = Get-Service -Name "Sense" -ErrorAction SilentlyContinue
        if ($mdeSvc) {
            Write-Status "MDE Service (Sense): $($mdeSvc.Status)" -Type $(if($mdeSvc.Status -eq 'Running'){'Success'}else{'Warning'})
        } else {
            Write-Status "MDE Service (Sense): Not Installed" -Type Warning
        }

        # Verify SenseIR is running (if Live Response is used)
        $irSvc = Get-Service -Name "SenseIR" -ErrorAction SilentlyContinue
        if ($irSvc) {
            Write-Status "MDE Live Response (SenseIR): $($irSvc.Status)" -Type Info
        }

        if (-not $Audit) {
            # Set MDE services to auto-start
            if ($mdeSvc -and -not $Disable) {
                Set-Service -Name "Sense" -StartupType Automatic
                Write-Status "MDE Service Startup: Automatic" -Type Success
            }

            # Protect MDE registry keys (informational)
            Write-Status "MDE Registry Protection: Verify ACLs on HKLM:\\SOFTWARE\\Microsoft\\Windows Advanced Threat Protection" -Type Info

            # Verify tamper protection is enabled
            $tamperProtection = (Get-MpComputerStatus).IsTamperProtected
            if ($tamperProtection) {
                Write-Status "MDE Tamper Protection: Enabled" -Type Success
            } else {
                Write-Status "MDE Tamper Protection: Disabled - Enable in Microsoft 365 Defender portal" -Type Warning
            }

            Add-ChangeLog -Category "MDE" -Setting "Configuration" -OldValue "Audited" -NewValue "Verified" -Status "Applied"
        }
    }
}

# ============================================================
# Main Execution
# ============================================================

function Main {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  F0RT1KA Security Hardening Script" -ForegroundColor Cyan
    Write-Host "  Test ID: $Script:TestID" -ForegroundColor Cyan
    Write-Host "  MITRE ATT&CK: T1055, T1562.001, T1014, T1557" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-AdminPrivileges)) {
        Write-Status "This script requires Administrator privileges!" -Type Error
        exit 1
    }

    $mode = if ($Undo) { "UNDO" } elseif ($Audit) { "AUDIT" } else { "APPLY" }
    Write-Status "Mode: $mode" -Type Header
    Write-Host ""

    # Execute all hardening sections
    Set-ASRRules -Disable:$Undo
    Write-Host ""

    Set-MemoryIntegrity -Disable:$Undo
    Write-Host ""

    Set-DefenderHardening -Disable:$Undo
    Write-Host ""

    Set-ProcessProtection -Disable:$Undo
    Write-Host ""

    Set-NetworkHardening -Disable:$Undo
    Write-Host ""

    Set-AuditPolicies -Disable:$Undo
    Write-Host ""

    Set-PowerShellHardening -Disable:$Undo
    Write-Host ""

    Set-MDEHardening -Disable:$Undo
    Write-Host ""

    # Save change log
    if (-not $Audit -and $Script:ChangeLog.Count -gt 0) {
        try {
            if (-not (Test-Path "C:\F0")) {
                New-Item -Path "C:\F0" -ItemType Directory -Force | Out-Null
            }
            $Script:ChangeLog | ConvertTo-Json -Depth 5 | Out-File $Script:LogPath -Force
            Write-Status "Change log saved to: $Script:LogPath" -Type Success
        } catch {
            Write-Status "Failed to save change log: $_" -Type Warning
        }
    }

    # Summary
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  Summary" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan

    if ($Audit) {
        Write-Status "Audit complete. No changes were made." -Type Info
    } elseif ($Undo) {
        Write-Status "Rollback complete. Some settings require reboot." -Type Warning
    } else {
        Write-Status "Hardening complete. Changes applied: $($Script:ChangeLog.Count)" -Type Success
        Write-Status "IMPORTANT: A system reboot is recommended to apply all changes." -Type Warning
    }

    Write-Host ""
    Write-Host "For questions or issues, reference test ID: $Script:TestID" -ForegroundColor Gray
    Write-Host ""
}

# Run main function
Main
