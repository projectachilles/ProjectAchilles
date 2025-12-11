<#
.SYNOPSIS
    EDRSilencer Defense Hardening Script

.DESCRIPTION
    Implements defensive hardening measures to protect against EDRSilencer and
    similar defense evasion tools that use Windows Filtering Platform (WFP) to
    block EDR communications.

    Test ID: bcba14e7-6f87-4cbd-9c32-718fdeb39b65
    MITRE ATT&CK: T1562.001 - Impair Defenses: Disable or Modify Tools
    Mitigations: M1047, M1038, M1022, M1024, M1018

    Hardening measures implemented:
    1. Enable Windows Filtering Platform audit logging
    2. Enable process creation auditing
    3. Configure Windows Defender tamper protection
    4. Enable command line logging for process creation
    5. Configure ASR rules for defense evasion prevention
    6. Set up monitoring for c:\F0 staging directory
    7. Configure WFP-related security settings

.PARAMETER Undo
    Reverts all changes made by this script

.PARAMETER WhatIf
    Shows what would happen without making changes

.PARAMETER SkipRestart
    Skip prompting for restart even if recommended

.EXAMPLE
    .\bcba14e7-6f87-4cbd-9c32-718fdeb39b65_hardening.ps1
    Applies all hardening settings

.EXAMPLE
    .\bcba14e7-6f87-4cbd-9c32-718fdeb39b65_hardening.ps1 -WhatIf
    Shows what changes would be made without applying them

.EXAMPLE
    .\bcba14e7-6f87-4cbd-9c32-718fdeb39b65_hardening.ps1 -Undo
    Reverts all hardening settings to defaults

.NOTES
    Author: F0RT1KA Defense Guidance Builder
    Date: 2024-12-07
    Requires: Administrator privileges
    Idempotent: Yes (safe to run multiple times)
    Test ID: bcba14e7-6f87-4cbd-9c32-718fdeb39b65
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo,
    [switch]$SkipRestart
)

#Requires -RunAsAdministrator

# ============================================================
# Configuration
# ============================================================
$ErrorActionPreference = "Continue"
$Script:ChangeLog = @()
$Script:RestartRecommended = $false

$Script:TestID = "bcba14e7-6f87-4cbd-9c32-718fdeb39b65"
$Script:LogFile = "$env:TEMP\F0RT1KA_Hardening_$($Script:TestID)_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

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
        Info    = "Cyan"
        Success = "Green"
        Warning = "Yellow"
        Error   = "Red"
        Header  = "Magenta"
    }

    $prefix = switch ($Type) {
        "Info"    { "[*]" }
        "Success" { "[+]" }
        "Warning" { "[!]" }
        "Error"   { "[-]" }
        "Header"  { "[=]" }
    }

    $logMessage = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $prefix $Message"
    Write-Host "$prefix $Message" -ForegroundColor $colors[$Type]
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

function Set-RegistryValueSafe {
    param(
        [string]$Path,
        [string]$Name,
        [object]$Value,
        [string]$Type = "DWord"
    )

    try {
        # Create path if it doesn't exist
        if (-not (Test-Path $Path)) {
            New-Item -Path $Path -Force | Out-Null
            Write-Status "Created registry path: $Path" "Info"
        }

        $oldValue = Test-RegistryValue -Path $Path -Name $Name

        if ($PSCmdlet.ShouldProcess("$Path\$Name", "Set value to $Value")) {
            Set-ItemProperty -Path $Path -Name $Name -Value $Value -Type $Type -Force
            Add-ChangeLog -Action "Set Registry" -Target "$Path\$Name" -OldValue $oldValue -NewValue $Value
            return $true
        }
    }
    catch {
        Write-Status "Failed to set $Path\$Name : $_" "Error"
        return $false
    }

    return $false
}

# ============================================================
# Hardening Functions
# ============================================================

