// cert_bypass_watchdog.go - Safety watchdog for certificate pinning bypass test
// This process monitors the main test and ensures memory is restored if test is terminated
// Build: go build -o cert_bypass_watchdog.exe cert_bypass_watchdog.go

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

const (
	PROCESS_VM_READ           = 0x0010
	PROCESS_VM_WRITE          = 0x0020
	PROCESS_VM_OPERATION      = 0x0008
	PROCESS_QUERY_INFORMATION = 0x0400
	PAGE_EXECUTE_READWRITE    = 0x40
)

var (
	kernel32                  = syscall.NewLazyDLL("kernel32.dll")
	procOpenProcess           = kernel32.NewProc("OpenProcess")
	procReadProcessMemory     = kernel32.NewProc("ReadProcessMemory")
	procWriteProcessMemory    = kernel32.NewProc("WriteProcessMemory")
	procVirtualProtectEx      = kernel32.NewProc("VirtualProtectEx")
	procGetModuleHandle       = kernel32.NewProc("GetModuleHandleW")
	procGetProcAddress        = kernel32.NewProc("GetProcAddress")
	procWaitForSingleObject   = kernel32.NewProc("WaitForSingleObject")
)

// PatchState stores information about memory patches that need restoration
type PatchState struct {
	ProcessID       uint32    `json:"processId"`
	ProcessName     string    `json:"processName"`
	TargetDLL       string    `json:"targetDll"`
	TargetFunction  string    `json:"targetFunction"`
	TargetAddress   uintptr   `json:"targetAddress"`
	OriginalBytes   []byte    `json:"originalBytes"`
	PatchApplied    bool      `json:"patchApplied"`
	Timestamp       time.Time `json:"timestamp"`
	RequiresRestore bool      `json:"requiresRestore"`
}

// WatchdogState tracks overall watchdog status
type WatchdogState struct {
	WatchdogPID     uint32        `json:"watchdogPid"`
	MonitoredPID    uint32        `json:"monitoredPid"`
	StartTime       time.Time     `json:"startTime"`
	LastCheck       time.Time     `json:"lastCheck"`
	CheckInterval   int           `json:"checkInterval"`
	Patches         []PatchState  `json:"patches"`
	AutoRestoreTime int           `json:"autoRestoreTime"`
	Status          string        `json:"status"`
}

