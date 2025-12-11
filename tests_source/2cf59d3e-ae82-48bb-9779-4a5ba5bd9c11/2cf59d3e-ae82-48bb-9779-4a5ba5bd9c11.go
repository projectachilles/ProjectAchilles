//go:build windows
// +build windows

/*
ID: 2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11
NAME: SafePay UAC Bypass & Defense Evasion
TECHNIQUE: T1548.002, T1562.001, T1547.001
UNIT: response
CREATED: 2025-07-30 00:00:00.000000
*/
package main

import (
	_ "embed"
	"os"
	"os/exec"
	"path/filepath"

	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

//go:embed safepay_uac_bypass.ps1
var safepayScript []byte

func executeUACBypass() error {
	// Drop the PowerShell script to c:\F0
	targetDir := "c:\\F0"
	os.MkdirAll(targetDir, 0755)
	
	scriptPath := filepath.Join(targetDir, "safepay_uac_bypass.ps1")
	err := os.WriteFile(scriptPath, safepayScript, 0644)
	if err != nil {
		return err
	}
	
	// Execute the PowerShell script with bypass
	cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-File", scriptPath)
	_, err = cmd.Output()
	return err
}

func test() {
	// Initialize the dropper
	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		Endpoint.Say("Dropper initialization failed: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	Endpoint.Say("Starting SafePay UAC Bypass & Defense Evasion test")
	Endpoint.Say("Dropping PowerShell script for UAC bypass simulation")
	Endpoint.Say("Pausing for 3 seconds to gauge defensive reaction")
	Endpoint.Wait(3)

	// Check if the script gets quarantined
	if Endpoint.Quarantined("safepay_uac_bypass.ps1", safepayScript) {
		Endpoint.Say("SafePay UAC bypass script was caught!")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}

	Endpoint.Say("Script was not caught, attempting UAC bypass execution")

	// Try to execute the UAC bypass
	err := executeUACBypass()
	if err != nil {
		Endpoint.Say("Got error \"%v\" when executing UAC bypass", err)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	Endpoint.Say("UAC bypass execution was not prevented")
	Endpoint.Stop(Endpoint.Unprotected)
}

func main() {
	Endpoint.Start(test)
}