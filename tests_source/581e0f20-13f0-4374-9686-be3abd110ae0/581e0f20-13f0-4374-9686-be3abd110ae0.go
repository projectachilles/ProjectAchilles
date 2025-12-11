//go:build windows
// +build windows

/*
ID: 581e0f20-13f0-4374-9686-be3abd110ae0
NAME: Ransomware Encryption via BitLocker
TECHNIQUES: T1070.001, T1562.004, T1082, T1083, T1486, T1490
UNIT: response
CREATED: 2024-12-01
*/

// Ransomware Encryption via BitLocker - Multi-Stage Security Test
// F0RT1KA Security Testing Framework
//
// This test simulates a ransomware attack that leverages Windows BitLocker
// for data encryption, based on NCC Group research. The attack chain includes:
//
// Stage 1: Defense Evasion (T1070.001, T1562.004)
//   - Clear custom event log channel
//   - Create and delete test firewall rule
//
// Stage 2: Discovery (T1082, T1083)
//   - System information enumeration
//   - BitLocker availability check
//   - Drive enumeration
//
// Stage 3: Impact (T1486, T1490)
//   - Create isolated VHD for safe BitLocker encryption
//   - Enable BitLocker on VHD
//   - Execute VSS shadow deletion on VHD
//   - Cleanup: decrypt, dismount, delete VHD
//
// SAFETY FEATURES:
//   - VHD-based isolation: All BitLocker operations on isolated VHD
//   - Custom event log channel: No real log destruction
//   - Test firewall rule: No real firewall modification
//   - Complete cleanup: All artifacts removed after test
//
// EXIT CODES:
//   101 - Attack succeeded (system unprotected)
//   126 - Attack blocked by EDR (system protected)
//   105 - Binary quarantined
//   999 - Prerequisites not met

package main