function Enable-WFPAuditLogging {
    <#
    .SYNOPSIS
        Enables Windows Filtering Platform audit logging
    .DESCRIPTION
        Enables audit logging for WFP filter operations to detect
        unauthorized filter creation/deletion
    #>

    Write-Status "Configuring Windows Filtering Platform Audit Logging..." "Header"

    if ($Undo) {
        # Disable WFP auditing
        if ($PSCmdlet.ShouldProcess("WFP Auditing", "Disable")) {
            auditpol /set /subcategory:"Filtering Platform Packet Drop" /success:disable /failure:disable 2>$null
            auditpol /set /subcategory:"Filtering Platform Connection" /success:disable /failure:disable 2>$null
            auditpol /set /subcategory:"Filtering Platform Policy Change" /success:disable /failure:disable 2>$null
            Write-Status "WFP audit logging disabled" "Success"
        }
    }
    else {
        # Enable WFP auditing for filter changes
        if ($PSCmdlet.ShouldProcess("WFP Auditing", "Enable")) {
            # Audit filter additions and deletions
            auditpol /set /subcategory:"Filtering Platform Packet Drop" /success:enable /failure:enable 2>$null
            auditpol /set /subcategory:"Filtering Platform Connection" /success:enable /failure:enable 2>$null
            auditpol /set /subcategory:"Filtering Platform Policy Change" /success:enable /failure:enable 2>$null

            Write-Status "WFP audit logging enabled" "Success"
            Add-ChangeLog -Action "Enable WFP Auditing" -Target "Audit Policy" -OldValue "Disabled" -NewValue "Enabled"
        }
    }
}

function Enable-ProcessCreationAuditing {
    <#
    .SYNOPSIS
        Enables process creation auditing with command line logging
    .DESCRIPTION
        Enables audit logging for process creation events including
        full command line arguments (Event ID 4688)
    #>

    Write-Status "Configuring Process Creation Audit Logging..." "Header"

    $registryPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit"

    if ($Undo) {
        if ($PSCmdlet.ShouldProcess("Process Creation Auditing", "Disable")) {
            auditpol /set /subcategory:"Process Creation" /success:disable /failure:disable 2>$null
            Set-RegistryValueSafe -Path $registryPath -Name "ProcessCreationIncludeCmdLine_Enabled" -Value 0
            Write-Status "Process creation auditing disabled" "Success"
        }
    }
    else {
        if ($PSCmdlet.ShouldProcess("Process Creation Auditing", "Enable")) {
            # Enable process creation auditing
            auditpol /set /subcategory:"Process Creation" /success:enable /failure:enable 2>$null

            # Enable command line in process creation events
            Set-RegistryValueSafe -Path $registryPath -Name "ProcessCreationIncludeCmdLine_Enabled" -Value 1

            Write-Status "Process creation auditing enabled with command line logging" "Success"
            Add-ChangeLog -Action "Enable Process Auditing" -Target "Audit Policy" -OldValue "Disabled" -NewValue "Enabled"
        }
    }
}

function Enable-DefenderTamperProtection {
    <#
    .SYNOPSIS
        Verifies and recommends Windows Defender Tamper Protection
    .DESCRIPTION
        Tamper Protection prevents unauthorized changes to Defender settings.
        Note: This must be enabled via Security Center or cloud management.
    #>

    Write-Status "Checking Windows Defender Tamper Protection..." "Header"

    try {
        $mpStatus = Get-MpPreference -ErrorAction Stop
        $tamperEnabled = (Get-MpComputerStatus -ErrorAction Stop).IsTamperProtected

        if ($tamperEnabled) {
            Write-Status "Tamper Protection is ENABLED" "Success"
        }
        else {
            Write-Status "Tamper Protection is DISABLED - This should be enabled via cloud management" "Warning"
            Write-Status "To enable: Windows Security > Virus & threat protection > Tamper Protection" "Info"

            # Note: Cannot enable via PowerShell - requires cloud management or manual enable
            if (-not $Undo) {
                Add-ChangeLog -Action "Check Tamper Protection" -Target "Defender" -OldValue "Disabled" -NewValue "Requires manual enable"
            }
        }
    }
    catch {
        Write-Status "Could not check Defender status: $_" "Warning"
    }
}

