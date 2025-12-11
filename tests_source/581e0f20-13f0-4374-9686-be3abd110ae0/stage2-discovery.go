//go:build windows
// +build windows

// Stage 2: Discovery
// MITRE ATT&CK: T1082 (System Information Discovery), T1083 (File and Directory Discovery)
//
// This stage simulates ransomware discovery techniques:
// 1. Enumerate system information using wmic
// 2. Check BitLocker status using manage-bde
// 3. Check if BitLocker feature is available (Windows Pro/Enterprise)
// 4. Enumerate available drives
// 5. Create target_volumes.txt in C:\F0
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
)

const (
	TEST_UUID      = "581e0f20-13f0-4374-9686-be3abd110ae0"
	STAGE_ID       = 2
	TECHNIQUE_IDS  = "T1082, T1083"
	TECHNIQUE_NAME = "Discovery"
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
		LogStageEnd(STAGE_ID, "T1082", "error", "Not running as administrator")
		os.Exit(StageError)
	}

	fmt.Printf("[STAGE %d] Running with administrator privileges\n", STAGE_ID)
	fmt.Println()

	// Phase 1: System Information Discovery (T1082)
	fmt.Println("=== T1082: System Information Discovery ===")
	fmt.Println()

	systemInfo, err := performSystemDiscovery()
	if err != nil {
		fmt.Printf("[STAGE %d] System discovery failed: %v\n", STAGE_ID, err)
		LogMessage("ERROR", "T1082", fmt.Sprintf("System discovery failed: %v", err))

		if isBlockedError(err) {
			LogStageBlocked(STAGE_ID, "T1082", err.Error())
			os.Exit(StageBlocked)
		}

		LogStageEnd(STAGE_ID, "T1082", "error", err.Error())
		os.Exit(StageError)
	}

	fmt.Printf("[STAGE %d] System discovery completed\n", STAGE_ID)
	fmt.Println()

	// Phase 2: BitLocker Availability Check
	fmt.Println("=== BitLocker Availability Check ===")
	fmt.Println()

	bitlockerAvailable, err := checkBitLockerAvailability()
	if err != nil {
		fmt.Printf("[STAGE %d] BitLocker check failed: %v\n", STAGE_ID, err)
		LogMessage("ERROR", "T1082", fmt.Sprintf("BitLocker check failed: %v", err))

		if isBlockedError(err) {
			LogStageBlocked(STAGE_ID, "T1082", err.Error())
			os.Exit(StageBlocked)
		}
	}

	if !bitlockerAvailable {
		fmt.Printf("[STAGE %d] WARNING: BitLocker not available on this system\n", STAGE_ID)
		fmt.Printf("[STAGE %d] This may be Windows Home edition or BitLocker is disabled\n", STAGE_ID)
		LogMessage("WARNING", "T1082", "BitLocker not available - may be Windows Home edition")
		// Don't exit - Stage 3 will handle this gracefully
	} else {
		fmt.Printf("[STAGE %d] BitLocker is available on this system\n", STAGE_ID)
		LogMessage("INFO", "T1082", "BitLocker is available")
	}
	fmt.Println()

	// Phase 3: Drive Enumeration (T1083)
	fmt.Println("=== T1083: File and Directory Discovery ===")
	fmt.Println()

	drives, err := performDriveEnumeration()
	if err != nil {
		fmt.Printf("[STAGE %d] Drive enumeration failed: %v\n", STAGE_ID, err)
		LogMessage("ERROR", "T1083", fmt.Sprintf("Drive enumeration failed: %v", err))

		if isBlockedError(err) {
			LogStageBlocked(STAGE_ID, "T1083", err.Error())
			os.Exit(StageBlocked)
		}

		LogStageEnd(STAGE_ID, "T1083", "error", err.Error())
		os.Exit(StageError)
	}

	fmt.Printf("[STAGE %d] Drive enumeration completed\n", STAGE_ID)
	fmt.Println()

	// Phase 4: Create target volumes file
	fmt.Println("=== Creating Target Volumes File ===")
	fmt.Println()

	if err := createTargetVolumesFile(systemInfo, drives, bitlockerAvailable); err != nil {
		fmt.Printf("[STAGE %d] Failed to create target volumes file: %v\n", STAGE_ID, err)
		LogMessage("ERROR", "T1083", fmt.Sprintf("Failed to create target volumes file: %v", err))
		// Not fatal - continue
	} else {
		fmt.Println("  Created: C:\\F0\\target_volumes.txt")
		LogMessage("SUCCESS", "T1083", "Created target volumes file")
	}
	fmt.Println()

	// All techniques succeeded
	fmt.Printf("[STAGE %d] Discovery techniques completed successfully\n", STAGE_ID)
	LogMessage("SUCCESS", TECHNIQUE_IDS, "Discovery techniques executed successfully")
	LogStageEnd(STAGE_ID, "T1082", "success", "Discovery completed without prevention")
	os.Exit(StageSuccess)
}