func main() {
	fmt.Println("========================================")
	fmt.Println("F0RT1KA Certificate Bypass Watchdog")
	fmt.Println("========================================")
	fmt.Println("Purpose: Monitor and restore memory patches if test is terminated")
	fmt.Println()

	if len(os.Args) < 2 {
		fmt.Println("Usage: cert_bypass_watchdog.exe <monitored-pid> [options]")
		fmt.Println()
		fmt.Println("Options:")
		fmt.Println("  --state-file <file>    Path to state file (default: C:\\F0\\watchdog_state.json)")
		fmt.Println("  --check-interval <sec> Check interval in seconds (default: 2)")
		fmt.Println("  --auto-restore <sec>   Auto-restore after N seconds (default: 300)")
		fmt.Println()
		fmt.Println("Example:")
		fmt.Println("  cert_bypass_watchdog.exe 1234 --state-file C:\\F0\\state.json")
		os.Exit(1)
	}

	var monitoredPID uint32
	fmt.Sscanf(os.Args[1], "%d", &monitoredPID)

	stateFile := "C:\\F0\\watchdog_state.json"
	checkInterval := 2
	autoRestoreTime := 300 // 5 minutes

	// Parse additional arguments
	for i := 2; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--state-file":
			if i+1 < len(os.Args) {
				stateFile = os.Args[i+1]
				i++
			}
		case "--check-interval":
			if i+1 < len(os.Args) {
				fmt.Sscanf(os.Args[i+1], "%d", &checkInterval)
				i++
			}
		case "--auto-restore":
			if i+1 < len(os.Args) {
				fmt.Sscanf(os.Args[i+1], "%d", &autoRestoreTime)
				i++
			}
		}
	}

	fmt.Printf("[*] Monitoring PID: %d\n", monitoredPID)
	fmt.Printf("[*] State file: %s\n", stateFile)
	fmt.Printf("[*] Check interval: %d seconds\n", checkInterval)
	fmt.Printf("[*] Auto-restore after: %d seconds\n", autoRestoreTime)
	fmt.Println()

	// Initialize watchdog state
	state := WatchdogState{
		WatchdogPID:     uint32(os.Getpid()),
		MonitoredPID:    monitoredPID,
		StartTime:       time.Now(),
		LastCheck:       time.Now(),
		CheckInterval:   checkInterval,
		AutoRestoreTime: autoRestoreTime,
		Patches:         []PatchState{},
		Status:          "MONITORING",
	}

	// Save initial state
	saveState(&state, stateFile)

	// Start monitoring loop
	fmt.Println("[+] Watchdog active - monitoring for issues...")
	fmt.Println("[*] Press Ctrl+C to stop watchdog and restore patches")
	fmt.Println()

	ticker := time.NewTicker(time.Duration(checkInterval) * time.Second)
	defer ticker.Stop()

	startTime := time.Now()

	for {
		select {
		case <-ticker.C:
			// Update state
			state.LastCheck = time.Now()
			state.Status = "MONITORING"

			// Load current patch state from file
			loadPatchState(&state, stateFile)

			// Check if monitored process is still running
			processHandle, err := openProcess(monitoredPID)
			if err != nil {
				fmt.Printf("[!] WARNING: Monitored process (PID %d) is no longer accessible\n", monitoredPID)
				fmt.Println("[!] Process may have been terminated by EDR/AV")
				fmt.Println("[*] Initiating emergency restoration...")

				state.Status = "RESTORING"
				saveState(&state, stateFile)

				performEmergencyRestore(&state, stateFile)
				return
			}
			syscall.CloseHandle(processHandle)

			// Check for auto-restore timeout
			elapsed := time.Since(startTime).Seconds()
			if int(elapsed) >= autoRestoreTime {
				fmt.Printf("[!] Auto-restore timeout reached (%d seconds)\n", autoRestoreTime)
				fmt.Println("[*] Initiating scheduled restoration...")

				state.Status = "AUTO_RESTORING"
				saveState(&state, stateFile)

				performScheduledRestore(&state, stateFile)
				return
			}

			// Check if manual restore requested
			if checkManualRestoreRequest(stateFile) {
				fmt.Println("[*] Manual restore requested via state file")

				state.Status = "MANUAL_RESTORING"
				saveState(&state, stateFile)

				performManualRestore(&state, stateFile)
				return
			}

			// Regular status update
			remainingTime := autoRestoreTime - int(elapsed)
			fmt.Printf("[%s] Process OK | Patches: %d | Auto-restore in: %ds\n",
				time.Now().Format("15:04:05"),
				len(state.Patches),
				remainingTime)

			saveState(&state, stateFile)
		}
	}
}

func openProcess(pid uint32) (syscall.Handle, error) {
	access := PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_VM_OPERATION | PROCESS_QUERY_INFORMATION
	r1, _, err := procOpenProcess.Call(
		uintptr(access),
		uintptr(0),
		uintptr(pid),
	)

	if r1 == 0 {
		return 0, err
	}

	return syscall.Handle(r1), nil
}

func loadPatchState(state *WatchdogState, stateFile string) error {
	data, err := os.ReadFile(stateFile)
	if err != nil {
		return err
	}

	var loadedState WatchdogState
	if err := json.Unmarshal(data, &loadedState); err != nil {
		return err
	}

	// Update patches from loaded state
	state.Patches = loadedState.Patches
	return nil
}

func saveState(state *WatchdogState, stateFile string) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}

	// Ensure directory exists
	dir := filepath.Dir(stateFile)
	os.MkdirAll(dir, 0755)

	return os.WriteFile(stateFile, data, 0644)
}

