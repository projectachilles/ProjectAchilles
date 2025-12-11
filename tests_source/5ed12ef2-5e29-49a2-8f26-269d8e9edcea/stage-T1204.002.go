// stage-T1204.002.go - Stage 1: User Execution - Malicious File
// Simulates initial ransomware payload execution

//go:build windows
// +build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// Standardized exit codes
const (
	StageSuccess     = 0
	StageBlocked     = 126
	StageQuarantined = 105
	StageError       = 999
)

func main() {
	// Attach to shared log
	if err := AttachLogger("5ed12ef2-5e29-49a2-8f26-269d8e9edcea", "Stage 1: T1204.002"); err != nil {
		fmt.Printf("[ERROR] Failed to attach logger: %v\n", err)
	}

	LogMessage("INFO", "T1204.002", "Starting Stage 1: User Execution - Malicious File")

	// Simulate initial payload execution
	if err := simulateInitialExecution(); err != nil {
		LogMessage("ERROR", "T1204.002", fmt.Sprintf("Stage blocked: %v", err))

		// Append stage result to shared log
		stageData := StageLog{
			StageID:       1,
			Technique:     "T1204.002",
			Name:          "User Execution - Malicious File",
			StartTime:     time.Now(),
			EndTime:       time.Now(),
			DurationMs:    0,
			Status:        "blocked",
			ExitCode:      StageBlocked,
			BlockedReason: err.Error(),
		}
		AppendToSharedLog(stageData)

		os.Exit(StageBlocked)
	}

	// Stage completed successfully
	LogMessage("SUCCESS", "T1204.002", "Initial payload execution successful")

	stageData := StageLog{
		StageID:    1,
		Technique:  "T1204.002",
		Name:       "User Execution - Malicious File",
		StartTime:  time.Now(),
		EndTime:    time.Now(),
		DurationMs: 0,
		Status:     "success",
		ExitCode:   StageSuccess,
	}
	AppendToSharedLog(stageData)

	os.Exit(StageSuccess)
}

func simulateInitialExecution() error {
	targetDir := "c:\\F0"

	// Simulate dropper behavior - create initial ransomware binary
	fmt.Println("[*] Simulating initial payload execution...")
	fmt.Printf("[*] Working directory: %s\n", targetDir)

	// Check if we can execute in the directory
	testScript := `
@echo off
echo Ransomware payload initialized > init.txt
exit 0
`

	batPath := filepath.Join(targetDir, "init_test.bat")
	if err := os.WriteFile(batPath, []byte(testScript), 0755); err != nil {
		return fmt.Errorf("write blocked: %v", err)
	}

	// Try to execute the batch file
	cmd := exec.Command("cmd.exe", "/C", batPath)
	cmd.Dir = targetDir

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Clean up
		os.Remove(batPath)
		return fmt.Errorf("execution prevented by EDR: %v", err)
	}

	fmt.Printf("[+] Initial execution test successful: %s\n", output)

	// Simulate creating ransomware components
	components := []string{
		"crypto_engine.dat",
		"file_enum.dat",
		"ransom_core.dat",
	}

	for _, comp := range components {
		compPath := filepath.Join(targetDir, comp)
		data := []byte(fmt.Sprintf("RANSOMWARE_COMPONENT_%s", comp))

		if err := os.WriteFile(compPath, data, 0644); err != nil {
			return fmt.Errorf("component drop blocked for %s: %v", comp, err)
		}

		fmt.Printf("[+] Dropped component: %s\n", comp)
		LogFileDropped(comp, compPath, int64(len(data)), false)

		// Brief pause to allow EDR detection
		time.Sleep(100 * time.Millisecond)

		// Check if file still exists (not quarantined)
		if _, err := os.Stat(compPath); os.IsNotExist(err) {
			return fmt.Errorf("component %s quarantined by AV/EDR", comp)
		}
	}

	// Simulate process creation for next stage
	fmt.Println("[*] Attempting to spawn ransomware process...")

	// Create a simple test executable marker
	markerPath := filepath.Join(targetDir, "stage1_complete.marker")
	if err := os.WriteFile(markerPath, []byte("STAGE1_COMPLETE"), 0644); err != nil {
		return fmt.Errorf("marker creation blocked: %v", err)
	}

	// Test if we can spawn child processes (critical for ransomware)
	cmd = exec.Command("cmd.exe", "/C", "echo", "PROCESS_SPAWN_TEST")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("process creation blocked by EDR: %v", err)
	}

	fmt.Println("[+] Process spawn capability confirmed")
	fmt.Println("[+] Stage 1 completed - Initial execution successful")

	// Clean up test files
	os.Remove(batPath)
	os.Remove(filepath.Join(targetDir, "init.txt"))

	return nil
}