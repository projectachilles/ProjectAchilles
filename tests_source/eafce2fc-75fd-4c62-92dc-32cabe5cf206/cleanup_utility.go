//go:build windows
// +build windows

/*
Tailscale Security Test Cleanup Utility
Removes all test artifacts including:
- Tailscale portable installation
- OpenSSH Server
- Test files and directories
- Firewall rules
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
	SERVICE_STATE_FILE = "c:\\F0\\original_service_state.json"
	OPENSSH_STATE_FILE = "c:\\F0\\original_openssh_state.json"
)

// ServiceState represents the original state of a Windows service
type ServiceState struct {
	Name        string `json:"name"`
	StartupType string `json:"startup_type"` // "disabled", "manual", "auto", "auto_delayed"
	IsRunning   bool   `json:"is_running"`
}

// OpenSSHState represents the original state of OpenSSH before test modifications
type OpenSSHState struct {
	WasInstalled      bool   `json:"was_installed"`
	ServiceStartup    string `json:"service_startup"`    // "disabled", "manual", "auto"
	ServiceRunning    bool   `json:"service_running"`
	FirewallRuleExist bool   `json:"firewall_rule_exist"`
}

func main() {
	fmt.Println("=================================================================")
	fmt.Println("Tailscale Security Test - Cleanup Utility")
	fmt.Println("=================================================================")
	fmt.Println()

	if !checkIsAdmin() {
		fmt.Println("ERROR: Administrator privileges required")
		fmt.Println("Please run this utility as Administrator")
		os.Exit(1)
	}

	fmt.Println("This utility will remove:")
	fmt.Println("  1. Tailscale MSI installation")
	fmt.Println("  2. OpenSSH Server (if installed by test)")
	fmt.Println("  3. Firewall rules")
	fmt.Println("  4. Test files and directories")
	fmt.Println("  5. Restore Windows services to original state")
	fmt.Println()
	fmt.Println("Starting cleanup (unattended mode)...")
	fmt.Println()

	totalSteps := 9
	currentStep := 0

	// Step 1: Stop Tailscale service
	currentStep++
	fmt.Printf("[%d/%d] Stopping Tailscale service...\n", currentStep, totalSteps)
	stopTailscaleService()

	// Step 2: Uninstall Tailscale MSI
	currentStep++
	fmt.Printf("[%d/%d] Uninstalling Tailscale...\n", currentStep, totalSteps)
	uninstallTailscale()

	// Step 3: Stop OpenSSH
	currentStep++
	fmt.Printf("[%d/%d] Stopping OpenSSH Server...\n", currentStep, totalSteps)
	stopOpenSSH()

	// Step 4: Remove OpenSSH Server
	currentStep++
	fmt.Printf("[%d/%d] Removing OpenSSH Server...\n", currentStep, totalSteps)
	removeOpenSSH()

	// Step 5: Remove firewall rules
	currentStep++
	fmt.Printf("[%d/%d] Removing firewall rules...\n", currentStep, totalSteps)
	removeFirewallRules()

	// Step 6: Clean up test files
	currentStep++
	fmt.Printf("[%d/%d] Removing test files...\n", currentStep, totalSteps)
	cleanupTestFiles()

	// Step 7: Remove exfiltrated data
	currentStep++
	fmt.Printf("[%d/%d] Removing exfiltrated data...\n", currentStep, totalSteps)
	cleanupExfiltratedData()

	// Step 8: Final cleanup
	currentStep++
	fmt.Printf("[%d/%d] Final cleanup...\n", currentStep, totalSteps)
	finalCleanup()

	// Step 9: Restore original service states
	currentStep++
	fmt.Printf("[%d/%d] Restoring original service states...\n", currentStep, totalSteps)
	restoreOriginalServiceStates()

	fmt.Println()
	fmt.Println("=================================================================")
	fmt.Println("Cleanup Complete!")
	fmt.Println("=================================================================")
	fmt.Println()
}

func stopTailscaleService() {
	// Stop Tailscale Windows service
	exec.Command("sc", "stop", "Tailscale").Run()
	time.Sleep(3 * time.Second)

	// Kill any remaining processes
	exec.Command("taskkill", "/F", "/IM", "tailscale.exe").Run()
	exec.Command("taskkill", "/F", "/IM", "tailscaled.exe").Run()
	time.Sleep(2 * time.Second)
	fmt.Println("  Tailscale service stopped")
}

func uninstallTailscale() {
	// Method 1: Try uninstalling via MSI if we have the file
	msiPath := filepath.Join("C:\\F0", "tailscale-setup.msi")
	if _, err := os.Stat(msiPath); err == nil {
		fmt.Println("  Uninstalling via MSI...")
		cmd := exec.Command("msiexec", "/x", msiPath, "/quiet", "/norestart")
		cmd.Run()
		time.Sleep(10 * time.Second)
	}

	// Method 2: Try uninstalling via product code (works even if MSI deleted)
	fmt.Println("  Searching for Tailscale installation...")
	cmd := exec.Command("wmic", "product", "where", "name='Tailscale'", "call", "uninstall", "/nointeractive")
	output, _ := cmd.CombinedOutput()
	if len(output) > 0 {
		fmt.Println("  Uninstall command executed")
		time.Sleep(10 * time.Second)
	}

	// Method 3: Remove service manually if still present
	exec.Command("sc", "delete", "Tailscale").Run()

	// Clean up Tailscale installation directory
	tailscaleDir := "C:\\Program Files\\Tailscale"
	if _, err := os.Stat(tailscaleDir); err == nil {
		os.RemoveAll(tailscaleDir)
		fmt.Println("  Removed Tailscale directory")
	}

	// Clean up Tailscale data directory
	tailscaleData := "C:\\ProgramData\\Tailscale"
	if _, err := os.Stat(tailscaleData); err == nil {
		os.RemoveAll(tailscaleData)
		fmt.Println("  Removed Tailscale data directory")
	}

	fmt.Println("  Tailscale uninstalled")
}

func stopOpenSSH() {
	cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
		"Stop-Service sshd -ErrorAction SilentlyContinue")
	cmd.Run()
	fmt.Println("  OpenSSH service stopped")
}

func removeOpenSSH() {
	// Check if state file exists
	if _, err := os.Stat(OPENSSH_STATE_FILE); os.IsNotExist(err) {
		fmt.Println("  No OpenSSH state file found - using default removal method")
		fmt.Println("  Removing OpenSSH Server (unattended mode assumes test installed it)...")

		// Method 1: Try manual installation cleanup (new method)
		manualInstallPath := "C:\\Program Files\\OpenSSH"
		if _, err := os.Stat(manualInstallPath); err == nil {
			fmt.Println("  Detected manual OpenSSH installation - running cleanup...")

			// Run uninstall-sshd.ps1 if it exists
			uninstallScript := filepath.Join(manualInstallPath, "uninstall-sshd.ps1")
			if _, err := os.Stat(uninstallScript); err == nil {
				fmt.Println("    Running uninstall-sshd.ps1...")
				cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-File", uninstallScript)
				cmd.Dir = manualInstallPath
				if output, err := cmd.CombinedOutput(); err != nil {
					fmt.Printf("    Warning: uninstall script failed: %v - %s\n", err, string(output))
				} else {
					fmt.Println("    Uninstall script completed")
					time.Sleep(2 * time.Second)
				}
			}

			// Delete service if still exists
			exec.Command("sc", "delete", "sshd").Run()
			exec.Command("sc", "delete", "ssh-agent").Run()

			// Remove the installation directory
			fmt.Println("    Removing C:\\Program Files\\OpenSSH directory...")
			if err := os.RemoveAll(manualInstallPath); err != nil {
				fmt.Printf("    Warning: Failed to remove directory: %v\n", err)
			} else {
				fmt.Println("    Manual OpenSSH installation removed")
			}
		} else {
			// Method 2: Try Windows Capability removal (legacy method)
			fmt.Println("  Attempting Windows Capability removal...")
			cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
				"Remove-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0")

			if err := cmd.Run(); err != nil {
				fmt.Printf("  Failed to remove OpenSSH: %v\n", err)
			} else {
				fmt.Println("  OpenSSH Server removed")
			}
		}

		// Clean up dropped zip file
		zipPath := "c:\\F0\\OpenSSH-Win64.zip"
		if err := os.Remove(zipPath); err == nil {
			fmt.Println("  Removed OpenSSH-Win64.zip")
		}

		return
	}

	// New: Restore based on state file
	fmt.Println("  Restoring OpenSSH to original state using state file...")
	restoreOpenSSHState()
}

func removeFirewallRules() {
	// Check if OpenSSH state file exists - if so, firewall restoration is handled by restoreOpenSSHState()
	if _, err := os.Stat(OPENSSH_STATE_FILE); err == nil {
		fmt.Println("  Firewall restoration handled by OpenSSH state restore")
		return
	}

	// Legacy: Remove firewall rule (no state file available)
	cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
		"Remove-NetFirewallRule -Name sshd -ErrorAction SilentlyContinue")
	cmd.Run()
	fmt.Println("  Firewall rules removed (legacy mode)")
}

func cleanupTestFiles() {
	filesToRemove := []string{
		"c:\\F0\\tailscale.exe",
		"c:\\F0\\tailscale.state",
		"c:\\F0\\tailscale.sock",
		"c:\\F0\\test_config.txt",
		"c:\\F0\\ssh_test_marker.txt",
		"c:\\F0\\exfiltrated_data.zip",
		"c:\\F0\\EXFILTRATED_DATA.zip",
		"c:\\F0\\OpenSSH-Win64.zip",
		"c:\\F0\\tailscale-setup.msi",
	}

	for _, file := range filesToRemove {
		if err := os.Remove(file); err == nil {
			fmt.Printf("    Removed: %s\n", filepath.Base(file))
		}
	}
}

func cleanupExfiltratedData() {
	exfilDir := "c:\\F0\\exfil_staging"
	if err := os.RemoveAll(exfilDir); err == nil {
		fmt.Printf("    Removed: exfil_staging directory\n")
	}
}

func finalCleanup() {
	// Remove stage binaries
	pattern := "c:\\F0\\eafce2fc-75fd-4c62-92dc-32cabe5cf206-*.exe"
	matches, _ := filepath.Glob(pattern)
	for _, match := range matches {
		if err := os.Remove(match); err == nil {
			fmt.Printf("    Removed: %s\n", filepath.Base(match))
		}
	}

	// Remove log files
	os.Remove("c:\\F0\\test_execution_log.json")
	os.Remove("c:\\F0\\test_execution_log.txt")

	fmt.Println("  Test artifacts cleaned up")
}

func restoreOpenSSHState() {
	// Read OpenSSH state from JSON file
	data, err := os.ReadFile(OPENSSH_STATE_FILE)
	if err != nil {
		fmt.Printf("  Error reading OpenSSH state file: %v\n", err)
		return
	}

	var state OpenSSHState
	if err := json.Unmarshal(data, &state); err != nil {
		fmt.Printf("  Error parsing OpenSSH state file: %v\n", err)
		return
	}

	fmt.Printf("  Original OpenSSH state: Installed=%v, Startup=%s, Running=%v, Firewall=%v\n",
		state.WasInstalled, state.ServiceStartup, state.ServiceRunning, state.FirewallRuleExist)

	// If OpenSSH was NOT installed originally, remove it
	if !state.WasInstalled {
		fmt.Println("    OpenSSH was NOT installed before test - removing...")

		// Check if it's a manual installation or Windows Capability installation
		manualInstallPath := "C:\\Program Files\\OpenSSH"
		if _, err := os.Stat(manualInstallPath); err == nil {
			// Manual installation - run uninstall script
			fmt.Println("    Detected manual installation - running uninstall...")
			uninstallScript := filepath.Join(manualInstallPath, "uninstall-sshd.ps1")

			if _, err := os.Stat(uninstallScript); err == nil {
				cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-File", uninstallScript)
				cmd.Dir = manualInstallPath
				if output, err := cmd.CombinedOutput(); err != nil {
					fmt.Printf("    Warning: uninstall script failed: %v - %s\n", err, string(output))
				} else {
					fmt.Println("    Uninstall script completed")
					time.Sleep(2 * time.Second)
				}
			}

			// Delete services
			exec.Command("sc", "delete", "sshd").Run()
			exec.Command("sc", "delete", "ssh-agent").Run()

			// Remove directory
			if err := os.RemoveAll(manualInstallPath); err != nil {
				fmt.Printf("    Warning: Failed to remove directory: %v\n", err)
			} else {
				fmt.Println("    Manual OpenSSH installation removed")
			}

			// Clean up dropped zip
			os.Remove("c:\\F0\\OpenSSH-Win64.zip")
		} else {
			// Windows Capability installation
			cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
				"Remove-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0")

			if err := cmd.Run(); err != nil {
				fmt.Printf("    Failed to remove OpenSSH: %v\n", err)
			} else {
				fmt.Println("    OpenSSH Server removed")
			}
		}
	} else {
		// OpenSSH WAS installed - restore to original state
		fmt.Println("    OpenSSH was already installed - restoring original configuration...")

		// Restore service startup type
		var startupArg string
		switch state.ServiceStartup {
		case "disabled":
			startupArg = "disabled"
		case "manual":
			startupArg = "demand"
		case "auto":
			startupArg = "auto"
		default:
			fmt.Printf("    Unknown startup type: %s, leaving as-is\n", state.ServiceStartup)
			startupArg = ""
		}

		if startupArg != "" {
			cmd := exec.Command("sc", "config", "sshd", "start=", startupArg)
			if err := cmd.Run(); err != nil {
				fmt.Printf("    Failed to restore startup type: %v\n", err)
			} else {
				fmt.Printf("    Restored startup type to: %s\n", state.ServiceStartup)
			}
		}

		// Restore running state
		if !state.ServiceRunning {
			// Service was NOT running originally - stop it
			cmd := exec.Command("sc", "stop", "sshd")
			output, err := cmd.CombinedOutput()
			if err != nil {
				if !strings.Contains(string(output), "not started") {
					fmt.Printf("    Warning: Failed to stop sshd: %v\n", err)
				} else {
					fmt.Println("    Service already stopped")
				}
			} else {
				fmt.Println("    Stopped sshd service (was not running originally)")
			}
		} else {
			fmt.Println("    Service left running (was running originally)")
		}
	}

	// Restore firewall rule state
	if !state.FirewallRuleExist {
		// Rule did NOT exist originally - remove it
		fmt.Println("    Firewall rule did NOT exist before test - removing...")
		cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command",
			"Remove-NetFirewallRule -Name sshd -ErrorAction SilentlyContinue")
		cmd.Run()
		fmt.Println("    Firewall rule removed")
	} else {
		fmt.Println("    Firewall rule existed before test - leaving intact")
	}

	// Delete the state file
	if err := os.Remove(OPENSSH_STATE_FILE); err == nil {
		fmt.Println("  OpenSSH state file removed")
	}

	fmt.Println("  OpenSSH restored to original state")
}

func restoreOriginalServiceStates() {
	// Check if service state file exists
	if _, err := os.Stat(SERVICE_STATE_FILE); os.IsNotExist(err) {
		fmt.Println("  No service state file found - services were not modified by test")
		return
	}

	// Read service states from JSON file
	data, err := os.ReadFile(SERVICE_STATE_FILE)
	if err != nil {
		fmt.Printf("  Error reading service state file: %v\n", err)
		return
	}

	var states map[string]ServiceState
	if err := json.Unmarshal(data, &states); err != nil {
		fmt.Printf("  Error parsing service state file: %v\n", err)
		return
	}

	fmt.Printf("  Restoring %d services to original state...\n", len(states))

	// Restore each service to its original state
	for _, state := range states {
		fmt.Printf("    Service: %s (Original: %s, Running: %v)\n",
			state.Name, state.StartupType, state.IsRunning)

		// Restore startup type
		var startupArg string
		switch state.StartupType {
		case "disabled":
			startupArg = "disabled"
		case "manual":
			startupArg = "demand"
		case "auto":
			startupArg = "auto"
		case "auto_delayed":
			startupArg = "delayed-auto"
		default:
			fmt.Printf("      Unknown startup type: %s, skipping\n", state.StartupType)
			continue
		}

		cmd := exec.Command("sc", "config", state.Name, "start=", startupArg)
		if err := cmd.Run(); err != nil {
			fmt.Printf("      Failed to restore startup type: %v\n", err)
		} else {
			fmt.Printf("      Restored startup type to: %s\n", state.StartupType)
		}

		// Restore running state
		if !state.IsRunning {
			// Service was NOT running originally - stop it
			cmd := exec.Command("sc", "stop", state.Name)
			output, err := cmd.CombinedOutput()
			if err != nil {
				// Ignore error if service already stopped
				if !strings.Contains(string(output), "not started") {
					fmt.Printf("      Warning: Failed to stop service: %v\n", err)
				} else {
					fmt.Printf("      Service already stopped\n")
				}
			} else {
				fmt.Printf("      Stopped service (was not running originally)\n")
			}
		}
		// If service WAS running originally, leave it running
	}

	// Delete the state file
	if err := os.Remove(SERVICE_STATE_FILE); err == nil {
		fmt.Println("  Service state file removed")
	}

	fmt.Println("  Services restored to original state")
}

func checkIsAdmin() bool {
	cmd := exec.Command("net", "session")
	err := cmd.Run()
	return err == nil
}