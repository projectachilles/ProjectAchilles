//go:build windows
// +build windows

/*
ID: 109266e2-2310-40ea-9f63-b97e4b7fda61
NAME: SafePay Enhanced Ransomware Simulation & Mass Data Operations
TECHNIQUE: T1486, T1560.001, T1071.001, T1490, T1083, T1005
UNIT: response
CREATED: 2025-07-30 00:00:00.000000
ENHANCED: 2025-08-06 00:00:00.000000
*/
package main

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

//go:embed safepay_ransomware_sim_v3.ps1
var ransomwareScript []byte

//go:embed WinRAR.exe 
var winrarBinary []byte

// Helper function to check if PowerShell processes are running
func isPowerShellRunning() bool {
	cmd := exec.Command("tasklist", "/FI", "IMAGENAME eq powershell.exe", "/FO", "CSV")
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	
	lines := strings.Split(string(output), "\n")
	// More than just header line means processes are running
	return len(lines) > 2
}

// Helper function to read status from PowerShell script
func readScriptStatus() string {
	statusFile := "C:\\F0\\status.txt"
	data, err := os.ReadFile(statusFile)
	if err != nil {
		return ""
	}
	
	// Remove UTF-8 BOM if present (check bytes before converting to string)
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		data = data[3:]
	}
	
	// Convert to string and clean up
	status := string(data)
	
	// Trim whitespace and return
	return strings.TrimSpace(status)
}

// Helper function to count files in a directory
func countFilesInDir(dirPath string) int {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return 0
	}
	return len(entries)
}

