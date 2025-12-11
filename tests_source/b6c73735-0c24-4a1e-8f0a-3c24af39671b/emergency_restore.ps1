# emergency_restore.ps1 - Emergency recovery script for certificate bypass test
# This script provides a PowerShell-based fallback restoration mechanism
# Run this if the watchdog fails or the system is in an inconsistent state

param(
    [switch]$Force,
    [switch]$RestartServices,
    [switch]$CreateBackup,
    [string]$StateFile = "C:\F0\watchdog_state.json"
)

# Required admin privilege check function
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Required execution policy bypass function
function Set-ExecutionPolicyBypass {
    try {
        Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        Write-Host "[!] Failed to bypass execution policy: $_" -ForegroundColor Red
        return $false
    }
}

function Write-Banner {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "F0RT1KA Emergency Recovery Script" -ForegroundColor Cyan
    Write-Host "Certificate Bypass Test Restoration" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""
}

function Get-PatchState {
    param([string]$FilePath)

    if (-not (Test-Path $FilePath)) {
        Write-Host "[!] State file not found: $FilePath" -ForegroundColor Yellow
        return $null
    }

    try {
        $state = Get-Content $FilePath -Raw | ConvertFrom-Json
        return $state
    } catch {
        Write-Host "[!] Failed to read state file: $_" -ForegroundColor Red
        return $null
    }
}

