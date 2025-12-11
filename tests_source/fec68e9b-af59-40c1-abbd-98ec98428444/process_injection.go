//go:build windows
// +build windows

/*
process_injection.go - Process enumeration and handle acquisition for MDE security testing
SECURITY TESTING ONLY - Authorized security testing in controlled lab environments

This module provides functions to:
- Enumerate running MDE processes (MsSense.exe, SenseIR.exe)
- Attempt handle acquisition with various privilege levels
- Enumerate process memory regions
- Locate loaded modules (CRYPT32.dll)
- Resolve function addresses for patching tests
*/

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows API constants
const (
	PROCESS_QUERY_INFORMATION = 0x0400
	PROCESS_VM_READ           = 0x0010
	PROCESS_VM_WRITE          = 0x0020
	PROCESS_VM_OPERATION      = 0x0008
	PROCESS_CREATE_THREAD     = 0x0002
	PROCESS_ALL_ACCESS        = windows.STANDARD_RIGHTS_REQUIRED | windows.SYNCHRONIZE | 0xFFFF

	TH32CS_SNAPPROCESS = 0x00000002
	TH32CS_SNAPMODULE  = 0x00000008
	TH32CS_SNAPMODULE32 = 0x00000010

	MAX_MODULE_NAME32 = 255
	MAX_PATH          = 260
)

// Process information structure
type ProcessInfo struct {
	ProcessName    string `json:"processName"`
	PID            uint32 `json:"pid"`
	ParentPID      uint32 `json:"parentPid"`
	ExecutablePath string `json:"executablePath"`
	Found          bool   `json:"found"`
	Architecture   string `json:"architecture"` // x64 or x86
}

// Handle acquisition result
type HandleResult struct {
	AccessLevel   string        `json:"accessLevel"`
	AccessFlags   uint32        `json:"accessFlags"`
	Handle        windows.Handle `json:"-"` // Don't serialize handle
	HandleValue   uintptr       `json:"handleValue"`
	Success       bool          `json:"success"`
	ErrorCode     uint32        `json:"errorCode,omitempty"`
	ErrorMessage  string        `json:"errorMessage,omitempty"`
	Blocked       bool          `json:"blocked"`
	BlockedBy     string        `json:"blockedBy,omitempty"`
}

// Module information
type ModuleInfo struct {
	ModuleName  string   `json:"moduleName"`
	BaseAddress uintptr  `json:"baseAddress"`
	Size        uint32   `json:"size"`
	Path        string   `json:"path"`
}

// Memory region information
type MemoryRegion struct {
	BaseAddress  uintptr `json:"baseAddress"`
	Size         uint64  `json:"size"`
	State        uint32  `json:"state"`
	Protect      uint32  `json:"protect"`
	Type         uint32  `json:"type"`
}

// Process enumeration report
type ProcessEnumReport struct {
	MsSenseProcess    *ProcessInfo   `json:"msSenseProcess"`
	SenseIRProcess    *ProcessInfo   `json:"senseIRProcess,omitempty"`
	ProcessesScanned  int            `json:"processesScanned"`
	EnumerationSuccess bool          `json:"enumerationSuccess"`
	ErrorMessage      string         `json:"errorMessage,omitempty"`
}

// Process injection report (saved to disk)
type ProcessInjectionReport struct {
	TargetProcess    ProcessInfo     `json:"targetProcess"`
	HandleAttempts   []HandleResult  `json:"handleAttempts"`
	ModulesEnumerated []ModuleInfo   `json:"modulesEnumerated,omitempty"`
	MemoryRegions    []MemoryRegion  `json:"memoryRegions,omitempty"`
	OverallSuccess   bool            `json:"overallSuccess"`
	BlockedByEDR     bool            `json:"blockedByEDR"`
}

// Windows API functions
var (
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	psapi    = windows.NewLazySystemDLL("psapi.dll")

	procCreateToolhelp32Snapshot = kernel32.NewProc("CreateToolhelp32Snapshot")
	procProcess32First           = kernel32.NewProc("Process32FirstW")
	procProcess32Next            = kernel32.NewProc("Process32NextW")
	procModule32First            = kernel32.NewProc("Module32FirstW")
	procModule32Next             = kernel32.NewProc("Module32NextW")
	procQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
	procIsWow64Process           = kernel32.NewProc("IsWow64Process")
)

