//go:build windows
// +build windows

// Stage 1: Defense Evasion
// MITRE ATT&CK: T1070.001 (Clear Windows Event Logs), T1562.004 (Disable System Firewall)
//
// This stage simulates ransomware defense evasion techniques:
// 1. Creates a custom event log channel "F0RT1KA-Test"
// 2. Clears the custom log channel (triggers wevtutil detection)
// 3. Creates a test firewall rule
// 4. Deletes the test firewall rule
//
// SAFETY:
// - Uses custom event log channel (no real log destruction)
// - Creates/deletes test firewall rule (no real firewall changes)
//
// EXIT CODES:
//   0   - Technique succeeded
//   126 - Technique blocked by EDR
//   105 - Binary quarantined
//   999 - Prerequisites not met (not admin)

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const (
	TEST_UUID      = "581e0f20-13f0-4374-9686-be3abd110ae0"
	STAGE_ID       = 1
	TECHNIQUE_IDS  = "T1070.001, T1562.004"
	TECHNIQUE_NAME = "Defense Evasion"

	// Custom event log channel name
	CUSTOM_LOG_CHANNEL = "F0RT1KA-Test"

	// Test firewall rule name
	TEST_FIREWALL_RULE = "F0RT1KA-Test-Rule"
)

// Standardized exit codes
const (
	StageSuccess     = 0
	StageBlocked     = 126
	StageQuarantined = 105
	StageError       = 999
)

func main() {
	// Attach to shared log file
	AttachLogger(TEST_UUID, fmt.Sprintf("Stage %d: %s", STAGE_ID, TECHNIQUE_IDS))

	fmt.Printf("[STAGE %d] Starting %s\n", STAGE_ID, TECHNIQUE_NAME)
	fmt.Printf("[STAGE %d] Techniques: %s\n", STAGE_ID, TECHNIQUE_IDS)
	fmt.Println()

	LogMessage("INFO", TECHNIQUE_IDS, fmt.Sprintf("Starting %s", TECHNIQUE_NAME))

	// Check prerequisites
	if !isAdmin() {
		fmt.Printf("[STAGE %d] ERROR: Administrator privileges required\n", STAGE_ID)
		LogMessage("ERROR", TECHNIQUE_IDS, "Administrator privileges required")
		LogStageEnd(STAGE_ID, "T1070.001", "error", "Not running as administrator")
		os.Exit(StageError)
	}

	fmt.Printf("[STAGE %d] Running with administrator privileges\n", STAGE_ID)
	fmt.Println()

	// Phase 1: Event Log Clearing (T1070.001)
	fmt.Println("=== T1070.001: Clear Windows Event Logs ===")
	fmt.Println()

	if err := performEventLogClearing(); err != nil {
		fmt.Printf("[STAGE %d] Event log clearing failed: %v\n", STAGE_ID, err)
		LogMessage("ERROR", "T1070.001", fmt.Sprintf("Event log clearing failed: %v", err))

		if isBlockedError(err) {
			LogStageBlocked(STAGE_ID, "T1070.001", err.Error())
			os.Exit(StageBlocked)
		}

		LogStageEnd(STAGE_ID, "T1070.001", "error", err.Error())
		os.Exit(StageError)
	}

	fmt.Printf("[STAGE %d] Event log operations completed\n", STAGE_ID)
	fmt.Println()

	// Phase 2: Firewall Rule Manipulation (T1562.004)
	fmt.Println("=== T1562.004: Disable or Modify System Firewall ===")
	fmt.Println()

	if err := performFirewallManipulation(); err != nil {
		fmt.Printf("[STAGE %d] Firewall manipulation failed: %v\n", STAGE_ID, err)
		LogMessage("ERROR", "T1562.004", fmt.Sprintf("Firewall manipulation failed: %v", err))

		if isBlockedError(err) {
			LogStageBlocked(STAGE_ID, "T1562.004", err.Error())
			os.Exit(StageBlocked)
		}

		LogStageEnd(STAGE_ID, "T1562.004", "error", err.Error())
		os.Exit(StageError)
	}

	fmt.Printf("[STAGE %d] Firewall manipulation completed\n", STAGE_ID)
	fmt.Println()

	// All techniques succeeded
	fmt.Printf("[STAGE %d] Defense evasion techniques completed successfully\n", STAGE_ID)
	LogMessage("SUCCESS", TECHNIQUE_IDS, "Defense evasion techniques executed successfully")
	LogStageEnd(STAGE_ID, "T1070.001", "success", "Defense evasion completed without prevention")
	os.Exit(StageSuccess)
}

