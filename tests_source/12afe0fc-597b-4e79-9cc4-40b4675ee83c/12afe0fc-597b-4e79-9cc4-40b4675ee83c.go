// LimaCharlie Timeout Validation Harness
// F0RT1KA Security Testing Framework
//
// This is a utility test to validate that LimaCharlie's --timeout parameter
// works correctly for long-running tests. It runs 3 stages, each waiting
// 2 minutes (total ~6 minutes), and exits with code 101.
//
// USAGE:
// - Build with: ./build_all.sh
// - Deploy to endpoint
// - Run with: limacharlie sensors task <sid> "run --payload-name <payload> --timeout 420"
// - Expected: RECEIPT event with exit code 101 (not 259)

//go:build windows

package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"
	_ "embed"

	"github.com/google/uuid"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

// ==============================================================================
// CONFIGURATION
// ==============================================================================

const (
	TEST_UUID = "12afe0fc-597b-4e79-9cc4-40b4675ee83c"
	TEST_NAME = "LimaCharlie Timeout Validation Harness"
)

// Embed signed stage binaries (MUST be signed before embedding!)
// Each stage waits 2 minutes and exits with code 101

//go:embed stage-T1497.001-1.exe
var stage1Binary []byte

//go:embed stage-T1497.001-2.exe
var stage2Binary []byte

//go:embed stage-T1497.001-3.exe
var stage3Binary []byte

// ==============================================================================
// STAGE DEFINITION
// ==============================================================================

// KillchainStage represents one timing stage in the validation test
type KillchainStage struct {
	ID          int
	Name        string
	Technique   string
	BinaryName  string
	BinaryData  []byte
	Description string
	WaitSeconds int
}

// ==============================================================================
// MAIN FUNCTION
// ==============================================================================

