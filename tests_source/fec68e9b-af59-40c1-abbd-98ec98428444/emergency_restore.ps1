# Emergency Restore Script for MDE Memory Patch Testing
# SECURITY TESTING ONLY - Manual recovery for memory patch restoration
#
# This script provides emergency recovery if:
# - Test crashes before restoring patches
# - Watchdog fails to restore automatically
# - User needs immediate restoration
#
# Usage: .\emergency_restore.ps1 [-Force]
#
# ⚠️ WARNING: Must be run as Administrator

param(
    [switch]$Force
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

# Initialize
Set-ExecutionPolicyBypass | Out-Null

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   MDE Memory Patch Emergency Restoration Tool" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Check admin privileges
if (-not (Test-Administrator)) {
    Write-Host "[ERROR] This script requires Administrator privileges!" -ForegroundColor Red
    Write-Host "Please run as Administrator and try again." -ForegroundColor Yellow
    exit 1
}

Write-Host "[+] Running with Administrator privileges" -ForegroundColor Green

# Check for patch backup file
$backupPath = "C:\F0\patch_backup.json"

if (-not (Test-Path $backupPath)) {
    Write-Host ""
    Write-Host "[INFO] No patch backup file found at $backupPath" -ForegroundColor Yellow
    Write-Host "[INFO] This could mean:" -ForegroundColor Yellow
    Write-Host "  1. No patches were applied" -ForegroundColor Gray
    Write-Host "  2. Patches were already restored" -ForegroundColor Gray
    Write-Host "  3. Backup file was deleted" -ForegroundColor Gray
    Write-Host ""

    # Check watchdog state
    $watchdogStatePath = "C:\F0\watchdog_state.json"
    if (Test-Path $watchdogStatePath) {
        $watchdogState = Get-Content $watchdogStatePath | ConvertFrom-Json
        Write-Host "[INFO] Watchdog state:" -ForegroundColor Cyan
        Write-Host "  Status: $($watchdogState.status)" -ForegroundColor Gray
        Write-Host "  Patches Restored: $($watchdogState.patchesRestored)" -ForegroundColor Gray

        if ($watchdogState.patchesRestored -eq $true) {
            Write-Host ""
            Write-Host "[SUCCESS] Patches were already restored by watchdog!" -ForegroundColor Green
            exit 0
        }
    }

    Write-Host "[INFO] No restoration needed. System appears clean." -ForegroundColor Green
    exit 0
}

Write-Host "[!] Found patch backup file!" -ForegroundColor Yellow
Write-Host ""

# Read backup
try {
    $backup = Get-Content $backupPath | ConvertFrom-Json
} catch {
    Write-Host "[ERROR] Failed to read backup file: $_" -ForegroundColor Red
    exit 1
}

# Display patch information
Write-Host "Patch Information:" -ForegroundColor Cyan
Write-Host "  Target Process: $($backup.processName) (PID $($backup.processPid))" -ForegroundColor Gray
Write-Host "  Function Address: $($backup.functionAddress)" -ForegroundColor Gray
Write-Host "  Patch Size: $($backup.patchSize) bytes" -ForegroundColor Gray
Write-Host "  Applied: $($backup.timestamp)" -ForegroundColor Gray
Write-Host ""

# Check if process is still running
$process = Get-Process -Id $backup.processPid -ErrorAction SilentlyContinue

if (-not $process) {
    Write-Host "[WARNING] Target process (PID $($backup.processPid)) is not running!" -ForegroundColor Yellow
    Write-Host "[INFO] Patches may have been lost when process terminated" -ForegroundColor Yellow
    Write-Host "[INFO] No restoration possible - process must be restarted" -ForegroundColor Yellow
    Write-Host ""

    # Clean up backup file
    Remove-Item $backupPath -Force
    Write-Host "[INFO] Backup file removed" -ForegroundColor Green
    exit 0
}

Write-Host "[+] Target process is running (PID $($backup.processPid))" -ForegroundColor Green
Write-Host ""

# Confirm restoration
if (-not $Force) {
    Write-Host "Do you want to restore original bytes to $($backup.processName)?" -ForegroundColor Yellow
    $confirmation = Read-Host "Type 'YES' to continue"

    if ($confirmation -ne 'YES') {
        Write-Host "[CANCELLED] Restoration cancelled by user" -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "[*] Starting restoration process..." -ForegroundColor Cyan

# P/Invoke signatures for memory operations
Add-Type @"
    using System;
    using System.Runtime.InteropServices;

    public class MemoryAPI {
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(
            uint processAccess,
            bool bInheritHandle,
            int processId
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool WriteProcessMemory(
            IntPtr hProcess,
            IntPtr lpBaseAddress,
            byte[] lpBuffer,
            int nSize,
            out int lpNumberOfBytesWritten
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool ReadProcessMemory(
            IntPtr hProcess,
            IntPtr lpBaseAddress,
            byte[] lpBuffer,
            int nSize,
            out int lpNumberOfBytesRead
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        public const uint PROCESS_VM_WRITE = 0x0020;
        public const uint PROCESS_VM_OPERATION = 0x0008;
        public const uint PROCESS_VM_READ = 0x0010;
    }
"@

try {
    # Open process
    $processAccess = [MemoryAPI]::PROCESS_VM_WRITE -bor [MemoryAPI]::PROCESS_VM_OPERATION -bor [MemoryAPI]::PROCESS_VM_READ
    $processHandle = [MemoryAPI]::OpenProcess($processAccess, $false, $backup.processPid)

    if ($processHandle -eq [IntPtr]::Zero) {
        throw "Failed to open process (Access Denied - EDR may be protecting the process)"
    }

    Write-Host "[+] Process handle acquired" -ForegroundColor Green

    # Parse function address
    $functionAddress = [IntPtr]([Convert]::ToInt64($backup.functionAddress, 16))

    # Convert hex string to bytes
    $originalBytes = @()
    for ($i = 0; $i -lt $backup.originalBytes.Length; $i += 2) {
        $byteHex = $backup.originalBytes.Substring($i, 2)
        $originalBytes += [Convert]::ToByte($byteHex, 16)
    }

    Write-Host "[*] Restoring $($originalBytes.Count) bytes to address $($backup.functionAddress)..." -ForegroundColor Cyan

    # Write original bytes
    $bytesWritten = 0
    $writeResult = [MemoryAPI]::WriteProcessMemory(
        $processHandle,
        $functionAddress,
        $originalBytes,
        $originalBytes.Count,
        [ref]$bytesWritten
    )

    if (-not $writeResult) {
        throw "WriteProcessMemory failed (EDR may have blocked the operation)"
    }

    if ($bytesWritten -ne $originalBytes.Count) {
        throw "Wrote $bytesWritten bytes, expected $($originalBytes.Count)"
    }

    Write-Host "[+] Original bytes written ($bytesWritten bytes)" -ForegroundColor Green

    # Verify restoration
    Write-Host "[*] Verifying restoration..." -ForegroundColor Cyan

    $verifyBytes = New-Object byte[] $originalBytes.Count
    $bytesRead = 0
    $readResult = [MemoryAPI]::ReadProcessMemory(
        $processHandle,
        $functionAddress,
        $verifyBytes,
        $originalBytes.Count,
        [ref]$bytesRead
    )

    if (-not $readResult) {
        throw "Verification read failed"
    }

    # Compare bytes
    $mismatch = $false
    for ($i = 0; $i -lt $originalBytes.Count; $i++) {
        if ($verifyBytes[$i] -ne $originalBytes[$i]) {
            Write-Host "[ERROR] Byte mismatch at offset $i" -ForegroundColor Red
            $mismatch = $true
        }
    }

    if ($mismatch) {
        throw "Restoration verification failed - bytes do not match"
    }

    Write-Host "[+] Restoration verified successfully!" -ForegroundColor Green

    # Clean up
    [MemoryAPI]::CloseHandle($processHandle) | Out-Null

    # Remove backup file
    Remove-Item $backupPath -Force
    Write-Host "[+] Backup file removed" -ForegroundColor Green

    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "   Restoration Completed Successfully!" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Original function bytes have been restored." -ForegroundColor Green
    Write-Host "The system should now be in a clean state." -ForegroundColor Green

} catch {
    Write-Host ""
    Write-Host "[ERROR] Restoration failed: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Possible reasons:" -ForegroundColor Yellow
    Write-Host "  1. EDR is protecting the process" -ForegroundColor Gray
    Write-Host "  2. Process has terminated" -ForegroundColor Gray
    Write-Host "  3. Memory permissions changed" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Recommended actions:" -ForegroundColor Yellow
    Write-Host "  1. Restart the target service: Restart-Service -Name Sense" -ForegroundColor Gray
    Write-Host "  2. Reboot the system if needed" -ForegroundColor Gray
    Write-Host "  3. Verify MDE is functioning normally" -ForegroundColor Gray

    exit 1
}

# SIG # Begin signature block
# MIIIvAYJKoZIhvcNAQcCoIIIrTCCCKkCAQExDzANBglghkgBZQMEAgEFADB5Bgor
# BgEEAYI3AgEEoGswaTA0BgorBgEEAYI3AgEeMCYCAwEAAAQQH8w7YFlLCE63JNLG
# KX7zUQIBAAIBAAIBAAIBAAIBADAxMA0GCWCGSAFlAwQCAQUABCA3kcd7UkGni0eA
# zcGeFzJEaalT9yfq3E2jRu78B39owKCCBSYwggUiMIIDCqADAgECAhAf+3Y1zDuG
# iUby8zvhPQbOMA0GCSqGSIb3DQEBDQUAMCIxIDAeBgNVBAMMF0YwLUxvY2FsQ29k
# ZVNpZ25pbmctQ1NUMB4XDTI1MDEyNzAyMzQ0MVoXDTI2MDEyNzAyNDQ0MFowIjEg
# MB4GA1UEAwwXRjAtTG9jYWxDb2RlU2lnbmluZy1DU1QwggIiMA0GCSqGSIb3DQEB
# AQUAA4ICDwAwggIKAoICAQDFJLPQGVV5cPrIfWg8AOz7iHi0V/SYVUHEs3K0G0wu
# vPknaHvGqTr2pKL+YKjve7WcgR5cF7+Tv7hpO02TdKxZsLpjqyYnd6YhYoi6V9JZ
# lz3tppu/XFg2dp7qrXpGjs9McCxAtL0dXjgZHJfsDyM8p6CvwTq9r2hFirmlMOYD
# 8Zsyy6BHuPCSg7fvXIFaKPR6b5Q6C4B4nwC2w9j6QmS8oDNMkIq+qHgFgx0mvNQc
# NtOM3i5sflnlQnQwUg9/myulkt724UubL20cVhSSyzvMaNvqOREZPHU7NZRF4R/7
# uohOpN/+fQHrMNu+XLZONxvtbHAA3R5Y1LnQOl/4AYhXgEjbdiZD7yKZLIC3f6Pb
# I5IYJEvPRv0xE1MErFHcCu7Zq0sNTlzERvGC1JvzikWRhWPGW+c3Y9Gn6kyaDCFK
# RPv40wzHK8M5Dg5u5fJjqm+ebwXjv12Z/FoPqFQ5Oubi/TDoOqLS8pzaPILMPmOM
# SnbqDAawpHslIJrSnNkz9FuWw157ME0RkhKJngnoJ3KBhzFnqYivoG3ZhhXFj/0i
# 4ksTG7G5NKpkI0F7PeetNalRv7llZ70xMMARLM6f/vGTetumqfpqHyXVlguZ/lKy
# 7NGEyXChpFk21rHEcwzDmsu/y1a1NBeyQ6yyWeEfc82zqBbV8HWVLHs8ruRXITGl
# 6QIDAQABo1QwUjAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwMw
# DAYDVR0TAQH/BAIwADAdBgNVHQ4EFgQUemxrbIkL/bJnXptoCkBWU0PlbNQwDQYJ
# KoZIhvcNAQENBQADggIBADJgqO2FosDnM4YQ2TY0oK1aUZFE42dodxTInYouMMNH
# C2+ifAKTCcR7QpWDqvgVBS5nZmR2mfJDXEdR5WTyryXWwBz1ltxKFUYlW3t96x4L
# lAAo0YYzVhSAwlBzuMVrTxAp1wjmwPtclCI8JOcFdqBR+ZJq+V6VQjQGnzHlxVyx
# sk/Zz7iaf4t4uneLg8kh4GxPCuU4Kvuc2J0Zg9qawCT3TuUwMh1VHvtKnJT2oDgn
# nXYntM1MKSg7IGAQC9I90uC6e/tngpTb+Ur6nD3hz3vOaIuRaHR/pau0Z6mVZdQ0
# v5VU0GutEYJz6aZy4231VkU9c+7g7CxMPU4sw3TlPZ9/XXA7FFp/YSxF0C4q+M6s
# 23ZxL4Sa9arbHplb2HNBTvL4SWAARicHZyB0Q1tJxqMEBWLmhQyGci2YnuBgtIpo
# ZS+WmDG6MEmicWTPqJg5/rprIcE/dBBptPGuKkWJbl5lreX7J11C2cgkxZmYGxqO
# JlytDfqS+Q1r8dLr/6PXZfY5T0u2DEr7fUo+p9k3XfLdcZLQp41gamSvGRX73J5L
# 509sfRYgRfSFzKrQ5uqGLG35qxZQQlgeRS90t2gfLw6psBFjYHNmPUZcUSRmTpgu
# j3guCY8qtQxMLSWFGQ4kMyPiutnxb/B6Vp5BL/sScp2mpofPLbpZEmLXsjMLi6bT
# MYIC7DCCAugCAQEwNjAiMSAwHgYDVQQDDBdGMC1Mb2NhbENvZGVTaWduaW5nLUNT
# VAIQH/t2Ncw7holG8vM74T0GzjANBglghkgBZQMEAgEFAKCBiDAZBgkqhkiG9w0B
# CQMxDAYKKwYBBAGCNwIBBDAcBgkqhkiG9w0BCQUxDxcNMjUxMDI4MDAyNTU1WjAc
# BgorBgEEAYI3AgELMQ4wDAYKKwYBBAGCNwIBFTAvBgkqhkiG9w0BCQQxIgQgy0fB
# IKy6UBR2jiSOoXanpSJ22QSLpRXLoFlKrKrAgY0wDQYJKoZIhvcNAQEBBQAEggIA
# SBGEywiGqLD44fMvoy5YWmSf7z9dAHOnav9I4SzUqABFIWqQgUaMN+HZb2VlUzSg
# yGEZBwQLv7exKlnid5DECfbrfFj9/Uk+uRm2AtsK06P0pLPxqH3RVbK6PGQgASd6
# UPYWEedxYeOSN/gXqZV63x7uoFECxl/bxPXGYYKpN4S/ixy9neUjLhigUU3XXkTz
# t7XKWUr0G0l2vmU0xWzk33JhuAChXk3pnzZ3K+ETeCFqzP+yobIUG55xMczEj6yP
# 9CDz6q2CMS+TLfOoS3xGmCoznkD6vAgA+SFzllKnP9SWQjoL/NAaTZnlgx6p2qVv
# Uv69WL30YhNdsMlH/elT2RuoNrrtwdnod355aAQatUeoyfDjrpUXcg4yXwQLPvzH
# jzMiu1i+sofHnaxEVmVwW5lI/jNCWVtdj44ZyKl8+uYB30R7ydfQT5vgkFlz4Prf
# uEuO7aH+f8/bj/eba8oZfoJqUpEqejA3N+jSeBBjYNq3BNx/jNqakTWtsrB9ezgG
# dcRtq7BhYuMa+DmkMcCWohT8VUg2gy+4vm90RSfzqpmIiD8ArDSi7GynghMAh1dN
# 25bKXHXH5eR+9fKJImKeSB1A0avcmaEDxOV9gDfye34t94O92B4cGRHBIGIiTW0/
# JeyEnhk2iDzLiksXJE/M5cEaGk8Eko1VS3neAL2eWEE=
# SIG # End signature block
