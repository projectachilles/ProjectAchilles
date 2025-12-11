//go:build windows
// +build windows

// Masqueraded Encryption Binary Source Code
// Simulates encryption behavior while masquerading as conhost.exe
// MITRE ATT&CK: T1055 - Process Injection, T1486 - Data Encrypted for Impact

package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// Hide console window
var (
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	procAllocConsole = kernel32.NewProc("AllocConsole")
	procFreeConsole  = kernel32.NewProc("FreeConsole")
)

func hideConsole() {
	procFreeConsole.Call()
}

func main() {
	hideConsole()
	
	// Check command line arguments
	args := os.Args[1:]
	simulate := false
	targetDir := ""
	
	for i, arg := range args {
		if arg == "-simulate" {
			simulate = true
		} else if arg == "-target" && i+1 < len(args) {
			targetDir = args[i+1]
		}
	}
	
	if !simulate {
		// Exit if not in simulation mode
		os.Exit(0)
	}
	
	if targetDir == "" {
		targetDir = "c:\\F0\\test_target"
	}
	
	// Create target directory for simulation
	os.MkdirAll(targetDir, 0755)
	
	// Create status file to communicate with main test
	statusFile := "c:\\F0\\exfiltration_status.txt"
	
	// Phase 1: Process masquerading detection test
	processName := filepath.Base(os.Args[0])
	if strings.ToLower(processName) == "conhost.exe" {
		// Simulate masquerading behavior
		time.Sleep(time.Second * 1)
		
		// Check if we're running from unusual location (detection opportunity)
		currentPath, _ := os.Executable()
		if strings.Contains(strings.ToLower(currentPath), "f0") {
			// This should trigger behavioral detection as conhost.exe shouldn't run from F0
			writeStatus(statusFile, "MASQUERADE_DETECTED")
			os.Exit(1)
		}
	}
	
	// Phase 2: Simulate encryption preparation behavior
	testFiles := []string{"test1.txt", "test2.txt", "test3.txt"}
	
	for _, filename := range testFiles {
		filePath := filepath.Join(targetDir, filename)
		
		// Create test files
		testContent := fmt.Sprintf("This is test file content for %s", filename)
		err := ioutil.WriteFile(filePath, []byte(testContent), 0644)
		if err != nil {
			continue
		}
		
		// Simulate file reading (encryption preparation)
		data, err := ioutil.ReadFile(filePath)
		if err != nil {
			continue
		}
		
		// Simulate encryption process (reverse bytes - simple transformation)
		encrypted := make([]byte, len(data))
		for i := 0; i < len(data); i++ {
			encrypted[i] = data[len(data)-1-i]
		}
		
		// Write "encrypted" data back (simulation only)
		encryptedPath := filePath + ".encrypted"
		ioutil.WriteFile(encryptedPath, encrypted, 0644)
		
		// Add small delay to simulate processing
		time.Sleep(time.Millisecond * 100)
	}
	
	// Phase 3: Simulate ransom note creation
	ransomNotePath := filepath.Join(targetDir, "DECRYPT_INSTRUCTIONS.txt")
	ransomNote := `[SIMULATION ONLY - NOT REAL RANSOMWARE]

Your files have been encrypted (simulation).
This is a security test simulation.

DO NOT PANIC - This is not real malware.
Contact your security team.

Test ID: 4b4bd24c-fff5-4de8-982e-6d0fa5e22284
`
	
	ioutil.WriteFile(ransomNotePath, []byte(ransomNote), 0644)
	
	// Phase 4: CPU intensive operations (simulate actual encryption load)
	performCPUIntensiveOperation()
	
	// Signal completion
	writeStatus(statusFile, "ENCRYPTION_SIMULATION_COMPLETE")
	
	os.Exit(0)
}

func writeStatus(filename, status string) {
	ioutil.WriteFile(filename, []byte(status), 0644)
}

func performCPUIntensiveOperation() {
	// Simulate CPU-intensive encryption-like operations
	iterations := 1000000
	result := 0
	
	for i := 0; i < iterations; i++ {
		result += i * i
		result = result % 999999
		
		// Check for interruption periodically
		if i%100000 == 0 {
			time.Sleep(time.Millisecond * 10)
		}
	}
}