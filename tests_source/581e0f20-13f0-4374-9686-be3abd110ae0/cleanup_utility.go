//go:build windows
// +build windows

// Cleanup Utility for Ransomware Encryption via BitLocker Test
//
// This utility performs comprehensive cleanup after the test:
// 1. Decrypt VHD if encrypted with BitLocker
// 2. Dismount VHD if mounted
// 3. Delete VHD file
// 4. Remove test firewall rules
// 5. Remove custom event log channel
// 6. Clean up test files in C:\F0
//
// IMPORTANT: This utility runs UNATTENDED - no user prompts!
// Suitable for remote/automated execution.
//
// Usage: cleanup_utility.exe
//
// Exit codes:
//   0 - Cleanup completed (with or without warnings)
//   1 - Cleanup failed

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	// VHD configuration
	VHD_PATH           = "C:\\F0\\bitlocker_test.vhd"
	VHD_LABEL          = "F0RT1KA-TEST"
	BITLOCKER_PASSWORD = "F0RT1KA-Recovery-2024!"

	// Test artifacts
	CUSTOM_LOG_CHANNEL   = "F0RT1KA-Test"
	TEST_FIREWALL_RULE   = "F0RT1KA-Test-Rule"
	TARGET_DIR           = "C:\\F0"
)

func main() {
	fmt.Println("=================================================================")
	fmt.Println("F0RT1KA Cleanup Utility")
	fmt.Println("Ransomware Encryption via BitLocker Test")
	fmt.Println("=================================================================")
	fmt.Println()

	// Track if any cleanup failed
	hasWarnings := false

	// Step 1: Find and decrypt VHD
	fmt.Println("[1/6] Checking for BitLocker-encrypted VHD...")
	if err := decryptVHD(); err != nil {
		fmt.Printf("      Warning: %v\n", err)
		hasWarnings = true
	}

	// Step 2: Detach VHD
	fmt.Println("[2/6] Detaching VHD...")
	if err := detachVHD(); err != nil {
		fmt.Printf("      Warning: %v\n", err)
		hasWarnings = true
	}

	// Step 3: Delete VHD file
	fmt.Println("[3/6] Deleting VHD file...")
	if err := deleteVHDFile(); err != nil {
		fmt.Printf("      Warning: %v\n", err)
		hasWarnings = true
	}

	// Step 4: Remove test firewall rules
	fmt.Println("[4/6] Removing test firewall rules...")
	if err := removeFirewallRules(); err != nil {
		fmt.Printf("      Warning: %v\n", err)
		hasWarnings = true
	}

	// Step 5: Remove custom event log channel
	fmt.Println("[5/6] Removing custom event log channel...")
	if err := removeEventLogChannel(); err != nil {
		fmt.Printf("      Warning: %v\n", err)
		hasWarnings = true
	}

	// Step 6: Clean up test files (but preserve logs)
	fmt.Println("[6/6] Cleaning up test files...")
	if err := cleanupTestFiles(); err != nil {
		fmt.Printf("      Warning: %v\n", err)
		hasWarnings = true
	}

	fmt.Println()
	fmt.Println("=================================================================")
	if hasWarnings {
		fmt.Println("Cleanup completed with warnings")
		fmt.Println("Some artifacts may need manual removal")
	} else {
		fmt.Println("Cleanup completed successfully")
	}
	fmt.Println("=================================================================")
}