function Enable-DefenderRealTimeProtection {
    <#
    .SYNOPSIS
        Enables Windows Defender real-time protection
    .DESCRIPTION
        Ensures real-time protection is enabled to detect malicious binaries
    #>

    Write-Status "Configuring Windows Defender Real-Time Protection..." "Header"

    try {
        $mpPrefs = Get-MpPreference -ErrorAction Stop

        if ($Undo) {
            Write-Status "Real-time protection state not modified (security risk)" "Warning"
        }
        else {
            if ($mpPrefs.DisableRealtimeMonitoring) {
                if ($PSCmdlet.ShouldProcess("Real-Time Protection", "Enable")) {
                    Set-MpPreference -DisableRealtimeMonitoring $false
                    Write-Status "Real-time protection enabled" "Success"
                    Add-ChangeLog -Action "Enable RTP" -Target "Defender" -OldValue "Disabled" -NewValue "Enabled"
                }
            }
            else {
                Write-Status "Real-time protection already enabled" "Success"
            }

            # Enable behavior monitoring
            if ($mpPrefs.DisableBehaviorMonitoring) {
                if ($PSCmdlet.ShouldProcess("Behavior Monitoring", "Enable")) {
                    Set-MpPreference -DisableBehaviorMonitoring $false
                    Write-Status "Behavior monitoring enabled" "Success"
                }
            }
        }
    }
    catch {
        Write-Status "Could not configure Defender: $_" "Warning"
    }
}

function Configure-ASRRules {
    <#
    .SYNOPSIS
        Configures Attack Surface Reduction rules for defense evasion prevention
    .DESCRIPTION
        Enables ASR rules that help prevent execution of malicious tools
    #>

    Write-Status "Configuring Attack Surface Reduction Rules..." "Header"

    # ASR Rule GUIDs relevant to this attack
    $asrRules = @{
        # Block executable content from email client and webmail
        "BE9BA2D9-53EA-4CDC-84E5-9B1EEEE46550" = "Block executable content from email"
        # Block all Office applications from creating child processes
        "D4F940AB-401B-4EFC-AADC-AD5F3C50688A" = "Block Office child processes"
        # Block untrusted and unsigned processes from USB
        "B2B3F03D-6A65-4F7B-A9C7-1C7EF74A9BA4" = "Block untrusted USB processes"
        # Block executable files from running unless they meet prevalence, age, or trusted list criteria
        "01443614-CD74-433A-B99E-2ECDC07BFC25" = "Block executable prevalence"
        # Block process creations originating from PSExec and WMI commands
        "D1E49AAC-8F56-4280-B9BA-993A6D77406C" = "Block PSExec/WMI process creation"
        # Block persistence through WMI event subscription
        "E6DB77E5-3DF2-4CF1-B95A-636979351E5B" = "Block WMI persistence"
    }

    try {
        if ($Undo) {
            if ($PSCmdlet.ShouldProcess("ASR Rules", "Disable")) {
                foreach ($ruleId in $asrRules.Keys) {
                    Add-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -AttackSurfaceReductionRules_Actions Disabled -ErrorAction SilentlyContinue
                }
                Write-Status "ASR rules disabled" "Success"
            }
        }
        else {
            if ($PSCmdlet.ShouldProcess("ASR Rules", "Enable in Block mode")) {
                foreach ($ruleId in $asrRules.Keys) {
                    $ruleName = $asrRules[$ruleId]
                    Add-MpPreference -AttackSurfaceReductionRules_Ids $ruleId -AttackSurfaceReductionRules_Actions Enabled -ErrorAction SilentlyContinue
                    Write-Status "Enabled ASR rule: $ruleName" "Info"
                }
                Write-Status "ASR rules configured" "Success"
                Add-ChangeLog -Action "Enable ASR Rules" -Target "Defender" -OldValue "Various" -NewValue "Enabled (Block)"
            }
        }
    }
    catch {
        Write-Status "Could not configure ASR rules: $_" "Warning"
    }
}

