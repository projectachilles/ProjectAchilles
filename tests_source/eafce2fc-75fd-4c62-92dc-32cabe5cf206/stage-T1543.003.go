//go:build windows
// +build windows

/*
STAGE 2: Windows Service Installation (T1543.003)
Installs OpenSSH Server for remote access
*/

package main

import (
	_ "embed"
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
	TECHNIQUE_ID   = "T1543.003"
	TECHNIQUE_NAME = "Windows Service Installation"
	STAGE_ID       = 2
)

// Embed OpenSSH portable zip package
//go:embed OpenSSH-Win64.zip
var opensshZip []byte

// Standardized stage exit codes
const (
	StageSuccess     = 0
	StageBlocked     = 126
	StageQuarantined = 105
	StageError       = 999
)

const (
	OPENSSH_STATE_FILE   = "c:\\F0\\original_openssh_state.json"
	OPENSSH_INSTALL_PATH = "C:\\Program Files\\OpenSSH"
	OPENSSH_ZIP_DROP     = "c:\\F0\\OpenSSH-Win64.zip"
)

// OpenSSHState represents the original state of OpenSSH before test modifications
type OpenSSHState struct {
	WasInstalled      bool   `json:"was_installed"`
	ServiceStartup    string `json:"service_startup"`    // "disabled", "manual", "auto"
	ServiceRunning    bool   `json:"service_running"`
	FirewallRuleExist bool   `json:"firewall_rule_exist"`
}

func main() {
	// Attach to shared log
	AttachLogger(TEST_UUID, fmt.Sprintf("Stage %d: %s", STAGE_ID, TECHNIQUE_ID))

	LogMessage("INFO", TECHNIQUE_ID, "Starting Windows Service Installation")
	LogStageStart(STAGE_ID, TECHNIQUE_ID, "Install OpenSSH Server capability")

	// Check if running with admin privileges
	if !isAdmin() {
		fmt.Printf("[STAGE T1543.003] Administrator privileges required\n")
		LogMessage("ERROR", TECHNIQUE_ID, "Administrator privileges required")
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", "Not running as administrator")
		os.Exit(StageError)
	}

	// Capture original OpenSSH state for cleanup restoration
	if err := captureOpenSSHState(); err != nil {
		LogMessage("WARNING", TECHNIQUE_ID, fmt.Sprintf("Failed to capture OpenSSH state: %v", err))
		// Continue anyway - cleanup will still work, just won't restore original state
	}

	// Attempt to install OpenSSH Server
	if err := installOpenSSH(); err != nil {
		// Check if installation was blocked
		if strings.Contains(err.Error(), "access denied") ||
			strings.Contains(err.Error(), "blocked") ||
			strings.Contains(err.Error(), "restricted") {

			fmt.Printf("[STAGE T1543.003] Installation blocked: %v\n", err)
			LogMessage("BLOCKED", TECHNIQUE_ID, fmt.Sprintf("Installation blocked: %v", err))
			LogStageBlocked(STAGE_ID, TECHNIQUE_ID, err.Error())
			os.Exit(StageBlocked)
		}

		fmt.Printf("[STAGE T1543.003] Installation failed: %v\n", err)
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Installation failed: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", err.Error())
		os.Exit(StageError)
	}

	// Configure OpenSSH for remote access
	if err := configureOpenSSH(); err != nil {
		fmt.Printf("[STAGE T1543.003] Configuration failed: %v\n", err)
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Configuration failed: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", err.Error())
		os.Exit(StageError)
	}

	// Start service
	if err := startOpenSSH(); err != nil {
		if strings.Contains(err.Error(), "access denied") ||
			strings.Contains(err.Error(), "blocked") {

			fmt.Printf("[STAGE T1543.003] Service start blocked: %v\n", err)
			LogMessage("BLOCKED", TECHNIQUE_ID, fmt.Sprintf("Service start blocked: %v", err))
			LogStageBlocked(STAGE_ID, TECHNIQUE_ID, err.Error())
			os.Exit(StageBlocked)
		}

		fmt.Printf("[STAGE T1543.003] Service start failed: %v\n", err)
		LogMessage("ERROR", TECHNIQUE_ID, fmt.Sprintf("Service start failed: %v", err))
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", err.Error())
		os.Exit(StageError)
	}

	// Verify service is running
	if !isServiceRunning("sshd") {
		fmt.Printf("[STAGE T1543.003] OpenSSH service not running after start attempt\n")
		LogMessage("ERROR", TECHNIQUE_ID, "OpenSSH service not running after start attempt")
		LogStageEnd(STAGE_ID, TECHNIQUE_ID, "error", "Service verification failed")
		os.Exit(StageError)
	}

	LogMessage("SUCCESS", TECHNIQUE_ID, "OpenSSH Server installed and running")
	LogStageEnd(STAGE_ID, TECHNIQUE_ID, "success", "OpenSSH Server successfully configured")
	os.Exit(StageSuccess)
}