function Test-ProcessRunning {
    param([int]$PID)

    try {
        $process = Get-Process -Id $PID -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Stop-MonitoredProcesses {
    Write-Host "[*] Checking for running test processes..." -ForegroundColor Cyan

    $testProcesses = @(
        "b6c73735-0c24-4a1e-8f0a-3c24af39671b",
        "fake_mssense",
        "isolation_spoofer",
        "cert_bypass_watchdog"
    )

    $stopped = 0
    foreach ($procName in $testProcesses) {
        $processes = Get-Process -Name $procName -ErrorAction SilentlyContinue
        foreach ($proc in $processes) {
            Write-Host "    [*] Stopping process: $($proc.Name) (PID: $($proc.Id))" -ForegroundColor Yellow
            try {
                Stop-Process -Id $proc.Id -Force
                $stopped++
            } catch {
                Write-Host "    [!] Failed to stop PID $($proc.Id): $_" -ForegroundColor Red
            }
        }
    }

    if ($stopped -gt 0) {
        Write-Host "[+] Stopped $stopped test process(es)" -ForegroundColor Green
        Start-Sleep -Seconds 2
    } else {
        Write-Host "[*] No test processes found running" -ForegroundColor Gray
    }
}

function Restore-MicrosoftDefenderServices {
    Write-Host ""
    Write-Host "[*] Checking Microsoft Defender services..." -ForegroundColor Cyan

    $services = @(
        @{Name="Sense"; DisplayName="Windows Defender Advanced Threat Protection Service"},
        @{Name="WinDefend"; DisplayName="Windows Defender Antivirus Service"},
        @{Name="WdNisSvc"; DisplayName="Windows Defender Network Inspection Service"}
    )

    foreach ($svc in $services) {
        try {
            $service = Get-Service -Name $svc.Name -ErrorAction Stop

            if ($service.Status -ne "Running") {
                Write-Host "    [!] Service '$($svc.DisplayName)' is $($service.Status)" -ForegroundColor Yellow

                if ($RestartServices -or $Force) {
                    Write-Host "    [*] Attempting to start service..." -ForegroundColor Cyan
                    try {
                        Start-Service -Name $svc.Name
                        Write-Host "    [+] Service started successfully" -ForegroundColor Green
                    } catch {
                        Write-Host "    [!] Failed to start service: $_" -ForegroundColor Red
                    }
                }
            } else {
                Write-Host "    [+] Service '$($svc.DisplayName)' is running" -ForegroundColor Green
            }
        } catch {
            Write-Host "    [*] Service '$($svc.Name)' not found (may not be installed)" -ForegroundColor Gray
        }
    }
}

function Remove-TestArtifacts {
    Write-Host ""
    Write-Host "[*] Cleaning up test artifacts..." -ForegroundColor Cyan

    $testDir = "C:\F0"

    if (-not (Test-Path $testDir)) {
        Write-Host "[*] Test directory not found, nothing to clean" -ForegroundColor Gray
        return
    }

    $artifacts = @(
        "mde_interceptor.ps1",
        "fake_mssense.exe",
        "fake_mssense.go",
        "fake_mssense_status.json",
        "isolation_spoofer.exe",
        "isolation_spoofer.go",
        "isolation_response.json",
        "spoofer_report.json",
        "interceptor_status.txt",
        "intercepted_commands.json",
        "spoof_result.json",
        "attack_summary.txt",
        "mde_config_dump.json",
        "watchdog_state.json",
        "RESTORE_NOW.flag"
    )

    $removed = 0
    foreach ($artifact in $artifacts) {
        $filePath = Join-Path $testDir $artifact
        if (Test-Path $filePath) {
            try {
                Remove-Item $filePath -Force
                Write-Host "    [+] Removed: $artifact" -ForegroundColor Green
                $removed++
            } catch {
                Write-Host "    [!] Failed to remove $artifact: $_" -ForegroundColor Red
            }
        }
    }

    if ($removed -eq 0) {
        Write-Host "[*] No test artifacts found to remove" -ForegroundColor Gray
    } else {
        Write-Host "[+] Removed $removed artifact(s)" -ForegroundColor Green
    }
}

function Create-SystemBackup {
    Write-Host ""
    Write-Host "[*] Creating system state backup..." -ForegroundColor Cyan

    $backupDir = "C:\F0\backups"
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupPath = Join-Path $backupDir "system_backup_$timestamp"

    New-Item -ItemType Directory -Path $backupPath -Force | Out-Null

    # Backup service states
    $services = Get-Service -Name "Sense","WinDefend","WdNisSvc" -ErrorAction SilentlyContinue
    $services | Select-Object Name, Status, StartType | ConvertTo-Json | Out-File "$backupPath\service_states.json"

    # Backup running processes
    Get-Process | Select-Object Name, Id, Path, StartTime | ConvertTo-Json | Out-File "$backupPath\processes.json"

    # Backup test state if exists
    if (Test-Path $StateFile) {
        Copy-Item $StateFile "$backupPath\watchdog_state.json"
    }

    Write-Host "[+] Backup created: $backupPath" -ForegroundColor Green
}

function Request-ManualRestore {
    Write-Host ""
    Write-Host "[*] Creating manual restore request flag..." -ForegroundColor Cyan

    $flagFile = "C:\F0\RESTORE_NOW.flag"
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    "MANUAL_RESTORE_REQUESTED: $timestamp" | Out-File $flagFile -Encoding ASCII

    Write-Host "[+] Restore request flag created: $flagFile" -ForegroundColor Green
    Write-Host "[*] If watchdog is running, it will detect this and perform restoration" -ForegroundColor Cyan
}

function Show-RestorationReport {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "RESTORATION SUMMARY" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan

    $reportFile = "C:\F0\restoration_report.txt"
    if (Test-Path $reportFile) {
        Write-Host ""
        Get-Content $reportFile
    } else {
        Write-Host "[*] No watchdog restoration report found" -ForegroundColor Gray
    }
}

function Show-RecommendedActions {
    param([bool]$RequiresReboot = $false)

    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "RECOMMENDED ACTIONS" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""

    if ($RequiresReboot) {
        Write-Host "[!] CRITICAL: System reboot recommended" -ForegroundColor Red
        Write-Host ""
        Write-Host "The following actions are recommended:" -ForegroundColor Yellow
        Write-Host "  1. Save all work" -ForegroundColor Yellow
        Write-Host "  2. Close all applications" -ForegroundColor Yellow
        Write-Host "  3. Restart the computer" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "To reboot now: Restart-Computer -Force" -ForegroundColor Cyan
    } else {
        Write-Host "[+] System appears stable" -ForegroundColor Green
        Write-Host ""
        Write-Host "Optional actions:" -ForegroundColor Cyan
        Write-Host "  - Run Windows Defender scan: Start-MpScan -ScanType QuickScan" -ForegroundColor Gray
        Write-Host "  - Check service status: Get-Service Sense,WinDefend" -ForegroundColor Gray
        Write-Host "  - Review event logs for issues" -ForegroundColor Gray
    }
}

# Main execution
function Main {
    Write-Banner

    # Check admin privileges
    if (-not (Test-Administrator)) {
        Write-Host "[!] ERROR: This script requires administrator privileges" -ForegroundColor Red
        Write-Host "[!] Please run PowerShell as Administrator and try again" -ForegroundColor Red
        exit 1
    }

    # Bypass execution policy
    Set-ExecutionPolicyBypass | Out-Null

    Write-Host "[+] Running with administrator privileges" -ForegroundColor Green
    Write-Host "[*] State file: $StateFile" -ForegroundColor Cyan
    Write-Host ""

    # Create backup if requested
    if ($CreateBackup) {
        Create-SystemBackup
    }

    # Load patch state
    $state = Get-PatchState -FilePath $StateFile

    if ($state) {
        Write-Host "[+] Loaded watchdog state" -ForegroundColor Green
        Write-Host "    Watchdog PID: $($state.WatchdogPID)" -ForegroundColor Gray
        Write-Host "    Monitored PID: $($state.MonitoredPID)" -ForegroundColor Gray
        Write-Host "    Status: $($state.Status)" -ForegroundColor Gray
        Write-Host "    Patches: $($state.Patches.Count)" -ForegroundColor Gray

        # Check if watchdog is still running
        if (Test-ProcessRunning -PID $state.WatchdogPID) {
            Write-Host ""
            Write-Host "[*] Watchdog process is still running (PID: $($state.WatchdogPID))" -ForegroundColor Cyan

            if (-not $Force) {
                Write-Host "[*] Watchdog should handle restoration automatically" -ForegroundColor Cyan
                Write-Host "[*] Use -Force flag to override and perform manual restoration" -ForegroundColor Yellow
                Request-ManualRestore
                Write-Host ""
                Write-Host "[+] Manual restore requested - watchdog will handle it" -ForegroundColor Green
                return
            } else {
                Write-Host "[!] Force flag specified - proceeding with manual restoration" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "[*] No state file found - performing general cleanup" -ForegroundColor Yellow
    }

    # Stop any running test processes
    Stop-MonitoredProcesses

    # Restore/restart MDE services
    Restore-MicrosoftDefenderServices

    # Clean up test artifacts
    if ($Force) {
        Remove-TestArtifacts
    } else {
        Write-Host ""
        Write-Host "[*] Skipping artifact cleanup (use -Force to remove)" -ForegroundColor Gray
    }

    # Show any existing restoration reports
    Show-RestorationReport

    # Determine if reboot is needed
    $requiresReboot = $false
    if ($state -and $state.Status -like "*PARTIAL*") {
        $requiresReboot = $true
    }

    # Show recommended actions
    Show-RecommendedActions -RequiresReboot $requiresReboot

    Write-Host ""
    Write-Host "[+] Emergency restoration procedure complete" -ForegroundColor Green
    Write-Host ""
}

# Execute main function
Main