// decryptVHD attempts to decrypt any BitLocker-protected VHD
func decryptVHD() error {
	// Find mounted volumes with our label
	driveLetter := findVHDDrive()
	if driveLetter == "" {
		fmt.Println("      No VHD mounted - skipping decryption")
		return nil
	}

	drive := fmt.Sprintf("%s:", driveLetter)
	fmt.Printf("      Found VHD at %s\n", drive)

	// Check if BitLocker is enabled
	cmd := exec.Command("manage-bde", "-status", drive)
	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	if err != nil {
		// manage-bde might not exist
		if strings.Contains(strings.ToLower(outputStr), "not recognized") {
			fmt.Println("      manage-bde not available - skipping BitLocker check")
			return nil
		}
	}

	// Check if encrypted
	if strings.Contains(outputStr, "Fully Encrypted") ||
		strings.Contains(outputStr, "Encryption in Progress") ||
		strings.Contains(outputStr, "Decryption in Progress") {

		fmt.Println("      VHD is encrypted - attempting to decrypt...")

		// Try to unlock first
		unlockCmd := exec.Command("manage-bde", "-unlock", drive, "-Password", BITLOCKER_PASSWORD)
		unlockCmd.Run() // Ignore errors

		// Disable BitLocker
		decryptCmd := exec.Command("manage-bde", "-off", drive)
		output, err = decryptCmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("failed to disable BitLocker: %v - %s", err, string(output))
		}

		fmt.Println("      BitLocker decryption initiated")
		fmt.Println("      Waiting for decryption to complete...")

		// Wait for decryption (with timeout)
		for i := 0; i < 30; i++ {
			time.Sleep(2 * time.Second)

			cmd := exec.Command("manage-bde", "-status", drive)
			output, _ := cmd.CombinedOutput()

			if strings.Contains(string(output), "Fully Decrypted") ||
				strings.Contains(string(output), "Protection Off") {
				fmt.Println("      Decryption completed")
				return nil
			}
		}

		fmt.Println("      Decryption taking too long - proceeding with detach")
	} else {
		fmt.Println("      VHD not encrypted or already decrypted")
	}

	return nil
}

// detachVHD detaches the VHD
func detachVHD() error {
	// First try to find any mounted VHD with our label
	driveLetter := findVHDDrive()
	if driveLetter != "" {
		fmt.Printf("      Detaching VHD at %s:\n", driveLetter)
	}

	// Use diskpart to detach
	if _, err := os.Stat(VHD_PATH); err == nil {
		detachScript := fmt.Sprintf(`
select vdisk file="%s"
detach vdisk
`, VHD_PATH)

		output, err := runDiskpart(detachScript)
		if err != nil {
			// Check if VHD wasn't attached
			if strings.Contains(output, "not attached") ||
				strings.Contains(output, "There is no virtual disk") {
				fmt.Println("      VHD was not attached")
				return nil
			}
			return fmt.Errorf("diskpart detach failed: %v - %s", err, output)
		}

		fmt.Println("      VHD detached successfully")
	} else {
		fmt.Println("      VHD file does not exist - skipping detach")
	}

	return nil
}

// deleteVHDFile deletes the VHD file
func deleteVHDFile() error {
	if _, err := os.Stat(VHD_PATH); os.IsNotExist(err) {
		fmt.Println("      VHD file does not exist - nothing to delete")
		return nil
	}

	// Try to delete immediately
	if err := os.Remove(VHD_PATH); err == nil {
		fmt.Printf("      Deleted: %s\n", VHD_PATH)
		return nil
	}

	// If deletion failed, wait a moment and retry
	fmt.Println("      File in use - waiting before retry...")
	time.Sleep(3 * time.Second)

	if err := os.Remove(VHD_PATH); err != nil {
		return fmt.Errorf("failed to delete VHD: %v", err)
	}

	fmt.Printf("      Deleted: %s\n", VHD_PATH)
	return nil
}

// removeFirewallRules removes test firewall rules
func removeFirewallRules() error {
	cmd := exec.Command("netsh", "advfirewall", "firewall", "delete", "rule",
		fmt.Sprintf("name=%s", TEST_FIREWALL_RULE))

	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	if err != nil {
		if strings.Contains(outputStr, "No rules match") ||
			strings.Contains(outputStr, "not found") {
			fmt.Println("      No test firewall rules found - nothing to remove")
			return nil
		}
		return fmt.Errorf("failed to remove firewall rule: %v - %s", err, outputStr)
	}

	fmt.Printf("      Removed firewall rule: %s\n", TEST_FIREWALL_RULE)
	return nil
}