func installOpenSSH() error {
	LogMessage("INFO", TECHNIQUE_ID, "Installing OpenSSH Server from embedded package...")

	// Check if already installed
	if _, err := os.Stat(OPENSSH_INSTALL_PATH); err == nil {
		LogMessage("INFO", TECHNIQUE_ID, "OpenSSH Server already installed at "+OPENSSH_INSTALL_PATH)
		return nil
	}

	// Step 1: Drop embedded zip to C:\F0\
	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("Dropping OpenSSH zip (%d bytes) to %s", len(opensshZip), OPENSSH_ZIP_DROP))
	if err := os.WriteFile(OPENSSH_ZIP_DROP, opensshZip, 0644); err != nil {
		return fmt.Errorf("failed to drop OpenSSH zip: %v", err)
	}

	// Check if zip was quarantined
	if _, err := os.Stat(OPENSSH_ZIP_DROP); os.IsNotExist(err) {
		return fmt.Errorf("OpenSSH zip was quarantined after drop")
	}

	// Step 2: Extract zip to C:\Program Files\
	LogMessage("INFO", TECHNIQUE_ID, "Extracting OpenSSH to C:\\Program Files\\...")
	cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
		fmt.Sprintf(`Expand-Archive -Path "%s" -DestinationPath "C:\Program Files\" -Force`, OPENSSH_ZIP_DROP))

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("extraction failed: %v - %s", err, string(output))
	}

	// Step 3: Rename OpenSSH-Win64 to OpenSSH
	LogMessage("INFO", TECHNIQUE_ID, "Renaming OpenSSH-Win64 to OpenSSH...")
	extractedPath := "C:\\Program Files\\OpenSSH-Win64"

	// Remove target if it exists
	if _, err := os.Stat(OPENSSH_INSTALL_PATH); err == nil {
		os.RemoveAll(OPENSSH_INSTALL_PATH)
	}

	cmd = exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
		fmt.Sprintf(`Rename-Item -Path "%s" -NewName "OpenSSH"`, extractedPath))

	output, err = cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("rename failed: %v - %s", err, string(output))
	}

	// Verify installation directory exists
	if _, err := os.Stat(OPENSSH_INSTALL_PATH); os.IsNotExist(err) {
		return fmt.Errorf("OpenSSH installation directory not found after extraction")
	}

	// Step 4: Run install-sshd.ps1 script
	LogMessage("INFO", TECHNIQUE_ID, "Running install-sshd.ps1 script...")
	installScript := filepath.Join(OPENSSH_INSTALL_PATH, "install-sshd.ps1")

	if _, err := os.Stat(installScript); os.IsNotExist(err) {
		return fmt.Errorf("install-sshd.ps1 not found at %s", installScript)
	}

	cmd = exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-File", installScript)
	cmd.Dir = OPENSSH_INSTALL_PATH

	output, err = cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("install script failed: %v - %s", err, string(output))
	}

	LogMessage("INFO", TECHNIQUE_ID, "OpenSSH installation script output: "+string(output))

	// Wait for installation to complete
	time.Sleep(3 * time.Second)

	LogMessage("INFO", TECHNIQUE_ID, "OpenSSH Server installed successfully")
	return nil
}