// SystemInfo holds discovered system information
type SystemInfo struct {
	ComputerName  string
	OSName        string
	OSVersion     string
	OSArchitecture string
	Manufacturer  string
	Model         string
	Domain        string
}

// performSystemDiscovery gathers system information using wmic
func performSystemDiscovery() (*SystemInfo, error) {
	info := &SystemInfo{}

	fmt.Println("  [1/3] Querying computer system information...")

	// Query computer system
	cmd := exec.Command("wmic", "computersystem", "get", "Name,Manufacturer,Model,Domain", "/format:list")
	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	if err != nil {
		if isBlockedError(err) {
			return nil, fmt.Errorf("wmic blocked: %v", err)
		}
		fmt.Printf("        Warning: wmic computersystem failed: %v\n", err)
	} else {
		LogProcessExecution("wmic", "wmic computersystem get", 0, true, 0, outputStr)

		// Parse output
		for _, line := range strings.Split(outputStr, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "Name=") {
				info.ComputerName = strings.TrimPrefix(line, "Name=")
			} else if strings.HasPrefix(line, "Manufacturer=") {
				info.Manufacturer = strings.TrimPrefix(line, "Manufacturer=")
			} else if strings.HasPrefix(line, "Model=") {
				info.Model = strings.TrimPrefix(line, "Model=")
			} else if strings.HasPrefix(line, "Domain=") {
				info.Domain = strings.TrimPrefix(line, "Domain=")
			}
		}

		fmt.Printf("        Computer Name: %s\n", info.ComputerName)
		fmt.Printf("        Manufacturer: %s\n", info.Manufacturer)
		fmt.Printf("        Model: %s\n", info.Model)
		fmt.Printf("        Domain: %s\n", info.Domain)
	}

	fmt.Println("  [2/3] Querying operating system information...")

	// Query OS
	cmd = exec.Command("wmic", "os", "get", "Caption,Version,OSArchitecture", "/format:list")
	output, err = cmd.CombinedOutput()
	outputStr = string(output)

	if err != nil {
		if isBlockedError(err) {
			return nil, fmt.Errorf("wmic blocked: %v", err)
		}
		fmt.Printf("        Warning: wmic os failed: %v\n", err)
	} else {
		LogProcessExecution("wmic", "wmic os get", 0, true, 0, outputStr)

		// Parse output
		for _, line := range strings.Split(outputStr, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "Caption=") {
				info.OSName = strings.TrimPrefix(line, "Caption=")
			} else if strings.HasPrefix(line, "Version=") {
				info.OSVersion = strings.TrimPrefix(line, "Version=")
			} else if strings.HasPrefix(line, "OSArchitecture=") {
				info.OSArchitecture = strings.TrimPrefix(line, "OSArchitecture=")
			}
		}

		fmt.Printf("        OS Name: %s\n", info.OSName)
		fmt.Printf("        OS Version: %s\n", info.OSVersion)
		fmt.Printf("        Architecture: %s\n", info.OSArchitecture)
	}

	fmt.Println("  [3/3] Checking Windows edition...")

	// Check if this is Windows Pro/Enterprise (required for BitLocker)
	if strings.Contains(info.OSName, "Home") {
		fmt.Println("        WARNING: Windows Home edition detected - BitLocker may not be available")
		LogMessage("WARNING", "T1082", "Windows Home edition - BitLocker may not be available")
	} else if strings.Contains(info.OSName, "Pro") || strings.Contains(info.OSName, "Enterprise") {
		fmt.Println("        Windows Pro/Enterprise detected - BitLocker should be available")
		LogMessage("INFO", "T1082", "Windows Pro/Enterprise edition - BitLocker available")
	}

	LogMessage("SUCCESS", "T1082", fmt.Sprintf("System discovery completed: %s, %s", info.ComputerName, info.OSName))
	return info, nil
}

