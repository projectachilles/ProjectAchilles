//go:build windows
// +build windows

/*
ID: eafce2fc-75fd-4c62-92dc-32cabe5cf206
NAME: Tailscale Remote Access and Data Exfiltration
TECHNIQUE: T1105,T1219,T1543.003,T1021.004,T1041
UNIT: response
CREATED: 2025-01-15
*/

package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
	_ "embed"

	"github.com/google/uuid"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

const (
	TEST_UUID = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
	TEST_NAME = "Tailscale Remote Access and Data Exfiltration"

	// REPLACE THIS with your actual Tailscale auth key before building
	// Generate at: https://login.tailscale.com/admin/settings/keys
	TAILSCALE_AUTH_KEY = "tskey-auth-kgFeFJxf3D11CNTRL-h4Y78RzTMpUHWp6DpkBuoUtz6NpFiKT5C"
)

// Embed signed stage binaries (will be signed BEFORE embedding during build)
//go:embed eafce2fc-75fd-4c62-92dc-32cabe5cf206-T1105.exe
var stage1Binary []byte

//go:embed eafce2fc-75fd-4c62-92dc-32cabe5cf206-T1543.003.exe
var stage2Binary []byte

//go:embed eafce2fc-75fd-4c62-92dc-32cabe5cf206-T1219.exe
var stage3Binary []byte

//go:embed eafce2fc-75fd-4c62-92dc-32cabe5cf206-T1021.004.exe
var stage4Binary []byte

//go:embed eafce2fc-75fd-4c62-92dc-32cabe5cf206-T1041.exe
var stage5Binary []byte

// Embed cleanup utility
//go:embed cleanup_utility.exe
var cleanupBinary []byte

// KillchainStage definition for multi-stage execution
type KillchainStage struct {
	ID          int
	Name        string
	Technique   string
	BinaryName  string
	BinaryData  []byte
	Description string
}

var (
	downloadMode bool // Command-line flag for download vs embedded mode
)

func init() {
	flag.BoolVar(&downloadMode, "download", false, "Download Tailscale from official servers (default: use embedded)")
	flag.Parse()
}

