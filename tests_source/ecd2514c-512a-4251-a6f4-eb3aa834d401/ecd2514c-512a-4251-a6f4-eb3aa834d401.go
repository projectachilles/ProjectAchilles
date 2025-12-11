//go:build windows
// +build windows

/*
ID: ecd2514c-512a-4251-a6f4-eb3aa834d401
NAME: CyberEye RAT - Windows Defender Disabling via PowerShell
TECHNIQUE: T1562.001
UNIT: response
CREATED: 2025-07-02
*/

package main

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

//go:embed CyberEye-TTPs.ps1
var maliciousScript []byte

//go:embed Cleanup-CyberEye-TTPs.ps1
var cleanupScript []byte

func execute() error {
	// Define paths
	targetDir := "c:\\F0"
	scriptPath := filepath.Join(targetDir, "CyberEye-TTPs.ps1")

	// Extract PowerShell script to target directory
	Endpoint.Say("Extracting PowerShell script to %s", scriptPath)
	
	if err := os.WriteFile(scriptPath, maliciousScript, 0755); err != nil {
		return err
	}

	// Check if script was quarantined after extraction
	if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
		Endpoint.Say("PowerShell script was quarantined after extraction")
		return err
	}

	Endpoint.Say("PowerShell script successfully extracted")
	Endpoint.Wait(2)

	// Attempt to execute the PowerShell script
	Endpoint.Say("Attempting to execute Windows Defender disabling script")
	
	// Use PowerShell with execution policy bypass
	cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-File", scriptPath)
	
	// Set working directory
	cmd.Dir = targetDir
	
	// Execute the command
	output, err := cmd.CombinedOutput()
	outputStr := string(output)
	
	// Always log the output for debugging
	Endpoint.Say("Script output: %s", outputStr)
	
	// Check if registry modifications were blocked (system is protected)
	protectedIndicators := []string{
		"Requested registry access is not allowed",
		"Access is denied",
		"Access denied",
		"Failed to set TamperProtection",
		"Failed to query Defender settings",
		"Cannot write to the registry key",
		"Registry access denied",
		"Insufficient privileges",
		"requires administrative privileges",
	}
	
	systemProtected := false
	for _, indicator := range protectedIndicators {
		if strings.Contains(outputStr, indicator) {
			systemProtected = true
			Endpoint.Say("System protection detected: %s", indicator)
			break
		}
	}
	
	// Check for successful registry modifications (system is unprotected)
	successIndicators := []string{
		"Registry manipulations completed successfully",
		"Set TamperProtection to 0",
		"Set DisableAntiSpyware to 1",
		"Set DisableBehaviorMonitoring to 1",
		"Set DisableOnAccessProtection to 1",
		"Set DisableScanOnRealtimeEnable to 1",
	}
	
	modificationSuccessCount := 0
	for _, indicator := range successIndicators {
		if strings.Contains(outputStr, indicator) {
			modificationSuccessCount++
		}
	}
	
	// If PowerShell execution failed with an error, check if it's due to protection
	if err != nil {
		Endpoint.Say("PowerShell execution returned error: %v", err)
		if systemProtected {
			// Error due to protection - this is good, system blocked the attack
			return fmt.Errorf("registry modifications blocked by security controls")
		}
		// Other error - treat as unexpected
		return err
	}
	
	// If multiple registry modifications succeeded, system is unprotected
	if modificationSuccessCount >= 3 && !systemProtected {
		Endpoint.Say("WARNING: Multiple registry modifications succeeded - system appears unprotected")
		// Wait for potential delayed detection
		Endpoint.Wait(5)
		
		// Check if Windows Defender is still running
		Endpoint.Say("Checking if Windows Defender service is affected")
		serviceCmd := exec.Command("sc", "query", "WinDefend")
		serviceOutput, serviceErr := serviceCmd.CombinedOutput()
		
		if serviceErr != nil {
			Endpoint.Say("Failed to query Windows Defender service: %v", serviceErr)
		} else {
			Endpoint.Say("Windows Defender service status: %s", string(serviceOutput))
		}
		
		return nil // Success in disabling - system unprotected
	}
	
	// If we detected protection indicators, return error to indicate blocking
	if systemProtected {
		return fmt.Errorf("registry modifications blocked by security controls")
	}
	
	// Ambiguous case - treat as potential protection
	return fmt.Errorf("unable to determine if registry modifications succeeded")
}

func cleanup() {
	// Clean up dropped files
	targetDir := "c:\\F0"
	scriptPath := filepath.Join(targetDir, "CyberEye-TTPs.ps1")
	cleanupPath := filepath.Join(targetDir, "Cleanup-CyberEye-TTPs.ps1")
	
	if _, err := os.Stat(scriptPath); err == nil {
		os.Remove(scriptPath)
		Endpoint.Say("Cleaned up PowerShell script")
	}
	
	if _, err := os.Stat(cleanupPath); err == nil {
		os.Remove(cleanupPath)
		Endpoint.Say("Cleaned up cleanup script")
	}
}

func test() {
	// Initialize dropper
	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		Endpoint.Say("Failed to initialize dropper: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	// Create target directory
	targetDir := "c:\\F0"
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		Endpoint.Say("Failed to create target directory: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	// Change to target directory
	originalDir, _ := os.Getwd()
	os.Chdir(targetDir)
	defer func() {
		os.Chdir(originalDir)
		cleanup()
	}()

	// Check if PowerShell script is quarantined during extraction
	Endpoint.Say("Testing Windows Defender disabling via PowerShell script")
	
	if Endpoint.Quarantined("CyberEye-TTPs.ps1", maliciousScript) {
		Endpoint.Say("PowerShell script was quarantined during extraction!")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}
	
	// Also extract cleanup script (non-malicious, for restoration)
	cleanupPath := filepath.Join(targetDir, "Cleanup-CyberEye-TTPs.ps1")
	if err := os.WriteFile(cleanupPath, cleanupScript, 0755); err != nil {
		Endpoint.Say("Warning: Failed to extract cleanup script: %v", err)
		// Non-fatal - test can continue
	} else {
		Endpoint.Say("Cleanup script available at: %s", cleanupPath)
	}

	// Execute the test
	if err := execute(); err != nil {
		Endpoint.Say("Test execution prevented by security controls: %v", err)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	Endpoint.Say("Windows Defender disabling technique executed without prevention")
	Endpoint.Stop(Endpoint.Unprotected)
}

func main() {
	Endpoint.Start(test)
}