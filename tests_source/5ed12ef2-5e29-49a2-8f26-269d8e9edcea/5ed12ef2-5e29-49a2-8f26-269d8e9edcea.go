// 5ed12ef2-5e29-49a2-8f26-269d8e9edcea.go - Multi-Stage Ransomware Simulation
// Tests EDR/AV capabilities against a complete 5-stage ransomware killchain

//go:build windows
// +build windows

/*
ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
NAME: Multi-Stage Ransomware Killchain
TECHNIQUES: T1204.002, T1134.001, T1083, T1486, T1491.001
UNIT: response
CREATED: 2024-01-15
*/

package main

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	cert_installer "github.com/preludeorg/libraries/go/tests/cert_installer"
	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

// Embed signed stage binaries (these will be built and signed before embedding)
//go:embed 5ed12ef2-5e29-49a2-8f26-269d8e9edcea-T1204.002.exe
var stage1Binary []byte

//go:embed 5ed12ef2-5e29-49a2-8f26-269d8e9edcea-T1134.001.exe
var stage2Binary []byte

//go:embed 5ed12ef2-5e29-49a2-8f26-269d8e9edcea-T1083.exe
var stage3Binary []byte

//go:embed 5ed12ef2-5e29-49a2-8f26-269d8e9edcea-T1486.exe
var stage4Binary []byte

//go:embed 5ed12ef2-5e29-49a2-8f26-269d8e9edcea-T1491.001.exe
var stage5Binary []byte

// Embed recovery script for safety
//go:embed recovery.ps1
var recoveryScript []byte

// Stage definition
type Stage struct {
	ID          int
	Name        string
	Technique   string
	BinaryName  string
	BinaryData  []byte
	Description string
	Critical    bool // If true, this stage is a key detection point
}