function Configure-F0DirectoryMonitoring {
    <#
    .SYNOPSIS
        Sets up monitoring for the c:\F0 staging directory
    .DESCRIPTION
        Creates audit rules to monitor file creation in the F0RT1KA staging directory
    #>

    Write-Status "Configuring F0 Directory Monitoring..." "Header"

    $f0Path = "C:\F0"

    if ($Undo) {
        if ($PSCmdlet.ShouldProcess("F0 Directory Audit", "Remove")) {
            if (Test-Path $f0Path) {
                $acl = Get-Acl $f0Path
                $acl.SetAuditRuleProtection($false, $true)
                # Remove audit rules
                $auditRules = $acl.GetAuditRules($true, $true, [System.Security.Principal.SecurityIdentifier])
                foreach ($rule in $auditRules) {
                    $acl.RemoveAuditRule($rule) | Out-Null
                }
                Set-Acl -Path $f0Path -AclObject $acl
                Write-Status "F0 directory auditing removed" "Success"
            }
        }
    }
    else {
        # Create F0 directory if it doesn't exist (for audit rule application)
        if (-not (Test-Path $f0Path)) {
            if ($PSCmdlet.ShouldProcess($f0Path, "Create directory")) {
                New-Item -ItemType Directory -Path $f0Path -Force | Out-Null
                Write-Status "Created $f0Path directory" "Info"
            }
        }

        if ($PSCmdlet.ShouldProcess($f0Path, "Configure audit rules")) {
            try {
                # Enable Object Access auditing first
                auditpol /set /subcategory:"File System" /success:enable /failure:enable 2>$null

                # Set SACL on F0 directory
                $acl = Get-Acl $f0Path

                # Audit rule for Everyone - Write actions
                $auditRule = New-Object System.Security.AccessControl.FileSystemAuditRule(
                    "Everyone",
                    "Write,CreateFiles,AppendData,Delete,DeleteSubdirectoriesAndFiles",
                    "ContainerInherit,ObjectInherit",
                    "None",
                    "Success,Failure"
                )

                $acl.AddAuditRule($auditRule)
                Set-Acl -Path $f0Path -AclObject $acl

                Write-Status "F0 directory audit rules configured" "Success"
                Add-ChangeLog -Action "Configure F0 Monitoring" -Target $f0Path -OldValue "No audit" -NewValue "Write audit enabled"
            }
            catch {
                Write-Status "Could not configure F0 directory auditing: $_" "Warning"
            }
        }
    }
}

function Configure-WFPRegistryProtection {
    <#
    .SYNOPSIS
        Configures registry auditing for WFP-related keys
    .DESCRIPTION
        Sets up auditing on registry keys that control WFP behavior
    #>

    Write-Status "Configuring WFP Registry Protection..." "Header"

    $wfpRegPaths = @(
        "HKLM:\SYSTEM\CurrentControlSet\Services\BFE",
        "HKLM:\SYSTEM\CurrentControlSet\Services\mpssvc"
    )

    if ($Undo) {
        Write-Status "Registry audit rules not modified (preservation for security)" "Info"
    }
    else {
        if ($PSCmdlet.ShouldProcess("WFP Registry Keys", "Configure audit rules")) {
            # Enable registry auditing
            auditpol /set /subcategory:"Registry" /success:enable /failure:enable 2>$null

            foreach ($regPath in $wfpRegPaths) {
                if (Test-Path $regPath) {
                    Write-Status "Registry path exists: $regPath" "Info"
                    # Note: Setting SACL on registry requires specific permissions
                    # This is typically done via Group Policy for consistency
                }
            }

            Write-Status "WFP registry auditing configured via audit policy" "Success"
            Add-ChangeLog -Action "Enable Registry Auditing" -Target "WFP Keys" -OldValue "Disabled" -NewValue "Enabled"
        }
    }
}