func main() {
	// Initialize logger with Schema v2.0 metadata and execution context
	metadata := TestMetadata{
		Version:    "1.0.0",
		Category:   "execution",
		Severity:   "informational",
		Techniques: []string{"T1497.001"},
		Tactics:    []string{"defense-evasion"},
		Score:      5.0,
		ScoreBreakdown: &ScoreBreakdown{
			RealWorldAccuracy:       1.0,
			TechnicalSophistication: 1.0,
			SafetyMechanisms:        1.5,
			DetectionOpportunities:  0.5,
			LoggingObservability:    1.0,
		},
		Tags: []string{"timeout-validation", "utility", "mock-test"},
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
			TimeoutMs:         420000, // 7 minutes (expected LC timeout)
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
	Endpoint.Say("F0RT1KA Utility Test: %s", TEST_NAME)
	Endpoint.Say("Test UUID: %s", TEST_UUID)
	Endpoint.Say("=================================================================")
	Endpoint.Say("")
	Endpoint.Say("PURPOSE: Validate LimaCharlie --timeout parameter functionality")
	Endpoint.Say("")
	Endpoint.Say("This test runs 3 stages, each waiting 2 minutes (~6 min total).")
	Endpoint.Say("If --timeout is working correctly, RECEIPT will show exit code 101.")
	Endpoint.Say("If timeout fails, RECEIPT will show exit code 259 (STILL_ACTIVE).")
	Endpoint.Say("")

	// Run the test
	test()
}

// ==============================================================================
// TEST IMPLEMENTATION
// ==============================================================================

func test() {
	testStartTime := time.Now()

	// Define timing validation stages
	killchain := []KillchainStage{
		{
			ID:          1,
			Name:        "Timeout Stage 1",
			Technique:   "T1497.001",
			BinaryName:  "stage-T1497.001-1.exe",
			BinaryData:  stage1Binary,
			Description: "Wait 2 minutes (first timing stage)",
			WaitSeconds: 120,
		},
		{
			ID:          2,
			Name:        "Timeout Stage 2",
			Technique:   "T1497.001",
			BinaryName:  "stage-T1497.001-2.exe",
			BinaryData:  stage2Binary,
			Description: "Wait 2 minutes (second timing stage)",
			WaitSeconds: 120,
		},
		{
			ID:          3,
			Name:        "Timeout Stage 3",
			Technique:   "T1497.001",
			BinaryName:  "stage-T1497.001-3.exe",
			BinaryData:  stage3Binary,
			Description: "Wait 2 minutes (third timing stage)",
			WaitSeconds: 120,
		},
	}

	// Phase 0: Extract all stage binaries
	LogPhaseStart(0, "Stage Binary Extraction")
	Endpoint.Say("[*] Phase 0: Extracting %d stage binaries...", len(killchain))

	for i, stage := range killchain {
		Endpoint.Say("    [%d/%d] Extracting %s", i+1, len(killchain), stage.BinaryName)

		if err := extractStage(stage); err != nil {
			LogPhaseEnd(0, "error", fmt.Sprintf("Failed to extract %s: %v", stage.BinaryName, err))
			Endpoint.Say("")
			Endpoint.Say("FATAL: Failed to extract stage binary: %s", stage.BinaryName)
			Endpoint.Say("    Error: %v", err)
			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Stage extraction failed: %v", err))
			Endpoint.Stop(Endpoint.UnexpectedTestError)
		}
	}

	LogPhaseEnd(0, "success", fmt.Sprintf("Successfully extracted %d stage binaries", len(killchain)))
	Endpoint.Say("    All stage binaries extracted successfully")
	Endpoint.Say("")

	// Execute timing stages sequentially
	totalExpectedTime := 0
	for _, s := range killchain {
		totalExpectedTime += s.WaitSeconds
	}

	Endpoint.Say("[*] Executing %d timing stages (~%d minutes total)...", len(killchain), totalExpectedTime/60)
	Endpoint.Say("")

	for _, stage := range killchain {
		// Log phase start
		LogPhaseStart(stage.ID, fmt.Sprintf("%s (%s)", stage.Name, stage.Technique))

		Endpoint.Say("=================================================================")
		Endpoint.Say("Stage %d/%d: %s", stage.ID, len(killchain), stage.Name)
		Endpoint.Say("Description: %s", stage.Description)
		Endpoint.Say("Expected Duration: %d seconds", stage.WaitSeconds)
		Endpoint.Say("=================================================================")
		Endpoint.Say("")

		stageStartTime := time.Now()

		// Execute stage binary
		exitCode, output := executeStage(stage)

		stageDuration := time.Since(stageStartTime)

		Endpoint.Say("")
		Endpoint.Say("Stage %d output:", stage.ID)
		Endpoint.Say("%s", output)
		Endpoint.Say("")
		Endpoint.Say("Stage %d completed in %v with exit code %d", stage.ID, stageDuration.Round(time.Second), exitCode)

		// For this validation test, we expect all stages to exit with 101
		if exitCode != 101 {
			LogPhaseEnd(stage.ID, "error", fmt.Sprintf("Unexpected exit code: %d (expected 101)", exitCode))
			Endpoint.Say("")
			Endpoint.Say("ERROR: Stage %d returned unexpected exit code: %d", stage.ID, exitCode)
			Endpoint.Say("Expected exit code: 101")
			Endpoint.Say("")
			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Stage %d unexpected exit code: %d", stage.ID, exitCode))
			Endpoint.Stop(Endpoint.UnexpectedTestError)
		}

		LogPhaseEnd(stage.ID, "success", fmt.Sprintf("Stage completed in %v with exit code 101", stageDuration.Round(time.Second)))
		Endpoint.Say("    Stage %d completed successfully", stage.ID)
		Endpoint.Say("")
	}

	// All stages completed - test successful
	totalDuration := time.Since(testStartTime)

	Endpoint.Say("")
	Endpoint.Say("=================================================================")
	Endpoint.Say("TIMEOUT VALIDATION COMPLETE")
	Endpoint.Say("=================================================================")
	Endpoint.Say("")
	Endpoint.Say("Total Stages: %d", len(killchain))
	Endpoint.Say("Total Duration: %v", totalDuration.Round(time.Second))
	Endpoint.Say("All Stages Exit Code: 101")
	Endpoint.Say("")
	Endpoint.Say("If you see this message in the RECEIPT event with exit code 101,")
	Endpoint.Say("then LimaCharlie's --timeout parameter is working correctly!")
	Endpoint.Say("")
	Endpoint.Say("If RECEIPT shows exit code 259 (STILL_ACTIVE), the timeout is")
	Endpoint.Say("still too short or there's a hard cap we need to work around.")
	Endpoint.Say("")
	Endpoint.Say("=================================================================")
	Endpoint.Say("Exiting with code 101 (Endpoint.Unprotected)")
	Endpoint.Say("=================================================================")
	Endpoint.Say("")

	SaveLog(Endpoint.Unprotected, fmt.Sprintf("Timeout validation complete - %d stages executed in %v", len(killchain), totalDuration.Round(time.Second)))
	Endpoint.Stop(Endpoint.Unprotected)
}

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

// extractStage extracts a stage binary to C:\F0
func extractStage(stage KillchainStage) error {
	targetDir := "c:\\F0"

	// Ensure target directory exists
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %v", targetDir, err)
	}

	// Write stage binary to disk
	stagePath := filepath.Join(targetDir, stage.BinaryName)
	if err := os.WriteFile(stagePath, stage.BinaryData, 0755); err != nil {
		return fmt.Errorf("failed to write %s: %v", stage.BinaryName, err)
	}

	// Log file drop
	LogFileDropped(stage.BinaryName, stagePath, int64(len(stage.BinaryData)), false)

	return nil
}

// executeStage executes a stage binary and returns its exit code and output
func executeStage(stage KillchainStage) (int, string) {
	stagePath := filepath.Join("c:\\F0", stage.BinaryName)

	// Create command
	cmd := exec.Command(stagePath)

	// Capture output
	var outputBuffer bytes.Buffer
	stdoutMulti := io.MultiWriter(os.Stdout, &outputBuffer)
	stderrMulti := io.MultiWriter(os.Stderr, &outputBuffer)
	cmd.Stdout = stdoutMulti
	cmd.Stderr = stderrMulti

	// Log process execution attempt
	LogMessage("INFO", fmt.Sprintf("Stage %d", stage.ID), fmt.Sprintf("Executing %s", stage.BinaryName))

	// Run command
	err := cmd.Run()

	output := outputBuffer.String()

	// Determine exit code
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode := exitErr.ExitCode()
			LogProcessExecution(stage.BinaryName, stagePath, 0, false, exitCode, "")
			return exitCode, output
		}
		// Unknown error
		LogProcessExecution(stage.BinaryName, stagePath, 0, false, 999, err.Error())
		return 999, output
	}

	// Success (exit code 0)
	LogProcessExecution(stage.BinaryName, stagePath, 0, true, 0, "")
	return 0, output
}
