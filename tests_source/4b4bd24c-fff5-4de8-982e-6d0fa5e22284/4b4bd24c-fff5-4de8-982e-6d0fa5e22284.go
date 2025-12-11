//go:build windows
// +build windows

/*
ID: 4b4bd24c-fff5-4de8-982e-6d0fa5e22284
NAME: Data Exfiltration and Encryption Simulation
TECHNIQUE: T1020,T1041,T1486,T1055,T1083
UNIT: response
CREATED: 2025-08-23
*/
package main

import (
	_ "embed"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

//go:embed azure_reconnaissance.ps1
var azureReconScript []byte

//go:embed data_exfiltration.ps1
var dataExfiltrationScript []byte

//go:embed conhost.exe
var masqueradedEncryptor []byte

func test() {
	// Initialize dropper
	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		Endpoint.Say("Dropper initialization failed: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	// CRITICAL: Drop to c:\F0
	targetDir := "c:\\F0"
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		Endpoint.Say("Failed to create target directory: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	Endpoint.Say("Starting Data Exfiltration and Encryption Simulation")
	
	// Phase 1: Drop reconnaissance and exfiltration tools
	Endpoint.Say("Phase 1: Dropping Azure reconnaissance and data exfiltration tools")
	
	azureReconPath := filepath.Join(targetDir, "azure_reconnaissance.ps1")
	if err := os.WriteFile(azureReconPath, azureReconScript, 0755); err != nil {
		Endpoint.Say("Failed to drop Azure reconnaissance script: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	
	exfiltrationScriptPath := filepath.Join(targetDir, "data_exfiltration.ps1")
	if err := os.WriteFile(exfiltrationScriptPath, dataExfiltrationScript, 0755); err != nil {
		Endpoint.Say("Failed to drop data exfiltration script: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	
	// Deploy masqueraded encryption binary (conhost.exe)
	conhostPath := filepath.Join(targetDir, "conhost.exe")
	if err := os.WriteFile(conhostPath, masqueradedEncryptor, 0755); err != nil {
		Endpoint.Say("Failed to drop masqueraded encryption binary: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	// Check for quarantine after dropping files
	Endpoint.Say("Checking for defensive reaction to dropped files")
	Endpoint.Wait(3)
	
	if Endpoint.Quarantined("azure_reconnaissance.ps1", azureReconScript) {
		Endpoint.Say("Azure reconnaissance script was quarantined!")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}
	
	if Endpoint.Quarantined("conhost.exe", masqueradedEncryptor) {
		Endpoint.Say("Masqueraded encryption binary was quarantined!")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}

	// Phase 2: Azure Storage Explorer reconnaissance simulation
	Endpoint.Say("Phase 2: Performing Azure Storage Explorer reconnaissance and cloud access pattern analysis")
	
	azureReconCmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-File", azureReconPath)
	azureReconCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	
	azureReconOutput, azureReconErr := azureReconCmd.CombinedOutput()
	if azureReconErr != nil {
		Endpoint.Say("Azure reconnaissance script execution failed: %v", azureReconErr)
		// Continue test as some EDRs may block execution
	} else {
		Endpoint.Say("Azure reconnaissance simulation executed")
		if strings.Contains(string(azureReconOutput), "BLOCKED") {
			Endpoint.Say("Azure reconnaissance was blocked by security controls")
			Endpoint.Stop(Endpoint.ExecutionPrevented)
		}
	}

	// Give EDR time to analyze cloud reconnaissance patterns
	Endpoint.Wait(4)

	// Phase 3: Simulate data exfiltration to cloud storage
	Endpoint.Say("Phase 3: Simulating data exfiltration to cloud storage without actual transmission")
	
	exfiltrationCmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-File", exfiltrationScriptPath)
	exfiltrationCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	
	exfiltrationOutput, exfiltrationErr := exfiltrationCmd.CombinedOutput()
	if exfiltrationErr != nil {
		Endpoint.Say("Data exfiltration script execution failed: %v", exfiltrationErr)
		// Continue test as some EDRs may block execution
	} else {
		Endpoint.Say("Data exfiltration simulation completed")
		outputStr := string(exfiltrationOutput)
		if strings.Contains(outputStr, "EXFIL_DETECTED") {
			Endpoint.Say("Data exfiltration attempt was detected and blocked")
			Endpoint.Stop(Endpoint.ExecutionPrevented)
		} else if strings.Contains(outputStr, "STAGED_FILES:") {
			// Extract staged file count from output
			lines := strings.Split(outputStr, "\n")
			for _, line := range lines {
				if strings.HasPrefix(line, "STAGED_FILES:") {
					Endpoint.Say("Exfiltration staging identified potential targets: %s", strings.TrimPrefix(line, "STAGED_FILES:"))
					break
				}
			}
		}
	}

	// Give EDR time to analyze exfiltration patterns
	Endpoint.Wait(4)

	// Phase 4: Deploy and execute masqueraded encryption binary
	Endpoint.Say("Phase 4: Executing masqueraded encryption binary (conhost.exe) with process injection simulation")
	
	// Execute masqueraded binary with encryption simulation parameters
	conhostCmd := exec.Command(conhostPath, "-simulate", "-target", "c:\\F0\\staging")
	conhostCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	
	conhostOutput, conhostErr := conhostCmd.CombinedOutput()
	if conhostErr != nil {
		Endpoint.Say("Masqueraded encryption binary blocked or failed: %v", conhostErr)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	// Check if masqueraded process was detected
	if strings.Contains(string(conhostOutput), "MASQUERADE_DETECTED") {
		Endpoint.Say("Process masquerading was detected by behavioral analysis")
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	} else if strings.Contains(string(conhostOutput), "ENCRYPTION_SIMULATION_COMPLETE") {
		Endpoint.Say("Masqueraded encryption simulation completed without detection")
	} else {
		Endpoint.Say("Masqueraded process may have been interrupted by EDR")
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	// Phase 5: Final assessment of defensive response
	Endpoint.Say("Phase 5: Final assessment of data exfiltration and encryption simulation")
	Endpoint.Wait(3)

	// Check if any data exfiltration or encryption behavior was detected and blocked
	statusFile := filepath.Join(targetDir, "exfiltration_status.txt")
	if _, err := os.Stat(statusFile); err == nil {
		statusData, _ := os.ReadFile(statusFile)
		status := strings.TrimSpace(string(statusData))
		
		if status == "BLOCKED" || status == "DETECTED" {
			Endpoint.Say("Data exfiltration and encryption simulation was detected and blocked")
			Endpoint.Stop(Endpoint.ExecutionPrevented)
		}
	}

	// If we reach here, the simulation completed without sufficient defensive response
	Endpoint.Say("Data exfiltration and encryption simulation completed successfully")
	Endpoint.Say("WARNING: Cloud exfiltration and ransomware behavioral patterns were not adequately detected")
	
	// Cleanup
	cleanup(targetDir)
	
	Endpoint.Stop(Endpoint.Unprotected)
}

func cleanup(targetDir string) {
	Endpoint.Say("Cleaning up simulation artifacts")
	
	// Remove simulation files
	files := []string{
		"azure_reconnaissance.ps1",
		"data_exfiltration.ps1", 
		"conhost.exe",
		"exfiltration_status.txt",
		"azure_storage_info.json",
		"staged_data.zip",
	}
	
	for _, file := range files {
		filePath := filepath.Join(targetDir, file)
		if err := os.Remove(filePath); err == nil {
			Endpoint.Say("Removed: %s", file)
		}
	}
}

func main() {
	// Standardized F0RT1KA Custom Runner - eliminates 30-second timeout limitation
	Endpoint.Say("Starting test at: %s", time.Now().Format("2006-01-02T15:04:05"))
	Endpoint.Say("Using F0RT1KA standardized test runner")
	
	done := make(chan bool, 1)
	go func() {
		test()
		done <- true
	}()
	
	// 3-minute timeout for this multi-phase exfiltration and encryption simulation
	timeout := 3 * time.Minute
	
	select {
	case <-done:
		Endpoint.Say("Test completed successfully")
	case <-time.After(timeout):
		Endpoint.Say("Test timed out after %v", timeout)
		Endpoint.Stop(Endpoint.TimeoutExceeded)
	}
}