function Configure-NetworkConnectionAuditing {
    <#
    .SYNOPSIS
        Enables network connection auditing
    .DESCRIPTION
        Enables auditing of network connections to detect blocked EDR communications
    #>

    Write-Status "Configuring Network Connection Auditing..." "Header"

    if ($Undo) {
        if ($PSCmdlet.ShouldProcess("Network Auditing", "Disable")) {
            auditpol /set /subcategory:"Filtering Platform Connection" /success:disable /failure:disable 2>$null
            Write-Status "Network connection auditing disabled" "Success"
        }
    }
    else {
        if ($PSCmdlet.ShouldProcess("Network Auditing", "Enable")) {
            auditpol /set /subcategory:"Filtering Platform Connection" /success:enable /failure:enable 2>$null
            Write-Status "Network connection auditing enabled" "Success"
            Add-ChangeLog -Action "Enable Network Auditing" -Target "Audit Policy" -OldValue "Disabled" -NewValue "Enabled"
        }
    }
}

function Set-PowerShellLogging {
    <#
    .SYNOPSIS
        Enables PowerShell script block and module logging
    .DESCRIPTION
        Enables comprehensive PowerShell logging to detect malicious scripts
    #>

    Write-Status "Configuring PowerShell Logging..." "Header"

    $psLogPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell"
    $scriptBlockPath = "$psLogPath\ScriptBlockLogging"
    $moduleLogPath = "$psLogPath\ModuleLogging"

    if ($Undo) {
        if ($PSCmdlet.ShouldProcess("PowerShell Logging", "Disable")) {
            Set-RegistryValueSafe -Path $scriptBlockPath -Name "EnableScriptBlockLogging" -Value 0
            Set-RegistryValueSafe -Path $moduleLogPath -Name "EnableModuleLogging" -Value 0
            Write-Status "PowerShell logging disabled" "Success"
        }
    }
    else {
        if ($PSCmdlet.ShouldProcess("PowerShell Logging", "Enable")) {
            # Enable Script Block Logging
            Set-RegistryValueSafe -Path $scriptBlockPath -Name "EnableScriptBlockLogging" -Value 1
            Set-RegistryValueSafe -Path $scriptBlockPath -Name "EnableScriptBlockInvocationLogging" -Value 1

            # Enable Module Logging
            Set-RegistryValueSafe -Path $moduleLogPath -Name "EnableModuleLogging" -Value 1

            # Log all modules
            $modulePath = "$moduleLogPath\ModuleNames"
            Set-RegistryValueSafe -Path $modulePath -Name "*" -Value "*" -Type "String"

            Write-Status "PowerShell logging enabled" "Success"
            Add-ChangeLog -Action "Enable PS Logging" -Target "PowerShell" -OldValue "Disabled" -NewValue "Enabled"
        }
    }
}

function Verify-SecurityServices {
    <#
    .SYNOPSIS
        Verifies security services are running
    .DESCRIPTION
        Checks that critical security services are running and set to auto-start
    #>

    Write-Status "Verifying Security Services..." "Header"

    $criticalServices = @(
        @{ Name = "WinDefend"; DisplayName = "Windows Defender Antivirus" },
        @{ Name = "Sense"; DisplayName = "Windows Defender ATP" },
        @{ Name = "BFE"; DisplayName = "Base Filtering Engine (WFP)" },
        @{ Name = "mpssvc"; DisplayName = "Windows Firewall" }
    )

    foreach ($svc in $criticalServices) {
        try {
            $service = Get-Service -Name $svc.Name -ErrorAction Stop
            $startType = (Get-WmiObject -Class Win32_Service -Filter "Name='$($svc.Name)'" -ErrorAction Stop).StartMode

            if ($service.Status -eq "Running") {
                Write-Status "$($svc.DisplayName): Running ($startType)" "Success"
            }
            else {
                Write-Status "$($svc.DisplayName): $($service.Status) ($startType)" "Warning"

                if (-not $Undo -and $PSCmdlet.ShouldProcess($svc.DisplayName, "Start service")) {
                    Start-Service -Name $svc.Name -ErrorAction SilentlyContinue
                }
            }
        }
        catch {
            Write-Status "$($svc.DisplayName): Not found or error" "Warning"
        }
    }
}

