//go:build windows
// +build windows

/*
mde_process_watchdog.go - Watchdog process for memory patch safety
SECURITY TESTING ONLY - Monitors test execution and ensures memory restoration

This watchdog:
- Monitors test process for crashes or timeouts
- Reads patch backup information
- Automatically restores original bytes if test fails
- Provides emergency recovery mechanism

Usage: mde_process_watchdog.exe <test-pid> [--timeout 300]
*/

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

type WatchdogConfig struct {
	TestPID        uint32        `json:"testPid"`
	TimeoutSeconds int           `json:"timeoutSeconds"`
	CheckInterval  time.Duration `json:"checkInterval"`
}

type PatchBackupFile struct {
	ProcessName     string    `json:"processName"`
	ProcessPID      uint32    `json:"processPid"`
	FunctionAddress string    `json:"functionAddress"` // Hex string
	OriginalBytes   string    `json:"originalBytes"`   // Hex encoded
	PatchSize       int       `json:"patchSize"`
	Timestamp       time.Time `json:"timestamp"`
}

type WatchdogState struct {
	Status          string    `json:"status"` // monitoring, restoring, completed
	TestPID         uint32    `json:"testPid"`
	TestRunning     bool      `json:"testRunning"`
	PatchesRestored bool      `json:"patchesRestored"`
	LastCheck       time.Time `json:"lastCheck"`
	ErrorMessage    string    `json:"errorMessage,omitempty"`
}

var (
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	procReadProcessMemory  = kernel32.NewProc("ReadProcessMemory")
	procWriteProcessMemory = kernel32.NewProc("WriteProcessMemory")
)

func main() {
	fmt.Println("=== MDE Process Watchdog ===")
	fmt.Println("Safety monitor for memory patch testing")
	fmt.Println()

	// Parse arguments
	if len(os.Args) < 2 {
		fmt.Println("Usage: mde_process_watchdog.exe <test-pid> [--timeout seconds]")
		fmt.Println("Example: mde_process_watchdog.exe 1234 --timeout 300")
		os.Exit(1)
	}

	testPID, err := strconv.ParseUint(os.Args[1], 10, 32)
	if err != nil {
		fmt.Printf("Invalid PID: %v\n", err)
		os.Exit(1)
	}

	config := WatchdogConfig{
		TestPID:        uint32(testPID),
		TimeoutSeconds: 300, // 5 minutes default
		CheckInterval:  2 * time.Second,
	}

	// Parse optional timeout
	if len(os.Args) > 2 && os.Args[2] == "--timeout" && len(os.Args) > 3 {
		timeout, err := strconv.Atoi(os.Args[3])
		if err == nil {
			config.TimeoutSeconds = timeout
		}
	}

	fmt.Printf("Monitoring test process PID %d\n", config.TestPID)
	fmt.Printf("Timeout: %d seconds\n", config.TimeoutSeconds)
	fmt.Printf("Check interval: %v\n", config.CheckInterval)
	fmt.Println()

	// Initialize state
	state := &WatchdogState{
		Status:          "monitoring",
		TestPID:         config.TestPID,
		TestRunning:     true,
		PatchesRestored: false,
	}

	// Start monitoring loop
	startTime := time.Now()
	ticker := time.NewTicker(config.CheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			state.LastCheck = time.Now()

			// Check if test process is still running
			processRunning := isProcessRunning(config.TestPID)
			state.TestRunning = processRunning

			// Check for timeout
			elapsed := time.Since(startTime).Seconds()
			timedOut := elapsed > float64(config.TimeoutSeconds)

			// Determine if we need to restore
			needRestore := false
			reason := ""

			if !processRunning {
				needRestore = true
				reason = "Test process terminated"
				fmt.Printf("[%s] Test process no longer running\n", time.Now().Format("15:04:05"))
			} else if timedOut {
				needRestore = true
				reason = "Timeout exceeded"
				fmt.Printf("[%s] Timeout of %d seconds exceeded\n", time.Now().Format("15:04:05"), config.TimeoutSeconds)
			}

			// Restore if needed
			if needRestore && !state.PatchesRestored {
				fmt.Printf("[%s] Initiating restoration: %s\n", time.Now().Format("15:04:05"), reason)
				state.Status = "restoring"
				saveState(state)

				err := restoreAllPatches()
				if err != nil {
					fmt.Printf("[ERROR] Restoration failed: %v\n", err)
					state.ErrorMessage = err.Error()
				} else {
					fmt.Printf("[SUCCESS] Patches restored successfully\n")
					state.PatchesRestored = true
				}

				state.Status = "completed"
				saveState(state)

				// Exit watchdog
				fmt.Println("Watchdog completed. Exiting.")
				return
			}

			// Normal operation - update state
			saveState(state)

			// Exit if test completed normally
			if !processRunning {
				fmt.Println("Test process completed normally.")
				return
			}
		}
	}
}