// checkBitLockerAvailability checks if BitLocker is available on this system
func checkBitLockerAvailability() (bool, error) {
	fmt.Println("  [1/2] Checking manage-bde availability...")

	// Check if manage-bde exists
	cmd := exec.Command("where", "manage-bde")
	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	if err != nil {
		fmt.Println("        manage-bde not found in PATH")
		LogProcessExecution("where", "where manage-bde", 0, false, 1, outputStr)
		return false, nil // Not an error, just not available
	}

	fmt.Printf("        manage-bde found: %s\n", strings.TrimSpace(outputStr))
	LogProcessExecution("where", "where manage-bde", 0, true, 0, outputStr)

	fmt.Println("  [2/2] Checking BitLocker status...")

	// Try to query BitLocker status
	cmd = exec.Command("manage-bde", "-status")
	output, err = cmd.CombinedOutput()
	outputStr = string(output)

	if err != nil {
		// Check if this is an access denied or blocked
		if isBlockedError(err) || strings.Contains(strings.ToLower(outputStr), "access denied") {
			return false, fmt.Errorf("manage-bde blocked: %v", err)
		}

		// Check for "not recognized" which means BitLocker not available
		if strings.Contains(strings.ToLower(outputStr), "not recognized") ||
			strings.Contains(strings.ToLower(outputStr), "not a valid command") {
			fmt.Println("        BitLocker is not available on this system")
			return false, nil
		}

		fmt.Printf("        manage-bde status returned error: %v\n", err)
		fmt.Printf("        Output: %s\n", outputStr)
	}

	LogProcessExecution("manage-bde", "manage-bde -status", 0, err == nil, 0, outputStr)

	// Check output for BitLocker availability indicators
	if strings.Contains(outputStr, "BitLocker Drive Encryption") ||
		strings.Contains(outputStr, "Volume") ||
		strings.Contains(outputStr, "Encryption Method") {
		fmt.Println("        BitLocker is available and responding")
		return true, nil
	}

	// If we get here, manage-bde exists but may not be fully functional
	fmt.Println("        BitLocker status uncertain - proceeding with caution")
	return true, nil
}

// DriveInfo holds information about a drive
type DriveInfo struct {
	DriveLetter string
	Size        string
	FreeSpace   string
	DriveType   string
	FileSystem  string
}

// performDriveEnumeration enumerates available drives
func performDriveEnumeration() ([]DriveInfo, error) {
	var drives []DriveInfo

	fmt.Println("  [1/2] Enumerating logical disks...")

	// Query logical disks using wmic
	cmd := exec.Command("wmic", "logicaldisk", "get", "DeviceID,Size,FreeSpace,DriveType,FileSystem", "/format:list")
	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	if err != nil {
		if isBlockedError(err) {
			return nil, fmt.Errorf("wmic logicaldisk blocked: %v", err)
		}
		fmt.Printf("        Warning: wmic logicaldisk failed: %v\n", err)
	} else {
		LogProcessExecution("wmic", "wmic logicaldisk get", 0, true, 0, outputStr)

		// Parse output - drives are separated by empty lines
		var currentDrive DriveInfo
		for _, line := range strings.Split(outputStr, "\n") {
			line = strings.TrimSpace(line)

			if line == "" {
				if currentDrive.DriveLetter != "" {
					drives = append(drives, currentDrive)
					currentDrive = DriveInfo{}
				}
				continue
			}

			if strings.HasPrefix(line, "DeviceID=") {
				currentDrive.DriveLetter = strings.TrimPrefix(line, "DeviceID=")
			} else if strings.HasPrefix(line, "Size=") {
				currentDrive.Size = strings.TrimPrefix(line, "Size=")
			} else if strings.HasPrefix(line, "FreeSpace=") {
				currentDrive.FreeSpace = strings.TrimPrefix(line, "FreeSpace=")
			} else if strings.HasPrefix(line, "DriveType=") {
				currentDrive.DriveType = strings.TrimPrefix(line, "DriveType=")
			} else if strings.HasPrefix(line, "FileSystem=") {
				currentDrive.FileSystem = strings.TrimPrefix(line, "FileSystem=")
			}
		}

		// Don't forget the last drive
		if currentDrive.DriveLetter != "" {
			drives = append(drives, currentDrive)
		}
	}

	fmt.Println("  [2/2] Found drives:")
	for _, drive := range drives {
		driveTypeStr := getDriveTypeString(drive.DriveType)
		fmt.Printf("        %s - Type: %s, FileSystem: %s\n", drive.DriveLetter, driveTypeStr, drive.FileSystem)
	}

	LogMessage("SUCCESS", "T1083", fmt.Sprintf("Enumerated %d drives", len(drives)))
	return drives, nil
}