func checkManualRestoreRequest(stateFile string) bool {
	restoreRequestFile := filepath.Join(filepath.Dir(stateFile), "RESTORE_NOW.flag")
	_, err := os.Stat(restoreRequestFile)
	return err == nil
}

func performEmergencyRestore(state *WatchdogState, stateFile string) {
	fmt.Println()
	fmt.Println("========================================")
	fmt.Println("EMERGENCY RESTORATION PROCEDURE")
	fmt.Println("========================================")
	fmt.Println()

	if len(state.Patches) == 0 {
		fmt.Println("[*] No patches recorded - nothing to restore")
		state.Status = "COMPLETED_NO_PATCHES"
		saveState(state, stateFile)
		return
	}

	fmt.Printf("[*] Found %d patch(es) that may need restoration\n", len(state.Patches))
	fmt.Println()

	restored := 0
	failed := 0

	for i, patch := range state.Patches {
		if !patch.RequiresRestore {
			fmt.Printf("[%d/%d] Patch to %s!%s - Already restored, skipping\n",
				i+1, len(state.Patches), patch.TargetDLL, patch.TargetFunction)
			continue
		}

		fmt.Printf("[%d/%d] Restoring patch to %s!%s...\n",
			i+1, len(state.Patches), patch.TargetDLL, patch.TargetFunction)

		// Try to restore via process memory (if process still exists)
		success := false
		if patch.ProcessID > 0 {
			success = restorePatchViaProcess(patch)
		}

		// If process restore failed, try system-wide restore
		if !success {
			fmt.Println("    [*] Process restore failed, attempting system-wide restore...")
			success = restorePatchSystemWide(patch)
		}

		if success {
			fmt.Println("    [+] Restoration successful")
			state.Patches[i].RequiresRestore = false
			state.Patches[i].PatchApplied = false
			restored++
		} else {
			fmt.Println("    [!] Restoration failed")
			failed++
		}
	}

	fmt.Println()
	fmt.Println("========================================")
	fmt.Printf("RESTORATION SUMMARY: %d restored, %d failed\n", restored, failed)
	fmt.Println("========================================")

	if failed > 0 {
		state.Status = "PARTIAL_RESTORE"
		fmt.Println()
		fmt.Println("[!] WARNING: Some patches could not be restored")
		fmt.Println("[!] RECOMMENDED: Restart affected services or reboot system")
		fmt.Println()
		fmt.Println("To restart MDE sensor:")
		fmt.Println("  sc stop sense")
		fmt.Println("  sc start sense")
	} else {
		state.Status = "FULLY_RESTORED"
		fmt.Println()
		fmt.Println("[+] All patches successfully restored")
		fmt.Println("[+] System should be in original state")
	}

	saveState(state, stateFile)

	// Create restoration report
	createRestorationReport(state, restored, failed)
}

func performScheduledRestore(state *WatchdogState, stateFile string) {
	fmt.Println()
	fmt.Println("========================================")
	fmt.Println("SCHEDULED RESTORATION (AUTO-RESTORE)")
	fmt.Println("========================================")
	performEmergencyRestore(state, stateFile)
}

func performManualRestore(state *WatchdogState, stateFile string) {
	fmt.Println()
	fmt.Println("========================================")
	fmt.Println("MANUAL RESTORATION (USER REQUESTED)")
	fmt.Println("========================================")
	performEmergencyRestore(state, stateFile)
}

