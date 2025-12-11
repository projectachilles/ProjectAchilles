#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Cleanup script for Gunra Ransomware simulation test artifacts.

.DESCRIPTION
    This script removes all artifacts created by the Gunra Ransomware simulation test (94b248c0-a104-48c3-b4a5-3d45028c407d).
    It safely removes the test directory, encrypted files, and ransom notes created during the test.

.PARAMETER Force
    Skip confirmation prompts and force cleanup.

.EXAMPLE
    .\Cleanup-GunraTest.ps1
    Runs cleanup with confirmation prompts.

.EXAMPLE
    .\Cleanup-GunraTest.ps1 -Force
    Runs cleanup without confirmation prompts.

.NOTES
    Test ID: 94b248c0-a104-48c3-b4a5-3d45028c407d
    Test Name: Gunra Ransomware Simulation
    Created: 2024-10-13
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [switch]$Force
)

# Test configuration
$TestDir = "c:\F0\94b248c0-a104-48c3-b4a5-3d45028c407d"
$TestID = "94b248c0-a104-48c3-b4a5-3d45028c407d"

# Function to check if running with admin privileges
function Test-Admin {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Function to write colored output
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host "[$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))][$TestID] $Message" -ForegroundColor $Color
}

# Main cleanup function
function Start-Cleanup {
    Write-ColorOutput "Starting Gunra Ransomware test cleanup" -Color Cyan
    
    # Check if test directory exists
    if (-not (Test-Path $TestDir)) {
        Write-ColorOutput "Test directory not found: $TestDir" -Color Yellow
        Write-ColorOutput "Nothing to clean up" -Color Green
        return
    }

    # Show what will be deleted
    Write-ColorOutput "Found test directory: $TestDir" -Color White
    
    try {
        # Get file count
        $files = Get-ChildItem -Path $TestDir -Recurse -File -ErrorAction SilentlyContinue
        $fileCount = ($files | Measure-Object).Count
        
        Write-ColorOutput "Files to be removed: $fileCount" -Color White
        
        # List files if not in Force mode
        if (-not $Force -and $fileCount -gt 0) {
            Write-Host "`nFiles in test directory:" -ForegroundColor Cyan
            $files | ForEach-Object {
                Write-Host "  - $($_.Name)" -ForegroundColor Gray
            }
            Write-Host ""
        }
    }
    catch {
        Write-ColorOutput "Warning: Could not enumerate files: $_" -Color Yellow
    }

    # Confirm deletion unless Force is specified
    if (-not $Force) {
        $confirmation = Read-Host "`nDo you want to delete the test directory and all its contents? (Y/N)"
        if ($confirmation -ne 'Y' -and $confirmation -ne 'y') {
            Write-ColorOutput "Cleanup cancelled by user" -Color Yellow
            return
        }
    }

    # Perform cleanup
    Write-ColorOutput "Removing test directory: $TestDir" -Color Yellow
    
    try {
        Remove-Item -Path $TestDir -Recurse -Force -ErrorAction Stop
        Write-ColorOutput "Successfully removed test directory" -Color Green
    }
    catch {
        Write-ColorOutput "Error removing test directory: $_" -Color Red
        Write-ColorOutput "Attempting to remove files individually..." -Color Yellow
        
        # Try to remove files individually
        try {
            Get-ChildItem -Path $TestDir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
                try {
                    Remove-Item $_.FullName -Force -ErrorAction Stop
                    Write-ColorOutput "Removed: $($_.Name)" -Color Gray
                }
                catch {
                    Write-ColorOutput "Failed to remove: $($_.Name) - $_" -Color Red
                }
            }
            
            # Try to remove directory again
            Remove-Item -Path $TestDir -Recurse -Force -ErrorAction Stop
            Write-ColorOutput "Successfully removed test directory" -Color Green
        }
        catch {
            Write-ColorOutput "Failed to completely remove test directory: $_" -Color Red
            Write-ColorOutput "You may need to manually delete: $TestDir" -Color Yellow
            exit 1
        }
    }

    # Verify cleanup
    if (Test-Path $TestDir) {
        Write-ColorOutput "Warning: Test directory still exists after cleanup" -Color Yellow
        Write-ColorOutput "Manual intervention may be required" -Color Yellow
    }
    else {
        Write-ColorOutput "Cleanup completed successfully" -Color Green
    }
}

# Main execution
try {
    # Check admin privileges
    if (-not (Test-Admin)) {
        Write-ColorOutput "Warning: Not running as Administrator" -Color Yellow
        Write-ColorOutput "Some cleanup operations may fail without admin privileges" -Color Yellow
        
        if (-not $Force) {
            $continue = Read-Host "Continue anyway? (Y/N)"
            if ($continue -ne 'Y' -and $continue -ne 'y') {
                Write-ColorOutput "Cleanup cancelled" -Color Yellow
                exit 0
            }
        }
    }

    # Run cleanup
    Start-Cleanup

    Write-ColorOutput "Cleanup script finished" -Color Cyan
}
catch {
    Write-ColorOutput "Unexpected error during cleanup: $_" -Color Red
    exit 1
}
