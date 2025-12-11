//go:build windows
// +build windows

/*
ID: e5577355-f8e4-4e52-b1b2-f7d1c8b864f1
NAME: SilentButDeadly WFP EDR Network Isolation
TECHNIQUE: T1562.001
UNIT: response
CREATED: 2025-11-26
*/
package main

import (
	"bytes"
	_ "embed"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

const (
	TEST_UUID = "e5577355-f8e4-4e52-b1b2-f7d1c8b864f1"
	TEST_NAME = "SilentButDeadly WFP EDR Network Isolation"
	VERSION   = "1.0.0"
)

// Embed the pre-compiled SilentButDeadly binary
//go:embed sbd-f0rt1ka.exe
var silentButDeadlyBinary []byte

// test implements the main test logic
func test() {
	// Phase 1: Initialization
	LogPhaseStart(0, "Initialization")
	Endpoint.Say("[*] Phase 0: Test Initialization")

	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		LogMessage("ERROR", "Initialization", fmt.Sprintf("Dropper initialization failed: %v", err))
		LogPhaseEnd(0, "failed", "Dropper initialization failed")
		SaveLog(Endpoint.UnexpectedTestError, "Dropper initialization failed")
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	LogPhaseEnd(0, "success", "Dropper initialized successfully")
	Endpoint.Say("    [+] Dropper initialized")
	Endpoint.Say("")

	// Phase 2: Check prerequisites (Admin privileges)
	LogPhaseStart(1, "Prerequisites Check")
	Endpoint.Say("[*] Phase 1: Checking prerequisites...")

	if !isRunningAsAdmin() {
		LogMessage("ERROR", "Prerequisites", "Administrator privileges required for WFP operations")
		LogPhaseEnd(1, "failed", "Not running as administrator")
		SaveLog(Endpoint.UnexpectedTestError, "Administrator privileges required - run elevated")
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	Endpoint.Say("    [+] Running as Administrator")

	LogPhaseEnd(1, "success", "All prerequisites met")
	Endpoint.Say("")

	// Phase 3: Extract embedded binary
	LogPhaseStart(2, "Binary Extraction")
	Endpoint.Say("[*] Phase 2: Extracting SilentButDeadly binary...")

	targetDir := "c:\\F0"
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		LogMessage("ERROR", "Binary Extraction", fmt.Sprintf("Failed to create target directory: %v", err))
		LogPhaseEnd(2, "failed", "Failed to create target directory")
		SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Failed to create directory: %v", err))
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	binaryPath := filepath.Join(targetDir, "sbd-f0rt1ka.exe")
	if err := os.WriteFile(binaryPath, silentButDeadlyBinary, 0755); err != nil {
		LogMessage("ERROR", "Binary Extraction", fmt.Sprintf("Failed to write binary: %v", err))
		LogPhaseEnd(2, "failed", "Failed to write binary")
		SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Failed to write binary: %v", err))
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	LogFileDropped("sbd-f0rt1ka.exe", binaryPath, int64(len(silentButDeadlyBinary)), false)
	Endpoint.Say("    [+] Extracted: sbd-f0rt1ka.exe (%d bytes)", len(silentButDeadlyBinary))

	// Check for quarantine
	Endpoint.Say("    [*] Waiting for defensive reaction...")
	Endpoint.Wait(3)

	if Endpoint.Quarantined("sbd-f0rt1ka.exe", silentButDeadlyBinary) {
		LogFileDropped("sbd-f0rt1ka.exe", binaryPath, int64(len(silentButDeadlyBinary)), true)
		LogPhaseEnd(2, "blocked", "Binary was quarantined by AV/EDR")

		Endpoint.Say("")
		Endpoint.Say("=================================================================")
		Endpoint.Say("RESULT: PROTECTED")
		Endpoint.Say("=================================================================")
		Endpoint.Say("")
		Endpoint.Say("The SilentButDeadly binary was quarantined before execution.")
		Endpoint.Say("EDR/AV successfully detected and blocked the attack tool.")
		Endpoint.Say("")
		Endpoint.Say("Protection Type: File Quarantine on Extraction")
		Endpoint.Say("Exit Code: 105")
		Endpoint.Say("=================================================================")
		Endpoint.Say("")

		SaveLog(Endpoint.FileQuarantinedOnExtraction, "SilentButDeadly binary quarantined before execution")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}

	LogPhaseEnd(2, "success", "Binary extracted successfully")
	Endpoint.Say("    [+] Binary not quarantined - proceeding to execution")
	Endpoint.Say("")

	// Phase 4: Execute SilentButDeadly
	LogPhaseStart(3, "WFP EDR Network Isolation")
	Endpoint.Say("[*] Phase 3: Executing SilentButDeadly WFP isolation...")
	Endpoint.Say("")
	Endpoint.Say("    The tool will:")
	Endpoint.Say("    1. Enumerate EDR/AV processes")
	Endpoint.Say("    2. Initialize Windows Filtering Platform")
	Endpoint.Say("    3. Create high-priority blocking filters")
	Endpoint.Say("    4. Monitor isolation status (~30 seconds)")
	Endpoint.Say("    5. Cleanup filters on exit")
	Endpoint.Say("")
	Endpoint.Say("    --- SilentButDeadly Output ---")
	Endpoint.Say("")

	// Execute the binary and capture output to both console and file
	cmd := exec.Command(binaryPath)

	// Create buffer to capture output
	var outputBuffer bytes.Buffer

	// Use MultiWriter to write to both console and buffer
	stdoutMulti := io.MultiWriter(os.Stdout, &outputBuffer)
	stderrMulti := io.MultiWriter(os.Stderr, &outputBuffer)

	cmd.Stdout = stdoutMulti
	cmd.Stderr = stderrMulti

	startTime := time.Now()
	err := cmd.Run()
	executionDuration := time.Since(startTime)

	// Save raw output to file
	outputFilePath := filepath.Join(targetDir, "sbd-f0rt1ka_output.txt")
	if writeErr := os.WriteFile(outputFilePath, outputBuffer.Bytes(), 0644); writeErr != nil {
		LogMessage("WARNING", "Output Capture", fmt.Sprintf("Failed to save raw output: %v", writeErr))
	} else {
		LogMessage("INFO", "Output Capture", fmt.Sprintf("Raw output saved to: %s (%d bytes)", outputFilePath, outputBuffer.Len()))
		Endpoint.Say("    [+] Raw output saved to: %s", outputFilePath)
	}

	var exitCode int
	var executionSuccess bool

	if err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			exitCode = exitError.ExitCode()
			// Non-zero exit could mean blocked or error
			executionSuccess = false
		} else {
			// Command failed to start entirely
			LogMessage("ERROR", "WFP EDR Network Isolation", fmt.Sprintf("Failed to execute: %v", err))
			LogProcessExecution("sbd-f0rt1ka.exe", binaryPath, 0, false, -1, err.Error())
			LogPhaseEnd(3, "failed", fmt.Sprintf("Execution failed: %v", err))

			// Check if blocked at launch
			if strings.Contains(err.Error(), "Access is denied") ||
				strings.Contains(err.Error(), "Operation not permitted") {

				Endpoint.Say("")
				Endpoint.Say("=================================================================")
				Endpoint.Say("RESULT: PROTECTED")
				Endpoint.Say("=================================================================")
				Endpoint.Say("")
				Endpoint.Say("SilentButDeadly execution was prevented by security controls.")
				Endpoint.Say("Error: %v", err)
				Endpoint.Say("")
				Endpoint.Say("Protection Type: Execution Prevention")
				Endpoint.Say("Exit Code: 126")
				Endpoint.Say("=================================================================")
				Endpoint.Say("")

				SaveLog(Endpoint.ExecutionPrevented, fmt.Sprintf("Execution blocked: %v", err))
				Endpoint.Stop(Endpoint.ExecutionPrevented)
			}

			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Execution failed: %v", err))
			Endpoint.Stop(Endpoint.UnexpectedTestError)
		}
	} else {
		exitCode = 0
		executionSuccess = true
	}

	LogProcessExecution("sbd-f0rt1ka.exe", binaryPath, cmd.Process.Pid, executionSuccess, exitCode, "")

	Endpoint.Say("")
	Endpoint.Say("    --- End SilentButDeadly Output ---")
	Endpoint.Say("")
	Endpoint.Say("    Execution Duration: %.2f seconds", executionDuration.Seconds())
	Endpoint.Say("    Exit Code: %d", exitCode)
	Endpoint.Say("")

	// Evaluate results based on exit code and execution behavior
	// SilentButDeadly exits with 0 on success, non-zero on failure
	if executionSuccess && exitCode == 0 {
		// Tool ran successfully - EDR was isolated
		LogPhaseEnd(3, "success", "WFP filters applied successfully - EDR isolated")

		Endpoint.Say("=================================================================")
		Endpoint.Say("RESULT: UNPROTECTED")
		Endpoint.Say("=================================================================")
		Endpoint.Say("")
		Endpoint.Say("SilentButDeadly executed successfully!")
		Endpoint.Say("")
		Endpoint.Say("Attack Summary:")
		Endpoint.Say("  - EDR processes were enumerated")
		Endpoint.Say("  - WFP engine was initialized")
		Endpoint.Say("  - Network filters were applied")
		Endpoint.Say("  - EDR cloud connectivity was blocked")
		Endpoint.Say("  - Monitoring period completed (~30 seconds)")
		Endpoint.Say("  - Filters cleaned up on exit")
		Endpoint.Say("")
		Endpoint.Say("Impact:")
		Endpoint.Say("  - EDR/AV products were isolated from cloud")
		Endpoint.Say("  - No process termination alerts generated")
		Endpoint.Say("  - Technique is stealthier than killing processes")
		Endpoint.Say("")
		Endpoint.Say("Exit Code: 101 (Unprotected)")
		Endpoint.Say("=================================================================")
		Endpoint.Say("")

		SaveLog(Endpoint.Unprotected, "EDR network isolation successful - WFP filters blocked cloud connectivity")
		Endpoint.Stop(Endpoint.Unprotected)
	} else {
		// Tool failed or was blocked - check specific exit codes
		// Exit codes from SilentButDeadly:
		// - Non-zero typically means WFP initialization failed or was blocked
		LogPhaseEnd(3, "blocked", fmt.Sprintf("WFP operation blocked or failed (exit code: %d)", exitCode))

		Endpoint.Say("=================================================================")
		Endpoint.Say("RESULT: PROTECTED")
		Endpoint.Say("=================================================================")
		Endpoint.Say("")
		Endpoint.Say("SilentButDeadly execution was interrupted or blocked.")
		Endpoint.Say("Exit Code: %d", exitCode)
		Endpoint.Say("")
		Endpoint.Say("Possible protection mechanisms:")
		Endpoint.Say("  - WFP API calls blocked by EDR")
		Endpoint.Say("  - Filter creation prevented")
		Endpoint.Say("  - Behavioral detection triggered")
		Endpoint.Say("  - Memory protection mechanisms")
		Endpoint.Say("")
		Endpoint.Say("Protection Type: Execution Prevention/Behavioral Block")
		Endpoint.Say("Exit Code: 126")
		Endpoint.Say("=================================================================")
		Endpoint.Say("")

		SaveLog(Endpoint.ExecutionPrevented, fmt.Sprintf("WFP operation blocked (tool exit code: %d)", exitCode))
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}
}

// isRunningAsAdmin checks if the current process has administrator privileges
func isRunningAsAdmin() bool {
	cmd := exec.Command("net", "session")
	err := cmd.Run()
	return err == nil
}

func main() {
	Endpoint.Say("=================================================================")
	Endpoint.Say("F0RT1KA Security Test: %s", TEST_NAME)
	Endpoint.Say("Test UUID: %s", TEST_UUID)
	Endpoint.Say("Version: %s", VERSION)
	Endpoint.Say("=================================================================")
	Endpoint.Say("")

	// Initialize logger with Schema v2.0 metadata and execution context
	metadata := TestMetadata{
		Version:  VERSION,
		Category: "defense_evasion",
		Severity: "high",
		Techniques: []string{
			"T1562.001", // Impair Defenses: Disable or Modify Tools
		},
		Tactics: []string{"defense-evasion"},
		Score:   9.2,
		ScoreBreakdown: &ScoreBreakdown{
			RealWorldAccuracy:       2.8, // Uses actual WFP technique from real threat actors
			TechnicalSophistication: 2.8, // WFP API usage, multi-EDR targeting
			SafetyMechanisms:        2.0, // Non-persistent filters, auto-cleanup
			DetectionOpportunities:  0.6, // WFP events, service disruption signals
			LoggingObservability:    1.0, // Full test_logger implementation
		},
		Tags: []string{"wfp", "network-isolation", "edr-evasion", "silentbutdeadly"},
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
			TimeoutMs:         120000, // 2 minutes
			CertificateMode:   "pre-installed",
			MultiStageEnabled: false,
		},
	}

	// Initialize logger with v2.0 signature
	InitLogger(TEST_UUID, TEST_NAME, metadata, executionContext)

	Endpoint.Say("Organization: %s", orgInfo.ShortName)
	Endpoint.Say("Execution ID: %s", executionContext.ExecutionID)
	Endpoint.Say("")

	// Panic recovery
	defer func() {
		if r := recover(); r != nil {
			LogMessage("CRITICAL", "Runtime", fmt.Sprintf("Panic recovered: %v", r))
			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Test panic: %v", r))
			Endpoint.Stop(Endpoint.UnexpectedTestError)
		}
	}()

	// Run test with custom timeout runner
	done := make(chan bool, 1)
	go func() {
		test()
		done <- true
	}()

	// 2-minute timeout (tool runs for ~30 seconds internally)
	timeout := 2 * time.Minute
	select {
	case <-done:
		Endpoint.Say("Test completed")
	case <-time.After(timeout):
		Endpoint.Say("Test timed out after %v", timeout)
		LogMessage("ERROR", "Test Timeout", fmt.Sprintf("Test exceeded timeout of %v", timeout))
		SaveLog(Endpoint.TimeoutExceeded, fmt.Sprintf("Test exceeded timeout of %v", timeout))
		Endpoint.Stop(Endpoint.TimeoutExceeded)
	}
}