// PROCESSENTRY32 structure
type PROCESSENTRY32 struct {
	Size              uint32
	Usage             uint32
	ProcessID         uint32
	DefaultHeapID     uintptr
	ModuleID          uint32
	Threads           uint32
	ParentProcessID   uint32
	PriorityClassBase int32
	Flags             uint32
	ExeFile           [MAX_PATH]uint16
}

// MODULEENTRY32 structure
type MODULEENTRY32 struct {
	Size         uint32
	ModuleID     uint32
	ProcessID    uint32
	GlblcntUsage uint32
	ProccntUsage uint32
	ModBaseAddr  uintptr
	ModBaseSize  uint32
	HModule      windows.Handle
	SzModule     [MAX_MODULE_NAME32 + 1]uint16
	SzExePath    [MAX_PATH]uint16
}

// EnumerateMDEProcesses finds running MDE processes
func EnumerateMDEProcesses() *ProcessEnumReport {
	report := &ProcessEnumReport{
		ProcessesScanned:   0,
		EnumerationSuccess: false,
	}

	// Create snapshot of all processes
	snapshot, _, err := procCreateToolhelp32Snapshot.Call(TH32CS_SNAPPROCESS, 0)
	if snapshot == 0 {
		report.ErrorMessage = fmt.Sprintf("CreateToolhelp32Snapshot failed: %v", err)
		return report
	}
	defer windows.CloseHandle(windows.Handle(snapshot))

	var pe32 PROCESSENTRY32
	pe32.Size = uint32(unsafe.Sizeof(pe32))

	// Get first process
	ret, _, _ := procProcess32First.Call(snapshot, uintptr(unsafe.Pointer(&pe32)))
	if ret == 0 {
		report.ErrorMessage = "Process32First failed"
		return report
	}

	// Iterate through processes
	for {
		report.ProcessesScanned++
		exeName := windows.UTF16ToString(pe32.ExeFile[:])

		// Check for MsSense.exe
		if strings.EqualFold(exeName, "MsSense.exe") {
			report.MsSenseProcess = &ProcessInfo{
				ProcessName:  exeName,
				PID:          pe32.ProcessID,
				ParentPID:    pe32.ParentProcessID,
				Found:        true,
			}

			// Get full path and architecture
			if path := getProcessPath(pe32.ProcessID); path != "" {
				report.MsSenseProcess.ExecutablePath = path
			}
			report.MsSenseProcess.Architecture = getProcessArchitecture(pe32.ProcessID)
		}

		// Check for SenseIR.exe
		if strings.EqualFold(exeName, "SenseIR.exe") {
			report.SenseIRProcess = &ProcessInfo{
				ProcessName:  exeName,
				PID:          pe32.ProcessID,
				ParentPID:    pe32.ParentProcessID,
				Found:        true,
			}

			if path := getProcessPath(pe32.ProcessID); path != "" {
				report.SenseIRProcess.ExecutablePath = path
			}
			report.SenseIRProcess.Architecture = getProcessArchitecture(pe32.ProcessID)
		}

		// Get next process
		ret, _, _ = procProcess32Next.Call(snapshot, uintptr(unsafe.Pointer(&pe32)))
		if ret == 0 {
			break
		}
	}

	report.EnumerationSuccess = report.MsSenseProcess != nil
	return report
}