import (
	"bytes"
	_ "embed"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

// ==============================================================================
// CONFIGURATION
// ==============================================================================

const (
	TEST_UUID = "581e0f20-13f0-4374-9686-be3abd110ae0"
	TEST_NAME = "Ransomware Encryption via BitLocker"
)

// Embed signed stage binaries (MUST be signed before embedding!)
// Build process:
// 1. Build: GOOS=windows GOARCH=amd64 go build -o <uuid>-stage1.exe stage1-defense-evasion.go test_logger.go org_resolver.go es_config.go
// 2. Sign: ../../utils/codesign sign-nested <binary> <org-cert> ../../signing-certs/F0RT1KA.pfx
// 3. Then this //go:embed directive will embed the SIGNED binary

//go:embed 581e0f20-13f0-4374-9686-be3abd110ae0-stage1.exe
var stage1Binary []byte

//go:embed 581e0f20-13f0-4374-9686-be3abd110ae0-stage2.exe
var stage2Binary []byte

//go:embed 581e0f20-13f0-4374-9686-be3abd110ae0-stage3.exe
var stage3Binary []byte

//go:embed cleanup_utility.exe
var cleanupBinary []byte

// ==============================================================================
// STAGE DEFINITION
// ==============================================================================

// KillchainStage represents one stage in the attack killchain
// Named KillchainStage to avoid conflict with test_logger.go Stage struct
type KillchainStage struct {
	ID          int      // Sequential stage number (1, 2, 3, ...)
	Name        string   // Human-readable stage name
	Techniques  []string // MITRE ATT&CK technique IDs for this stage
	BinaryName  string   // Stage binary filename
	BinaryData  []byte   // Embedded signed binary data
	Description string   // Brief description of what this stage does
}

// ==============================================================================
// MAIN FUNCTION
// ==============================================================================

func main() {
	// Initialize logger with Schema v2.0 metadata and execution context
	metadata := TestMetadata{
		Version:  "1.0.0",
		Category: "ransomware",
		Severity: "critical",
		Techniques: []string{
			"T1070.001", // Clear Windows Event Logs
			"T1562.004", // Disable or Modify System Firewall
			"T1082",     // System Information Discovery
			"T1083",     // File and Directory Discovery
			"T1486",     // Data Encrypted for Impact
			"T1490",     // Inhibit System Recovery
		},
		Tactics: []string{
			"defense-evasion",
			"discovery",
			"impact",
		},
		Score: 9.0,
		ScoreBreakdown: &ScoreBreakdown{
			RealWorldAccuracy:       2.8,
			TechnicalSophistication: 3.0,
			SafetyMechanisms:        2.0,
			DetectionOpportunities:  0.7,
			LoggingObservability:    1.0,
		},
		Tags: []string{"multi-stage", "bitlocker", "ransomware", "vhd-isolation", "encryption"},
	}

	// Resolve organization info
	orgInfo := ResolveOrganization("")

	// Define execution context
	executionContext := ExecutionContext{
		ExecutionID:    uuid.New().String(),
		Organization:   orgInfo.UUID,
		Environment:    "lab",
		DeploymentType: "manual",
		Configuration: &ExecutionConfiguration{
			TimeoutMs:         600000, // 10 minutes for VHD operations
			CertificateMode:   "self-healing",
			MultiStageEnabled: true,
		},
	}

	// Initialize logger with v2.0 signature
	InitLogger(TEST_UUID, TEST_NAME, metadata, executionContext)

	// Panic recovery
	defer func() {
		if r := recover(); r != nil {
			LogMessage("CRITICAL", "Runtime", fmt.Sprintf("Panic recovered: %v", r))
			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Test panic: %v", r))
			Endpoint.Stop(Endpoint.UnexpectedTestError)
		}
	}()

	Endpoint.Say("=================================================================")
	Endpoint.Say("F0RT1KA Multi-Stage Test: %s", TEST_NAME)
	Endpoint.Say("Test UUID: %s", TEST_UUID)
	Endpoint.Say("=================================================================")
	Endpoint.Say("")
	Endpoint.Say("Attack Simulation: Ransomware using Windows BitLocker")
	Endpoint.Say("Reference: NCC Group Research on BitLocker Ransomware")
	Endpoint.Say("")
	Endpoint.Say("SAFETY FEATURES:")
	Endpoint.Say("  - VHD-based isolation for BitLocker operations")
	Endpoint.Say("  - Custom event log channel (no real log destruction)")
	Endpoint.Say("  - Test firewall rule (no real firewall changes)")
	Endpoint.Say("  - Complete cleanup after test")
	Endpoint.Say("")

	// Run the test
	test()
}

// ==============================================================================
// TEST IMPLEMENTATION
// ==============================================================================

func test() {
	// Define attack killchain
	killchain := []KillchainStage{
		{
			ID:          1,
			Name:        "Defense Evasion",
			Techniques:  []string{"T1070.001", "T1562.004"},
			BinaryName:  fmt.Sprintf("%s-stage1.exe", TEST_UUID),
			BinaryData:  stage1Binary,
			Description: "Clear event logs, modify firewall rules",
		},
		{
			ID:          2,
			Name:        "Discovery",
			Techniques:  []string{"T1082", "T1083"},
			BinaryName:  fmt.Sprintf("%s-stage2.exe", TEST_UUID),
			BinaryData:  stage2Binary,
			Description: "Enumerate system, check BitLocker availability",
		},
		{
			ID:          3,
			Name:        "Impact",
			Techniques:  []string{"T1486", "T1490"},
			BinaryName:  fmt.Sprintf("%s-stage3.exe", TEST_UUID),
			BinaryData:  stage3Binary,
			Description: "BitLocker encryption on VHD, VSS deletion",
		},
	}

	// Phase 0: Extract all stage binaries and cleanup utility
	LogPhaseStart(0, "Stage Binary Extraction")
	Endpoint.Say("[*] Phase 0: Extracting %d stage binaries + cleanup utility...", len(killchain))

	targetDir := "c:\\F0"
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		LogPhaseEnd(0, "error", fmt.Sprintf("Failed to create directory: %v", err))
		Endpoint.Say("FATAL: Failed to create target directory: %v", err)
		SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Directory creation failed: %v", err))
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	// Extract stage binaries
	for i, stage := range killchain {
		Endpoint.Say("    [%d/%d] Extracting %s (Techniques: %v)", i+1, len(killchain), stage.BinaryName, stage.Techniques)

		if err := extractStage(stage); err != nil {
			LogPhaseEnd(0, "error", fmt.Sprintf("Failed to extract %s: %v", stage.BinaryName, err))
			Endpoint.Say("")
			Endpoint.Say("FATAL: Failed to extract stage binary: %s", stage.BinaryName)
			Endpoint.Say("    Error: %v", err)
			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Stage extraction failed: %v", err))
			Endpoint.Stop(Endpoint.UnexpectedTestError)
		}
	}

	// Extract cleanup utility
	Endpoint.Say("    [+] Extracting cleanup_utility.exe")
	cleanupPath := filepath.Join(targetDir, "cleanup_utility.exe")
	if err := os.WriteFile(cleanupPath, cleanupBinary, 0755); err != nil {
		LogPhaseEnd(0, "error", fmt.Sprintf("Failed to extract cleanup utility: %v", err))
		Endpoint.Say("FATAL: Failed to extract cleanup utility: %v", err)
		SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Cleanup utility extraction failed: %v", err))
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	LogFileDropped("cleanup_utility.exe", cleanupPath, int64(len(cleanupBinary)), false)

	LogPhaseEnd(0, "success", fmt.Sprintf("Successfully extracted %d stage binaries + cleanup utility", len(killchain)))
	Endpoint.Say("    All binaries extracted successfully")
	Endpoint.Say("")

	// Execute killchain in sequential order
	Endpoint.Say("[*] Executing %d-stage attack killchain...", len(killchain))
	Endpoint.Say("")

	for _, stage := range killchain {
		// Log stage start
		LogStageStart(stage.ID, stage.Techniques[0], stage.Name)

		Endpoint.Say("=================================================================")
		Endpoint.Say("Stage %d/%d: %s", stage.ID, len(killchain), stage.Name)
		Endpoint.Say("Techniques: %v", stage.Techniques)
		Endpoint.Say("Description: %s", stage.Description)
		Endpoint.Say("=================================================================")
		Endpoint.Say("")

		// Execute stage binary
		exitCode := executeStage(stage)

		// Evaluate stage result
		if exitCode == 126 || exitCode == 105 {
			// Stage was blocked by EDR - system is protected
			LogStageBlocked(stage.ID, stage.Techniques[0], fmt.Sprintf("EDR blocked stage (exit code: %d)", exitCode))

			Endpoint.Say("")
			Endpoint.Say("=================================================================")
			Endpoint.Say("FINAL EVALUATION: Stage %d Blocked", stage.ID)
			Endpoint.Say("=================================================================")
			Endpoint.Say("")
			Endpoint.Say("RESULT: PROTECTED")
			Endpoint.Say("")
			Endpoint.Say("EDR successfully blocked the attack at stage %d:", stage.ID)
			Endpoint.Say("  - Stage: %s", stage.Name)
			Endpoint.Say("  - Techniques: %v", stage.Techniques)
			Endpoint.Say("  - Exit Code: %d", exitCode)
			Endpoint.Say("")
			Endpoint.Say("Attack Chain Interrupted:")
			Endpoint.Say("  - Completed Stages: %d/%d", stage.ID-1, len(killchain))
			Endpoint.Say("  - Blocked Stage: %d", stage.ID)
			Endpoint.Say("  - Remaining Stages: %d (not executed)", len(killchain)-stage.ID)
			Endpoint.Say("")
			Endpoint.Say("Security Status: ENDPOINT IS SECURE")
			Endpoint.Say("=================================================================")
			Endpoint.Say("")

			// Run cleanup
			runCleanup()

			SaveLog(Endpoint.ExecutionPrevented, fmt.Sprintf("EDR blocked at stage %d: %s (%v)", stage.ID, stage.Name, stage.Techniques))
			Endpoint.Stop(Endpoint.ExecutionPrevented)

		} else if exitCode == 999 {
			// Prerequisites not met
			LogStageEnd(stage.ID, stage.Techniques[0], "error", fmt.Sprintf("Prerequisites not met (exit code: %d)", exitCode))

			Endpoint.Say("")
			Endpoint.Say("ERROR: Stage %d - Prerequisites not met", stage.ID)
			Endpoint.Say("    Stage: %s", stage.Name)
			Endpoint.Say("    This may indicate:")
			Endpoint.Say("      - Not running as Administrator")
			Endpoint.Say("      - BitLocker feature not available (Windows Home edition)")
			Endpoint.Say("      - Required Windows services not running")
			Endpoint.Say("")

			// Run cleanup
			runCleanup()

			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Stage %d (%s) prerequisites not met", stage.ID, stage.Name))
			Endpoint.Stop(Endpoint.UnexpectedTestError)

		} else if exitCode != 0 {
			// Stage encountered an error
			LogStageEnd(stage.ID, stage.Techniques[0], "error", fmt.Sprintf("Stage failed with exit code %d", exitCode))

			Endpoint.Say("")
			Endpoint.Say("ERROR: Stage %d encountered an error", stage.ID)
			Endpoint.Say("    Stage: %s", stage.Name)
			Endpoint.Say("    Exit Code: %d", exitCode)
			Endpoint.Say("")

			// Run cleanup
			runCleanup()

			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Stage %d (%s) failed with exit code %d", stage.ID, stage.Name, exitCode))
			Endpoint.Stop(Endpoint.UnexpectedTestError)
		}

		// Stage succeeded - continue to next stage
		LogStageEnd(stage.ID, stage.Techniques[0], "success", "Stage completed successfully")
		Endpoint.Say("    Stage %d completed successfully", stage.ID)
		Endpoint.Say("")
	}

	// All stages completed successfully - system is vulnerable
	Endpoint.Say("")
	Endpoint.Say("=================================================================")
	Endpoint.Say("FINAL EVALUATION: All Stages Completed")
	Endpoint.Say("=================================================================")
	Endpoint.Say("")
	Endpoint.Say("RESULT: VULNERABLE")
	Endpoint.Say("")
	Endpoint.Say("CRITICAL: Complete attack chain executed without prevention")
	Endpoint.Say("")
	Endpoint.Say("Attack Chain Summary:")
	Endpoint.Say("  - Total Stages: %d", len(killchain))
	Endpoint.Say("  - Successful Stages: %d", len(killchain))
	Endpoint.Say("  - Blocked Stages: 0")
	Endpoint.Say("")
	Endpoint.Say("Executed Techniques:")
	for _, stage := range killchain {
		Endpoint.Say("  - Stage %d: %s (%v)", stage.ID, stage.Name, stage.Techniques)
	}
	Endpoint.Say("")
	Endpoint.Say("Security Impact: CRITICAL")
	Endpoint.Say("  - Event logs cleared (custom channel)")
	Endpoint.Say("  - Firewall rules manipulated")
	Endpoint.Say("  - System enumeration completed")
	Endpoint.Say("  - BitLocker encryption executed on VHD")
	Endpoint.Say("  - VSS shadow deletion attempted")
	Endpoint.Say("")
	Endpoint.Say("Ransomware Attack Simulation: SUCCESSFUL")
	Endpoint.Say("EDR Failed to detect or prevent attack chain")
	Endpoint.Say("")
	Endpoint.Say("IMMEDIATE ACTION REQUIRED")
	Endpoint.Say("=================================================================")
	Endpoint.Say("")

	// Run cleanup
	runCleanup()

	SaveLog(Endpoint.Unprotected, fmt.Sprintf("All %d stages completed - ransomware attack simulation successful", len(killchain)))
	Endpoint.Stop(Endpoint.Unprotected)
}

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

// extractStage extracts a stage binary to C:\F0
func extractStage(stage KillchainStage) error {
	targetDir := "c:\\F0"

	// Write stage binary to disk
	stagePath := filepath.Join(targetDir, stage.BinaryName)
	if err := os.WriteFile(stagePath, stage.BinaryData, 0755); err != nil {
		return fmt.Errorf("failed to write %s: %v", stage.BinaryName, err)
	}

	// Log file drop
	LogFileDropped(stage.BinaryName, stagePath, int64(len(stage.BinaryData)), false)

	// Brief delay to allow EDR to scan
	time.Sleep(500 * time.Millisecond)

	// Check if file was quarantined
	if _, err := os.Stat(stagePath); os.IsNotExist(err) {
		LogFileDropped(stage.BinaryName, stagePath, int64(len(stage.BinaryData)), true)
		return fmt.Errorf("file quarantined after extraction")
	}

	return nil
}

// executeStage executes a stage binary and returns its exit code
func executeStage(stage KillchainStage) int {
	stagePath := filepath.Join("c:\\F0", stage.BinaryName)

	// Create command
	cmd := exec.Command(stagePath)

	// Capture stdout/stderr to both console and buffer
	var outputBuffer bytes.Buffer
	stdoutMulti := io.MultiWriter(os.Stdout, &outputBuffer)
	stderrMulti := io.MultiWriter(os.Stderr, &outputBuffer)
	cmd.Stdout = stdoutMulti
	cmd.Stderr = stderrMulti

	// Log process execution attempt
	LogMessage("INFO", fmt.Sprintf("Stage %d", stage.ID), fmt.Sprintf("Executing %s", stage.BinaryName))

	startTime := time.Now()

	// Run command
	err := cmd.Run()

	executionDuration := time.Since(startTime)

	// Save raw output to file
	outputFilePath := filepath.Join("c:\\F0", fmt.Sprintf("stage%d_output.txt", stage.ID))
	if writeErr := os.WriteFile(outputFilePath, outputBuffer.Bytes(), 0644); writeErr != nil {
		LogMessage("WARNING", "Output Capture", fmt.Sprintf("Failed to save raw output: %v", writeErr))
	} else {
		LogMessage("INFO", "Output Capture", fmt.Sprintf("Raw output saved to: %s (%d bytes)", outputFilePath, outputBuffer.Len()))
	}

	// Determine exit code
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode := exitErr.ExitCode()
			LogProcessExecution(stage.BinaryName, stagePath, cmd.Process.Pid, false, exitCode, exitErr.Error())
			LogMessage("INFO", fmt.Sprintf("Stage %d", stage.ID), fmt.Sprintf("Completed in %v with exit code %d", executionDuration, exitCode))
			return exitCode
		}
		// Unknown error - might be blocked before execution
		errMsg := fmt.Sprintf("Stage execution error for %s: %v", stage.BinaryName, err)
		fmt.Printf("[STAGE %d] Execution error: %v\n", stage.ID, err)
		LogMessage("ERROR", fmt.Sprintf("Stage %d", stage.ID), errMsg)
		LogProcessExecution(stage.BinaryName, stagePath, 0, false, 999, err.Error())
		return 999
	}

	// Success
	LogProcessExecution(stage.BinaryName, stagePath, cmd.Process.Pid, true, 0, "")
	LogMessage("INFO", fmt.Sprintf("Stage %d", stage.ID), fmt.Sprintf("Completed successfully in %v", executionDuration))
	return 0
}