func main() {
	Endpoint.Say("=================================================================")
	Endpoint.Say("F0RT1KA TEST: %s", TEST_NAME)
	Endpoint.Say("Test ID: %s", TEST_UUID)
	Endpoint.Say("=================================================================")
	Endpoint.Say("")
	Endpoint.Say("Starting test at: %s", time.Now().Format("2006-01-02T15:04:05"))
	Endpoint.Say("Multi-stage architecture for technique-level detection")
	Endpoint.Say("")

	// Display configuration
	Endpoint.Say("Configuration:")
	if downloadMode {
		Endpoint.Say("  - Binary Mode: Download from official servers")
	} else {
		Endpoint.Say("  - Binary Mode: Use embedded Tailscale binary")
	}
	Endpoint.Say("  - Auth Key: %s", maskAuthKey(TAILSCALE_AUTH_KEY))
	Endpoint.Say("")

	// Initialize shared logger with Schema v2.0 metadata and execution context
	metadata := TestMetadata{
		Version:    "1.0.0",
		Category:   "command_and_control",
		Severity:   "high",
		Techniques: []string{"T1105", "T1219", "T1543.003", "T1021.004", "T1041"},
		Tactics:    []string{"command-and-control", "exfiltration", "persistence", "lateral-movement"},
		Score:      8.5,
		ScoreBreakdown: &ScoreBreakdown{
			RealWorldAccuracy:       2.5,
			TechnicalSophistication: 3.0,
			SafetyMechanisms:        2.0,
			DetectionOpportunities:  0.5,
			LoggingObservability:    0.5,
		},
		Tags: []string{"multi-stage", "remote-access", "tailscale", "data-exfiltration"},
	}

	// Resolve organization from registry (UUID or short name)
	orgInfo := ResolveOrganization("")  // Empty string uses default from registry

	executionContext := ExecutionContext{
		ExecutionID:   uuid.New().String(),
		Organization:  orgInfo.UUID,
		Environment:   "lab",
		DeploymentType: "manual",
		Configuration: &ExecutionConfiguration{
			TimeoutMs:         300000,
			MultiStageEnabled: true,
		},
	}

	InitLogger(TEST_UUID, TEST_NAME, metadata, executionContext)

	defer func() {
		if r := recover(); r != nil {
			LogMessage("CRITICAL", "Runtime", fmt.Sprintf("Panic recovered: %v", r))
			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Panic: %v", r))
		}
	}()

	// Store configuration for stages
	configPath := filepath.Join("c:\\F0", "test_config.txt")
	os.MkdirAll("c:\\F0", 0755)
	configContent := fmt.Sprintf("DOWNLOAD_MODE=%v\nAUTH_KEY=%s\n", downloadMode, TAILSCALE_AUTH_KEY)
	os.WriteFile(configPath, []byte(configContent), 0644)

	// Define killchain
	killchain := []KillchainStage{
		{
			ID:          1,
			Name:        "Ingress Tool Transfer",
			Technique:   "T1105",
			BinaryName:  fmt.Sprintf("%s-T1105.exe", TEST_UUID),
			BinaryData:  stage1Binary,
			Description: "Download Tailscale portable binary from official servers",
		},
		{
			ID:          2,
			Name:        "Windows Service Installation",
			Technique:   "T1543.003",
			BinaryName:  fmt.Sprintf("%s-T1543.003.exe", TEST_UUID),
			BinaryData:  stage2Binary,
			Description: "Install OpenSSH Server for remote access",
		},
		{
			ID:          3,
			Name:        "Remote Access Software",
			Technique:   "T1219",
			BinaryName:  fmt.Sprintf("%s-T1219.exe", TEST_UUID),
			BinaryData:  stage3Binary,
			Description: "Connect Tailscale to tailnet infrastructure",
		},
		{
			ID:          4,
			Name:        "SSH Remote Access",
			Technique:   "T1021.004",
			BinaryName:  fmt.Sprintf("%s-T1021.004.exe", TEST_UUID),
			BinaryData:  stage4Binary,
			Description: "Establish SSH access through Tailscale tunnel",
		},
		{
			ID:          5,
			Name:        "Data Exfiltration",
			Technique:   "T1041",
			BinaryName:  fmt.Sprintf("%s-T1041.exe", TEST_UUID),
			BinaryData:  stage5Binary,
			Description: "Exfiltrate sensitive data over C2 channel",
		},
	}

	// Extract all stage binaries
	LogPhaseStart(0, "Stage Binary Extraction")
	Endpoint.Say("Phase 0: Extracting %d stage binaries...", len(killchain))

	for _, stage := range killchain {
		if err := extractStage(stage); err != nil {
			LogPhaseEnd(0, "error", fmt.Sprintf("Failed to extract %s", stage.BinaryName))
			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Extraction failed: %v", err))

			// Wait before exit to ensure monitoring platforms can read exit code
			Endpoint.Say("")
			Endpoint.Say("Finalizing test results (waiting 5 seconds for platform sync)...")
			time.Sleep(5 * time.Second)

			Endpoint.Stop(Endpoint.UnexpectedTestError)
		}
		Endpoint.Say("  [+] Extracted: %s (%d bytes)", stage.BinaryName, len(stage.BinaryData))
	}

	// Extract cleanup utility
	cleanupPath := filepath.Join("c:\\F0", "tailscale_cleanup.exe")
	if err := os.WriteFile(cleanupPath, cleanupBinary, 0755); err != nil {
		LogMessage("ERROR", "Extraction", fmt.Sprintf("Failed to extract cleanup utility: %v", err))
	} else {
		Endpoint.Say("  [+] Extracted: tailscale_cleanup.exe (cleanup utility)")
		LogFileDropped("tailscale_cleanup.exe", cleanupPath, int64(len(cleanupBinary)), false)
	}

	LogPhaseEnd(0, "success", fmt.Sprintf("Extracted %d stage binaries", len(killchain)))
	Endpoint.Say("")

	// Execute killchain in sequential order
	for _, stage := range killchain {
		LogStageStart(stage.ID, stage.Technique, fmt.Sprintf("%s (%s)", stage.Name, stage.Technique))

		Endpoint.Say("=================================================================")
		Endpoint.Say("STAGE %d: %s", stage.ID, stage.Name)
		Endpoint.Say("Technique: %s", stage.Technique)
		Endpoint.Say("Description: %s", stage.Description)
		Endpoint.Say("=================================================================")

		exitCode := executeStage(stage)

		if exitCode == 126 || exitCode == 105 {
			// Stage blocked by EDR
			LogStageEnd(stage.ID, stage.Technique, "blocked", fmt.Sprintf("EDR blocked %s", stage.Technique))

			Endpoint.Say("")
			Endpoint.Say("=================================================================")
			Endpoint.Say("RESULT: PROTECTED")
			Endpoint.Say("=================================================================")
			Endpoint.Say("EDR successfully blocked technique %s at stage %d", stage.Technique, stage.ID)
			Endpoint.Say("Attack chain interrupted - system is protected")
			Endpoint.Say("")
			Endpoint.Say("Cleanup: Run 'C:\\F0\\tailscale_cleanup.exe' to remove test artifacts")
			Endpoint.Say("=================================================================")

			SaveLog(Endpoint.ExecutionPrevented, fmt.Sprintf("EDR blocked at %s", stage.Technique))

			// Wait before exit to ensure monitoring platforms can read exit code
			Endpoint.Say("")
			Endpoint.Say("Finalizing test results (waiting 5 seconds for platform sync)...")
			time.Sleep(5 * time.Second)

			Endpoint.Stop(Endpoint.ExecutionPrevented)

		} else if exitCode != 0 {
			// Stage error
			LogStageEnd(stage.ID, stage.Technique, "error", fmt.Sprintf("Stage error: exit code %d", exitCode))
			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Stage %s failed with code %d", stage.Technique, exitCode))

			Endpoint.Say("")
			Endpoint.Say("Stage %d failed with error code %d", stage.ID, exitCode)
			Endpoint.Say("Cleanup: Run 'C:\\F0\\tailscale_cleanup.exe' if needed")

			// Wait before exit to ensure monitoring platforms can read exit code
			Endpoint.Say("")
			Endpoint.Say("Finalizing test results (waiting 5 seconds for platform sync)...")
			time.Sleep(5 * time.Second)

			Endpoint.Stop(Endpoint.UnexpectedTestError)
		}

		LogStageEnd(stage.ID, stage.Technique, "success", fmt.Sprintf("%s completed successfully", stage.Technique))
		Endpoint.Say("  Stage %d completed successfully", stage.ID)
		Endpoint.Say("")
	}

	// All stages succeeded = vulnerable
	Endpoint.Say("")
	Endpoint.Say("=================================================================")
	Endpoint.Say("RESULT: VULNERABLE")
	Endpoint.Say("=================================================================")
	Endpoint.Say("CRITICAL: Complete attack chain succeeded without prevention")
	Endpoint.Say("")
	Endpoint.Say("All %d techniques executed successfully:", len(killchain))
	for _, stage := range killchain {
		Endpoint.Say("  - %s: %s", stage.Technique, stage.Name)
	}
	Endpoint.Say("")
	Endpoint.Say("The system allowed:")
	Endpoint.Say("  1. Download of remote access tool")
	Endpoint.Say("  2. Installation of SSH service")
	Endpoint.Say("  3. Connection to external infrastructure")
	Endpoint.Say("  4. Remote shell access establishment")
	Endpoint.Say("  5. Data exfiltration over C2 channel")
	Endpoint.Say("")
	Endpoint.Say("IMMEDIATE ACTION REQUIRED:")
	Endpoint.Say("  - Review EDR/AV configuration")
	Endpoint.Say("  - Enable application control policies")
	Endpoint.Say("  - Implement network segmentation")
	Endpoint.Say("  - Run cleanup: C:\\F0\\tailscale_cleanup.exe")
	Endpoint.Say("=================================================================")

	SaveLog(Endpoint.Unprotected, "Complete killchain succeeded - all techniques executed")

	// Wait before exit to ensure monitoring platforms can read exit code
	Endpoint.Say("")
	Endpoint.Say("Finalizing test results (waiting 5 seconds for platform sync)...")
	time.Sleep(5 * time.Second)

	Endpoint.Stop(Endpoint.Unprotected)
}