// getProcessPath retrieves full executable path for a process
func getProcessPath(pid uint32) string {
	handle, err := windows.OpenProcess(PROCESS_QUERY_INFORMATION|PROCESS_VM_READ, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(handle)

	var buf [MAX_PATH]uint16
	size := uint32(MAX_PATH)
	ret, _, _ := procQueryFullProcessImageNameW.Call(
		uintptr(handle),
		0, // WIN32 format
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
	)

	if ret == 0 {
		return ""
	}

	return windows.UTF16ToString(buf[:size])
}

// getProcessArchitecture determines if process is x64 or x86
func getProcessArchitecture(pid uint32) string {
	handle, err := windows.OpenProcess(PROCESS_QUERY_INFORMATION, false, pid)
	if err != nil {
		return "unknown"
	}
	defer windows.CloseHandle(handle)

	var isWow64 bool
	ret, _, _ := procIsWow64Process.Call(uintptr(handle), uintptr(unsafe.Pointer(&isWow64)))
	if ret == 0 {
		return "unknown"
	}

	if isWow64 {
		return "x86" // 32-bit process on 64-bit Windows
	}
	return "x64" // 64-bit process
}

// AttemptHandleAcquisition tries to open process with specified access rights
func AttemptHandleAcquisition(pid uint32, accessLevel string, accessFlags uint32) HandleResult {
	result := HandleResult{
		AccessLevel: accessLevel,
		AccessFlags: accessFlags,
		Success:     false,
		Blocked:     false,
	}

	handle, err := windows.OpenProcess(accessFlags, false, pid)

	if err != nil {
		result.Success = false
		result.Blocked = true

		// Get error code
		if errno, ok := err.(syscall.Errno); ok {
			result.ErrorCode = uint32(errno)
			result.ErrorMessage = errno.Error()

			// Check if this is an access denied error (EDR blocking)
			if errno == windows.ERROR_ACCESS_DENIED {
				result.BlockedBy = "Access Denied - likely EDR protection"
			}
		} else {
			result.ErrorMessage = err.Error()
		}
	} else {
		result.Success = true
		result.Handle = handle
		result.HandleValue = uintptr(handle)
		// Note: Handle should be closed by caller
	}

	return result
}

// EnumerateProcessModules lists all loaded modules in a process
func EnumerateProcessModules(handle windows.Handle, pid uint32) ([]ModuleInfo, error) {
	var modules []ModuleInfo

	// Create snapshot of modules
	snapshot, _, err := procCreateToolhelp32Snapshot.Call(
		TH32CS_SNAPMODULE|TH32CS_SNAPMODULE32,
		uintptr(pid),
	)
	if snapshot == 0 {
		return nil, fmt.Errorf("CreateToolhelp32Snapshot (modules) failed: %v", err)
	}
	defer windows.CloseHandle(windows.Handle(snapshot))

	var me32 MODULEENTRY32
	me32.Size = uint32(unsafe.Sizeof(me32))

	// Get first module
	ret, _, _ := procModule32First.Call(snapshot, uintptr(unsafe.Pointer(&me32)))
	if ret == 0 {
		return nil, fmt.Errorf("Module32First failed")
	}

	// Iterate through modules
	for {
		moduleName := windows.UTF16ToString(me32.SzModule[:])
		modulePath := windows.UTF16ToString(me32.SzExePath[:])

		modules = append(modules, ModuleInfo{
			ModuleName:  moduleName,
			BaseAddress: me32.ModBaseAddr,
			Size:        me32.ModBaseSize,
			Path:        modulePath,
		})

		// Get next module
		ret, _, _ = procModule32Next.Call(snapshot, uintptr(unsafe.Pointer(&me32)))
		if ret == 0 {
			break
		}
	}

	return modules, nil
}

// FindModuleByName locates a specific module in process memory
func FindModuleByName(modules []ModuleInfo, moduleName string) *ModuleInfo {
	for i := range modules {
		if strings.EqualFold(modules[i].ModuleName, moduleName) {
			return &modules[i]
		}
	}
	return nil
}

// EnumerateMemoryRegions lists memory regions in a process
func EnumerateMemoryRegions(handle windows.Handle) ([]MemoryRegion, error) {
	var regions []MemoryRegion
	var address uintptr = 0

	for {
		var mbi windows.MemoryBasicInformation
		err := windows.VirtualQueryEx(handle, address, &mbi, unsafe.Sizeof(mbi))
		if err != nil {
			break // End of address space
		}

		regions = append(regions, MemoryRegion{
			BaseAddress: mbi.BaseAddress,
			Size:        uint64(mbi.RegionSize),
			State:       mbi.State,
			Protect:     mbi.Protect,
			Type:        mbi.Type,
		})

		address = mbi.BaseAddress + mbi.RegionSize
	}

	return regions, nil
}

// SaveProcessInjectionReport saves the injection attempt report to disk
func SaveProcessInjectionReport(report *ProcessInjectionReport) error {
	reportPath := filepath.Join("c:\\F0", "process_injection_report.json")

	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal report: %v", err)
	}

	if err := os.WriteFile(reportPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write report: %v", err)
	}

	return nil
}

// CloseProcessHandle safely closes a process handle
func CloseProcessHandle(handle windows.Handle) {
	if handle != 0 {
		windows.CloseHandle(handle)
	}
}