func configureOpenSSH() error {
	LogMessage("INFO", TECHNIQUE_ID, "Configuring OpenSSH Server for remote access...")

	// Set service to automatic startup
	cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
		"Set-Service -Name sshd -StartupType 'Automatic'")

	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("service configuration failed: %v - %s", err, string(output))
	}

	// Configure firewall rule
	LogMessage("INFO", TECHNIQUE_ID, "Configuring firewall rules...")
	cmd = exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
		`New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction SilentlyContinue`)

	cmd.Run() // Ignore error if rule already exists

	LogMessage("INFO", TECHNIQUE_ID, "OpenSSH Server configured")
	return nil
}

func startOpenSSH() error {
	LogMessage("INFO", TECHNIQUE_ID, "Starting OpenSSH Server service...")

	cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
		"Start-Service sshd")

	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("service start failed: %v - %s", err, string(output))
	}

	// Wait for service to initialize
	time.Sleep(3 * time.Second)

	LogMessage("INFO", TECHNIQUE_ID, "OpenSSH Server started")
	return nil
}

func captureOpenSSHState() error {
	LogMessage("INFO", TECHNIQUE_ID, "Capturing original OpenSSH state for restoration...")

	state := OpenSSHState{
		WasInstalled:      isOpenSSHInstalled(),
		ServiceStartup:    getSSHDStartupType(),
		ServiceRunning:    isServiceRunning("sshd"),
		FirewallRuleExist: firewallRuleExists("sshd"),
	}

	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("OpenSSH state: Installed=%v, Startup=%s, Running=%v, Firewall=%v",
		state.WasInstalled, state.ServiceStartup, state.ServiceRunning, state.FirewallRuleExist))

	// Save state to JSON file
	jsonData, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal OpenSSH state: %v", err)
	}

	if err := os.WriteFile(OPENSSH_STATE_FILE, jsonData, 0644); err != nil {
		return fmt.Errorf("failed to write OpenSSH state file: %v", err)
	}

	LogMessage("INFO", TECHNIQUE_ID, fmt.Sprintf("OpenSSH state saved to %s", OPENSSH_STATE_FILE))
	return nil
}

func isOpenSSHInstalled() bool {
	// Check if OpenSSH is installed at the manual installation path
	if _, err := os.Stat(OPENSSH_INSTALL_PATH); err == nil {
		return true
	}

	// Also check if installed via Windows Capability (legacy/pre-existing installation)
	cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
		"Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'")

	output, err := cmd.CombinedOutput()
	if err != nil {
		return false
	}

	return strings.Contains(string(output), "State : Installed")
}

func getSSHDStartupType() string {
	cmd := exec.Command("sc", "qc", "sshd")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "not_installed"
	}

	outputStr := string(output)
	if strings.Contains(outputStr, "DISABLED") {
		return "disabled"
	} else if strings.Contains(outputStr, "DEMAND_START") {
		return "manual"
	} else if strings.Contains(outputStr, "AUTO_START") {
		return "auto"
	}

	return "unknown"
}

func firewallRuleExists(ruleName string) bool {
	cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
		fmt.Sprintf("Get-NetFirewallRule -Name '%s' -ErrorAction SilentlyContinue", ruleName))

	output, err := cmd.CombinedOutput()
	if err != nil {
		return false
	}

	// If rule exists, output will contain rule details
	return len(strings.TrimSpace(string(output))) > 0
}

func isServiceRunning(serviceName string) bool {
	cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
		fmt.Sprintf("(Get-Service -Name %s).Status", serviceName))

	output, err := cmd.Output()
	if err != nil {
		return false
	}

	return strings.TrimSpace(string(output)) == "Running"
}

// isAdmin function is defined in test_logger.go