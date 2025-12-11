# Data Exfiltration Simulation PowerShell Script
# Simulates data staging and cloud exfiltration patterns without actual transmission
# MITRE ATT&CK: T1020 - Automated Exfiltration, T1041 - Exfiltration Over C2 Channel

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

function Simulate-DataExfiltration {
    Write-Host "[*] Starting data exfiltration simulation (no actual transmission)" -ForegroundColor Yellow
    
    # Bypass execution policy
    Set-ExecutionPolicyBypass | Out-Null
    
    $statusFile = "C:\F0\exfiltration_status.txt"
    $stagingDir = "C:\F0\staging"
    $compressedFile = "C:\F0\staged_data.zip"
    $blocked = $false
    $stagedFileCount = 0
    
    try {
        # Create staging directory
        if (-not (Test-Path $stagingDir)) {
            New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
            Write-Host "[*] Created data staging directory: $stagingDir" -ForegroundColor Gray
        }
        
        # Phase 1: Identify high-value data for exfiltration
        Write-Host "[*] Phase 1: Identifying high-value data for exfiltration..." -ForegroundColor Cyan
        
        # Target file types commonly exfiltrated by attackers
        $highValueExtensions = @(
            "*.pdf", "*.docx", "*.xlsx", "*.pptx",     # Documents
            "*.sql", "*.db", "*.mdb", "*.accdb",       # Databases  
            "*.xml", "*.json", "*.csv",                 # Structured data
            "*.p12", "*.pfx", "*.key", "*.pem",        # Certificates
            "*.zip", "*.rar", "*.7z"                   # Archives
        )
        
        # High-value directories to target
        $targetDirectories = @(
            "$env:USERPROFILE\Documents",
            "$env:USERPROFILE\Desktop",
            "$env:USERPROFILE\Downloads",
            "C:\ProgramData",
            "$env:APPDATA"
        )
        
        $discoveredFiles = @()
        
        foreach ($directory in $targetDirectories) {
            if (Test-Path $directory) {
                Write-Host "[*] Scanning for high-value data in: $directory" -ForegroundColor Gray
                
                try {
                    foreach ($extension in $highValueExtensions) {
                        $files = Get-ChildItem -Path $directory -Filter $extension -Recurse -File -ErrorAction SilentlyContinue | 
                                 Select-Object -First 5  # Limit to avoid excessive processing
                        
                        foreach ($file in $files) {
                            # Simulate file screening for sensitive content
                            if ($file.Length -lt 50MB) {  # Target smaller files for "exfiltration"
                                $discoveredFiles += $file
                                Write-Host "[+] Identified exfiltration target: $($file.Name)" -ForegroundColor Green
                            }
                        }
                    }
                } catch {
                    Write-Host "[!] Access denied to directory: $directory" -ForegroundColor Yellow
                }
            }
        }
        
        # Phase 2: Stage data for exfiltration (copy to staging area)
        Write-Host "[*] Phase 2: Staging discovered data for exfiltration..." -ForegroundColor Cyan
        
        foreach ($file in $discoveredFiles) {
            try {
                $destPath = Join-Path $stagingDir $file.Name
                
                # Simulate data staging by copying to staging directory
                Copy-Item -Path $file.FullName -Destination $destPath -ErrorAction SilentlyContinue
                
                if (Test-Path $destPath) {
                    Write-Host "[*] Staged file for exfiltration: $($file.Name)" -ForegroundColor Gray
                    $stagedFileCount++
                } else {
                    Write-Host "[!] Could not stage file: $($file.Name)" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "[!] Staging failed for file: $($file.Name)" -ForegroundColor Yellow
            }
        }
        
        # Phase 3: Compress staged data (common exfiltration technique)
        Write-Host "[*] Phase 3: Compressing staged data for transmission..." -ForegroundColor Cyan
        
        if ($stagedFileCount -gt 0) {
            try {
                # Use PowerShell's Compress-Archive to simulate data compression
                $compressParams = @{
                    Path = "$stagingDir\*"
                    DestinationPath = $compressedFile
                    CompressionLevel = "Optimal"
                    Force = $true
                }
                
                Write-Host "[*] Creating compressed archive for exfiltration..." -ForegroundColor Gray
                Compress-Archive @compressParams
                
                if (Test-Path $compressedFile) {
                    $compressedSize = (Get-Item $compressedFile).Length
                    Write-Host "[+] Created compressed exfiltration package: staged_data.zip ($([math]::Round($compressedSize/1KB, 2)) KB)" -ForegroundColor Green
                } else {
                    Write-Host "[!] Failed to create compressed exfiltration package" -ForegroundColor Red
                    $blocked = $true
                }
            } catch {
                Write-Host "[!] Data compression failed: $_" -ForegroundColor Red
                $blocked = $true
            }
        } else {
            Write-Host "[!] No data was successfully staged for exfiltration" -ForegroundColor Red
        }
        
        # Phase 4: Simulate cloud upload preparation (without actual transmission)
        Write-Host "[*] Phase 4: Simulating cloud storage upload preparation..." -ForegroundColor Cyan
        
        # Simulate common cloud storage upload patterns
        $cloudServices = @("Azure Blob", "AWS S3", "Google Drive", "OneDrive", "Dropbox")
        $selectedService = $cloudServices | Get-Random
        
        Write-Host "[*] Simulating upload to $selectedService..." -ForegroundColor Gray
        
        # Simulate network connectivity check (without actual network calls)
        Write-Host "[*] Checking connectivity to exfiltration endpoint..." -ForegroundColor Gray
        
        # Simulate upload attempt (no actual data transmission)
        Write-Host "[*] Simulating data transmission to $selectedService endpoint..." -ForegroundColor Gray
        
        # Add delay to simulate upload time
        Start-Sleep -Seconds 2
        
        # Simulate upload progress monitoring
        $uploadProgress = @(25, 50, 75, 100)
        foreach ($progress in $uploadProgress) {
            Write-Host "[*] Simulated upload progress: $progress%" -ForegroundColor Gray
            Start-Sleep -Milliseconds 500
        }
        
        # Phase 5: Simulate exfiltration confirmation and cleanup
        Write-Host "[*] Phase 5: Simulating exfiltration completion and cleanup..." -ForegroundColor Cyan
        
        # Check if exfiltration simulation was detected/blocked
        # In real scenarios, EDR would detect large file operations, compression, and upload patterns
        
        Write-Host "[*] Simulating post-exfiltration cleanup..." -ForegroundColor Gray
        
        # Clean up staging directory (but leave evidence for detection)
        try {
            Remove-Item -Path $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "[*] Removed staging directory" -ForegroundColor Gray
        } catch {
            Write-Host "[!] Could not clean staging directory" -ForegroundColor Yellow
        }
        
    } catch {
        Write-Host "[!] Data exfiltration simulation encountered error: $_" -ForegroundColor Red
        $blocked = $true
    }
    
    # Final assessment
    Write-Host "[*] Data exfiltration simulation assessment" -ForegroundColor Yellow
    Write-Host "[*] Files staged for exfiltration: $stagedFileCount" -ForegroundColor Cyan
    
    if (Test-Path $compressedFile) {
        $finalSize = (Get-Item $compressedFile).Length
        Write-Host "[*] Compressed package size: $([math]::Round($finalSize/1KB, 2)) KB" -ForegroundColor Cyan
    }
    
    # Determine if exfiltration was blocked
    if ($blocked -or $stagedFileCount -eq 0) {
        "BLOCKED" | Out-File $statusFile -Encoding ASCII
        Write-Host "EXFIL_DETECTED" -ForegroundColor Red
    } else {
        Write-Host "[+] Data exfiltration simulation completed without sufficient detection" -ForegroundColor Green
        
        # Output for main program parsing
        Write-Host "STAGED_FILES:$stagedFileCount"
        Write-Host "EXFILTRATION_SIMULATION_COMPLETE"
    }
}

# Execute data exfiltration simulation
Simulate-DataExfiltration