func test() {
	// Initialize comprehensive logger
	InitLogger("5ed12ef2-5e29-49a2-8f26-269d8e9edcea", "Multi-Stage Ransomware Killchain")

	// Log initialization after InitLogger() releases mutex (avoids deadlock)
	LogMessage("INFO", "Initialization", "Test Multi-Stage Ransomware Killchain started")

	defer func() {
		if r := recover(); r != nil {
			LogMessage("CRITICAL", "Runtime", fmt.Sprintf("Panic recovered: %v", r))
			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Panic: %v", r))
		}
	}()

	// Phase 0: Initialization with Dropper
	LogPhaseStart(0, "Test Initialization")

	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		LogMessage("ERROR", "Initialization", fmt.Sprintf("Dropper initialization failed: %v", err))
		LogPhaseEnd(0, "failed", "Dropper initialization failed")
		SaveLog(Endpoint.UnexpectedTestError, "Dropper initialization failed")
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	LogPhaseEnd(0, "success", "Test initialized successfully")

	// Define the ransomware killchain
	killchain := []Stage{
		{
			ID:          1,
			Name:        "Initial Execution",
			Technique:   "T1204.002",
			BinaryName:  "5ed12ef2-5e29-49a2-8f26-269d8e9edcea-T1204.002.exe",
			BinaryData:  stage1Binary,
			Description: "User Execution - Malicious File",
			Critical:    false,
		},
		{
			ID:          2,
			Name:        "Privilege Escalation",
			Technique:   "T1134.001",
			BinaryName:  "5ed12ef2-5e29-49a2-8f26-269d8e9edcea-T1134.001.exe",
			BinaryData:  stage2Binary,
			Description: "Access Token Manipulation",
			Critical:    true, // Key detection point
		},
		{
			ID:          3,
			Name:        "Discovery",
			Technique:   "T1083",
			BinaryName:  "5ed12ef2-5e29-49a2-8f26-269d8e9edcea-T1083.exe",
			BinaryData:  stage3Binary,
			Description: "File and Directory Discovery",
			Critical:    false,
		},
		{
			ID:          4,
			Name:        "Encryption",
			Technique:   "T1486",
			BinaryName:  "5ed12ef2-5e29-49a2-8f26-269d8e9edcea-T1486.exe",
			BinaryData:  stage4Binary,
			Description: "Data Encrypted for Impact",
			Critical:    true, // Most critical detection point
		},
		{
			ID:          5,
			Name:        "Ransom Note",
			Technique:   "T1491.001",
			BinaryName:  "5ed12ef2-5e29-49a2-8f26-269d8e9edcea-T1491.001.exe",
			BinaryData:  stage5Binary,
			Description: "Defacement - Internal Defacement",
			Critical:    false,
		},
	}

	// Extract all stage binaries
	LogPhaseStart(1, "Stage Binary Extraction")
	Endpoint.Say("Extracting %d ransomware stage binaries...", len(killchain))

	for _, stage := range killchain {
		if err := extractStage(stage); err != nil {
			LogPhaseEnd(1, "error", fmt.Sprintf("Failed to extract %s", stage.BinaryName))
			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Extraction failed: %v", err))
			Endpoint.Stop(Endpoint.UnexpectedTestError)
		}
		Endpoint.Say("  [+] Extracted: %s (%s)", stage.BinaryName, stage.Technique)
	}

	// Extract recovery script
	recoveryPath := filepath.Join("c:\\F0", "ransomware_recovery.ps1")
	if err := os.WriteFile(recoveryPath, recoveryScript, 0644); err != nil {
		Endpoint.Say("  [!] Warning: Could not extract recovery script")
	} else {
		Endpoint.Say("  [+] Extracted: ransomware_recovery.ps1 (safety mechanism)")
		LogFileDropped("ransomware_recovery.ps1", recoveryPath, int64(len(recoveryScript)), false)
	}

	LogPhaseEnd(1, "success", fmt.Sprintf("Extracted %d stage binaries", len(killchain)))

	// Execute killchain in sequential order
	Endpoint.Say("")
	Endpoint.Say("=================================================================")
	Endpoint.Say("EXECUTING RANSOMWARE KILLCHAIN")
	Endpoint.Say("=================================================================")

	for _, stage := range killchain {
		LogStageStart(stage.ID, stage.Technique, stage.Name)

		Endpoint.Say("")
		Endpoint.Say("-----------------------------------------------------------------")
		Endpoint.Say("STAGE %d: %s", stage.ID, stage.Name)
		Endpoint.Say("Technique: %s - %s", stage.Technique, stage.Description)
		if stage.Critical {
			Endpoint.Say("CRITICAL: This is a key detection point")
		}
		Endpoint.Say("-----------------------------------------------------------------")

		exitCode := executeStage(stage)

		if exitCode == 126 || exitCode == 105 {
			// Stage blocked by EDR
			LogStageEnd(stage.ID, "blocked", exitCode, fmt.Sprintf("EDR blocked %s", stage.Technique))

			Endpoint.Say("")
			Endpoint.Say("=================================================================")
			Endpoint.Say("RANSOMWARE BLOCKED AT STAGE %d", stage.ID)
			Endpoint.Say("=================================================================")
			Endpoint.Say("EDR successfully prevented: %s (%s)", stage.Name, stage.Technique)

			// Final evaluation - PROTECTED
			evaluateProtected(stage, exitCode)
			return

		} else if exitCode != 0 {
			// Stage error (not blocked, but failed)
			LogStageEnd(stage.ID, "error", exitCode, fmt.Sprintf("Stage error: exit code %d", exitCode))
			Endpoint.Say("  [!] Stage error: exit code %d", exitCode)
			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Stage %s failed with error", stage.Technique))
			Endpoint.Stop(Endpoint.UnexpectedTestError)

		} else {
			// Stage succeeded
			LogStageEnd(stage.ID, "success", exitCode, fmt.Sprintf("%s completed", stage.Technique))
			Endpoint.Say("  [!] Stage %d completed successfully - NOT BLOCKED", stage.ID)

			if stage.Critical {
				Endpoint.Say("  [!] WARNING: Critical detection point missed!")
			}
		}

		// Brief pause between stages
		time.Sleep(1 * time.Second)
	}

	// All stages succeeded = VULNERABLE
	evaluateVulnerable()
}

func extractStage(stage Stage) error {
	targetDir := "c:\\F0"
	os.MkdirAll(targetDir, 0755)

	stagePath := filepath.Join(targetDir, stage.BinaryName)
	if err := os.WriteFile(stagePath, stage.BinaryData, 0755); err != nil {
		return fmt.Errorf("failed to write %s: %v", stage.BinaryName, err)
	}

	LogFileDropped(stage.BinaryName, stagePath, int64(len(stage.BinaryData)), false)
	return nil
}

func executeStage(stage Stage) int {
	stagePath := filepath.Join("c:\\F0", stage.BinaryName)

	// Check if binary was quarantined
	if _, err := os.Stat(stagePath); os.IsNotExist(err) {
		Endpoint.Say("  [+] Stage binary quarantined before execution")
		return 105 // Quarantined
	}

	cmd := exec.Command(stagePath)
	cmd.Dir = "c:\\F0"

	// Execute stage and wait for completion
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return exitErr.ExitCode()
		}
		return 999 // Unknown error
	}

	return 0 // Success
}