func executeRansomwareSimulation() error {
	// Drop all files to c:\F0
	targetDir := "c:\\F0"
	os.MkdirAll(targetDir, 0755)
	
	// Drop WinRAR binary
	winrarPath := filepath.Join(targetDir, "WinRAR.exe")
	err := os.WriteFile(winrarPath, winrarBinary, 0755)
	if err != nil {
		return err
	}
	
	// Drop PowerShell script (v3 with fixes)
	scriptPath := filepath.Join(targetDir, "safepay_ransomware_sim_v3.ps1")
	err = os.WriteFile(scriptPath, ransomwareScript, 0644)
	if err != nil {
		return err
	}
	
	// Remove any existing status file
	statusFile := "C:\\F0\\status.txt"
	os.Remove(statusFile)
	
	// Start PowerShell script as detached process
	Endpoint.Say("Starting ransomware simulation as detached process...")
	cmd := exec.Command("cmd.exe", "/C", "start", "/MIN", "powershell.exe", "-ExecutionPolicy", "Bypass", "-File", "C:\\F0\\safepay_ransomware_sim_v3.ps1")
	cmd.Dir = targetDir
	
	err = cmd.Run()
	if err != nil {
		Endpoint.Say("Failed to start detached PowerShell process: %v", err)
		return err
	}
	
	Endpoint.Say("Script launched, monitoring for complete simulation phases...")
	Endpoint.Say("Extended monitoring enabled - tracking all ransomware phases to completion")
	
	// Monitor for up to 4 minutes - enough time for full simulation
	filesCreated := 0
	scriptStartedRunning := false
	lastStatus := ""
	maxMonitoringTime := 240 // 4 minutes in seconds
	
	// Track simulation phases
	phases := map[string]bool{
		"STARTED": false,
		"FILES_CREATED": false,
		"COMPRESSION_DONE": false,
		"RANSOM_NOTE_CREATED": false,
		"COMPLETED": false,
	}
	
	for i := 0; i < maxMonitoringTime; i++ {
		time.Sleep(1 * time.Second)
		
		// Check current status from script
		currentStatus := readScriptStatus()
		
		// Log new status updates
		if currentStatus != lastStatus && currentStatus != "" {
			Endpoint.Say("Phase update: %s", currentStatus)
			lastStatus = currentStatus
		}
		
		// Track phase progression
		if currentStatus == "STARTED" {
			phases["STARTED"] = true
			scriptStartedRunning = true
		}
		
		if strings.HasPrefix(currentStatus, "FILES_CREATED:") {
			phases["FILES_CREATED"] = true
			scriptStartedRunning = true  // Mark script as running
			parts := strings.Split(currentStatus, ":")
			if len(parts) > 1 {
				if count, err := strconv.Atoi(parts[1]); err == nil {
					filesCreated = count
					Endpoint.Say("Phase 1 complete: Mass file creation (%d files)", filesCreated)
				}
			}
		}
		
		if currentStatus == "COMPRESSION_DONE" || currentStatus == "COMPRESSION_ERROR" {
			if currentStatus == "COMPRESSION_DONE" {
				phases["COMPRESSION_DONE"] = true
				Endpoint.Say("Phase 2 complete: Multi-phase compression and archiving")
			} else {
				Endpoint.Say("Phase 2 encountered errors during compression")
			}
			scriptStartedRunning = true
		}
		
		if currentStatus == "RANSOM_NOTE_CREATED" {
			phases["RANSOM_NOTE_CREATED"] = true
			scriptStartedRunning = true
			Endpoint.Say("Phase 3 complete: Ransom note creation")
		}
		
		// ONLY declare success on full completion
		if strings.HasPrefix(currentStatus, "COMPLETED:") {
			phases["COMPLETED"] = true
			if encCount, err := strconv.Atoi(strings.Split(currentStatus, ":")[1]); err == nil {
				Endpoint.Say("SUCCESS: Full ransomware simulation completed!")
				Endpoint.Say("All phases executed successfully:")
				Endpoint.Say("  - Files created: %d", filesCreated)
				Endpoint.Say("  - Files encrypted: %d", encCount)
				
				// Verify artifacts
				if _, err := os.Stat("C:\\Users\\fortika-test\\readme_safepay.txt"); err == nil {
					Endpoint.Say("  - Ransom note confirmed: C:\\Users\\fortika-test\\readme_safepay.txt")
				}
				
				// Check for detailed log file
				if _, err := os.Stat("C:\\F0\\safepay_simulation.log"); err == nil {
					Endpoint.Say("  - Detailed simulation log: C:\\F0\\safepay_simulation.log")
					Endpoint.Say("  - Log contains all .safepay encryption events for verification")
				}
				
				// Check for archive files
				archiveCount := countFilesInDir("C:\\Users\\fortika-test")
				if archiveCount > 0 {
					Endpoint.Say("  - Archive files created: %d", archiveCount)
				}
				
				return nil  // SUCCESS - Full simulation completed
			}
		}
		
		// Check if PowerShell was killed during execution (EDR intervention)
		powershellRunning := isPowerShellRunning()
		if !powershellRunning && scriptStartedRunning && i > 3 {
			Endpoint.Say("PowerShell process terminated during phase execution")
			
			// Report which phases completed before termination
			completedPhases := []string{}
			for phaseName, completed := range phases {
				if completed {
					completedPhases = append(completedPhases, phaseName)
				}
			}
			Endpoint.Say("Phases completed before termination: %v", completedPhases)
			Endpoint.Say("EDR intervention detected - execution prevented")
			Endpoint.Stop(Endpoint.ExecutionPrevented)
		}
		
		// Progress reporting every 30 seconds for long-running test
		if i > 0 && i%30 == 0 {
			if scriptStartedRunning {
				// Count completed phases
				completedCount := 0
				for _, completed := range phases {
					if completed {
						completedCount++
					}
				}
				Endpoint.Say("Monitoring progress: %d/5 phases completed (%d seconds elapsed)", completedCount, i)
				
				// Additional status info
				if phases["FILES_CREATED"] && !phases["COMPRESSION_DONE"] {
					Endpoint.Say("  Currently: Performing multi-phase compression operations...")
				} else if phases["COMPRESSION_DONE"] && !phases["RANSOM_NOTE_CREATED"] {
					Endpoint.Say("  Currently: Mass file deletion and encryption in progress...")
				}
			} else {
				Endpoint.Say("Waiting for script to begin (%d seconds elapsed)...", i)
			}
		}
		
		// Early success exit when fully completed
		if phases["COMPLETED"] {
			break
		}
	}
	
	// Final evaluation after monitoring period
	finalStatus := readScriptStatus()
	Endpoint.Say("Final status after monitoring: %s", finalStatus)
	
	// Count final completed phases
	completedCount := 0
	for _, completed := range phases {
		if completed {
			completedCount++
		}
	}
	
	// Determine result based on completion level
	if phases["COMPLETED"] {
		Endpoint.Say("SUCCESS: Full ransomware simulation completed without intervention")
		Endpoint.Say("All malicious behaviors executed successfully - system is UNPROTECTED")
		return nil
	}
	
	// Check if EDR intervened
	if !isPowerShellRunning() && scriptStartedRunning {
		Endpoint.Say("PowerShell process was terminated after %d/5 phases", completedCount)
		Endpoint.Say("EDR successfully detected and blocked the ransomware simulation")
		return fmt.Errorf("execution prevented by security software")
	}
	
	// Check if script never started
	if !scriptStartedRunning {
		Endpoint.Say("Script failed to initialize - possible immediate blocking")
		return fmt.Errorf("script blocked at initialization")
	}
	
	// Timeout without completion
	Endpoint.Say("Simulation did not complete within 4-minute monitoring window")
	Endpoint.Say("Completed phases: %d/5", completedCount)
	if isPowerShellRunning() {
		Endpoint.Say("PowerShell still running - simulation may be stalled or slowed by EDR")
		return fmt.Errorf("simulation stalled - possible EDR interference")
	}
	return fmt.Errorf("simulation incomplete - unknown issue")
}

