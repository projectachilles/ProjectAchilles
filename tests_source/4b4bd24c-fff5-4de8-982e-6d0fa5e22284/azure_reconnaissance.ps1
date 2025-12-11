# Azure Storage Explorer Reconnaissance PowerShell Script
# Simulates cloud storage discovery and access pattern analysis
# MITRE ATT&CK: T1083 - File and Directory Discovery, T1018 - Remote System Discovery

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

function Discover-AzureStorage {
    Write-Host "[*] Starting Azure Storage Explorer reconnaissance simulation" -ForegroundColor Yellow
    
    # Bypass execution policy
    Set-ExecutionPolicyBypass | Out-Null
    
    $statusFile = "C:\F0\exfiltration_status.txt"
    $azureInfoFile = "C:\F0\azure_storage_info.json"
    $blocked = $false
    
    try {
        # Simulate Azure Storage Explorer configuration discovery
        Write-Host "[*] Searching for Azure Storage Explorer configurations..." -ForegroundColor Cyan
        
        # Common Azure Storage Explorer paths
        $azureStoragePaths = @(
            "$env:APPDATA\StorageExplorer",
            "$env:LOCALAPPDATA\Microsoft\Azure Storage Explorer",
            "$env:USERPROFILE\.azure",
            "$env:APPDATA\Microsoft\Azure\AzureStorageExplorer"
        )
        
        $foundConfigs = @()
        
        foreach ($path in $azureStoragePaths) {
            if (Test-Path $path) {
                Write-Host "[+] Found Azure Storage configuration directory: $path" -ForegroundColor Green
                
                try {
                    # Simulate configuration file enumeration
                    $configFiles = Get-ChildItem -Path $path -Recurse -File -ErrorAction SilentlyContinue | 
                                   Where-Object { $_.Extension -in @('.json', '.config', '.xml', '.dat') }
                    
                    foreach ($file in $configFiles) {
                        Write-Host "[*] Discovered config file: $($file.Name)" -ForegroundColor Gray
                        $foundConfigs += $file.FullName
                    }
                } catch {
                    Write-Host "[!] Access denied to config directory: $path" -ForegroundColor Yellow
                }
            }
        }
        
        # Simulate Azure CLI credential discovery
        Write-Host "[*] Searching for Azure CLI credentials and profiles..." -ForegroundColor Cyan
        
        $azureCliPath = "$env:USERPROFILE\.azure"
        if (Test-Path $azureCliPath) {
            Write-Host "[+] Found Azure CLI configuration directory" -ForegroundColor Green
            
            try {
                # Look for credential files
                $credentialFiles = @("accessTokens.json", "azureProfile.json", "msal_http_cache", "service_principal_entries.json")
                
                foreach ($credFile in $credentialFiles) {
                    $credPath = Join-Path $azureCliPath $credFile
                    if (Test-Path $credPath) {
                        Write-Host "[+] Found Azure credential file: $credFile" -ForegroundColor Magenta
                        $foundConfigs += $credPath
                    }
                }
            } catch {
                Write-Host "[!] Could not access Azure CLI credentials" -ForegroundColor Yellow
            }
        }
        
        # Simulate cloud storage connection attempts
        Write-Host "[*] Simulating Azure Storage connection enumeration..." -ForegroundColor Cyan
        
        # Simulate common Azure storage account discovery techniques
        $storagePatterns = @(
            "*.blob.core.windows.net",
            "*.table.core.windows.net", 
            "*.queue.core.windows.net",
            "*.file.core.windows.net"
        )
        
        # Simulate registry search for stored connections
        try {
            Write-Host "[*] Searching registry for stored Azure connections..." -ForegroundColor Gray
            
            $registryPaths = @(
                "HKCU:\Software\Microsoft\Azure Storage Explorer",
                "HKCU:\Software\Classes\azurestorage",
                "HKLM:\SOFTWARE\Microsoft\Azure"
            )
            
            foreach ($regPath in $registryPaths) {
                if (Test-Path $regPath -ErrorAction SilentlyContinue) {
                    Write-Host "[+] Found Azure registry configuration: $regPath" -ForegroundColor Green
                    
                    try {
                        $regItems = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
                        if ($regItems) {
                            Write-Host "[*] Registry configuration contains connection data" -ForegroundColor Gray
                        }
                    } catch {
                        # Continue on access errors
                    }
                }
            }
        } catch {
            Write-Host "[!] Registry access restricted or denied" -ForegroundColor Yellow
        }
        
        # Simulate browser-based credential discovery
        Write-Host "[*] Searching for browser-cached Azure portal credentials..." -ForegroundColor Cyan
        
        $browserPaths = @(
            "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Local Storage",
            "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Local Storage",
            "$env:APPDATA\Mozilla\Firefox\Profiles"
        )
        
        foreach ($browserPath in $browserPaths) {
            if (Test-Path $browserPath) {
                Write-Host "[*] Found browser storage directory: $browserPath" -ForegroundColor Gray
                
                try {
                    # Look for Azure-related local storage
                    $azureFiles = Get-ChildItem -Path $browserPath -Recurse -File -ErrorAction SilentlyContinue | 
                                  Where-Object { $_.Name -like "*azure*" -or $_.Name -like "*microsoft*" }
                    
                    if ($azureFiles) {
                        Write-Host "[+] Found $($azureFiles.Count) Azure-related browser storage files" -ForegroundColor Magenta
                    }
                } catch {
                    # Continue enumeration on errors
                }
            }
        }
        
        # Simulate environment variable scanning for cloud credentials
        Write-Host "[*] Scanning environment variables for Azure credentials..." -ForegroundColor Cyan
        
        $azureEnvVars = @(
            "AZURE_STORAGE_CONNECTION_STRING",
            "AZURE_STORAGE_ACCOUNT",
            "AZURE_STORAGE_KEY",
            "AZURE_CLIENT_ID",
            "AZURE_CLIENT_SECRET",
            "AZURE_TENANT_ID"
        )
        
        $foundCreds = @()
        foreach ($envVar in $azureEnvVars) {
            $value = [Environment]::GetEnvironmentVariable($envVar)
            if ($value) {
                Write-Host "[+] Found Azure environment variable: $envVar" -ForegroundColor Red
                $foundCreds += $envVar
            }
        }
        
        # Create summary of reconnaissance findings
        $azureInfo = @{
            timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            config_files_found = $foundConfigs.Count
            credential_vars_found = $foundCreds.Count
            storage_paths_discovered = ($azureStoragePaths | Where-Object { Test-Path $_ }).Count
            reconnaissance_complete = $true
        }
        
        # Output reconnaissance summary
        try {
            $azureInfo | ConvertTo-Json -Depth 2 | Out-File $azureInfoFile -Encoding ASCII
            Write-Host "[*] Azure reconnaissance data saved to: $azureInfoFile" -ForegroundColor Gray
        } catch {
            Write-Host "[!] Could not save Azure reconnaissance data" -ForegroundColor Red
        }
        
    } catch {
        Write-Host "[!] Azure reconnaissance encountered error: $_" -ForegroundColor Red
        $blocked = $true
    }
    
    # Final reconnaissance summary
    Write-Host "[*] Azure Storage Explorer reconnaissance completed" -ForegroundColor Yellow
    Write-Host "[*] Configuration files discovered: $($foundConfigs.Count)" -ForegroundColor Cyan
    Write-Host "[*] Credential variables found: $($foundCreds.Count)" -ForegroundColor Cyan
    
    # Check if reconnaissance was blocked or detected
    if ($blocked) {
        "BLOCKED" | Out-File $statusFile -Encoding ASCII
        Write-Host "BLOCKED" -ForegroundColor Red
    } else {
        Write-Host "[+] Azure reconnaissance simulation completed without interference" -ForegroundColor Green
        
        # Output for main program parsing
        Write-Host "AZURE_RECON_COMPLETE:$($foundConfigs.Count + $foundCreds.Count)"
    }
}

# Execute Azure reconnaissance simulation
Discover-AzureStorage