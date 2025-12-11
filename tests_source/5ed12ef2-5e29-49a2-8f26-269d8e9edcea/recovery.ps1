# recovery.ps1 - Ransomware Test Recovery Script
# Cleans up all test artifacts from the ransomware simulation

param(
    [switch]$Force,
    [switch]$Verbose
)

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "F0RT1KA Ransomware Test Recovery Script" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check for admin privileges
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Set execution policy bypass
function Set-ExecutionPolicyBypass {
    try {
        Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        Write-Host "[!] Failed to bypass execution policy: $_" -ForegroundColor Red
        return $false
    }
}

# Initialize
if (-not (Test-Administrator)) {
    Write-Host "[!] This script should be run with Administrator privileges for full cleanup" -ForegroundColor Yellow
}

Set-ExecutionPolicyBypass | Out-Null

Write-Host "[*] Starting ransomware test artifact cleanup..." -ForegroundColor Green

# Define cleanup locations
$cleanupPaths = @(
    "C:\F0\test_documents",
    "C:\F0\*.f0rtika",
    "C:\F0\README_RANSOMWARE.txt",
    "C:\F0\YOUR_FILES_ENCRYPTED.html",
    "C:\F0\PAYMENT_INSTRUCTIONS.txt",
    "C:\F0\ENCRYPTION_COMPLETE.txt",
    "C:\F0\MASTER_KEY.key",
    "C:\F0\targets.list",
    "C:\F0\stage1_complete.marker",
    "C:\F0\crypto_engine.dat",
    "C:\F0\file_enum.dat",
    "C:\F0\ransom_core.dat",
    "C:\F0\ransomware_wallpaper.bmp",
    "C:\F0\5ed12ef2-5e29-49a2-8f26-269d8e9edcea-*.exe",
    "$env:USERPROFILE\Desktop\README_RANSOMWARE.txt",
    "$env:USERPROFILE\Desktop\YOUR_FILES_ENCRYPTED.html",
    "$env:USERPROFILE\Documents\README_RANSOMWARE.txt",
    "$env:USERPROFILE\Documents\YOUR_FILES_ENCRYPTED.html",
    "$env:USERPROFILE\README_RANSOMWARE.txt",
    "$env:USERPROFILE\YOUR_FILES_ENCRYPTED.html",
    "C:\Users\Public\Desktop\README_RANSOMWARE.txt",
    "C:\Users\Public\Desktop\YOUR_FILES_ENCRYPTED.html"
)

$removedCount = 0
$failedCount = 0

# Clean up files
foreach ($path in $cleanupPaths) {
    if ($Verbose) {
        Write-Host "[*] Checking: $path" -ForegroundColor Gray
    }

    if (Test-Path $path) {
        try {
            Remove-Item -Path $path -Force -Recurse -ErrorAction Stop
            $removedCount++
            Write-Host "[+] Removed: $path" -ForegroundColor Green
        } catch {
            $failedCount++
            Write-Host "[!] Failed to remove: $path - $_" -ForegroundColor Red
        }
    }
}

# Decrypt any remaining .f0rtika files (restore originals)
Write-Host ""
Write-Host "[*] Checking for encrypted test files..." -ForegroundColor Yellow

$encryptedFiles = Get-ChildItem -Path "C:\F0" -Filter "*.f0rtika" -ErrorAction SilentlyContinue

if ($encryptedFiles) {
    Write-Host "[*] Found $($encryptedFiles.Count) encrypted files" -ForegroundColor Yellow

    foreach ($file in $encryptedFiles) {
        $originalName = $file.FullName -replace '\.f0rtika$', ''

        # For test recovery, we'll just remove the encrypted files
        # In a real scenario, we'd decrypt them
        try {
            Remove-Item -Path $file.FullName -Force
            $removedCount++
            Write-Host "[+] Removed encrypted file: $($file.Name)" -ForegroundColor Green
        } catch {
            Write-Host "[!] Failed to remove: $($file.Name)" -ForegroundColor Red
        }
    }
}

# Restore wallpaper if modified
Write-Host ""
Write-Host "[*] Checking wallpaper settings..." -ForegroundColor Yellow

try {
    $regPath = "HKCU:\Control Panel\Desktop"
    $currentWallpaper = Get-ItemProperty -Path $regPath -Name Wallpaper -ErrorAction SilentlyContinue

    if ($currentWallpaper.Wallpaper -like "*ransomware_wallpaper*") {
        Write-Host "[!] Ransomware wallpaper detected - restoration needed" -ForegroundColor Yellow
        Write-Host "    Please manually restore your wallpaper through Windows Settings" -ForegroundColor Yellow
    }
} catch {
    # Registry access might fail, not critical
}

# Kill any remaining test processes
Write-Host ""
Write-Host "[*] Checking for test processes..." -ForegroundColor Yellow

$testProcesses = @(
    "5ed12ef2-5e29-49a2-8f26-269d8e9edcea*"
)

foreach ($procPattern in $testProcesses) {
    $procs = Get-Process -Name $procPattern -ErrorAction SilentlyContinue
    if ($procs) {
        foreach ($proc in $procs) {
            try {
                Stop-Process -Id $proc.Id -Force
                Write-Host "[+] Terminated process: $($proc.Name) (PID: $($proc.Id))" -ForegroundColor Green
            } catch {
                Write-Host "[!] Failed to terminate: $($proc.Name)" -ForegroundColor Red
            }
        }
    }
}

# Summary
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "RECOVERY SUMMARY" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Files removed:        $removedCount" -ForegroundColor Green
Write-Host "Failures:            $failedCount" -ForegroundColor Yellow

if ($failedCount -gt 0) {
    Write-Host ""
    Write-Host "[!] Some items could not be removed." -ForegroundColor Yellow
    Write-Host "    This might be due to permissions or files in use." -ForegroundColor Yellow
    Write-Host "    You may need to:" -ForegroundColor Yellow
    Write-Host "    1. Run this script as Administrator" -ForegroundColor Yellow
    Write-Host "    2. Reboot and run again" -ForegroundColor Yellow
    Write-Host "    3. Manually remove remaining items" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[+] Recovery complete!" -ForegroundColor Green
Write-Host ""

# Offer to open test directory for verification
if (-not $Force) {
    $response = Read-Host "Would you like to open C:\F0 to verify cleanup? (Y/N)"
    if ($response -eq 'Y' -or $response -eq 'y') {
        Start-Process explorer.exe "C:\F0"
    }
}