func evaluateProtected(stage Stage, exitCode int) {
	Endpoint.Say("")
	Endpoint.Say("=================================================================")
	Endpoint.Say("FINAL EVALUATION: Protection Effectiveness Analysis")
	Endpoint.Say("=================================================================")
	Endpoint.Say("")
	Endpoint.Say("✅ RESULT: PROTECTED")
	Endpoint.Say("=================================================================")
	Endpoint.Say("System successfully prevented ransomware attack")
	Endpoint.Say("")
	Endpoint.Say("Protection Details:")
	Endpoint.Say("  • Blocked at Stage %d: %s", stage.ID, stage.Name)
	Endpoint.Say("  • Technique prevented: %s", stage.Technique)
	Endpoint.Say("  • Attack chain interrupted before critical damage")
	if stage.ID <= 3 {
		Endpoint.Say("  • Early-stage detection - excellent protection")
	} else if stage.ID == 4 {
		Endpoint.Say("  • Encryption blocked - critical save")
	}
	Endpoint.Say("")
	Endpoint.Say("Security Status: ENDPOINT IS SECURE")
	Endpoint.Say("=================================================================")

	SaveLog(Endpoint.ExecutionPrevented, fmt.Sprintf("Ransomware blocked at stage %d (%s)", stage.ID, stage.Technique))
	Endpoint.Stop(Endpoint.ExecutionPrevented)
}

func evaluateVulnerable() {
	Endpoint.Say("")
	Endpoint.Say("=================================================================")
	Endpoint.Say("FINAL EVALUATION: Critical Security Failure")
	Endpoint.Say("=================================================================")
	Endpoint.Say("")
	Endpoint.Say("❌ RESULT: VULNERABLE")
	Endpoint.Say("=================================================================")
	Endpoint.Say("CRITICAL: Complete ransomware killchain executed successfully")
	Endpoint.Say("")
	Endpoint.Say("Attack Summary:")
	Endpoint.Say("  • Stage 1: Initial execution - NOT BLOCKED")
	Endpoint.Say("  • Stage 2: Privilege escalation - NOT BLOCKED")
	Endpoint.Say("  • Stage 3: File discovery - NOT BLOCKED")
	Endpoint.Say("  • Stage 4: Encryption - NOT BLOCKED")
	Endpoint.Say("  • Stage 5: Ransom note - NOT BLOCKED")
	Endpoint.Say("")
	Endpoint.Say("Impact Assessment:")
	Endpoint.Say("  • Files have been encrypted (simulation)")
	Endpoint.Say("  • Ransom notes deployed")
	Endpoint.Say("  • System compromised")
	Endpoint.Say("")
	Endpoint.Say("IMMEDIATE ACTION REQUIRED:")
	Endpoint.Say("  1. Review EDR/AV configuration immediately")
	Endpoint.Say("  2. Enable behavioral ransomware protection")
	Endpoint.Say("  3. Implement application control")
	Endpoint.Say("  4. Review and harden security policies")
	Endpoint.Say("")
	Endpoint.Say("Recovery: Run ransomware_recovery.ps1 to clean up test artifacts")
	Endpoint.Say("=================================================================")

	SaveLog(Endpoint.Unprotected, "Complete ransomware killchain succeeded - system vulnerable")
	Endpoint.Stop(Endpoint.Unprotected)
}

// Standardized F0RT1KA Runner with multi-stage support
func main() {
	Endpoint.Say("F0RT1KA Multi-Stage Ransomware Simulation")
	Endpoint.Say("Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea")
	Endpoint.Say("Techniques: T1204.002 → T1134.001 → T1083 → T1486 → T1491.001")
	Endpoint.Say("Starting at: %s", time.Now().Format("2006-01-02T15:04:05"))
	Endpoint.Say("")

	// Pre-flight certificate check
	Endpoint.Say("Pre-flight: Checking F0RT1KA certificate...")
	if err := cert_installer.EnsureCertificateInstalled(); err != nil {
		Endpoint.Say("❌ FATAL: Certificate installation failed: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	Endpoint.Say("✅ F0RT1KA certificate verified")
	Endpoint.Say("")

	// Run test with timeout protection
	done := make(chan bool, 1)
	go func() {
		test()
		done <- true
	}()

	// Extended timeout for multi-stage test
	timeout := 5 * time.Minute

	select {
	case <-done:
		Endpoint.Say("Test completed")
	case <-time.After(timeout):
		Endpoint.Say("Test timed out after %v", timeout)
		if globalLog != nil {
			LogMessage("ERROR", "Test Timeout", fmt.Sprintf("Test exceeded timeout of %v", timeout))
			SaveLog(Endpoint.TimeoutExceeded, fmt.Sprintf("Test exceeded timeout of %v", timeout))
		}
		Endpoint.Stop(Endpoint.TimeoutExceeded)
	}
}