function Export-HardeningReport {
    <#
    .SYNOPSIS
        Exports a summary report of hardening changes
    .DESCRIPTION
        Creates a JSON report of all changes made by this script
    #>

    $reportPath = "$env:TEMP\F0RT1KA_Hardening_Report_$($Script:TestID)_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"

    $report = @{
        TestID       = $Script:TestID
        MitreAttack  = "T1562.001"
        Timestamp    = Get-Date -Format "o"
        Mode         = if ($Undo) { "Rollback" } else { "Hardening" }
        WhatIf       = $WhatIfPreference
        Changes      = $Script:ChangeLog
        RestartRecommended = $Script:RestartRecommended
    }

    $report | ConvertTo-Json -Depth 10 | Out-File -FilePath $reportPath -Encoding UTF8

    Write-Status "Hardening report exported to: $reportPath" "Info"
    return $reportPath
}

# ============================================================
# Main Execution
# ============================================================

Write-Status "============================================================" "Header"
if ($Undo) {
    Write-Status "F0RT1KA Defense Hardening - ROLLBACK MODE" "Header"
}
else {
    Write-Status "F0RT1KA Defense Hardening for EDRSilencer" "Header"
}
Write-Status "Test ID: $Script:TestID" "Header"
Write-Status "MITRE ATT&CK: T1562.001 - Impair Defenses" "Header"
Write-Status "============================================================" "Header"
Write-Host ""

# Check prerequisites
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Status "This script requires Administrator privileges" "Error"
    exit 1
}

# Execute hardening functions
try {
    Enable-WFPAuditLogging
    Write-Host ""

    Enable-ProcessCreationAuditing
    Write-Host ""

    Enable-DefenderTamperProtection
    Write-Host ""

    Enable-DefenderRealTimeProtection
    Write-Host ""

    Configure-ASRRules
    Write-Host ""

    Configure-F0DirectoryMonitoring
    Write-Host ""

    Configure-WFPRegistryProtection
    Write-Host ""

    Configure-NetworkConnectionAuditing
    Write-Host ""

    Set-PowerShellLogging
    Write-Host ""

    Verify-SecurityServices
    Write-Host ""

    # Export report
    $reportFile = Export-HardeningReport
    Write-Host ""

    # Summary
    Write-Status "============================================================" "Header"
    Write-Status "Hardening Complete" "Header"
    Write-Status "============================================================" "Header"
    Write-Status "Changes made: $($Script:ChangeLog.Count)" "Info"
    Write-Status "Log file: $Script:LogFile" "Info"
    Write-Status "Report file: $reportFile" "Info"

    if ($Script:RestartRecommended -and -not $SkipRestart) {
        Write-Host ""
        Write-Status "A system restart is recommended to apply all changes" "Warning"
        $restart = Read-Host "Restart now? (y/N)"
        if ($restart -eq "y") {
            Restart-Computer -Force
        }
    }

    Write-Host ""
    Write-Status "Recommended next steps:" "Info"
    Write-Status "1. Deploy detection rules from *_detections.kql to Microsoft Sentinel" "Info"
    Write-Status "2. Deploy LimaCharlie D&R rules from *_dr_rules.yaml" "Info"
    Write-Status "3. Test with F0RT1KA EDRSilencer test to validate protection" "Info"
    Write-Status "4. Review logs for false positives and tune detection thresholds" "Info"
}
catch {
    Write-Status "Error during hardening: $_" "Error"
    exit 1
}

# Return change log for automation
return $Script:ChangeLog