// performEventLogClearing creates and clears a custom event log channel
func performEventLogClearing() error {
	fmt.Println("  [1/4] Creating custom event log channel...")

	// Create custom event log channel using wevtutil
	// This triggers the same detection as clearing real logs, but is safe
	createCmd := exec.Command("wevtutil", "sl", CUSTOM_LOG_CHANNEL, "/e:true")
	output, err := createCmd.CombinedOutput()

	if err != nil {
		// Channel might not exist yet, try to create it first
		fmt.Printf("        Note: Channel may not exist, attempting to create...\n")

		// Use PowerShell to create a new event log
		psCmd := fmt.Sprintf(`
			try {
				New-EventLog -LogName '%s' -Source 'F0RT1KA' -ErrorAction Stop
				Write-Host "Created event log: %s"
			} catch {
				if ($_.Exception.Message -like "*already exists*") {
					Write-Host "Event log already exists"
				} else {
					throw $_
				}
			}
		`, CUSTOM_LOG_CHANNEL, CUSTOM_LOG_CHANNEL)

		createLogCmd := exec.Command("powershell", "-ExecutionPolicy", "Bypass", "-Command", psCmd)
		output, err = createLogCmd.CombinedOutput()
		if err != nil {
			// If we can't create, try to proceed anyway with the clear
			fmt.Printf("        Warning: Could not create custom log: %v\n", err)
			fmt.Printf("        Output: %s\n", string(output))
		} else {
			fmt.Printf("        Created custom event log channel\n")
		}
	}

	LogProcessExecution("wevtutil", "wevtutil sl "+CUSTOM_LOG_CHANNEL+" /e:true", 0, err == nil, 0, string(output))

	// Write a test event to the log
	fmt.Println("  [2/4] Writing test event to custom log...")
	writeEventCmd := exec.Command("powershell", "-ExecutionPolicy", "Bypass", "-Command",
		fmt.Sprintf(`Write-EventLog -LogName '%s' -Source 'F0RT1KA' -EventId 1000 -EntryType Information -Message 'F0RT1KA test event for ransomware simulation' -ErrorAction SilentlyContinue`, CUSTOM_LOG_CHANNEL))
	output, err = writeEventCmd.CombinedOutput()
	if err != nil {
		fmt.Printf("        Note: Could not write test event (may not affect test): %v\n", err)
	} else {
		fmt.Println("        Test event written to log")
	}

	// Clear the custom event log (this is the actual T1070.001 technique)
	fmt.Println("  [3/4] Clearing custom event log channel (T1070.001 trigger)...")
	clearCmd := exec.Command("wevtutil", "cl", CUSTOM_LOG_CHANNEL)
	output, err = clearCmd.CombinedOutput()

	if err != nil {
		outputStr := string(output)
		fmt.Printf("        Error output: %s\n", outputStr)

		// Check if this is an access denied (EDR block)
		if strings.Contains(strings.ToLower(outputStr), "access") ||
			strings.Contains(strings.ToLower(err.Error()), "access") {
			return fmt.Errorf("access denied - wevtutil blocked: %v", err)
		}

		// If the log doesn't exist, that's okay - the technique still ran
		if strings.Contains(outputStr, "not found") || strings.Contains(outputStr, "cannot find") {
			fmt.Println("        Note: Custom log channel not found (OK - technique executed)")
			LogProcessExecution("wevtutil", "wevtutil cl "+CUSTOM_LOG_CHANNEL, 0, true, 0, "Log not found - technique executed")
		} else {
			return fmt.Errorf("wevtutil clear failed: %v - %s", err, outputStr)
		}
	} else {
		fmt.Printf("        Cleared event log channel: %s\n", CUSTOM_LOG_CHANNEL)
		LogProcessExecution("wevtutil", "wevtutil cl "+CUSTOM_LOG_CHANNEL, 0, true, 0, string(output))
	}

	// Cleanup: Try to remove the custom log channel
	fmt.Println("  [4/4] Cleaning up custom event log channel...")
	cleanupCmd := exec.Command("powershell", "-ExecutionPolicy", "Bypass", "-Command",
		fmt.Sprintf(`Remove-EventLog -LogName '%s' -ErrorAction SilentlyContinue`, CUSTOM_LOG_CHANNEL))
	cleanupCmd.Run() // Ignore errors on cleanup
	fmt.Println("        Cleanup completed")

	LogMessage("SUCCESS", "T1070.001", fmt.Sprintf("Cleared custom event log channel: %s", CUSTOM_LOG_CHANNEL))
	return nil
}