// getDriveTypeString converts drive type number to string
func getDriveTypeString(driveType string) string {
	switch driveType {
	case "0":
		return "Unknown"
	case "1":
		return "No Root Directory"
	case "2":
		return "Removable"
	case "3":
		return "Local Disk"
	case "4":
		return "Network"
	case "5":
		return "CD-ROM"
	case "6":
		return "RAM Disk"
	default:
		return driveType
	}
}

// createTargetVolumesFile creates a file with discovered target information
func createTargetVolumesFile(sysInfo *SystemInfo, drives []DriveInfo, bitlockerAvailable bool) error {
	targetDir := "c:\\F0"
	filePath := filepath.Join(targetDir, "target_volumes.txt")

	var content strings.Builder

	content.WriteString("=== F0RT1KA Ransomware Simulation - Target Discovery ===\n\n")
	content.WriteString(fmt.Sprintf("Timestamp: %s\n", ""))
	content.WriteString(fmt.Sprintf("Test UUID: %s\n\n", TEST_UUID))

	content.WriteString("=== System Information ===\n")
	if sysInfo != nil {
		content.WriteString(fmt.Sprintf("Computer Name: %s\n", sysInfo.ComputerName))
		content.WriteString(fmt.Sprintf("OS: %s %s (%s)\n", sysInfo.OSName, sysInfo.OSVersion, sysInfo.OSArchitecture))
		content.WriteString(fmt.Sprintf("Manufacturer: %s\n", sysInfo.Manufacturer))
		content.WriteString(fmt.Sprintf("Model: %s\n", sysInfo.Model))
		content.WriteString(fmt.Sprintf("Domain: %s\n", sysInfo.Domain))
	}
	content.WriteString("\n")

	content.WriteString("=== BitLocker Status ===\n")
	if bitlockerAvailable {
		content.WriteString("BitLocker: AVAILABLE\n")
	} else {
		content.WriteString("BitLocker: NOT AVAILABLE\n")
	}
	content.WriteString("\n")

	content.WriteString("=== Discovered Volumes ===\n")
	for _, drive := range drives {
		driveTypeStr := getDriveTypeString(drive.DriveType)
		content.WriteString(fmt.Sprintf("Drive: %s\n", drive.DriveLetter))
		content.WriteString(fmt.Sprintf("  Type: %s\n", driveTypeStr))
		content.WriteString(fmt.Sprintf("  FileSystem: %s\n", drive.FileSystem))
		content.WriteString(fmt.Sprintf("  Size: %s bytes\n", drive.Size))
		content.WriteString(fmt.Sprintf("  Free: %s bytes\n", drive.FreeSpace))
		content.WriteString("\n")
	}

	content.WriteString("=== Ransomware Attack Plan ===\n")
	content.WriteString("NOTE: This is a SIMULATION - actual attack uses isolated VHD\n")
	content.WriteString("Target: 100MB VHD at C:\\F0\\bitlocker_test.vhd\n")
	content.WriteString("Method: BitLocker encryption with password\n")
	content.WriteString("Recovery Inhibition: VSS shadow deletion (VHD only)\n")

	err := os.WriteFile(filePath, []byte(content.String()), 0644)
	if err != nil {
		return fmt.Errorf("failed to write target volumes file: %v", err)
	}

	LogFileDropped("target_volumes.txt", filePath, int64(content.Len()), false)
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