func test() {
	// Initialize the dropper
	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		Endpoint.Say("Dropper initialization failed: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	Endpoint.Say("Starting SafePay Enhanced Ransomware Simulation with Comprehensive Logging")
	Endpoint.Say("This test simulates realistic ransomware behavior targeting user directories")
	Endpoint.Say("Expected behaviors: Mass file creation, compression, deletion, encryption")
	Endpoint.Say("Enhanced v3: Fixed deletion logic and compression errors")
	Endpoint.Say("Dropping WinRAR binary and enhanced PowerShell script v3")
	Endpoint.Say("Checking for initial defensive reaction")
	Endpoint.Wait(2)  // Reduced from 5 to save time

	// Check if components get quarantined
	if Endpoint.Quarantined("safepay_ransomware_sim_v3.ps1", ransomwareScript) {
		Endpoint.Say("SafePay enhanced ransomware script (v3 with fixes) was caught!")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}

	if Endpoint.Quarantined("WinRAR.exe", winrarBinary) {
		Endpoint.Say("WinRAR binary was caught!")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}

	Endpoint.Say("Components were not caught, executing enhanced ransomware simulation v3")
	Endpoint.Say("Target: C:\\Users\\fortika-test (realistic user directory targeting)")
	Endpoint.Say("Expected operations: 500-1000 files, multi-phase compression, selective deletion")
	Endpoint.Say("FIXED: Selective deletion preserves files for .safepay encryption")

	// Try to execute the enhanced ransomware simulation
	err := executeRansomwareSimulation()
	if err != nil {
		Endpoint.Say("Got error \"%v\" when executing enhanced ransomware simulation", err)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	Endpoint.Say("Enhanced ransomware simulation v3 execution was not prevented")
	Endpoint.Say("Mass file operations, compression, selective deletion, and .safepay encryption completed successfully")
	Endpoint.Stop(Endpoint.Unprotected)
}

func main() {
	// CUSTOM RUNNER: Bypass Endpoint.Start() to avoid 30-second timeout limitation
	// This test requires 4+ minutes to properly validate ransomware simulation phases
	
	Endpoint.Say("Starting test at: %s", time.Now().Format("2006-01-02T15:04:05"))
	Endpoint.Say("Using custom runner with extended timeout for long-running simulation")
	
	// Run test in goroutine with custom timeout
	done := make(chan bool, 1)
	go func() {
		test()
		done <- true
	}()
	
	// Wait for test completion or custom timeout (5 minutes)
	select {
	case <-done:
		// Test completed normally
		Endpoint.Say("Test completed within timeout window")
	case <-time.After(5 * time.Minute):
		// Custom timeout - much longer than the simulation needs
		Endpoint.Say("Test timed out after 5 minutes")
		Endpoint.Stop(Endpoint.TimeoutExceeded)
	}
}
