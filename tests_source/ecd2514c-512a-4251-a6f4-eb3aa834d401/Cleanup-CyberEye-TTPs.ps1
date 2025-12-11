#Requires -RunAsAdministrator
<#
.SYNOPSIS
    PowerShell script to revert registry changes made by CyberEye-TTPs.ps1 test script.
    Restores Windows Defender settings to their default protective state.
.DESCRIPTION
    This cleanup script removes registry modifications that disabled Windows Defender features
    during security testing. It ensures the system returns to a protected state after testing.
.WARNING
    - Requires administrative privileges
    - Should be run after completing CyberEye-TTPs.ps1 testing
    - May require disabling Tamper Protection via Windows Security UI first
.AUTHOR
    F0RT1KA Security Testing Framework
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
$logFile = "$env:TEMP\DefenderCleanup_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
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

Write-Log "Starting Windows Defender registry cleanup."

# Check and bypass execution policy if needed
Bypass-ExecutionPolicy

try {
    # Registry paths
    $defenderFeaturesPath = "HKLM:\SOFTWARE\Microsoft\Windows Defender\Features"
    $defenderPolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender"
    $realtimeProtectionPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection"

    # Re-enable Tamper Protection
    if (Test-Path $defenderFeaturesPath) {
        try {
            # Remove the TamperProtection value to allow Windows to manage it
            Remove-ItemProperty -Path $defenderFeaturesPath -Name "TamperProtection" -ErrorAction SilentlyContinue
            Write-Log "Removed TamperProtection override at $defenderFeaturesPath"
        }
        catch {
            Write-Log "Note: TamperProtection cleanup may require manual intervention: $($_.Exception.Message)"
        }
    }

    # Remove DisableAntiSpyware to re-enable Windows Defender
    if (Test-Path $defenderPolicyPath) {
        if (Get-ItemProperty -Path $defenderPolicyPath -Name "DisableAntiSpyware" -ErrorAction SilentlyContinue) {
            Remove-ItemProperty -Path $defenderPolicyPath -Name "DisableAntiSpyware" -ErrorAction Stop
            Write-Log "Removed DisableAntiSpyware from $defenderPolicyPath"
        }
        else {
            Write-Log "DisableAntiSpyware not found at $defenderPolicyPath"
        }
    }

    # Remove Real-Time Protection disabling settings
    if (Test-Path $realtimeProtectionPath) {
        $rtpSettings = @("DisableBehaviorMonitoring", "DisableOnAccessProtection", "DisableScanOnRealtimeEnable")
        
        foreach ($setting in $rtpSettings) {
            if (Get-ItemProperty -Path $realtimeProtectionPath -Name $setting -ErrorAction SilentlyContinue) {
                Remove-ItemProperty -Path $realtimeProtectionPath -Name $setting -ErrorAction Stop
                Write-Log "Removed $setting from $realtimeProtectionPath"
            }
            else {
                Write-Log "$setting not found at $realtimeProtectionPath"
            }
        }
        
        # Clean up empty registry keys
        $rtpItems = Get-ItemProperty -Path $realtimeProtectionPath -ErrorAction SilentlyContinue
        if (-not $rtpItems -or ($rtpItems.PSObject.Properties.Name -notlike "Disable*").Count -eq 0) {
            Remove-Item -Path $realtimeProtectionPath -Force -ErrorAction SilentlyContinue
            Write-Log "Removed empty registry key: $realtimeProtectionPath"
        }
    }

    # Clean up empty policy keys if no other policies exist
    if (Test-Path $defenderPolicyPath) {
        $policyItems = Get-ItemProperty -Path $defenderPolicyPath -ErrorAction SilentlyContinue
        $childKeys = Get-ChildItem -Path $defenderPolicyPath -ErrorAction SilentlyContinue
        if ((-not $policyItems -or $policyItems.PSObject.Properties.Name.Count -le 1) -and $childKeys.Count -eq 0) {
            Remove-Item -Path $defenderPolicyPath -Force -Recurse -ErrorAction SilentlyContinue
            Write-Log "Removed empty registry key: $defenderPolicyPath"
        }
    }

    Write-Log "Registry cleanup completed successfully."
    
    # Attempt to restart Windows Defender service
    Write-Log "Attempting to restart Windows Defender service..."
    try {
        Start-Service -Name "WinDefend" -ErrorAction Stop
        Write-Log "Windows Defender service started successfully."
    }
    catch {
        Write-Log "Note: Windows Defender service may require a system restart: $($_.Exception.Message)"
    }
}
catch {
    Write-Log "Error occurred during cleanup: $($_.Exception.Message)"
    Write-Error "Cleanup failed. Check $logFile for details."
    exit 1
}
finally {
    Write-Log "Cleanup script execution finished. Log file: $logFile"
}

# Display current Defender settings for verification
Write-Log "Querying current Windows Defender settings for verification."
try {
    $defenderSettings = Get-MpPreference -ErrorAction Stop
    Write-Log "Current Defender Settings after cleanup:"
    Write-Log "DisableRealtimeMonitoring: $($defenderSettings.DisableRealtimeMonitoring)"
    Write-Log "DisableBehaviorMonitoring: $($defenderSettings.DisableBehaviorMonitoring)"
    Write-Log "DisableOnAccessProtection: $($defenderSettings.DisableOnAccessProtection)"
    Write-Log "DisableScanOnRealtimeEnable: $($defenderSettings.DisableScanOnRealtimeEnable)"
    
    if ($defenderSettings.DisableRealtimeMonitoring -eq $false) {
        Write-Log "SUCCESS: Windows Defender Real-Time Protection is ENABLED."
        Write-Host "SUCCESS: Windows Defender has been restored to protected state." -ForegroundColor Green
    }
    else {
        Write-Log "WARNING: Windows Defender may still be partially disabled. Consider restarting the system."
        Write-Host "WARNING: Windows Defender may require a system restart to fully re-enable." -ForegroundColor Yellow
    }
}
catch {
    Write-Log "Failed to query Defender settings: $($_.Exception.Message)"
    Write-Log "This may indicate Windows Defender is not fully operational yet."
}

Write-Log "RECOMMENDATION: Restart the system to ensure all Windows Defender features are fully restored."
Write-Host "`nCLEANUP COMPLETE: Check $logFile for detailed results." -ForegroundColor Cyan