// runCleanup executes the cleanup utility
func runCleanup() {
	Endpoint.Say("")
	Endpoint.Say("[*] Running cleanup utility...")

	cleanupPath := filepath.Join("c:\\F0", "cleanup_utility.exe")

	// Check if cleanup utility exists
	if _, err := os.Stat(cleanupPath); os.IsNotExist(err) {
		Endpoint.Say("    WARNING: Cleanup utility not found at %s", cleanupPath)
		LogMessage("WARNING", "Cleanup", "Cleanup utility not found")
		return
	}

	cmd := exec.Command(cleanupPath)

	// Capture output
	var outputBuffer bytes.Buffer
	cmd.Stdout = io.MultiWriter(os.Stdout, &outputBuffer)
	cmd.Stderr = io.MultiWriter(os.Stderr, &outputBuffer)

	err := cmd.Run()

	// Save cleanup output
	outputPath := filepath.Join("c:\\F0", "cleanup_output.txt")
	os.WriteFile(outputPath, outputBuffer.Bytes(), 0644)

	if err != nil {
		Endpoint.Say("    WARNING: Cleanup utility returned error: %v", err)
		LogMessage("WARNING", "Cleanup", fmt.Sprintf("Cleanup utility error: %v", err))
	} else {
		Endpoint.Say("    Cleanup completed successfully")
		LogMessage("INFO", "Cleanup", "Cleanup completed successfully")
	}
}