func restorePatchViaProcess(patch PatchState) bool {
	// Open target process
	processHandle, err := openProcess(patch.ProcessID)
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(processHandle)

	// Change memory protection to writable
	var oldProtect uint32
	r1, _, _ := procVirtualProtectEx.Call(
		uintptr(processHandle),
		patch.TargetAddress,
		uintptr(len(patch.OriginalBytes)),
		uintptr(PAGE_EXECUTE_READWRITE),
		uintptr(unsafe.Pointer(&oldProtect)),
	)

	if r1 == 0 {
		return false
	}

	// Write original bytes back
	var bytesWritten uintptr
	r1, _, _ = procWriteProcessMemory.Call(
		uintptr(processHandle),
		patch.TargetAddress,
		uintptr(unsafe.Pointer(&patch.OriginalBytes[0])),
		uintptr(len(patch.OriginalBytes)),
		uintptr(unsafe.Pointer(&bytesWritten)),
	)

	if r1 == 0 {
		return false
	}

	// Restore original protection
	procVirtualProtectEx.Call(
		uintptr(processHandle),
		patch.TargetAddress,
		uintptr(len(patch.OriginalBytes)),
		uintptr(oldProtect),
		uintptr(unsafe.Pointer(&oldProtect)),
	)

	return bytesWritten == uintptr(len(patch.OriginalBytes))
}

func restorePatchSystemWide(patch PatchState) bool {
	// This attempts to restore the function in our own process space
	// as a fallback if the target process is no longer accessible

	// Get handle to the DLL in current process
	dllName, _ := syscall.UTF16PtrFromString(patch.TargetDLL)
	r1, _, _ := procGetModuleHandle.Call(uintptr(unsafe.Pointer(dllName)))

	if r1 == 0 {
		// DLL not loaded in our process
		return false
	}

	dllHandle := syscall.Handle(r1)

	// Get address of function
	funcName, _ := syscall.BytePtrFromString(patch.TargetFunction)
	r1, _, _ = procGetProcAddress.Call(
		uintptr(dllHandle),
		uintptr(unsafe.Pointer(funcName)),
	)

	if r1 == 0 {
		return false
	}

	funcAddr := uintptr(r1)

	// Note: This will only restore in OUR process, not system-wide
	// True system-wide restore would require kernel driver or reboot
	fmt.Printf("    [*] Function address in watchdog process: 0x%X\n", funcAddr)
	fmt.Println("    [*] Note: System-wide restore not possible without kernel access")
	fmt.Println("    [*] Restoration affects watchdog process only")

	return false // Return false to indicate incomplete restoration
}

func createRestorationReport(state *WatchdogState, restored int, failed int) {
	reportFile := filepath.Join(filepath.Dir("C:\\F0\\watchdog_state.json"), "restoration_report.txt")

	report := fmt.Sprintf(`F0RT1KA Certificate Bypass Watchdog - Restoration Report
============================================================

Watchdog PID: %d
Monitored PID: %d
Start Time: %s
Restoration Time: %s
Duration: %s

Patches Summary:
  Total Patches: %d
  Successfully Restored: %d
  Failed to Restore: %d

Overall Status: %s

Detailed Patch Information:
`, state.WatchdogPID, state.MonitoredPID,
		state.StartTime.Format("2006-01-02 15:04:05"),
		time.Now().Format("2006-01-02 15:04:05"),
		time.Since(state.StartTime).String(),
		len(state.Patches), restored, failed, state.Status)

	for i, patch := range state.Patches {
		report += fmt.Sprintf(`
Patch #%d:
  Target: %s!%s
  Address: 0x%X
  Original Bytes: %d bytes
  Applied: %v
  Restored: %v
  Timestamp: %s
`, i+1, patch.TargetDLL, patch.TargetFunction,
			patch.TargetAddress, len(patch.OriginalBytes),
			patch.PatchApplied, !patch.RequiresRestore,
			patch.Timestamp.Format("2006-01-02 15:04:05"))
	}

	if failed > 0 {
		report += `
RECOMMENDATIONS:
- System may be in inconsistent state
- Restart affected services or reboot recommended
- Check EDR/AV logs for termination details

To restart Microsoft Defender for Endpoint:
  sc stop sense
  sc start sense

Or reboot the system for complete restoration.
`
	}

	os.WriteFile(reportFile, []byte(report), 0644)
	fmt.Printf("\n[*] Restoration report saved to: %s\n", reportFile)
}