// isProcessRunning checks if a process with given PID is running
func isProcessRunning(pid uint32) bool {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_INFORMATION, false, pid)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(handle)

	var exitCode uint32
	err = windows.GetExitCodeProcess(handle, &exitCode)
	if err != nil {
		return false
	}

	// STILL_ACTIVE = 259
	return exitCode == 259
}

// restoreAllPatches reads backup file and restores memory patches
func restoreAllPatches() error {
	backupPath := filepath.Join("c:\\F0", "patch_backup.json")

	// Check if backup file exists
	if _, err := os.Stat(backupPath); os.IsNotExist(err) {
		return fmt.Errorf("no patch backup file found at %s", backupPath)
	}

	// Read backup file
	data, err := os.ReadFile(backupPath)
	if err != nil {
		return fmt.Errorf("failed to read backup file: %v", err)
	}

	var backup PatchBackupFile
	if err := json.Unmarshal(data, &backup); err != nil {
		return fmt.Errorf("failed to parse backup file: %v", err)
	}

	fmt.Printf("Found patch backup:\n")
	fmt.Printf("  Process: %s (PID %d)\n", backup.ProcessName, backup.ProcessPID)
	fmt.Printf("  Function: %s\n", backup.FunctionAddress)
	fmt.Printf("  Patch size: %d bytes\n", backup.PatchSize)
	fmt.Printf("  Applied: %s\n", backup.Timestamp.Format("2006-01-02 15:04:05"))

	// Open target process
	handle, err := windows.OpenProcess(windows.PROCESS_VM_WRITE|windows.PROCESS_VM_OPERATION, false, backup.ProcessPID)
	if err != nil {
		return fmt.Errorf("failed to open process %d: %v", backup.ProcessPID, err)
	}
	defer windows.CloseHandle(handle)

	// Parse address (hex string to uintptr)
	var funcAddr uintptr
	fmt.Sscanf(backup.FunctionAddress, "0x%X", &funcAddr)

	// Decode original bytes (hex string to bytes)
	originalBytes := make([]byte, 0)
	for i := 0; i < len(backup.OriginalBytes); i += 2 {
		var b byte
		fmt.Sscanf(backup.OriginalBytes[i:i+2], "%02X", &b)
		originalBytes = append(originalBytes, b)
	}

	// Write original bytes back
	err = writeProcessMemory(handle, funcAddr, originalBytes)
	if err != nil {
		return fmt.Errorf("failed to write original bytes: %v", err)
	}

	// Verify restoration
	verifyBytes, err := readProcessMemory(handle, funcAddr, len(originalBytes))
	if err != nil {
		return fmt.Errorf("restoration succeeded but verification failed: %v", err)
	}

	// Compare bytes
	for i := range originalBytes {
		if verifyBytes[i] != originalBytes[i] {
			return fmt.Errorf("restoration verification failed at byte %d", i)
		}
	}

	fmt.Println("Restoration verified successfully!")

	// Delete backup file to prevent double-restoration
	os.Remove(backupPath)

	return nil
}

// writeProcessMemory writes bytes to target process memory
func writeProcessMemory(handle windows.Handle, address uintptr, data []byte) error {
	var bytesWritten uintptr

	ret, _, err := procWriteProcessMemory.Call(
		uintptr(handle),
		address,
		uintptr(unsafe.Pointer(&data[0])),
		uintptr(len(data)),
		uintptr(unsafe.Pointer(&bytesWritten)),
	)

	if ret == 0 {
		return fmt.Errorf("WriteProcessMemory failed: %v", err)
	}

	if bytesWritten != uintptr(len(data)) {
		return fmt.Errorf("wrote %d bytes, expected %d", bytesWritten, len(data))
	}

	return nil
}

// readProcessMemory reads bytes from target process memory
func readProcessMemory(handle windows.Handle, address uintptr, size int) ([]byte, error) {
	buffer := make([]byte, size)
	var bytesRead uintptr

	ret, _, err := procReadProcessMemory.Call(
		uintptr(handle),
		address,
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(size),
		uintptr(unsafe.Pointer(&bytesRead)),
	)

	if ret == 0 {
		return nil, fmt.Errorf("ReadProcessMemory failed: %v", err)
	}

	return buffer, nil
}

// saveState saves watchdog state to disk for monitoring
func saveState(state *WatchdogState) error {
	statePath := filepath.Join("c:\\F0", "watchdog_state.json")

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(statePath, data, 0644)
}