func extractStage(stage KillchainStage) error {
	targetDir := "c:\\F0"
	os.MkdirAll(targetDir, 0755)

	stagePath := filepath.Join(targetDir, stage.BinaryName)
	if err := os.WriteFile(stagePath, stage.BinaryData, 0755); err != nil {
		return fmt.Errorf("failed to write %s: %v", stage.BinaryName, err)
	}

	LogFileDropped(stage.BinaryName, stagePath, int64(len(stage.BinaryData)), false)
	return nil
}

func executeStage(stage KillchainStage) int {
	stagePath := filepath.Join("c:\\F0", stage.BinaryName)

	// Set timeout based on stage complexity
	// Stage 2 (OpenSSH): 15 minutes (Add-WindowsCapability can be very slow)
	// Stage 3 (Tailscale MSI): 10 minutes (MSI installation + connection)
	// Other stages: 5 minutes
	var timeout time.Duration
	switch stage.ID {
	case 2:
		timeout = 15 * time.Minute // OpenSSH installation
	case 3:
		timeout = 10 * time.Minute // Tailscale MSI
	default:
		timeout = 5 * time.Minute // Standard stages
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// Create command with context
	cmd := exec.CommandContext(ctx, stagePath)

	// Set working directory
	cmd.Dir = "c:\\F0"

	// Stream output directly to parent's stdout/stderr
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// Start the stage process
	if err := cmd.Start(); err != nil {
		errMsg := fmt.Sprintf("Failed to start stage %s: %v", stage.Technique, err)
		Endpoint.Say("  Failed to start stage: %v", err)
		LogMessage("ERROR", stage.Technique, errMsg)
		return 999
	}

	// Heartbeat goroutine - outputs progress every 10 seconds to keep parent "alive"
	done := make(chan bool)
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()

		startTime := time.Now()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				elapsed := int(time.Since(startTime).Seconds())
				Endpoint.Say("  [Progress] Stage executing... (%d seconds elapsed)", elapsed)
			}
		}
	}()

	// Wait for stage to complete
	err := cmd.Wait()
	close(done) // Stop heartbeat goroutine

	// Check for timeout
	if ctx.Err() == context.DeadlineExceeded {
		timeoutMin := int(timeout.Minutes())
		Endpoint.Say("  Stage execution timeout (%d minutes exceeded)", timeoutMin)
		LogMessage("ERROR", "Stage Execution", fmt.Sprintf("Stage %d (%s) timeout after %d minutes", stage.ID, stage.Technique, timeoutMin))
		return 999 // Timeout error
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return exitErr.ExitCode()
		}
		errMsg := fmt.Sprintf("Stage execution error for %s: %v", stage.Technique, err)
		Endpoint.Say("  Stage execution error: %v", err)
		LogMessage("ERROR", stage.Technique, errMsg)
		return 999 // Unknown error
	}

	return 0 // Success
}

func maskAuthKey(key string) string {
	if len(key) < 20 {
		return key
	}
	return key[:10] + "..." + key[len(key)-4:]
}