// performFirewallManipulation creates and deletes a test firewall rule
func performFirewallManipulation() error {
	// Create a test firewall rule
	fmt.Println("  [1/2] Creating test firewall rule (T1562.004 trigger)...")

	createRuleCmd := exec.Command("netsh", "advfirewall", "firewall", "add", "rule",
		fmt.Sprintf("name=%s", TEST_FIREWALL_RULE),
		"dir=in",
		"action=allow",
		"protocol=tcp",
		"localport=65534",
		"description=F0RT1KA test rule for ransomware simulation")

	output, err := createRuleCmd.CombinedOutput()
	outputStr := string(output)

	if err != nil {
		fmt.Printf("        Error: %v\n", err)
		fmt.Printf("        Output: %s\n", outputStr)

		// Check for access denied (EDR block)
		if strings.Contains(strings.ToLower(outputStr), "access") ||
			strings.Contains(strings.ToLower(err.Error()), "access") ||
			strings.Contains(strings.ToLower(outputStr), "blocked") {
			LogProcessExecution("netsh", "netsh advfirewall add rule", 0, false, 1, outputStr)
			return fmt.Errorf("access denied - netsh advfirewall blocked: %v", err)
		}

		LogProcessExecution("netsh", "netsh advfirewall add rule", 0, false, 1, outputStr)
		return fmt.Errorf("failed to create firewall rule: %v - %s", err, outputStr)
	}

	fmt.Printf("        Created firewall rule: %s\n", TEST_FIREWALL_RULE)
	LogProcessExecution("netsh", "netsh advfirewall add rule "+TEST_FIREWALL_RULE, 0, true, 0, outputStr)

	// Delete the test firewall rule
	fmt.Println("  [2/2] Deleting test firewall rule (cleanup)...")

	deleteRuleCmd := exec.Command("netsh", "advfirewall", "firewall", "delete", "rule",
		fmt.Sprintf("name=%s", TEST_FIREWALL_RULE))

	output, err = deleteRuleCmd.CombinedOutput()
	outputStr = string(output)

	if err != nil {
		fmt.Printf("        Warning: Could not delete rule: %v\n", err)
		fmt.Printf("        Output: %s\n", outputStr)
		// Not a fatal error - rule was created successfully
	} else {
		fmt.Printf("        Deleted firewall rule: %s\n", TEST_FIREWALL_RULE)
	}

	LogProcessExecution("netsh", "netsh advfirewall delete rule "+TEST_FIREWALL_RULE, 0, err == nil, 0, outputStr)
	LogMessage("SUCCESS", "T1562.004", fmt.Sprintf("Created and deleted test firewall rule: %s", TEST_FIREWALL_RULE))

	return nil
}

// isAdmin checks if the current process has administrator privileges
func isAdmin() bool {
	cmd := exec.Command("net", "session")
	err := cmd.Run()
	return err == nil
}

// isBlockedError checks if an error indicates EDR blocking
func isBlockedError(err error) bool {
	if err == nil {
		return false
	}

	errStr := strings.ToLower(err.Error())
	blockPatterns := []string{
		"access denied",
		"access is denied",
		"permission denied",
		"blocked",
		"prevented",
		"not allowed",
		"operation not permitted",
	}

	for _, pattern := range blockPatterns {
		if strings.Contains(errStr, pattern) {
			return true
		}
	}

	return false
}