// removeEventLogChannel removes the custom event log channel
func removeEventLogChannel() error {
	// Try to remove the event log
	cmd := exec.Command("powershell", "-ExecutionPolicy", "Bypass", "-Command",
		fmt.Sprintf(`
			$ErrorActionPreference = 'SilentlyContinue'
			Remove-EventLog -LogName '%s' -ErrorAction SilentlyContinue
			if ($?) {
				Write-Host "Removed event log: %s"
			} else {
				Write-Host "Event log not found or already removed"
			}
		`, CUSTOM_LOG_CHANNEL, CUSTOM_LOG_CHANNEL))

	output, _ := cmd.CombinedOutput()
	fmt.Printf("      %s\n", strings.TrimSpace(string(output)))

	return nil
}

// cleanupTestFiles cleans up test-generated files (preserving logs)
func cleanupTestFiles() error {
	// Files to clean up (stage binaries, output files, etc.)
	filesToDelete := []string{
		"581e0f20-13f0-4374-9686-be3abd110ae0-stage1.exe",
		"581e0f20-13f0-4374-9686-be3abd110ae0-stage2.exe",
		"581e0f20-13f0-4374-9686-be3abd110ae0-stage3.exe",
		"target_volumes.txt",
		"stage1_output.txt",
		"stage2_output.txt",
		"stage3_output.txt",
	}

	deletedCount := 0
	for _, filename := range filesToDelete {
		filePath := filepath.Join(TARGET_DIR, filename)
		if _, err := os.Stat(filePath); err == nil {
			if err := os.Remove(filePath); err == nil {
				deletedCount++
			}
		}
	}

	// Preserve logs
	fmt.Println("      Preserving execution logs:")
	fmt.Println("        - test_execution_log.json")
	fmt.Println("        - test_execution_log.txt")
	fmt.Println("        - cleanup_output.txt")

	if deletedCount > 0 {
		fmt.Printf("      Deleted %d test files\n", deletedCount)
	} else {
		fmt.Println("      No test files to delete")
	}

	return nil
}

// findVHDDrive finds the drive letter of the mounted VHD
func findVHDDrive() string {
	// Query volumes with our label
	cmd := exec.Command("wmic", "volume", "where", fmt.Sprintf("Label='%s'", VHD_LABEL),
		"get", "DriveLetter", "/format:list")
	output, err := cmd.CombinedOutput()

	if err == nil {
		for _, line := range strings.Split(string(output), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "DriveLetter=") {
				letter := strings.TrimPrefix(line, "DriveLetter=")
				letter = strings.TrimSuffix(letter, ":")
				letter = strings.TrimSpace(letter)
				if letter != "" {
					return letter
				}
			}
		}
	}

	// Fallback: scan common drive letters
	for _, letter := range "VWXYZ" {
		drivePath := fmt.Sprintf("%c:\\", letter)
		if _, err := os.Stat(drivePath); err == nil {
			cmd := exec.Command("vol", fmt.Sprintf("%c:", letter))
			volOutput, _ := cmd.CombinedOutput()
			if strings.Contains(string(volOutput), VHD_LABEL) {
				return string(letter)
			}
		}
	}

	return ""
}

// runDiskpart executes a diskpart script
func runDiskpart(script string) (string, error) {
	scriptPath := filepath.Join(os.TempDir(), "f0rt1ka_cleanup_diskpart.txt")
	err := os.WriteFile(scriptPath, []byte(script), 0644)
	if err != nil {
		return "", fmt.Errorf("failed to write diskpart script: %v", err)
	}
	defer os.Remove(scriptPath)

	cmd := exec.Command("diskpart", "/s", scriptPath)
	output, err := cmd.CombinedOutput()

	return string(output), err
}
